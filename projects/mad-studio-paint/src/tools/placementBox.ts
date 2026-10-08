/**
 * A box for placing something without changing it (keyframes, the 2D camera frame, light table
 * layers): drag inside to move, a corner to scale (⇧ frees the aspect ratio, if allowed), the round
 * handle above to rotate (⇧ in 15° steps) and, where there is one, the centre point to move the
 * centre of rotation.
 */
import { applyAffine, movePivot, placementMatrix, type Placement } from '../paint/keyframes';
import type { Rect } from '../paint/rect';
import { apply as applyMatrix } from '../paint/viewMath';
import type { Modifiers, OverlayView, PointerInfo } from './types';

const HANDLE_PX = 8;
const ROTATE_PX = 22;

export type BoxHandle = { kind: 'scale'; corner: number } | { kind: 'rotate' } | { kind: 'pivot' } | { kind: 'move' };

export interface Box {
  /** Top left, top right, bottom right, bottom left (document px). */
  corners: { x: number; y: number }[];
  /** The centre of rotation where it is shown. */
  pivot: { x: number; y: number };
}

/** The rectangle `rect` placed. */
export function boxOf(p: Placement, rect: Rect): Box {
  const m = placementMatrix(p);
  const corners = [
    [rect.x, rect.y],
    [rect.x + rect.w, rect.y],
    [rect.x + rect.w, rect.y + rect.h],
    [rect.x, rect.y + rect.h],
  ].map(([x, y]) => applyAffine(m, x, y));
  return { corners, pivot: applyAffine(m, p.pivotX, p.pivotY) };
}

/** Screen position of the rotation handle: above the middle of the top edge. */
function rotateHandle(b: Box, view: OverlayView): { x: number; y: number } {
  const top = applyMatrix(view.matrix, (b.corners[0].x + b.corners[1].x) / 2, (b.corners[0].y + b.corners[1].y) / 2);
  const mid = applyMatrix(view.matrix, (b.corners[0].x + b.corners[2].x) / 2, (b.corners[0].y + b.corners[2].y) / 2);
  const len = Math.hypot(top.x - mid.x, top.y - mid.y);
  const dir = len > 1e-6 ? { x: (top.x - mid.x) / len, y: (top.y - mid.y) / len } : { x: 0, y: -1 };
  return { x: top.x + dir.x * ROTATE_PX, y: top.y + dir.y * ROTATE_PX };
}

/** Whether a point lies in the (convex) box. */
function inside(b: Box, x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = b.corners[i];
    const c = b.corners[(i + 1) % 4];
    const cross = (c.x - a.x) * (y - a.y) - (c.y - a.y) * (x - a.x);
    if (Math.abs(cross) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

export function hitBox(p: PointerInfo, view: OverlayView, b: Box, pivot = true): BoxHandle | null {
  if (pivot) {
    const pv = applyMatrix(view.matrix, b.pivot.x, b.pivot.y);
    if (Math.hypot(pv.x - p.sx, pv.y - p.sy) <= HANDLE_PX) return { kind: 'pivot' };
  }
  for (let corner = 0; corner < 4; corner++) {
    const q = applyMatrix(view.matrix, b.corners[corner].x, b.corners[corner].y);
    if (Math.abs(q.x - p.sx) <= HANDLE_PX && Math.abs(q.y - p.sy) <= HANDLE_PX) return { kind: 'scale', corner };
  }
  const r = rotateHandle(b, view);
  if (Math.hypot(r.x - p.sx, r.y - p.sy) <= HANDLE_PX) return { kind: 'rotate' };
  return inside(b, p.x, p.y) ? { kind: 'move' } : null;
}

export const boxCursor = (h: BoxHandle): string => (h.kind === 'move' ? 'move' : h.kind === 'rotate' ? 'alias' : h.kind === 'pivot' ? 'crosshair' : 'nwse-resize');

const clampScale = (s: number) => (Math.abs(s) < 0.01 ? 0.01 * (Math.sign(s) || 1) : Math.min(100, Math.max(-100, s)));

/** The placement after dragging `handle` from `start` to `p` (`free`: ⇧ may change the aspect ratio). */
export function dragPlacement(base: Placement, handle: BoxHandle, start: { x: number; y: number }, p: { x: number; y: number }, m: Modifiers, free = true): Placement {
  const centre = { x: base.pivotX + base.x, y: base.pivotY + base.y };
  switch (handle.kind) {
    case 'move': {
      let dx = p.x - start.x;
      let dy = p.y - start.y;
      if (m.shift) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      return { ...base, x: base.x + dx, y: base.y + dy };
    }
    case 'pivot':
      return movePivot(base, base.pivotX + p.x - start.x, base.pivotY + p.y - start.y);
    case 'rotate': {
      let a = ((Math.atan2(p.y - centre.y, p.x - centre.x) - Math.atan2(start.y - centre.y, start.x - centre.x)) * 180) / Math.PI;
      if (m.shift) a = Math.round(a / 15) * 15;
      return { ...base, rotation: Math.round((base.rotation + a) * 100) / 100 };
    }
    case 'scale': {
      // In the box's own (unrotated) directions, from the centre of rotation.
      const r = (-base.rotation * Math.PI) / 180;
      const local = (x: number, y: number) => ({ x: (x - centre.x) * Math.cos(r) - (y - centre.y) * Math.sin(r), y: (x - centre.x) * Math.sin(r) + (y - centre.y) * Math.cos(r) });
      const v0 = local(start.x, start.y);
      const v = local(p.x, p.y);
      let kx = Math.abs(v0.x) > 1 ? v.x / v0.x : 1;
      let ky = Math.abs(v0.y) > 1 ? v.y / v0.y : 1;
      if (!(m.shift && free)) {
        const k = (v.x * v0.x + v.y * v0.y) / Math.max(1e-6, v0.x * v0.x + v0.y * v0.y);
        kx = k;
        ky = k;
      }
      return { ...base, scaleX: clampScale(base.scaleX * kx), scaleY: clampScale(base.scaleY * ky) };
    }
  }
}

/** The box, its handles and (if shown) its centre of rotation. */
export function drawBox(ctx: CanvasRenderingContext2D, view: OverlayView, b: Box, style: { color: string; width?: number; dashed?: boolean; pivot?: boolean }): void {
  const pts = b.corners.map((c) => applyMatrix(view.matrix, c.x, c.y));
  ctx.save();
  ctx.lineWidth = style.width ?? 1;
  ctx.strokeStyle = style.color;
  if (style.dashed) ctx.setLineDash([4, 3]);
  ctx.beginPath();
  pts.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  const topMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  const rot = rotateHandle(b, view);
  ctx.beginPath();
  ctx.moveTo(topMid.x, topMid.y);
  ctx.lineTo(rot.x, rot.y);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  for (const c of pts) {
    ctx.fillRect(c.x - 4, c.y - 4, 8, 8);
    ctx.strokeRect(c.x - 4, c.y - 4, 8, 8);
  }
  ctx.beginPath();
  ctx.arc(rot.x, rot.y, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (style.pivot !== false) {
    const pv = applyMatrix(view.matrix, b.pivot.x, b.pivot.y);
    ctx.beginPath();
    ctx.arc(pv.x, pv.y, 5, 0, Math.PI * 2);
    ctx.moveTo(pv.x - 8, pv.y);
    ctx.lineTo(pv.x + 8, pv.y);
    ctx.moveTo(pv.x, pv.y - 8);
    ctx.lineTo(pv.x, pv.y + 8);
    ctx.stroke();
  }
  ctx.restore();
}
