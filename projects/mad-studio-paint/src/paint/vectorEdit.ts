/**
 * Correcting vector lines (the Correct line tools and the Object tool's control points): moving,
 * adding and deleting control points, corners, width and opacity per point, splitting, pinching,
 * simplifying, connecting, adjusting the width, redrawing a line or its width. Pure, unit tested.
 */
import type { Pt } from './rulers';
import type { WidthMode } from './tools';
import { controlPositions, cornersOf, fitLine, linePath, newStrokeId, pathBetween, pointAt, splineLine, type VectorPoint, type VectorStroke } from './vector';

// ------------------------------------------------------------------ control points

const editableCache = new WeakMap<VectorStroke, VectorStroke>();

/** A line with control points: lines of older files (dense paths) get a spline through few points. */
export function editable(line: VectorStroke): VectorStroke {
  if (line.curve) return line;
  let e = editableCache.get(line);
  if (!e) editableCache.set(line, (e = splineLine(line, line.points)));
  return e;
}

/** Corners shifted for points inserted (+1) or removed (−1) at `index`. */
const shiftCorners = (corners: number[] | undefined, index: number, by: 1 | -1): number[] =>
  (corners ?? []).flatMap((c) => (by < 0 && c === index ? [] : [c >= index ? c + by : c]));

/** The line with new control points (and corners); corners outside the inner points are dropped. */
function withPoints(line: VectorStroke, points: VectorPoint[], corners: number[] | undefined = line.corners): VectorStroke {
  const inner = [...new Set(corners ?? [])].filter((c) => c > 0 && c < points.length - 1).sort((a, b) => a - b);
  const { corners: _old, ...rest } = line;
  return { ...rest, points, ...(inner.length && line.curve === 'spline' ? { corners: inner } : {}) };
}

export interface PointHit {
  /** Index of the line in the list. */
  line: number;
  /** Index of the control point. */
  point: number;
  dist: number;
}

/** The control point within `tol` of p (the top-most line first, then the nearest point). */
export function hitControlPoint(lines: VectorStroke[], p: Pt, tol: number): PointHit | null {
  let best: PointHit | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const pts = editable(lines[i]).points;
    for (let k = 0; k < pts.length; k++) {
      const d = Math.hypot(pts[k].x - p.x, pts[k].y - p.y);
      if (d <= tol && (!best || d < best.dist - 1e-9)) best = { line: i, point: k, dist: d };
    }
    if (best) return best;
  }
  return null;
}

/** Distance from p to the line's path (its middle, not its outline) and the path position there. */
export function nearestOnLine(line: VectorStroke, p: Pt): { d: number; at: number } {
  const path = linePath(line);
  if (path.length === 1) return { d: Math.hypot(p.x - path[0].x, p.y - path[0].y), at: 0 };
  let best = { d: Infinity, at: 0 };
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1];
    const b = path[k];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    const d = Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
    if (d < best.d) best = { d, at: k - 1 + t };
  }
  return best;
}

/** The line (top-most) whose path passes within `tol` of p, with the path position there. */
export function hitLinePath(lines: VectorStroke[], p: Pt, tol: number): { line: number; at: number } | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const hit = nearestOnLine(editable(lines[i]), p);
    if (hit.d <= tol) return { line: i, at: hit.at };
  }
  return null;
}

/** The line as straight segments or a spline (straight lines have no corners). */
function asCurve(line: VectorStroke, curve: VectorStroke['curve']): VectorStroke {
  if (curve === 'spline') return { ...line, curve };
  const { corners: _corners, ...rest } = line;
  return { ...rest, curve };
}

export function moveControlPoint(line: VectorStroke, i: number, to: Pt): VectorStroke {
  const e = editable(line);
  return withPoints(
    e,
    e.points.map((q, k) => (k === i ? { ...q, x: to.x, y: to.y } : q)),
  );
}

/** Adds a control point where the path position `at` is (the line keeps its shape there). */
export function insertControlPoint(line: VectorStroke, at: number): { line: VectorStroke; index: number } {
  const e = editable(line);
  const pos = controlPositions(e);
  let k = 0;
  while (k < pos.length - 1 && pos[k + 1] <= at) k++;
  // On a control point already: nothing to add.
  const near = pos.findIndex((x) => Math.abs(x - at) < 1e-6);
  if (near >= 0) return { line: e, index: near };
  const index = k + 1;
  const points = [...e.points.slice(0, index), pointAt(e, at), ...e.points.slice(index)];
  return { line: withPoints(e, points, shiftCorners(e.corners, index, 1)), index };
}

