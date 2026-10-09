/**
 * Keyframes: a track's settings over time. A keyframe records some or all of a track's properties
 * at a frame (position, scale ratio, rotation, centre of rotation, opacity; an audio track's volume);
 * keyframes that record only some show small in the Timeline palette, as in the reference. Each
 * property changes between the keyframes that record it as the earlier one's interpolation says
 * (hold: jump at the next keyframe, linear: at a steady pace, smooth: speed up and slow down); the
 * Graph Editor bends a stretch with the slope handles of its two keyframes. Layers with "Enable
 * keyframes on this layer" are drawn placed so; a 2D camera folder's keyframes place its camera
 * frame, through which its layers are seen. Pure, unit tested.
 */
import type { Affine } from './rulers';

export type Interp = 'hold' | 'linear' | 'smooth';

export const INTERPS: Interp[] = ['hold', 'linear', 'smooth'];

/** What a keyframe can record. */
export interface Placement {
  /** Movement (document px). */
  x: number;
  y: number;
  /** Scale ratio (1 = 100 %). */
  scaleX: number;
  scaleY: number;
  /** Degrees, clockwise. */
  rotation: number;
  /** Centre of rotation and scaling (document px, before the movement). */
  pivotX: number;
  pivotY: number;
  /** 0..1 */
  opacity: number;
}

export type PlacementChannel = keyof Placement;
/** A recorded property: a placement value, or an audio track's volume (0..1). */
export type Channel = PlacementChannel | 'volume';

export const PLACEMENT_CHANNELS: PlacementChannel[] = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'pivotX', 'pivotY', 'opacity'];

/** The properties the Timeline palette shows as rows (Details), with their channels. */
export type ChannelGroup = 'transform' | 'position' | 'scale' | 'rotation' | 'pivot' | 'opacity' | 'volume';
export const GROUPS: Record<ChannelGroup, { label: string; channels: Channel[] }> = {
  transform: { label: 'Transform', channels: ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'pivotX', 'pivotY'] },
  position: { label: 'Position', channels: ['x', 'y'] },
  scale: { label: 'Scale ratio', channels: ['scaleX', 'scaleY'] },
  rotation: { label: 'Rotate', channels: ['rotation'] },
  pivot: { label: 'Center of rotation', channels: ['pivotX', 'pivotY'] },
  opacity: { label: 'Opacity', channels: ['opacity'] },
  volume: { label: 'Volume', channels: ['volume'] },
};
/** The parts of Transform (Details: > on the track name). */
export const TRANSFORM_GROUPS: ChannelGroup[] = ['position', 'scale', 'rotation', 'pivot'];

/** Slope handles of a keyframe on one curve (Graph Editor): offsets in frames and value. */
export interface CurveHandles {
  /** Interpolation of this curve from this keyframe on (else the keyframe's). */
  interp?: Interp;
  in?: [number, number];
  out?: [number, number];
  /** Unpair handles: the two sides move separately. */
  broken?: boolean;
}

export interface Keyframe {
  frame: number;
  /** How the values change from this keyframe to the next one recording them. */
  interp: Interp;
  /** What the keyframe records. */
  values: Partial<Record<Channel, number>>;
  /** Graph Editor: slopes per curve. */
  curves?: Partial<Record<Channel, CurveHandles>>;
}

/** A track's keyframes. Off keeps them, but the layer is drawn as it is (reference: they come back when turned on again). */
export interface KeyTrack {
  enabled: boolean;
  frames: Keyframe[];
}

/** The placement that changes nothing (centre of rotation: the middle of the output frame, x/y its corner). */
export const restPlacement = (width: number, height: number, x = 0, y = 0): Placement => ({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, pivotX: x + width / 2, pivotY: y + height / 2, opacity: 1 });

/** Whether a placement leaves the layer as it is. */
export const isRest = (p: Placement): boolean => p.x === 0 && p.y === 0 && p.scaleX === 1 && p.scaleY === 1 && p.rotation === 0 && p.opacity >= 1;

