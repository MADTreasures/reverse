/**
 * Rulers: guides that strokes snap to (linear ruler, guide, special rulers, symmetry, perspective).
 * Geometry only – pure functions, unit tested. Points are in document pixels.
 */

export interface Pt {
  x: number;
  y: number;
}

/** 2D affine transform [a, b, c, d, e, f] (like canvas setTransform). */
export type Affine = [number, number, number, number, number, number];

export type Ruler =
  /** Straight ruler between two points; strokes that start near it follow its line. */
  | { kind: 'linear'; id: string; a: Pt; b: Pt }
  /** Horizontal or vertical guide line. */
  | { kind: 'guide'; id: string; vertical: boolean; pos: number }
  /** Special ruler: every stroke is a straight line at this angle (radians). */
  | { kind: 'parallel'; id: string; origin: Pt; angle: number }
  /** Special ruler: every stroke runs towards (or away from) the centre (focus lines). */
  | { kind: 'radial'; id: string; center: Pt }
  /** Special ruler: every stroke is an ellipse around the centre with this shape. */
  | { kind: 'concentric'; id: string; center: Pt; rx: number; ry: number; angle: number }
  /** Symmetrical ruler: `lines` rays from the centre; strokes repeat in every sector. */
  | { kind: 'symmetry'; id: string; center: Pt; angle: number; lines: number; mirror: boolean }
  /** Perspective ruler with 1–3 vanishing points; the first two lie on the eye level. */
  | { kind: 'perspective'; id: string; vps: Pt[] };

export type RulerKind = Ruler['kind'];

/** A ruler before it has an id. */
export type RulerInput = { [K in RulerKind]: Omit<Extract<Ruler, { kind: K }>, 'id'> & { id?: string } }[RulerKind];

/** Linear rulers and guides snap with "Snap to ruler"; the others are special rulers. */
export const isSpecial = (r: Ruler) => r.kind !== 'linear' && r.kind !== 'guide';

export const RULER_LABELS: Record<RulerKind, string> = {
  linear: 'Linear ruler',
  guide: 'Guide',
  parallel: 'Parallel line',
  radial: 'Radial line',
  concentric: 'Concentric circle',
  symmetry: 'Symmetrical ruler',
  perspective: 'Perspective ruler',
};

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const len = (a: Pt) => Math.hypot(a.x, a.y);

/** Projects `p` onto the infinite line through `a` with direction `dir`. */
export function projectOnLine(p: Pt, a: Pt, dir: Pt): Pt {
  const l2 = dot(dir, dir);
  if (l2 === 0) return { ...a };
  const t = dot(sub(p, a), dir) / l2;
  return { x: a.x + dir.x * t, y: a.y + dir.y * t };
}

export function distanceToLine(p: Pt, a: Pt, dir: Pt): number {
  return len(sub(p, projectOnLine(p, a, dir)));
}

// ------------------------------------------------------------------ symmetry

const rotation = (c: Pt, angle: number): Affine => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [cos, sin, -sin, cos, c.x - cos * c.x + sin * c.y, c.y - sin * c.x - cos * c.y];
};

/** Reflection across the line through `c` at `angle`. */
const reflection = (c: Pt, angle: number): Affine => {
  const cos = Math.cos(2 * angle);
  const sin = Math.sin(2 * angle);
  return [cos, sin, sin, -cos, c.x - cos * c.x - sin * c.y, c.y - sin * c.x + cos * c.y];
};

/**
 * The copies a stroke is drawn in (identity first). Without line symmetry: `lines` rotations.
 * With line symmetry the rays form mirror axes: an even number of rays gives lines/2 axes (2 rays =
 * plain left/right mirror), an odd number one axis per ray.
 */
export function symmetryTransforms(r: Extract<Ruler, { kind: 'symmetry' }>): Affine[] {
  const n = Math.max(2, Math.min(32, Math.round(r.lines)));
  if (!r.mirror) return Array.from({ length: n }, (_, i) => rotation(r.center, (i * 2 * Math.PI) / n));
  const axes = n % 2 === 0 ? n / 2 : n;
  const out: Affine[] = [];
  for (let i = 0; i < axes; i++) out.push(rotation(r.center, (i * 2 * Math.PI) / axes));
  for (let i = 0; i < axes; i++) out.push(reflection(r.center, r.angle + (i * Math.PI) / axes));
  return out;
}

