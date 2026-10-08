/**
 * Object tool on vector and text layers and comic frames: click a line, text, balloon or frame
 * border to select it (⇧ adds or removes it), drag to move the selection, drag a corner of its box to scale (⇧ frees the aspect
 * ratio) and the round handle above it to rotate (⇧ in 15° steps). Clicking an object on another
 * layer switches to that layer; double-clicking text edits it. Delete removes the selection; Tool
 * Settings changes colour, width, font and so on.
 */
import { flatten, isEffectivelyVisible } from '../model/layers';
import { contentBounds, contentOf, EMPTY_CONTENT, pickObject, transformContent, type Content } from '../paint/objects';
import type { GradientFill } from '../paint/gradient';
import type { GradientLayer } from '../model/types';
import { union, type Rect } from '../paint/rect';
import type { Affine } from '../paint/rulers';
import { balloonBody, frameCorners, tailShapes } from '../paint/text';
import { apply as applyMatrix } from '../paint/viewMath';
import { engine } from '../engine/engine';
import * as actions from '../store/actions';
import { currentSubTool, getState, setState } from '../store/store';
import { editTextBox } from '../store/textActions';
import { hitHandle as hitRulerHandle, rulerObjectSession } from './rulerTool';
import type { Modifiers, OverlayView, PointerInfo, ToolSession } from './types';

const PICK_PX = 6;
const HANDLE_PX = 8;
/** Distance of the rotation handle from the box (screen px). */
const ROTATE_PX = 22;
const DRAG_THRESHOLD = 3;
const DOUBLE_CLICK_MS = 350;

type ObjectHandle = { kind: 'scale'; hx: -1 | 1; hy: -1 | 1 } | { kind: 'rotate' } | { kind: 'move' };

