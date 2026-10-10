/**
 * Focus lines, speed lines and flashes, like the reference's Comic tool. Lines are placed along a
 * reference line – for focus lines an ellipse round the centre they point to, for speed lines a
 * straight line across them – spaced by the drawing interval (gap of line, disarray, grouping),
 * placed by the drawing position (length, disarray, extend lines, reference position, gap from
 * it, uneven reference position) and drawn as lines that thin out towards their ends (starting
 * and ending). Focus lines can fill their centre. The same seed always gives the same lines, so a
 * focus lines layer keeps them when it is drawn again. Pure, unit tested.
 */
import { seededRandom } from './stroke';

export type EffectLinesKind = 'focus' | 'speed';
/** Which part of each line lies on the reference line: its start (focus lines: inner side), middle or end (outer side). */
export type ReferencePosition = 'start' | 'middle' | 'end';
/** Focus lines: the gap of line as an angle round the centre or as a distance along the reference line. */
export type GapMode = 'angle' | 'distance';

export interface Pt {
  x: number;
  y: number;
}

export interface EffectLines {
  /** Object id (the Object tool selects it). */
  id: string;
  kind: EffectLinesKind;
  /** The same seed draws the same lines. */
  seed: number;
  /** Focus lines: the middle of the reference ellipse; speed lines: the middle of the reference line. */
  cx: number;
  cy: number;
  /** Focus lines: where the lines point to (the centre point), from the middle of the reference ellipse. */
  fx: number;
  fy: number;
  /** Focus lines: the radii of the reference ellipse; speed lines: rx is half the reference line's length (ry unused). */
  rx: number;
  ry: number;
  /** The reference ellipse's turn, or the reference line's direction (radians). */
  rotation: number;
  /** Speed lines: the lines' direction, in degrees from straight across the reference line. */
  angle: number;
  // Drawing interval
  /** Focus lines: degrees (angle) or px along the reference line (distance); speed lines: px. */
  gap: number;
  gapMode: GapMode;
  /** Varies the gaps, 0..100 % (0: off). */
  gapDisarray: number;
  /** Lines per group with empty space between the groups (0: no grouping). */
  grouping: number;
  /** Varies the lines per group, 0..100 %. */
  groupDisarray: number;
  /** The space between two groups, in gaps of line. */
  groupGap: number;
  /** Speed lines: at most this many lines. */
  maxLines: number;
  // Drawing position
  /** Line length (px). */
  length: number;
  /** Varies the lengths, 0..100 % (0: off). */
  lengthDisarray: number;
  /** The lines go on past the edge of the canvas. */
  extend: boolean;
  refPos: ReferencePosition;
  /** Gap from reference position: moves each line off the reference line by up to this part of its length, 0..1000 % (0: off). */
  refGap: number;
  /** Focus lines: Uneven reference position – the number of spikes (0: off) and their height (px). */
  unevenCount: number;
  unevenHeight: number;
  // Lines
  /** Line width (px). */
  width: number;
  /** Varies the widths, 0..100 %. */
  widthDisarray: number;
  /** Starting and ending: how much of each line thins out at the end nearer the centre or reference line, and at its far end (0..100 %). */
  taperStart: number;
  taperEnd: number;
  /** Lines of dots getting smaller as the line thins out (fireworks). */
  dotted: boolean;
  color: string;
  // Focus lines: Fill center
  fill: boolean;
  fillColor: string;
  /** 0..100 */
  fillOpacity: number;
}

/** Everything a sub tool keeps for the lines it draws: all but where they go, their seed and colours. */
export type EffectLinesStyle = Omit<EffectLines, 'id' | 'cx' | 'cy' | 'fx' | 'fy' | 'rx' | 'ry' | 'rotation' | 'seed' | 'color' | 'fillColor'>;

export interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One line: from `a` (the end nearer the centre or, for speed lines, before the reference line) to `b`. */
export interface EffectLine {
  a: Pt;
  b: Pt;
  width: number;
}

