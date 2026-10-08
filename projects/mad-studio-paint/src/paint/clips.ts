/**
 * Clips: the stretches of a track where its layer shows (the reference's unit for editing
 * animations). A track without clips of its own shows over the whole timeline. The operations move,
 * trim, stretch, split, merge, delete and copy clips together with what lies in them: cel
 * assignments (animation folders), keyframes and the position in the sound (audio tracks). What lies
 * outside every clip is dropped. Pure, unit tested.
 */
import { assignmentAt, deleteFrames, MAX_FRAMES, type CelAssignment } from './animation';

export interface Clip {
  /** First and last frame shown (inclusive). */
  start: number;
  end: number;
  /** Audio tracks: seconds into the sound at the clip's first frame (negative: silence first). */
  offset?: number;
}

/** Anything placed on a frame of a track (keyframes). */
export interface Timed {
  frame: number;
}

/** What a track holds: its clips and, by frame, cel assignments and keyframes. */
export interface TrackContent<K extends Timed = Timed> {
  clips: Clip[];
  cels?: CelAssignment[];
  keys?: K[];
}

/** A copied clip: its length and contents, frames counted from its start (0). */
export interface ClipCopy<K extends Timed = Timed> {
  length: number;
  offset?: number;
  cels?: CelAssignment[];
  keys?: K[];
}

const byFrame = (a: Timed, b: Timed) => a.frame - b.frame;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The clips of a track: none set means one clip over the whole timeline. */
export const clipsOf = (clips: Clip[] | undefined, frames: number): Clip[] => clips ?? [{ start: 1, end: Math.max(1, frames) }];

/** Index of the clip that shows `frame`, or -1. */
export const clipIndexAt = (clips: Clip[], frame: number): number => clips.findIndex((c) => c.start <= frame && frame <= c.end);

/** Whether a track shows at `frame` (without clips of its own: always). */
export const inClips = (clips: Clip[] | undefined, frame: number): boolean => !clips || clipIndexAt(clips, frame) >= 0;

/** Seconds into the sound at `frame`, or null where no clip plays. */
export function soundTimeAt(clips: Clip[], frame: number, fps: number): number | null {
  const c = clips[clipIndexAt(clips, frame)];
  return c ? (c.offset ?? 0) + (frame - c.start) / fps : null;
}

// ------------------------------------------------------------------ helpers

/** Each clip starts with an assignment of the cel it shows there, so that it keeps it when moved. */
function pinStarts<K extends Timed>(t: TrackContent<K>): TrackContent<K> {
  if (!t.cels) return t;
  let cels = t.cels;
  for (const c of t.clips) {
    if (cels.some((a) => a.frame === c.start)) continue;
    const shown = assignmentAt({ cels }, c.start)?.cel ?? null;
    if (shown !== null) cels = [...cels, { frame: c.start, cel: shown }].sort(byFrame);
  }
  return cels === t.cels ? t : { ...t, cels };
}

/** One entry per frame (the last one wins), sorted. */
function unique<T extends Timed>(list: T[]): T[] {
  const at = new Map<number, T>();
  for (const x of list) at.set(x.frame, x);
  return [...at.values()].sort(byFrame);
}

/**
 * Sorted clips inside 1 … MAX_FRAMES that do not overlap; cel assignments and keys outside every
 * clip are dropped.
 */
export function tidy<K extends Timed>(t: TrackContent<K>): TrackContent<K> {
  const clips: Clip[] = [];
  for (const c of [...t.clips].sort((a, b) => a.start - b.start)) {
    const start = Math.max(1, Math.round(c.start), (clips[clips.length - 1]?.end ?? 0) + 1);
    const end = Math.min(MAX_FRAMES, Math.round(c.end));
    if (end < start) continue;
    clips.push({ ...c, start, end });
  }
  const inside = (f: number) => clipIndexAt(clips, f) >= 0;
  const out: TrackContent<K> = { clips };
  if (t.cels) out.cels = unique(t.cels).filter((a) => inside(a.frame));
  if (t.keys) out.keys = unique(t.keys).filter((k) => inside(k.frame));
  return out;
}

