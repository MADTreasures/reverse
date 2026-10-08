/**
 * Text tool (click to type, drag a frame to type wrapping text, click text to edit it) and balloon
 * tools (drag a balloon like a figure; balloon tails are dragged from inside a balloon).
 */
import { fromPoints } from '../paint/rect';
import { balloonBody, newObjectId, tailShapes, type Balloon, type BalloonTail } from '../paint/text';
import type { SubTool } from '../paint/tools';
import { apply as applyMatrix } from '../paint/viewMath';
import { getState, setState } from '../store/store';
import { addBalloon, addBalloonTail, balloonAt, editTextBox, startNewText, textAt } from '../store/textActions';
import type { Modifiers, OverlayView, PointerInfo, ToolSession } from './types';

const DRAG_THRESHOLD = 3;

function outline(ctx: CanvasRenderingContext2D, view: OverlayView, pts: { x: number; y: number }[]): void {
  ctx.beginPath();
  pts.forEach((q, i) => {
    const s = applyMatrix(view.matrix, q.x, q.y);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.closePath();
  ctx.stroke();
}

/** Text tool: a click types at the pointer, a drag makes a frame the text wraps at. */
class TextFrameSession implements ToolSession {
  private end: PointerInfo;
  readonly cursor = 'text';

  constructor(private start: PointerInfo) {
    this.end = start;
  }

  private dragged(): boolean {
    return Math.hypot(this.end.sx - this.start.sx, this.end.sy - this.start.sy) >= DRAG_THRESHOLD;
  }

  move(p: PointerInfo): void {
    this.end = p;
  }

  up(p: PointerInfo): void {
    this.end = p;
    startNewText({ x: this.start.x, y: this.start.y }, this.dragged() ? fromPoints(this.start.x, this.start.y, p.x, p.y) : null);
  }

  cancel(): void {}

  overlay(ctx: CanvasRenderingContext2D, view: OverlayView): void {
    if (!this.dragged()) return;
    const r = fromPoints(this.start.x, this.start.y, this.end.x, this.end.y);
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#2f80ed';
    ctx.setLineDash([4, 3]);
    outline(ctx, view, [
      { x: r.x, y: r.y },
      { x: r.x + r.w, y: r.y },
      { x: r.x + r.w, y: r.y + r.h },
      { x: r.x, y: r.y + r.h },
    ]);
    ctx.restore();
  }
}

export function textSession(p: PointerInfo): ToolSession | null {
  const hit = textAt(p);
  if (hit) {
    editTextBox(hit.layer.id, hit.box.id);
    return null;
  }
  return new TextFrameSession(p);
}

/** Balloon shape tools: drag the balloon's box (⇧ circle / square, ⌥ from the centre). */
class BalloonShapeSession implements ToolSession {
  private end: PointerInfo;
  private mods: Modifiers;
  readonly cursor = 'crosshair';

  constructor(
    private sub: SubTool,
    private start: PointerInfo,
  ) {
    this.end = start;
    this.mods = start;
  }

  private balloon(): Balloon | null {
    let { x: x0, y: y0 } = this.start;
    let { x: x1, y: y1 } = this.end;
    if (Math.hypot(this.end.sx - this.start.sx, this.end.sy - this.start.sy) < DRAG_THRESHOLD) return null;
    if (this.mods.shift) {
      const d = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      x1 = x0 + Math.sign(x1 - x0 || 1) * d;
      y1 = y0 + Math.sign(y1 - y0 || 1) * d;
    }
    if (this.mods.alt) {
      x0 -= x1 - x0;
      y0 -= y1 - y0;
    }
    const r = fromPoints(x0, y0, x1, y1);
    const settings = this.sub.balloon ?? { shape: 'ellipse' as const, lineWidth: 3, fill: true };
    const { colors } = getState();
    return {
      id: newObjectId('b'),
      shape: settings.shape,
      x: r.x,
      y: r.y,
      w: Math.max(4, r.w),
      h: Math.max(4, r.h),
      angle: 0,
      lineWidth: settings.lineWidth,
      // Line in the main colour, inside in the sub colour (as the reference's defaults).
      lineColor: colors.main,
      fillColor: settings.fill ? colors.sub : null,
      tails: [],
    };
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
    const b = this.balloon();
    if (b) addBalloon(b);
  }

  cancel(): void {}

  overlay(ctx: CanvasRenderingContext2D, view: OverlayView): void {
    const b = this.balloon();
    if (!b) return;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#2f80ed';
    outline(ctx, view, balloonBody(b));
    ctx.restore();
  }
}

/** Balloon tail tools: drag from inside a balloon to where the tail points. */
class TailSession implements ToolSession {
  private tip: { x: number; y: number };
  readonly cursor = 'crosshair';

  constructor(
    private sub: SubTool,
    private layerId: string,
    private balloon: Balloon,
    p: PointerInfo,
  ) {
    this.tip = { x: p.x, y: p.y };
  }

  private tail(): BalloonTail {
    const t = this.sub.tail ?? { width: 24, bend: 0.3, kind: 'pointed' as const };
    return { id: 'preview', tip: this.tip, width: t.width, bend: t.bend, kind: t.kind };
  }

  move(p: PointerInfo): void {
    this.tip = { x: p.x, y: p.y };
  }

  up(p: PointerInfo): void {
    this.tip = { x: p.x, y: p.y };
    // A tail that ends inside the balloon would not show.
    if (balloonAt(this.tip)?.balloon.id === this.balloon.id) return;
    const { id: _id, ...tail } = this.tail();
    addBalloonTail(this.layerId, this.balloon.id, tail);
  }

  cancel(): void {}

  overlay(ctx: CanvasRenderingContext2D, view: OverlayView): void {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#2f80ed';
    for (const shape of tailShapes(this.balloon, this.tail())) outline(ctx, view, shape);
    ctx.restore();
  }
}

export function balloonSession(sub: SubTool, p: PointerInfo): ToolSession | null {
  if (sub.tail) {
    const hit = balloonAt(p);
    if (!hit) {
      setState({ hint: 'Drag from inside a balloon to draw its tail' });
      return null;
    }
    return new TailSession(sub, hit.layer.id, hit.balloon, p);
  }
  return new BalloonShapeSession(sub, p);
}