export interface EffectLinesGeometry {
  lines: EffectLine[];
  /** Focus lines with Fill center: the area inside the reference line. */
  fill: Pt[] | null;
  /** The reference line (closed for focus lines). */
  reference: Pt[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** A random factor round 1: ±`amount` (0..1) of it, never below a tenth. */
const vary = (rng: () => number, amount: number) => Math.max(0.1, 1 + amount * (rng() * 2 - 1));

/** How far from `p` along the unit vector `d` the ray leaves `area` (0 when it never is inside). */
export function exitDistance(p: Pt, d: Pt, area: Area): number {
  let tmin = -Infinity;
  let tmax = Infinity;
  for (const [o, dir, lo, hi] of [
    [p.x, d.x, area.x, area.x + area.w],
    [p.y, d.y, area.y, area.y + area.h],
  ]) {
    if (Math.abs(dir) < 1e-12) {
      if (o < lo || o > hi) return 0;
      continue;
    }
    const t1 = (lo - o) / dir;
    const t2 = (hi - o) / dir;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
  }
  return tmax >= Math.max(0, tmin) ? tmax : 0;
}

/**
 * Positions along a reference of length `total`, `gap` apart, varied by the disarray and broken
 * into groups. A closed reference (focus lines) starts at a random place and goes once round.
 */
export function linePositions(total: number, gap: number, e: Pick<EffectLines, 'gapDisarray' | 'grouping' | 'groupDisarray' | 'groupGap'>, rng: () => number, closed: boolean, max = Infinity): number[] {
  const out: number[] = [];
  if (!(gap > 0) || !(total > 0)) return out;
  const jitter = clamp(e.gapDisarray, 0, 100) / 100;
  const group = () => (e.grouping > 0 ? Math.max(1, Math.round(e.grouping * vary(rng, clamp(e.groupDisarray, 0, 100) / 100))) : Infinity);
  const start = closed ? rng() * gap : 0;
  const end = closed ? start + total - gap * 0.5 : total + 1e-9;
  let left = group();
  for (let p = start; p <= end && out.length < max; ) {
    out.push(closed ? p % total : p);
    let step = gap * vary(rng, jitter * 0.9);
    if (--left <= 0) {
      step += gap * Math.max(0, e.groupGap);
      left = group();
    }
    p += step;
  }
  return out;
}

/** Uneven reference position: how far out the reference lies at angle `t` (radians round the centre). */
export function unevenOffset(e: Pick<EffectLines, 'unevenCount' | 'unevenHeight'>, t: number): number {
  if (!(e.unevenCount > 0) || !(e.unevenHeight > 0)) return 0;
  const k = (((t / (Math.PI * 2)) * Math.round(e.unevenCount)) % 1 + 1) % 1;
  // A triangle wave: spikes outwards.
  return e.unevenHeight * (1 - Math.abs(2 * k - 1));
}

/** The lines (and fill) of focus or speed lines; `area` is the canvas they extend to. */
export function effectLinesGeometry(e: EffectLines, area: Area): EffectLinesGeometry {
  const rng = seededRandom(e.seed);
  const lines: EffectLine[] = [];
  const lengthJitter = clamp(e.lengthDisarray, 0, 100) / 100;
  const widthJitter = clamp(e.widthDisarray, 0, 100) / 100;
  const refGap = clamp(e.refGap, 0, 1000) / 100;
  const cos = Math.cos(e.rotation);
  const sin = Math.sin(e.rotation);
  const margin = e.width * 2 + 4;
  /** Places a line on reference point `r` going along `u` (`toCentre`: how far the centre is back along it, focus lines). */
  const place = (r: Pt, u: Pt, toCentre: number) => {
    let len = Math.max(1, e.length * vary(rng, lengthJitter * 0.9));
    const width = Math.max(0.2, e.width * vary(rng, widthJitter * 0.9));
    // Gap from reference position: away from the reference line, on the side the line lies.
    const side = e.refPos === 'start' ? 1 : e.refPos === 'end' ? -1 : rng() < 0.5 ? -1 : 1;
    const shift = refGap > 0 ? rng() * refGap * len * side : 0;
    const p = { x: r.x + u.x * shift, y: r.y + u.y * shift };
    const at = (t: number) => ({ x: p.x + u.x * t, y: p.y + u.y * t });
    let from: number;
    let to: number;
    if (e.refPos === 'start') {
      from = 0;
      to = e.extend ? exitDistance(p, u, area) + margin : len;
    } else if (e.refPos === 'middle') {
      from = e.extend && e.kind === 'speed' ? -(exitDistance(p, { x: -u.x, y: -u.y }, area) + margin) : -len / 2;
      to = e.extend ? exitDistance(p, u, area) + margin : len / 2;
    } else {
      // Focus lines end on the reference line and never pass the centre.
      if (e.kind === 'focus') len = Math.min(len, Math.max(0, toCentre + shift));
      from = e.extend && e.kind === 'speed' ? -(exitDistance(p, { x: -u.x, y: -u.y }, area) + margin) : -len;
      to = 0;
    }
    if (to - from < 0.5) return;
    lines.push({ a: at(from), b: at(to), width });
  };

  if (e.kind === 'focus') {
    const rx = Math.max(0, e.rx);
    const ry = Math.max(0, e.ry);
    const onEllipse = (t: number): Pt => {
      const x = rx * Math.cos(t);
      const y = ry * Math.sin(t);
      return { x: e.cx + x * cos - y * sin, y: e.cy + x * sin + y * cos };
    };
    const f = { x: e.cx + e.fx, y: e.cy + e.fy };
    /** The reference point at parameter `t` (with the uneven offset) and the direction out from the centre point. */
    const reference = (t: number): { r: Pt; u: Pt; dist: number } => {
      const q = onEllipse(t);
      let dx = q.x - f.x;
      let dy = q.y - f.y;
      let dist = Math.hypot(dx, dy);
      if (dist < 1e-9) {
        dx = Math.cos(t + e.rotation);
        dy = Math.sin(t + e.rotation);
        dist = 0;
      } else {
        dx /= dist;
        dy /= dist;
      }
      const d = dist + unevenOffset(e, Math.atan2(dy, dx));
      return { r: { x: f.x + dx * d, y: f.y + dy * d }, u: { x: dx, y: dy }, dist: d };
    };
    const meanRadius = Math.max(1, (rx + ry) / 2);
    const gap = e.gapMode === 'angle' ? (Math.max(0.05, e.gap) * Math.PI) / 180 : Math.max(0.5, e.gap) / meanRadius;
    for (const t of linePositions(Math.PI * 2, gap, e, rng, true, 20000)) {
      const { r, u, dist } = reference(t);
      place(r, u, dist);
    }
    const n = Math.max(128, Math.round(e.unevenCount) * 12);
    const outline = Array.from({ length: n }, (_, i) => reference((i / n) * Math.PI * 2).r);
    return { lines, fill: e.fill ? outline : null, reference: outline };
  }

  // Speed lines: along the reference line from A to B, across it (turned by the angle).
  const d = { x: cos, y: sin };
  const half = Math.max(0, e.rx);
  const a = { x: e.cx - d.x * half, y: e.cy - d.y * half };
  const turn = (e.angle * Math.PI) / 180;
  const v = { x: -d.y * Math.cos(turn) - d.x * Math.sin(turn), y: d.x * Math.cos(turn) - d.y * Math.sin(turn) };
  for (const s of linePositions(half * 2, Math.max(0.5, e.gap), e, rng, false, Math.max(1, e.maxLines))) place({ x: a.x + d.x * s, y: a.y + d.y * s }, v, Infinity);
  return { lines, fill: null, reference: [a, { x: e.cx + d.x * half, y: e.cy + d.y * half }] };
}

/** The outline of one line, thinning out over the first `taperStart` and last `taperEnd` per cent of its length. */
export function linePolygon(l: EffectLine, taperStart: number, taperEnd: number): Pt[] {
  const dx = l.b.x - l.a.x;
  const dy = l.b.y - l.a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return [];
  const nx = -dy / len;
  const ny = dx / len;
  const ts = clamp(taperStart, 0, 100) / 100;
  const te = clamp(taperEnd, 0, 100) / 100;
  const half = (t: number) => (l.width / 2) * Math.min(1, ts > 0 ? t / ts : 1) * Math.min(1, te > 0 ? (1 - t) / te : 1);
  const ts2 = [...new Set([0, ts, 1 - te, 1, 0.25, 0.5, 0.75].map((t) => clamp(t, 0, 1)))].sort((p, q) => p - q);
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (const t of ts2) {
    const h = Math.max(0, half(t));
    const x = l.a.x + dx * t;
    const y = l.a.y + dy * t;
    left.push({ x: x + nx * h, y: y + ny * h });
    right.push({ x: x - nx * h, y: y - ny * h });
  }
  return [...left, ...right.reverse()];
}

/** What drawing needs of a canvas context. */
export interface PathTarget {
  fillStyle: string | CanvasGradient | CanvasPattern;
  globalAlpha: number;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  fill(): void;
}

const tracePolygon = (ctx: PathTarget, pts: Pt[]) => {
  if (pts.length < 3) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
};

/** Draws the lines (and the filled centre under them). */
export function drawEffectLines(ctx: PathTarget, e: EffectLines, area: Area): void {
  const g = effectLinesGeometry(e, area);
  const alpha = ctx.globalAlpha;
  if (g.fill && e.fillOpacity > 0) {
    ctx.globalAlpha = alpha * (clamp(e.fillOpacity, 0, 100) / 100);
    ctx.fillStyle = e.fillColor;
    ctx.beginPath();
    tracePolygon(ctx, g.fill);
    ctx.fill();
    ctx.globalAlpha = alpha;
  }
  ctx.fillStyle = e.color;
  ctx.beginPath();
  if (e.dotted) for (const l of g.lines) for (const d of lineDots(l, e.taperStart, e.taperEnd)) traceCircle(ctx, d.x, d.y, d.r);
  else for (const l of g.lines) tracePolygon(ctx, linePolygon(l, e.taperStart, e.taperEnd));
  ctx.fill();
}

/** Dotted lines: dots along the line, as wide as it is there, about two dot widths apart. */
export function lineDots(l: EffectLine, taperStart: number, taperEnd: number): { x: number; y: number; r: number }[] {
  const len = Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y);
  const ts = clamp(taperStart, 0, 100) / 100;
  const te = clamp(taperEnd, 0, 100) / 100;
  const out: { x: number; y: number; r: number }[] = [];
  const step = Math.max(1, l.width * 2);
  for (let d = l.width / 2; d < len; d += step) {
    const t = d / len;
    const r = (l.width / 2) * Math.min(1, ts > 0 ? t / ts : 1) * Math.min(1, te > 0 ? (1 - t) / te : 1);
    if (r > 0.2) out.push({ x: l.a.x + ((l.b.x - l.a.x) * d) / len, y: l.a.y + ((l.b.y - l.a.y) * d) / len, r });
  }
  return out;
}

/** A circle as a polygon on the path (so all dots fill as one shape). */
function traceCircle(ctx: PathTarget, x: number, y: number, r: number): void {
  const n = Math.max(6, Math.min(24, Math.round(r * 2)));
  ctx.moveTo(x + r, y);
  for (let i = 1; i < n; i++) ctx.lineTo(x + r * Math.cos((i / n) * Math.PI * 2), y + r * Math.sin((i / n) * Math.PI * 2));
  ctx.closePath();
}

/** The box round focus or speed lines' reference line and centre (the Object tool's box). */
export function referenceBounds(e: EffectLines): Area {
  const g = effectLinesGeometry({ ...e, length: 0, extend: false, gap: 1e9 }, { x: 0, y: 0, w: 0, h: 0 });
  const pts = [...g.reference, { x: e.cx + (e.kind === 'focus' ? e.fx : 0), y: e.cy + (e.kind === 'focus' ? e.fy : 0) }];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Moves focus or speed lines. */
export const translateEffectLines = (e: EffectLines, dx: number, dy: number): EffectLines => ({ ...e, cx: e.cx + dx, cy: e.cy + dy });

/** Scales focus or speed lines about (ox, oy) by (sx, sy) – the reference, lengths, widths and gaps (distances) with it. */
export function scaleEffectLines(e: EffectLines, ox: number, oy: number, sx: number, sy: number): EffectLines {
  const k = Math.sqrt(Math.abs(sx * sy)) || 1;
  // The reference ellipse's axes, scaled as the turned axes are.
  const c = Math.cos(e.rotation);
  const s = Math.sin(e.rotation);
  const ax = Math.hypot(c * sx, s * sy);
  const ay = Math.hypot(-s * sx, c * sy);
  const rotation = Math.atan2(s * sy, c * sx);
  return {
    ...e,
    cx: ox + (e.cx - ox) * sx,
    cy: oy + (e.cy - oy) * sy,
    fx: e.fx * sx,
    fy: e.fy * sy,
    rx: e.rx * ax,
    ry: e.ry * ay,
    rotation,
    length: e.length * k,
    width: e.width * k,
    gap: e.kind === 'speed' || e.gapMode === 'distance' ? e.gap * k : e.gap,
    unevenHeight: e.unevenHeight * k,
  };
}

/** Turns focus or speed lines by `angle` (radians) about (ox, oy). */
export function rotateEffectLines(e: EffectLines, ox: number, oy: number, angle: number): EffectLines {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = e.cx - ox;
  const y = e.cy - oy;
  return { ...e, cx: ox + x * c - y * s, cy: oy + x * s + y * c, fx: e.fx * c - e.fy * s, fy: e.fx * s + e.fy * c, rotation: e.rotation + angle };
}

/** A new random seed. */
export const newSeed = (): number => Math.floor(Math.random() * 0x7fffffff);

/** A new object id for focus or speed lines. */
export const newLinesId = (): string => `e${Math.random().toString(36).slice(2, 10)}`;

/** An affine map [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f. */
export type Affine = [number, number, number, number, number, number];

/**
 * Focus or speed lines under an affine map (Move layer, transforms, flips): the reference follows
 * it (its axes as they are mapped), lengths, widths and distances scale with it, the lines keep
 * their direction against the reference line.
 */
export function transformEffectLines(e: EffectLines, m: Affine): EffectLines {
  const lin = (x: number, y: number): Pt => ({ x: m[0] * x + m[2] * y, y: m[1] * x + m[3] * y });
  const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
  const c = Math.cos(e.rotation);
  const s = Math.sin(e.rotation);
  const a1 = lin(c, s);
  const a2 = lin(-s, c);
  const rotation = Math.atan2(a1.y, a1.x);
  let angle = e.angle;
  if (e.kind === 'speed') {
    // The lines' direction, mapped, measured again from straight across the mapped reference line.
    const turn = (e.angle * Math.PI) / 180;
    const v = lin(-s * Math.cos(turn) - c * Math.sin(turn), c * Math.cos(turn) - s * Math.sin(turn));
    const n = { x: -Math.sin(rotation), y: Math.cos(rotation) };
    angle = (Math.atan2(n.x * v.y - n.y * v.x, n.x * v.x + n.y * v.y) * 180) / Math.PI;
  }
  const f = lin(e.fx, e.fy);
  return {
    ...e,
    cx: m[0] * e.cx + m[2] * e.cy + m[4],
    cy: m[1] * e.cx + m[3] * e.cy + m[5],
    fx: f.x,
    fy: f.y,
    rx: e.rx * Math.hypot(a1.x, a1.y),
    ry: e.ry * Math.hypot(a2.x, a2.y),
    rotation,
    angle,
    length: e.length * k,
    width: e.width * k,
    gap: e.kind === 'speed' || e.gapMode === 'distance' ? e.gap * k : e.gap,
    unevenHeight: e.unevenHeight * k,
  };
}

/** Whether `p` is on focus or speed lines: inside their reference or on one of their lines. */
export function hitEffectLines(e: EffectLines, p: Pt, tolerance: number, area: Area): boolean {
  const b = referenceBounds(e);
  if (p.x >= b.x - tolerance && p.x <= b.x + b.w + tolerance && p.y >= b.y - tolerance && p.y <= b.y + b.h + tolerance) return true;
  for (const l of effectLinesGeometry(e, area).lines) {
    const dx = l.b.x - l.a.x;
    const dy = l.b.y - l.a.y;
    const len2 = dx * dx + dy * dy || 1;
    const t = clamp(((p.x - l.a.x) * dx + (p.y - l.a.y) * dy) / len2, 0, 1);
    if (Math.hypot(p.x - (l.a.x + dx * t), p.y - (l.a.y + dy * t)) <= l.width / 2 + tolerance) return true;
  }
  return false;
}

const KINDS: EffectLinesKind[] = ['focus', 'speed'];
const POSITIONS: ReferencePosition[] = ['start', 'middle', 'end'];

/** Focus or speed lines from a file (or storage), with every value checked; null when it is not one. */
export function sanitizeEffectLines(raw: unknown, fallback?: EffectLines): EffectLines | null {
  if (!raw || typeof raw !== 'object') return fallback ?? null;
  const r = raw as Record<string, unknown>;
  const kind = KINDS.includes(r.kind as EffectLinesKind) ? (r.kind as EffectLinesKind) : fallback?.kind;
  if (!kind) return null;
  const base = fallback ?? { ...DEFAULT_FOCUS_LINES, kind };
  const num = (k: keyof EffectLines, lo: number, hi: number) => {
    const v = r[k];
    return typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : (base[k] as number);
  };
  const color = (k: 'color' | 'fillColor') => (typeof r[k] === 'string' && /^#[0-9a-f]{6}$/i.test(r[k] as string) ? (r[k] as string).toLowerCase() : base[k]);
  return {
    id: typeof r.id === 'string' && /^[\w-]{1,40}$/.test(r.id) ? r.id : newLinesId(),
    kind,
    seed: Math.round(num('seed', 0, 0x7fffffff)),
    cx: num('cx', -1e6, 1e6),
    cy: num('cy', -1e6, 1e6),
    fx: num('fx', -1e6, 1e6),
    fy: num('fy', -1e6, 1e6),
    rx: num('rx', 0, 1e6),
    ry: num('ry', 0, 1e6),
    rotation: num('rotation', -100, 100),
    angle: num('angle', -360, 360),
    gap: num('gap', 0.05, 10000),
    gapMode: r.gapMode === 'distance' || r.gapMode === 'angle' ? r.gapMode : base.gapMode,
    gapDisarray: num('gapDisarray', 0, 100),
    grouping: Math.round(num('grouping', 0, 1000)),
    groupDisarray: num('groupDisarray', 0, 100),
    groupGap: num('groupGap', 0, 1000),
    maxLines: Math.round(num('maxLines', 1, 10000)),
    length: num('length', 1, 1e6),
    lengthDisarray: num('lengthDisarray', 0, 100),
    extend: typeof r.extend === 'boolean' ? r.extend : base.extend,
    refPos: POSITIONS.includes(r.refPos as ReferencePosition) ? (r.refPos as ReferencePosition) : base.refPos,
    refGap: num('refGap', 0, 1000),
    unevenCount: Math.round(num('unevenCount', 0, 1000)),
    unevenHeight: num('unevenHeight', 0, 1e5),
    width: num('width', 0.2, 2000),
    widthDisarray: num('widthDisarray', 0, 100),
    taperStart: num('taperStart', 0, 100),
    taperEnd: num('taperEnd', 0, 100),
    dotted: typeof r.dotted === 'boolean' ? r.dotted : base.dotted,
    color: color('color'),
    fill: typeof r.fill === 'boolean' ? r.fill : base.fill,
    fillColor: color('fillColor'),
    fillOpacity: num('fillOpacity', 0, 100),
  };
}

/** Defaults for the settings a sub tool leaves out. */
export const DEFAULT_FOCUS_LINES: EffectLines = {
  id: '',
  kind: 'focus',
  seed: 1,
  cx: 0,
  cy: 0,
  fx: 0,
  fy: 0,
  rx: 100,
  ry: 100,
  rotation: 0,
  angle: 0,
  gap: 3,
  gapMode: 'angle',
  gapDisarray: 50,
  grouping: 0,
  groupDisarray: 0,
  groupGap: 2,
  maxLines: 200,
  length: 400,
  lengthDisarray: 30,
  extend: true,
  refPos: 'start',
  refGap: 30,
  unevenCount: 0,
  unevenHeight: 20,
  width: 6,
  widthDisarray: 50,
  taperStart: 80,
  taperEnd: 0,
  dotted: false,
  color: '#000000',
  fill: false,
  fillColor: '#ffffff',
  fillOpacity: 100,
};
