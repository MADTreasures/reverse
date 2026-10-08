/**
 * Drawing and hit-testing of automation curves, shared by the playlist (clips) and the automation
 * editor window. Mouse model as in FL Studio: right-click adds a point (or opens the point menu on a
 * point), left-drag moves points, dragging the small circle in a segment changes its tension.
 */
import { evaluateAutomation, hasTension, segmentMidValue } from '../../model/automation';
import type { AutomationData, AutomationPoint } from '../../model/types';

export interface CurveView {
  /** Pixel rectangle of the curve area. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Data tick shown at the left edge and pixels per tick. */
  tick0: number;
  pxPerTick: number;
  /** Data length visible (clip length); the curve is clipped to it. */
  visibleTicks: number;
}

export const POINT_R = 4;
export const HANDLE_R = 3;

export function tickToX(v: CurveView, tick: number): number {
  return v.x + (tick - v.tick0) * v.pxPerTick;
}

export function xToTick(v: CurveView, x: number): number {
  return v.tick0 + (x - v.x) / v.pxPerTick;
}

export function valueToY(v: CurveView, value: number): number {
  const pad = Math.min(4, v.h * 0.12);
  return v.y + pad + (1 - value) * (v.h - 2 * pad);
}

export function yToValue(v: CurveView, y: number): number {
  const pad = Math.min(4, v.h * 0.12);
  return Math.min(1, Math.max(0, 1 - (y - v.y - pad) / Math.max(1, v.h - 2 * pad)));
}

/** Middle of segment `index` (ending at point index), where the tension handle sits. */
export function handlePosition(v: CurveView, points: AutomationPoint[], index: number): [number, number] {
  const a = points[index - 1];
  const b = points[index];
  return [tickToX(v, (a.tick + b.tick) / 2), valueToY(v, segmentMidValue(points, index))];
}

export type CurveHit = { kind: 'point'; index: number } | { kind: 'tension'; index: number } | { kind: 'curve' };

/** What is under (px, py): a point, a tension handle or just the curve area. */
export function hitTestCurve(v: CurveView, data: AutomationData, px: number, py: number, showHandles = true): CurveHit | null {
  if (px < v.x - POINT_R || px > v.x + v.w + POINT_R || py < v.y - POINT_R || py > v.y + v.h + POINT_R) return null;
  const pts = data.points;
  let best: CurveHit | null = null;
  let bestD = (POINT_R + 3) ** 2;
  for (let i = 0; i < pts.length; i++) {
    const t = pts[i].tick;
    if (t < v.tick0 - 1 || t > v.tick0 + v.visibleTicks + 1) continue;
    const d = (tickToX(v, t) - px) ** 2 + (valueToY(v, pts[i].value) - py) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = { kind: 'point', index: i };
    }
  }
  if (best) return best;
  if (showHandles) {
    for (let i = 1; i < pts.length; i++) {
      if (!hasTension(pts[i].mode)) continue;
      const [hx, hy] = handlePosition(v, pts, i);
      if ((hx - px) ** 2 + (hy - py) ** 2 <= (HANDLE_R + 4) ** 2) return { kind: 'tension', index: i };
    }
  }
  return { kind: 'curve' };
}

export interface CurveStyle {
  color: string;
  fill?: string;
  lineWidth?: number;
  showPoints?: boolean;
  showHandles?: boolean;
  activePoint?: number | null;
  activeHandle?: number | null;
}

/** Draws the curve (and optionally points and tension handles) clipped to the view rectangle. */
export function drawCurve(ctx: CanvasRenderingContext2D, v: CurveView, data: AutomationData, style: CurveStyle): void {
  const pts = data.points;
  if (pts.length === 0) return;
  const end = v.tick0 + v.visibleTicks;
  const x0 = Math.max(v.x, tickToX(v, v.tick0));
  const x1 = Math.min(v.x + v.w, tickToX(v, end));
  if (x1 <= x0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(v.x, v.y, v.w, v.h);
  ctx.clip();

  // Sample per pixel: exact for every curve type, independent of zoom.
  ctx.beginPath();
  const step = 1;
  let first = true;
  for (let x = x0; x <= x1 + 0.01; x += step) {
    const value = evaluateAutomation(data, Math.min(end, xToTick(v, x)));
    const y = valueToY(v, value);
    if (first) {
      ctx.moveTo(x, y);
      first = false;
    } else ctx.lineTo(x, y);
  }
  if (style.fill) {
    ctx.save();
    ctx.lineTo(x1, v.y + v.h);
    ctx.lineTo(x0, v.y + v.h);
    ctx.closePath();
    ctx.fillStyle = style.fill;
    ctx.fill();
    ctx.restore();
    // Re-trace the outline on top of the fill.
    ctx.beginPath();
    first = true;
    for (let x = x0; x <= x1 + 0.01; x += step) {
      const y = valueToY(v, evaluateAutomation(data, Math.min(end, xToTick(v, x))));
      if (first) {
        ctx.moveTo(x, y);
        first = false;
      } else ctx.lineTo(x, y);
    }
  }
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.lineWidth ?? 1.4;
  ctx.stroke();

  if (style.showHandles) {
    for (let i = 1; i < pts.length; i++) {
      if (!hasTension(pts[i].mode)) continue;
      if (pts[i].tick < v.tick0 || pts[i - 1].tick > end) continue;
      const [hx, hy] = handlePosition(v, pts, i);
      ctx.beginPath();
      ctx.arc(hx, hy, HANDLE_R, 0, Math.PI * 2);
      ctx.strokeStyle = style.color;
      ctx.lineWidth = 1;
      ctx.fillStyle = i === style.activeHandle ? style.color : 'rgba(20,24,28,0.85)';
      ctx.fill();
      ctx.stroke();
    }
  }
  if (style.showPoints) {
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p.tick < v.tick0 - 1 || p.tick > end + 1) continue;
      const px = tickToX(v, p.tick);
      const py = valueToY(v, p.value);
      ctx.beginPath();
      ctx.arc(px, py, POINT_R, 0, Math.PI * 2);
      ctx.fillStyle = i === style.activePoint ? style.color : 'rgba(20,24,28,0.9)';
      ctx.fill();
      ctx.strokeStyle = style.color;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * Tension while dragging a segment's handle by `dy` pixels (positive = up). Like FL Studio, dragging up
 * bends the curve upwards; for stairs/pulse/wave it raises the number of steps or cycles.
 */
export function tensionFromDrag(points: AutomationPoint[], index: number, startTension: number, dy: number): number {
  const a = points[index - 1];
  const b = points[index];
  if (!a || !b) return startTension;
  const periodic = b.mode === 'stairs' || b.mode === 'smoothStairs' || b.mode === 'pulse' || b.mode === 'wave';
  const sign = periodic ? 1 : b.value >= a.value ? -1 : 1;
  return Math.max(-1, Math.min(1, startTension + sign * (dy / 90)));
}