/** Moves entries inside [from, to] by `delta`; entries already at the target frames go. */
function shiftRange<T extends Timed>(list: T[], ranges: Clip[], delta: number): T[] {
  const from = (f: number) => ranges.some((c) => c.start <= f && f <= c.end);
  const to = (f: number) => ranges.some((c) => c.start + delta <= f && f <= c.end + delta);
  const moved = list.filter((x) => from(x.frame)).map((x) => ({ ...x, frame: x.frame + delta }));
  return [...list.filter((x) => !from(x.frame) && !to(x.frame)), ...moved].sort(byFrame);
}

// ------------------------------------------------------------------ move

/** Whether the clips at `indices` can move by `delta` (inside the timeline, onto no other clip). */
export function canMoveClips(clips: Clip[], indices: number[], delta: number): boolean {
  const moving = new Set(indices);
  return clips.every((c, i) => {
    if (!moving.has(i)) return true;
    const start = c.start + delta;
    const end = c.end + delta;
    if (start < 1 || end > MAX_FRAMES) return false;
    return clips.every((o, j) => moving.has(j) || o.end < start || o.start > end);
  });
}

/** The move nearest to `delta` that every track allows (0 when none does). */
export function nearestMove(tracks: { clips: Clip[]; indices: number[] }[], delta: number): number {
  const ok = (d: number) => tracks.every((t) => canMoveClips(t.clips, t.indices, d));
  for (let k = 0; k <= MAX_FRAMES; k++) {
    for (const d of k === 0 ? [delta] : [delta - k, delta + k]) {
      // Not past the request's direction: a move to the right never ends up left of where it started.
      if (Math.sign(d) !== Math.sign(delta) && d !== 0) continue;
      if (ok(d)) return d;
    }
  }
  return 0;
}

/** Moves the clips at `indices` with their cels and keys by `delta` frames (if they fit there). */
export function moveClips<K extends Timed>(t: TrackContent<K>, indices: number[], delta: number): TrackContent<K> {
  if (!delta || indices.length === 0 || !canMoveClips(t.clips, indices, delta)) return t;
  const p = pinStarts(t);
  const moving = indices.map((i) => p.clips[i]).filter(Boolean);
  const clips = p.clips.map((c, i) => (indices.includes(i) ? { ...c, start: c.start + delta, end: c.end + delta } : c));
  return tidy({
    clips,
    ...(p.cels ? { cels: shiftRange(p.cels, moving, delta) } : {}),
    ...(p.keys ? { keys: shiftRange(p.keys, moving, delta) } : {}),
  });
}

// ------------------------------------------------------------------ trim and stretch

export type ClipEdge = 'start' | 'end';

/** How far an edge of clip `i` can go: not past its other edge, a neighbouring clip or the timeline. */
export function edgeRange(clips: Clip[], i: number, edge: ClipEdge): [number, number] {
  const c = clips[i];
  return edge === 'start' ? [(clips[i - 1]?.end ?? 0) + 1, c.end] : [c.start, (clips[i + 1]?.start ?? MAX_FRAMES + 1) - 1];
}

/**
 * Trim: drags an edge of clip `i` to `frame`. The cels assigned inside stay where they are, those
 * left outside go; the cel shown at a later start keeps showing there, and an earlier start shows
 * the clip's first cel from there. Audio clips start further into (or before) their sound.
 */
export function trimClip<K extends Timed>(t: TrackContent<K>, i: number, edge: ClipEdge, frame: number, fps = 24): TrackContent<K> {
  const c = t.clips[i];
  if (!c) return t;
  const [lo, hi] = edgeRange(t.clips, i, edge);
  const to = clamp(Math.round(frame), lo, hi);
  if (to === (edge === 'start' ? c.start : c.end)) return t;
  const p = pinStarts(t);
  const clips = [...p.clips];
  if (edge === 'end') {
    clips[i] = { ...c, end: to };
    return tidy({ ...p, clips });
  }
  let cels = p.cels;
  if (cels && to > c.start) {
    const shown = assignmentAt({ cels }, to)?.cel ?? null;
    cels = cels.filter((a) => a.frame < c.start || a.frame >= to);
    if (shown !== null && !cels.some((a) => a.frame === to)) cels = [...cels, { frame: to, cel: shown }].sort(byFrame);
  } else if (cels) {
    cels = cels.filter((a) => a.frame < to || a.frame >= c.start).map((a) => (a.frame === c.start ? { ...a, frame: to } : a));
  }
  clips[i] = { ...c, start: to, ...(c.offset !== undefined ? { offset: c.offset + (to - c.start) / fps } : {}) };
  return tidy({ ...p, clips, ...(cels ? { cels } : {}) });
}

