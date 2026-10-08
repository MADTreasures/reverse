/**
 * Brush materials: image tips (alpha masks) and paper textures (seamless height maps), the app's
 * own procedurally drawn ones and images imported by the user; which tip a dab uses, and how a
 * paper texture takes paint away. Pure, unit tested.
 */
import { seededRandom } from './stroke';

export type MaterialKind = 'tip' | 'texture';

export interface MaterialInfo {
  id: string;
  name: string;
  kind: MaterialKind;
}

/** A grayscale image: 0 = no paint / low paper, 255 = full paint / high paper. */
export interface Mask {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

/** The app's own brush tips (drawn by code, not the reference's materials). */
export const BUILTIN_TIPS: MaterialInfo[] = [
  { id: 'chalk', name: 'Chalk', kind: 'tip' },
  { id: 'bristle', name: 'Bristles', kind: 'tip' },
  { id: 'splatter', name: 'Splatter', kind: 'tip' },
  { id: 'leaf', name: 'Leaf', kind: 'tip' },
  { id: 'grass', name: 'Grass', kind: 'tip' },
  { id: 'star', name: 'Star', kind: 'tip' },
  { id: 'sparkle', name: 'Sparkle', kind: 'tip' },
  { id: 'heart', name: 'Heart', kind: 'tip' },
  { id: 'flower', name: 'Flower', kind: 'tip' },
];

/** The app's own paper textures (seamless). */
export const BUILTIN_TEXTURES: MaterialInfo[] = [
  { id: 'paper', name: 'Drawing paper', kind: 'texture' },
  { id: 'rough', name: 'Rough paper', kind: 'texture' },
  { id: 'watercolor', name: 'Watercolor paper', kind: 'texture' },
  { id: 'canvas', name: 'Canvas', kind: 'texture' },
  { id: 'sketch', name: 'Sketchbook', kind: 'texture' },
];

export const isBuiltinTip = (id: string) => BUILTIN_TIPS.some((m) => m.id === id);
export const isBuiltinTexture = (id: string) => BUILTIN_TEXTURES.some((m) => m.id === id);

// ------------------------------------------------------------------ drawing shapes

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Rasterises a coverage function over [-1, 1]² (3 × 3 samples per pixel). */
function raster(size: number, f: (u: number, v: number) => number): Mask {
  const data = new Uint8ClampedArray(size * size);
  const ss = 3;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let j = 0; j < ss; j++)
        for (let i = 0; i < ss; i++) {
          const u = ((x + (i + 0.5) / ss) / size) * 2 - 1;
          const v = ((y + (j + 0.5) / ss) / size) * 2 - 1;
          sum += clamp01(f(u, v));
        }
      data[y * size + x] = Math.round((sum / (ss * ss)) * 255);
    }
  return { w: size, h: size, data };
}

