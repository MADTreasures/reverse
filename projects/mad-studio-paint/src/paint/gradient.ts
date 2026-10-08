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
