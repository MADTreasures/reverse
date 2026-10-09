/**
 * Animation: the document's timeline (frame rate, number of frames) and, for each animation folder,
 * a track that assigns the folder's cels (its layers and layer folders) to frames. A cel shows from
 * the frame it is assigned to until the next assignment; an empty assignment shows nothing.
 * Onion skin settings and the reference's naming rules for cels and animation folders. Pure, unit
 * tested.
 */
import type { Id } from '../model/types';

export interface Timeline {
  /** Animation > Timeline > Enable timeline. Off: every cel shows, like in a normal folder. */
  enabled: boolean;
  /** Frames per second. */
  fps: number;
  /** Number of frames (1 … frames). */
  frames: number;
  /** Name in the timeline list (several timelines: Animation > Timeline > Manage timeline). */
  name?: string;
  /** Start and end frame: playback and exports cover start … end (default: every frame). */
  start?: number;
  end?: number;
}

/** The start frame (1 when not set). */
export const startOf = (t: Timeline): number => Math.max(1, Math.min(t.frames, t.start ?? 1));
/** The end frame (the last frame when not set). */
export const endOf = (t: Timeline): number => Math.max(startOf(t), Math.min(t.frames, t.end ?? t.frames));

/** A cel shown from `frame` on (null: nothing from here on). */
export interface CelAssignment {
  frame: number;
  cel: Id | null;
}

/** An animation folder's track: assignments sorted by frame, at most one per frame. */
export interface AnimationTrack {
  cels: CelAssignment[];
}

export const MAX_FRAMES = 1000;
export const MAX_FPS = 120;

/** Own defaults for Create animated illustration (the reference does not document its own). */
export const DEFAULT_TIMELINE: Timeline = { enabled: true, fps: 8, frames: 8 };

export const emptyTrack = (): AnimationTrack => ({ cels: [] });

/** The assignment in effect at `frame` (the last one at or before it), or null. */
export function assignmentAt(track: AnimationTrack, frame: number): CelAssignment | null {
  let found: CelAssignment | null = null;
  for (const a of track.cels) {
    if (a.frame > frame) break;
    found = a;
  }
  return found;
}

/** The cel shown at `frame`, or null (nothing assigned yet, or an empty assignment). */
export const celAt = (track: AnimationTrack, frame: number): Id | null => assignmentAt(track, frame)?.cel ?? null;

/** The assignment that starts exactly at `frame`. */
export const entryAt = (track: AnimationTrack, frame: number): CelAssignment | undefined => track.cels.find((a) => a.frame === frame);

/** Assigns a cel (or nothing) from `frame` on, replacing an assignment at that frame. */
export function assignAt(track: AnimationTrack, frame: number, cel: Id | null): AnimationTrack {
  const cels = track.cels.filter((a) => a.frame !== frame);
  cels.push({ frame, cel });
  cels.sort((a, b) => a.frame - b.frame);
  return { cels };
}

/** Removes the assignment at `frame`; the cel before it then shows on (like Delete on an assigned cel). */
export const removeAt = (track: AnimationTrack, frame: number): AnimationTrack => ({ cels: track.cels.filter((a) => a.frame !== frame) });

/** Frames a cel is assigned to. */
export const framesOf = (track: AnimationTrack, cel: Id): number[] => track.cels.filter((a) => a.cel === cel).map((a) => a.frame);

/** Animation > Timeline > Insert frame: assignments from `at` on move back by `count`. */
export function insertFrames(track: AnimationTrack, at: number, count: number): AnimationTrack {
  return { cels: track.cels.map((a) => (a.frame >= at ? { ...a, frame: a.frame + count } : a)) };
}

/**
 * Animation > Timeline > Delete frame: assignments inside the deleted frames go, later ones move
 * forward. The cel that showed right after the deleted frames still shows there.
 */
export function deleteFrames(track: AnimationTrack, at: number, count: number): AnimationTrack {
  const end = at + count;
  const after = assignmentAt(track, end);
  let cels = track.cels.filter((a) => a.frame < at || a.frame >= end).map((a) => (a.frame >= end ? { ...a, frame: a.frame - count } : a));
  if (after && after.frame < end && !cels.some((a) => a.frame === at)) {
    const shown = assignmentAt({ cels }, at);
    if ((shown?.cel ?? null) !== after.cel) cels = [...cels, { frame: at, cel: after.cel }].sort((a, b) => a.frame - b.frame);
  }
  return { cels };
}

/** Keeps only assignments of existing cels (a deleted or moved cel leaves the timeline). */
export function pruneTrack(track: AnimationTrack, cels: Set<Id>): AnimationTrack {
  return track.cels.every((a) => a.cel === null || cels.has(a.cel)) ? track : { cels: track.cels.filter((a) => a.cel === null || cels.has(a.cel)) };
}

/** A copied track for copied cels (ids old → new). */
export const remapTrack = (track: AnimationTrack, ids: Map<Id, Id>): AnimationTrack => ({ cels: track.cels.map((a) => ({ ...a, cel: a.cel === null ? null : (ids.get(a.cel) ?? a.cel) })) });

/**
 * Onion skin: the cels before and after the one shown at `frame`, in timeline order (each cel
 * once, without the current one), nearest first.
 */
export function onionCels(track: AnimationTrack, frame: number, before: number, after: number): { prev: Id[]; next: Id[] } {
  const current = celAt(track, frame);
  const i = track.cels.findLastIndex((a) => a.frame <= frame);
  const collect = (list: CelAssignment[], n: number) => {
    const out: Id[] = [];
    for (const a of list) {
      if (out.length >= n) break;
      if (a.cel !== null && a.cel !== current && !out.includes(a.cel)) out.push(a.cel);
    }
    return out;
  };
  return { prev: collect(track.cels.slice(0, Math.max(0, i)).reverse(), before), next: collect(track.cels.slice(i + 1), after) };
}

