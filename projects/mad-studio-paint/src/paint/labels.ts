/**
 * Labels on the timeline (Animation > Label), like the reference's: a timeline label names a frame
 * of the whole timeline (Animation > Move frame > Go to timeline label jumps there; each text only
 * once), a track label puts a note on a track at a frame or, as a ranged label, over several
 * frames, and an inbetween track label marks an inbetween frame with 〇 or ● (the exposure sheet
 * shows the mark). Labels belong to their timeline and move with Insert frame / Delete frame; a
 * ranged label gets longer or shorter. Pure, unit tested.
 */
import type { Id } from '../model/types';

export interface TimelineLabel {
  frame: number;
  text: string;
}

export interface TrackLabel {
  /** The track (its layer). */
  track: Id;
  frame: number;
  /** Frames it covers (more than one: a ranged label). */
  length: number;
  text: string;
}

/** What a timeline keeps of labels. */
export interface Labels {
  labels?: TimelineLabel[];
  trackLabels?: TrackLabel[];
}

/** Inbetween track labels: their text is the mark. */
export const INBETWEEN_OPEN = '〇';
export const INBETWEEN_FILLED = '●';
export const isInbetween = (l: TrackLabel): boolean => l.text === INBETWEEN_OPEN || l.text === INBETWEEN_FILLED;

export const MAX_LABEL_TEXT = 100;
/** Labels a timeline keeps at most (each kind). */
const MAX_LABELS = 2000;

/** The last frame a track label covers. */
export const lastFrameOf = (l: TrackLabel): number => l.frame + l.length - 1;

const cleanText = (text: string) =>
  text
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, MAX_LABEL_TEXT);
const byFrame = (a: { frame: number }, b: { frame: number }) => a.frame - b.frame;
const byTrackFrame = (a: TrackLabel, b: TrackLabel) => (a.track < b.track ? -1 : a.track > b.track ? 1 : a.frame - b.frame);

// ------------------------------------------------------------------ timeline labels

/** The timeline label on a frame. */
export const timelineLabelAt = (labels: TimelineLabel[] | undefined, frame: number): TimelineLabel | undefined => labels?.find((l) => l.frame === frame);

/** Whether another frame already has a timeline label with this text (the reference allows each text once). */
export const labelTextTaken = (labels: TimelineLabel[] | undefined, text: string, frame: number): boolean => {
  const t = cleanText(text);
  return (labels ?? []).some((l) => l.frame !== frame && l.text === t);
};

/** Sets the timeline label of a frame (one per frame; empty text removes it). */
export function setTimelineLabel(labels: TimelineLabel[] | undefined, frame: number, text: string): TimelineLabel[] {
  const t = cleanText(text);
  const rest = (labels ?? []).filter((l) => l.frame !== frame);
  return t ? [...rest, { frame, text: t }].sort(byFrame) : rest;
}

// ------------------------------------------------------------------ track labels

/** The track label of a track that covers a frame. */
export const trackLabelAt = (labels: TrackLabel[] | undefined, track: Id, frame: number): TrackLabel | undefined =>
  labels?.find((l) => l.track === track && l.frame <= frame && frame <= lastFrameOf(l));

/** A track's labels, by frame. */
export const labelsOfTrack = (labels: TrackLabel[] | undefined, track: Id): TrackLabel[] => (labels ?? []).filter((l) => l.track === track);

const overlaps = (a: TrackLabel, b: TrackLabel) => a.track === b.track && a.frame <= lastFrameOf(b) && b.frame <= lastFrameOf(a);

/** Adds a track label (empty text: nothing); labels of the track it overlaps are replaced. */
export function addTrackLabel(labels: TrackLabel[] | undefined, label: TrackLabel): TrackLabel[] {
  const text = cleanText(label.text);
  const list = labels ?? [];
  if (!text) return list;
  const l = { track: label.track, frame: Math.max(1, Math.round(label.frame)), length: Math.max(1, Math.round(label.length)), text };
  return [...list.filter((x) => !overlaps(x, l)), l].sort(byTrackFrame);
}

/** Removes the track label that covers a frame of a track. */
export function removeTrackLabel(labels: TrackLabel[] | undefined, track: Id, frame: number): TrackLabel[] {
  const hit = trackLabelAt(labels, track, frame);
  return (labels ?? []).filter((l) => l !== hit);
}

/** Changes the text of the track label starting at `frame`; deleting the text deletes the label. */
export function renameTrackLabel(labels: TrackLabel[] | undefined, track: Id, frame: number, text: string): TrackLabel[] {
  const t = cleanText(text);
  const list = labels ?? [];
  return t ? list.map((l) => (l.track === track && l.frame === frame ? { ...l, text: t } : l)) : list.filter((l) => !(l.track === track && l.frame === frame));
}

