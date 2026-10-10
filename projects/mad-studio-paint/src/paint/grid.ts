/**
 * View > Grid and View > Ruler bar: where the grid lines lie (from the start point, a gap with
 * subdivisions, like the reference's Grid/Ruler bar settings) and the ticks of the ruler bar.
 * Pure, unit tested.
 */

export type GridOrigin = 'topLeft' | 'topRight' | 'center' | 'bottomLeft' | 'bottomRight' | 'custom';

export const GRID_ORIGINS: [GridOrigin, string][] = [
  ['topLeft', 'Top left'],
  ['topRight', 'Top right'],
  ['center', 'Center'],
  ['bottomLeft', 'Bottom left'],
  ['bottomRight', 'Bottom right'],
  ['custom', 'Custom'],
];

export interface GridSettings {
  /** Start point of the grid and the ruler bar (0 of the ruler). */
  origin: GridOrigin;
  /** Custom start point in pixels. */
  x: number;
  y: number;
  /** Gap between the main grid lines in pixels. */
  gap: number;
  /** Each gap is divided into this many parts by fainter lines. */
  divisions: number;
}

/** The reference's default: 10 mm with 4 divisions from the top left. */
export const defaultGrid = (dpi: number): GridSettings => ({ origin: 'topLeft', x: 0, y: 0, gap: Math.max(2, Math.round((10 * dpi) / 25.4)), divisions: 4 });

/** The start point in document pixels. */
export function gridOrigin(g: GridSettings, w: number, h: number): { x: number; y: number } {
  switch (g.origin) {
    case 'topRight':
      return { x: w, y: 0 };
    case 'center':
      return { x: w / 2, y: h / 2 };
    case 'bottomLeft':
      return { x: 0, y: h };
    case 'bottomRight':
      return { x: w, y: h };
    case 'custom':
      return { x: g.x, y: g.y };
    default:
      return { x: 0, y: 0 };
  }
}

export interface GridLine {
  pos: number;
  major: boolean;
}

/** Grid lines along one axis between `from` and `to` (document pixels), at most `limit` of them. */
export function gridLines(origin: number, gap: number, divisions: number, from: number, to: number, limit = 4000): GridLine[] {
  const step = gap / Math.max(1, Math.round(divisions));
  if (!(step > 0) || to < from) return [];
  const out: GridLine[] = [];
  const first = Math.ceil((from - origin) / step - 1e-9);
  for (let i = first; out.length < limit; i++) {
    const pos = origin + i * step;
    if (pos > to + 1e-9) break;
    const k = Math.round(divisions);
    out.push({ pos, major: k <= 1 || ((i % k) + k) % k === 0 });
  }
  return out;
}

/** The nearest grid line (subdivisions included) to `v` along one axis. */
export function nearestLine(origin: number, gap: number, divisions: number, v: number): number {
  const step = gap / Math.max(1, Math.round(divisions));
  return origin + Math.round((v - origin) / step) * step;
}

/** Grid settings from a file, completed and kept sensible. */
export function sanitizeGrid(raw: unknown, dpi: number): GridSettings | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const d = defaultGrid(dpi);
  const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
  return {
    origin: GRID_ORIGINS.some(([k]) => k === r.origin) ? (r.origin as GridOrigin) : d.origin,
    x: num(r.x, 0, -1e5, 1e5),
    y: num(r.y, 0, -1e5, 1e5),
    gap: num(r.gap, d.gap, 1, 10000),
    divisions: Math.round(num(r.divisions, d.divisions, 1, 100)),
  };
}

export interface RulerTick {
  pos: number;
  /** Label (only on the long ticks). */
  label?: string;
  size: 'long' | 'mid' | 'short';
}

/**
 * Ticks of a ruler bar showing document pixels from `from` to `to` at `zoom` (screen pixels per
 * document pixel): labelled long ticks at least ~60 screen pixels apart (1, 2 or 5 × 10ⁿ), short
 * ticks in tenths (a mid tick at the half) when there is room.
 */
export function rulerTicks(origin: number, from: number, to: number, zoom: number): RulerTick[] {
  const minDoc = 60 / Math.max(1e-6, zoom);
  const pow = 10 ** Math.floor(Math.log10(minDoc));
  const step = [1, 2, 5, 10].map((k) => k * pow).find((s) => s >= minDoc) ?? 10 * pow;
  const minor = step / 10 >= 4 / zoom ? step / 10 : step / 2 >= 4 / zoom ? step / 2 : 0;
  const out: RulerTick[] = [];
  const unit = minor || step;
  const first = Math.ceil((from - origin) / unit - 1e-9);
  for (let i = first; out.length < 2000; i++) {
    const rel = i * unit;
    const pos = origin + rel;
    if (pos > to + 1e-9) break;
    const k = Math.round(rel / step);
    if (Math.abs(rel - k * step) < unit * 1e-6) out.push({ pos, label: String(Math.round(k * step)), size: 'long' });
    else if (Math.abs(rel - (k + 0.5) * step) < unit * 1e-6 || Math.abs(rel - (k - 0.5) * step) < unit * 1e-6) out.push({ pos, size: 'mid' });
    else out.push({ pos, size: 'short' });
  }
  return out;
}
