/** View > Grid: the grid lines over the canvas (main lines darker than the subdivisions). */
import type { PaintDocument } from '../model/types';
import { gridLines, gridOrigin, type GridSettings } from '../paint/grid';
import { apply as applyMatrix, invert } from '../paint/viewMath';
import type { OverlayView } from './types';

/** Lines closer than this on screen are left out (too dense to help). */
const MIN_SPACING_PX = 5;

export function drawGrid(ctx: CanvasRenderingContext2D, view: OverlayView, doc: PaintDocument, g: GridSettings, viewport: { w: number; h: number }): void {
  const { width: W, height: H } = doc;
  const inv = invert(view.matrix);
  // The part of the canvas in view.
  const corners = [
    [0, 0],
    [viewport.w, 0],
    [viewport.w, viewport.h],
    [0, viewport.h],
  ].map(([x, y]) => applyMatrix(inv, x, y));
  const x0 = Math.max(0, Math.min(...corners.map((c) => c.x)));
  const x1 = Math.min(W, Math.max(...corners.map((c) => c.x)));
  const y0 = Math.max(0, Math.min(...corners.map((c) => c.y)));
  const y1 = Math.min(H, Math.max(...corners.map((c) => c.y)));
  if (x1 <= x0 || y1 <= y0) return;
  const zoom = view.zoom;
  const sub = g.gap / Math.max(1, g.divisions);
  const showSub = sub * zoom >= MIN_SPACING_PX && g.divisions > 1;
  if (g.gap * zoom < MIN_SPACING_PX) return;
  const o = gridOrigin(g, W, H);
  const crisp = (v: number) => Math.round(v) + 0.5;
  ctx.save();
  ctx.lineWidth = 1;
  for (const major of [false, true]) {
    if (!major && !showSub) continue;
    ctx.strokeStyle = major ? 'rgba(70, 90, 130, 0.55)' : 'rgba(70, 90, 130, 0.22)';
    ctx.beginPath();
    for (const l of gridLines(o.x, g.gap, g.divisions, x0, x1)) {
      if (l.major !== major) continue;
      const a = applyMatrix(view.matrix, l.pos, y0);
      const b = applyMatrix(view.matrix, l.pos, y1);
      const straight = Math.abs(a.x - b.x) < 0.01;
      ctx.moveTo(straight ? crisp(a.x) : a.x, a.y);
      ctx.lineTo(straight ? crisp(b.x) : b.x, b.y);
    }
    for (const l of gridLines(o.y, g.gap, g.divisions, y0, y1)) {
      if (l.major !== major) continue;
      const a = applyMatrix(view.matrix, x0, l.pos);
      const b = applyMatrix(view.matrix, x1, l.pos);
      const straight = Math.abs(a.y - b.y) < 0.01;
      ctx.moveTo(a.x, straight ? crisp(a.y) : a.y);
      ctx.lineTo(b.x, straight ? crisp(b.y) : b.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}
