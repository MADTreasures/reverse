/**
 * Vector lines: strokes stored as control points with a width (and density) factor each, the line
 * running through them as a spline, so they can be erased up to intersections, moved, recoloured,
 * scaled and corrected point by point without losing quality. Pure geometry, unit tested.
 */
import { bezierAt, bezierSteps, splineSegments } from './curves';
import type { Affine, Pt } from './rulers';
import type { BrushSettings } from './tools';

export interface VectorPoint {
  x: number;
  y: number;
  /** Size factor (pressure, tapering, tilt already applied). */
  s: number;
  /** Density factor. */
  d: number;
  /** Tip angle (radians) when the tip follows the pen. */
  az?: number;
}

export interface VectorStroke {
  id: string;
  color: string;
  /** Brush the line was drawn with (its size is the full width). */
  brush: BrushSettings;
  /** The control points the line runs through. */
  points: VectorPoint[];
  /**
   * 'spline': the line is a smooth curve through the points, bending sharply at `corners`.
   * 'polyline': straight from point to point. Lines of older files have neither: dense paths that
   * run straight from point to point too.
   */
  curve?: 'spline' | 'polyline';
  corners?: number[];
  /** Drawn with the transparent colour: the line erases the lines below it on its layer. */
  erase?: boolean;
}

export type VectorEraseMode = 'touched' | 'intersection' | 'whole';

export const newStrokeId = () => `v${Math.random().toString(36).slice(2, 10)}`;

/** Radius of the line at a point. */
export const radiusAt = (s: VectorStroke, p: VectorPoint) => (s.brush.size / 2) * p.s;

// ------------------------------------------------------------------ path and control points

const pathCache = new WeakMap<VectorStroke, VectorPoint[]>();

/**
 * The path the line runs along, dense enough to draw and measure: its control points joined by a
 * spline (or straight). Path positions (index + fraction) in the functions below refer to it.
 */
export function linePath(s: VectorStroke): VectorPoint[] {
  if (s.curve !== 'spline' || s.points.length < 3) return s.points;
  let path = pathCache.get(s);
  if (!path) pathCache.set(s, (path = splinePath(s.points, s.corners ?? [])));
  return path;
}

const lerpPoint = (a: VectorPoint, b: VectorPoint, t: number, at: Pt): VectorPoint => ({
  x: at.x,
  y: at.y,
  s: a.s + (b.s - a.s) * t,
  d: a.d + (b.d - a.d) * t,
  ...(b.az !== undefined ? { az: a.az !== undefined ? a.az + (b.az - a.az) * t : b.az } : {}),
});

/** The spline's piece between each pair of neighbouring points (smooth runs split at the corners). */
function splinePieces(pts: Pt[], corners: Set<number>): ([Pt, Pt, Pt, Pt] | null)[] {
  const out: ([Pt, Pt, Pt, Pt] | null)[] = [];
  let start = 0;
  for (let i = 1; i < pts.length; i++) {
    if (i < pts.length - 1 && !corners.has(i)) continue;
    out.push(...splineSegments(pts.slice(start, i + 1)));
    start = i;
  }
  return out;
}

/** Spline through the points, sampled about every 3 px; widths and densities change evenly between points. */
function splinePath(pts: VectorPoint[], corners: number[]): VectorPoint[] {
  const out: VectorPoint[] = [pts[0]];
  splinePieces(pts, new Set(corners)).forEach((seg, k) => {
    const a = pts[k];
    const b = pts[k + 1];
    if (seg) {
      const n = bezierSteps(seg, 3);
      for (let j = 1; j < n; j++) out.push(lerpPoint(a, b, j / n, bezierAt(seg, j / n)));
    }
    out.push(b);
  });
  return out;
}

/** Distance from p to a polyline. */
function distanceToPolyline(p: Pt, line: Pt[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const dx = line[i].x - a.x;
    const dy = line[i].y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
  }
  return best;
}

/** Path positions per control point (where each lies along the path). */
export function controlPositions(s: VectorStroke): number[] {
  const path = linePath(s);
  if (path === s.points) return s.points.map((_, i) => i);
  const out: number[] = [];
  let k = 0;
  for (let i = 0; i < path.length && k < s.points.length; i++) if (path[i] === s.points[k]) out.push(i), k++;
  return out;
}

/** How far (px) the width of a fitted line may differ, per unit of density. */
const DENSITY_PX = 10;

