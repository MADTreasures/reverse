/**
 * Curves for the curve rulers and the ruler pen: polylines, splines, quadratic and cubic Bezier
 * curves as dense polylines, figure outlines, parallel (offset) curves without the loops their inner
 * sides make, and a stroke constraint that follows a path. Pure, unit tested. Document pixels.
 */
import type { Constraint, Pt } from './rulers';

export type CurveType = 'polyline' | 'spline' | 'quadratic' | 'cubic';
export type RulerFigure = 'rect' | 'ellipse' | 'polygon';

export const CURVE_TYPES: readonly CurveType[] = ['polyline', 'spline', 'quadratic', 'cubic'];

/** A curve as it was placed. */
export interface CurveSpec {
  curve: CurveType;
  /**
   * Polyline and spline: the points the line passes through. Quadratic Bezier: the first and last
   * points are on the line, the ones between are direction points (the line passes halfway between
   * two of them). Cubic Bezier: anchor, its outgoing direction point, the next anchor's incoming
   * direction point, the next anchor, … (3k + 1 points).
   */
  points: Pt[];
  /** Spline and quadratic Bezier: points that are corners (the line passes through them and bends sharply). */
  corners?: number[];
}

/** Rectangle, ellipse or regular polygon (corners on the ellipse, the first at the top). */
export interface FigureSpec {
  shape: RulerFigure;
  center: Pt;
  rx: number;
  ry: number;
  angle: number;
  corners: number;
}

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const along = (p: Pt, dir: Pt, k: number): Pt => ({ x: p.x + dir.x * k, y: p.y + dir.y * k });
const unit = (v: Pt): Pt => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};
const turn = (v: Pt, angle: number): Pt => ({ x: v.x * Math.cos(angle) - v.y * Math.sin(angle), y: v.x * Math.sin(angle) + v.y * Math.cos(angle) });

/** Drops points that repeat the one before. */
export function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) if (!out.length || dist(out[out.length - 1], p) > 1e-6) out.push(p);
  return out;
}

// ------------------------------------------------------------------ sampling

/** Samples for a piece of curve whose control polygon is `length` long (about every 4 px). */
const steps = (length: number) => Math.max(2, Math.min(200, Math.ceil(length / 4)));

function quadTo(a: Pt, c: Pt, b: Pt, out: Pt[]): void {
  const n = steps(dist(a, c) + dist(c, b));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y });
  }
}

function cubicTo(a: Pt, c1: Pt, c2: Pt, b: Pt, out: Pt[]): void {
  const n = steps(dist(a, c1) + dist(c1, c2) + dist(c2, b));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const k0 = u * u * u;
    const k1 = 3 * u * u * t;
    const k2 = 3 * u * t * t;
    const k3 = t * t * t;
    out.push({ x: k0 * a.x + k1 * c1.x + k2 * c2.x + k3 * b.x, y: k0 * a.y + k1 * c1.y + k2 * c2.y + k3 * b.y });
  }
}

/**
 * Centripetal Catmull-Rom spline through `run` (no cusps or loops between close points), as cubic
 * Bezier control points per segment (null for segments of zero length).
 */
export function splineSegments(run: Pt[]): ([Pt, Pt, Pt, Pt] | null)[] {
  const n = run.length;
  // Beyond the ends the line continues in the direction of its first and last pieces.
  const at = (i: number): Pt => (i < 0 ? sub(run[0], sub(run[1], run[0])) : i >= n ? sub(run[n - 1], sub(run[n - 2], run[n - 1])) : run[i]);
  const out: ([Pt, Pt, Pt, Pt] | null)[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1);
    const p1 = run[i];
    const p2 = run[i + 1];
    const p3 = at(i + 2);
    const d1 = Math.sqrt(dist(p0, p1));
    const d2 = Math.sqrt(dist(p1, p2));
    const d3 = Math.sqrt(dist(p2, p3));
    if (d2 < 1e-9) {
      out.push(null);
      continue;
    }
    const c1 =
      d1 > 1e-9
        ? {
            x: (d1 * d1 * p2.x - d2 * d2 * p0.x + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * p1.x) / (3 * d1 * (d1 + d2)),
            y: (d1 * d1 * p2.y - d2 * d2 * p0.y + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * p1.y) / (3 * d1 * (d1 + d2)),
          }
        : p1;
    const c2 =
      d3 > 1e-9
        ? {
            x: (d3 * d3 * p1.x - d2 * d2 * p3.x + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * p2.x) / (3 * d3 * (d3 + d2)),
            y: (d3 * d3 * p1.y - d2 * d2 * p3.y + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * p2.y) / (3 * d3 * (d3 + d2)),
          }
        : p2;
    out.push([p1, c1, c2, p2]);
  }
  return out;
}

