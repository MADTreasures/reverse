/**
 * Several timelines on one canvas (Animation > Timeline > New timeline / Manage timeline): the
 * layers are shared, but each timeline has its own settings and its own track contents (clips,
 * keyframes, an animation folder's cel assignments, mask keyframes). The timeline being edited
 * keeps them on the layers; the others keep them by layer id. Switching swaps them.
 *
 * Change frame rate (with Change total number of frames) rescales every frame position so the
 * animation keeps its playing time. Pure, unit tested.
 */
import { MAX_FRAMES, sanitizeTimeline, type CelAssignment, type Timeline } from '../paint/animation';
import { sanitizeClips, type Clip } from '../paint/clips';
import { removeChannels, sanitizeKeyframes, sanitizeKeyTrack, PLACEMENT_CHANNELS, type Keyframe, type KeyTrack } from '../paint/keyframes';
import { flatten } from './layers';
import type { Id, Layer, PaintDocument } from './types';

/** What a timeline holds for one layer. */
export interface TrackData {
  clips?: Clip[];
  keys?: KeyTrack;
  /** An animation folder's cel assignments. */
  cels?: CelAssignment[];
  /** The keyframes of the layer's mask. */
  maskKeys?: Keyframe[];
}

/** A timeline that is not being edited. */
export interface StoredTimeline {
  timeline: Timeline;
  tracks: Record<Id, TrackData>;
}

/** The other timelines of a canvas, in list order, and where the edited one stands among them. */
export interface TimelineSet {
  others: StoredTimeline[];
  /** Position of the edited timeline in the list. */
  index: number;
}

const clone = <T>(v: T): T => structuredClone(v);

/** The track contents on the layers (the edited timeline's). */
export function collectTracks(layers: Layer[]): Record<Id, TrackData> {
  const out: Record<Id, TrackData> = {};
  for (const l of flatten(layers)) {
    const d: TrackData = {};
    if (l.clips) d.clips = clone(l.clips);
    if (l.keys) d.keys = clone(l.keys);
    if (l.kind === 'folder' && l.animation) d.cels = clone(l.animation.cels);
    if (l.mask?.keys) d.maskKeys = clone(l.mask.keys);
    if (Object.keys(d).length) out[l.id] = d;
  }
  return out;
}

/** Puts a timeline's track contents on the layers (which are changed); layers it does not know start empty. */
export function applyTracks(layers: Layer[], tracks: Record<Id, TrackData>): void {
  for (const l of flatten(layers)) {
    const d = tracks[l.id] ?? {};
    if (l.kind === 'audio') {
      // Audio layers always have their lists; their keyframes are always on.
      l.clips = clone(d.clips ?? []);
      l.keys = { enabled: true, frames: clone(d.keys?.frames ?? []) };
    } else if (l.kind === 'movie') {
      l.clips = clone(d.clips ?? []);
      if (d.keys) l.keys = clone(d.keys);
      else delete l.keys;
    } else {
      if (d.clips) l.clips = clone(d.clips);
      else delete l.clips;
      if (l.kind === 'folder' && l.camera) l.keys = { enabled: true, frames: clone(d.keys?.frames ?? []) };
      else if (d.keys) l.keys = clone(d.keys);
      else delete l.keys;
    }
    if (l.kind === 'folder' && l.animation) l.animation = { cels: clone(d.cels ?? []) };
    if (l.mask) {
      const { keys: _keys, ...mask } = l.mask;
      void _keys;
      l.mask = d.maskKeys?.length ? { ...mask, keys: clone(d.maskKeys) } : mask;
    }
  }
}

/** Every timeline in list order (the edited one at its place). */
export function timelineList(doc: PaintDocument): Timeline[] {
  if (!doc.timeline) return [];
  const set = doc.timelines;
  if (!set) return [doc.timeline];
  const list = set.others.map((o) => o.timeline);
  list.splice(Math.min(set.index, list.length), 0, doc.timeline);
  return list;
}

/** The edited timeline's place in the list. */
export const timelineIndex = (doc: PaintDocument): number => Math.min(doc.timelines?.index ?? 0, doc.timelines?.others.length ?? 0);

