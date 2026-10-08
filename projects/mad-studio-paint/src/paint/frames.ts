/**
 * Comic frames (panels): polygons that clip a frame border folder's content and are drawn as its
 * border. Splitting with gutters, dividing equally, hit tests. Pure, unit tested.
 */
import type { Affine, Pt } from './rulers';

export interface FramePanel {
  id: string;
  /** Corners in document pixels, in drawing order. */
  points: Pt[];
}

export interface FrameBorder {
  panels: FramePanel[];
  /** Border line width (px). */
  lineWidth: number;
  color: string;
  /** "Draw border": off keeps the clipping (and the ruler) without visible lines. */
  draw: boolean;
}

export const newPanelId = () => `p${Math.random().toString(36).slice(2, 10)}`;

export const rectPoints = (x: number, y: number, w: number, h: number): Pt[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

/** Millimetres → document pixels at the document resolution (gutters are set in mm). */
export const mmToPx = (mm: number, dpi: number) => (mm / 25.4) * dpi;

/** Signed area (positive for clockwise corners in screen coordinates). */
export function area(points: Pt[]): number {
  let a = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) a += (points[j].x + points[i].x) * (points[i].y - points[j].y);
  return -a / 2;
}

/** The part of a polygon where n·p ≥ c (Sutherland–Hodgman). */
export function clipHalfPlane(points: Pt[], n: Pt, c: Pt | number): Pt[] {
  const k = typeof c === 'number' ? c : n.x * c.x + n.y * c.y;
  const side = (p: Pt) => n.x * p.x + n.y * p.y - k;
  const out: Pt[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const sa = side(a);
    const sb = side(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  // Drop repeated corners left where the line passes through a corner.
  return out.filter((p, i) => {
    const q = out[(i + out.length - 1) % out.length];
    return out.length < 2 || Math.hypot(p.x - q.x, p.y - q.y) > 1e-9;
  });
}

/**
 * Splits a panel along the line through a and b, leaving a gutter of `gap` px between the parts.
 * The first part is above (for a mostly horizontal cut) or left of the line. Null when the line
 * does not divide the panel.
 */
export function splitPanel(points: Pt[], a: Pt, b: Pt, gap: number): [Pt[], Pt[]] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  let n = { x: -dy / len, y: dx / len };
  // Point the normal down (horizontal cut) or right (vertical cut).
  if (Math.abs(dx) >= Math.abs(dy) ? n.y < 0 : n.x < 0) n = { x: -n.x, y: -n.y };
  const c = n.x * a.x + n.y * a.y;
  const first = clipHalfPlane(points, { x: -n.x, y: -n.y }, -(c - gap / 2));
  const second = clipHalfPlane(points, n, c + gap / 2);
  if (first.length < 3 || second.length < 3 || Math.abs(area(first)) < 1 || Math.abs(area(second)) < 1) return null;
  return [first, second];
}

/** Axis-aligned bounds of a polygon. */
export function polygonBounds(points: Pt[]): { x: number; y: number; w: number; h: number } {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * Divides a panel into `cols` × `rows` equal parts with gutters (Divide frame border equally),
 * row by row from the top left.
 */
export function divideEqually(points: Pt[], cols: number, rows: number, gapX: number, gapY: number): Pt[][] {
  const b = polygonBounds(points);
  const cw = (b.w - (cols - 1) * gapX) / cols;
  const ch = (b.h - (rows - 1) * gapY) / rows;
  if (cw <= 1 || ch <= 1) return [points];
  const out: Pt[][] = [];
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const x0 = b.x + k * (cw + gapX);
      const y0 = b.y + r * (ch + gapY);
      let part = points;
      if (k > 0) part = clipHalfPlane(part, { x: 1, y: 0 }, x0);
      if (k < cols - 1) part = clipHalfPlane(part, { x: -1, y: 0 }, -(x0 + cw));
      if (r > 0) part = clipHalfPlane(part, { x: 0, y: 1 }, y0);
      if (r < rows - 1) part = clipHalfPlane(part, { x: 0, y: -1 }, -(y0 + ch));
      if (part.length >= 3 && Math.abs(area(part)) >= 1) out.push(part);
    }
  }
  return out;
}

/** Ray casting point-in-polygon test. */
export function insidePanel(points: Pt[], p: Pt): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance from p to the nearest edge of a polygon. */
export function distanceToEdge(points: Pt[], p: Pt): number {
  let best = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
  }
  return best;
}

export const transformPanel = (panel: FramePanel, m: Affine): FramePanel => ({
  ...panel,
  points: panel.points.map((p) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] })),
});

/** Edges of all panels (for snapping strokes to frame borders). */
export const panelEdges = (panels: FramePanel[]): [Pt, Pt][] =>
  panels.flatMap((panel) => panel.points.map((p, i) => [p, panel.points[(i + 1) % panel.points.length]] as [Pt, Pt]));

// ------------------------------------------------------------------ files

const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);

export function sanitizeFrame(raw: unknown): FrameBorder | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const panels = Array.isArray(r.panels)
    ? r.panels.slice(0, 1000).flatMap((x): FramePanel[] => {
        if (!x || typeof x !== 'object') return [];
        const q = x as Record<string, unknown>;
        const points = Array.isArray(q.points)
          ? q.points.slice(0, 1000).map((p) => {
              const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
              return { x: num(o.x, 0, -1e6, 1e6), y: num(o.y, 0, -1e6, 1e6) };
            })
          : [];
        if (points.length < 3) return [];
        return [{ id: typeof q.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(q.id) ? q.id : newPanelId(), points }];
      })
    : [];
  if (panels.length === 0) return undefined;
  return {
    panels,
    lineWidth: num(r.lineWidth, 5, 0, 500),
    color: typeof r.color === 'string' && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color.toLowerCase() : '#000000',
    draw: r.draw !== false,
  };
}