/**
 * Time stretch (Alt + drag an edge): the clip gets longer or shorter and the cels and keys inside
 * spread out or close up with it. Audio is not stretched: for audio clips this trims.
 */
export function stretchClip<K extends Timed>(t: TrackContent<K>, i: number, edge: ClipEdge, frame: number, fps = 24): TrackContent<K> {
  const c = t.clips[i];
  if (!c) return t;
  if (c.offset !== undefined) return trimClip(t, i, edge, frame, fps);
  const [lo, hi] = edgeRange(t.clips, i, edge);
  const to = clamp(Math.round(frame), lo, hi);
  const start = edge === 'start' ? to : c.start;
  const end = edge === 'end' ? to : c.end;
  if (start === c.start && end === c.end) return t;
  const p = pinStarts(t);
  const len = c.end - c.start + 1;
  const newLen = end - start + 1;
  const inside = (f: number) => c.start <= f && f <= c.end;
  const map = <T extends Timed>(list: T[]): T[] => {
    const out = new Map<number, T>();
    for (const x of list) {
      if (!inside(x.frame)) continue;
      const f = start + Math.floor(((x.frame - c.start) * newLen) / len);
      // Several on one frame: the first one stays.
      if (!out.has(f)) out.set(f, { ...x, frame: f });
    }
    return [...list.filter((x) => !inside(x.frame) && (x.frame < start || x.frame > end)), ...out.values()].sort(byFrame);
  };
  const clips = p.clips.map((x, j) => (j === i ? { ...x, start, end } : x));
  return tidy({ clips, ...(p.cels ? { cels: map(p.cels) } : {}), ...(p.keys ? { keys: map(p.keys) } : {}) });
}

// ------------------------------------------------------------------ edit track commands

/**
 * Makes sure a clip shows `frame` (assigning a cel or pasting a key there): a new clip from there
 * up to the next clip or the end of the timeline (`whole`: over the whole gap).
 */
export function ensureClipAt<K extends Timed>(t: TrackContent<K>, frame: number, frames: number, whole = false): TrackContent<K> {
  if (clipIndexAt(t.clips, frame) >= 0) return t;
  const prev = t.clips.findLast((c) => c.end < frame);
  const next = t.clips.find((c) => c.start > frame);
  const start = whole ? (prev?.end ?? 0) + 1 : frame;
  const end = next ? next.start - 1 : Math.min(MAX_FRAMES, Math.max(frames, frame));
  return { ...t, clips: [...t.clips, { start, end }].sort((a, b) => a.start - b.start) };
}

/**
 * Animation > Edit track > Set as first displayed frame, on a frame without a clip: after a clip, a
 * new clip from there (up to the next clip or the end of the timeline) showing the last cel of the
 * clip before; before the first clip, that clip starts there. Null when it does not apply (no
 * clips, or the frame is in one).
 */
export function setFirstDisplayed<K extends Timed>(t: TrackContent<K>, frame: number, frames: number, fps = 24): TrackContent<K> | null {
  if (t.clips.length === 0 || clipIndexAt(t.clips, frame) >= 0 || frame < 1) return null;
  const prev = t.clips.findLast((c) => c.end < frame);
  if (!prev) return trimClip(t, 0, 'start', frame, fps);
  const p = pinStarts(t);
  const next = p.clips.find((c) => c.start > frame);
  const end = next ? next.start - 1 : Math.min(MAX_FRAMES, Math.max(frames, frame));
  const last = p.cels ? (assignmentAt({ cels: p.cels }, prev.end)?.cel ?? null) : null;
  const clip: Clip = { start: frame, end, ...(prev.offset !== undefined ? { offset: prev.offset + (frame - prev.start) / fps } : {}) };
  return tidy({
    ...p,
    clips: [...p.clips, clip],
    ...(p.cels ? { cels: last !== null ? [...p.cels, { frame, cel: last }].sort(byFrame) : p.cels } : {}),
  });
}

/**
 * Animation > Edit track > Set as last displayed frame: the clip ends one frame before `frame`.
 * Inside a clip, the stretch from there up to the next assigned cel goes (an animation folder's
 * clip goes on from that cel); after a clip, the clip before reaches up to there. Null when it does
 * not apply.
 */
