/**
 * Automation clips: curve shapes, evaluation and compilation into piecewise-linear lanes.
 *
 * Like in FL Studio, every segment's shape belongs to the point that ends it, and its tension bends
 * the curve (or sets the frequency of the stepped/oscillating shapes). The formulas are our own.
 */
import type { AutomationData, AutomationPoint, Clip, CurveMode, Project } from './types';

export const CURVE_MODES: { id: CurveMode; label: string }[] = [
  { id: 'smooth', label: 'Smooth' },
  { id: 'hold', label: 'Hold' },
  { id: 'single', label: 'Single curve' },
  { id: 'single2', label: 'Single curve 2' },
  { id: 'single3', label: 'Single curve 3' },
  { id: 'double', label: 'Double curve' },
  { id: 'double2', label: 'Double curve 2' },
  { id: 'double3', label: 'Double curve 3' },
  { id: 'halfSine', label: 'Half sine' },
  { id: 'stairs', label: 'Stairs' },
  { id: 'smoothStairs', label: 'Smooth stairs' },
  { id: 'pulse', label: 'Pulse' },
  { id: 'wave', label: 'Wave' },
];

/** Shapes whose tension changes a frequency instead of bending the curve. */
const PERIODIC: ReadonlySet<CurveMode> = new Set(['stairs', 'smoothStairs', 'pulse', 'wave']);

/** Shapes without a tension handle. */
const NO_TENSION: ReadonlySet<CurveMode> = new Set(['hold', 'smooth']);

export function hasTension(mode: CurveMode): boolean {
  return !NO_TENSION.has(mode);
}

export function isPeriodic(mode: CurveMode): boolean {
  return PERIODIC.has(mode);
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const EXP_K = 10;

/** Exponential bend: tension > 0 starts slowly, < 0 starts fast; 0 is a straight line. */
function expCurve(x: number, t: number): number {
  if (Math.abs(t) < 1e-4) return x;
  return Math.expm1(EXP_K * t * x) / Math.expm1(EXP_K * t);
}

/** Inverse of expCurve at x = 0.5: tension that makes the curve pass through `mid` (0..1) at its middle. */
export function tensionForMid(mid: number): number {
  const m = Math.min(0.995, Math.max(0.005, mid));
  return Math.max(-1, Math.min(1, (2 / EXP_K) * Math.log(1 / m - 1)));
}

const powExp = (t: number) => Math.pow(4, t);

/** Number of steps/cycles for periodic shapes, 1..32, set by tension. */
export function periodicCount(t: number): number {
  return Math.max(1, Math.round(1 + ((t + 1) / 2) * 31));
}

const smoothstep = (x: number) => x * x * (3 - 2 * x);

/**
 * Normalized segment shape: 0 at the start point, 1 at the end point (periodic shapes may return to 0).
 * `x` is the position inside the segment, 0..1.
 */
export function curveShape(mode: CurveMode, tension: number, x: number): number {
  const u = clamp01(x);
  const t = Math.max(-1, Math.min(1, tension));
  switch (mode) {
    case 'single':
      return expCurve(u, t);
    case 'single2':
      return Math.pow(u, powExp(t));
    case 'single3': {
      // Asymmetric S: power-curved first half, mirrored and inverted second half.
      const e = powExp(t);
      return u < 0.5 ? 0.5 * Math.pow(2 * u, e) : 1 - 0.5 * Math.pow(2 - 2 * u, 1 / e);
    }
    case 'double':
      return u < 0.5 ? 0.5 * expCurve(2 * u, t) : 1 - 0.5 * expCurve(2 - 2 * u, t);
    case 'double2': {
      const e = powExp(t);
      return u < 0.5 ? 0.5 * Math.pow(2 * u, e) : 1 - 0.5 * Math.pow(2 - 2 * u, e);
    }
    case 'double3': {
      const s = 0.5 - 0.5 * Math.cos(Math.PI * u);
      const w = (t + 1) / 2;
      return u * (1 - w) + s * w;
    }
    case 'hold':
      return u >= 1 ? 1 : 0;
    case 'smooth':
      return 0.5 - 0.5 * Math.cos(Math.PI * u);
    case 'halfSine': {
      const a = Math.sin((u * Math.PI) / 2);
      const b = 1 - Math.cos((u * Math.PI) / 2);
      const w = (t + 1) / 2;
      return a * (1 - w) + b * w;
    }
    case 'stairs': {
      if (u >= 1) return 1;
      const n = periodicCount(t);
      return Math.floor(u * n) / n;
    }
    case 'smoothStairs': {
      if (u >= 1) return 1;
      const n = periodicCount(t);
      const f = u * n;
      const i = Math.floor(f);
      return (i + smoothstep(f - i)) / n;
    }
    case 'pulse': {
      if (u >= 1) return 1;
      const c = periodicCount(t);
      return Math.floor(u * c * 2) % 2 === 0 ? 0 : 1;
    }
    case 'wave': {
      if (u >= 1) return 1;
      const c = periodicCount(t);
      return 0.5 - 0.5 * Math.cos(2 * Math.PI * c * u);
    }
  }
}

/** Index of the last point with tick <= `tick` (-1 if before the first point). */
function segmentIndex(points: AutomationPoint[], tick: number): number {
  let lo = 0;
  let hi = points.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].tick <= tick) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Normalized value of the automation data at `tick` (holds the first/last value outside the points). */
