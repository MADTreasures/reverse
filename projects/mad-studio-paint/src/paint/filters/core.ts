/**
 * Building blocks of the Filter menu: images as straight RGBA bytes, premultiplied float copies
 * for averaging (transparent pixels add no colour), bilinear sampling with edge modes, box and
 * Gaussian blurs and a seeded random generator. Everything is pure and works without a DOM, so
 * the filters run the same in a worker, in the tests and on the main thread.
 */

/** Straight (not premultiplied) RGBA pixels, like ImageData. */
export interface Img {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What is sampled outside the image: nothing, the nearest edge pixel or the opposite edge. */
export type Edge = 'transparent' | 'clamp' | 'wrap';

/** Premultiplied RGBA floats (0..255), with the size and the position of their top-left pixel. */
export interface Float {
  f: Float32Array;
  w: number;
  h: number;
}

export function createImg(width: number, height: number): Img {
  return { data: new Uint8ClampedArray(width * height * 4), width, height };
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Rec. 601 luma of 0..255 channels. */
export const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** The part of `src` inside `r` (outside the image it is transparent). */
export function cropImg(src: Img, r: Rect): Img {
  const out = createImg(r.w, r.h);
  const x0 = Math.max(0, r.x);
  const x1 = Math.min(src.width, r.x + r.w);
  if (x1 <= x0) return out;
  for (let y = Math.max(0, r.y); y < Math.min(src.height, r.y + r.h); y++) {
    const from = (y * src.width + x0) * 4;
    out.data.set(src.data.subarray(from, from + (x1 - x0) * 4), ((y - r.y) * r.w + (x0 - r.x)) * 4);
  }
  return out;
}

/** `r` grown by `by` pixels on every side and kept inside a w × h image. */
export function growRect(r: Rect, by: number, w: number, h: number): Rect {
  const x = Math.max(0, Math.floor(r.x - by));
  const y = Math.max(0, Math.floor(r.y - by));
  return { x, y, w: Math.max(0, Math.min(w, Math.ceil(r.x + r.w + by)) - x), h: Math.max(0, Math.min(h, Math.ceil(r.y + r.h + by)) - y) };
}

/** Bounds of the pixels that are not fully transparent, or null for an empty image. */
export function contentRect(img: Img): Rect | null {
  const { data, width, height } = img;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    let row = y * width * 4 + 3;
    for (let x = 0; x < width; x++, row += 4) {
      if (data[row] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function premultiply(src: Img): Float {
  const d = src.data;
  const f = new Float32Array(d.length);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a === 0) continue;
    const k = a / 255;
    f[i] = d[i] * k;
    f[i + 1] = d[i + 1] * k;
    f[i + 2] = d[i + 2] * k;
    f[i + 3] = a;
  }
  return { f, w: src.width, h: src.height };
}

export function unpremultiply(src: Float): Img {
  const { f } = src;
  const out = createImg(src.w, src.h);
  const d = out.data;
  for (let i = 0; i < f.length; i += 4) {
    const a = f[i + 3];
    if (a < 0.5) continue;
    const k = 255 / a;
    // Uint8ClampedArray rounds on assignment.
    d[i] = f[i] * k;
    d[i + 1] = f[i + 1] * k;
    d[i + 2] = f[i + 2] * k;
    d[i + 3] = a;
  }
  return out;
}

/**
 * Bilinear sample at (x, y) in pixel units (pixel i covers i..i+1, its centre is i + 0.5),
 * written premultiplied to out[o..o+3].
 */
export function sample(src: Float, x: number, y: number, edge: Edge, out: Float32Array, o = 0): void {
  const { f, w, h } = src;
  let fx = x - 0.5;
  let fy = y - 0.5;
  if (edge === 'transparent' && (fx <= -1 || fy <= -1 || fx >= w || fy >= h)) {
    out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
    return;
  }
  if (edge === 'wrap') {
    fx = ((fx % w) + w) % w;
    fy = ((fy % h) + h) % h;
  }
  let x0 = Math.floor(fx);
  let y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  let x1 = x0 + 1;
  let y1 = y0 + 1;
  let wx0 = 1 - tx;
  let wx1 = tx;
  let wy0 = 1 - ty;
  let wy1 = ty;
  if (edge === 'transparent') {
    if (x0 < 0) (x0 = 0), (wx0 = 0);
    if (x1 >= w) (x1 = w - 1), (wx1 = 0);
    if (y0 < 0) (y0 = 0), (wy0 = 0);
    if (y1 >= h) (y1 = h - 1), (wy1 = 0);
  } else if (edge === 'wrap') {
    if (x1 >= w) x1 -= w;
    if (y1 >= h) y1 -= h;
  } else {
    x0 = x0 < 0 ? 0 : x0 >= w ? w - 1 : x0;
    x1 = x1 < 0 ? 0 : x1 >= w ? w - 1 : x1;
    y0 = y0 < 0 ? 0 : y0 >= h ? h - 1 : y0;
    y1 = y1 < 0 ? 0 : y1 >= h ? h - 1 : y1;
  }
  const p00 = (y0 * w + x0) * 4;
  const p10 = (y0 * w + x1) * 4;
  const p01 = (y1 * w + x0) * 4;
  const p11 = (y1 * w + x1) * 4;
  const w00 = wx0 * wy0;
  const w10 = wx1 * wy0;
  const w01 = wx0 * wy1;
  const w11 = wx1 * wy1;
  out[o] = f[p00] * w00 + f[p10] * w10 + f[p01] * w01 + f[p11] * w11;
  out[o + 1] = f[p00 + 1] * w00 + f[p10 + 1] * w10 + f[p01 + 1] * w01 + f[p11 + 1] * w11;
  out[o + 2] = f[p00 + 2] * w00 + f[p10 + 2] * w10 + f[p01 + 2] * w01 + f[p11 + 2] * w11;
  out[o + 3] = f[p00 + 3] * w00 + f[p10 + 3] * w10 + f[p01 + 3] * w01 + f[p11 + 3] * w11;
}

/**
 * Builds the output rectangle `rect` of `src` by asking `map` where each output pixel centre comes
 * from (written to pt[0], pt[1]); a false return leaves the pixel transparent.
 */
export function remap(src: Img, rect: Rect, edge: Edge, map: (x: number, y: number, pt: Float64Array) => boolean): Img {
  const pre = premultiply(src);
  const out: Float = { f: new Float32Array(rect.w * rect.h * 4), w: rect.w, h: rect.h };
  const pt = new Float64Array(2);
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      if (!map(rect.x + x + 0.5, rect.y + y + 0.5, pt)) continue;
      sample(pre, pt[0], pt[1], edge, out.f, (y * rect.w + x) * 4);
    }
  }
  return unpremultiply(out);
}

/** One pass of a box blur along rows (dx = 1) or columns, radius r (fractions weight the outer taps); edges repeat. */
function boxPass(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, horizontal: boolean): void {
  const n = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const step = horizontal ? 4 : w * 4;
  const ri = Math.floor(r);
  const frac = r - ri;
  const norm = 1 / (2 * r + 1);
  const at = (base: number, i: number) => base + (i < 0 ? 0 : i >= n ? n - 1 : i) * step;
  for (let line = 0; line < lines; line++) {
    const base = horizontal ? line * w * 4 : line * 4;
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let i = -ri; i <= ri; i++) sum += src[at(base, i) + c];
      for (let i = 0; i < n; i++) {
        const edgeTaps = frac > 0 ? (src[at(base, i - ri - 1) + c] + src[at(base, i + ri + 1) + c]) * frac : 0;
        dst[base + i * step + c] = (sum + edgeTaps) * norm;
        sum += src[at(base, i + ri + 1) + c] - src[at(base, i - ri) + c];
      }
    }
  }
}

