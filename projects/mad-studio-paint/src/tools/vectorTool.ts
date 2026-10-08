/**
 * Object tool on vector layers: click a line to select it (⇧ adds or removes it), drag to move the
 * selected lines, drag a corner of their box to scale (⇧ frees the aspect ratio) and the round
 * handle above it to rotate (⇧ in 15° steps). Clicking a line on another vector layer switches to
 * that layer. Delete removes the selected lines; Tool Settings changes their colour and width.
 */
import { flatten, isEffectivelyVisible } from '../model/layers';
import type { VectorLayer } from '../model/types';
import { union, type Rect } from '../paint/rect';
import type { Affine } from '../paint/rulers';
import { hitStroke, linesBounds, type VectorStroke } from '../paint/vector';
import { apply as applyMatrix } from '../paint/viewMath';
import { engine } from '../engine/engine';
import * as actions from '../store/actions';
import { currentSubTool, getState, setState } from '../store/store';
import { hitHandle as hitRulerHandle, rulerObjectSession } from './rulerTool';
import type { Modifiers, OverlayView, PointerInfo, ToolSession } from './types';

const PICK_PX = 6;
const HANDLE_PX = 8;
/** Distance of the rotation handle from the box (screen px). */
const ROTATE_PX = 22;
const DRAG_THRESHOLD = 3;

type LineHandle = { kind: 'scale'; hx: -1 | 1; hy: -1 | 1 } | { kind: 'rotate' } | { kind: 'move' };

/** The selected lines of the active vector layer and their box. */
function selection(): { layer: VectorLayer; lines: VectorStroke[]; box: Rect } | null {
  const sel = actions.selectedVectorLines();
  const box = sel && linesBounds(sel.lines);
  return sel && box ? { ...sel, box } : null;
}

/** Screen position of the rotation handle: above the top edge, away from the box centre. */
function rotateHandle(box: Rect, view: OverlayView): { x: number; y: number } {
  const top = applyMatrix(view.matrix, box.x + box.w / 2, box.y);
  const mid = applyMatrix(view.matrix, box.x + box.w / 2, box.y + box.h / 2);
  const len = Math.hypot(top.x - mid.x, top.y - mid.y);
  const dir = len > 1e-6 ? { x: (top.x - mid.x) / len, y: (top.y - mid.y) / len } : { x: 0, y: -1 };
  return { x: top.x + dir.x * ROTATE_PX, y: top.y + dir.y * ROTATE_PX };
}

/** The handle of the selected lines' box under the pointer. */
function hitLineHandle(p: PointerInfo, view: OverlayView, box: Rect): LineHandle | null {
  for (const hx of [-1, 1] as const) {
    for (const hy of [-1, 1] as const) {
      const q = applyMatrix(view.matrix, hx < 0 ? box.x : box.x + box.w, hy < 0 ? box.y : box.y + box.h);
      if (Math.abs(q.x - p.sx) <= HANDLE_PX && Math.abs(q.y - p.sy) <= HANDLE_PX) return { kind: 'scale', hx, hy };
    }
  }
  const r = rotateHandle(box, view);
  if (Math.hypot(r.x - p.sx, r.y - p.sy) <= HANDLE_PX) return { kind: 'rotate' };
  if (p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h) return { kind: 'move' };
  return null;
}

/** Moves, scales or rotates the selected lines; the whole drag is one undo step. */
class LineEditSession implements ToolSession {
  private readonly original: VectorStroke[];
  private readonly which: Set<string>;
  private lines: VectorStroke[];
  private shown: Rect;
  private dragged = false;
  private last: PointerInfo;
  readonly cursor: string;

  constructor(
    private layer: VectorLayer,
    private handle: LineHandle,
    private start: PointerInfo,
    private box: Rect,
  ) {
    this.original = layer.strokes;
    this.lines = layer.strokes;
    this.which = new Set(getState().selectedLines);
    this.shown = box;
    this.last = start;
    this.cursor = handle.kind === 'move' ? 'move' : handle.kind === 'rotate' ? 'alias' : handle.hx === handle.hy ? 'nwse-resize' : 'nesw-resize';
  }