/** A point of a cubic Bezier curve. */
export function bezierAt([a, c1, c2, b]: [Pt, Pt, Pt, Pt], t: number): Pt {
  const u = 1 - t;
  const k0 = u * u * u;
  const k1 = 3 * u * u * t;
  const k2 = 3 * u * t * t;
  const k3 = t * t * t;
  return { x: k0 * a.x + k1 * c1.x + k2 * c2.x + k3 * b.x, y: k0 * a.y + k1 * c1.y + k2 * c2.y + k3 * b.y };
}

/** Samples for a cubic Bezier segment (about every `px` px of its control polygon). */
export const bezierSteps = ([a, c1, c2, b]: [Pt, Pt, Pt, Pt], px = 4) => Math.max(2, Math.min(200, Math.ceil((dist(a, c1) + dist(c1, c2) + dist(c2, b)) / px)));

/** Appends the spline through `run`, all but its first point. */
function splineThrough(run: Pt[], out: Pt[]): void {
  for (const seg of splineSegments(run)) if (seg) cubicTo(seg[0], seg[1], seg[2], seg[3], out);
}

/** The curve as a polyline dense enough to stand for it. */
export function sampleCurve(spec: CurveSpec): Pt[] {
  const pts = spec.points;
  if (pts.length === 0) return [];
  const out: Pt[] = [pts[0]];
  const corner = new Set(spec.corners ?? []);
  switch (spec.curve) {
    case 'polyline':
      out.push(...pts.slice(1));
      break;
    case 'spline': {
      // Corners split the spline into smooth runs.
      let run = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        run.push(pts[i]);
        if (corner.has(i) && i < pts.length - 1) {
          splineThrough(run, out);
          run = [pts[i]];
        }
      }
      if (run.length > 1) splineThrough(run, out);
      break;
    }
    case 'quadratic': {
      const on = (i: number) => i === 0 || i === pts.length - 1 || corner.has(i);
      let cur = pts[0];
      for (let i = 1; i < pts.length; ) {
        if (on(i)) {
          out.push(pts[i]);
          cur = pts[i];
          i++;
          continue;
        }
        // Between two direction points the line passes halfway.
        const end = on(i + 1) ? pts[i + 1] : mid(pts[i], pts[i + 1]);
        quadTo(cur, pts[i], end, out);
        cur = end;
        i += on(i + 1) ? 2 : 1;
      }
      break;
    }
    case 'cubic':
      for (let i = 0; i + 3 < pts.length; i += 3) cubicTo(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], out);
      break;
  }
  return dedupe(out);
}

/** A figure's outline, closed (the last point repeats the first). */
export function figureOutline(f: FigureSpec): Pt[] {
  const cos = Math.cos(f.angle);
  const sin = Math.sin(f.angle);
  const at = ([u, v]: [number, number]): Pt => ({ x: f.center.x + u * cos - v * sin, y: f.center.y + u * sin + v * cos });
  const { rx, ry } = f;
  let local: [number, number][];
  if (f.shape === 'rect')
    local = [
      [-rx, -ry],
      [rx, -ry],
      [rx, ry],
      [-rx, ry],
    ];
  else {
    const n =
      f.shape === 'polygon'
        ? Math.max(3, Math.min(32, Math.round(f.corners)))
        : // About every 4 px of the circumference (Ramanujan).
          Math.max(24, Math.min(720, Math.ceil((Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)))) / 4)));
    const start = f.shape === 'polygon' ? -Math.PI / 2 : 0;
    local = Array.from({ length: n }, (_, k) => {
      const t = start + (2 * Math.PI * k) / n;
      return [Math.cos(t) * rx, Math.sin(t) * ry];
    });
  }
  const pts = local.map(at);
  return [...pts, pts[0]];
}