/** A name not used by the canvas's timelines: Timeline 1, 2, … */
export function nextTimelineName(doc: PaintDocument, base = 'Timeline'): string {
  const used = new Set(timelineList(doc).map((t, i) => t.name ?? `Timeline ${i + 1}`));
  for (let n = 1; ; n++) if (!used.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** The name shown for a timeline. */
export const timelineName = (t: Timeline, index: number): string => t.name ?? `Timeline ${index + 1}`;

function setOthers(doc: PaintDocument, others: StoredTimeline[], index: number): void {
  if (others.length) doc.timelines = { others, index: Math.max(0, Math.min(others.length, index)) };
  else delete doc.timelines;
}

/** Switches to the timeline at `index` of the list (the document is changed). */
export function switchTimeline(doc: PaintDocument, index: number): void {
  const current = timelineIndex(doc);
  const list = doc.timelines?.others ?? [];
  if (!doc.timeline || index === current || index < 0 || index > list.length) return;
  const stored: StoredTimeline = { timeline: doc.timeline, tracks: collectTracks(doc.layers) };
  // The full list without the target, the edited one stored at its place.
  const full: (StoredTimeline | null)[] = [...list];
  full.splice(current, 0, null);
  const target = full[index]!;
  full[current] = stored;
  full.splice(index, 1);
  applyTracks(doc.layers, target.tracks);
  doc.timeline = target.timeline;
  setOthers(doc, full as StoredTimeline[], index);
}

/** Adds a timeline after the edited one and switches to it: empty, or (`copy`) with the edited one's tracks. */
export function addTimeline(doc: PaintDocument, timeline: Timeline, copy = false): void {
  if (!doc.timeline) {
    doc.timeline = timeline;
    return;
  }
  const index = timelineIndex(doc);
  const tracks = copy ? collectTracks(doc.layers) : {};
  const others = [...(doc.timelines?.others ?? [])];
  others.splice(index, 0, { timeline: doc.timeline, tracks: collectTracks(doc.layers) });
  applyTracks(doc.layers, tracks);
  doc.timeline = timeline;
  setOthers(doc, others, index + 1);
}

/** Deletes the timeline at `index` (the edited one: the next or previous becomes edited). Not the last one. */
export function deleteTimeline(doc: PaintDocument, index: number): boolean {
  const others = doc.timelines?.others ?? [];
  if (!doc.timeline || others.length === 0) return false;
  const current = timelineIndex(doc);
  if (index === current) {
    // Edit a neighbour first, then drop the one that was edited.
    const next = index < others.length ? index + 1 : index - 1;
    switchTimeline(doc, next);
    return deleteTimeline(doc, index);
  }
  const at = index < current ? index : index - 1;
  const rest = others.filter((_, i) => i !== at);
  setOthers(doc, rest, index < current ? current - 1 : current);
  return true;
}

/** Moves the timeline at `index` one place up (-1) or down (1) in the list. */
export function moveTimeline(doc: PaintDocument, index: number, dir: -1 | 1): void {
  const others = doc.timelines?.others ?? [];
  const current = timelineIndex(doc);
  const to = index + dir;
  if (!doc.timeline || to < 0 || to > others.length) return;
  const full: (StoredTimeline | null)[] = [...others];
  full.splice(current, 0, null);
  [full[index], full[to]] = [full[to], full[index]];
  const nextIndex = full.indexOf(null);
  setOthers(doc, full.filter((x): x is StoredTimeline => x !== null), nextIndex);
}

// ------------------------------------------------------------------ change frame rate

/** A frame at the new rate: same time from the start (frame 1 stays frame 1). */
const scaled = (f: number, k: number) => Math.max(1, Math.round((f - 1) * k) + 1);

function scaleTrack(d: TrackData, k: number): TrackData {
  return {
    ...(d.clips ? { clips: d.clips.map((c) => ({ ...c, start: scaled(c.start, k), end: Math.max(scaled(c.start, k), Math.round(c.end * k)) })) } : {}),
    ...(d.keys ? { keys: { ...d.keys, frames: dedupe(d.keys.frames.map((x) => ({ ...x, frame: scaled(x.frame, k) }))) } } : {}),
    ...(d.cels ? { cels: dedupe(d.cels.map((a) => ({ ...a, frame: scaled(a.frame, k) }))) } : {}),
    ...(d.maskKeys ? { maskKeys: dedupe(d.maskKeys.map((x) => ({ ...x, frame: scaled(x.frame, k) }))) } : {}),
  };
}

/** Items that land on the same frame: the later one stays. */
function dedupe<T extends { frame: number }>(list: T[]): T[] {
  return [...new Map(list.map((x) => [x.frame, x])).values()].sort((a, b) => a.frame - b.frame);
}

/**
 * Animation > Timeline > Change frame rate of the edited timeline. With `rescale` (Change total
 * number of frames) the number of frames and every frame position change so the playing time
 * stays (8 → 24 fps: three times the frames).
 */
export function changeFrameRate(doc: PaintDocument, fps: number, rescale: boolean): void {
  const t = doc.timeline;
  if (!t || fps === t.fps) return;
  if (!rescale) {
    doc.timeline = { ...t, fps };
    return;
  }
  const k = fps / t.fps;
  const frames = Math.max(1, Math.min(MAX_FRAMES, Math.round(t.frames * k)));
  const tracks = collectTracks(doc.layers);
  applyTracks(doc.layers, Object.fromEntries(Object.entries(tracks).map(([id, d]) => [id, scaleTrack(d, k)])));
  doc.timeline = {
    ...t,
    fps,
    frames,
    ...(t.start !== undefined ? { start: Math.min(frames, scaled(t.start, k)) } : {}),
    ...(t.end !== undefined ? { end: Math.min(frames, Math.round(t.end * k)) } : {}),
  };
}

// ------------------------------------------------------------------ files

function sanitizeTrackData(raw: unknown): TrackData | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const clips = sanitizeClips(r.clips);
  const keys = sanitizeKeyTrack(r.keys);
  const cels = Array.isArray(r.cels)
    ? r.cels.flatMap((a): CelAssignment[] => {
        if (!a || typeof a !== 'object') return [];
        const x = a as Record<string, unknown>;
        const frame = typeof x.frame === 'number' && Number.isFinite(x.frame) ? Math.round(x.frame) : 0;
        return frame >= 1 && frame <= MAX_FRAMES * 10 ? [{ frame, cel: typeof x.cel === 'string' ? x.cel.slice(0, 64) : null }] : [];
      })
    : undefined;
  const maskKeys = sanitizeKeyframes(r.maskKeys).flatMap((k) => removeChannels([k], k.frame, ['opacity', 'volume']));
  const d: TrackData = {
    ...(clips ? { clips } : {}),
    ...(keys ? { keys } : {}),
    ...(cels ? { cels: dedupe(cels) } : {}),
    ...(maskKeys.length ? { maskKeys } : {}),
  };
  return Object.keys(d).length ? d : null;
}

/** The other timelines from a file: their tracks only for the document's layers (cels checked against their folders). */
export function sanitizeTimelines(raw: unknown, layers: Layer[]): TimelineSet | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const all = flatten(layers);
  const byId = new Map(all.map((l) => [l.id, l]));
  const others: StoredTimeline[] = [];
  for (const o of Array.isArray(r.others) ? r.others.slice(0, 100) : []) {
    if (!o || typeof o !== 'object') continue;
    const x = o as Record<string, unknown>;
    const timeline = sanitizeTimeline(x.timeline);
    if (!timeline) continue;
    const tracks: Record<Id, TrackData> = {};
    const rawTracks = x.tracks && typeof x.tracks === 'object' ? (x.tracks as Record<string, unknown>) : {};
    for (const [id, value] of Object.entries(rawTracks)) {
      const layer = byId.get(id);
      const d = layer ? sanitizeTrackData(value) : null;
      if (!layer || !d) continue;
      // Volume keys on audio layers, placements elsewhere; cels of the folder's own layers.
      if (d.keys) d.keys = { ...d.keys, frames: d.keys.frames.flatMap((k) => removeChannels([k], k.frame, layer.kind === 'audio' ? PLACEMENT_CHANNELS : ['volume'])) };
      if (d.cels) {
        const own = layer.kind === 'folder' && layer.animation ? new Set(layer.children.map((c) => c.id)) : null;
        if (own) d.cels = d.cels.filter((a) => a.cel === null || own.has(a.cel));
        else delete d.cels;
      }
      if (Object.keys(d).length) tracks[id] = d;
    }
    others.push({ timeline, tracks });
  }
  if (others.length === 0) return undefined;
  const index = typeof r.index === 'number' && Number.isFinite(r.index) ? Math.max(0, Math.min(others.length, Math.round(r.index))) : 0;
  return { others, index };
}
