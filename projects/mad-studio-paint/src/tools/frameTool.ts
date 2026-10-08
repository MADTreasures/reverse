/**
 * Frame border tools: Rectangle frame (drag; edges snap to the canvas and to other frames),
 * Polyline frame (click the corners) and Divide frame border (drag across a frame).
 */
import { flatten } from '../model/layers';
import { mmToPx, panelEdges, rectPoints, splitPanel } from '../paint/frames';
import { fromPoints } from '../paint/rect';
import type { SubTool } from '../paint/tools';
import { apply as applyMatrix } from '../paint/viewMath';
import * as actions from '../store/actions';
import { addFrameFolder, dividePanel, panelForCut } from '../store/frameActions';
import { getState, setState } from '../store/store';
import { PolylineSelect } from './sessions';
import type { Modifiers, OverlayView, PointerInfo, ToolSession } from './types';

const DRAG_THRESHOLD = 3;
const SNAP_PX = 10;

function outline(ctx: CanvasRenderingContext2D, view: OverlayView, pts: { x: number; y: number }[], close = true): void {
  ctx.beginPath();
  pts.forEach((q, i) => {
    const s = applyMatrix(view.matrix, q.x, q.y);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  if (close) ctx.closePath();
  ctx.stroke();
}

/** Positions an edge can snap to: the canvas edges and the vertical / horizontal edges of frames. */
function snapLines(): { xs: number[]; ys: number[] } {
  const { doc } = getState();
  const xs = [0, doc.width];
  const ys = [0, doc.height];
  for (const l of flatten(doc.layers)) {
    if (!actions.isFrameFolder(l)) continue;
    for (const [a, b] of panelEdges(l.frame.panels)) {
      if (Math.abs(a.x - b.x) < 0.5) xs.push(a.x);
      if (Math.abs(a.y - b.y) < 0.5) ys.push(a.y);
    }
  }
  return { xs, ys };
}

const snap = (v: number, lines: number[], reach: number) => lines.reduce((best, l) => (Math.abs(l - v) < Math.abs(best - v) && Math.abs(l - v) <= reach ? l : best), v);

/** Rectangle frame: drag a box (⇧ square); its edges snap to the canvas and other frames. */
class FrameRectSession implements ToolSession {
  private end: PointerInfo;
  private mods: Modifiers;
  private lines = snapLines();
  readonly cursor = 'crosshair';

  constructor(
    private sub: SubTool,
    private start: PointerInfo,
  ) {
    this.end = start;
    this.mods = start;
  }

  private rect(): { x: number; y: number; w: number; h: number } | null {
    if (Math.hypot(this.end.sx - this.start.sx, this.end.sy - this.start.sy) < DRAG_THRESHOLD) return null;
    const reach = SNAP_PX / Math.max(0.01, getState().view.zoom);
    const x0 = snap(this.start.x, this.lines.xs, reach);
    const y0 = snap(this.start.y, this.lines.ys, reach);
    let x1 = snap(this.end.x, this.lines.xs, reach);
    let y1 = snap(this.end.y, this.lines.ys, reach);
    if (this.mods.shift) {
      const d = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      x1 = x0 + Math.sign(x1 - x0 || 1) * d;
      y1 = y0 + Math.sign(y1 - y0 || 1) * d;
    }
    const r = fromPoints(x0, y0, x1, y1);
    return r.w >= 2 && r.h >= 2 ? r : null;
  }

  move(p: PointerInfo): void {
    this.end = p;
    this.mods = p;
  }

  modifiers(m: Modifiers): void {
    this.mods = m;
  }

  up(p: PointerInfo): void {
    this.end = p;
    this.mods = p;
    const r = this.rect();
    if (r) addFrameFolder(rectPoints(r.x, r.y, r.w, r.h), this.sub.frameLine ?? 5);
  }

  cancel(): void {}

  overlay(ctx: CanvasRenderingContext2D, view: OverlayView): void {
    const r = this.rect();
    if (!r) return;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#2f80ed';
    outline(ctx, view, rectPoints(r.x, r.y, r.w, r.h));
    ctx.restore();
  }
}

/** Divide frame border: drag across a frame; the cut (⇧: in 45° steps) splits it with a gutter. */
class DivideSession implements ToolSession {
  private end: { x: number; y: number };
  readonly cursor = 'crosshair';

  constructor(
    private sub: SubTool,
    private start: PointerInfo,
  ) {
    this.end = start;
  }

  private target() {
    return panelForCut(this.start, this.end);
  }

  private cut(p: PointerInfo): { x: number; y: number } {
    if (!p.shift) return { x: p.x, y: p.y };
    const dx = p.x - this.start.x;
    const dy = p.y - this.start.y;
    const step = Math.PI / 4;
    const a = Math.round(Math.atan2(dy, dx) / step) * step;
    const l = Math.hypot(dx, dy);
    return { x: this.start.x + Math.cos(a) * l, y: this.start.y + Math.sin(a) * l };
  }

  /** Gutter for the cut's direction (mm → px at the document resolution). */
  private gap(): number {
    const across = Math.abs(this.end.x - this.start.x) >= Math.abs(this.end.y - this.start.y);
    const mm = across ? (this.sub.gutterTopBottom ?? 4) : (this.sub.gutterLeftRight ?? 2);
    return mmToPx(mm, getState().doc.dpi);
  }

  private parts() {
    const t = this.target();
    return t ? splitPanel(t.panel.points, this.start, this.end, this.gap()) : null;
  }

  move(p: PointerInfo): void {
    this.end = this.cut(p);
  }

  up(p: PointerInfo): void {
    this.end = this.cut(p);
    if (Math.hypot(this.end.x - this.start.x, this.end.y - this.start.y) * getState().view.zoom < DRAG_THRESHOLD) return;
    const t = this.target();
    if (!t || !dividePanel(t.folder.id, t.panel.id, this.start, this.end, this.gap(), this.sub.divideFolder !== false)) setState({ hint: 'Drag across a frame to divide it' });
  }

  cancel(): void {}

  overlay(ctx: CanvasRenderingContext2D, view: OverlayView): void {
    const parts = this.parts();
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#2f80ed';
    if (parts) for (const part of parts) outline(ctx, view, part);
    ctx.setLineDash([4, 3]);
    outline(ctx, view, [this.start, this.end], false);
    ctx.restore();
  }
}

export function frameSession(sub: SubTool, p: PointerInfo): ToolSession | null {
  if (sub.frameShape === 'divide') return new DivideSession(sub, p);
  if (sub.frameShape === 'polyline') {
    PolylineSelect.click(p, (points) => addFrameFolder(points, sub.frameLine ?? 5));
    return null;
  }
  return new FrameRectSession(sub, p);
}
