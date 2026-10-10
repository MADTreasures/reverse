/**
 * The Filter menu: every filter with its menu group, label and dialog settings (as documented for
 * the reference; ranges and defaults are our own where the manual gives none), and `runFilter`,
 * which computes a filter for a rectangle of a layer.
 */
import { blur, blurStrong, gaussianBlur, lensBlur, motionBlur, radialBlur, sharpen, smoothing, spinBlur, unsharpMask, type BlurMode, type LensShape } from './blur';
import { adjustLineWidth, removeDust, type DustMode } from './correction';
import { curvedSurface, effectEllipse, fisheye, geometricDistortion, panorama, pinch, polarCoordinates, ripple, twirl, wave, zigzag, type AreaMode, type PolarMethod, type WaveShape } from './distort';
import { artistic, chromaticAberration, crystallize, mosaic, noise, normalMap, pencilDrawing, removeJpegNoise, retroFilm, RETRO_PRESETS, type ArtisticProcess, type RetroEffect, type RetroPreset } from './effect';
import { cropImg, gaussianReach, growRect, type Img, type Rect } from './core';
import { perlinNoise } from './render';

export type { Img, Rect } from './core';

export type FilterGroup = 'blur' | 'sharpen' | 'effect' | 'distort' | 'render' | 'correction';

export const FILTER_GROUPS: { id: FilterGroup; label: string }[] = [
  { id: 'blur', label: 'Blur' },
  { id: 'sharpen', label: 'Sharpen' },
  { id: 'effect', label: 'Effect' },
  { id: 'distort', label: 'Distort' },
  { id: 'render', label: 'Render' },
  { id: 'correction', label: 'Correction' },
];

export type FilterId =
  | 'blur'
  | 'blurStrong'
  | 'gaussianBlur'
  | 'lensBlur'
  | 'smoothing'
  | 'radialBlur'
  | 'motionBlur'
  | 'spinBlur'
  | 'unsharpMask'
  | 'sharpen'
  | 'sharpenMore'
  | 'artistic'
  | 'chromaticAberration'
  | 'crystallize'
  | 'mosaic'
  | 'noise'
  | 'normalMap'
  | 'pencilDrawing'
  | 'removeJpegNoise'
  | 'retroFilm'
  | 'pinch'
  | 'ripple'
  | 'curvedSurface'
  | 'panorama'
  | 'geometricDistortion'
  | 'polarCoordinates'
  | 'zigzag'
  | 'wave'
  | 'twirl'
  | 'fisheye'
  | 'perlinNoise'
  | 'removeDust'
  | 'adjustLineWidth';

export type FilterValue = number | string | boolean;
export type FilterValues = Record<string, FilterValue>;

interface ParamBase {
  key: string;
  label: string;
  /** Hidden (and ignored) unless this holds for the current values. */
  show?: (v: FilterValues) => boolean;
}

export type FilterParam =
  | (ParamBase & { kind: 'number'; min: number; max: number; default: number; step?: number })
  | (ParamBase & { kind: 'select'; options: [string, string][]; default: string; presets?: Record<string, FilterValues> })
  | (ParamBase & { kind: 'check'; default: boolean })
  /** A button that picks a new random seed (Wave > Regenerate). */
  | (ParamBase & { kind: 'seed'; default: number });

export interface FilterSpec {
  id: FilterId;
  group: FilterGroup;
  label: string;
  /** No settings: the filter runs straight from the menu. */
  params: FilterParam[];
  /** Shows the red × on the canvas that sets the centre (values cx, cy). */
  center?: boolean;
  /** How far around the layer's content the filter can change pixels, or 'all' (the whole area). */
  reach: (v: FilterValues) => number | 'all';
}