  private matrix(p: PointerInfo, m: Modifiers): Affine {
    const b = this.box;
    const h = this.handle;
    if (h.kind === 'move') {
      let dx = p.x - this.start.x;
      let dy = p.y - this.start.y;
      if (m.shift) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      return [1, 0, 0, 1, dx, dy];
    }
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    if (h.kind === 'rotate') {
      let a = Math.atan2(p.y - cy, p.x - cx) - Math.atan2(this.start.y - cy, this.start.x - cx);
      if (m.shift) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      return [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
    }
    // Scaling from the opposite corner.
    const ax = h.hx < 0 ? b.x + b.w : b.x;
    const ay = h.hy < 0 ? b.y + b.h : b.y;
    const ux = (h.hx < 0 ? b.x : b.x + b.w) - ax;
    const uy = (h.hy < 0 ? b.y : b.y + b.h) - ay;
    let kx = ux ? (p.x - ax) / ux : 1;
    let ky = uy ? (p.y - ay) / uy : 1;
    if (!m.shift) {
      // Along the diagonal: the aspect ratio stays.
      const k = (ux * (p.x - ax) + uy * (p.y - ay)) / Math.max(1e-6, ux * ux + uy * uy);
      kx = k;
      ky = k;
    }
    const min = 1 / Math.max(b.w, b.h, 1);
    if (Math.abs(kx) < min) kx = Math.sign(kx || 1) * min;
    if (Math.abs(ky) < min) ky = Math.sign(ky || 1) * min;
    return [kx, 0, 0, ky, ax - kx * ax, ay - ky * ay];
  }

  private update(p: PointerInfo, m: Modifiers): void {
    if (!this.dragged && Math.hypot(p.sx - this.start.sx, p.sy - this.start.sy) < DRAG_THRESHOLD) return;
    this.dragged = true;
    const scaleWidth = currentSubTool(getState(), 'object').scaleLineWidth !== false;
    this.lines = actions.transformSome(this.original, this.which, this.matrix(p, m), scaleWidth);
    const now = linesBounds(this.lines.filter((x) => this.which.has(x.id))) ?? this.shown;
    engine.renderVectorLines(this.layer.id, this.lines, union(this.shown, now));
    this.shown = now;
  }

  move(p: PointerInfo): void {
    this.last = p;
    this.update(p, p);
  }

  modifiers(m: Modifiers): void {
    this.update(this.last, m);
  }

  up(p: PointerInfo): void {
    this.last = p;
    this.update(p, p);
    if (!this.dragged) return;
    const label = this.handle.kind === 'move' ? 'Move lines' : this.handle.kind === 'rotate' ? 'Rotate lines' : 'Scale lines';
    actions.commitTransform(label, [], new Map([[this.layer.id, this.lines]]));
  }

  cancel(): void {
    if (this.dragged) engine.renderVectorLines(this.layer.id, this.original, union(this.shown, this.box));
  }

  overlay(ctx: CanvasRenderingContext2D, view: OverlayView): void {
    drawLines(ctx, view, this.lines.filter((x) => this.which.has(x.id)));
  }
}

/** The top-most line under the pointer on a visible, unlocked vector layer (the active one first). */
function pickLine(p: PointerInfo): { layer: VectorLayer; id: string } | null {
  const s = getState();
  const tolerance = PICK_PX / Math.max(0.01, s.view.zoom);
  const active = actions.activeLayer(s);
  const layers = flatten(s.doc.layers).filter((l): l is VectorLayer => l.kind === 'vector' && isEffectivelyVisible(s.doc.layers, l.id));
  if (active?.kind === 'vector') layers.sort((a, b) => Number(b.id === active.id) - Number(a.id === active.id));
  for (const layer of layers) {
    const i = hitStroke(layer.strokes, p, tolerance);
    if (i >= 0) return { layer, id: layer.strokes[i].id };
  }
  return null;
}

/** Object tool: rulers and vector lines. */
export function objectSession(p: PointerInfo, view: OverlayView): ToolSession | null {
  if (hitRulerHandle(p, view)) return rulerObjectSession(p, view);
  const sel = selection();
  const handle = sel && hitLineHandle(p, view, sel.box);
  if (sel && handle && handle.kind !== 'move' && !p.shift) return editable() ? new LineEditSession(sel.layer, handle, p, sel.box) : null;
  const hit = pickLine(p);
  if (hit) {
    const s = getState();
    if (hit.layer.id !== s.activeLayerId) actions.selectLayer(hit.layer.id);
    const selected = getState().selectedLines;
    if (p.shift) {
      actions.selectLines(selected.includes(hit.id) ? selected.filter((id) => id !== hit.id) : [...selected, hit.id]);
      return null;
    }
    if (!selected.includes(hit.id)) actions.selectLines([hit.id]);
    setState({ selectedRuler: null });
    const now = selection();
    return now && editable() ? new LineEditSession(now.layer, { kind: 'move' }, p, now.box) : null;
  }
  if (sel && handle?.kind === 'move' && !p.shift) return editable() ? new LineEditSession(sel.layer, handle, p, sel.box) : null;
  if (!p.shift) actions.selectLines([]);
  return rulerObjectSession(p, view);
}

function editable(): boolean {
  const reason = actions.editBlocker();
  if (reason) setState({ hint: reason });
  return reason === null;
}

/** Paths of lines as thin highlighted polylines. */
function drawLines(ctx: CanvasRenderingContext2D, view: OverlayView, lines: VectorStroke[]): void {
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#2f80ed';
  for (const line of lines) {
    ctx.beginPath();
    line.points.forEach((q, i) => {
      const s = applyMatrix(view.matrix, q.x, q.y);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    if (line.points.length === 1) {
      const s = applyMatrix(view.matrix, line.points[0].x, line.points[0].y);
      ctx.arc(s.x, s.y, 2, 0, Math.PI * 2);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** The selected lines, their box, scale handles and rotation handle (Object tool). */
export function drawLineSelection(ctx: CanvasRenderingContext2D, view: OverlayView): void {
  const sel = selection();
  if (!sel) return;
  drawLines(ctx, view, sel.lines);
  const { box } = sel;
  const corners = [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x + box.w, box.y + box.h],
    [box.x, box.y + box.h],
  ].map(([x, y]) => applyMatrix(view.matrix, x, y));
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#2f80ed';
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  const top = applyMatrix(view.matrix, box.x + box.w / 2, box.y);
  const rot = rotateHandle(box, view);
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(rot.x, rot.y);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  for (const c of corners) {
    ctx.fillRect(c.x - 4, c.y - 4, 8, 8);
    ctx.strokeRect(c.x - 4, c.y - 4, 8, 8);
  }
  ctx.beginPath();
  ctx.arc(rot.x, rot.y, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Cursor over the selected lines' handles (Object tool, no drag). */
export function lineHandleCursor(p: PointerInfo, view: OverlayView): string | null {
  const sel = selection();
  const h = sel && hitLineHandle(p, view, sel.box);
  if (!h) return null;
  return h.kind === 'move' ? 'move' : h.kind === 'rotate' ? 'alias' : h.hx === h.hy ? 'nwse-resize' : 'nesw-resize';
}