/**
 * Dragging an end of the track label starting at `frame`: its first or last frame goes to `to`.
 * It keeps at least one frame and stops at the track's neighbouring labels.
 */
export function resizeTrackLabel(labels: TrackLabel[] | undefined, track: Id, frame: number, edge: 'start' | 'end', to: number): TrackLabel[] {
  const list = labels ?? [];
  const l = list.find((x) => x.track === track && x.frame === frame);
  if (!l) return list;
  const others = list.filter((x) => x.track === track && x !== l);
  const last = lastFrameOf(l);
  let start = l.frame;
  let end = last;
  if (edge === 'start') {
    const limit = Math.max(0, ...others.filter((x) => lastFrameOf(x) < l.frame).map(lastFrameOf)) + 1;
    start = Math.max(limit, Math.min(last, Math.round(to)));
  } else {
    const limit = Math.min(Infinity, ...others.filter((x) => x.frame > last).map((x) => x.frame)) - 1;
    end = Math.min(limit, Math.max(l.frame, Math.round(to)));
  }
  if (start === l.frame && end === last) return list;
  return list.map((x) => (x === l ? { ...l, frame: start, length: end - start + 1 } : x)).sort(byTrackFrame);
}

/** A track label picked in the Timeline palette: its track and first frame. */
export interface LabelRef {
  track: Id;
  frame: number;
}

const picks = (refs: LabelRef[]) => (l: TrackLabel) => refs.some((r) => r.track === l.track && r.frame === l.frame);

/** Moving picked track labels: the move nearest to `delta` that keeps them from frame 1 on. */
export function labelMoveDelta(labels: TrackLabel[] | undefined, refs: LabelRef[], delta: number): number {
  const moved = (labels ?? []).filter(picks(refs));
  return moved.length ? Math.max(1 - Math.min(...moved.map((l) => l.frame)), Math.round(delta)) : 0;
}

/**
 * Drags the picked track labels by `delta` frames (`copy`: duplicates them, Alt in the reference);
 * labels where they land are replaced (the reference asks first).
 */
export function moveTrackLabels(labels: TrackLabel[] | undefined, refs: LabelRef[], delta: number, copy = false): TrackLabel[] {
  const list = labels ?? [];
  const d = labelMoveDelta(list, refs, delta);
  if (!d) return list;
  const picked = picks(refs);
  const moved = list.filter(picked).map((l) => ({ ...l, frame: l.frame + d }));
  let out = list.filter((l) => copy || !picked(l));
  for (const l of moved) out = [...out.filter((x) => !overlaps(x, l)), l];
  return out.sort(byTrackFrame);
}

/** Copied track labels (Edit track > Copy): each relative to the first one copied. */
export interface LabelCopy {
  track: Id;
  offset: number;
  length: number;
  text: string;
}

export function copyTrackLabels(labels: TrackLabel[] | undefined, refs: LabelRef[]): LabelCopy[] {
  const picked = (labels ?? []).filter(picks(refs));
  if (!picked.length) return [];
  const first = Math.min(...picked.map((l) => l.frame));
  return picked.map((l) => ({ track: l.track, offset: l.frame - first, length: l.length, text: l.text }));
}

/**
 * Edit track > Paste at `frame`: labels copied from one track go to `track` (when given), from
 * several tracks each to its own.
 */
export function pasteTrackLabels(labels: TrackLabel[] | undefined, items: LabelCopy[], frame: number, track?: Id): { labels: TrackLabel[]; pasted: LabelRef[] } {
  const single = new Set(items.map((i) => i.track)).size === 1;
  let out = labels ?? [];
  const pasted: LabelRef[] = [];
  for (const it of items) {
    const l = { track: single && track ? track : it.track, frame: frame + it.offset, length: it.length, text: it.text };
    out = addTrackLabel(out, l);
    pasted.push({ track: l.track, frame: l.frame });
  }
  return { labels: out, pasted };
}

/** Deletes the picked track labels. */
export const deleteTrackLabels = (labels: TrackLabel[] | undefined, refs: LabelRef[]): TrackLabel[] => (labels ?? []).filter((l) => !picks(refs)(l));

/**
 * Inbetween track labels at regular intervals: from `from` every `step` frames up to `last`
 * (Alt+Enter / Shift+Alt+Enter after a right-drag in the reference).
 */
export function inbetweenRun(labels: TrackLabel[] | undefined, track: Id, from: number, step: number, last: number, mark: string): TrackLabel[] {
  let out = labels ?? [];
  const s = Math.max(1, Math.round(step));
  for (let f = Math.max(1, Math.round(from)); f <= last; f += s) out = addTrackLabel(out, { track, frame: f, length: 1, text: mark });
  return out;
}