/**
 * A dense path (a drawn stroke, or a piece of a line) as few control points with a spline through
 * them: positions and widths stay within `tol` px (`size` is the brush size), sharp bends become
 * corners.
 */
export function fitLine(path: VectorPoint[], size: number, tol = 0.5): { points: VectorPoint[]; corners: number[] } {
  const unique = path.filter((q, i) => i === 0 || Math.hypot(q.x - path[i - 1].x, q.y - path[i - 1].y) > 1e-6 || q.s !== path[i - 1].s || q.d !== path[i - 1].d);
  if (unique.length < 3) return { points: unique, corners: [] };
  // Points at most 4 px apart, so the fitted spline can be checked all along.
  const p: VectorPoint[] = [unique[0]];
  for (let i = 1; i < unique.length; i++) {
    const a = unique[i - 1];
    const b = unique[i];
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4);
    for (let k = 1; k < n; k++) p.push(lerpPoint(a, b, k / n, { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n }));
    p.push(b);
  }
  const keep = new Uint8Array(p.length);
  keep[0] = keep[p.length - 1] = 1;
  const off = (q: VectorPoint, a: VectorPoint, b: VectorPoint) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2)) : 0;
    const along = Math.hypot(q.x - (a.x + dx * t), q.y - (a.y + dy * t));
    const width = (Math.abs(q.s - (a.s + (b.s - a.s) * t)) * size) / 2;
    const density = Math.abs(q.d - (a.d + (b.d - a.d) * t)) * DENSITY_PX;
    return Math.max(along, width, density);
  };
  const stack: [number, number][] = [[0, p.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let far = tol;
    for (let i = a + 1; i < b; i++) {
      const e = off(p[i], p[a], p[b]);
      if (e > far) {
        far = e;
        worst = i;
      }
    }
    if (worst > 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  // The spline bulges where the points are far apart next to a bend: add points where it strays
  // from the path until it stays within the tolerance.
  let idx = p.flatMap((_, i) => (keep[i] ? [i] : []));
  for (let round = 0; round < 12; round++) {
    const pts = idx.map((i) => p[i]);
    const pieces = splinePieces(pts, new Set(cornersOf(pts)));
    const add: number[] = [];
    pieces.forEach((seg, k) => {
      const a = idx[k];
      const b = idx[k + 1];
      if (!seg || b - a < 2) return;
      const n = bezierSteps(seg, 2);
      const curve = Array.from({ length: n + 1 }, (_, j) => bezierAt(seg, j / n));
      let worst = -1;
      let far = tol;
      for (let j = a + 1; j < b; j++) {
        const e = distanceToPolyline(p[j], curve);
        if (e > far) {
          far = e;
          worst = j;
        }
      }
      if (worst > 0) add.push(worst);
    });
    if (add.length === 0) break;
    idx = [...idx, ...add].sort((x, y) => x - y);
  }
  const points = idx.map((i) => p[i]);
  return { points, corners: cornersOf(points) };
}

/** Bends sharper than this (radians) are corners. */
const CORNER_BEND = 1;

/** The control points where the line bends sharply. */
export function cornersOf(pts: Pt[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x);
    const b = Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x);
    if (Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))) > CORNER_BEND) out.push(i);
  }
  return out;
}

/** A line along a dense path, as control points with a spline (keeping the line's other properties). */
export function splineLine(base: Omit<VectorStroke, 'points' | 'curve' | 'corners'>, path: VectorPoint[], tol?: number): VectorStroke {
  const { id, color, brush, erase } = base;
  const fit = fitLine(path, brush.size, tol);
  return { id, color, brush, points: fit.points, curve: 'spline', ...(fit.corners.length ? { corners: fit.corners } : {}), ...(erase ? { erase } : {}) };
}

const boundsCache = new WeakMap<VectorStroke, { x: number; y: number; w: number; h: number } | null>();

