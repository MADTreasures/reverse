/**
 * The tile grids of the Intermediate Color palette (the colours between four corner colours) and
 * the Approximate Color palette (colours around the drawing colour along two chosen properties),
 * and the settings both share (grid divisions or tile width, grid lines), like the reference's.
 * Pure, unit tested.
 */
import { hexToRgb, hlsToRgb, hsvToRgb, rgbToHex, rgbToHls, rgbToHsv, type RGB } from '../model/color';

// ------------------------------------------------------------------ tiles

/** Grid divisions into 10/20/30 parts, or Tile width 7/10/15 pt; Show grid. */
export interface TileGrid {
  mode: 'divisions' | 'width';
  divisions: 10 | 20 | 30;
  tileWidth: 7 | 10 | 15;
  showGrid: boolean;
}

export const DEFAULT_TILE_GRID: TileGrid = { mode: 'divisions', divisions: 20, tileWidth: 10, showGrid: true };

/** Points to CSS pixels (1 pt = 1/72 in, 96 px per inch). */
const PT = 96 / 72;

/** Tiles in a row of `width` px: the divisions, or as many tiles of the tile width as fit. */
export function tilesAcross(g: TileGrid, width: number): number {
  if (g.mode === 'divisions') return g.divisions;
  return Math.max(1, Math.floor(width / (g.tileWidth * PT)));
}

// ------------------------------------------------------------------ Intermediate Color

/** The corner colours: top left, top right, bottom left, bottom right. */
export type Corners = [string, string, string, string];

/** Own defaults: white, a green, a blue and black (like the reference's screenshot). */
export const DEFAULT_CORNERS: Corners = ['#ffffff', '#33cc55', '#2233ff', '#000000'];

/**
 * Tile (col, row) of a cols × rows grid between the corner colours, mixed bilinearly in RGB: the
 * corner tiles have the corner colours.
 */
export function intermediateColor(corners: readonly RGB[], col: number, row: number, cols: number, rows: number): RGB {
  const u = cols > 1 ? col / (cols - 1) : 0;
  const v = rows > 1 ? row / (rows - 1) : 0;
  const [tl, tr, bl, br] = corners;
  const mix = (k: keyof RGB) => Math.round((1 - v) * ((1 - u) * tl[k] + u * tr[k]) + v * ((1 - u) * bl[k] + u * br[k]));
  return { r: mix('r'), g: mix('g'), b: mix('b') };
}

// ------------------------------------------------------------------ Approximate Color

/** Hue, Saturation, Luminosity(V), Luminance, Red, Green, Blue. */
export type ApproxAxis = 'hue' | 'saturation' | 'value' | 'luminance' | 'red' | 'green' | 'blue';

/** Each axis: its id, its name in the menu and its letter at the slider. */
export const APPROX_AXES: [ApproxAxis, string, string][] = [
  ['hue', 'Hue', 'H'],
  ['saturation', 'Saturation', 'S'],
  ['value', 'Luminosity(V)', 'V'],
  ['luminance', 'Luminance', 'L'],
  ['red', 'Red', 'R'],
  ['green', 'Green', 'G'],
  ['blue', 'Blue', 'B'],
];

/** One slider: the property it changes and how much (0..1 of the property's range, across the grid). */
export interface ApproxSlider {
  axis: ApproxAxis;
  range: number;
}

export interface ApproxSettings {
  /** The slider above the grid (left to right) and the one beside it (bottom to top). */
  x: ApproxSlider;
  y: ApproxSlider;
  grid: TileGrid;
}

/** Own defaults (the reference's screenshot: V 40 % across, S 40 % up). */
export const DEFAULT_APPROX: ApproxSettings = { x: { axis: 'value', range: 0.4 }, y: { axis: 'saturation', range: 0.4 }, grid: DEFAULT_TILE_GRID };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const clamp255 = (x: number) => Math.round(Math.min(255, Math.max(0, x)));

/** A colour with one property shifted by `amount` of its range (-1..1): hue goes round, the others stop at their ends. */
export function shiftColor(c: RGB, axis: ApproxAxis, amount: number): RGB {
  if (!amount) return c;
  if (axis === 'red' || axis === 'green' || axis === 'blue') {
    const k = axis === 'red' ? 'r' : axis === 'green' ? 'g' : 'b';
    return { ...c, [k]: clamp255(c[k] + amount * 255) };
  }
  if (axis === 'luminance') {
    const x = rgbToHls(c);
    return hlsToRgb({ ...x, l: clamp01(x.l + amount) });
  }
  const x = rgbToHsv(c);
  if (axis === 'hue') return hsvToRgb({ ...x, h: x.h + amount * 360 });
  if (axis === 'saturation') return hsvToRgb({ ...x, s: clamp01(x.s + amount) });
  return hsvToRgb({ ...x, v: clamp01(x.v + amount) });
}

/** The tile of the drawing colour: the middle one (left and up of the middle when the count is even). */
export const middleTile = (cols: number, rows: number) => ({ col: Math.floor((cols - 1) / 2), row: Math.floor((rows - 1) / 2) });

/**
 * Tile (col, row) of the grid around `base` (the middle tile): to the right the x property grows,
 * upwards the y property; the farthest tiles differ by half the slider's range.
 */
export function approximateColor(base: RGB, s: Pick<ApproxSettings, 'x' | 'y'>, col: number, row: number, cols: number, rows: number): RGB {
  const mid = middleTile(cols, rows);
  const spanX = Math.max(1, mid.col, cols - 1 - mid.col);
  const spanY = Math.max(1, mid.row, rows - 1 - mid.row);
  const ax = ((col - mid.col) / spanX) * (s.x.range / 2);
  const ay = ((mid.row - row) / spanY) * (s.y.range / 2);
  return shiftColor(shiftColor(base, s.x.axis, ax), s.y.axis, ay);
}

// ------------------------------------------------------------------ settings

const isAxis = (v: unknown): v is ApproxAxis => APPROX_AXES.some(([id]) => id === v);

export function sanitizeTileGrid(raw: unknown): TileGrid {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_TILE_GRID;
  return {
    mode: r.mode === 'width' ? 'width' : 'divisions',
    divisions: r.divisions === 10 || r.divisions === 30 ? r.divisions : d.divisions,
    tileWidth: r.tileWidth === 7 || r.tileWidth === 15 ? r.tileWidth : d.tileWidth,
    showGrid: typeof r.showGrid === 'boolean' ? r.showGrid : d.showGrid,
  };
}

export function sanitizeCorners(raw: unknown): Corners {
  const list = Array.isArray(raw) ? raw : [];
  return DEFAULT_CORNERS.map((d, i) => (typeof list[i] === 'string' && hexToRgb(list[i]) ? rgbToHex(hexToRgb(list[i])!) : d)) as Corners;
}

export function sanitizeApprox(raw: unknown): ApproxSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const slider = (v: unknown, d: ApproxSlider): ApproxSlider => {
    const x = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    return { axis: isAxis(x.axis) ? x.axis : d.axis, range: typeof x.range === 'number' && Number.isFinite(x.range) ? clamp01(x.range) : d.range };
  };
  return { x: slider(r.x, DEFAULT_APPROX.x), y: slider(r.y, DEFAULT_APPROX.y), grid: sanitizeTileGrid(r.grid) };
}
