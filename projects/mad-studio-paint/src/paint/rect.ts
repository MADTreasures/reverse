/** Integer pixel rectangles (x, y inclusive; w, h may be 0 = empty). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const EMPTY_RECT: Rect = { x: 0, y: 0, w: 0, h: 0 };

export const isEmpty = (r: Rect | null | undefined): boolean => !r || r.w <= 0 || r.h <= 0;

export function union(a: Rect | null, b: Rect | null): Rect | null {
  if (isEmpty(a)) return isEmpty(b) ? null : { ...b! };
  if (isEmpty(b)) return { ...a! };
  const x = Math.min(a!.x, b!.x);
  const y = Math.min(a!.y, b!.y);
  return { x, y, w: Math.max(a!.x + a!.w, b!.x + b!.w) - x, h: Math.max(a!.y + a!.h, b!.y + b!.h) - y };
}

export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

/** Smallest integer rect that covers a circle (plus a 1 px safety margin for anti-aliasing). */
export function circleBounds(cx: number, cy: number, radius: number): Rect {
  const x = Math.floor(cx - radius) - 1;
  const y = Math.floor(cy - radius) - 1;
  return { x, y, w: Math.ceil(cx + radius) + 1 - x + 1, h: Math.ceil(cy + radius) + 1 - y + 1 };
}

/** Integer rect spanning two points (any order). */
export function fromPoints(x0: number, y0: number, x1: number, y1: number): Rect {
  const x = Math.floor(Math.min(x0, x1));
  const y = Math.floor(Math.min(y0, y1));
  return { x, y, w: Math.ceil(Math.max(x0, x1)) - x, h: Math.ceil(Math.max(y0, y1)) - y };
}

export const clampToCanvas = (r: Rect, width: number, height: number) => intersect(r, { x: 0, y: 0, w: width, h: height });