/** Progress 0..1 between two keyframes after the interpolation (without slope handles). */
export function ease(t: number, interp: Interp): number {
  const u = Math.min(1, Math.max(0, t));
  if (interp === 'hold') return 0;
  if (interp === 'linear') return u;
  return u * u * (3 - 2 * u);
}

export const placementOf = (p: Placement): Placement => Object.fromEntries(PLACEMENT_CHANNELS.map((key) => [key, p[key]])) as unknown as Placement;

/** Whether a keyframe records every one of `channels`. */
export const records = (k: Keyframe, channels: readonly Channel[]): boolean => channels.every((c) => k.values[c] !== undefined);
/** Whether a keyframe records any of `channels`. */
export const touches = (k: Keyframe, channels: readonly Channel[]): boolean => channels.some((c) => k.values[c] !== undefined);

// ------------------------------------------------------------------ curves

/** The interpolation of one curve from a keyframe on. */
export const curveInterp = (k: Keyframe, ch: Channel): Interp => k.curves?.[ch]?.interp ?? k.interp;

/** The interpolation a keyframe shows on a property row: its first recorded curve's. */
export function groupInterp(k: Keyframe, channels: readonly Channel[]): Interp {
  const ch = channels.find((c) => k.values[c] !== undefined);
  return ch ? curveInterp(k, ch) : k.interp;
}

/** The slope handles of a stretch: the earlier keyframe's out handle, the later one's in handle. */
export function segmentHandles(a: Keyframe, b: Keyframe, ch: Channel): { out: [number, number]; in: [number, number] } {
  const df = b.frame - a.frame;
  const v0 = a.values[ch]!;
  const v1 = b.values[ch]!;
  // Without handles: a straight line (linear) or flat ends (smooth).
  const auto = curveInterp(a, ch) === 'linear' ? ([[df / 3, (v1 - v0) / 3], [-df / 3, -(v1 - v0) / 3]] as const) : ([[df / 3, 0], [-df / 3, 0]] as const);
  const out = a.curves?.[ch]?.out ?? auto[0];
  const inn = b.curves?.[ch]?.in ?? auto[1];
  // The curve stays a function of time: handles do not reach past the other keyframe.
  return { out: [Math.min(df, Math.max(0, out[0])), out[1]], in: [Math.max(-df, Math.min(0, inn[0])), inn[1]] };
}

/** A point of a cubic Bézier stretch at parameter t. */
function bezier(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/** The value of one stretch at `frame` (a.frame ≤ frame ≤ b.frame). */
export function segmentValue(a: Keyframe, b: Keyframe, ch: Channel, frame: number): number {
  const v0 = a.values[ch]!;
  const v1 = b.values[ch]!;
  const interp = curveInterp(a, ch);
  if (interp === 'hold') return frame >= b.frame ? v1 : v0;
  const custom = a.curves?.[ch]?.out !== undefined || b.curves?.[ch]?.in !== undefined;
  const df = b.frame - a.frame;
  if (!custom) return v0 + (v1 - v0) * ease((frame - a.frame) / df, interp);
  const h = segmentHandles(a, b, ch);
  const x1 = a.frame + h.out[0];
  const x2 = b.frame + h.in[0];
  // The parameter whose time is `frame` (time grows with t, so bisection finds it).
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (bezier(a.frame, x1, x2, b.frame, mid) < frame) lo = mid;
    else hi = mid;
  }
  return bezier(v0, v0 + h.out[1], v1 + h.in[1], v1, (lo + hi) / 2);
}

/** The keyframes that record a channel. */
export const keysOf = (keys: Keyframe[], ch: Channel): Keyframe[] => keys.filter((k) => k.values[ch] !== undefined);