export function setLastDisplayed<K extends Timed>(t: TrackContent<K>, frame: number): TrackContent<K> | null {
  if (t.clips.length === 0) return null;
  const i = clipIndexAt(t.clips, frame);
  if (i < 0) {
    const prev = t.clips.findLastIndex((c) => c.end < frame);
    return prev < 0 ? null : trimClip(t, prev, 'end', frame - 1);
  }
  const p = pinStarts(t);
  const c = p.clips[i];
  const nextCel = p.cels?.find((a) => a.frame > frame && a.frame <= c.end)?.frame;
  const pieces: Clip[] = [];
  if (frame > c.start) pieces.push({ ...c, end: frame - 1 });
  if (nextCel !== undefined) pieces.push({ start: nextCel, end: c.end });
  const clips = [...p.clips.slice(0, i), ...pieces, ...p.clips.slice(i + 1)];
  return tidy({ ...p, clips });
}

/** Animation > Edit track > Delete (clips): the clips and what lies in them go. */
export function deleteClips<K extends Timed>(t: TrackContent<K>, indices: number[]): TrackContent<K> {
  if (!indices.some((i) => t.clips[i])) return t;
  return tidy({ ...t, clips: t.clips.filter((_, i) => !indices.includes(i)) });
}

/**
 * Animation > Edit track > Merge clips: the clips from the first to the last selected one become one
 * (one selected: it merges with the next). The frames between them show the last cel of the clip
 * before. Null when there is nothing to merge.
 */
export function mergeClips<K extends Timed>(t: TrackContent<K>, indices: number[]): TrackContent<K> | null {
  const valid = indices.filter((i) => t.clips[i]);
  if (valid.length === 0) return null;
  const first = Math.min(...valid);
  const last = valid.length === 1 ? first + 1 : Math.max(...valid);
  if (!t.clips[last] || last === first) return null;
  const p = pinStarts(t);
  const merged: Clip = { ...p.clips[first], end: p.clips[last].end };
  return tidy({ ...p, clips: [...p.clips.slice(0, first), merged, ...p.clips.slice(last + 1)] });
}

/** Animation > Edit track > Split clip at `frame` (the second part starts there). Null when it does not apply. */
export function splitClip<K extends Timed>(t: TrackContent<K>, frame: number, fps = 24): TrackContent<K> | null {
  const i = clipIndexAt(t.clips, frame);
  const c = t.clips[i];
  if (!c || c.start === frame) return null;
  const second: Clip = { start: frame, end: c.end, ...(c.offset !== undefined ? { offset: c.offset + (frame - c.start) / fps } : {}) };
  // The cel shown at the split keeps showing in the second part.
  return tidy(pinStarts({ ...t, clips: [...t.clips.slice(0, i), { ...c, end: frame - 1 }, second, ...t.clips.slice(i + 1)] }));
}

/** Copy (clip): the clip and what lies in it. */
export function copyClip<K extends Timed>(t: TrackContent<K>, i: number): ClipCopy<K> | null {
  const c = t.clips[i];
  if (!c) return null;
  const p = pinStarts(t);
  const inside = (f: number) => c.start <= f && f <= c.end;
  return {
    length: c.end - c.start + 1,
    ...(c.offset !== undefined ? { offset: c.offset } : {}),
    ...(p.cels ? { cels: p.cels.filter((a) => inside(a.frame)).map((a) => ({ ...a, frame: a.frame - c.start })) } : {}),
    ...(p.keys ? { keys: p.keys.filter((k) => inside(k.frame)).map((k) => ({ ...k, frame: k.frame - c.start })) } : {}),
  };
}

/** Takes frames [from, to] out of the clips (and what lies there); the cel shown after them stays. */
export function cutRange<K extends Timed>(t: TrackContent<K>, from: number, to: number, fps = 24): TrackContent<K> {
  const p = pinStarts(t);
  let cels = p.cels;
  // The part after the cut starts with the cel it showed.
  const after = cels ? (assignmentAt({ cels }, to + 1)?.cel ?? null) : null;
  const clips: Clip[] = [];
  for (const c of p.clips) {
    if (c.end < from || c.start > to) {
      clips.push(c);
      continue;
    }
    if (c.start < from) clips.push({ ...c, end: from - 1 });
    if (c.end > to) {
      clips.push({ ...c, start: to + 1, ...(c.offset !== undefined ? { offset: c.offset + (to + 1 - c.start) / fps } : {}) });
      if (cels && after !== null && !cels.some((a) => a.frame === to + 1)) cels = [...cels, { frame: to + 1, cel: after }];
    }
  }
  const out = (f: number) => f < from || f > to;
  return tidy({
    clips,
    ...(cels ? { cels: cels.filter((a) => out(a.frame)) } : {}),
    ...(p.keys ? { keys: p.keys.filter((k) => out(k.frame)) } : {}),
  });
}

