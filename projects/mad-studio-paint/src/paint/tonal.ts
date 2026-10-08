/**
 * Tonal corrections (Edit > Tonal correction and correction layers). Pure functions on straight
 * RGBA bytes; alpha is left alone. The reference documents the controls but not the formulas, so
 * the maths here is our own (standard image-processing definitions).
 */
import { monotoneCurve, type CurvePoint } from './curve';
import { gradientLut, type GradientStop } from './gradient';

export type Channel = 'rgb' | 'r' | 'g' | 'b';
export const CHANNELS: { id: Channel; label: string }[] = [
  { id: 'rgb', label: 'RGB' },
  { id: 'r', label: 'Red' },
  { id: 'g', label: 'Green' },
  { id: 'b', label: 'Blue' },
];

export interface Levels {
  /** Input shadows / highlights 0..255. */
  inBlack: number;
  inWhite: number;
  /** Midtones as a gamma (1 = unchanged, > 1 brightens). */
  gamma: number;
  outBlack: number;
  outWhite: number;
}

/** Tone curve control point [input, output], 0..255. */
export type { CurvePoint };
/** Cyan–Red, Magenta–Green, Yellow–Blue, each −100..100. */
export type Balance = [number, number, number];

export type Correction =
  | { type: 'brightnessContrast'; brightness: number; contrast: number }
  | { type: 'levels'; levels: Record<Channel, Levels> }
  | { type: 'toneCurve'; curves: Record<Channel, CurvePoint[]> }
  | { type: 'hsl'; hue: number; saturation: number; luminosity: number }
  | { type: 'colorBalance'; shadows: Balance; midtones: Balance; highlights: Balance; preserveLuminosity: boolean }
  | { type: 'reverse' }
  | { type: 'posterize'; levels: number }
  | { type: 'binarize'; threshold: number }
  /** Stops with resolved colours ('#rrggbb'). */
  | { type: 'gradientMap'; stops: GradientStop[] };

export type CorrectionType = Correction['type'];

/** In the order of the reference's menus. */
export const CORRECTIONS: { type: CorrectionType; label: string }[] = [
  { type: 'brightnessContrast', label: 'Brightness/Contrast' },
  { type: 'levels', label: 'Level correction' },
  { type: 'toneCurve', label: 'Tone curve' },
  { type: 'hsl', label: 'Hue/Saturation/Luminosity' },
  { type: 'colorBalance', label: 'Color balance' },
  { type: 'reverse', label: 'Reverse gradient' },
  { type: 'posterize', label: 'Posterization' },
  { type: 'binarize', label: 'Binarization' },
  { type: 'gradientMap', label: 'Gradient map' },
];

export const correctionLabel = (type: CorrectionType) => CORRECTIONS.find((c) => c.type === type)?.label ?? type;

const LEVELS: Levels = { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };
const LINE: CurvePoint[] = [
  [0, 0],
  [255, 255],
];

export function defaultCorrection(type: CorrectionType): Correction {
  switch (type) {
    case 'brightnessContrast':
      return { type, brightness: 0, contrast: 0 };
    case 'levels':
      return { type, levels: { rgb: { ...LEVELS }, r: { ...LEVELS }, g: { ...LEVELS }, b: { ...LEVELS } } };
    case 'toneCurve':
      return { type, curves: { rgb: structuredClone(LINE), r: structuredClone(LINE), g: structuredClone(LINE), b: structuredClone(LINE) } };
    case 'hsl':
      return { type, hue: 0, saturation: 0, luminosity: 0 };
    case 'colorBalance':
      return { type, shadows: [0, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0], preserveLuminosity: true };
    case 'reverse':
      return { type };
    case 'posterize':
      return { type, levels: 4 };
    case 'binarize':
      return { type, threshold: 128 };
    case 'gradientMap':
      return {
        type,
        stops: [
          { pos: 0, color: '#000000', opacity: 1 },
          { pos: 1, color: '#ffffff', opacity: 1 },
        ],
      };
  }
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Rec. 601 luma, 0..255. */
export const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

// ------------------------------------------------------------------ lookup tables

function tableOf(f: (v: number) => number): Uint8ClampedArray {
  const t = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) t[v] = Math.round(clamp255(f(v)));
  return t;
}