/** Pixel bounds of a line (lines never change in place, so the result is cached). */
export function strokeBounds(s: VectorStroke): { x: number; y: number; w: number; h: number } | null {
  const cached = boundsCache.get(s);
  if (cached !== undefined) return cached;
  let box: { x: number; y: number; w: number; h: number } | null = null;
  const path = linePath(s);
  if (path.length) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    // Sprayed dabs land up to `scatter` diameters away.
    const spread = (s.brush.scatter ?? 0) * s.brush.size + 2;
    for (const p of path) {
      const r = radiusAt(s, p) + spread;
      x0 = Math.min(x0, p.x - r);
      y0 = Math.min(y0, p.y - r);
      x1 = Math.max(x1, p.x + r);
      y1 = Math.max(y1, p.y + r);
    }
    box = { x: Math.floor(x0), y: Math.floor(y0), w: Math.ceil(x1) - Math.floor(x0), h: Math.ceil(y1) - Math.floor(y0) };
  }
  boundsCache.set(s, box);
  return box;
}

/** True when the line's bounds come within `r` of `c`. */
function near(s: VectorStroke, c: Pt, r: number): boolean {
  const b = strokeBounds(s);
  return Boolean(b && c.x + r >= b.x && c.x - r <= b.x + b.w && c.y + r >= b.y && c.y - r <= b.y + b.h);
}

/** Closest point on segment ab to p: parameter t (0..1) and distance. */
function closestOnSegment(p: Pt, a: Pt, b: Pt): { t: number; d: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return { t, d: Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)) };
}

/**
 * Distance from p to the stroke's outline (0 inside the line) and the position along the path
 * (index + fraction) of the closest point.
 */
export function distanceToStroke(s: VectorStroke, p: Pt): { d: number; at: number } {
  const pts = linePath(s);
  if (pts.length === 1) return { d: Math.max(0, Math.hypot(p.x - pts[0].x, p.y - pts[0].y) - radiusAt(s, pts[0])), at: 0 };
  let best = { d: Infinity, at: 0 };
  for (let i = 1; i < pts.length; i++) {
    const { t, d } = closestOnSegment(p, pts[i - 1], pts[i]);
    const r = radiusAt(s, pts[i - 1]) + (radiusAt(s, pts[i]) - radiusAt(s, pts[i - 1])) * t;
    const out = Math.max(0, d - r);
    if (out < best.d) best = { d: out, at: i - 1 + t };
  }
  return best;
}

/** The point at a path position (index + fraction). */
export function pointAt(s: VectorStroke, at: number): VectorPoint {
  const path = linePath(s);
  const i = Math.max(0, Math.min(path.length - 1, Math.floor(at)));
  const a = path[i];
  const b = path[Math.min(path.length - 1, i + 1)];
  const f = at - i;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, s: a.s + (b.s - a.s) * f, d: a.d + (b.d - a.d) * f, ...(a.az !== undefined ? { az: a.az } : {}) };
}

/** The dense path between two path positions. */
export function pathBetween(s: VectorStroke, from: number, to: number): VectorPoint[] {
  const path = linePath(s);
  const pts: VectorPoint[] = [pointAt(s, from)];
  for (let i = Math.floor(from) + 1; i < to; i++) pts.push(path[i]);
  pts.push(pointAt(s, to));
  return pts;
}

/** The part of a stroke between two path positions (the stroke itself when that is all of it). */
export function sliceStroke(s: VectorStroke, from: number, to: number): VectorStroke | null {
  const last = linePath(s).length - 1;
  const a = Math.max(0, from);
  const b = Math.min(last, to);
  if (b - a < 1e-6) return null;
  if (a === 0 && b === last) return s;
  const pts = pathBetween(s, a, b);
  // A spline piece gets control points of its own.
  return s.curve === 'spline' ? splineLine({ ...s, id: newStrokeId() }, pts) : { ...s, id: newStrokeId(), points: pts };
}

// ------------------------------------------------------------------ intersections

/** Parameter along ab (0..1) where it crosses cd, or null. */
function segmentCross(a: Pt, b: Pt, c: Pt, d: Pt): number | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

/** Path positions where `s` crosses any of the other strokes (or itself, away from the touch). */
export function intersections(s: VectorStroke, others: VectorStroke[]): number[] {
  const out: number[] = [];
  const pts = linePath(s);
  for (const o of others) {
    if (o === s) continue;
    const op = linePath(o);
    for (let i = 1; i < pts.length; i++) {
      for (let k = 1; k < op.length; k++) {
        const t = segmentCross(pts[i - 1], pts[i], op[k - 1], op[k]);
        if (t !== null) out.push(i - 1 + t);
      }
    }
  }
  // A crossing exactly at a shared point is found by both neighbouring segments.
  return out.sort((a, b) => a - b).filter((x, i, all) => i === 0 || x - all[i - 1] > 1e-6);
}