/** Paste (clip) at `frame`: the copy replaces what lies in the frames it covers. */
export function pasteClip<K extends Timed>(t: TrackContent<K>, copy: ClipCopy<K>, frame: number, fps = 24): TrackContent<K> {
  const start = clamp(Math.round(frame), 1, MAX_FRAMES);
  const end = Math.min(MAX_FRAMES, start + copy.length - 1);
  const cut = cutRange(t, start, end, fps);
  const place = <T extends Timed>(list: T[] | undefined) => (list ?? []).map((x) => ({ ...x, frame: x.frame + start })).filter((x) => x.frame <= end);
  return tidy({
    clips: [...cut.clips, { start, end, ...(copy.offset !== undefined ? { offset: copy.offset } : {}) }],
    ...(cut.cels || copy.cels ? { cels: [...(cut.cels ?? []), ...place(copy.cels)].sort(byFrame) } : {}),
    ...(cut.keys || copy.keys ? { keys: [...(cut.keys ?? []), ...place(copy.keys)].sort(byFrame) } : {}),
  });
}

// ------------------------------------------------------------------ frames

/**
 * Animation > Timeline > Insert frame: `count` frames before `at`. A clip that goes on over `at`
 * gets longer; later clips, cels and keys move back.
 */
export function insertClipFrames<K extends Timed>(t: TrackContent<K>, at: number, count: number): TrackContent<K> {
  const shift = <T extends Timed>(list: T[] | undefined) => list?.map((x) => (x.frame >= at ? { ...x, frame: x.frame + count } : x));
  const clips = t.clips.map((c) => (c.start >= at ? { ...c, start: c.start + count, end: c.end + count } : c.end >= at ? { ...c, end: c.end + count } : c));
  const cels = shift(t.cels);
  const keys = shift(t.keys);
  return tidy({ clips, ...(cels ? { cels } : {}), ...(keys ? { keys } : {}) });
}

/**
 * Animation > Timeline > Delete frame: frames [at, at + count) go; clips get shorter, later clips,
 * cels and keys move forward, and the cel shown right after the deleted frames still shows there.
 */
export function deleteClipFrames<K extends Timed>(t: TrackContent<K>, at: number, count: number, fps = 24): TrackContent<K> {
  const last = at + count - 1;
  const clips: Clip[] = [];
  for (const c of t.clips) {
    const start = c.start < at ? c.start : c.start > last ? c.start - count : at;
    const end = c.end < at ? c.end : c.end > last ? c.end - count : at - 1;
    if (end < start) continue;
    const skipped = c.start >= at && c.start <= last ? last + 1 - c.start : 0;
    clips.push({ ...c, start, end, ...(c.offset !== undefined && skipped ? { offset: c.offset + skipped / fps } : {}) });
  }
  const keys = t.keys?.filter((k) => k.frame < at || k.frame > last).map((k) => (k.frame > last ? { ...k, frame: k.frame - count } : k));
  const cels = t.cels ? deleteFrames({ cels: t.cels }, at, count).cels : undefined;
  return tidy({ clips, ...(cels ? { cels } : {}), ...(keys ? { keys } : {}) });
}

// ------------------------------------------------------------------ files

/** Clips from a file (sorted, inside the timeline's limits, not overlapping), or undefined. */
export function sanitizeClips(raw: unknown): Clip[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const clips: Clip[] = [];
  for (const c of raw.slice(0, MAX_FRAMES)) {
    if (!c || typeof c !== 'object') continue;
    const r = c as Record<string, unknown>;
    const start = typeof r.start === 'number' && Number.isFinite(r.start) ? Math.round(r.start) : NaN;
    const end = typeof r.end === 'number' && Number.isFinite(r.end) ? Math.round(r.end) : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const offset = typeof r.offset === 'number' && Number.isFinite(r.offset) ? clamp(r.offset, -3600, 36000) : undefined;
    clips.push({ start, end, ...(offset !== undefined ? { offset } : {}) });
  }
  return tidy({ clips }).clips;
}