/** A channel's value at `frame`: from the keyframes that record it, or undefined when none does. */
export function channelAt(keys: Keyframe[], ch: Channel, frame: number): number | undefined {
  const list = keysOf(keys, ch);
  if (list.length === 0) return undefined;
  if (frame <= list[0].frame) return list[0].values[ch];
  for (let i = 0; i < list.length - 1; i++) {
    if (frame >= list[i + 1].frame) continue;
    return segmentValue(list[i], list[i + 1], ch, frame);
  }
  return list[list.length - 1].values[ch];
}

/**
 * The placement at `frame`: each property from the keyframes that record it, else as it rests.
 * Null without keyframes.
 */
export function placementAt(keys: Keyframe[], frame: number, rest: Placement): Placement | null {
  if (keys.length === 0) return null;
  const out = { ...rest };
  for (const ch of PLACEMENT_CHANNELS) {
    const v = channelAt(keys, ch, frame);
    if (v !== undefined) out[ch] = v;
  }
  return out;
}

// ------------------------------------------------------------------ editing

/** Records values at a frame: into the keyframe there (its interpolation stays), or a new one. */
export function recordKey(keys: Keyframe[], frame: number, values: Partial<Record<Channel, number>>, interp: Interp): Keyframe[] {
  const at = keys.find((k) => k.frame === frame);
  const key: Keyframe = at ? { ...at, values: { ...at.values, ...values } } : { frame, interp, values: { ...values } };
  return [...keys.filter((k) => k.frame !== frame), key].sort((a, b) => a.frame - b.frame);
}

/** Takes channels out of the keyframe at `frame` (all of them: the keyframe goes). */
export function removeChannels(keys: Keyframe[], frame: number, channels?: readonly Channel[]): Keyframe[] {
  return keys.flatMap((k) => {
    if (k.frame !== frame) return [k];
    if (!channels) return [];
    const values = { ...k.values };
    const curves = k.curves ? { ...k.curves } : undefined;
    for (const c of channels) {
      delete values[c];
      if (curves) delete curves[c];
    }
    return Object.keys(values).length ? [{ ...k, values, ...(curves ? { curves } : {}) }] : [];
  });
}

/**
 * Keyframes moved by `delta` frames (`copy`: the originals stay). With `channels`, only those move
 * (into the keyframe where they land, or a new one); else whole keyframes, replacing those there.
 */
export function moveKeys(keys: Keyframe[], frames: number[], delta: number, copy = false, channels?: readonly Channel[]): Keyframe[] {
  if (!delta) return keys;
  if (!channels) {
    const moving = keys.filter((k) => frames.includes(k.frame));
    const moved = moving.map((k) => ({ ...k, frame: Math.max(1, k.frame + delta) }));
    const targets = new Set(moved.map((k) => k.frame));
    const stay = keys.filter((k) => (copy || !frames.includes(k.frame)) && !targets.has(k.frame));
    return [...stay, ...moved].sort((a, b) => a.frame - b.frame);
  }
  let out = keys;
  const parts = keys.filter((k) => frames.includes(k.frame) && touches(k, channels));
  if (!copy) for (const k of parts) out = removeChannels(out, k.frame, channels);
  for (const k of parts) {
    const values = Object.fromEntries(channels.filter((c) => k.values[c] !== undefined).map((c) => [c, k.values[c]!]));
    out = recordKey(out, Math.max(1, k.frame + delta), values, k.interp);
  }
  return out;
}

/** Sets the interpolation of keyframes (with `channels`: of those curves only). */
export function setInterp(keys: Keyframe[], frames: number[], interp: Interp, channels?: readonly Channel[]): Keyframe[] {
  return keys.map((k) => {
    if (!frames.includes(k.frame)) return k;
    if (!channels) {
      // The whole keyframe: per-curve choices give way.
      const curves = k.curves ? Object.fromEntries(Object.entries(k.curves).map(([c, h]) => [c, { ...h, interp: undefined }])) : undefined;
      return { ...k, interp, ...(curves ? { curves } : {}) };
    }
    const curves = { ...(k.curves ?? {}) };
    for (const c of channels) if (k.values[c] !== undefined) curves[c] = { ...curves[c], interp };
    return { ...k, curves };
  });
}