// ------------------------------------------------------------------ vector eraser

/**
 * Runs of path positions (index + fraction) where `hit` holds, sampled at most `step` px apart; the
 * ends of each run are refined between samples.
 */
function runsWhere(s: VectorStroke, hit: (p: VectorPoint) => boolean, step: number): [number, number][] {
  const pts = linePath(s);
  if (pts.length === 1) return hit(pts[0]) ? [[0, 0]] : [];
  const test = (at: number) => hit(pointAt(s, at));
  /** Position between `a` (test ≠ want) and `b` (test = want) where the test changes. */
  const edge = (a: number, b: number, want: boolean) => {
    for (let k = 0; k < 6; k++) {
      const m = (a + b) / 2;
      if (test(m) === want) b = m;
      else a = m;
    }
    return b;
  };
  const runs: [number, number][] = [];
  let start: number | null = null;
  let prev = 0;
  for (let i = 1; i < pts.length; i++) {
    const n = Math.max(1, Math.ceil(Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) / step));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const at = i - 1 + k / n;
      const inside = test(at);
      if (inside && start === null) start = at === 0 ? 0 : edge(prev, at, true);
      if (!inside && start !== null) {
        runs.push([start, edge(prev, at, false)]);
        start = null;
      }
      prev = at;
    }
  }
  if (start !== null) runs.push([start, pts.length - 1]);
  return runs;
}

/** The pieces of a line outside the given runs of path positions. */
function withoutRuns(s: VectorStroke, cuts: [number, number][], out: VectorStroke[]): void {
  const last = linePath(s).length - 1;
  let pos = 0;
  for (const [a, b] of cuts) {
    if (a > pos) {
      const piece = sliceStroke(s, pos, a);
      if (piece) out.push(piece);
    }
    pos = Math.max(pos, b);
  }
  if (pos < last) {
    const piece = sliceStroke(s, pos, last);
    if (piece) out.push(piece);
  }
}

/**
 * Applies one eraser dab to the strokes. "touched": removes the covered parts (splitting lines);
 * "whole": removes touched lines entirely; "intersection": removes the touched part of a line up to
 * the nearest crossings with the other lines (`others`). Untouched lines are kept as they are.
 */
export function eraseAt(strokes: VectorStroke[], c: Pt, r: number, mode: VectorEraseMode, others: VectorStroke[] = strokes): VectorStroke[] {
  const out: VectorStroke[] = [];
  for (const s of strokes) {
    const runs = near(s, c, r) ? runsWhere(s, (p) => Math.hypot(p.x - c.x, p.y - c.y) <= r + radiusAt(s, p) * 0.5, Math.max(0.5, r / 3)) : [];
    if (runs.length === 0) {
      out.push(s);
      continue;
    }
    if (mode === 'whole') continue;
    if (mode === 'touched') {
      withoutRuns(s, runs, out);
      continue;
    }
    const last = linePath(s).length - 1;
    const xs = intersections(s, others);
    withoutRuns(
      s,
      runs.map(([a, b]) => {
        const mid = (a + b) / 2;
        return [xs.filter((x) => x < mid).pop() ?? 0, xs.find((x) => x > mid) ?? last] as [number, number];
      }),
      out,
    );
  }
  return out;
}

// ------------------------------------------------------------------ transforms

/**
 * Applies an affine transform to the paths; widths scale with it and tip angles turn (or mirror)
 * with it, so transforms lose nothing.
 */
export function transformStrokes(strokes: VectorStroke[], m: Affine, scaleWidth = true): VectorStroke[] {
  const det = m[0] * m[3] - m[1] * m[2];
  const scale = scaleWidth ? Math.sqrt(Math.abs(det)) || 1 : 1;
  const mirrored = det < 0;
  const turn = Math.atan2(m[1], m[0]);
  const deg = (turn * 180) / Math.PI;
  return strokes.map((s) => {
    const b = s.brush;
    // Fixed tips turn with the line; tips that follow the line or the pen only mirror.
    const angle = b.angleSource === 'fixed' ? (mirrored ? deg - b.angle : b.angle + deg) : mirrored ? -b.angle : b.angle;
    return {
      ...s,
      brush: { ...b, size: Math.max(0.1, b.size * scale), angle: ((angle % 360) + 540) % 360 - 180 },
      points: s.points.map((p) => ({
        ...p,
        x: m[0] * p.x + m[2] * p.y + m[4],
        y: m[1] * p.x + m[3] * p.y + m[5],
        ...(p.az !== undefined ? { az: mirrored ? turn - p.az : p.az + turn } : {}),
      })),
    };
  });
}