const num = (key: string, label: string, min: number, max: number, def: number, step = 1, show?: ParamBase['show']): FilterParam => ({ kind: 'number', key, label, min, max, default: def, step, show });
const sel = (key: string, label: string, options: [string, string][], def: string, show?: ParamBase['show']): FilterParam => ({ kind: 'select', key, label, options, default: def, show });
const check = (key: string, label: string, def: boolean, show?: ParamBase['show']): FilterParam => ({ kind: 'check', key, label, default: def, show });

const BLUR_MODE: [string, string][] = [
  ['box', 'Box'],
  ['smooth', 'Smooth'],
];
const specified = (v: FilterValues) => v.area === 'specify';
/** Area / Radius / Shape of the centred distortions. */
const AREA: FilterParam[] = [
  sel(
    'area',
    'Area',
    [
      ['selection', 'Entire selection'],
      ['specify', 'Specify area (use Radius and Shape)'],
    ],
    'selection',
  ),
  num('radius', 'Radius', 1, 4000, 200, 1, specified),
  num('shape', 'Shape', -100, 100, 0, 1, specified),
];
const all = () => 'all' as const;

export const FILTERS: FilterSpec[] = [
  { id: 'blur', group: 'blur', label: 'Blur', params: [], reach: () => 2 },
  { id: 'blurStrong', group: 'blur', label: 'Blur (strong)', params: [], reach: () => 3 },
  { id: 'gaussianBlur', group: 'blur', label: 'Gaussian blur', params: [num('strength', 'Strength', 0, 200, 5, 0.01)], reach: (v) => gaussianReach(Number(v.strength) / 2) },
  {
    id: 'lensBlur',
    group: 'blur',
    label: 'Lens blur',
    params: [
      num('strength', 'Strength', 0, 100, 10, 0.1),
      sel(
        'shape',
        'Highlight shape',
        [
          ['triangle', 'Triangle'],
          ['square', 'Square'],
          ['pentagon', 'Pentagon'],
          ['hexagon', 'Hexagon'],
          ['heptagon', 'Heptagon'],
          ['octagon', 'Octagon'],
        ],
        'hexagon',
      ),
      num('intensity', 'Highlight intensity', 0, 100, 50),
      num('roundness', 'Highlight roundness', 0, 100, 0),
      num('angle', 'Highlight angle', -180, 180, 0),
    ],
    reach: (v) => Math.ceil(Number(v.strength)) + 8,
  },
  { id: 'smoothing', group: 'blur', label: 'Smoothing', params: [], reach: () => 2 },
  {
    id: 'radialBlur',
    group: 'blur',
    label: 'Radial blur',
    center: true,
    params: [
      num('strength', 'Strength', 0, 100, 10, 0.1),
      sel(
        'direction',
        'Direction',
        [
          ['both', 'Both directions'],
          ['outward', 'Outward'],
          ['inward', 'Inward'],
        ],
        'both',
      ),
      sel('mode', 'Mode', BLUR_MODE, 'box'),
    ],
    reach: all,
  },
  {
    id: 'motionBlur',
    group: 'blur',
    label: 'Motion blur',
    params: [
      num('strength', 'Strength', 0, 1000, 10, 0.01),
      num('angle', 'Angle', -180, 180, 0),
      sel(
        'direction',
        'Direction',
        [
          ['both', 'Both directions'],
          ['forward', 'Forward'],
          ['backward', 'Backward'],
        ],
        'both',
      ),
      sel('mode', 'Mode', BLUR_MODE, 'box'),
    ],
    reach: (v) => Math.ceil(Number(v.strength)) + 2,
  },
  {
    id: 'spinBlur',
    group: 'blur',
    label: 'Spin blur',
    center: true,
    params: [
      num('strength', 'Strength', 0, 100, 10, 0.1),
      sel(
        'direction',
        'Direction',
        [
          ['both', 'Both directions'],
          ['right', 'Rotate right'],
          ['left', 'Rotate left'],
        ],
        'both',
      ),
      num('shape', 'Shape', 0.1, 10, 1, 0.1),
      num('tilt', 'Tilt', -180, 180, 0, 1, (v) => Number(v.shape) !== 1),
    ],
    reach: all,
  },
  {
    id: 'unsharpMask',
    group: 'sharpen',
    label: 'Unsharp mask',
    params: [num('radius', 'Radius', 0.1, 100, 5, 0.1), num('strength', 'Strength', 1, 500, 100), num('threshold', 'Threshold', 0, 255, 0)],
    reach: (v) => gaussianReach(Number(v.radius) / 2),
  },
  { id: 'sharpen', group: 'sharpen', label: 'Sharpen', params: [], reach: () => 2 },
  { id: 'sharpenMore', group: 'sharpen', label: 'Sharpen more', params: [], reach: () => 2 },
  {
    id: 'artistic',
    group: 'effect',
    label: 'Artistic',
    params: [
      sel(
        'process',
        'Process',
        [
          ['colorLines', 'Color and lines'],
          ['colorOnly', 'Color only'],
          ['linesOnly', 'Lines only'],
        ],
        'colorLines',
      ),
      num('lineWidth', 'Line width', 1, 10, 2, 1, (v) => v.process !== 'colorOnly'),
      num('lineSimplicity', 'Line simplicity', 0, 100, 30, 1, (v) => v.process !== 'colorOnly'),
      num('lineDensity', 'Line density', 0, 100, 50, 1, (v) => v.process !== 'colorOnly'),
      num('lineOpacity', 'Line opacity', 0, 100, 100, 1, (v) => v.process !== 'colorOnly'),
      num('lineAntialias', 'Line anti-aliasing', 0, 100, 30, 1, (v) => v.process !== 'colorOnly'),
      num('colorBlending', 'Color blending', 0, 100, 50, 1, (v) => v.process !== 'linesOnly'),
      num('colorBlur', 'Color blur', 0, 100, 20, 1, (v) => v.process !== 'linesOnly'),
      num('colors', 'Number of colors', 2, 64, 8, 1, (v) => v.process !== 'linesOnly'),
    ],
    reach: () => 16,
  },
  {
    id: 'chromaticAberration',
    group: 'effect',
    label: 'Chromatic aberration',
    center: true,
    params: [
      sel(
        'mode',
        'Mode',
        [
          ['radial', 'Radial'],
          ['lateral', 'Lateral'],
        ],
        'radial',
      ),
      num('intensity', 'Intensity', 0, 100, 30),
      num('angle', 'Angle', -180, 180, 0, 1, (v) => v.mode === 'lateral'),
    ],
    reach: all,
  },
  {
    id: 'crystallize',
    group: 'effect',
    label: 'Crystallize',
    params: [num('size', 'Cell size', 2, 500, 20), num('randomness', 'Randomness', 0, 100, 70), check('tiling', 'Tiling', false)],
    reach: all,
  },
  { id: 'mosaic', group: 'effect', label: 'Mosaic', params: [num('size', 'Tile size', 1, 300, 10, 0.01)], reach: all },
  {
    id: 'noise',
    group: 'effect',
    label: 'Noise',
    params: [
      sel(
        'colorMode',
        'Color mode',
        [
          ['color', 'Color'],
          ['gray', 'Gray'],
        ],
        'color',
      ),
      num('strength', 'Noise strength', 0, 100, 20),
    ],
    reach: () => 0,
  },
  {
    id: 'normalMap',
    group: 'effect',
    label: 'Normal map',
    params: [
      num('strength', 'Strength', 0, 100, 30),
      sel(
        'orientation',
        'Y orientation',
        [
          ['up', 'Y up'],
          ['down', 'Y down'],
        ],
        'up',
      ),
    ],
    reach: all,
  },
  {
    id: 'pencilDrawing',
    group: 'effect',
    label: 'Pencil drawing',
    params: [
      check('outline', 'Show outline', true),
      check('hatching', 'Show hatching', true),
      num('size', 'Hatching size', 1, 20, 3, 1, (v) => v.hatching === true),
      num('roughness', 'Hatching roughness', 0, 100, 40, 1, (v) => v.hatching === true),
      num('angle', 'Hatching angle', -180, 180, 45, 1, (v) => v.hatching === true),
      check('grayscale', 'Greyscale output', true),
    ],
    reach: all,
  },
  { id: 'removeJpegNoise', group: 'effect', label: 'Remove jpeg noise', params: [], reach: () => 3 },
  {
    id: 'retroFilm',
    group: 'effect',
    label: 'Retro film',
    center: true,
    params: [
      {
        kind: 'select',
        key: 'preset',
        label: 'Preset',
        options: [
          ['vintage', 'Vintage'],
          ['modern', 'Modern'],
          ['warm', 'Warm'],
        ],
        default: 'vintage',
        presets: Object.fromEntries(Object.entries(RETRO_PRESETS).map(([k, p]) => [k, { ...p }])),
      },
      sel(
        'effect',
        'Effect',
        [
          ['none', 'None'],
          ['sepia', 'Sepia'],
          ['leakSlant', 'Light leak (slant)'],
          ['leakAll', 'Light leak (all)'],
          ['sepiaLeakSlant', 'Sepia + Light leak (slant)'],
          ['sepiaLeakAll', 'Sepia + Light leak (all)'],
        ],
        RETRO_PRESETS.vintage.effect,
      ),
      num('intensity', 'Intensity', 0, 100, RETRO_PRESETS.vintage.intensity),
      num('noise', 'Noise strength', 0, 100, RETRO_PRESETS.vintage.noise),
    ],
    reach: all,
  },
  { id: 'pinch', group: 'distort', label: 'Pinch', center: true, params: [num('strength', 'Strength', -100, 100, 50), ...AREA], reach: all },
  { id: 'ripple', group: 'distort', label: 'Ripple', center: true, params: [num('rotation', 'Rotation', -360, 360, 30), num('waves', 'Number of waves', 1, 50, 4), ...AREA], reach: all },
  {
    id: 'curvedSurface',
    group: 'distort',
    label: 'Curved surface',
    center: true,
    params: [
      num('strength', 'Strength', -100, 100, 50),
      sel(
        'method',
        'Method',
        [
          ['cylinder', 'Cylinder'],
          ['sphere', 'Sphere'],
        ],
        'cylinder',
      ),
      num('angle', 'Angle', -180, 180, 0, 1, (v) => v.method === 'cylinder'),
      ...AREA,
    ],
    reach: all,
  },
  {
    id: 'panorama',
    group: 'distort',
    label: 'Convert to panorama',
    center: true,
    params: [num('distortion', 'Distortion', 0, 100, 50), num('angle', 'Angle', -90, 90, 0), num('scale', 'Scale ratio', 10, 400, 100)],
    reach: all,
  },
  { id: 'geometricDistortion', group: 'distort', label: 'Geometric distortion', center: true, params: [num('distortion', 'Distortion', -100, 100, 30), num('scale', 'Scale ratio', 10, 400, 100)], reach: all },
  {
    id: 'polarCoordinates',
    group: 'distort',
    label: 'Polar coordinates',
    params: [
      sel(
        'method',
        'Transformation method',
        [
          ['rectToPolar', 'Rectangular to polar'],
          ['polarToRect', 'Polar to rectangular'],
          ['spherize', 'Spherize'],
        ],
        'rectToPolar',
      ),
    ],
    reach: all,
  },
  { id: 'zigzag', group: 'distort', label: 'ZigZag', params: [num('angle', 'Angle', -180, 180, 0), num('height', 'Wave height', 0, 500, 10), num('waves', 'Number of waves', 0, 100, 10)], reach: all },
  {
    id: 'wave',
    group: 'distort',
    label: 'Wave',
    params: [
      sel(
        'shape',
        'Shape',
        [
          ['sine', 'Sine'],
          ['triangle', 'Triangle'],
          ['square', 'Rectangular'],
        ],
        'sine',
      ),
      num('generators', 'Number of waves', 1, 99, 5),
      num('wavelengthMin', 'Wavelength (Minimum)', 1, 999, 10),
      num('wavelengthMax', 'Wavelength (Maximum)', 1, 999, 120),
      num('amplitudeMin', 'Amplitude (Minimum)', 0, 999, 5),
      num('amplitudeMax', 'Amplitude (Maximum)', 0, 999, 35),
      num('horizontal', 'Horizontal ratio', 0, 100, 100),
      num('vertical', 'Vertical ratio', 0, 100, 100),
      sel(
        'undefined',
        'Undefined areas',
        [
          ['wrap', 'Wrap around'],
          ['edge', 'Repeat edge pixels'],
        ],
        'wrap',
      ),
      { kind: 'seed', key: 'seed', label: 'Regenerate', default: 1 },
    ],
    reach: all,
  },
  { id: 'twirl', group: 'distort', label: 'Twirl', center: true, params: [num('twist', 'Twist', -1080, 1080, 90), num('tension', 'Tension', 0, 100, 25), ...AREA], reach: all },
  { id: 'fisheye', group: 'distort', label: 'Fish-eye lens', center: true, params: [num('distortion', 'Distortion', 0, 100, 50), ...AREA], reach: all },
  {
    id: 'perlinNoise',
    group: 'render',
    label: 'Perlin noise',
    params: [
      num('scale', 'Scale', 1, 1000, 100),
      num('amplitude', 'Amplitude', 0, 100, 60),
      num('attenuation', 'Attenuation', 0, 100, 50),
      num('repetition', 'Repetition', 1, 10, 5),
      num('offsetX', 'Offset X', 0, 10000, 0),
      num('offsetY', 'Offset Y', 0, 10000, 0),
    ],
    reach: all,
  },
  {
    id: 'removeDust',
    group: 'correction',
    label: 'Remove dust',
    params: [
      num('size', 'Dust size', 1, 100, 5),
      sel(
        'mode',
        'Mode',
        [
          ['transparent', 'Remove dust from transparency'],
          ['white', 'Remove dust from white background'],
          ['fillSurrounding', 'Fill transparent gaps with surrounding color'],
          ['fillColor', 'Fill transparent gaps with foreground color'],
        ],
        'transparent',
      ),
    ],
    reach: all,
  },
  {
    id: 'adjustLineWidth',
    group: 'correction',
    label: 'Adjust line width',
    params: [
      sel(
        'process',
        'Process',
        [
          ['narrow', 'Narrow'],
          ['thicken', 'Thicken'],
        ],
        'thicken',
      ),
      num('amount', 'Scale', 0.1, 20, 1, 0.1),
      check('keepOne', 'At least 1 pixel', true, (v) => v.process === 'narrow'),
    ],
    reach: (v) => Math.ceil(Number(v.amount)) + 2,
  },
];