export function applyAffine(m: Affine, p: Pt): Pt {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/** Rotation part of an affine (radians), and whether it mirrors. */
export function affineAngle(m: Affine): { angle: number; mirrored: boolean } {
  return { angle: Math.atan2(m[1], m[0]), mirrored: m[0] * m[3] - m[1] * m[2] < 0 };
}

// ------------------------------------------------------------------ snapping

/** A stroke constraint: maps every point onto the stroke's path. */
export type Constraint = (p: Pt) => Pt;

/** How close (document px) a stroke must start to a linear ruler or guide to follow it. */
export const SNAP_DISTANCE = 24;

/** Constraint for a stroke starting at `start`, or null when the ruler does not apply. */
export function rulerConstraint(r: Ruler, start: Pt, snapDistance = SNAP_DISTANCE): Constraint | null {
  switch (r.kind) {
    case 'linear': {
      const dir = sub(r.b, r.a);
      if (distanceToLine(start, r.a, dir) > snapDistance) return null;
      return (p) => projectOnLine(p, r.a, dir);
    }
    case 'guide': {
      if (Math.abs((r.vertical ? start.x : start.y) - r.pos) > snapDistance) return null;
      return (p) => (r.vertical ? { x: r.pos, y: p.y } : { x: p.x, y: r.pos });
    }
    case 'parallel': {
      const dir = { x: Math.cos(r.angle), y: Math.sin(r.angle) };
      return (p) => projectOnLine(p, start, dir);
    }
    case 'radial': {
      const dir = sub(start, r.center);
      if (len(dir) < 1) return null;
      return (p) => projectOnLine(p, r.center, dir);
    }
    case 'concentric': {
      // The ellipse through the start point, with the ruler's shape and angle.
      const cos = Math.cos(-r.angle);
      const sin = Math.sin(-r.angle);
      const local = (p: Pt) => {
        const d = sub(p, r.center);
        return { x: (d.x * cos - d.y * sin) / Math.max(1e-6, r.rx), y: (d.x * sin + d.y * cos) / Math.max(1e-6, r.ry) };
      };
      const s0 = len(local(start));
      if (s0 < 1e-6) return null;
      return (p) => {
        const q = local(p);
        const l = len(q) || 1;
        const u = { x: (q.x / l) * s0 * r.rx, y: (q.y / l) * s0 * r.ry };
        // Back to document coordinates.
        return { x: r.center.x + u.x * Math.cos(r.angle) - u.y * Math.sin(r.angle), y: r.center.y + u.x * Math.sin(r.angle) + u.y * Math.cos(r.angle) };
      };
    }
    case 'symmetry':
    case 'perspective':
      return null;
  }
}

/**
 * Perspective: once the stroke has moved a little, it follows the direction (towards a vanishing
 * point, or the vertical auxiliary lines of 1- and 2-point rulers, or the eye level of a 1-point
 * ruler) closest to the direction of the movement so far.
 */
export function perspectiveConstraint(r: Extract<Ruler, { kind: 'perspective' }>, start: Pt, now: Pt): Constraint | null {
  const move = sub(now, start);
  if (len(move) < 1e-6) return null;
  const dirs: Pt[] = r.vps.map((vp) => sub(vp, start)).filter((d) => len(d) > 1e-6);
  if (r.vps.length < 3) dirs.push({ x: 0, y: 1 });
  if (r.vps.length === 1) dirs.push({ x: 1, y: 0 });
  let best: Pt | null = null;
  let bestCos = -1;
  for (const d of dirs) {
    const c = Math.abs(dot(d, move)) / (len(d) * len(move));
    if (c > bestCos) {
      bestCos = c;
      best = d;
    }
  }
  if (!best) return null;
  const dir = best;
  return (p) => projectOnLine(p, start, dir);
}

/** The eye level of a perspective ruler: through the first two vanishing points (or level through one). */
export function eyeLevel(r: Extract<Ruler, { kind: 'perspective' }>): { a: Pt; dir: Pt } {
  const a = r.vps[0];
  const b = r.vps[1];
  return { a, dir: b ? sub(b, a) : { x: 1, y: 0 } };
}

// ------------------------------------------------------------------ editing

export interface Handle {
  /** Stable name of the handle within its ruler ('a', 'b', 'center', 'vp0', 'rotate' …). */
  key: string;
  at: Pt;
}

/** Points that can be dragged with the Object tool. */
export function rulerHandles(r: Ruler, canvas: { w: number; h: number }): Handle[] {
  switch (r.kind) {
    case 'linear':
      return [
        { key: 'a', at: r.a },
        { key: 'b', at: r.b },
      ];
    case 'guide':
      return [{ key: 'pos', at: r.vertical ? { x: r.pos, y: canvas.h / 2 } : { x: canvas.w / 2, y: r.pos } }];
    case 'parallel':
      return [
        { key: 'origin', at: r.origin },
        { key: 'rotate', at: { x: r.origin.x + Math.cos(r.angle) * 80, y: r.origin.y + Math.sin(r.angle) * 80 } },
      ];
    case 'radial':
      return [{ key: 'center', at: r.center }];
    case 'concentric':
      return [
        { key: 'center', at: r.center },
        { key: 'radius', at: { x: r.center.x + Math.cos(r.angle) * r.rx, y: r.center.y + Math.sin(r.angle) * r.rx } },
      ];
    case 'symmetry':
      return [
        { key: 'center', at: r.center },
        { key: 'rotate', at: { x: r.center.x + Math.cos(r.angle) * 100, y: r.center.y + Math.sin(r.angle) * 100 } },
      ];
    case 'perspective':
      return r.vps.map((vp, i) => ({ key: `vp${i}`, at: vp }));
  }
}

/** The ruler with one handle moved to `p` (`shift` keeps linear rulers at 45° steps). */
export function moveHandle(r: Ruler, key: string, p: Pt, shift = false): Ruler {
  switch (r.kind) {
    case 'linear': {
      const fixed = key === 'a' ? r.b : r.a;
      let q = p;
      if (shift) {
        const d = sub(p, fixed);
        const step = Math.PI / 4;
        const a = Math.round(Math.atan2(d.y, d.x) / step) * step;
        q = { x: fixed.x + Math.cos(a) * len(d), y: fixed.y + Math.sin(a) * len(d) };
      }
      return key === 'a' ? { ...r, a: q } : { ...r, b: q };
    }
    case 'guide':
      return { ...r, pos: r.vertical ? p.x : p.y };
    case 'parallel':
      return key === 'origin' ? { ...r, origin: p } : { ...r, angle: Math.atan2(p.y - r.origin.y, p.x - r.origin.x) };
    case 'radial':
      return { ...r, center: p };
    case 'concentric':
      if (key === 'center') return { ...r, center: p };
      return { ...r, rx: Math.max(1, len(sub(p, r.center))), angle: Math.atan2(p.y - r.center.y, p.x - r.center.x) };
    case 'symmetry':
      return key === 'center' ? { ...r, center: p } : { ...r, angle: Math.atan2(p.y - r.center.y, p.x - r.center.x) };
    case 'perspective': {
      const i = Number(key.slice(2));
      const vps = r.vps.map((v, k) => (k === i ? p : v));
      // The first two vanishing points share the eye level: moving one vertically moves the other.
      if ((i === 0 || i === 1) && vps.length >= 2) vps[1 - i] = { ...vps[1 - i], y: p.y };
      return { ...r, vps };
    }
  }
}

/** Moves the whole ruler by (dx, dy). */
export function translateRuler(r: Ruler, dx: number, dy: number): Ruler {
  const t = (p: Pt) => ({ x: p.x + dx, y: p.y + dy });
  switch (r.kind) {
    case 'linear':
      return { ...r, a: t(r.a), b: t(r.b) };
    case 'guide':
      return { ...r, pos: r.pos + (r.vertical ? dx : dy) };
    case 'parallel':
      return { ...r, origin: t(r.origin) };
    case 'radial':
    case 'concentric':
    case 'symmetry':
      return { ...r, center: t(r.center) };
    case 'perspective':
      return { ...r, vps: r.vps.map(t) };
  }
}

/** Distance from `p` to the drawn ruler (for picking a ruler with the Object tool). */
export function distanceToRuler(r: Ruler, p: Pt): number {
  switch (r.kind) {
    case 'linear': {
      const d = sub(r.b, r.a);
      const l2 = dot(d, d);
      const t = l2 ? Math.max(0, Math.min(1, dot(sub(p, r.a), d) / l2)) : 0;
      return len(sub(p, { x: r.a.x + d.x * t, y: r.a.y + d.y * t }));
    }
    case 'guide':
      return Math.abs((r.vertical ? p.x : p.y) - r.pos);
    case 'parallel':
      return distanceToLine(p, r.origin, { x: Math.cos(r.angle), y: Math.sin(r.angle) });
    case 'radial':
      return len(sub(p, r.center));
    case 'concentric': {
      const d = sub(p, r.center);
      return Math.abs(len(d) - (r.rx + r.ry) / 2);
    }
    case 'symmetry': {
      const n = Math.max(2, Math.round(r.lines));
      let best = Infinity;
      for (let i = 0; i < n; i++) {
        const a = r.angle + (i * 2 * Math.PI) / n;
        const dir = { x: Math.cos(a), y: Math.sin(a) };
        const v = sub(p, r.center);
        // Rays, not full lines.
        best = Math.min(best, dot(v, dir) < 0 ? len(v) : distanceToLine(p, r.center, dir));
      }
      return best;
    }
    case 'perspective':
      return Math.min(...r.vps.map((vp) => len(sub(p, vp))), distanceToLine(p, eyeLevel(r).a, eyeLevel(r).dir));
  }
}

/** Default perspective rulers for Layer > Ruler/Frame > Create perspective ruler. */
export function defaultPerspective(points: 1 | 2 | 3, w: number, h: number): Pt[] {
  const horizon = h * 0.4;
  if (points === 1) return [{ x: w / 2, y: horizon }];
  const two = [
    { x: -w * 0.6, y: horizon },
    { x: w * 1.6, y: horizon },
  ];
  return points === 2 ? two : [...two, { x: w / 2, y: h * 3 }];
}

// ------------------------------------------------------------------ validation (untrusted files)

const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1e6, Math.min(1e6, v)) : fallback);
const pt = (v: unknown): Pt => {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return { x: num(o.x), y: num(o.y) };
};