/** Brightness / contrast −100..100. Contrast scales around the middle grey (×0.1 … ×10). */
export function brightnessContrastTable(brightness: number, contrast: number): Uint8ClampedArray {
  const c = Math.max(-1, Math.min(1, contrast / 100));
  const k = c >= 0 ? 1 / (1 - 0.9 * c) : 1 + 0.9 * c;
  const b = (Math.max(-100, Math.min(100, brightness)) / 100) * 0.4 * 255;
  return tableOf((v) => (v - 127.5) * k + 127.5 + b);
}

export function levelsTable(l: Levels): Uint8ClampedArray {
  const span = Math.max(1, l.inWhite - l.inBlack);
  const gamma = Math.max(0.1, Math.min(10, l.gamma));
  return tableOf((v) => {
    const x = Math.min(1, Math.max(0, (v - l.inBlack) / span));
    return l.outBlack + Math.pow(x, 1 / gamma) * (l.outWhite - l.outBlack);
  });
}

/** Tone curve as a table: smooth through the control points (0..255), flat beyond the first and last. */
export function curveTable(points: CurvePoint[]): Uint8ClampedArray {
  const f = monotoneCurve(points.map(([x, y]) => [Math.min(255, Math.max(0, x)), Math.min(255, Math.max(0, y))] as CurvePoint));
  return tableOf(f);
}

export function posterizeTable(levels: number): Uint8ClampedArray {
  const n = Math.max(2, Math.min(20, Math.round(levels))) - 1;
  return tableOf((v) => (Math.round((v / 255) * n) * 255) / n);
}

/** Applies a table per channel: `master` after the channel's own table. */
function applyTables(data: Uint8ClampedArray, r: Uint8ClampedArray, g: Uint8ClampedArray, b: Uint8ClampedArray): void {
  for (let p = 0; p < data.length; p += 4) {
    data[p] = r[data[p]];
    data[p + 1] = g[data[p + 1]];
    data[p + 2] = b[data[p + 2]];
  }
}

const compose = (master: Uint8ClampedArray, own: Uint8ClampedArray) => tableOf((v) => master[own[v]]);

// ------------------------------------------------------------------ colour space helpers

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max / 255];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** HSL lightness 0..1. */
const lightness = (r: number, g: number, b: number) => (Math.max(r, g, b) + Math.min(r, g, b)) / 510;

/** Shifts r, g, b by the same amount so the HSL lightness becomes `l` (then clamps). */
function withLightness(rgb: [number, number, number], l: number): [number, number, number] {
  const delta = (l - lightness(...rgb)) * 255;
  return [clamp255(rgb[0] + delta), clamp255(rgb[1] + delta), clamp255(rgb[2] + delta)];
}

// ------------------------------------------------------------------ per-pixel corrections

/** Hue −180..180°, saturation and luminosity −100..100 (HSV model; luminosity mixes towards white / black). */
function hsl(data: Uint8ClampedArray, hue: number, saturation: number, luminosity: number): void {
  const s = 1 + Math.max(-100, Math.min(100, saturation)) / 100;
  const l = Math.max(-100, Math.min(100, luminosity)) / 100;
  for (let p = 0; p < data.length; p += 4) {
    let [h, sv, v] = rgbToHsv(data[p], data[p + 1], data[p + 2]);
    h = (((h + hue) % 360) + 360) % 360;
    sv = Math.min(1, sv * s);
    let [r, g, b] = hsvToRgb(h, sv, v);
    if (l > 0) {
      r += (255 - r) * l;
      g += (255 - g) * l;
      b += (255 - b) * l;
    } else if (l < 0) {
      r *= 1 + l;
      g *= 1 + l;
      b *= 1 + l;
    }
    data[p] = r;
    data[p + 1] = g;
    data[p + 2] = b;
  }
}

