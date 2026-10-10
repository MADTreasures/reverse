/**
 * Filter > Blur and Filter > Sharpen. The reference names the filters and their settings but not
 * the maths; these are our own standard models. Long directional blurs (motion, radial, spin) use
 * repeated halving: each pass averages the image with a shifted, scaled or rotated copy of itself,
 * so n passes give 2ⁿ evenly spaced samples.
 */
import {
  clamp,
  convolveSymmetric,
  createImg,
  gaussianBlur as gaussianF,
  luma,
  premultiply,
  sample,
  smoothstep,
  unpremultiply,
  type Float,
  type Img,
} from './core';

/** Blur: 3 × 3 binomial average. */
export const blur = (src: Img): Img => unpremultiply(convolveSymmetric(premultiply(src), [0.5, 0.25]));

/** Blur (strong): 5 × 5 binomial average. */
export const blurStrong = (src: Img): Img => unpremultiply(convolveSymmetric(premultiply(src), [0.375, 0.25, 0.0625]));

/** Gaussian blur; the strength is twice the standard deviation in pixels. */
export const gaussianBlur = (src: Img, strength: number): Img => unpremultiply(gaussianF(premultiply(src), strength / 2));

/**
 * Smoothing: anti-aliases jagged edges. Pixels whose neighbours differ strongly (in colour or
 * transparency) take on part of their 3 × 3 average; flat areas stay as they are.
 */
export function smoothing(src: Img): Img {
  const pre = premultiply(src);
  const avg = convolveSymmetric(pre, [0.5, 0.25]);
  const { w, h } = pre;
  const f = pre.f;
  const out = new Float32Array(f.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      let diff = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy < 0 ? 0 : y + dy >= h ? h - 1 : y + dy;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx < 0 ? 0 : x + dx >= w ? w - 1 : x + dx;
          const q = (yy * w + xx) * 4;
          for (let c = 0; c < 4; c++) diff = Math.max(diff, Math.abs(f[q + c] - f[p + c]));
        }
      }
      const t = 0.75 * smoothstep(24, 96, diff);
      for (let c = 0; c < 4; c++) out[p + c] = f[p + c] + (avg.f[p + c] - f[p + c]) * t;
    }
  }
  return unpremultiply({ f: out, w, h });
}

export type BlurDirection = 'both' | 'forward' | 'backward';
export type BlurMode = 'box' | 'smooth';

/** A pass: output = average of the input at two mapped positions (layer coordinates). */
type Map2 = (x: number, y: number, out: Float64Array) => void;

function halvingPasses(src: Float, ox: number, oy: number, passes: [Map2, Map2][]): Float {
  let cur = src;
  const a = new Float32Array(4);
  const b = new Float32Array(4);
  const pa = new Float64Array(2);
  const pb = new Float64Array(2);
  for (const [ma, mb] of passes) {
    const next = new Float32Array(cur.f.length);
    for (let y = 0; y < cur.h; y++) {
      for (let x = 0; x < cur.w; x++) {
        const lx = ox + x + 0.5;
        const ly = oy + y + 0.5;
        ma(lx, ly, pa);
        mb(lx, ly, pb);
        sample(cur, pa[0] - ox, pa[1] - oy, 'clamp', a);
        sample(cur, pb[0] - ox, pb[1] - oy, 'clamp', b);
        const p = (y * cur.w + x) * 4;
        next[p] = (a[0] + b[0]) * 0.5;
        next[p + 1] = (a[1] + b[1]) * 0.5;
        next[p + 2] = (a[2] + b[2]) * 0.5;
        next[p + 3] = (a[3] + b[3]) * 0.5;
      }
    }
    cur = { f: next, w: cur.w, h: cur.h };
  }
  return cur;
}

const passCount = (spreadPx: number) => clamp(Math.ceil(Math.log2(Math.max(1, spreadPx))) + 1, 1, 12);

/**
 * Evenly spaced samples of a one-parameter family of maps over [lo, hi] by halving passes:
 * `at(t)` maps a point by parameter t (t = 0 is the identity).
 */
function spread(src: Float, ox: number, oy: number, lo: number, hi: number, spreadPx: number, at: (t: number, x: number, y: number, out: Float64Array) => void): Float {
  if (hi - lo <= 0) return src;
  const n = passCount(spreadPx);
  const step = (hi - lo) / 2 ** n;
  // The samples sit at lo + (j + ½)·step; the first pass centres them, the others double the spacing.
  const mid = (lo + hi) / 2;
  const passes: [Map2, Map2][] = [];
  for (let k = 0; k < n; k++) {
    const d = (step * 2 ** k) / 2;
    const t0 = k === 0 ? mid - d : -d;
    const t1 = k === 0 ? mid + d : d;
    passes.push([(x, y, o) => at(t0, x, y, o), (x, y, o) => at(t1, x, y, o)]);
  }
  return halvingPasses(src, ox, oy, passes);
}

