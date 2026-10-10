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

// ------------------------------------------------------------------ closed areas (Enclose and fill, Leftover pen)

/**
 * Which pixels a closed-area fill treats as fillable (Target color, as in the reference's
 * Advanced fill): transparent ones, white and transparent ones, ones up to half opaque (Treat
 * semi-transparent as transparent), or all colours (each area of one colour on its own).
 */
export type FillTarget = 'transparent' | 'whiteTransparent' | 'semiTransparent' | 'all';

export const FILL_TARGETS: [FillTarget, string][] = [
  ['all', 'Target all colors'],
  ['transparent', 'Only transparent'],
  ['whiteTransparent', 'Only white and transparent'],
  ['semiTransparent', 'Treat semi-transparent as transparent'],
];

/** Area scaling: square or round corners, or up to the darkest (most opaque) pixels of the lines. */
export type ScalingMode = 'rectangle' | 'round' | 'darkest';

export const SCALING_MODES: [ScalingMode, string][] = [
  ['round', 'Round'],
  ['rectangle', 'Rectangle'],
  ['darkest', 'To darkest pixel'],
];

function fillableMap(pixels: Uint8ClampedArray | Uint8Array, n: number, target: FillTarget, tolerance: number): Uint8Array {
  const tol = Math.round((Math.max(0, Math.min(100, tolerance)) / 100) * 255);
  const out = new Uint8Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const a = pixels[i + 3];
    if (target === 'semiTransparent') out[p] = a <= 128 + tol / 2 ? 1 : 0;
    else if (target === 'whiteTransparent') out[p] = a <= tol || (a >= 255 - tol && Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) >= 255 - Math.max(8, tol)) ? 1 : 0;
    else out[p] = a <= tol ? 1 : 0;
  }
  return out;
}

/**
 * Enclose and fill / Leftover pen: every closed area that lies entirely inside `area` (the lasso
 * or the brushed path). Areas that reach outside it – the background around a drawing – stay.
 * Close gap thickens the lines first so that small breaks do not let an area leak.
 */
export function enclosedFillMask(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  area: Mask,
  opts: { target: FillTarget; tolerance: number; closeGap?: number },
): Mask {
  const n = width * height;
  const out = createMask(width, height);
  const gap = Math.max(0, Math.round(opts.closeGap ?? 0));
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  const comp: number[] = [];
  let walls: Mask | null = null;
  let passable: Uint8Array;
  let sameColour: ((a: number, b: number) => boolean) | null = null;
  if (opts.target === 'all') {
    passable = new Uint8Array(n).fill(1);
    const tol = Math.round((Math.max(0, Math.min(100, opts.tolerance)) / 100) * 255);
    sameColour = (a, b) => distance(pixels, a * 4, pixels[b * 4], pixels[b * 4 + 1], pixels[b * 4 + 2], pixels[b * 4 + 3], false) <= tol;
  } else {
    const fillable = fillableMap(pixels, n, opts.target, opts.tolerance);
    passable = fillable;
    if (gap > 0) {
      walls = createMask(width, height);
      for (let p = 0; p < n; p++) walls.data[p] = fillable[p] ? 0 : 255;
      const thick = dilate(walls, gap);
      passable = new Uint8Array(n);
      for (let p = 0; p < n; p++) passable[p] = fillable[p] && !thick.data[p] ? 1 : 0;
    }
  }
  // Seeds: every passable pixel inside the area.
  for (let start = 0; start < n; start++) {
    if (!area.data[start] || seen[start] || !passable[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    comp.length = 0;
    let leaks = false;
    while (head < tail) {
      const p = queue[head++];
      comp.push(p);
      if (!area.data[p]) leaks = true;
      const x = p % width;
      const neighbours = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width];
      for (const q of neighbours) {
        if (q < 0 || q >= n || seen[q] || !passable[q]) continue;
        // All colours: an area is one colour (within the tolerance of where it started).
        if (sameColour && !sameColour(q, start)) continue;
        seen[q] = 1;
        queue[tail++] = q;
      }
    }
    if (leaks) continue;
    for (const p of comp) out.data[p] = 255;
  }
  if (walls && gap > 0) {
    // Grow back towards the real lines (as far as the gap thickened them), never into them.
    const grown = dilate(out, gap);
    for (let p = 0; p < n; p++) if (walls.data[p] || !area.data[p]) grown.data[p] = 0;
    return grown;
  }
  return out;
}

/** How dark a pixel is, 0..255: opacity times darkness (lines are dark and opaque). */
function darkness(pixels: Uint8ClampedArray | Uint8Array, p: number): number {
  const i = p * 4;
  const lum = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
  return (pixels[i + 3] * (255 - lum * 0.75)) / 255;
}

/**
 * Area scaling by `px` pixels. Rectangle grows with a square, Round with a disc; To darkest
 * pixel grows into the lines only uphill, up to their darkest (most opaque) pixels.
 */
export function scaleArea(mask: Mask, px: number, mode: ScalingMode, pixels?: Uint8ClampedArray | Uint8Array): Mask {
  const r = Math.round(px);
  if (r === 0) return { ...mask, data: mask.data.slice() };
  if (mode === 'rectangle') return expandSquare(mask, r);
  if (mode === 'darkest' && r > 0 && pixels) return growToDarkest(mask, r, pixels);
  return expandRound(mask, r);
}

/**
 * Select > Expand / Shrink selected area: by `px` (negative: shrink) with sharp (square) or rounded
 * corners; when shrinking, the canvas edge counts as outside the selection.
 */
export function growSelectionMask(mask: Mask, px: number, corners: 'sharp' | 'rounded'): Mask {
  const r = Math.round(px);
  const mode: ScalingMode = corners === 'rounded' ? 'round' : 'rectangle';
  if (r >= 0) return scaleArea(mask, r, mode);
  const pad = 1 - r;
  const { width: w, height: h } = mask;
  const big = createMask(w + 2 * pad, h + 2 * pad);
  for (let y = 0; y < h; y++) big.data.set(mask.data.subarray(y * w, (y + 1) * w), (y + pad) * big.width + pad);
  const shrunk = scaleArea(big, r, mode);
  const out = createMask(w, h);
  for (let y = 0; y < h; y++) out.data.set(shrunk.data.subarray((y + pad) * big.width + pad, (y + pad) * big.width + pad + w), y * w);
  return out;
}

function expandSquare(mask: Mask, r: number): Mask {
  if (r > 0) return dilate(mask, r);
  const inv = createMask(mask.width, mask.height);
  for (let i = 0; i < inv.data.length; i++) inv.data[i] = mask.data[i] ? 0 : 255;
  const grown = dilate(inv, -r);
  const out = createMask(mask.width, mask.height);
  for (let i = 0; i < out.data.length; i++) out.data[i] = grown.data[i] ? 0 : mask.data[i];
  return out;
}

/** Disc-shaped growing (r > 0) or shrinking (r < 0), by distances to the nearest pixel of the other side. */
function expandRound(mask: Mask, r: number): Mask {
  const { width: w, height: h } = mask;
  const grow = r > 0;
  const rr = Math.abs(r);
  const out = createMask(w, h);
  // Squared distance to the nearest set (growing) or unset (shrinking) pixel, row then column.
  const INF = 1e9;
  const d = new Float64Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = (mask.data[i] ? 1 : 0) === (grow ? 1 : 0) ? 0 : INF;
  const f = new Float64Array(Math.max(w, h));
  const lineDt = (get: (k: number) => number, set: (k: number, v: number) => void, len: number) => {
    // Brute force within the radius is enough (r is small).
    for (let k = 0; k < len; k++) f[k] = get(k);
    for (let k = 0; k < len; k++) {
      let best = f[k];
      for (let j = Math.max(0, k - rr); j <= Math.min(len - 1, k + rr); j++) best = Math.min(best, f[j] + (j - k) * (j - k));
      set(k, best);
    }
  };
  for (let y = 0; y < h; y++) lineDt((x) => (d[y * w + x] === 0 ? 0 : INF), (x, v) => (d[y * w + x] = v), w);
  for (let x = 0; x < w; x++) lineDt((y) => d[y * w + x], (y, v) => (d[y * w + x] = v), h);
  const lim = rr * rr;
  for (let i = 0; i < d.length; i++) {
    const near = d[i] <= lim;
    out.data[i] = grow ? (mask.data[i] || near ? 255 : 0) : mask.data[i] && !near ? mask.data[i] : 0;
  }
  return out;
}

function growToDarkest(mask: Mask, steps: number, pixels: Uint8ClampedArray | Uint8Array): Mask {
  const { width: w, height: h } = mask;
  const out = { ...mask, data: mask.data.slice() };
  let frontier: number[] = [];
  for (let p = 0; p < w * h; p++) if (out.data[p]) frontier.push(p);
  for (let s = 0; s < steps && frontier.length; s++) {
    const next: number[] = [];
    for (const p of frontier) {
      const dp = darkness(pixels, p);
      const x = p % w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
        if (q < 0 || q >= w * h || out.data[q]) continue;
        // Only uphill (towards the line's core); never past its darkest pixel.
        if (darkness(pixels, q) + 4 < dp) continue;
        out.data[q] = 255;
        next.push(q);
      }
    }
    frontier = next;
  }
  return out;
}