/** The slope handles a curve shows at a keyframe (Graph Editor): towards the keyframes before and after. */
export function curveHandles(keys: Keyframe[], frame: number, ch: Channel): { in?: [number, number]; out?: [number, number] } {
  const list = keysOf(keys, ch);
  const i = list.findIndex((k) => k.frame === frame);
  if (i < 0) return {};
  const prev = list[i - 1];
  const next = list[i + 1];
  return {
    ...(prev && curveInterp(prev, ch) !== 'hold' ? { in: segmentHandles(prev, list[i], ch).in } : {}),
    ...(next && curveInterp(list[i], ch) !== 'hold' ? { out: segmentHandles(list[i], next, ch).out } : {}),
  };
}

/**
 * Sets a curve's slope handle at a keyframe (Graph Editor); unless unpaired, the other side turns to
 * point the opposite way (keeping its reach; `other` is the handle it shows now).
 */
export function setHandle(keys: Keyframe[], frame: number, ch: Channel, side: 'in' | 'out', d: [number, number], other?: [number, number]): Keyframe[] {
  return keys.map((k) => {
    if (k.frame !== frame || k.values[ch] === undefined) return k;
    const h = { ...(k.curves?.[ch] ?? {}) };
    h[side] = d;
    if (!h.broken) {
      const o = side === 'in' ? 'out' : 'in';
      const cur = h[o] ?? other;
      // Paired: the same slope on the other side, as far along the time axis as before.
      const reach = Math.abs(cur?.[0] ?? d[0]) || Math.abs(d[0]) || 1;
      const slope = d[0] ? d[1] / d[0] : 0;
      const sign = side === 'in' ? 1 : -1;
      h[o] = [sign * reach, sign * reach * slope];
    }
    // A handle bends the stretch: linear becomes smooth (Bézier).
    if ((h.interp ?? k.interp) === 'linear') h.interp = 'smooth';
    return { ...k, curves: { ...(k.curves ?? {}), [ch]: h } };
  });
}

/** Unpair handles (Graph Editor): on, the two sides move separately; off again, the handles reset. */
export function toggleUnpaired(keys: Keyframe[], frame: number, ch: Channel): Keyframe[] {
  return keys.map((k) => {
    if (k.frame !== frame || k.values[ch] === undefined) return k;
    const h = k.curves?.[ch] ?? {};
    const next: CurveHandles = h.broken ? { ...(h.interp ? { interp: h.interp } : {}) } : { ...h, broken: true };
    return { ...k, curves: { ...(k.curves ?? {}), [ch]: next } };
  });
}

/** A point of a curve (Graph Editor): a keyframe's value of one channel. */
export interface CurvePoint {
  frame: number;
  ch: Channel;
}

/**
 * Moves points of curves (Graph Editor) to new frames and values: `to` gives each point's place.
 * The points keep their interpolation and slope handles; points already where they land give way.
 */
export function placeCurvePoints(keys: Keyframe[], points: readonly CurvePoint[], to: (p: CurvePoint, value: number) => { frame: number; value: number }): Keyframe[] {
  const moving = points.flatMap((p) => {
    const k = keys.find((x) => x.frame === p.frame);
    const value = k?.values[p.ch];
    if (!k || value === undefined) return [];
    const target = to(p, value);
    return [{ ch: p.ch, from: p.frame, frame: Math.max(1, Math.round(target.frame)), value: clampChannel(p.ch, target.value), interp: curveInterp(k, p.ch), handles: k.curves?.[p.ch] }];
  });
  let out = keys;
  for (const m of moving) out = removeChannels(out, m.from, [m.ch]);
  for (const m of moving) {
    out = recordKey(out, m.frame, { [m.ch]: m.value }, m.interp);
    out = out.map((x) => {
      if (x.frame !== m.frame) return x;
      // The curve's own interpolation, where it differs from the keyframe's.
      const h: CurveHandles = { ...(m.handles ?? {}) };
      delete h.interp;
      if (m.interp !== x.interp) h.interp = m.interp;
      const curves = { ...(x.curves ?? {}) };
      if (Object.keys(h).length) curves[m.ch] = h;
      else delete curves[m.ch];
      const next: Keyframe = { frame: x.frame, interp: x.interp, values: x.values };
      if (Object.keys(curves).length) next.curves = curves;
      return next;
    });
  }
  return out;
}

