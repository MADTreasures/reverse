/**
 * Point-by-point curve input for the curve rulers: each click adds a point, a double-click on the
 * last point (or Enter) finishes, Backspace or Delete removes the last point, Esc cancels. ⌥-click
 * makes a corner (spline, quadratic Bezier); with cubic Bezier curves, dragging from a new anchor
 * pulls out its direction points (without dragging the anchor is a corner).
 */
import { sampleCurve, type CurveSpec, type CurveType } from '../paint/curves';
import type { Pt } from '../paint/rulers';
import { apply as applyMatrix } from '../paint/viewMath';
import { getState, setState } from '../store/store';
import type { OverlayView, PointerInfo, ToolSession } from './types';

const DOUBLE_CLICK_MS = 350;
const DRAG_PX = 3;
const HINT = 'Click to add points · double-click or Enter finishes · Backspace removes the last point · Esc cancels';

interface Anchor {
  x: number;
  y: number;
  sx: number;
  sy: number;
  corner: boolean;
  /** Cubic Bezier: the outgoing direction point (the incoming one mirrors it). */
  out?: Pt;
}

/** The curve the anchors describe. */
export function anchorsToCurve(type: CurveType, anchors: { x: number; y: number; corner?: boolean; out?: Pt }[]): CurveSpec {
  const points = anchors.map(({ x, y }) => ({ x, y }));
  if (type === 'cubic') {
    const out: Pt[] = [];
    anchors.forEach((a, i) => {
      const at = { x: a.x, y: a.y };
      if (i > 0) out.push(a.out ? { x: 2 * a.x - a.out.x, y: 2 * a.y - a.out.y } : at, at);
      else out.push(at);
      if (i < anchors.length - 1) out.push(a.out ?? at);
    });
    return { curve: 'cubic', points: out };
  }
  const corners = type === 'polyline' ? [] : anchors.flatMap((a, i) => (a.corner && i > 0 && i < anchors.length - 1 ? [i] : []));
  return corners.length ? { curve: type, points, corners } : { curve: type, points };
}

export class CurveInput {
  static active: CurveInput | null = null;
  hover: Pt | null = null;
  private anchors: Anchor[] = [];
  private lastClick = 0;

  private constructor(
    readonly owner: string,
    readonly type: CurveType,
    private onDone: (spec: CurveSpec) => void,
  ) {}

  /**
   * A press with a curve tool: adds a point or finishes the curve. `owner` names the tool and its
   * settings; a press with others starts a new curve. Returns a session while a cubic anchor's
   * direction points are dragged out.
   */
  static press(p: PointerInfo, owner: string, type: CurveType, onDone: (spec: CurveSpec) => void): ToolSession | null {
    let c = CurveInput.active;
    if (c && (c.owner !== owner || c.type !== type)) c = null;
    if (!c) {
      c = CurveInput.active = new CurveInput(owner, type, onDone);
      setState({ hint: HINT });
    }
    return c.add(p);
  }

  private add(p: PointerInfo): ToolSession | null {
    const prev = this.anchors[this.anchors.length - 1];
    const double = prev && p.time - this.lastClick < DOUBLE_CLICK_MS && Math.hypot(p.sx - prev.sx, p.sy - prev.sy) < 6;
    this.lastClick = p.time;
    if (double) {
      this.finish();
      return null;
    }
    const a: Anchor = { x: p.x, y: p.y, sx: p.sx, sy: p.sy, corner: p.alt };
    this.anchors.push(a);
    this.hover = null;
    if (this.type !== 'cubic') return null;
    const input = this;
    return {
      cursor: 'crosshair',
      move(q: PointerInfo) {
        a.out = Math.hypot(q.sx - a.sx, q.sy - a.sy) >= DRAG_PX ? { x: q.x, y: q.y } : undefined;
      },
      up(q: PointerInfo) {
        this.move(q, []);
        // A drag is not the first click of a double-click.
        if (a.out) input.lastClick = 0;
      },
      cancel() {},
    };
  }

  static finish(): void {
    CurveInput.active?.finish();
  }

  private finish(): void {
    CurveInput.active = null;
    setState({ hint: '' });
    if (this.anchors.length >= 2) this.onDone(anchorsToCurve(this.type, this.anchors));
  }

  static cancel(): void {
    if (!CurveInput.active) return;
    CurveInput.active = null;
    setState({ hint: '' });
  }

  /** Backspace / Delete removes the last point. */
  static undoPoint(): void {
    const c = CurveInput.active;
    if (!c) return;
    c.anchors.pop();
    if (c.anchors.length === 0) CurveInput.cancel();
  }

  static overlay(ctx: CanvasRenderingContext2D, view: OverlayView): void {
    const c = CurveInput.active;
    if (!c) return;
    // Another tool was chosen meanwhile.
    if (getState().tool !== 'ruler') {
      CurveInput.cancel();
      return;
    }
    const anchors: { x: number; y: number; corner?: boolean; out?: Pt }[] = c.hover ? [...c.anchors, { ...c.hover }] : c.anchors;
    const P = (q: Pt) => applyMatrix(view.matrix, q.x, q.y);
    ctx.save();
    ctx.lineWidth = 1;
    if (anchors.length >= 2) {
      const pts = sampleCurve(anchorsToCurve(c.type, anchors));
      ctx.strokeStyle = '#2f80ed';
      ctx.beginPath();
      pts.forEach((q, i) => {
        const s = P(q);
        if (i) ctx.lineTo(s.x, s.y);
        else ctx.moveTo(s.x, s.y);
      });
      ctx.stroke();
    }
    // Direction points of cubic anchors.
    ctx.strokeStyle = 'rgba(47,128,237,0.7)';
    for (const a of c.anchors) {
      if (!a.out) continue;
      const s = P(a);
      const o = P(a.out);
      const b = { x: 2 * s.x - o.x, y: 2 * s.y - o.y };
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(o.x, o.y);
      ctx.stroke();
      for (const h of [o, b]) {
        ctx.beginPath();
        ctx.arc(h.x, h.y, 3, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#2f80ed';
    for (const a of c.anchors) {
      const s = P(a);
      ctx.fillRect(s.x - 3, s.y - 3, 6, 6);
      ctx.strokeRect(s.x - 3, s.y - 3, 6, 6);
    }
    ctx.restore();
  }
}
