/** Gradients made of colour nodes (gradient tool, gradient map). Pure, unit tested. */
import { hexToRgb } from '../model/color';

export interface GradientStop {
  /** Position 0..1 along the gradient. */
  pos: number;
  /** '#rrggbb', or the current main / sub colour. */
  color: string | 'main' | 'sub';
  /** 0..1 */
  opacity: number;
}

/** Stops sorted by position, with 'main' / 'sub' replaced by the given colours. */
export function resolveStops(stops: GradientStop[], main = '#000000', sub = '#ffffff'): GradientStop[] {
  return stops
    .map((s) => ({ ...s, color: s.color === 'main' ? main : s.color === 'sub' ? sub : s.color }))
    .sort((a, b) => a.pos - b.pos);
}

/** Colour (0..255) and opacity (0..1) at `t`; nodes mix linearly. */
export function sampleGradient(stops: GradientStop[], t: number): [number, number, number, number] {
  const sorted = resolveStops(stops);
  if (sorted.length === 0) return [0, 0, 0, 0];
  const rgb = (s: GradientStop) => hexToRgb(s.color) ?? { r: 0, g: 0, b: 0 };
  const x = Math.min(1, Math.max(0, t));
  if (x <= sorted[0].pos) {
    const c = rgb(sorted[0]);
    return [c.r, c.g, c.b, sorted[0].opacity];
  }
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (x <= b.pos) {
      const f = b.pos > a.pos ? (x - a.pos) / (b.pos - a.pos) : 1;
      const ca = rgb(a);
      const cb = rgb(b);
      return [ca.r + (cb.r - ca.r) * f, ca.g + (cb.g - ca.g) * f, ca.b + (cb.b - ca.b) * f, a.opacity + (b.opacity - a.opacity) * f];
    }
  }
  const last = sorted[sorted.length - 1];
  const c = rgb(last);
  return [c.r, c.g, c.b, last.opacity];
}

/** 256 RGBA entries (opacity as 0..255) for fast lookups. */
export function gradientLut(stops: GradientStop[]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const [r, g, b, a] = sampleGradient(stops, i / 255);
    lut.set([Math.round(r), Math.round(g), Math.round(b), Math.round(a * 255)], i * 4);
  }
  return lut;
}

/** Own presets (not the reference's materials). */
export const GRADIENT_PRESETS: { name: string; stops: GradientStop[] }[] = [
  { name: 'Black and white', stops: [{ pos: 0, color: '#000000', opacity: 1 }, { pos: 1, color: '#ffffff', opacity: 1 }] },
  { name: 'Sepia', stops: [{ pos: 0, color: '#1e120a', opacity: 1 }, { pos: 0.55, color: '#9a6b3f', opacity: 1 }, { pos: 1, color: '#f6e7c8', opacity: 1 }] },
  {
    name: 'Evening glow',
    stops: [
      { pos: 0, color: '#1b1035', opacity: 1 },
      { pos: 0.4, color: '#a23b5f', opacity: 1 },
      { pos: 0.75, color: '#f08a4b', opacity: 1 },
      { pos: 1, color: '#ffe5a3', opacity: 1 },
    ],
  },
  { name: 'Moonlight', stops: [{ pos: 0, color: '#05070f', opacity: 1 }, { pos: 0.5, color: '#2c4a7a', opacity: 1 }, { pos: 1, color: '#d9ecff', opacity: 1 }] },
  { name: 'Forest', stops: [{ pos: 0, color: '#0b1a10', opacity: 1 }, { pos: 0.5, color: '#3f7a3a', opacity: 1 }, { pos: 1, color: '#e9f5c9', opacity: 1 }] },
  { name: 'Cool to warm', stops: [{ pos: 0, color: '#2b3a8c', opacity: 1 }, { pos: 0.5, color: '#b9a7c7', opacity: 1 }, { pos: 1, color: '#ffcf8a', opacity: 1 }] },
];

// ------------------------------------------------------------------ gradient tool and layers

export type GradientShape = 'line' | 'circle' | 'ellipse';
/** Outside the dragged length: keep the end colours, repeat, repeat mirrored, or leave empty. */
export type GradientEdge = 'none' | 'repeat' | 'reverse' | 'clear';

export interface GradientSpec {
  stops: GradientStop[];
  shape: GradientShape;
  edge: GradientEdge;
  /** Fine noise against visible colour steps. */
  dither: boolean;
}

