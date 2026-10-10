/**
 * Magnetic lasso, like the reference's: while lassoing, the path snaps to the drawn lines of the
 * reference layer – to the empty side of their outline, so the lines end up inside the selection.
 * Pure, unit tested.
 */

/** Ink: pixels that are drawn and dark enough (lines on a transparent layer, or dark lines on white). */
export function inkMap(pixels: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const lum = (0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2]) / 255;
    out[i] = (pixels[p + 3] / 255) * (1 - lum) > 0.3 ? 1 : 0;
  }
  return out;
}

/** The outline of the ink on its empty side: pixels without ink next to ink (4-neighbours). */
export function edgeMap(ink: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (ink[i]) continue;
      if ((x > 0 && ink[i - 1]) || (x < width - 1 && ink[i + 1]) || (y > 0 && ink[i - width]) || (y < height - 1 && ink[i + width])) out[i] = 1;
    }
  return out;
}

/** Whether a map has any pixel set. */
export const hasAny = (m: Uint8Array): boolean => m.some((v) => v !== 0);

/**
 * The nearest outline pixel (its centre) within `radius` of (x, y), or the point itself when
 * there is none that close.
 */
export function snapToEdge(edges: Uint8Array, width: number, height: number, x: number, y: number, radius: number): { x: number; y: number } {
  const r = Math.max(0, Math.round(radius));
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let best = Infinity;
  let bx = x;
  let by = y;
  for (let yy = Math.max(0, cy - r); yy <= Math.min(height - 1, cy + r); yy++)
    for (let xx = Math.max(0, cx - r); xx <= Math.min(width - 1, cx + r); xx++) {
      if (!edges[yy * width + xx]) continue;
      const d = (xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2;
      if (d < best && d <= (r + 0.5) ** 2) {
        best = d;
        bx = xx + 0.5;
        by = yy + 0.5;
      }
    }
  return { x: bx, y: by };
}

/** Snap distance in screen pixels for the magnet strength (1 … 5, the reference's indicator). */
export const magnetRadius = (strength: number): number => 6 + Math.max(1, Math.min(5, Math.round(strength))) * 6;