/**
 * Selection > Shrink selection: the lassoed area shrinks onto the drawing inside it – the empty
 * space (target colour) that connects to the outside of the lasso drops out; the lines and the
 * closed areas they enclose stay selected.
 */
export function shrinkToDrawing(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  area: Mask,
  opts: { target: FillTarget; tolerance: number; closeGap?: number },
): Mask {
  const n = width * height;
  const target: FillTarget = opts.target === 'all' ? 'transparent' : opts.target;
  const fillable = fillableMap(pixels, n, target, opts.tolerance);
  const gap = Math.max(0, Math.round(opts.closeGap ?? 0));
  let passable = fillable;
  let walls: Mask | null = null;
  if (gap > 0) {
    walls = createMask(width, height);
    for (let p = 0; p < n; p++) walls.data[p] = fillable[p] ? 0 : 255;
    const thick = dilate(walls, gap);
    passable = new Uint8Array(n);
    for (let p = 0; p < n; p++) passable[p] = fillable[p] && !thick.data[p] ? 1 : 0;
  }
  // The empty space reachable from outside the lasso (or from the canvas edge).
  let outside = createMask(width, height);
  const queue = new Int32Array(n);
  let tail = 0;
  for (let p = 0; p < n; p++) {
    const x = p % width;
    const y = (p / width) | 0;
    const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
    if (passable[p] && (!area.data[p] || edge)) {
      outside.data[p] = 255;
      queue[tail++] = p;
    }
  }
  for (let head = 0; head < tail; head++) {
    const p = queue[head];
    const x = p % width;
    for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width]) {
      if (q < 0 || q >= n || outside.data[q] || !passable[q]) continue;
      outside.data[q] = 255;
      queue[tail++] = q;
    }
  }
  if (walls && gap > 0) {
    // The thickened lines give back their margin to the empty space.
    const grown = dilate(outside, gap);
    for (let p = 0; p < n; p++) if (walls.data[p]) grown.data[p] = 0;
    outside = grown;
  }
  const out = createMask(width, height);
  for (let p = 0; p < n; p++) out.data[p] = area.data[p] && !outside.data[p] ? 255 : 0;
  return out;
}
