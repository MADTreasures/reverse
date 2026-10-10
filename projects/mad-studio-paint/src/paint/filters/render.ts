/**
 * Filter > Render > Perlin noise: a cloud pattern in greys, drawn over whatever is on the layer
 * (in the selection). Gradient noise after Ken Perlin's improved noise, summed over octaves.
 */
import { clamp, createImg, random, type Img, type Rect } from './core';

const PERM = (() => {
  const next = random(20240917);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  return Uint8Array.from([...p, ...p]);
})();

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

function grad(hash: number, x: number, y: number): number {
  switch (hash & 7) {
    case 0:
      return x + y;
    case 1:
      return -x + y;
    case 2:
      return x - y;
    case 3:
      return -x - y;
    case 4:
      return x;
    case 5:
      return -x;
    case 6:
      return y;
    default:
      return -y;
  }
}

/** 2D gradient noise, about −1..1. */
export function perlin2(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const X = xi & 255;
  const Y = yi & 255;
  const u = fade(xf);
  const v = fade(yf);
  const aa = PERM[PERM[X] + Y];
  const ab = PERM[PERM[X] + Y + 1];
  const ba = PERM[PERM[X + 1] + Y];
  const bb = PERM[PERM[X + 1] + Y + 1];
  const x1 = grad(aa, xf, yf) + u * (grad(ba, xf - 1, yf) - grad(aa, xf, yf));
  const x2 = grad(ab, xf, yf - 1) + u * (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1));
  return x1 + v * (x2 - x1);
}

export interface PerlinOptions {
  /** Size of the pattern in pixels. */
  scale: number;
  /** Contrast, 0..100. */
  amplitude: number;
  /** Roughness, 0..100: how much each finer octave adds. */
  attenuation: number;
  /** Number of octaves, 1..10: more is less blurry. */
  repetition: number;
  offsetX: number;
  offsetY: number;
}

/** Grey, opaque clouds for the rectangle `rect` (layer coordinates). */
export function perlinNoise(rect: Rect, o: PerlinOptions): Img {
  const out = createImg(rect.w, rect.h);
  const octaves = clamp(Math.round(o.repetition), 1, 10);
  const persistence = 0.2 + (clamp(o.attenuation, 0, 100) / 100) * 0.6;
  const contrast = (clamp(o.amplitude, 0, 100) / 100) * 1.4;
  const base = 1 / Math.max(1, o.scale);
  let norm = 0;
  for (let i = 0, a = 1; i < octaves; i++, a *= persistence) norm += a;
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const px = rect.x + x + o.offsetX;
      const py = rect.y + y + o.offsetY;
      let sum = 0;
      let amp = 1;
      let freq = base;
      for (let i = 0; i < octaves; i++) {
        sum += perlin2(px * freq, py * freq) * amp;
        amp *= persistence;
        freq *= 2;
      }
      const v = clamp(0.5 + (sum / norm) * contrast, 0, 1) * 255;
      const p = (y * rect.w + x) * 4;
      out.data[p] = out.data[p + 1] = out.data[p + 2] = v;
      out.data[p + 3] = 255;
    }
  }
  return out;
}