export function evaluateAutomation(data: Pick<AutomationData, 'points'>, tick: number): number {
  const pts = data.points;
  if (pts.length === 0) return 0;
  const i = segmentIndex(pts, tick);
  if (i < 0) return pts[0].value;
  if (i >= pts.length - 1) return pts[pts.length - 1].value;
  const a = pts[i];
  const b = pts[i + 1];
  const span = b.tick - a.tick;
  if (span <= 0) return b.value;
  return a.value + (b.value - a.value) * curveShape(b.mode, b.tension, (tick - a.tick) / span);
}

/** Value at the middle of the segment ending at point `index` (where the tension handle is drawn). */
export function segmentMidValue(points: AutomationPoint[], index: number): number {
  const a = points[index - 1];
  const b = points[index];
  if (!a || !b) return b?.value ?? 0;
  return a.value + (b.value - a.value) * curveShape(b.mode, b.tension, 0.5);
}

/**
 * Samples one segment into [tick, value] pairs suitable for linear interpolation. Straight lines need
 * no extra points; curves are sampled finely enough that linear interpolation looks smooth.
 */
function sampleSegment(a: AutomationPoint, b: AutomationPoint, out: [number, number][]): void {
  const span = b.tick - a.tick;
  if (span <= 0) {
    out.push([b.tick, b.value]);
    return;
  }
  const dv = b.value - a.value;
  const mode = b.mode;
  if (mode === 'hold') {
    out.push([Math.max(a.tick, b.tick - Math.min(1, span / 2)), a.value], [b.tick, b.value]);
    return;
  }
  if ((mode === 'single' || mode === 'single2' || mode === 'double2') && Math.abs(b.tension) < 1e-4) {
    out.push([b.tick, b.value]);
    return;
  }
  if (mode === 'stairs' || mode === 'pulse') {
    // Exact steps with near-vertical edges (half a tick or less).
    const edges = mode === 'stairs' ? periodicCount(b.tension) : periodicCount(b.tension) * 2;
    const ramp = Math.min(0.5, span / edges / 4);
    for (let k = 1; k <= edges; k++) {
      const x = k / edges;
      const tk = a.tick + x * span;
      const before = a.value + dv * curveShape(mode, b.tension, x - 1e-9);
      const after = k === edges ? b.value : a.value + dv * curveShape(mode, b.tension, x + 1e-9);
      out.push([tk - ramp, before], [tk, after]);
    }
    return;
  }
  const periodic = isPeriodic(mode);
  const count = periodic
    ? Math.max(8, Math.min(512, Math.ceil(Math.min(span, 24 * periodicCount(b.tension)))))
    : Math.max(16, Math.min(128, Math.ceil(span / 2)));
  for (let k = 1; k < count; k++) {
    const x = k / count;
    out.push([a.tick + x * span, a.value + dv * curveShape(mode, b.tension, x)]);
  }
  out.push([b.tick, b.value]);
}

