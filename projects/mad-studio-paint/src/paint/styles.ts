/**
 * Layer styles (as in Photoshop documents): drop shadow, outer glow, inner shadow and inner glow.
 * Pure functions on straight RGBA bytes of a region; the compositor applies them after the layer's
 * own effects.
 */
import { hexToRgb } from '../model/color';

/** A shadow cast by the layer's shape (drop shadow) or into it (inner shadow). */
export interface ShadowStyle {
  enabled: boolean;
  color: string;
  /** 0..100 */
  opacity: number;
  /** Degrees: where the light comes from (0 = from the right, 90 = from above); the shadow falls away from it. */
  angle: number;
  /** px */
  distance: number;
  /** Blur in px. */
  size: number;
  /** 0..100: how much of the size stays solid (Photoshop's spread, or choke for inner shadows). */
  spread: number;
}

/** A glow around the layer's shape (outer) or along its inside edge (inner). */
export interface GlowStyle {
  enabled: boolean;
  color: string;
  /** 0..100 */
  opacity: number;
  /** px */
  size: number;
  /** 0..100 */
  spread: number;
}

export const DEFAULT_SHADOW: ShadowStyle = { enabled: true, color: '#000000', opacity: 60, angle: 120, distance: 8, size: 8, spread: 0 };
export const DEFAULT_GLOW: GlowStyle = { enabled: true, color: '#fff3a0', opacity: 75, size: 12, spread: 0 };

/** Offset of a shadow: away from the light. */
export function shadowOffset(s: Pick<ShadowStyle, 'angle' | 'distance'>): { dx: number; dy: number } {
  const a = (s.angle * Math.PI) / 180;
  return { dx: -Math.cos(a) * s.distance, dy: Math.sin(a) * s.distance };
}

/** How far a style reaches beyond the layer's pixels. */
export function styleReach(style: { distance?: number; size: number; enabled: boolean } | undefined): number {
  if (!style?.enabled) return 0;
  return Math.ceil((style.distance ?? 0) + style.size * 1.5 + 2);
}

// ------------------------------------------------------------------ helpers

/** Box blur of a w × h field (three passes come close to a Gaussian blur of about `size`). */
export function blurField(a: Float32Array, w: number, h: number, size: number): Float32Array {
  const r = Math.max(0, Math.round(size / 3));
  if (r === 0) return a;
  let src = Float32Array.from(a);
  let dst = new Float32Array(a.length);
  const pass = (horizontal: boolean) => {
    const n = horizontal ? w : h;
    const lines = horizontal ? h : w;
    const at = (line: number, i: number) => (horizontal ? line * w + i : i * w + line);
    for (let line = 0; line < lines; line++) {
      let sum = 0;
      // Outside the region counts as empty.
      for (let i = 0; i <= Math.min(r, n - 1); i++) sum += src[at(line, i)];
      for (let i = 0; i < n; i++) {
        dst[at(line, i)] = sum / (2 * r + 1);
        const add = i + r + 1;
        const drop = i - r;
        if (add < n) sum += src[at(line, add)];
        if (drop >= 0) sum -= src[at(line, drop)];
      }
    }
    [src, dst] = [dst, src];
  };
  for (let k = 0; k < 3; k++) {
    pass(true);
    pass(false);
  }
  return src;
}

/** The field moved by (dx, dy) whole pixels; what comes in from outside is `fill`. */
function shift(a: Float32Array, w: number, h: number, dx: number, dy: number, fill: number): Float32Array {
  const ox = Math.round(dx);
  const oy = Math.round(dy);
  if (!ox && !oy) return a;
  const out = new Float32Array(a.length).fill(fill);
  for (let y = 0; y < h; y++) {
    const sy = y - oy;
    if (sy < 0 || sy >= h) continue;
    for (let x = 0; x < w; x++) {
      const sx = x - ox;
      if (sx >= 0 && sx < w) out[y * w + x] = a[sy * w + sx];
    }
  }
  return out;
}

/** Spread: blurs by what is left of the size, then makes the edge harder by the spread. */
function spreadBlur(a: Float32Array, w: number, h: number, size: number, spread: number): Float32Array {
  const s = Math.max(0, Math.min(100, spread)) / 100;
  const blurred = blurField(a, w, h, size);
  if (s <= 0) return blurred;
  const k = 1 / Math.max(0.02, 1 - s);
  return blurred.map((v) => Math.min(1, v * k));
}

function alphaField(data: Uint8ClampedArray): Float32Array {
  const a = new Float32Array(data.length / 4);
  for (let i = 0; i < a.length; i++) a[i] = data[i * 4 + 3] / 255;
  return a;
}

const rgb = (hex: string) => hexToRgb(hex) ?? { r: 0, g: 0, b: 0 };