export const translateStrokes = (strokes: VectorStroke[], dx: number, dy: number) => transformStrokes(strokes, [1, 0, 0, 1, dx, dy]);

/** Lines with the parts inside an area removed, cut at its border (Delete with a selection). */
export function eraseWhere(strokes: VectorStroke[], inside: (p: Pt) => boolean): VectorStroke[] {
  const out: VectorStroke[] = [];
  for (const s of strokes) {
    const runs = runsWhere(s, inside, 1);
    if (runs.length === 0) out.push(s);
    else withoutRuns(s, runs, out);
  }
  return out;
}

/** The parts of the lines inside an area (drawing with a selection). */
export const keepWhere = (strokes: VectorStroke[], inside: (p: Pt) => boolean) => eraseWhere(strokes, (p) => !inside(p));

/** The top-most line within `tolerance` px of p (the Object tool picks lines this way), or -1. */
export function hitStroke(strokes: VectorStroke[], p: Pt, tolerance: number): number {
  for (let i = strokes.length - 1; i >= 0; i--) {
    if (near(strokes[i], p, tolerance) && distanceToStroke(strokes[i], p).d <= tolerance) return i;
  }
  return -1;
}

/** Bounds of several lines. */
export function linesBounds(strokes: VectorStroke[]): { x: number; y: number; w: number; h: number } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of strokes) {
    const b = strokeBounds(s);
    if (!b) continue;
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return x1 < x0 ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ------------------------------------------------------------------ files

const n = (v: unknown, fallback: number, min = -1e6, max = 1e6) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);

/** Compact form for files: points as one flat array [x, y, s, d, …] rounded to 0.01; `c` marks splines, `k` their corners. */
export function packStroke(s: VectorStroke): { id: string; color: string; brush: BrushSettings; p: number[]; a?: number[]; e?: 1; c?: 1 | 2; k?: number[] } {
  const p: number[] = [];
  for (const q of s.points) p.push(Math.round(q.x * 100) / 100, Math.round(q.y * 100) / 100, Math.round(q.s * 1000) / 1000, Math.round(q.d * 1000) / 1000);
  // Tip angles only matter for brushes that follow the pen's direction.
  const a = s.points.some((q) => q.az !== undefined) ? s.points.map((q) => Math.round((q.az ?? 0) * 1000) / 1000) : null;
  return {
    id: s.id,
    color: s.color,
    brush: s.brush,
    p,
    ...(a ? { a } : {}),
    ...(s.erase ? { e: 1 } : {}),
    ...(s.curve === 'spline' ? { c: 1 } : s.curve === 'polyline' ? { c: 2 } : {}),
    ...(s.corners?.length ? { k: s.corners } : {}),
  };
}

/** Reads a stroke from a file (validated); `brushOf` validates the brush settings. */
export function unpackStroke(raw: unknown, brushOf: (b: unknown) => BrushSettings): VectorStroke | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.p) || r.p.length < 4) return null;
  const pts: VectorPoint[] = [];
  const az = Array.isArray(r.a) ? r.a : null;
  for (let i = 0; i + 3 < r.p.length && pts.length < 100000; i += 4) {
    const p: VectorPoint = { x: n(r.p[i], 0), y: n(r.p[i + 1], 0), s: n(r.p[i + 2], 1, 0, 10), d: n(r.p[i + 3], 1, 0, 1) };
    if (az) p.az = n(az[i / 4], 0, -100, 100);
    pts.push(p);
  }
  const corners = r.c === 1 && Array.isArray(r.k) ? [...new Set(r.k.filter((i): i is number => Number.isInteger(i) && i > 0 && i < pts.length - 1))].sort((x, y) => x - y) : [];
  return {
    id: typeof r.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(r.id) ? r.id : newStrokeId(),
    color: typeof r.color === 'string' && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color.toLowerCase() : '#000000',
    brush: brushOf(r.brush),
    points: pts,
    ...(r.c === 1 ? { curve: 'spline' as const } : r.c === 2 ? { curve: 'polyline' as const } : {}),
    ...(corners.length ? { corners } : {}),
    ...(r.e === 1 ? { erase: true } : {}),
  };
}