/** Box: evenly weighted; Smooth: the pixel itself counts most (several spreads averaged). */
function weighted(src: Float, ox: number, oy: number, lo: number, hi: number, spreadPx: number, mode: BlurMode, at: (t: number, x: number, y: number, out: Float64Array) => void): Float {
  if (mode === 'box') return spread(src, ox, oy, lo, hi, spreadPx, at);
  if (lo < 0 && hi > 0) {
    // Both directions: two half-length boxes make a triangle around the pixel.
    const once = spread(src, ox, oy, lo / 2, hi / 2, spreadPx / 2, at);
    return spread(once, ox, oy, lo / 2, hi / 2, spreadPx / 2, at);
  }
  // One direction: boxes of full, half and quarter length averaged (weights fall off with distance).
  const parts = [1, 0.5, 0.25].map((k) => spread(src, ox, oy, lo * k, hi * k, spreadPx * k, at));
  const f = new Float32Array(src.f.length);
  for (let i = 0; i < f.length; i++) f[i] = (parts[0].f[i] + parts[1].f[i] + parts[2].f[i]) / 3;
  return { f, w: src.w, h: src.h };
}

const range = (dir: BlurDirection, len: number): [number, number] => (dir === 'both' ? [-len / 2, len / 2] : dir === 'forward' ? [-len, 0] : [0, len]);

/**
 * Motion blur over `strength` pixels at `angle` degrees (counter-clockwise from the right). Forward
 * trails the image along the angle, backward against it.
 */
export function motionBlur(src: Img, ox: number, oy: number, strength: number, angle: number, dir: BlurDirection, mode: BlurMode): Img {
  const a = (angle * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = -Math.sin(a);
  const [lo, hi] = range(dir, strength);
  return unpremultiply(
    weighted(premultiply(src), ox, oy, lo, hi, strength, mode, (t, x, y, o) => {
      o[0] = x + dx * t;
      o[1] = y + dy * t;
    }),
  );
}

/** Farthest distance from (cx, cy) to the rectangle's corners. */
const farthest = (cx: number, cy: number, x: number, y: number, w: number, h: number) =>
  Math.max(Math.hypot(x - cx, y - cy), Math.hypot(x + w - cx, y - cy), Math.hypot(x - cx, y + h - cy), Math.hypot(x + w - cx, y + h - cy));

/**
 * Radial blur: streaks pointing away from the centre. Strength 100 spreads each pixel over a
 * quarter of its distance to the centre; outward streaks grow away from the centre, inward
 * towards it.
 */
export function radialBlur(src: Img, ox: number, oy: number, cx: number, cy: number, strength: number, dir: 'both' | 'outward' | 'inward', mode: BlurMode): Img {
  const u = (clamp(strength, 0, 100) / 100) * 0.25;
  const far = farthest(cx, cy, ox, oy, src.width, src.height);
  // Outward streaks: a pixel collects from nearer the centre (scale < 1).
  const [lo, hi] = range(dir === 'outward' ? 'forward' : dir === 'inward' ? 'backward' : 'both', u);
  return unpremultiply(
    weighted(premultiply(src), ox, oy, lo, hi, u * far, mode, (t, x, y, o) => {
      const s = Math.exp(t);
      o[0] = cx + (x - cx) * s;
      o[1] = cy + (y - cy) * s;
    }),
  );
}

/**
 * Spin blur: rotation around the centre over `strength` × 0.9 degrees. The area is an ellipse:
 * shape 1 is a circle, larger values stretch it vertically, tilt turns it.
 */
export function spinBlur(src: Img, ox: number, oy: number, cx: number, cy: number, strength: number, dir: 'both' | 'right' | 'left', shape: number, tilt: number): Img {
  const arc = (clamp(strength, 0, 100) * 0.9 * Math.PI) / 180;
  const far = farthest(cx, cy, ox, oy, src.width, src.height);
  const k = clamp(shape, 0.1, 10);
  const tr = (tilt * Math.PI) / 180;
  const ct = Math.cos(tr);
  const st = Math.sin(tr);
  const [lo, hi] = range(dir === 'right' ? 'forward' : dir === 'left' ? 'backward' : 'both', arc);
  return unpremultiply(
    spread(premultiply(src), ox, oy, lo, hi, arc * far, (t, x, y, o) => {
      // Into the ellipse's own frame (where it is a circle), rotate, and back.
      const px = x - cx;
      const py = y - cy;
      const ex = px * ct + py * st;
      const ey = (-px * st + py * ct) / k;
      const c = Math.cos(t);
      const s = Math.sin(t);
      const rx = ex * c - ey * s;
      const ry = (ex * s + ey * c) * k;
      o[0] = cx + rx * ct - ry * st;
      o[1] = cy + rx * st + ry * ct;
    }),
  );
}

export type LensShape = 'triangle' | 'square' | 'pentagon' | 'hexagon' | 'heptagon' | 'octagon';
export const LENS_SIDES: Record<LensShape, number> = { triangle: 3, square: 4, pentagon: 5, hexagon: 6, heptagon: 7, octagon: 8 };

/**
 * Lens blur: averages over a polygon (the aperture) of radius `strength` pixels; bright pixels
 * weigh more, so highlights spread into visible polygons. Large radii are computed on a reduced
 * image and scaled back (the result is blurred anyway).
 */
export function lensBlur(src: Img, strength: number, shape: LensShape, intensity: number, roundness: number, angle: number): Img {
  const radius = clamp(strength, 0, 100);
  if (radius < 0.5) return { ...src, data: src.data.slice() };
  const k = Math.max(1, Math.ceil(radius / 4));
  const { width: w, height: h, data } = src;
  const sw = Math.ceil(w / k);
  const sh = Math.ceil(h / k);
  // Per reduced pixel: weighted colour (3), weighted alpha, alpha, count.
  const acc = new Float64Array(sw * sh * 6);
  const boost = (clamp(intensity, 0, 100) / 100) * 12;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const a = data[p + 3] / 255;
      const wgt = 1 + boost * smoothstep(0.7, 1, luma(data[p], data[p + 1], data[p + 2]) / 255) ** 2;
      const q = (((y / k) | 0) * sw + ((x / k) | 0)) * 6;
      acc[q] += data[p] * a * wgt;
      acc[q + 1] += data[p + 1] * a * wgt;
      acc[q + 2] += data[p + 2] * a * wgt;
      acc[q + 3] += a * wgt;
      acc[q + 4] += a;
      acc[q + 5] += 1;
    }
  }
  // Aperture taps in reduced pixels.
  const rs = radius / k;
  const sides = LENS_SIDES[shape] ?? 6;
  const rot = (angle * Math.PI) / 180;
  const round = clamp(roundness, 0, 100) / 100;
  const taps: number[] = [];
  const ri = Math.ceil(rs);
  for (let dy = -ri; dy <= ri; dy++) {
    for (let dx = -ri; dx <= ri; dx++) {
      const d = Math.hypot(dx, dy);
      if (d === 0) {
        taps.push(0, 0);
        continue;
      }
      const sector = (2 * Math.PI) / sides;
      const th = (((Math.atan2(dy, dx) - rot - Math.PI / 2) % sector) + sector) % sector;
      const poly = Math.cos(Math.PI / sides) / Math.cos(th - Math.PI / sides);
      if (d <= rs * (poly + (1 - poly) * round) + 0.5) taps.push(dx, dy);
    }
  }
  const small: Float = { f: new Float32Array(sw * sh * 4), w: sw, h: sh };
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let wa = 0;
      let al = 0;
      let n = 0;
      for (let t = 0; t < taps.length; t += 2) {
        const xx = clamp(x + taps[t], 0, sw - 1);
        const yy = clamp(y + taps[t + 1], 0, sh - 1);
        const q = (yy * sw + xx) * 6;
        r += acc[q];
        g += acc[q + 1];
        b += acc[q + 2];
        wa += acc[q + 3];
        al += acc[q + 4];
        n += acc[q + 5];
      }
      const p = (y * sw + x) * 4;
      if (wa <= 0 || n === 0) continue;
      const alpha = al / n;
      small.f[p] = (r / wa) * alpha;
      small.f[p + 1] = (g / wa) * alpha;
      small.f[p + 2] = (b / wa) * alpha;
      small.f[p + 3] = alpha * 255;
    }
  }
  if (k === 1) return unpremultiply(small);
  const out: Float = { f: new Float32Array(w * h * 4), w, h };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) sample(small, (x + 0.5) / k, (y + 0.5) / k, 'clamp', out.f, (y * w + x) * 4);
  return unpremultiply(out);
}