/** A gradient on a gradient layer: from `a` to `b` (document px), colours resolved. */
export interface GradientFill extends GradientSpec {
  a: { x: number; y: number };
  b: { x: number; y: number };
}

/** Ellipse gradients are half as high (across the drag) as long. */
export const ELLIPSE_RATIO = 0.5;

/** Position along the gradient (0..1 after the edge rule) of a point, or null where nothing is drawn. */
export function gradientT(spec: Pick<GradientSpec, 'shape' | 'edge'>, a: { x: number; y: number }, b: { x: number; y: number }, x: number, y: number): number | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-9) return null;
  const px = x - a.x;
  const py = y - a.y;
  let t: number;
  if (spec.shape === 'line') t = (px * dx + py * dy) / l2;
  else if (spec.shape === 'circle') t = Math.sqrt((px * px + py * py) / l2);
  else {
    const u = (px * dx + py * dy) / l2;
    const v = (-px * dy + py * dx) / l2 / ELLIPSE_RATIO;
    t = Math.sqrt(u * u + v * v);
  }
  switch (spec.edge) {
    case 'repeat':
      return t - Math.floor(t);
    case 'reverse': {
      const m = t - 2 * Math.floor(t / 2);
      return m > 1 ? 2 - m : m;
    }
    case 'clear':
      return t < 0 || t > 1 ? null : t;
    default:
      return Math.min(1, Math.max(0, t));
  }
}

/** A repeatable number −0.5..0.5 per pixel (dithering). */
function noise(x: number, y: number): number {
  let h = Math.imul(x | 0, 2654435761) ^ Math.imul(y | 0, 1597334677);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296 - 0.5;
}

/**
 * Draws a gradient into straight RGBA bytes of a region (top-left at document position x0, y0).
 * `main` / `sub` resolve nodes that use the drawing colours.
 */
export function renderGradient(data: Uint8ClampedArray, w: number, h: number, x0: number, y0: number, spec: GradientSpec, a: { x: number; y: number }, b: { x: number; y: number }, main = '#000000', sub = '#ffffff'): void {
  const steps = 1024;
  const stops = resolveStops(spec.stops, main, sub);
  const lut = new Float32Array(steps * 4);
  for (let i = 0; i < steps; i++) lut.set(sampleGradient(stops, i / (steps - 1)), i * 4);
  for (let j = 0, p = 0; j < h; j++) {
    for (let i = 0; i < w; i++, p += 4) {
      const x = x0 + i + 0.5;
      const y = y0 + j + 0.5;
      const t = gradientT(spec, a, b, x, y);
      if (t === null) {
        data[p + 3] = 0;
        continue;
      }
      const k = Math.round(t * (steps - 1)) * 4;
      const d = spec.dither ? noise(x0 + i, y0 + j) : 0;
      data[p] = lut[k] + d;
      data[p + 1] = lut[k + 1] + d;
      data[p + 2] = lut[k + 2] + d;
      data[p + 3] = lut[k + 3] * 255 + d;
    }
  }
}

const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);

/** Gradient nodes from a file or storage. */
export function sanitizeGradientStops(raw: unknown): GradientStop[] | null {
  if (!Array.isArray(raw)) return null;
  const stops = raw.slice(0, 64).flatMap((s): GradientStop[] => {
    if (!s || typeof s !== 'object') return [];
    const r = s as Record<string, unknown>;
    const color = r.color === 'main' || r.color === 'sub' ? r.color : typeof r.color === 'string' && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color.toLowerCase() : null;
    return color ? [{ pos: num(r.pos, 0, 0, 1), color, opacity: num(r.opacity, 1, 0, 1) }] : [];
  });
  return stops.length >= 1 ? stops : null;
}

export function sanitizeGradientFill(raw: unknown): GradientFill | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const pt = (v: unknown, fx: number, fy: number) => {
    const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    return { x: num(o.x, fx, -1e6, 1e6), y: num(o.y, fy, -1e6, 1e6) };
  };
  return {
    stops: sanitizeGradientStops(r.stops) ?? [
      { pos: 0, color: '#000000', opacity: 1 },
      { pos: 1, color: '#ffffff', opacity: 1 },
    ],
    shape: r.shape === 'circle' || r.shape === 'ellipse' ? r.shape : 'line',
    edge: r.edge === 'repeat' || r.edge === 'reverse' || r.edge === 'clear' ? r.edge : 'none',
    dither: r.dither === true,
    a: pt(r.a, 0, 0),
    b: pt(r.b, 100, 0),
  };
}