/** Puts colour with alpha `s` under the pixels (what shows around them). */
function under(data: Uint8ClampedArray, s: Float32Array, color: string): void {
  const c = rgb(color);
  for (let i = 0, p = 0; i < s.length; i++, p += 4) {
    const sa = s[i];
    if (sa <= 0) continue;
    const ca = data[p + 3] / 255;
    const oa = ca + sa * (1 - ca);
    if (oa <= 0) continue;
    const k = (sa * (1 - ca)) / oa;
    const f = ca / oa;
    data[p] = data[p] * f + c.r * k;
    data[p + 1] = data[p + 1] * f + c.g * k;
    data[p + 2] = data[p + 2] * f + c.b * k;
    data[p + 3] = oa * 255;
  }
}

/** Mixes colour into the pixels by `s` (inside the layer: its alpha stays). */
function over(data: Uint8ClampedArray, s: Float32Array, color: string): void {
  const c = rgb(color);
  for (let i = 0, p = 0; i < s.length; i++, p += 4) {
    const k = s[i];
    if (k <= 0 || data[p + 3] === 0) continue;
    data[p] += (c.r - data[p]) * k;
    data[p + 1] += (c.g - data[p + 1]) * k;
    data[p + 2] += (c.b - data[p + 2]) * k;
  }
}

// ------------------------------------------------------------------ the styles

export function applyDropShadow(data: Uint8ClampedArray, w: number, h: number, s: ShadowStyle): void {
  const { dx, dy } = shadowOffset(s);
  const shadow = spreadBlur(shift(alphaField(data), w, h, dx, dy, 0), w, h, s.size, s.spread);
  const k = s.opacity / 100;
  under(
    data,
    shadow.map((v) => v * k),
    s.color,
  );
}

export function applyOuterGlow(data: Uint8ClampedArray, w: number, h: number, g: GlowStyle): void {
  const glow = spreadBlur(alphaField(data), w, h, g.size, g.spread);
  const k = g.opacity / 100;
  under(
    data,
    glow.map((v) => v * k),
    g.color,
  );
}

export function applyInnerShadow(data: Uint8ClampedArray, w: number, h: number, s: ShadowStyle): void {
  const { dx, dy } = shadowOffset(s);
  const a = alphaField(data);
  // The outside, moved with the light, blurred, falling on the inside.
  const outside = spreadBlur(
    shift(
      a.map((v) => 1 - v),
      w,
      h,
      dx,
      dy,
      1,
    ),
    w,
    h,
    s.size,
    s.spread,
  );
  const k = s.opacity / 100;
  over(
    data,
    outside.map((v) => v * k),
    s.color,
  );
}

export function applyInnerGlow(data: Uint8ClampedArray, w: number, h: number, g: GlowStyle): void {
  const a = alphaField(data);
  const edge = spreadBlur(
    a.map((v) => 1 - v),
    w,
    h,
    g.size,
    g.spread,
  );
  const k = g.opacity / 100;
  over(
    data,
    edge.map((v) => v * k),
    g.color,
  );
}

// ------------------------------------------------------------------ files

const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
const hex = (v: unknown, fallback: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback);

export function sanitizeShadow(raw: unknown): ShadowStyle | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const d = DEFAULT_SHADOW;
  return {
    enabled: r.enabled !== false,
    color: hex(r.color, d.color),
    opacity: num(r.opacity, d.opacity, 0, 100),
    angle: num(r.angle, d.angle, -360, 360),
    distance: num(r.distance, d.distance, 0, 1000),
    size: num(r.size, d.size, 0, 250),
    spread: num(r.spread, 0, 0, 100),
  };
}

export function sanitizeGlow(raw: unknown): GlowStyle | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const d = DEFAULT_GLOW;
  return {
    enabled: r.enabled !== false,
    color: hex(r.color, d.color),
    opacity: num(r.opacity, d.opacity, 0, 100),
    size: num(r.size, d.size, 0, 250),
    spread: num(r.spread, 0, 0, 100),
  };
}

/** Kept layer styles (plain data only, limited in size and depth), or undefined. */
export function sanitizeKeptStyles(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const plain = (v: unknown, depth: number): unknown => {
    if (depth > 8) return undefined;
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return typeof v === 'string' ? v.slice(0, 200) : v;
    if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
    if (Array.isArray(v)) return v.slice(0, 256).map((x) => plain(x, depth + 1));
    if (typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 64)) if (/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(k)) out[k] = plain(x, depth + 1);
      return out;
    }
    return undefined;
  };
  const out: Record<string, unknown> = {};
  for (const key of KEPT_STYLE_KEYS) if (key in raw) out[key] = plain((raw as Record<string, unknown>)[key], 0);
  if (Object.keys(out).length === 0 || JSON.stringify(out).length > 64 * 1024) return undefined;
  return out;
}

/** Photoshop layer styles that are kept (written back to Photoshop documents) but not shown. */
export const KEPT_STYLE_KEYS = ['bevel', 'satin', 'gradientOverlay', 'extraStrokes', 'extraFills', 'extraDropShadows', 'extraInnerShadows'] as const;
