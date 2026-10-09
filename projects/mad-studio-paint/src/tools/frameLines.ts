/**
 * Animation frame lines on the canvas (View > Crop marks/Inner border): the output frame with marks
 * at the middle of its sides and its centre, the title-safe area (rounded corners) and the overflow
 * frame, as thin blue lines like the reference's.
 */
import { safeRect, type FrameRect, type OutputFrame } from '../paint/outputFrame';
import { apply as applyMatrix } from '../paint/viewMath';
import type { OverlayView } from './types';

const COLOR = '#6a6ae0';

function corners(view: OverlayView, r: FrameRect): { x: number; y: number }[] {
  return [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x + r.w, r.y + r.h],
    [r.x, r.y + r.h],
  ].map(([x, y]) => applyMatrix(view.matrix, x, y));
}

function outline(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], radius = 0): void {
  ctx.beginPath();
  if (radius <= 0) {
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
  } else {
    // Rounded corners: start halfway along the last side.
    const last = pts[3];
    ctx.moveTo((last.x + pts[0].x) / 2, (last.y + pts[0].y) / 2);
    for (let i = 0; i < 4; i++) ctx.arcTo(pts[i].x, pts[i].y, pts[(i + 1) % 4].x, pts[(i + 1) % 4].y, radius);
    ctx.closePath();
  }
  ctx.stroke();
}

export function drawFrameLines(ctx: CanvasRenderingContext2D, view: OverlayView, f: OutputFrame): void {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = COLOR;
  if (f.overflow) outline(ctx, corners(view, f.overflow));
  const out = corners(view, f);
  outline(ctx, out);
  // Marks at the middle of each side, pointing out, and a cross at the centre.
  const c = applyMatrix(view.matrix, f.x + f.w / 2, f.y + f.h / 2);
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = out[i];
    const b = out[(i + 1) % 4];
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const len = Math.hypot(m.x - c.x, m.y - c.y) || 1;
    ctx.moveTo(m.x - ((m.x - c.x) / len) * 6, m.y - ((m.y - c.y) / len) * 6);
    ctx.lineTo(m.x + ((m.x - c.x) / len) * 6, m.y + ((m.y - c.y) / len) * 6);
  }
  ctx.moveTo(c.x - 5, c.y);
  ctx.lineTo(c.x + 5, c.y);
  ctx.moveTo(c.x, c.y - 5);
  ctx.lineTo(c.x, c.y + 5);
  ctx.stroke();
  const safe = safeRect(f);
  if (safe && safe.w > 0 && safe.h > 0) {
    ctx.globalAlpha = 0.75;
    outline(ctx, corners(view, safe), 6);
  }
  ctx.restore();
}