/** Deletes a control point; a line left with one point is gone (null). */
export function deleteControlPoint(line: VectorStroke, i: number): VectorStroke | null {
  const e = editable(line);
  if (e.points.length <= 2) return null;
  return withPoints(
    e,
    e.points.filter((_, k) => k !== i),
    shiftCorners(e.corners, i, -1),
  );
}

/** Switches an inner control point between curve and corner. */
export function toggleCorner(line: VectorStroke, i: number): VectorStroke {
  const e = editable(line);
  if (i <= 0 || i >= e.points.length - 1 || e.curve !== 'spline') return e;
  const corners = new Set(e.corners ?? []);
  if (corners.has(i)) corners.delete(i);
  else corners.add(i);
  return withPoints(e, e.points, [...corners]);
}

/** Width (size factor) and density of one control point. */
export function setPointProps(line: VectorStroke, i: number, props: { s?: number; d?: number }): VectorStroke {
  const e = editable(line);
  return withPoints(
    e,
    e.points.map((q, k) => (k === i ? { ...q, ...(props.s !== undefined ? { s: Math.max(0, Math.min(10, props.s)) } : {}), ...(props.d !== undefined ? { d: Math.max(0, Math.min(1, props.d)) } : {}) } : q)),
  );
}

/** Splits the line in two at an inner control point. */
export function splitLine(line: VectorStroke, i: number): [VectorStroke, VectorStroke] | null {
  const e = editable(line);
  if (i <= 0 || i >= e.points.length - 1) return null;
  const corners = e.corners ?? [];
  const a = withPoints(e, e.points.slice(0, i + 1), corners);
  const b = withPoints(
    { ...e, id: newStrokeId() },
    e.points.slice(i),
    corners.map((c) => c - i),
  );
  return [a, b];
}

// ------------------------------------------------------------------ lengths along a line