// ------------------------------------------------------------------ frames

/**
 * Animation > Timeline > Insert frame: labels from `at` on move back by `count`; a ranged label
 * that covers `at` gets longer. `track`: only that track's labels (Selected layer only).
 */
export function insertLabelFrames(t: Labels, at: number, count: number, track?: Id): Labels {
  const labels = track === undefined ? t.labels?.map((l) => (l.frame >= at ? { ...l, frame: l.frame + count } : l)) : t.labels;
  const trackLabels = t.trackLabels?.map((l) => {
    if (track !== undefined && l.track !== track) return l;
    if (l.frame >= at) return { ...l, frame: l.frame + count };
    return lastFrameOf(l) >= at ? { ...l, length: l.length + count } : l;
  });
  return { ...(labels ? { labels } : {}), ...(trackLabels ? { trackLabels } : {}) };
}

/**
 * Animation > Timeline > Delete frame: frames [at, at + count) go. Timeline labels there go, later
 * ones move forward; a ranged track label gets shorter (gone when all its frames go).
 */
export function deleteLabelFrames(t: Labels, at: number, count: number, track?: Id): Labels {
  const last = at + count - 1;
  const labels = track === undefined ? t.labels?.filter((l) => l.frame < at || l.frame > last).map((l) => (l.frame > last ? { ...l, frame: l.frame - count } : l)) : t.labels;
  const trackLabels = t.trackLabels?.flatMap((l) => {
    if (track !== undefined && l.track !== track) return [l];
    const e = lastFrameOf(l);
    const start = l.frame < at ? l.frame : l.frame > last ? l.frame - count : at;
    const end = e < at ? e : e > last ? e - count : at - 1;
    return end < start ? [] : [{ ...l, frame: start, length: end - start + 1 }];
  });
  return { ...(labels ? { labels } : {}), ...(trackLabels ? { trackLabels } : {}) };
}

/**
 * Change frame rate with Change total number of frames: labels keep their time (frame 1 stays),
 * within the new number of frames.
 */
export function scaleLabels(t: Labels, k: number, frames: number): Labels {
  const at = (f: number) => Math.max(1, Math.min(frames, Math.round((f - 1) * k) + 1));
  let labels: TimelineLabel[] | undefined;
  for (const l of t.labels ?? []) labels = setTimelineLabel(labels, at(l.frame), l.text);
  let trackLabels: TrackLabel[] | undefined;
  for (const l of t.trackLabels ?? []) {
    const frame = at(l.frame);
    // A frame label (inbetween marks too) stays on one frame; a ranged one keeps its time.
    const length = l.length > 1 ? Math.round(l.length * k) : 1;
    trackLabels = addTrackLabel(trackLabels, { ...l, frame, length: Math.max(1, Math.min(frames - frame + 1, length)) });
  }
  return { ...(t.labels ? { labels: labels ?? [] } : {}), ...(t.trackLabels ? { trackLabels: trackLabels ?? [] } : {}) };
}

// ------------------------------------------------------------------ files

/** Keeps only the track labels of existing tracks (a deleted layer takes its labels along). */
export function pruneLabels<T extends Labels>(t: T, tracks: Set<Id>): T {
  if (!t.trackLabels?.some((l) => !tracks.has(l.track))) return t;
  const trackLabels = t.trackLabels.filter((l) => tracks.has(l.track));
  const { trackLabels: _old, ...rest } = t;
  void _old;
  return (trackLabels.length ? { ...rest, trackLabels } : rest) as T;
}

const frameOf = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0);

/** Timeline labels from a file (one per frame, texts once), or undefined. */
export function sanitizeTimelineLabels(raw: unknown, frames: number): TimelineLabel[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  let out: TimelineLabel[] = [];
  for (const x of raw.slice(0, MAX_LABELS)) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    const frame = frameOf(r.frame);
    if (frame < 1 || frame > frames || typeof r.text !== 'string' || labelTextTaken(out, r.text, frame)) continue;
    out = setTimelineLabel(out, frame, r.text);
  }
  return out.length ? out : undefined;
}

/** Track labels from a file (not overlapping on a track), or undefined; the caller checks the tracks. */
export function sanitizeTrackLabels(raw: unknown, frames: number): TrackLabel[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  let out: TrackLabel[] = [];
  for (const x of raw.slice(0, MAX_LABELS)) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    const frame = frameOf(r.frame);
    if (typeof r.track !== 'string' || !r.track || r.track.length > 64 || frame < 1 || frame > frames || typeof r.text !== 'string') continue;
    const length = Math.max(1, Math.min(frames - frame + 1, frameOf(r.length) || 1));
    out = addTrackLabel(out, { track: r.track, frame, length, text: r.text });
  }
  return out.length ? out : undefined;
}