// ------------------------------------------------------------------ following a path

/** A polyline with the length along it at each point; a closed path ends where it starts. */
export interface Path {
  pts: Pt[];
  at: number[];
  closed: boolean;
}

export function makePath(pts: Pt[], closed = false): Path {
  const at = [0];
  for (let i = 1; i < pts.length; i++) at.push(at[i - 1] + dist(pts[i - 1], pts[i]));
  return { pts, at, closed };
}

export const pathTotal = (path: Path) => path.at[path.at.length - 1] ?? 0;

export interface PathHit {
  point: Pt;
  /** Length along the path. */
  s: number;
  dist: number;
  /** The segment the point is on. */
  seg: number;
}

/** The point of the path nearest to `p`; with `near`, of the part within `near.w` (along the path) of `near.s`. */
export function nearestOnPath(path: Path, p: Pt, near?: { s: number; w: number }): PathHit {
  const { pts, at } = path;
  let best: PathHit = { point: pts[0] ?? p, s: 0, dist: pts.length ? dist(p, pts[0]) : Infinity, seg: 0 };
  if (pts.length < 2) return best;
  const visit = (i: number) => {
    const a = pts[i];
    const d = sub(pts[i + 1], a);
    const l2 = dot(d, d);
    const t = l2 ? Math.max(0, Math.min(1, dot(sub(p, a), d) / l2)) : 0;
    const q = along(a, d, t);
    const e = dist(p, q);
    if (e < best.dist) best = { point: q, s: at[i] + (at[i + 1] - at[i]) * t, dist: e, seg: i };
  };
  const total = pathTotal(path);
  if (!near || 2 * near.w >= total) {
    for (let i = 0; i < pts.length - 1; i++) visit(i);
    return best;
  }
  // The segments that overlap [from, to] along the path.
  const range = (from: number, to: number) => {
    let lo = 0;
    let hi = pts.length - 2;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (at[m + 1] < from) lo = m + 1;
      else hi = m;
    }
    for (let i = lo; i < pts.length - 1 && at[i] <= to; i++) visit(i);
  };
  best = { ...best, dist: Infinity };
  const lo = near.s - near.w;
  const hi = near.s + near.w;
  if (!path.closed) range(Math.max(0, lo), Math.min(total, hi));
  else if (lo < 0) {
    range(0, hi);
    range(total + lo, total);
  } else if (hi > total) {
    range(lo, total);
    range(0, hi - total);
  } else range(lo, hi);
  return best.dist < Infinity ? best : nearestOnPath(path, p);
}

/** Extra room (px) along the path a stroke may move between two of its points. */
const FOLLOW_SLACK = 8;

/**
 * A stroke constraint that follows the path from where the stroke starts: every point goes to the
 * nearest point of the path close (along the path) to the one before, so strokes do not jump to
 * other parts where the path comes near itself.
 */
export function followPath(path: Path, start: Pt): Constraint {
  let s = nearestOnPath(path, start).s;
  let last = start;
  return (p) => {
    const hit = nearestOnPath(path, p, { s, w: dist(p, last) * 1.5 + FOLLOW_SLACK });
    s = hit.s;
    last = p;
    return hit.point;
  };
}

// ------------------------------------------------------------------ special curve rulers

/** The path with straight extensions of length `far` in the directions of its ends. */
export function extendPath(pts: Pt[], far: number): Pt[] {
  const p = dedupe(pts);
  if (p.length < 2) return p;
  const n = p.length;
  return [along(p[0], unit(sub(p[0], p[1])), far), ...p, along(p[n - 1], unit(sub(p[n - 1], p[n - 2])), far)];
}

/** Which side of the path `p` is on and how far: the offset that moves the path through `p`. */
export function sideOffset(path: Path, p: Pt): number {
  const hit = nearestOnPath(path, p);
  const a = path.pts[hit.seg];
  const b = path.pts[hit.seg + 1] ?? a;
  const t = unit(sub(b, a));
  const side = cross(t, sub(p, hit.point));
  return side < 0 ? -hit.dist : hit.dist;
}