/** Straight colours of a premultiplied pixel. */
function straight(f: Float32Array, p: number, out: number[]): void {
  const a = f[p + 3];
  const k = a > 0 ? 255 / a : 0;
  out[0] = f[p] * k;
  out[1] = f[p + 1] * k;
  out[2] = f[p + 2] * k;
}

/**
 * Unsharp mask: adds the difference to a Gaussian blur (radius = 2σ) times strength %, where a
 * channel differs by more than the threshold. Transparency stays as it is.
 */
export function unsharpMask(src: Img, radius: number, strength: number, threshold: number): Img {
  const blurred = gaussianF(premultiply(src), Math.max(0.05, radius / 2));
  return addDetail(src, blurred, strength / 100, threshold);
}

function addDetail(src: Img, blurred: Float, amount: number, threshold: number): Img {
  const out = createImg(src.width, src.height);
  const d = src.data;
  const o = out.data;
  const b = [0, 0, 0];
  for (let p = 0; p < d.length; p += 4) {
    o[p + 3] = d[p + 3];
    if (d[p + 3] === 0) continue;
    straight(blurred.f, p, b);
    for (let c = 0; c < 3; c++) {
      const diff = d[p + c] - b[c];
      o[p + c] = Math.abs(diff) > threshold ? d[p + c] + diff * amount : d[p + c];
    }
  }
  return out;
}

/** Sharpen / Sharpen (strong): the 3 × 3 detail added half or one and a half times. */
export const sharpen = (src: Img, strong: boolean): Img => addDetail(src, convolveSymmetric(premultiply(src), [0.5, 0.25]), strong ? 1.5 : 0.6, 0);
