/**
 * Layer effects of the Layer Property palette: border effect (edge, watercolor edge) and layer
 * colour. Pure functions on straight RGBA bytes of a region; the compositor applies them.
 */
import { hexToRgb } from '../model/color';
import { distanceToInside } from './distance';

export interface BorderEffect {
  enabled: boolean;
  kind: 'edge' | 'watercolor';
  /** Edge: thickness in px and colour. */
  width: number;
  color: string;
  /** Watercolor edge: range in px, opacity and darkness 0..100, blur (soft falloff) in px. */
  range: number;
  opacity: number;
  darkness: number;
  blur: number;
}

/** Shows the layer in a colour: black becomes `color`, white becomes `sub` (or stays white). */
export interface LayerColorEffect {
  enabled: boolean;
  color: string;
  sub: string | null;
}

export interface LayerEffects {
  border?: BorderEffect;
  layerColor?: LayerColorEffect;
}

export const DEFAULT_BORDER: BorderEffect = { enabled: true, kind: 'edge', width: 4, color: '#000000', range: 6, opacity: 70, darkness: 40, blur: 2 };
export const DEFAULT_LAYER_COLOR: LayerColorEffect = { enabled: true, color: '#3a6ff0', sub: null };

/** How far an effect reaches beyond the drawn pixels (the compositor redraws that much more). */
export function effectReach(fx: LayerEffects | undefined): number {
  const b = fx?.border;
  if (!b?.enabled) return 0;
  return Math.ceil(b.kind === 'edge' ? b.width + 1 : b.range + b.blur + 1);
}

const rgbOf = (hex: string) => hexToRgb(hex) ?? { r: 0, g: 0, b: 0 };

/** Layer colour: brightness picks between the layer colour (dark) and the sub colour or white (light). */
export function applyLayerColor(data: Uint8ClampedArray, fx: LayerColorEffect): void {
  const c = rgbOf(fx.color);
  const s = fx.sub ? rgbOf(fx.sub) : { r: 255, g: 255, b: 255 };
  for (let p = 0; p < data.length; p += 4) {
    if (data[p + 3] === 0) continue;
    const l = (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) / 255;
    data[p] = c.r + (s.r - c.r) * l;
    data[p + 1] = c.g + (s.g - c.g) * l;
    data[p + 2] = c.b + (s.b - c.b) * l;
  }
}

/**
 * Edge: a solid line of `width` px around the drawn pixels (half-opaque pixels count as drawn),
 * placed behind them. Returns new RGBA data of the same size.
 */
export function applyEdge(data: Uint8ClampedArray, width: number, height: number, fx: BorderEffect): Uint8ClampedArray<ArrayBuffer> {
  const dist = distanceToInside((i) => data[i * 4 + 3] >= 128, width, height);
  const c = rgbOf(fx.color);
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0, p = 0; i < dist.length; i++, p += 4) {
    // Edge coverage, anti-aliased over the last pixel.
    const e = Math.min(1, Math.max(0, fx.width + 0.5 - dist[i]));
    const a = data[p + 3] / 255;
    // Layer pixel over the edge ("source-over" with straight alpha).
    const oa = a + e * (1 - a);
    if (oa <= 0) continue;
    out[p] = (data[p] * a + c.r * e * (1 - a)) / oa;
    out[p + 1] = (data[p + 1] * a + c.g * e * (1 - a)) / oa;
    out[p + 2] = (data[p + 2] * a + c.b * e * (1 - a)) / oa;
    out[p + 3] = oa * 255;
  }
  return out;
}

/** Watercolor edge: paint near the border of each shape gets denser and darker, like a dried stain. */
export function applyWatercolorEdge(data: Uint8ClampedArray, width: number, height: number, fx: BorderEffect): void {
  const fromOutside = distanceToInside((i) => data[i * 4 + 3] < 128, width, height);
  const range = Math.max(0.5, fx.range);
  const soft = Math.max(0, fx.blur);
  const opacity = Math.max(0, Math.min(100, fx.opacity)) / 100;
  const darkness = Math.max(0, Math.min(100, fx.darkness)) / 100;
  for (let i = 0, p = 0; i < fromOutside.length; i++, p += 4) {
    if (data[p + 3] === 0) continue;
    const d = fromOutside[i];
    if (d > range + soft) continue;
    // 1 at the border, fading to 0 at `range` (smoothly over `blur` px).
    let k = d <= range ? 1 - d / (range + soft) : Math.max(0, (range + soft - d) / (range + soft));
    k = k * k * (3 - 2 * k);
    data[p + 3] += (255 - data[p + 3]) * k * opacity;
    const dark = 1 - 0.6 * k * darkness;
    data[p] *= dark;
    data[p + 1] *= dark;
    data[p + 2] *= dark;
  }
}

const HEX = /^#[0-9a-f]{6}$/i;
const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
const color = (v: unknown, fallback: string) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback);

/** Validates effects read from a file. */
export function sanitizeEffects(raw: unknown): LayerEffects | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: LayerEffects = {};
  if (r.border && typeof r.border === 'object') {
    const b = r.border as Record<string, unknown>;
    out.border = {
      enabled: b.enabled !== false,
      kind: b.kind === 'watercolor' ? 'watercolor' : 'edge',
      width: num(b.width, DEFAULT_BORDER.width, 0.5, 100),
      color: color(b.color, DEFAULT_BORDER.color),
      range: num(b.range, DEFAULT_BORDER.range, 0.5, 100),
      opacity: num(b.opacity, DEFAULT_BORDER.opacity, 0, 100),
      darkness: num(b.darkness, DEFAULT_BORDER.darkness, 0, 100),
      blur: num(b.blur, DEFAULT_BORDER.blur, 0, 50),
    };
  }
  if (r.layerColor && typeof r.layerColor === 'object') {
    const c = r.layerColor as Record<string, unknown>;
    out.layerColor = { enabled: c.enabled !== false, color: color(c.color, DEFAULT_LAYER_COLOR.color), sub: c.sub === null || c.sub === undefined ? null : color(c.sub, '#ffffff') };
  }
  return out.border || out.layerColor ? out : undefined;
}