/** Shadows / midtones / highlights weighted by lightness (smooth, summing to one). */
function colorBalance(data: Uint8ClampedArray, c: Extract<Correction, { type: 'colorBalance' }>): void {
  const k = 0.5 * 2.55;
  for (let p = 0; p < data.length; p += 4) {
    const rgb: [number, number, number] = [data[p], data[p + 1], data[p + 2]];
    const l = lightness(...rgb);
    const ws = (1 - l) * (1 - l);
    const wh = l * l;
    const wm = 1 - ws - wh;
    let out: [number, number, number] = [0, 1, 2].map((i) => clamp255(rgb[i] + k * (ws * c.shadows[i] + wm * c.midtones[i] + wh * c.highlights[i]))) as [number, number, number];
    if (c.preserveLuminosity) out = withLightness(out, l);
    data[p] = out[0];
    data[p + 1] = out[1];
    data[p + 2] = out[2];
  }
}

function binarize(data: Uint8ClampedArray, threshold: number): void {
  for (let p = 0; p < data.length; p += 4) {
    const v = luma(data[p], data[p + 1], data[p + 2]) < threshold ? 0 : 255;
    data[p] = v;
    data[p + 1] = v;
    data[p + 2] = v;
  }
}

/** Brightness picks the gradient colour; the node opacity mixes it with the original. */
function gradientMap(data: Uint8ClampedArray, stops: GradientStop[]): void {
  const lut = gradientLut(stops);
  for (let p = 0; p < data.length; p += 4) {
    const i = Math.round(luma(data[p], data[p + 1], data[p + 2])) * 4;
    const a = lut[i + 3] / 255;
    data[p] += (lut[i] - data[p]) * a;
    data[p + 1] += (lut[i + 1] - data[p + 1]) * a;
    data[p + 2] += (lut[i + 2] - data[p + 2]) * a;
  }
}

/** Applies a correction in place. */
export function applyCorrection(data: Uint8ClampedArray, c: Correction): void {
  switch (c.type) {
    case 'brightnessContrast': {
      const t = brightnessContrastTable(c.brightness, c.contrast);
      applyTables(data, t, t, t);
      return;
    }
    case 'levels': {
      const m = levelsTable(c.levels.rgb);
      applyTables(data, compose(m, levelsTable(c.levels.r)), compose(m, levelsTable(c.levels.g)), compose(m, levelsTable(c.levels.b)));
      return;
    }
    case 'toneCurve': {
      const m = curveTable(c.curves.rgb);
      applyTables(data, compose(m, curveTable(c.curves.r)), compose(m, curveTable(c.curves.g)), compose(m, curveTable(c.curves.b)));
      return;
    }
    case 'hsl':
      hsl(data, c.hue, c.saturation, c.luminosity);
      return;
    case 'colorBalance':
      colorBalance(data, c);
      return;
    case 'reverse': {
      const t = tableOf((v) => 255 - v);
      applyTables(data, t, t, t);
      return;
    }
    case 'posterize': {
      const t = posterizeTable(c.levels);
      applyTables(data, t, t, t);
      return;
    }
    case 'binarize':
      binarize(data, c.threshold);
      return;
    case 'gradientMap':
      gradientMap(data, c.stops);
      return;
  }
}

/** Brightness histogram (256 bins) of the opaque-ish pixels, for the level and curve dialogs. */
export function histogram(data: Uint8ClampedArray, channel: Channel = 'rgb'): Uint32Array {
  const h = new Uint32Array(256);
  for (let p = 0; p < data.length; p += 4) {
    if (data[p + 3] < 8) continue;
    const v = channel === 'r' ? data[p] : channel === 'g' ? data[p + 1] : channel === 'b' ? data[p + 2] : Math.round(luma(data[p], data[p + 1], data[p + 2]));
    h[v]++;
  }
  return h;
}