/**
 * The path moved sideways by `d` (positive: to the side `cross(direction, side) > 0`, which is the
 * right in screen coordinates). Outer sides of bends get round joins; the loops a bend tighter than
 * `d` leaves on the inner side are cut off, so inner sides get sharp corners.
 */
export function offsetPath(pts: Pt[], d: number): Pt[] {
  const p = dedupe(pts);
  if (p.length < 2 || d === 0) return p.slice();
  const n = p.length;
  const T: Pt[] = [];
  for (let i = 0; i < n - 1; i++) T.push(unit(sub(p[i + 1], p[i])));
  const N = T.map((t) => ({ x: -t.y, y: t.x }));
  const out: Pt[] = [];
  /** Per segment of `out`: whether it runs against the path (part of a loop to cut). */
  const reversed: boolean[] = [];
  const push = (q: Pt, rev: boolean) => {
    if (out.length) reversed.push(rev);
    out.push(q);
  };
  /** A point reached along segment `seg` of the path. */
  const follow = (q: Pt, seg: number) => push(q, out.length > 0 && dot(sub(q, out[out.length - 1]), T[seg]) < 0);
  follow(along(p[0], N[0], d), 0);
  for (let i = 1; i < n - 1; i++) {
    const a = N[i - 1];
    const b = N[i];
    const bend = Math.atan2(cross(T[i - 1], T[i]), dot(T[i - 1], T[i]));
    if (Math.abs(bend) < 0.35) {
      // Gentle bend: one mitred point.
      const m = unit({ x: a.x + b.x, y: a.y + b.y });
      follow(along(p[i], m, d / Math.cos(bend / 2)), i - 1);
    } else if (bend * d < 0) {
      // Outer side: a round join.
      follow(along(p[i], a, d), i - 1);
      const k = Math.ceil(Math.abs(bend) / 0.2);
      for (let j = 1; j <= k; j++) push(along(p[i], turn(a, (bend * j) / k), d), false);
    } else {
      // Inner side of a sharp bend: the two offset lines cross; the loop between is cut off below.
      follow(along(p[i], a, d), i - 1);
      push(along(p[i], b, d), true);
    }
  }
  follow(along(p[n - 1], N[n - 2], d), n - 2);
  return cutLoops(out, reversed);
}

interface Crossing {
  i: number;
  j: number;
  ti: number;
  tj: number;
  at: Pt;
}

function segmentCrossing(a: Pt, b: Pt, c: Pt, d: Pt): { ti: number; tj: number; at: Pt } | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-12) return null;
  const ac = sub(c, a);
  const t = cross(ac, s) / den;
  const u = cross(ac, r) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { ti: t, tj: u, at: along(a, r, t) };
}

/** Where a polyline crosses itself (segments that are not neighbours), in order along it. */
export function selfCrossings(pts: Pt[]): Crossing[] {
  const m = pts.length - 1;
  if (m < 3) return [];
  const box = Array.from({ length: m }, (_, k) => {
    const a = pts[k];
    const b = pts[k + 1];
    return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) };
  });
  const order = Array.from({ length: m }, (_, k) => k).sort((a, b) => box[a].x0 - box[b].x0);
  let active: number[] = [];
  const found: Crossing[] = [];
  for (const k of order) {
    const bk = box[k];
    active = active.filter((a) => box[a].x1 >= bk.x0);
    for (const a of active) {
      if (Math.abs(a - k) < 2 || box[a].y1 < bk.y0 || bk.y1 < box[a].y0) continue;
      const i = Math.min(a, k);
      const j = Math.max(a, k);
      const x = segmentCrossing(pts[i], pts[i + 1], pts[j], pts[j + 1]);
      if (x) found.push({ i, j, ...x });
    }
    active.push(k);
  }
  return found.sort((a, b) => a.i - b.i || a.ti - b.ti);
}

/** Cuts the loops that contain a segment running against the path. */
function cutLoops(pts: Pt[], reversed: boolean[]): Pt[] {
  const before = [0];
  for (const r of reversed) before.push(before[before.length - 1] + (r ? 1 : 0));
  const anyReversed = (from: number, to: number) => to >= from && before[to + 1] - before[from] > 0;
  const out: Pt[] = [pts[0]];
  let seg = 0;
  let t = 0;
  for (const c of selfCrossings(pts)) {
    if (c.i < seg || (c.i === seg && c.ti <= t)) continue;
    if (!anyReversed(c.i + 1, c.j - 1) && !reversed[c.i] && !reversed[c.j]) continue;
    for (let k = seg + 1; k <= c.i; k++) out.push(pts[k]);
    out.push(c.at);
    seg = c.j;
    t = c.tj;
  }
  for (let k = seg + 1; k < pts.length; k++) out.push(pts[k]);
  return dedupe(out);
}