// ------------------------------------------------------------------ names

/** Cels are numbered: the one after 1 is 2. With a letter name, the next one is the next letter. */
export function nextCelName(names: string[]): string {
  const numbers = names.map((n) => (/^\d+$/.test(n) ? Number(n) : 0));
  const top = Math.max(0, ...numbers);
  if (top > 0 || !names.some((n) => /^[A-Z]$/.test(n))) return String(top + 1);
  return nextLetter(names);
}

/** Animation folders get letters: after A comes B. */
export function nextTrackName(names: string[]): string {
  return nextLetter(names);
}

function nextLetter(names: string[]): string {
  const letters = names.filter((n) => /^[A-Z]$/.test(n)).map((n) => n.charCodeAt(0));
  const next = letters.length ? Math.max(...letters) + 1 : 65;
  return next <= 90 ? String.fromCharCode(next) : `Animation ${names.length + 1}`;
}

// ------------------------------------------------------------------ onion skin

export type OnionMode = 'color' | 'half' | 'mono';

export interface OnionSkin {
  /** Number of cels shown before and after the current one. */
  before: number;
  after: number;
  /** Color: as drawn; Half color: mixed with the display colour; Monochrome: in the display colour. */
  mode: OnionMode;
  prevColor: string;
  nextColor: string;
  /** Opacity of the nearest skin and how much less each further one gets (0..1). */
  opacity: number;
  step: number;
}

/** Own defaults (the reference documents the settings, not their factory values). */
export const DEFAULT_ONION: OnionSkin = { before: 1, after: 1, mode: 'half', prevColor: '#2f6bff', nextColor: '#20a050', opacity: 0.5, step: 0.15 };

/** Opacity of the n-th skin (0: nearest). */
export const onionOpacity = (o: OnionSkin, n: number): number => Math.max(0.05, Math.min(1, o.opacity - o.step * n));

/**
 * Recolours a skin's pixels in place (straight RGBA): Half color mixes them with the display colour,
 * Monochrome replaces their colour (darker = more of it), Color leaves them.
 */
export function tintOnion(data: Uint8ClampedArray, mode: OnionMode, rgb: { r: number; g: number; b: number }): void {
  if (mode === 'color') return;
  for (let p = 0; p < data.length; p += 4) {
    if (data[p + 3] === 0) continue;
    if (mode === 'half') {
      data[p] = (data[p] + rgb.r) >> 1;
      data[p + 1] = (data[p + 1] + rgb.g) >> 1;
      data[p + 2] = (data[p + 2] + rgb.b) >> 1;
    } else {
      // Monochrome: light parts fade out, dark lines take the display colour.
      const grey = (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) / 255;
      data[p] = rgb.r;
      data[p + 1] = rgb.g;
      data[p + 2] = rgb.b;
      data[p + 3] = Math.round(data[p + 3] * (1 - grey));
    }
  }
}

// ------------------------------------------------------------------ files

const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
const hex = (v: unknown, fallback: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback);

export function sanitizeTimeline(raw: unknown): Timeline | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const frames = Math.round(num(r.frames, DEFAULT_TIMELINE.frames, 1, MAX_FRAMES));
  const start = typeof r.start === 'number' && Number.isFinite(r.start) ? Math.round(num(r.start, 1, 1, frames)) : undefined;
  const end = typeof r.end === 'number' && Number.isFinite(r.end) ? Math.round(num(r.end, frames, start ?? 1, frames)) : undefined;
  return {
    enabled: r.enabled !== false,
    fps: Math.round(num(r.fps, DEFAULT_TIMELINE.fps, 1, MAX_FPS)),
    frames,
    ...(typeof r.name === 'string' && r.name ? { name: r.name.slice(0, 60) } : {}),
    ...(start !== undefined && start > 1 ? { start } : {}),
    ...(end !== undefined && end < frames ? { end } : {}),
  };
}

/** A track from a file; cel ids are checked against the folder's layers by the caller. */
export function sanitizeTrack(raw: unknown): AnimationTrack | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const list = (raw as Record<string, unknown>).cels;
  const cels = new Map<number, Id | null>();
  if (Array.isArray(list)) {
    for (const a of list.slice(0, MAX_FRAMES * 2)) {
      if (!a || typeof a !== 'object') continue;
      const r = a as Record<string, unknown>;
      const frame = Math.round(num(r.frame, 0, 0, MAX_FRAMES * 10));
      if (frame < 1) continue;
      cels.set(frame, typeof r.cel === 'string' ? r.cel.slice(0, 64) : null);
    }
  }
  return { cels: [...cels].sort((a, b) => a[0] - b[0]).map(([frame, cel]) => ({ frame, cel })) };
}

export function sanitizeOnion(raw: unknown): OnionSkin {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_ONION;
  return {
    before: Math.round(num(r.before, d.before, 0, 10)),
    after: Math.round(num(r.after, d.after, 0, 10)),
    mode: r.mode === 'color' || r.mode === 'mono' ? r.mode : 'half',
    prevColor: hex(r.prevColor, d.prevColor),
    nextColor: hex(r.nextColor, d.nextColor),
    opacity: num(r.opacity, d.opacity, 0.05, 1),
    step: num(r.step, d.step, 0, 1),
  };
}