export const filterSpec = (id: FilterId): FilterSpec => FILTERS.find((f) => f.id === id)!;

/** Default settings of a filter (the centre comes from the caller). */
export function defaultValues(id: FilterId): FilterValues {
  return Object.fromEntries(filterSpec(id).params.map((p) => [p.key, p.default]));
}

/** Settings sent to the filter: defaults for anything missing, numbers kept in range. */
export function sanitizeValues(id: FilterId, raw: FilterValues): FilterValues {
  const out: FilterValues = { ...raw };
  for (const p of filterSpec(id).params) {
    const v = raw[p.key];
    if (p.kind === 'number') {
      const n = Number(v);
      out[p.key] = Number.isFinite(n) ? Math.min(p.max, Math.max(p.min, n)) : p.default;
    } else if (p.kind === 'select') out[p.key] = p.options.some(([k]) => k === v) ? String(v) : p.default;
    else if (p.kind === 'check') out[p.key] = typeof v === 'boolean' ? v : p.default;
    else out[p.key] = Number.isFinite(Number(v)) ? Number(v) : p.default;
  }
  return out;
}

export interface FilterContext {
  /** The selection's bounding box, or the whole layer. */
  bounds: Rect;
  /** Drawing colour, for "Fill transparent gaps with foreground color". */
  color: [number, number, number];
  /** Seed for noise and patterns, fixed per dialog so previews match the result. */
  seed: number;
}