/** Length along the path up to each path point. */
export function pathLengths(path: Pt[]): number[] {
  const out = [0];
  for (let i = 1; i < path.length; i++) out.push(out[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  return out;
}

/** Length along the path at a path position. */
export function lengthAt(lengths: number[], at: number): number {
  const i = Math.max(0, Math.min(lengths.length - 1, Math.floor(at)));
  const j = Math.min(lengths.length - 1, i + 1);
  return lengths[i] + (lengths[j] - lengths[i]) * (at - i);
}

// ------------------------------------------------------------------ pinch

export interface Pinch {
  /** The line with a control point where it was grabbed (when asked for). */
  line: VectorStroke;
  /** Weight per control point: how much of the drag it follows. */
  weights: number[];
}

/**
 * Pinch vector line: grabbing the line at path position `at` moves the control points within
 * `half` px (along the line) of it, the nearer the more (a smooth bump); `fixEnds` keeps the ends
 * in place; `addPoint` first adds a control point where the line was grabbed.
 */
export function startPinch(line: VectorStroke, at: number, half: number, fixEnds: boolean, addPoint: boolean): Pinch {
  let e = editable(line);
  let grab = at;
  if (addPoint) {
    const ins = insertControlPoint(e, at);
    e = ins.line;
    grab = controlPositions(e)[ins.index];
  }
  const lengths = pathLengths(linePath(e));
  const s0 = lengthAt(lengths, grab);
  const h = Math.max(1, half);
  const weights = controlPositions(e).map((pos, k) => {
    if (fixEnds && (k === 0 || k === e.points.length - 1)) return 0;
    const x = Math.min(1, Math.abs(lengthAt(lengths, pos) - s0) / h);
    return (1 + Math.cos(Math.PI * x)) / 2;
  });
  return { line: e, weights };
}

export function applyPinch(p: Pinch, dx: number, dy: number): VectorStroke {
  return withPoints(
    p.line,
    p.line.points.map((q, k) => (p.weights[k] ? { ...q, x: q.x + dx * p.weights[k], y: q.y + dy * p.weights[k] } : q)),
  );
}

// ------------------------------------------------------------------ simplify

export type CurveConversion = 'keep' | 'polyline' | 'spline';

/**
 * Simplify vector line: fewer control points, the line staying within `tol` px. Only the touched
 * control points go (`touched(i)`; all with the whole line); corners stay unless `smoothCorners`.
 */
export function simplifyLine(line: VectorStroke, tol: number, touched: (i: number) => boolean, smoothCorners: boolean, convert: CurveConversion = 'keep'): VectorStroke {
  const e = editable(line);
  const pts = e.points;
  const corners = new Set(e.corners ?? []);
  const pos = controlPositions(e);
  // Points that stay: the ends, untouched points and (unless smoothing) corners.
  const fixed = pts.map((_, i) => i === 0 || i === pts.length - 1 || !touched(i) || (corners.has(i) && !smoothCorners));
  const points: VectorPoint[] = [pts[0]];
  const newCorners: number[] = [];
  let from = 0;
  for (let i = 1; i < pts.length; i++) {
    if (!fixed[i]) continue;
    if (i - from > 1) {
      // Refit the path between two fixed points, more loosely.
      const fit = fitLine(pathBetween(e, pos[from], pos[i]), e.brush.size, tol);
      points.push(...fit.points.slice(1, -1));
    }
    points.push(pts[i]);
    if (corners.has(i) && !(smoothCorners && touched(i))) newCorners.push(points.length - 1);
    from = i;
  }
  const curve = convert === 'keep' ? e.curve : convert;
  return withPoints(asCurve(e, curve), points, curve === 'spline' ? newCorners : []);
}

// ------------------------------------------------------------------ connect

export type End = 'start' | 'end';

const endPoint = (line: VectorStroke, end: End) => {
  const pts = editable(line).points;
  return end === 'start' ? pts[0] : pts[pts.length - 1];
};

/** Whether two lines may be joined: same colour, brush size and kind unless any properties may join. */
export function joinable(a: VectorStroke, b: VectorStroke, anyProps: boolean): boolean {
  return anyProps || (a.color === b.color && Math.abs(a.brush.size - b.brush.size) < 1e-6 && Boolean(a.erase) === Boolean(b.erase));
}

/** Joins the `endA` of `a` to the `endB` of `b`: the two ends meet halfway; the result keeps `a`'s id and properties. */
export function connectLines(a: VectorStroke, endA: End, b: VectorStroke, endB: End): VectorStroke {
  const ea = editable(a);
  const eb = editable(b);
  // Orient: a runs into the joint, b runs out of it.
  const pa = endA === 'end' ? ea.points : [...ea.points].reverse();
  const ca = (ea.corners ?? []).map((c) => (endA === 'end' ? c : ea.points.length - 1 - c));
  const pb = endB === 'start' ? eb.points : [...eb.points].reverse();
  const cb = (eb.corners ?? []).map((c) => (endB === 'start' ? c : eb.points.length - 1 - c));
  const x = pa[pa.length - 1];
  const y = pb[0];
  const joint: VectorPoint = { x: (x.x + y.x) / 2, y: (x.y + y.y) / 2, s: (x.s + y.s) / 2, d: (x.d + y.d) / 2, ...(x.az !== undefined ? { az: x.az } : {}) };
  const points = [...pa.slice(0, -1), joint, ...pb.slice(1)];
  const at = pa.length - 1;
  const bend = cornersOf(points.slice(Math.max(0, at - 1), at + 2)).length > 0 && at > 0 && at < points.length - 1;
  const corners = [...ca, ...cb.map((c) => c + at), ...(bend ? [at] : [])];
  return withPoints(asCurve(ea, ea.curve === 'polyline' && eb.curve === 'polyline' ? 'polyline' : 'spline'), points, corners);
}

/**
 * Connect vector line: in the circle (c, r), the two nearest line ends no more than `gap` px apart
 * that may be joined; null when there are none.
 */
export function findJoin(lines: VectorStroke[], c: Pt, r: number, gap: number, anyProps: boolean): { a: number; endA: End; b: number; endB: End } | null {
  const ends: { line: number; end: End; p: Pt }[] = [];
  lines.forEach((line, i) => {
    if (editable(line).points.length < 2) return;
    for (const end of ['start', 'end'] as End[]) {
      const p = endPoint(line, end);
      if (Math.hypot(p.x - c.x, p.y - c.y) <= r) ends.push({ line: i, end, p });
    }
  });
  let best: { a: number; endA: End; b: number; endB: End; d: number } | null = null;
  for (let i = 0; i < ends.length; i++)
    for (let k = i + 1; k < ends.length; k++) {
      const u = ends[i];
      const v = ends[k];
      if (u.line === v.line) continue;
      const d = Math.hypot(u.p.x - v.p.x, u.p.y - v.p.y);
      if (d <= gap && (!best || d < best.d) && joinable(lines[u.line], lines[v.line], anyProps)) best = { a: u.line, endA: u.end, b: v.line, endB: v.end, d };
    }
  return best && { a: best.a, endA: best.endA, b: best.b, endB: best.endB };
}

/** Joins lines `a` and `b` of the list (the result takes `a`'s place). */
export function joinInList(lines: VectorStroke[], j: { a: number; endA: End; b: number; endB: End }): VectorStroke[] {
  const joined = connectLines(lines[j.a], j.endA, lines[j.b], j.endB);
  return lines.flatMap((x, i) => (i === j.a ? [joined] : i === j.b ? [] : [x]));
}

// ------------------------------------------------------------------ width along the path

/**
 * A line with new widths along its path: `widthAt(i, s)` gives the new size factor of path point
 * `i` (or undefined to keep it). The line is fitted again, so control points appear where the
 * width changes.
 */
export function rewidth(line: VectorStroke, widthAt: (i: number, s: number) => number | undefined): VectorStroke {
  const e = editable(line);
  const path = linePath(e);
  let changed = false;
  const next = path.map((q, i) => {
    const s = widthAt(i, q.s);
    if (s === undefined || Math.abs(s - q.s) < 1e-9) return q;
    changed = true;
    return { ...q, s: Math.max(0, Math.min(10, s)) };
  });
  if (!changed) return e;
  return asCurve(splineLine(e, next), e.curve);
}

/** Adjust line width: the new size factor for `s` (`amount` px for thicken/narrow, % for scaling). */
export function adjustedWidth(s: number, size: number, mode: WidthMode, amount: number, atLeast1: boolean): number {
  const px = size > 0 ? amount / size : 0;
  switch (mode) {
    case 'thicken':
      return s + px;
    case 'narrow': {
      const n = s - px;
      // At least 1 pixel wide (unless it was thinner already).
      return atLeast1 ? Math.max(n, Math.min(s, size > 0 ? 1 / size : 0)) : Math.max(0, n);
    }
    case 'scaleUp':
      return s * (1 + amount / 100);
    case 'scaleDown':
      return Math.max(0, s * (1 - amount / 100));
  }
}

// ------------------------------------------------------------------ redraw

/**
 * Redraw vector line: the part of the line between where the new stroke starts and ends is drawn
 * again along the stroke (widths and densities carried over). The stroke starts and ends within
 * `tol` px of the line; without `fixEnds` it may also go on beyond an end of the line (passing
 * it), which moves that end. Null when the stroke does not fit the line.
 */
export function redrawLine(line: VectorStroke, stroke: Pt[], tol: number, fixEnds: boolean, fitTol = 0.5): VectorStroke | null {
  if (stroke.length < 2) return null;
  const e = editable(line);
  const path = linePath(e);
  const last = path.length - 1;
  const passes = (end: Pt) => stroke.some((q) => Math.hypot(q.x - end.x, q.y - end.y) <= tol);
  /** Where a stroke end meets the line: on it, or beyond one of its ends. */
  const locate = (q: Pt): { at: number; beyond: boolean } | null => {
    const hit = nearestOnLine(e, q);
    if (hit.d <= tol) return { at: hit.at, beyond: false };
    if (fixEnds) return null;
    if (passes(path[0])) return { at: 0, beyond: true };
    if (passes(path[last])) return { at: last, beyond: true };
    return null;
  };
  let pts = stroke;
  let a = locate(pts[0]);
  let b = locate(pts[pts.length - 1]);
  if (!a || !b) return null;
  if (a.at > b.at) {
    pts = [...pts].reverse();
    [a, b] = [b, a];
  }
  if (b.at - a.at < 1e-6) return null;
  const pa = pointAt(e, a.at);
  const pb = pointAt(e, b.at);
  const lengths = pathLengths(pts);
  const total = lengths[lengths.length - 1] || 1;
  const mid: VectorPoint[] = pts.map((q, i) => {
    const f = lengths[i] / total;
    return { x: q.x, y: q.y, s: pa.s + (pb.s - pa.s) * f, d: pa.d + (pb.d - pa.d) * f };
  });
  // Where the stroke meets the line, it starts exactly on it.
  if (!a.beyond) mid[0] = { ...mid[0], x: pa.x, y: pa.y };
  if (!b.beyond) mid[mid.length - 1] = { ...mid[mid.length - 1], x: pb.x, y: pb.y };
  const head = a.beyond ? [] : pathBetween(e, 0, a.at).slice(0, -1);
  const tail = b.beyond ? [] : pathBetween(e, b.at, last).slice(1);
  return asCurve(splineLine(e, [...head, ...mid, ...tail], fitTol), e.curve);
}