/** Piecewise-linear version of the automation data between `from` and `to` (data ticks). */
export function linearizeAutomation(data: Pick<AutomationData, 'points'>, from: number, to: number): [number, number][] {
  const pts = data.points;
  if (pts.length === 0 || to <= from) return [];
  const all: [number, number][] = [[pts[0].tick, pts[0].value]];
  for (let i = 1; i < pts.length; i++) sampleSegment(pts[i - 1], pts[i], all);
  const out: [number, number][] = [[from, evaluateAutomation(data, from)]];
  for (const [t, v] of all) if (t > from && t < to) out.push([t, v]);
  out.push([to, evaluateAutomation(data, to)]);
  return out;
}

export interface AutomationLane {
  target: string;
  /** Absolute song ticks and normalized values; linear interpolation, last value holds. */
  points: [number, number][];
}

/** Clips of automation channels, grouped per target and ordered by start. */
function automationClipsByTarget(project: Project): Map<string, { clip: Clip; data: AutomationData }[]> {
  const mutedTracks = new Set(project.tracks.filter((t) => t.muted).map((t) => t.id));
  const trackIds = new Set(project.tracks.map((t) => t.id));
  const data = new Map<string, AutomationData>();
  for (const ch of project.channels) if (ch.kind === 'automation' && !ch.muted) data.set(ch.id, ch.automation);
  const out = new Map<string, { clip: Clip; data: AutomationData }[]>();
  for (const clip of project.clips) {
    if (clip.kind !== 'automation' || clip.muted || !trackIds.has(clip.trackId) || mutedTracks.has(clip.trackId)) continue;
    const d = data.get(clip.channelId);
    if (!d || !d.target || d.points.length === 0 || clip.length <= 0) continue;
    const list = out.get(d.target) ?? [];
    list.push({ clip, data: d });
    out.set(d.target, list);
  }
  for (const list of out.values()) list.sort((x, y) => x.clip.start - y.clip.start);
  return out;
}

/**
 * Compiles every automation clip in the playlist into one lane per target. Where clips overlap the
 * later one wins; between clips the last value is held (FL Studio behaviour). Values stay normalized.
 */
export function compileAutomationLanes(project: Project): AutomationLane[] {
  const lanes: AutomationLane[] = [];
  for (const [target, clips] of automationClipsByTarget(project)) {
    const points: [number, number][] = [];
    clips.forEach(({ clip, data }, i) => {
      const next = clips[i + 1]?.clip;
      const end = Math.min(clip.start + clip.length, next ? next.start : Infinity);
      if (end <= clip.start) return;
      const local = linearizeAutomation(data, clip.offset, clip.offset + (end - clip.start));
      const shift = clip.start - clip.offset;
      if (points.length > 0) {
        // Hold the previous value right up to this clip's start, then jump.
        const held = points[points.length - 1][1];
        points.push([Math.max(points[points.length - 1][0], clip.start - 0.5), held]);
      }
      for (const [t, v] of local) points.push([t + shift, v]);
    });
    if (points.length) lanes.push({ target, points });
  }
  return lanes;
}

/** Value of a compiled lane at an absolute tick, or null before the lane starts. */
export function laneValueAt(lane: AutomationLane, tick: number): number | null {
  const pts = lane.points;
  if (pts.length === 0 || tick < pts[0][0]) return null;
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pts[mid][0] <= tick) lo = mid;
    else hi = mid - 1;
  }
  const a = pts[lo];
  const b = pts[lo + 1];
  if (!b) return a[1];
  const span = b[0] - a[0];
  return span <= 0 ? b[1] : a[1] + (b[1] - a[1]) * ((tick - a[0]) / span);
}

/** Flat automation of the given length at a normalized value (new clips start like this). */
export function flatAutomation(value: number, length: number): AutomationPoint[] {
  const v = clamp01(value);
  return [
    { tick: 0, value: v, tension: 0, mode: 'single' },
    { tick: Math.max(1, Math.round(length)), value: v, tension: 0, mode: 'single' },
  ];
}