/** The selected objects of the active layer and their box. */
function selection(): { layer: actions.ObjectLayer; ids: Set<string>; content: Content; box: Rect } | null {
  const sel = actions.selectedObjectsOf();
  const box = sel && contentBounds(sel.content, sel.ids);
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

/** The handle of the selection box under the pointer. */
function hitObjectHandle(p: PointerInfo, view: OverlayView, box: Rect): ObjectHandle | null {
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

/** Moves, scales or rotates the selected objects; the whole drag is one undo step. */
class ObjectEditSession implements ToolSession {
  private readonly original: Content;
  private readonly which: Set<string>;
  private content: Content;
  private shown: Rect;
  private dragged = false;
  private last: PointerInfo;
  readonly cursor: string;

  constructor(
    private layer: actions.ObjectLayer,
    private handle: ObjectHandle,
    private start: PointerInfo,
    private box: Rect,
  ) {
    this.original = contentOf(layer);
    this.content = this.original;
    this.which = new Set(getState().selectedObjects);
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
    this.content = transformContent(this.original, this.which, this.matrix(p, m), { scaleWidth });
    const now = contentBounds(this.content, this.which) ?? this.shown;
    actions.previewContent(this.layer, this.content, union(this.shown, now));
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
    const what = this.layer.kind === 'vector' ? ' lines' : '';
    const label = this.handle.kind === 'move' ? `Move${what}` : this.handle.kind === 'rotate' ? `Rotate${what}` : `Scale${what}`;
    actions.commitTransform(label, [], new Map([[this.layer.id, this.content]]));
  }

  cancel(): void {
    if (!this.dragged) return;
    actions.previewContent(this.layer, this.original, union(this.shown, this.box));
    engine.resync();
  }

  overlay(ctx: CanvasRenderingContext2D, view: OverlayView): void {
    drawOutlines(ctx, view, this.content, this.which);
  }
}

/** The top-most object under the pointer on a visible vector or text layer (the active one first). */
function pickAt(p: PointerInfo): { layer: actions.ObjectLayer; id: string } | null {
  const s = getState();
  const tolerance = PICK_PX / Math.max(0.01, s.view.zoom);
  const active = actions.activeLayer(s);
  const layers = flatten(s.doc.layers).filter((l): l is actions.ObjectLayer => actions.isObjectLayer(l) && isEffectivelyVisible(s.doc.layers, l.id));
  if (active) layers.sort((a, b) => Number(b.id === active.id) - Number(a.id === active.id));
  for (const layer of layers) {
    const id = pickObject(contentOf(layer), p, tolerance, layer.kind === 'folder' ? layer.frame.lineWidth : 0);
    if (id) return { layer, id };
  }
  return null;
}

// ------------------------------------------------------------------ gradient layers

/** The start (cross) or end (circle) handle of the active gradient layer under the pointer. */
function gradientHandleAt(p: PointerInfo, view: OverlayView): { layer: GradientLayer; end: 'a' | 'b' } | null {
  const s = getState();
  const l = actions.activeLayer(s);
  if (l?.kind !== 'gradient' || s.maskEditing) return null;
  for (const end of ['b', 'a'] as const) {
    const q = applyMatrix(view.matrix, l.gradient[end].x, l.gradient[end].y);
    if (Math.hypot(q.x - p.sx, q.y - p.sy) <= HANDLE_PX + 2) return { layer: l, end };
  }
  return null;
}

/** Drags the start or end of a gradient layer's gradient (⇧: in 45° steps around the other end). */
class GradientHandleSession implements ToolSession {
  private fill: GradientFill;
  readonly cursor = 'grabbing';

  constructor(
    private layer: GradientLayer,
    private end: 'a' | 'b',
  ) {
    this.fill = layer.gradient;
  }

  private update(p: PointerInfo): void {
    const other = this.layer.gradient[this.end === 'a' ? 'b' : 'a'];
    let at = { x: p.x, y: p.y };
    if (p.shift) {
      const step = Math.PI / 4;
      const a = Math.round(Math.atan2(at.y - other.y, at.x - other.x) / step) * step;
      const len = Math.hypot(at.x - other.x, at.y - other.y);
      at = { x: other.x + Math.cos(a) * len, y: other.y + Math.sin(a) * len };
    }
    this.fill = { ...this.layer.gradient, [this.end]: at };
    actions.previewContent(this.layer, { ...EMPTY_CONTENT, gradient: this.fill }, null);
  }

  move(p: PointerInfo): void {
    this.update(p);
  }

  up(p: PointerInfo): void {
    this.update(p);
    actions.commitTransform('Edit gradient', [], new Map([[this.layer.id, { ...EMPTY_CONTENT, gradient: this.fill }]]));
  }

  cancel(): void {
    engine.resync();
  }
}

/** The active gradient layer's direction: start (cross) to end (circle). */
export function drawGradientHandles(ctx: CanvasRenderingContext2D, view: OverlayView): void {
  const s = getState();
  const l = actions.activeLayer(s);
  if (l?.kind !== 'gradient' || s.maskEditing) return;
  const a = applyMatrix(view.matrix, l.gradient.a.x, l.gradient.a.y);
  const b = applyMatrix(view.matrix, l.gradient.b.x, l.gradient.b.y);
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#2f80ed';
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(a.x - 6, a.y);
  ctx.lineTo(a.x + 6, a.y);
  ctx.moveTo(a.x, a.y - 6);
  ctx.lineTo(a.x, a.y + 6);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(b.x, b.y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

let lastClick: { time: number; id: string } | null = null;

/** Object tool: rulers, vector lines, text and balloons. */
export function objectSession(p: PointerInfo, view: OverlayView): ToolSession | null {
  const handle0 = gradientHandleAt(p, view);
  if (handle0) return editable() ? new GradientHandleSession(handle0.layer, handle0.end) : null;
  if (hitRulerHandle(p, view)) return rulerObjectSession(p, view);
  const sel = selection();
  const handle = sel && hitObjectHandle(p, view, sel.box);
  if (sel && handle && handle.kind !== 'move' && !p.shift) return editable() ? new ObjectEditSession(sel.layer, handle, p, sel.box) : null;
  const hit = pickAt(p);
  if (hit) {
    // Double-clicking text edits it.
    const double = lastClick?.id === hit.id && p.time - lastClick.time < DOUBLE_CLICK_MS;
    lastClick = { time: p.time, id: hit.id };
    if (double && hit.layer.kind === 'text' && hit.layer.texts.some((t) => t.id === hit.id)) {
      editTextBox(hit.layer.id, hit.id);
      return null;
    }
    if (hit.layer.id !== getState().activeLayerId) actions.selectLayer(hit.layer.id);
    const selected = getState().selectedObjects;
    if (p.shift) {
      actions.selectObjects(selected.includes(hit.id) ? selected.filter((id) => id !== hit.id) : [...selected, hit.id]);
      return null;
    }
    if (!selected.includes(hit.id)) actions.selectObjects([hit.id]);
    setState({ selectedRuler: null });
    const now = selection();
    return now && editable() ? new ObjectEditSession(now.layer, { kind: 'move' }, p, now.box) : null;
  }
  lastClick = null;
  if (sel && handle?.kind === 'move' && !p.shift) return editable() ? new ObjectEditSession(sel.layer, handle, p, sel.box) : null;
  if (!p.shift) actions.selectObjects([]);
  return rulerObjectSession(p, view);
}

function editable(): boolean {
  const reason = actions.objectBlocker();
  if (reason) setState({ hint: reason });
  return reason === null;
}

/** Outlines of objects as thin highlighted lines: line paths, text frames, balloon shapes. */
function drawOutlines(ctx: CanvasRenderingContext2D, view: OverlayView, c: Content, ids: Set<string>): void {
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#2f80ed';
  const poly = (pts: { x: number; y: number }[], close: boolean) => {
    ctx.beginPath();
    pts.forEach((q, i) => {
      const s = applyMatrix(view.matrix, q.x, q.y);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    if (close) ctx.closePath();
    if (pts.length === 1) {
      const s = applyMatrix(view.matrix, pts[0].x, pts[0].y);
      ctx.arc(s.x, s.y, 2, 0, Math.PI * 2);
    }
    ctx.stroke();
  };
  for (const line of c.strokes) if (ids.has(line.id)) poly(line.points, false);
  for (const b of c.balloons) {
    if (!ids.has(b.id)) continue;
    poly(balloonBody(b), true);
    for (const t of b.tails) for (const shape of tailShapes(b, t)) poly(shape, true);
  }
  for (const panel of c.panels) if (ids.has(panel.id)) poly(panel.points, true);
  ctx.setLineDash([3, 3]);
  for (const t of c.texts) if (ids.has(t.id)) poly(frameCorners(t), true);
  ctx.restore();
}

/** The selected objects, their box, scale handles and rotation handle (Object tool). */
export function drawLineSelection(ctx: CanvasRenderingContext2D, view: OverlayView): void {
  const sel = selection();
  if (!sel) return;
  drawOutlines(ctx, view, sel.content, sel.ids);
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

/** Cursor over the selection's handles (Object tool, no drag). */
export function lineHandleCursor(p: PointerInfo, view: OverlayView): string | null {
  const sel = selection();
  const h = sel && hitObjectHandle(p, view, sel.box);
  if (!h) return null;
  return h.kind === 'move' ? 'move' : h.kind === 'rotate' ? 'alias' : h.hx === h.hy ? 'nwse-resize' : 'nesw-resize';
}