export function sanitizeRuler(raw: unknown): Ruler | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(r.id) ? r.id : `r${Math.random().toString(36).slice(2, 10)}`;
  switch (r.kind) {
    case 'linear':
      return { kind: 'linear', id, a: pt(r.a), b: pt(r.b) };
    case 'guide':
      return { kind: 'guide', id, vertical: r.vertical === true, pos: num(r.pos) };
    case 'parallel':
      return { kind: 'parallel', id, origin: pt(r.origin), angle: num(r.angle) };
    case 'radial':
      return { kind: 'radial', id, center: pt(r.center) };
    case 'concentric':
      return { kind: 'concentric', id, center: pt(r.center), rx: Math.max(1, num(r.rx, 100)), ry: Math.max(1, num(r.ry, 100)), angle: num(r.angle) };
    case 'symmetry':
      return { kind: 'symmetry', id, center: pt(r.center), angle: num(r.angle, -Math.PI / 2), lines: Math.max(2, Math.min(32, Math.round(num(r.lines, 2)))), mirror: r.mirror !== false };
    case 'perspective': {
      const vps = Array.isArray(r.vps) ? r.vps.slice(0, 3).map(pt) : [];
      return vps.length ? { kind: 'perspective', id, vps } : null;
    }
    default:
      return null;
  }
}
