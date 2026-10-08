/** Flood fill ("bucket") on RGBA pixel data. Pure, unit tested. */
import { createMask, type Mask } from './mask';

export interface FillOptions {
  /** 0..100 – how different a pixel may be from the seed colour and still be filled. */
  tolerance: number;
  /** Only test alpha (useful for line art on transparent layers). */
  alphaOnly?: boolean;
  /** Fill all matching pixels, not just the connected area. */
  contiguous?: boolean;
  /** Treat gaps in the outline up to about twice this many pixels as closed. */
  closeGap?: number;
}

/** Gap sizes (px) for the five "close gap" steps of the fill settings. */
export const CLOSE_GAP_STEPS = [0, 1, 2, 4, 7, 12];

/** Colour distance 0..255: the largest channel difference; fully transparent pixels compare equal. */
function distance(d: Uint8ClampedArray | Uint8Array, i: number, r: number, g: number, b: number, a: number, alphaOnly: boolean): number {
  const pa = d[i + 3];
  if (alphaOnly) return Math.abs(pa - a);
  if (pa === 0 && a === 0) return 0;
  return Math.max(Math.abs(d[i] - r), Math.abs(d[i + 1] - g), Math.abs(d[i + 2] - b), Math.abs(pa - a));
}

/**
 * Returns a mask of the region around (sx, sy) whose colours are within `tolerance` of the seed.
 * Uses a scanline stack fill (no recursion, linear memory).
 */
export function floodFillMask(pixels: Uint8ClampedArray | Uint8Array, width: number, height: number, sx: number, sy: number, opts: FillOptions): Mask {
  const gap = Math.max(0, Math.round(opts.closeGap ?? 0));
  if (gap > 0 && opts.contiguous !== false) {
    const closed = closedGapFill(pixels, width, height, sx, sy, opts, gap);
    if (closed) return closed;
  }
  return plainFill(pixels, width, height, sx, sy, opts);
}

/**
 * Gap closing: thicken the "walls" (pixels that do not match the seed) by `gap` pixels so that
 * small breaks in an outline close, flood fill between the thick walls, then grow the result
 * back by `gap` pixels without crossing the original walls.
 * Returns null when the seed itself is swallowed by the thickened walls (then a plain fill is used).
 */
function closedGapFill(pixels: Uint8ClampedArray | Uint8Array, width: number, height: number, sx: number, sy: number, opts: FillOptions, gap: number): Mask | null {
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  if (x0 < 0 || y0 < 0 || x0 >= width || y0 >= height) return createMask(width, height);
  // Pixels that match the seed (everything plainFill could reach if it were not contiguous).
  const open = plainFill(pixels, width, height, x0, y0, { ...opts, contiguous: false });
  const walls = createMask(width, height);
  for (let i = 0; i < walls.data.length; i++) walls.data[i] = open.data[i] ? 0 : 255;
  const thick = dilate(walls, gap);
  if (thick.data[y0 * width + x0]) return null;
  // Flood fill the space between the thickened walls.
  const passable = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < thick.data.length; i++) passable[i * 4 + 3] = thick.data[i] ? 255 : 0;
  const inner = plainFill(passable, width, height, x0, y0, { tolerance: 0, alphaOnly: true });
  // Grow back towards the real walls, but never into them.
  const grown = dilate(inner, gap);
  for (let i = 0; i < grown.data.length; i++) if (walls.data[i]) grown.data[i] = 0;
  return grown;
}

/** Square-kernel dilation (separable max filter). */
function dilate(m: Mask, r: number): Mask {
  const { width: w, height: h } = m;
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    // Sliding window maximum along the row: track distance to the last set pixel.
    let last = -Infinity;
    for (let x = 0; x < w; x++) {
      if (m.data[row + x]) last = x;
      if (x - last <= r) tmp[row + x] = 255;
    }
    last = Infinity;
    for (let x = w - 1; x >= 0; x--) {
      if (m.data[row + x]) last = x;
      if (last - x <= r) tmp[row + x] = 255;
    }
  }
  const out = createMask(w, h);
  for (let x = 0; x < w; x++) {
    let last = -Infinity;
    for (let y = 0; y < h; y++) {
      if (tmp[y * w + x]) last = y;
      if (y - last <= r) out.data[y * w + x] = 255;
    }
    last = Infinity;
    for (let y = h - 1; y >= 0; y--) {
      if (tmp[y * w + x]) last = y;
      if (last - y <= r) out.data[y * w + x] = 255;
    }
  }
  return out;
}

function plainFill(pixels: Uint8ClampedArray | Uint8Array, width: number, height: number, sx: number, sy: number, opts: FillOptions): Mask {
  const mask = createMask(width, height);
  sx = Math.floor(sx);
  sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return mask;
  const s = (sy * width + sx) * 4;
  const r = pixels[s];
  const g = pixels[s + 1];
  const b = pixels[s + 2];
  const a = pixels[s + 3];
  const limit = Math.round((Math.max(0, Math.min(100, opts.tolerance)) / 100) * 255);
  const alphaOnly = Boolean(opts.alphaOnly);
  const match = (p: number) => distance(pixels, p * 4, r, g, b, a, alphaOnly) <= limit;

  if (opts.contiguous === false) {
    for (let p = 0; p < width * height; p++) if (match(p)) mask.data[p] = 255;
    return mask;
  }

  const seen = mask.data;
  const stack: number[] = [sx, sy];
  while (stack.length) {
    const y = stack.pop()!;
    let x = stack.pop()!;
    let p = y * width + x;
    if (seen[p] || !match(p)) continue;
    // Walk left to the start of the run.
    while (x > 0 && !seen[p - 1] && match(p - 1)) {
      x--;
      p--;
    }
    let upOpen = false;
    let downOpen = false;
    for (; x < width && !seen[p] && match(p); x++, p++) {
      seen[p] = 255;
      if (y > 0) {
        const up = p - width;
        const ok = !seen[up] && match(up);
        if (ok && !upOpen) stack.push(x, y - 1);
        upOpen = ok;
      }
      if (y < height - 1) {
        const down = p + width;
        const ok = !seen[down] && match(down);
        if (ok && !downOpen) stack.push(x, y + 1);
        downOpen = ok;
      }
    }
  }
  return mask;
}