/** The pixels a filter may change on a layer: the area, or only near the content for local filters. */
export function filterRegion(id: FilterId, values: FilterValues, layer: Img, area: Rect, content: Rect | null): Rect | null {
  const reach = filterSpec(id).reach(values);
  if (reach === 'all') return area;
  if (!content) return null;
  const grown = growRect(content, reach, layer.width, layer.height);
  const x0 = Math.max(grown.x, area.x);
  const y0 = Math.max(grown.y, area.y);
  const x1 = Math.min(grown.x + grown.w, area.x + area.w);
  const y1 = Math.min(grown.y + grown.h, area.y + area.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/**
 * Runs filter `id` on `src` (a whole layer) and returns the pixels of `out` (layer coordinates).
 * Neighbourhood filters work on `out` plus their reach; the others read the whole layer.
 */
export function runFilter(id: FilterId, src: Img, raw: FilterValues, out: Rect, ctx: FilterContext): Img {
  const v = sanitizeValues(id, raw);
  const n = (k: string) => Number(v[k]);
  const s = (k: string) => String(v[k]);
  const reach = filterSpec(id).reach(v);
  const cx = Number.isFinite(Number(v.cx)) ? Number(v.cx) : src.width / 2;
  const cy = Number.isFinite(Number(v.cy)) ? Number(v.cy) : src.height / 2;
  const ellipse = () => effectEllipse(cx, cy, ctx.bounds, s('area') as AreaMode, n('radius'), n('shape'));
  // Local filters: compute on the output plus a margin, then cut the output out.
  const local = (fn: (img: Img, ox: number, oy: number) => Img): Img => {
    const margin = reach === 'all' ? 0 : reach;
    const work = growRect(out, margin, src.width, src.height);
    const result = fn(cropImg(src, work), work.x, work.y);
    return cropImg(result, { x: out.x - work.x, y: out.y - work.y, w: out.w, h: out.h });
  };
  // Whole-layer filters that are computed per pixel of the output from the full layer.
  const whole = (fn: (img: Img) => Img): Img => cropImg(fn(src), out);
  switch (id) {
    case 'blur':
      return local(blur);
    case 'blurStrong':
      return local(blurStrong);
    case 'gaussianBlur':
      return local((img) => gaussianBlur(img, n('strength')));
    case 'lensBlur':
      return local((img) => lensBlur(img, n('strength'), s('shape') as LensShape, n('intensity'), n('roundness'), n('angle')));
    case 'smoothing':
      return local(smoothing);
    case 'radialBlur':
      return whole((img) => radialBlur(img, 0, 0, cx, cy, n('strength'), s('direction') as 'both' | 'outward' | 'inward', s('mode') as BlurMode));
    case 'motionBlur':
      return local((img, ox, oy) => motionBlur(img, ox, oy, n('strength'), n('angle'), s('direction') as 'both' | 'forward' | 'backward', s('mode') as BlurMode));
    case 'spinBlur':
      return whole((img) => spinBlur(img, 0, 0, cx, cy, n('strength'), s('direction') as 'both' | 'right' | 'left', n('shape'), n('tilt')));
    case 'unsharpMask':
      return local((img) => unsharpMask(img, n('radius'), n('strength'), n('threshold')));
    case 'sharpen':
      return local((img) => sharpen(img, false));
    case 'sharpenMore':
      return local((img) => sharpen(img, true));
    case 'artistic':
      return local((img) =>
        artistic(img, {
          process: s('process') as ArtisticProcess,
          lineWidth: n('lineWidth'),
          lineSimplicity: n('lineSimplicity'),
          lineDensity: n('lineDensity'),
          lineOpacity: n('lineOpacity'),
          lineAntialias: n('lineAntialias'),
          colorBlending: n('colorBlending'),
          colorBlur: n('colorBlur'),
          colors: n('colors'),
        }),
      );
    case 'chromaticAberration':
      return whole((img) => chromaticAberration(img, 0, 0, cx, cy, s('mode') === 'radial', n('intensity'), n('angle')));
    case 'crystallize':
      return whole((img) => crystallize(img, 0, 0, src.width, src.height, n('size'), n('randomness'), v.tiling === true, ctx.seed));
    case 'mosaic':
      return local((img, ox, oy) => mosaic(img, ox, oy, n('size')));
    case 'noise':
      return local((img, ox, oy) => noise(img, ox, oy, n('strength'), s('colorMode') === 'gray', ctx.seed));
    case 'normalMap':
      return local((img) => normalMap(img, n('strength'), s('orientation') === 'up'));
    case 'pencilDrawing':
      return local((img, ox, oy) =>
        pencilDrawing(img, ox, oy, { outline: v.outline === true, hatching: v.hatching === true, size: n('size'), roughness: n('roughness'), angle: n('angle'), grayscale: v.grayscale === true }, ctx.seed),
      );
    case 'removeJpegNoise':
      return local(removeJpegNoise);
    case 'retroFilm':
      return whole((img) => retroFilm(img, 0, 0, src.width, src.height, cx, cy, s('effect') as RetroEffect, n('intensity'), n('noise'), ctx.seed));
    case 'pinch':
      return pinch(src, out, ellipse(), n('strength'));
    case 'ripple':
      return ripple(src, out, ellipse(), n('rotation'), n('waves'));
    case 'curvedSurface':
      return curvedSurface(src, out, ellipse(), n('strength'), s('method') === 'sphere', n('angle'));
    case 'panorama':
      return panorama(src, out, cx, cy, ctx.bounds, n('distortion'), n('angle'), n('scale'));
    case 'geometricDistortion':
      return geometricDistortion(src, out, cx, cy, ctx.bounds, n('distortion'), n('scale'));
    case 'polarCoordinates':
      return polarCoordinates(src, out, ctx.bounds, s('method') as PolarMethod);
    case 'zigzag':
      return zigzag(src, out, ctx.bounds, n('angle'), n('height'), n('waves'));
    case 'wave':
      return wave(src, out, {
        shape: s('shape') as WaveShape,
        generators: n('generators'),
        wavelengthMin: n('wavelengthMin'),
        wavelengthMax: n('wavelengthMax'),
        amplitudeMin: n('amplitudeMin'),
        amplitudeMax: n('amplitudeMax'),
        horizontal: n('horizontal'),
        vertical: n('vertical'),
        wrap: s('undefined') === 'wrap',
        seed: n('seed'),
      });
    case 'twirl':
      return twirl(src, out, ellipse(), n('twist'), n('tension'));
    case 'fisheye':
      return fisheye(src, out, ellipse(), n('distortion'));
    case 'perlinNoise':
      return perlinNoise(out, { scale: n('scale'), amplitude: n('amplitude'), attenuation: n('attenuation'), repetition: n('repetition'), offsetX: n('offsetX'), offsetY: n('offsetY') });
    case 'removeDust':
      return whole((img) => removeDust(img, n('size'), s('mode') as DustMode, ctx.color));
    case 'adjustLineWidth':
      return local((img) => adjustLineWidth(img, s('process') === 'thicken', n('amount'), v.keepOne === true));
  }
}

export type { RetroPreset };
