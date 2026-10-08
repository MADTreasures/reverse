/**
 * Screentones: the Tone effect of the Layer Property palette turns a layer into halftone dots.
 * Each pixel gets a threshold from its place in the rotated dot grid (shaped like the dot type);
 * where the tone density reaches it, the pixel is part of a dot. Pure, unit tested.
 */

export type DotShape = 'circle' | 'square' | 'lozenge' | 'line' | 'cross' | 'ellipse' | 'noise';

export interface ToneEffect {
  enabled: boolean;
  /** Screen frequency in lines per inch (larger: smaller dots). */
  frequency: number;
  /**
   * Where the density comes from: the image's colours (the gaps stay white), its brightness (the
   * gaps are transparent, lower layers show through) or a set value (tone layers).
   */
  density: 'color' | 'brightness' | 'fixed';
  /** Set density, 0..100 %. */
  value: number;
  /** The layer opacity changes the dot size instead of the colour. */
  reflectOpacity: boolean;
  /** Posterization: number of density steps (0 = off). */
  posterize: number;
  shape: DotShape;
  /** Degrees. */
  angle: number;
  /** Dot position (px). */
  x: number;
  y: number;
  /** Noise: grain size (px) and how much the grains vary (0..100). */
  noiseSize: number;
  noiseFactor: number;
}

export const DOT_SHAPES: [DotShape, string][] = [
  ['circle', 'Circle'],
  ['square', 'Square'],
  ['lozenge', 'Lozenge'],
  ['line', 'Line'],
  ['cross', 'Cross'],
  ['ellipse', 'Ellipse'],
  ['noise', 'Noise'],
];

/** A tone with dots of about 8 px at the document's resolution (60 lpi at 480 dpi). */
export function defaultTone(dpi: number, patch: Partial<ToneEffect> = {}): ToneEffect {
  return {
    enabled: true,
    frequency: Math.max(5, Math.min(150, Math.round(dpi / 8))),
    density: 'color',
    value: 30,
    reflectOpacity: false,
    posterize: 0,
    shape: 'circle',
    angle: 45,
    x: 0,
    y: 0,
    noiseSize: 2,
    noiseFactor: 50,
    ...patch,
  };
}

/** A repeatable number 0..1 for a grain of the noise tone. */
function hash01(x: number, y: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Coverage at which a point of a dot cell becomes part of the dot (0..1): the share of the cell the
 * dot covers when its edge reaches the point. fu, fv: position in the cell, −0.5..0.5.
 */
export function threshold(shape: DotShape, fu: number, fv: number): number {
  const au = Math.abs(fu);
  const av = Math.abs(fv);
  switch (shape) {
    case 'square': {
      const m = Math.max(au, av) * 2;
      return m * m;
    }
    case 'lozenge': {
      const s = au + av;
      return s <= 0.5 ? 2 * s * s : 1 - 2 * (1 - s) * (1 - s);
    }
    case 'line':
      return av * 2;
    case 'cross': {
      const m = 1 - 2 * Math.min(au, av);
      return 1 - m * m;
    }
    case 'ellipse': {
      // Dots 70 % as high as wide.
      const r = Math.hypot(au, av / 0.7);
      return r <= 0.5 ? Math.PI * 0.7 * r * r : Math.min(1, 0.55 + 0.45 * ((r - 0.5) / 0.372));
    }
    default: {
      const r = Math.hypot(au, av);
      // Circles until they touch; then the white gaps shrink towards the corners.
      return r <= 0.5 ? Math.PI * r * r : 0.785 + 0.215 * Math.min(1, (r - 0.5) / 0.2071);
    }
  }
}

/**
 * Turns straight RGBA bytes of a region (top-left at document position x0, y0) into tone dots.
 * Dots are black; with density from the colours the gaps are white.
 */
export function applyTone(data: Uint8ClampedArray, w: number, h: number, x0: number, y0: number, t: ToneEffect, dpi: number, opacity = 1): void {
  const cell = Math.max(1, dpi / Math.max(1, t.frequency));
  const a = (t.angle * Math.PI) / 180;
  const cos = Math.cos(a) / cell;
  const sin = Math.sin(a) / cell;
  // Width of the anti-aliased dot edge, in coverage units.
  const soft = Math.max(0.04, 2 / cell);
  const steps = t.posterize >= 2 ? t.posterize - 1 : 0;
  const grain = Math.max(1, t.noiseSize);
  const vary = Math.max(0, Math.min(100, t.noiseFactor)) / 100;
  for (let j = 0, p = 0; j < h; j++) {
    const py = y0 + j + 0.5 - t.y;
    for (let i = 0; i < w; i++, p += 4) {
      const alpha = data[p + 3];
      if (alpha === 0) continue;
      let d = t.density === 'fixed' ? t.value / 100 : 1 - (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) / 255;
      if (t.reflectOpacity) d *= opacity;
      if (steps) d = Math.round(d * steps) / steps;
      let cover: number;
      if (d <= 0) cover = 0;
      else if (d >= 1) cover = 1;
      else {
        const px = x0 + i + 0.5 - t.x;
        let th: number;
        if (t.shape === 'noise') th = 0.5 + (hash01(Math.floor(px / grain), Math.floor(py / grain)) - 0.5) * (0.2 + 0.8 * vary) * 2;
        else {
          const u = px * cos + py * sin;
          const v = -px * sin + py * cos;
          th = threshold(t.shape, u - Math.floor(u) - 0.5, v - Math.floor(v) - 0.5);
        }
        cover = Math.min(1, Math.max(0, (d - th) / soft + 0.5));
      }
      if (t.density === 'color') {
        // Black dots on white, where the layer is drawn.
        const g = 255 * (1 - cover);
        data[p] = g;
        data[p + 1] = g;
        data[p + 2] = g;
      } else {
        data[p] = 0;
        data[p + 1] = 0;
        data[p + 2] = 0;
        data[p + 3] = alpha * cover;
      }
    }
  }
}

const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);

export function sanitizeTone(raw: unknown): ToneEffect | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const d = defaultTone(300);
  return {
    enabled: r.enabled !== false,
    frequency: num(r.frequency, d.frequency, 1, 1000),
    density: r.density === 'brightness' || r.density === 'fixed' ? r.density : 'color',
    value: num(r.value, d.value, 0, 100),
    reflectOpacity: r.reflectOpacity === true,
    posterize: Math.round(num(r.posterize, 0, 0, 20)),
    shape: DOT_SHAPES.some(([s]) => s === r.shape) ? (r.shape as DotShape) : 'circle',
    angle: num(r.angle, d.angle, -360, 360),
    x: num(r.x, 0, -1e5, 1e5),
    y: num(r.y, 0, -1e5, 1e5),
    noiseSize: num(r.noiseSize, d.noiseSize, 1, 100),
    noiseFactor: num(r.noiseFactor, d.noiseFactor, 0, 100),
  };
}