/** Multiple curve: how far to move the path along `dir` (unit) so it passes through `p` (the least). */
export function shiftThrough(pts: Pt[], dir: Pt, p: Pt): number | null {
  let best: number | null = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    // Zero where p − q is parallel to dir; linear along the segment.
    const fa = cross(sub(p, a), dir);
    const fb = cross(sub(p, b), dir);
    if ((fa > 0 && fb > 0) || (fa < 0 && fb < 0)) continue;
    const t = fa === fb ? 0 : fa / (fa - fb);
    const s = dot(sub(p, along(a, sub(b, a), t)), dir);
    if (best === null || Math.abs(s) < Math.abs(best)) best = s;
  }
  return best;
}

/** Radial curve: the angle that turns the path around `c` through `p` (at the first place along it that is as far from `c`), or null when no place is. */
export function turnThrough(pts: Pt[], c: Pt, p: Pt): number | null {
  const r = dist(p, c);
  const angleOf = (q: Pt) => Math.atan2(q.y - c.y, q.x - c.x);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const d = sub(pts[i + 1], a);
    const f = sub(a, c);
    const A = dot(d, d);
    if (A === 0) continue;
    const B = 2 * dot(f, d);
    const C = dot(f, f) - r * r;
    const disc = B * B - 4 * A * C;
    if (disc < 0) continue;
    const sq = Math.sqrt(disc);
    for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) if (t >= 0 && t <= 1) return angleOf(p) - angleOf(along(a, d, t));
  }
  return null;
}

export function translatePoints(pts: Pt[], dx: number, dy: number): Pt[] {
  return pts.map((q) => ({ x: q.x + dx, y: q.y + dy }));
}

export function rotatePoints(pts: Pt[], c: Pt, angle: number): Pt[] {
  return pts.map((q) => {
    const v = turn(sub(q, c), angle);
    return { x: c.x + v.x, y: c.y + v.y };
  });
}

// ------------------------------------------------------------------ the ruler pen

/** Douglas–Peucker: the fewest points that stay within `tolerance` of the line. */
export function simplifyPolyline(pts: Pt[], tolerance: number): Pt[] {
  const p = dedupe(pts);
  if (p.length < 3) return p;
  const keep = new Uint8Array(p.length);
  keep[0] = keep[p.length - 1] = 1;
  const stack: [number, number][] = [[0, p.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const d = sub(p[b], p[a]);
    const l = Math.hypot(d.x, d.y);
    let worst = -1;
    let far = tolerance;
    for (let i = a + 1; i < b; i++) {
      const e = l > 1e-9 ? Math.abs(cross(d, sub(p[i], p[a]))) / l : dist(p[i], p[a]);
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
  return p.filter((_, i) => keep[i]);
}

/** Light smoothing of a hand-drawn line (each point with its neighbours; the ends stay). */
export function smoothPolyline(pts: Pt[], passes = 2): Pt[] {
  let p = dedupe(pts);
  for (let k = 0; k < passes && p.length > 2; k++) p = p.map((q, i) => (i === 0 || i === p.length - 1 ? q : { x: (p[i - 1].x + 2 * q.x + p[i + 1].x) / 4, y: (p[i - 1].y + 2 * q.y + p[i + 1].y) / 4 }));
  return p;
}

/** The point at length `s` along the path. */
export function pointAt(path: Path, s: number): Pt {
  const { pts, at } = path;
  if (pts.length < 2) return pts[0] ?? { x: 0, y: 0 };
  const x = Math.max(0, Math.min(pathTotal(path), s));
  let i = 0;
  while (i < pts.length - 2 && at[i + 1] < x) i++;
  const l = at[i + 1] - at[i];
  return along(pts[i], sub(pts[i + 1], pts[i]), l ? (x - at[i]) / l : 0);
}