// ------------------------------------------------------------------ validation (untrusted files)

const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
const HEX = /^#[0-9a-f]{6}$/i;

function sanitizeLevels(raw: unknown): Levels {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    inBlack: num(r.inBlack, 0, 0, 254),
    inWhite: num(r.inWhite, 255, 1, 255),
    gamma: num(r.gamma, 1, 0.1, 10),
    outBlack: num(r.outBlack, 0, 0, 255),
    outWhite: num(r.outWhite, 255, 0, 255),
  };
}

function sanitizeCurve(raw: unknown): CurvePoint[] {
  if (!Array.isArray(raw)) return structuredClone(LINE);
  const pts = raw
    .slice(0, 32)
    .filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && Number.isFinite(v)))
    .map(([x, y]) => [Math.min(255, Math.max(0, x)), Math.min(255, Math.max(0, y))] as CurvePoint);
  return pts.length >= 2 ? pts : structuredClone(LINE);
}

const balance = (v: unknown): Balance => (Array.isArray(v) ? [0, 1, 2].map((i) => num(v[i], 0, -100, 100)) : [0, 0, 0]) as Balance;

export function sanitizeStops(raw: unknown): GradientStop[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 64)
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
    .map((s) => ({
      pos: num(s.pos, 0, 0, 1),
      color: s.color === 'main' || s.color === 'sub' ? s.color : typeof s.color === 'string' && HEX.test(s.color) ? s.color.toLowerCase() : '#000000',
      opacity: num(s.opacity, 1, 0, 1),
    }));
}

/** Validates correction settings read from a file. */
export function sanitizeCorrection(raw: unknown): Correction {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const type = CORRECTIONS.some((c) => c.type === r.type) ? (r.type as CorrectionType) : 'brightnessContrast';
  const c = defaultCorrection(type);
  switch (c.type) {
    case 'brightnessContrast':
      return { ...c, brightness: num(r.brightness, 0, -100, 100), contrast: num(r.contrast, 0, -100, 100) };
    case 'levels': {
      const l = (r.levels && typeof r.levels === 'object' ? r.levels : {}) as Record<string, unknown>;
      return { ...c, levels: { rgb: sanitizeLevels(l.rgb), r: sanitizeLevels(l.r), g: sanitizeLevels(l.g), b: sanitizeLevels(l.b) } };
    }
    case 'toneCurve': {
      const k = (r.curves && typeof r.curves === 'object' ? r.curves : {}) as Record<string, unknown>;
      return { ...c, curves: { rgb: sanitizeCurve(k.rgb), r: sanitizeCurve(k.r), g: sanitizeCurve(k.g), b: sanitizeCurve(k.b) } };
    }
    case 'hsl':
      return { ...c, hue: num(r.hue, 0, -180, 180), saturation: num(r.saturation, 0, -100, 100), luminosity: num(r.luminosity, 0, -100, 100) };
    case 'colorBalance':
      return {
        ...c,
        shadows: balance(r.shadows),
        midtones: balance(r.midtones),
        highlights: balance(r.highlights),
        preserveLuminosity: typeof r.preserveLuminosity === 'boolean' ? r.preserveLuminosity : true,
      };
    case 'reverse':
      return c;
    case 'posterize':
      return { ...c, levels: Math.round(num(r.levels, 4, 2, 20)) };
    case 'binarize':
      return { ...c, threshold: num(r.threshold, 128, 1, 255) };
    case 'gradientMap': {
      const stops = sanitizeStops(r.stops).map((s) => ({ ...s, color: s.color === 'main' || s.color === 'sub' ? '#000000' : s.color }));
      return { ...c, stops: stops.length ? stops : c.stops };
    }
  }
}