/** Whether (u, v) is inside a polygon (even-odd). */
function inPolygon(pts: [number, number][], u: number, v: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > v !== yj > v && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Smooth random value noise with `px` × `py` cells across [0, 1)², repeating seamlessly. */
function periodicNoise(seed: number, px: number, py = px): (x: number, y: number) => number {
  const rand = seededRandom(seed);
  const grid = Array.from({ length: px * py }, () => rand());
  const at = (i: number, j: number) => grid[(((j % py) + py) % py) * px + (((i % px) + px) % px)];
  return (x, y) => {
    const fx = x * px;
    const fy = y * py;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = smooth(0, 1, fx - i);
    const ty = smooth(0, 1, fy - j);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * tx;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * tx;
    return a + (b - a) * ty;
  };
}

/** Fractal noise from octaves of periodic noise (still seamless). */
function fractal(seed: number, base: number, octaves: number, falloff = 0.5): (x: number, y: number) => number {
  const layers = Array.from({ length: octaves }, (_, k) => periodicNoise(seed + k * 101, base << k));
  let norm = 0;
  for (let k = 0; k < octaves; k++) norm += falloff ** k;
  return (x, y) => layers.reduce((s, n, k) => s + n(x, y) * falloff ** k, 0) / norm;
}

/** One brush tip as a mask (`size` px square). */
export function tipMask(id: string, size = 128): Mask | null {
  const rand = seededRandom(id.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7));
  switch (id) {
    case 'chalk': {
      const n = periodicNoise(11, 9);
      const fine = periodicNoise(12, 31);
      return raster(size, (u, v) => {
        const r = Math.hypot(u, v);
        const edge = 0.78 + 0.18 * n((Math.atan2(v, u) / (2 * Math.PI) + 1) % 1, 0.5);
        return smooth(edge, edge - 0.08, r) * (0.45 + 0.55 * fine((u + 1) / 2, (v + 1) / 2));
      });
    }
    case 'bristle': {
      // Hairs across the tip, each with its own strength and gaps.
      const hairs = Array.from({ length: 14 }, () => ({ v: rand() * 1.7 - 0.85, w: 0.025 + rand() * 0.04, a: 0.5 + rand() * 0.5, gap: rand() }));
      const n = periodicNoise(21, 7);
      return raster(size, (u, v) => {
        let c = 0;
        for (const h of hairs) c = Math.max(c, smooth(h.w, h.w * 0.4, Math.abs(v - h.v)) * h.a * (n((u + 1) / 2, h.gap) > 0.3 ? 1 : 0.35));
        return c * smooth(1, 0.8, Math.abs(u));
      });
    }
    case 'splatter': {
      const drops = Array.from({ length: 26 }, () => {
        const a = rand() * Math.PI * 2;
        const d = Math.sqrt(rand()) * 0.8;
        return { x: Math.cos(a) * d, y: Math.sin(a) * d, r: 0.03 + rand() * 0.12 * (1 - d * 0.7) };
      });
      return raster(size, (u, v) => {
        let c = 0;
        for (const p of drops) c = Math.max(c, smooth(p.r, p.r * 0.7, Math.hypot(u - p.x, v - p.y)));
        return c;
      });
    }
    case 'leaf':
      return raster(size, (u, v) => {
        // Pointing right; a thin vein down the middle.
        const t = (u + 1) / 2;
        const half = 0.5 * Math.sin(Math.PI * t) ** 0.9 * (1 - 0.25 * t);
        const body = smooth(half, half - 0.04, Math.abs(v + 0.05 * Math.sin(Math.PI * t)));
        const vein = smooth(0.035, 0.015, Math.abs(v + 0.05 * Math.sin(Math.PI * t))) * (t > 0.05 && t < 0.92 ? 0.55 : 0);
        const stem = u < -0.82 && Math.abs(v) < 0.03 ? 1 : 0;
        return Math.max(body * (1 - vein), stem);
      });
    case 'grass': {
      // Blades growing up from the bottom edge.
      const blades = Array.from({ length: 9 }, () => ({ x: rand() * 1.4 - 0.7, lean: (rand() - 0.5) * 0.9, h: 0.9 + rand() * 0.9, w: 0.05 + rand() * 0.04 }));
      return raster(size, (u, v) => {
        let c = 0;
        for (const b of blades) {
          const t = (1 - v) / b.h;
          if (t < 0 || t > 1) continue;
          const cx = b.x + b.lean * t * t;
          c = Math.max(c, smooth(b.w * (1 - t), b.w * (1 - t) * 0.6, Math.abs(u - cx)));
        }
        return c;
      });
    }
    case 'star': {
      const pts: [number, number][] = Array.from({ length: 10 }, (_, k) => {
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        const r = k % 2 ? 0.4 : 0.95;
        return [Math.cos(a) * r, Math.sin(a) * r + 0.06];
      });
      return raster(size, (u, v) => (inPolygon(pts, u, v) ? 1 : 0));
    }
    case 'sparkle':
      return raster(size, (u, v) => {
        // A four-pointed glint with a soft glow.
        const arms = Math.max(smooth(0.09 * (1 - Math.abs(u)), 0, Math.abs(v)) * smooth(1, 0.6, Math.abs(u)), smooth(0.09 * (1 - Math.abs(v)), 0, Math.abs(u)) * smooth(1, 0.6, Math.abs(v)));
        const glow = smooth(0.45, 0, Math.hypot(u, v)) * 0.6;
        return Math.max(arms, glow);
      });
    case 'heart':
      return raster(size, (u, v) => {
        // (x² + y² − 1)³ − x² y³ ≤ 0, scaled to the tip.
        const x = u * 1.25;
        const y = -(v * 1.25) + 0.25;
        const f = (x * x + y * y - 1) ** 3 - x * x * y * y * y;
        return f <= 0 ? 1 : 0;
      });
    case 'flower':
      return raster(size, (u, v) => {
        const r = Math.hypot(u, v);
        const a = Math.atan2(v, u);
        const petal = 0.55 + 0.4 * Math.abs(Math.cos((5 * a) / 2));
        const center = smooth(0.2, 0.17, r);
        return Math.max(smooth(petal, petal - 0.05, r) * (center > 0.5 ? 0.6 : 1), center * 0.6);
      });
    default:
      return null;
  }
}