/** Moves points of curves by `frames` and by `value(ch)` (Graph Editor drag). */
export const moveCurvePoints = (keys: Keyframe[], points: readonly CurvePoint[], frames: number, value: (ch: Channel) => number): Keyframe[] =>
  placeCurvePoints(keys, points, (p, v) => ({ frame: p.frame + frames, value: v + value(p.ch) }));

/**
 * Stretches points of curves (Graph Editor, Ctrl+Shift drag): in time from the leftmost one by
 * `sx`, in value about 0 by `sy`.
 */
export function scaleCurvePoints(keys: Keyframe[], points: readonly CurvePoint[], sx: number, sy: number): Keyframe[] {
  const left = Math.min(...points.map((p) => p.frame));
  return placeCurvePoints(keys, points, (p, v) => ({ frame: left + (p.frame - left) * sx, value: v * sy }));
}

/** Adds a point to one curve at a frame, on the curve as it runs there (Graph Editor: Alt+click). */
export function addCurvePoint(keys: Keyframe[], ch: Channel, frame: number, interp: Interp): Keyframe[] {
  const v = channelAt(keys, ch, frame);
  return v === undefined ? keys : recordKey(keys, frame, { [ch]: v }, interp);
}

// ------------------------------------------------------------------ placement maths

/** Document → placed: moves the layer about its centre of rotation (scale, then rotate, then move). */
export function placementMatrix(p: Placement): Affine {
  const a = (p.rotation * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const m: Affine = [cos * p.scaleX, sin * p.scaleX, -sin * p.scaleY, cos * p.scaleY, 0, 0];
  // e, f so that the centre of rotation lands on itself plus the movement.
  m[4] = p.pivotX + p.x - (m[0] * p.pivotX + m[2] * p.pivotY);
  m[5] = p.pivotY + p.y - (m[1] * p.pivotX + m[3] * p.pivotY);
  return m;
}

export function invert(m: Affine): Affine {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-12;
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

export const applyAffine = (m: Affine, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

/** a ∘ b: b first, then a. */
export const compose = (a: Affine, b: Affine): Affine => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];

/**
 * 2D camera: the camera frame is the output frame placed by the keyframes; with the camera applied,
 * what lies in the camera frame fills the output, so its layers are drawn with the inverse placement.
 */
export const cameraMatrix = (p: Placement): Affine => invert(placementMatrix(p));

/** The four corners of a rectangle placed (top left, top right, bottom right, bottom left). */
export function placedCorners(p: Placement, width: number, height: number, x = 0, y = 0): { x: number; y: number }[] {
  const m = placementMatrix(p);
  return [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
  ].map(([px, py]) => applyAffine(m, px, py));
}

/** The same placement with another centre of rotation (the layer stays where it is). */
export function movePivot(p: Placement, pivotX: number, pivotY: number): Placement {
  const m = placementMatrix(p);
  // The new movement keeps the matrix: o' = o + (A − I)(P' − P).
  const dx = pivotX - p.pivotX;
  const dy = pivotY - p.pivotY;
  return { ...p, pivotX, pivotY, x: p.x + (m[0] - 1) * dx + m[2] * dy, y: p.y + m[1] * dx + (m[3] - 1) * dy };
}

/** The settings a channel belongs to (Position, Scale ratio, Rotate, Center of rotation, Opacity). */
const SETTINGS: PlacementChannel[][] = [['x', 'y'], ['scaleX', 'scaleY'], ['rotation'], ['pivotX', 'pivotY'], ['opacity']];

/** Channels with the rest of their settings (recording X records the position). */
export function withSettings(channels: readonly PlacementChannel[]): PlacementChannel[] {
  return SETTINGS.filter((set) => set.some((c) => channels.includes(c))).flat();
}

/** The settings whose values differ between two placements (what an edit records). */
export function changedChannels(a: Placement, b: Placement): PlacementChannel[] {
  return withSettings(PLACEMENT_CHANNELS.filter((c) => Math.abs(a[c] - b[c]) > 1e-9));
}

// ------------------------------------------------------------------ files

const CHANNELS: Channel[] = [...PLACEMENT_CHANNELS, 'volume'];
const LIMITS: Record<Channel, [number, number]> = {
  x: [-1e6, 1e6],
  y: [-1e6, 1e6],
  scaleX: [-100, 100],
  scaleY: [-100, 100],
  rotation: [-36000, 36000],
  pivotX: [-1e6, 1e6],
  pivotY: [-1e6, 1e6],
  opacity: [0, 1],
  volume: [0, 1],
};
const interpOfRaw = (v: unknown): Interp => (v === 'hold' || v === 'smooth' ? v : 'linear');
const pair = (v: unknown): [number, number] | undefined =>
  Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? [Math.max(-1e6, Math.min(1e6, v[0])), Math.max(-1e6, Math.min(1e6, v[1]))] : undefined;

/** A channel's value within its limits (opacity and volume 0..1; a scale of 0 would make the layer vanish for good). */
export function clampChannel(c: Channel, v: number): number {
  const [lo, hi] = LIMITS[c];
  const x = Math.min(hi, Math.max(lo, v));
  return (c === 'scaleX' || c === 'scaleY') && Math.abs(x) < 0.001 ? 0.001 * (Math.sign(x) || 1) : x;
}

/** A keyframe from a file: this format, or the earlier one with the values beside the frame (every value, or an audio track's volume). */
export function sanitizeKeyframe(raw: unknown): Keyframe | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const frame = typeof r.frame === 'number' && Number.isFinite(r.frame) ? Math.round(r.frame) : NaN;
  if (!(frame >= 1 && frame <= 100000)) return null;
  const source = r.values && typeof r.values === 'object' ? (r.values as Record<string, unknown>) : r;
  const values: Partial<Record<Channel, number>> = {};
  for (const c of CHANNELS) {
    const v = source[c];
    if (typeof v === 'number' && Number.isFinite(v)) values[c] = clampChannel(c, v);
  }
  if (Object.keys(values).length === 0) return null;
  const curves: Partial<Record<Channel, CurveHandles>> = {};
  if (r.curves && typeof r.curves === 'object') {
    for (const c of CHANNELS) {
      const h = (r.curves as Record<string, unknown>)[c];
      if (!h || typeof h !== 'object' || values[c] === undefined) continue;
      const x = h as Record<string, unknown>;
      const handles: CurveHandles = {};
      if (x.interp === 'hold' || x.interp === 'linear' || x.interp === 'smooth') handles.interp = x.interp;
      const i = pair(x.in);
      const o = pair(x.out);
      if (i) handles.in = i;
      if (o) handles.out = o;
      if (x.broken === true) handles.broken = true;
      if (Object.keys(handles).length) curves[c] = handles;
    }
  }
  return { frame, interp: interpOfRaw(r.interp), values, ...(Object.keys(curves).length ? { curves } : {}) };
}

export function sanitizeKeyframes(raw: unknown): Keyframe[] {
  const list = Array.isArray(raw) ? raw.slice(0, 10000).map(sanitizeKeyframe).filter((k): k is Keyframe => k !== null) : [];
  return [...new Map(list.map((k) => [k.frame, k])).values()].sort((a, b) => a.frame - b.frame);
}

export function sanitizeKeyTrack(raw: unknown): KeyTrack | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  return { enabled: r.enabled !== false, frames: sanitizeKeyframes(r.frames) };
}