/** Box blur of radius r (box width 2r + 1) in both directions. */
export function boxBlur(src: Float, r: number): Float {
  if (r <= 0) return { ...src, f: src.f.slice() };
  const tmp = new Float32Array(src.f.length);
  const out = new Float32Array(src.f.length);
  boxPass(src.f, tmp, src.w, src.h, r, true);
  boxPass(tmp, out, src.w, src.h, r, false);
  return { f: out, w: src.w, h: src.h };
}

/** Separable convolution with a symmetric kernel (k[0] is the centre); edges repeat. */
export function convolveSymmetric(src: Float, k: number[]): Float {
  const { w, h } = src;
  const tmp = new Float32Array(src.f.length);
  const out = new Float32Array(src.f.length);
  const r = k.length - 1;
  const run = (from: Float32Array, to: Float32Array, horizontal: boolean) => {
    const n = horizontal ? w : h;
    const lines = horizontal ? h : w;
    const step = horizontal ? 4 : w * 4;
    for (let line = 0; line < lines; line++) {
      const base = horizontal ? line * w * 4 : line * 4;
      for (let i = 0; i < n; i++) {
        let r0 = 0;
        let g0 = 0;
        let b0 = 0;
        let a0 = 0;
        for (let j = -r; j <= r; j++) {
          const t = i + j;
          const p = base + (t < 0 ? 0 : t >= n ? n - 1 : t) * step;
          const kw = k[j < 0 ? -j : j];
          r0 += from[p] * kw;
          g0 += from[p + 1] * kw;
          b0 += from[p + 2] * kw;
          a0 += from[p + 3] * kw;
        }
        const q = base + i * step;
        to[q] = r0;
        to[q + 1] = g0;
        to[q + 2] = b0;
        to[q + 3] = a0;
      }
    }
  };
  run(src.f, tmp, true);
  run(tmp, out, false);
  return { f: out, w, h };
}

/** Gaussian blur with standard deviation sigma: an exact kernel for small sigma, else three box blurs. */
export function gaussianBlur(src: Float, sigma: number): Float {
  if (sigma < 0.05) return { ...src, f: src.f.slice() };
  if (sigma <= 3) {
    const r = Math.ceil(sigma * 3);
    const k: number[] = [];
    let sum = 0;
    for (let i = 0; i <= r; i++) {
      k.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
      sum += i === 0 ? k[i] : 2 * k[i];
    }
    return convolveSymmetric(
      src,
      k.map((v) => v / sum),
    );
  }
  // Three box blurs with the same variance: each box of radius r has variance r(r + 1)/3.
  const r = (Math.sqrt(1 + 4 * sigma * sigma) - 1) / 2;
  return boxBlur(boxBlur(boxBlur(src, r), r), r);
}

/** How far a Gaussian of this sigma reaches, in pixels. */
export const gaussianReach = (sigma: number) => Math.ceil(sigma * 3) + 2;

/** Mulberry32: a small seeded generator, so previews and the result match. */
export function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A repeatable value in 0..1 for a pixel position (noise that stays put when the preview reruns). */
export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
