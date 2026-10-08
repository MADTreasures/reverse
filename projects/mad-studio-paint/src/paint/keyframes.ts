/**
 * Keyframes: a track's placement over time. A keyframe records the position, scale, rotation,
 * centre of rotation and opacity at a frame; between two keyframes the values change as the first
 * one's interpolation says (hold: jump at the next keyframe, linear: at a steady pace, smooth: speed
 * up and slow down). Layers with "Enable keyframes on this layer" are drawn placed so; a 2D camera
 * folder's keyframes place its camera frame, through which its layers are seen. Pure, unit tested.
 */
import type { Affine } from './rulers';

export type Interp = 'hold' | 'linear' | 'smooth';

export const INTERPS: Interp[] = ['hold', 'linear', 'smooth'];

/** What a keyframe records. */
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

export interface Keyframe extends Placement {
  frame: number;
  /** How the values change from this keyframe to the next one. */
  interp: Interp;
}

/** A track's keyframes. Off keeps them, but the layer is drawn as it is (reference: they come back when turned on again). */
export interface KeyTrack {
  enabled: boolean;
  frames: Keyframe[];
}

/** The placement that changes nothing (centre of rotation: the middle of the canvas). */
export const restPlacement = (width: number, height: number): Placement => ({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, pivotX: width / 2, pivotY: height / 2, opacity: 1 });

/** Whether a placement leaves the layer as it is. */
export const isRest = (p: Placement): boolean => p.x === 0 && p.y === 0 && p.scaleX === 1 && p.scaleY === 1 && p.rotation === 0 && p.opacity >= 1;

/** Progress 0..1 between two keyframes after the interpolation. */
export function ease(t: number, interp: Interp): number {
  const u = Math.min(1, Math.max(0, t));
  if (interp === 'hold') return 0;
  if (interp === 'linear') return u;
  return u * u * (3 - 2 * u);
}

const KEYS: (keyof Placement)[] = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'pivotX', 'pivotY', 'opacity'];

export const placementOf = (k: Placement): Placement => Object.fromEntries(KEYS.map((key) => [key, k[key]])) as unknown as Placement;

/**
 * The placement at `frame`: before the first keyframe its values, after the last one its values,
 * in between as the earlier keyframe's interpolation says. Null without keyframes.
 */
export function placementAt(keys: Keyframe[], frame: number): Placement | null {
  if (keys.length === 0) return null;
  if (frame <= keys[0].frame) return placementOf(keys[0]);
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (frame >= b.frame) continue;
    const t = ease((frame - a.frame) / (b.frame - a.frame), a.interp);
    return Object.fromEntries(KEYS.map((key) => [key, a[key] + (b[key] - a[key]) * t])) as unknown as Placement;
  }
  return placementOf(keys[keys.length - 1]);
}

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

/**
 * 2D camera: the camera frame is the output frame (the canvas) placed by the keyframes; with the
 * camera applied, what lies in the camera frame fills the output, so its layers are drawn with the
 * inverse placement.
 */
export const cameraMatrix = (p: Placement): Affine => invert(placementMatrix(p));

/** The four corners of the canvas placed (top left, top right, bottom right, bottom left). */
export function placedCorners(p: Placement, width: number, height: number): { x: number; y: number }[] {
  const m = placementMatrix(p);
  return [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ].map(([x, y]) => applyAffine(m, x, y));
}

/** The same placement with another centre of rotation (the layer stays where it is). */
export function movePivot(p: Placement, pivotX: number, pivotY: number): Placement {
  const m = placementMatrix(p);
  // The new movement keeps the matrix: o' = o + (A − I)(P' − P).
  const dx = pivotX - p.pivotX;
  const dy = pivotY - p.pivotY;
  return { ...p, pivotX, pivotY, x: p.x + (m[0] - 1) * dx + m[2] * dy, y: p.y + m[1] * dx + (m[3] - 1) * dy };
}

/** Sets a keyframe at its frame (replacing one there), sorted. */
export function setKey(keys: Keyframe[], key: Keyframe): Keyframe[] {
  return [...keys.filter((k) => k.frame !== key.frame), key].sort((a, b) => a.frame - b.frame);
}

/** Keyframes moved by `delta` frames (`copy`: the originals stay), replacing those at the target frames. */
export function moveKeys(keys: Keyframe[], frames: number[], delta: number, copy = false): Keyframe[] {
  const moving = keys.filter((k) => frames.includes(k.frame));
  const moved = moving.map((k) => ({ ...k, frame: Math.max(1, k.frame + delta) }));
  const targets = new Set(moved.map((k) => k.frame));
  const stay = keys.filter((k) => (copy || !frames.includes(k.frame)) && !targets.has(k.frame));
  return [...stay, ...moved].sort((a, b) => a.frame - b.frame);
}

// ------------------------------------------------------------------ files

const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);

export function sanitizeKeyframe(raw: unknown): Keyframe | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const frame = typeof r.frame === 'number' && Number.isFinite(r.frame) ? Math.round(r.frame) : NaN;
  if (!(frame >= 1 && frame <= 100000)) return null;
  const scale = (v: unknown) => {
    const s = num(v, 1, -100, 100);
    return Math.abs(s) < 0.001 ? 0.001 * (Math.sign(s) || 1) : s;
  };
  return {
    frame,
    interp: r.interp === 'hold' || r.interp === 'smooth' ? r.interp : 'linear',
    x: num(r.x, 0, -1e6, 1e6),
    y: num(r.y, 0, -1e6, 1e6),
    scaleX: scale(r.scaleX),
    scaleY: scale(r.scaleY),
    rotation: num(r.rotation, 0, -36000, 36000),
    pivotX: num(r.pivotX, 0, -1e6, 1e6),
    pivotY: num(r.pivotY, 0, -1e6, 1e6),
    opacity: num(r.opacity, 1, 0, 1),
  };
}

export function sanitizeKeyTrack(raw: unknown): KeyTrack | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const list = Array.isArray(r.frames) ? r.frames.slice(0, 10000).map(sanitizeKeyframe).filter((k): k is Keyframe => k !== null) : [];
  const byFrame = new Map(list.map((k) => [k.frame, k]));
  return { enabled: r.enabled !== false, frames: [...byFrame.values()].sort((a, b) => a.frame - b.frame) };
}