/** One paper texture as a seamless height map (`size` px square). */
export function textureMask(id: string, size = 256): Mask | null {
  let f: ((x: number, y: number) => number) | null = null;
  switch (id) {
    case 'paper': {
      const n = fractal(31, 16, 4, 0.55);
      f = (x, y) => 0.5 + (n(x, y) - 0.5) * 1.8;
      break;
    }
    case 'rough': {
      const n = fractal(41, 8, 5, 0.6);
      f = (x, y) => smooth(0.3, 0.7, n(x, y));
      break;
    }
    case 'watercolor': {
      const big = fractal(51, 4, 3, 0.5);
      const fine = fractal(52, 32, 2, 0.5);
      f = (x, y) => 0.5 + (big(x, y) - 0.5) * 1.6 + (fine(x, y) - 0.5) * 0.5;
      break;
    }
    case 'canvas': {
      // Threads over and under, with a little noise.
      const n = fractal(61, 32, 2, 0.5);
      const threads = 32;
      f = (x, y) => {
        const cx = Math.floor(x * threads);
        const cy = Math.floor(y * threads);
        const over = (cx + cy) % 2 === 0;
        const across = 0.5 + 0.5 * Math.cos((y * threads - cy - 0.5) * Math.PI * 2);
        const down = 0.5 + 0.5 * Math.cos((x * threads - cx - 0.5) * Math.PI * 2);
        return (over ? 0.35 + 0.6 * across : 0.35 + 0.6 * down) * 0.85 + n(x, y) * 0.15;
      };
      break;
    }
    case 'sketch': {
      // Fibres along the page: noise stretched sideways.
      const n = fractal(71, 4, 4, 0.6);
      const streak = periodicNoise(72, 4, 96);
      f = (x, y) => 0.5 + (n(x, y) - 0.5) * 1.2 + (streak(x, y) - 0.5) * 0.6;
      break;
    }
  }
  if (!f) return null;
  const data = new Uint8ClampedArray(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) data[y * size + x] = Math.round(clamp01(f(x / size, y / size)) * 255);
  return { w: size, h: size, data };
}

// ------------------------------------------------------------------ imported images

/** An imported image as a mask: its transparency when it has some, else dark = paint. */
export function imageToMask(rgba: Uint8ClampedArray, w: number, h: number): Mask {
  const data = new Uint8ClampedArray(w * h);
  let transparent = false;
  for (let i = 3; i < rgba.length; i += 4)
    if (rgba[i] < 250) {
      transparent = true;
      break;
    }
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    const lum = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    data[i] = transparent ? Math.round((rgba[p + 3] * (255 - lum * 0.5)) / 255) : Math.round(255 - lum);
  }
  return { w, h, data };
}

// ------------------------------------------------------------------ using tips

export type TipOrder = 'repeat' | 'reverse' | 'stay' | 'random' | 'once';

/** Which of `count` tips the n-th dab of a stroke uses (−1: none, after "One time only"). */
export function tipIndex(order: TipOrder, count: number, n: number, rand: () => number): number {
  if (count <= 0) return -1;
  switch (order) {
    case 'repeat':
      return n % count;
    case 'reverse': {
      if (count === 1) return 0;
      const period = 2 * count - 2;
      const k = n % period;
      return k < count ? k : period - k;
    }
    case 'stay':
      return Math.min(n, count - 1);
    case 'random':
      return Math.min(count - 1, Math.floor(rand() * count));
    case 'once':
      return n < count ? n : -1;
  }
}

// ------------------------------------------------------------------ paper texture

export interface PaperSettings {
  /** 0..1: how strongly the paper shows. */
  density: number;
  /** Size of the texture, % of its pixels. */
  scale: number;
  /** Degrees. */
  angle: number;
  /** −100..100 */
  brightness: number;
  /** −100..100 */
  contrast: number;
  invert: boolean;
  /** Multiply: paint fades in the low parts. Subtract: low parts lose a fixed amount (light strokes only touch the high parts). */
  mode: 'multiply' | 'subtract';
}

/** The texture's heights after brightness, contrast and invert. */
export function adjustHeights(mask: Mask, p: Pick<PaperSettings, 'brightness' | 'contrast' | 'invert'>): Uint8ClampedArray {
  const k = p.contrast >= 0 ? 1 + p.contrast / 25 : 1 + p.contrast / 100;
  const b = p.brightness / 200;
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    let v = (i / 255 - 0.5) * k + 0.5 + b;
    if (p.invert) v = 1 - v;
    lut[i] = Math.round(clamp01(v) * 255);
  }
  return mask.data.map((v) => lut[v]);
}

/**
 * Takes paint away by the paper's heights: `rgba` is a w × h block whose top-left pixel lies at
 * (ox, oy) on the canvas (the texture stays put on the canvas: it is paper).
 */
export function applyPaper(rgba: Uint8ClampedArray, w: number, h: number, ox: number, oy: number, heights: Uint8ClampedArray, size: number, p: PaperSettings): void {
  const s = Math.max(0.05, p.scale / 100);
  const a = (-p.angle * Math.PI) / 180;
  const cos = Math.cos(a) / s;
  const sin = Math.sin(a) / s;
  const d = clamp01(p.density);
  for (let y = 0; y < h; y++) {
    const Y = oy + y + 0.5;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4 + 3;
      const alpha = rgba[i];
      if (alpha === 0) continue;
      const X = ox + x + 0.5;
      const u = Math.floor(X * cos - Y * sin);
      const v = Math.floor(X * sin + Y * cos);
      const hgt = heights[(((v % size) + size) % size) * size + (((u % size) + size) % size)];
      rgba[i] = p.mode === 'subtract' ? Math.max(0, alpha - d * (255 - hgt)) : Math.round(alpha * (1 - d * (1 - hgt / 255)));
    }
  }
}
