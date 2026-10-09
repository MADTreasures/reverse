/**
 * Animation (Timeline palette and Animation menu): the timeline, animation folders and cels,
 * assigning cels to frames, moving between frames, playback and onion skin.
 */
import {
  animationFolders,
  celOf,
  isAnimationFolder,
  isCameraFolder,
  keysOn,
  maskOwner,
  maskTrackId,
  restOf,
  setTrackContent,
  soundMix,
  trackContent,
  trackFolderOf,
  tracksOf,
  type AnimationFolder,
} from '../model/animation';
import { createFolder, createRasterLayer, findLayer, flatten, locate } from '../model/layers';
import type { AudioLayer, Id, Layer, PaintDocument } from '../model/types';
import { assignAt, celAt, DEFAULT_TIMELINE, emptyTrack, endOf, entryAt, MAX_FRAMES, nextCelName, nextTrackName, removeAt, startOf, type OnionSkin, type Timeline } from '../paint/animation';
import { addTimeline, changeFrameRate, deleteTimeline, moveTimeline, nextTimelineName, switchTimeline, timelineIndex, timelineList } from '../model/timelines';
import {
  clipIndexAt,
  copyClip as copyClipContent,
  deleteClipFrames,
  deleteClips,
  ensureClipAt,
  insertClipFrames,
  mergeClips,
  moveClips,
  nearestMove,
  pasteClip as pasteClipContent,
  setFirstDisplayed,
  setLastDisplayed,
  splitClip,
  stretchClip,
  trimClip,
  type ClipCopy,
  type ClipEdge,
  type Timed,
  type TrackContent,
} from '../paint/clips';
import { setVolumeKey, volumeAt } from '../paint/sound';
import { resizeOutputFrame } from '../paint/outputFrame';
import {
  GROUPS,
  moveKeys,
  placementAt,
  PLACEMENT_CHANNELS,
  recordKey,
  removeChannels,
  setInterp,
  toggleUnpaired,
  TRANSFORM_GROUPS,
  withSettings,
  type Channel,
  type ChannelGroup,
  type CurvePoint,
  type Interp,
  type Keyframe,
  type Placement,
  type PlacementChannel,
} from '../paint/keyframes';
import { ensureSurface } from '../engine/surfaces';
import { startSound, stopSound } from '../engine/sounds';
import * as actions from './actions';
import { getState, setState, type ClipRef, type CurveRef, type KeyRef, type PaintState } from './store';

/** A track's content: clips, cel assignments, keyframes (placements, or volumes on audio tracks). */
type Content = TrackContent<Timed>;

/** A track: a layer (animation folders and audio layers too). */
interface AnyTrack {
  id: Id;
  layer: Layer;
  /** An audio layer. */
  sound: boolean;
}

function trackById(doc: PaintDocument, id: Id): AnyTrack | null {
  const layer = findLayer(doc.layers, id);
  return layer ? { id, layer, sound: layer.kind === 'audio' } : null;
}

/** What a track holds (clips made explicit). */
const contentOf = (t: AnyTrack, frames: number): Content => trackContent(t.layer, frames);

/** Stores a track's changed content (in a document copy being edited). */
function storeContent(doc: PaintDocument, id: Id, c: Content): void {
  const t = trackById(doc, id);
  if (t) setTrackContent(t.layer, c as TrackContent<Keyframe>);
}

/** The track Edit track commands work on: the current layer's track (an audio layer is its own). */
export function currentTrackId(s: PaintState = getState()): Id | null {
  return currentTrack(s)?.id ?? null;
}

/** The selected audio layer, or null. */
export function activeAudio(s: PaintState = getState()): AudioLayer | null {
  const l = findLayer(s.doc.layers, s.activeLayerId);
  return l?.kind === 'audio' ? l : null;
}

export const timelineOf = (s: PaintState = getState()): Timeline | null => s.doc.timeline ?? null;

/** The track being edited: the animation folder of the active layer, or the only one there is. */
export function activeTrack(s: PaintState = getState()): AnimationFolder | null {
  const own = trackFolderOf(s.doc.layers, s.activeLayerId);
  if (own) return own;
  const all = animationFolders(s.doc.layers);
  return all.length === 1 ? all[0] : null;
}

const clampFrame = (frame: number, t: Timeline | null) => Math.max(1, Math.min(t?.frames ?? 1, Math.round(frame)));

/** The layer to edit for a track at a frame: the cel shown there (a layer inside a folder cel), or the folder. */
function editTargetAt(folder: AnimationFolder, frame: number, activeId: Id, layers: Layer[]): Id {
  const id = celAt(folder.animation, frame);
  const cel = id ? folder.children.find((c) => c.id === id) : undefined;
  if (!cel) return folder.id;
  if (cel.kind !== 'folder') return cel.id;
  // A cel made of several layers: keep the layer being edited if it is inside, else its top layer.
  if (celOf(layers, activeId)?.cel.id === cel.id && findLayer([cel], activeId)?.kind !== 'folder') return activeId;
  return flatten(cel.children).find((l) => l.kind !== 'folder')?.id ?? cel.id;
}

/** Selects a frame; the cel shown there in the current track becomes the layer being edited. */
export function setFrame(frame: number, follow = true): void {
  const s = getState();
  const f = clampFrame(frame, timelineOf(s));
  if (f !== s.frame) setState({ frame: f });
  if (!follow) return;
  const track = trackFolderOf(s.doc.layers, s.activeLayerId);
  if (!track || !s.doc.timeline?.enabled) return;
  // The folder's own layer mask stays selected (its keyframes are placed at the frame).
  if (s.maskEditing && track.id === s.activeLayerId) return;
  const target = editTargetAt(track, f, s.activeLayerId, s.doc.layers);
  if (target !== s.activeLayerId) setState({ activeLayerId: target, maskEditing: false, selectedObjects: [] });
}

export const nextFrame = () => setFrame(getState().frame + 1);
export const previousFrame = () => setFrame(getState().frame - 1);
export const firstFrame = () => setFrame(1);
export const lastFrame = () => setFrame(timelineOf()?.frames ?? 1);

/** Clicking a frame of a track: that track and frame are selected (for an animation folder, the cel shown there). */
export function selectTrackFrame(trackId: Id, frame: number): void {
  const s = getState();
  const track = findLayer(s.doc.layers, trackId);
  if (!track) return;
  const f = clampFrame(frame, timelineOf(s));
  const target = isAnimationFolder(track) ? editTargetAt(track, f, s.activeLayerId, s.doc.layers) : track.id;
  setState({ frame: f, activeLayerId: target, ...(target !== s.activeLayerId ? { maskEditing: false, selectedObjects: [] } : {}) });
}

/** The track of the layer being edited: the layer itself, or the animation folder of a cel. */
export function currentTrack(s: PaintState = getState()): Layer | null {
  return tracksOf(s.doc.layers, s.activeLayerId)[0] ?? null;
}

// ------------------------------------------------------------------ timeline

/** Creates the timeline (Animation > Timeline > New timeline) or changes its settings. */
export function setTimeline(patch: Partial<Timeline>, label = 'Timeline settings', key?: string): void {
  actions.changeDoc(
    label,
    (doc) => {
      const t = { ...(doc.timeline ?? DEFAULT_TIMELINE), ...patch };
      t.frames = Math.max(1, Math.min(MAX_FRAMES, Math.round(t.frames)));
      // Start and end frame within the frames (not set: every frame).
      const start = Math.max(1, Math.min(t.frames, Math.round(t.start ?? 1)));
      const end = Math.max(start, Math.min(t.frames, Math.round(t.end ?? t.frames)));
      delete t.start;
      delete t.end;
      doc.timeline = { ...t, ...(start > 1 ? { start } : {}), ...(end < t.frames ? { end } : {}) };
    },
    key ? { key } : {},
  );
  const t = timelineOf();
  if (t && getState().frame > t.frames) setFrame(t.frames);
}

// ------------------------------------------------------------------ several timelines

/** Clears what is selected on the tracks (another timeline shows other contents). */
const clearTrackSelections = () => setState({ clipSelection: [], keySelection: [], graphSelection: [] });

/** Timeline palette (timeline list) / Manage timeline: edits another timeline. */
export function switchToTimeline(index: number): void {
  const s = getState();
  if (!s.doc.timeline || index === timelineIndex(s.doc)) return;
  actions.changeDoc('Switch timeline', (doc) => switchTimeline(doc, index));
  clearTrackSelections();
  const t = timelineOf();
  if (t) setFrame(Math.min(getState().frame, t.frames));
}

/** Animation > Timeline > New timeline: the canvas's first one, or another one (empty) after the edited one. */
export function newTimeline(settings: Pick<Timeline, 'fps' | 'frames'> & { name?: string }): void {
  const s = getState();
  const timeline: Timeline = { enabled: true, fps: settings.fps, frames: settings.frames, name: settings.name || nextTimelineName(s.doc) };
  actions.changeDoc('New timeline', (doc) => addTimeline(doc, timeline));
  clearTrackSelections();
  setState({ timelineShown: true });
  setFrame(Math.min(getState().frame, timeline.frames));
}

/** Manage timeline > Duplicate: a copy of the edited timeline (with its tracks), edited next. */
export function duplicateTimeline(name?: string): void {
  const s = getState();
  const t = s.doc.timeline;
  if (!t) return;
  actions.changeDoc('Duplicate timeline', (doc) => addTimeline(doc, { ...t, name: name || nextTimelineName(doc) }, true));
  clearTrackSelections();
}

/** Manage timeline > Delete: the canvas keeps at least one timeline. */
export function removeTimeline(index: number): void {
  const s = getState();
  if (timelineList(s.doc).length <= 1) {
    setState({ hint: 'The canvas needs one timeline (Animation > Timeline > Enable timeline turns it off)' });
    return;
  }
  actions.changeDoc('Delete timeline', (doc) => void deleteTimeline(doc, index));
  clearTrackSelections();
  const t = timelineOf();
  if (t) setFrame(Math.min(getState().frame, t.frames));
}

/** Manage timeline > Move up / Move down. */
export function reorderTimeline(index: number, dir: -1 | 1): void {
  actions.changeDoc(dir < 0 ? 'Move timeline up' : 'Move timeline down', (doc) => moveTimeline(doc, index, dir));
}

/** Manage timeline > Change settings of a timeline that is not edited (name, frame rate, frames, start and end). */
export function setStoredTimeline(index: number, patch: Partial<Timeline>): void {
  const s = getState();
  if (index === timelineIndex(s.doc)) {
    setTimeline(patch);
    return;
  }
  actions.changeDoc('Timeline settings', (doc) => {
    const others = doc.timelines?.others;
    const at = index < timelineIndex(doc) ? index : index - 1;
    const o = others?.[at];
    if (!o) return;
    const t = { ...o.timeline, ...patch };
    const frames = Math.max(1, Math.min(MAX_FRAMES, Math.round(t.frames)));
    o.timeline = { ...t, frames, ...(t.start !== undefined ? { start: Math.min(frames, t.start) } : {}), ...(t.end !== undefined ? { end: Math.min(frames, t.end) } : {}) };
  });
}

/** Animation > Timeline > Change frame rate (Change total number of frames: the playing time stays). */
export function setFrameRate(fps: number, rescale: boolean): void {
  const s = getState();
  const t = s.doc.timeline;
  if (!t || fps === t.fps) return;
  const k = fps / t.fps;
  actions.changeDoc('Change frame rate', (doc) => changeFrameRate(doc, fps, rescale));
  clearTrackSelections();
  if (rescale) setFrame(Math.max(1, Math.round((s.frame - 1) * k) + 1));
}

/** Animation > Timeline > Enable timeline: off shows every cel, like normal folders. */
export function toggleTimeline(): void {
  const t = timelineOf();
  if (!t) {
    setState({ hint: 'The canvas has no timeline yet (Animation > Timeline > New timeline)' });
    return;
  }
  stop();
  setTimeline({ enabled: !t.enabled }, t.enabled ? 'Disable timeline' : 'Enable timeline');
}

/** Every track of the timeline (cels are not tracks). */
function allTracks(layers: Layer[], out: Layer[] = []): Layer[] {
  for (const l of layers) {
    out.push(l);
    if (l.kind === 'folder' && !l.animation) allTracks(l.children, out);
  }
  return out;
}

/** Applies a track operation to every track: those with clips of their own, and animation folders. */
function everyTrack(doc: PaintDocument, op: (t: Content) => Content): void {
  const frames = doc.timeline?.frames ?? 1;
  for (const l of allTracks(doc.layers)) {
    if (!l.clips && !isAnimationFolder(l) && !l.keys) continue;
    // A track that shows over the whole timeline still does afterwards.
    const whole = !l.clips;
    const t = trackContent(l, frames);
    setTrackContent(l, op(whole ? { ...t, clips: [{ start: 1, end: MAX_FRAMES }] } : t) as TrackContent<Keyframe>);
    if (whole) delete l.clips;
  }
}

/** Animation > Timeline > Insert frame / Delete frame at the current frame, on every track. */
export function insertFrame(count = 1): void {
  const { frame } = getState();
  actions.changeDoc('Insert frame', (doc) => {
    if (!doc.timeline) return;
    everyTrack(doc, (t) => insertClipFrames(t, frame, count));
    doc.timeline = { ...doc.timeline, frames: Math.min(MAX_FRAMES, doc.timeline.frames + count) };
  });
  setState({ clipSelection: [] });
}

export function deleteFrame(count = 1): void {
  const s = getState();
  const t = timelineOf(s);
  if (!t || t.frames <= 1) return;
  const n = Math.min(count, t.frames - s.frame + 1, t.frames - 1);
  actions.changeDoc('Delete frame', (doc) => {
    everyTrack(doc, (c) => deleteClipFrames(c, s.frame, n, t.fps));
    doc.timeline = { ...t, frames: t.frames - n };
  });
  setState({ clipSelection: [] });
  setFrame(Math.min(s.frame, t.frames - n));
}

// ------------------------------------------------------------------ folders and cels

/** Where a new animation folder goes: above the current layer, never inside another animation folder. */
function insertTrack(doc: PaintDocument, folder: Layer, activeId: Id): void {
  const around = trackFolderOf(doc.layers, activeId);
  const anchor = around?.id ?? activeId;
  const active = findLayer(doc.layers, anchor);
  if (!around && active?.kind === 'folder' && !active.frame) {
    active.children.unshift(folder);
    active.expanded = true;
    return;
  }
  const loc = locate(doc.layers, anchor);
  if (loc) loc.siblings.splice(loc.index, 0, folder);
  else doc.layers.unshift(folder);
}

/** Timeline palette / Animation > New animation layer > Animation folder (creates the timeline if needed). */
export function newAnimationFolder(): Id {
  const s = getState();
  const name = nextTrackName(animationFolders(s.doc.layers).map((f) => f.name));
  const folder = createFolder(name, [], { animation: emptyTrack() });
  actions.changeDoc('New animation folder', (doc, st) => {
    if (!doc.timeline) doc.timeline = { ...DEFAULT_TIMELINE };
    insertTrack(doc, folder, st.activeLayerId);
    return folder.id;
  });
  setState({ timelineShown: true });
  return folder.id;
}

/**
 * Timeline palette / Animation > New animation cel: a new numbered cel in the current animation
 * folder, assigned to the selected frame (or the next one, if a cel already starts there).
 */
export function newAnimationCel(): Id | null {
  let s = getState();
  let folder = activeTrack(s);
  if (!folder) {
    if (animationFolders(s.doc.layers).length > 0) {
      setState({ hint: 'Select an animation folder or one of its cels' });
      return null;
    }
    newAnimationFolder();
    s = getState();
    folder = activeTrack(s)!;
  }
  const t = timelineOf(s) ?? DEFAULT_TIMELINE;
  const frame = entryAt(folder.animation, s.frame) ? s.frame + 1 : s.frame;
  if (frame > MAX_FRAMES) {
    setState({ hint: `A timeline has at most ${MAX_FRAMES} frames` });
    return null;
  }
  const cel = createRasterLayer(nextCelName(folder.children.map((c) => c.name)));
  const folderId = folder.id;
  const shown = celOf(s.doc.layers, s.activeLayerId);
  actions.changeDoc('New animation cel', (doc) => {
    const f = findLayer(doc.layers, folderId);
    if (!isAnimationFolder(f)) return;
    // Above the cel being edited, or on top.
    const at = shown?.folder.id === folderId ? f.children.findIndex((c) => c.id === shown.cel.id) : 0;
    f.children.splice(Math.max(0, at), 0, cel);
    f.expanded = true;
    doc.timeline = { ...(doc.timeline ?? t), frames: Math.max((doc.timeline ?? t).frames, frame) };
    withClipAt(f, frame, doc.timeline.frames);
    f.animation = assignAt(f.animation, frame, cel.id);
    ensureSurface(cel.id, doc.width, doc.height);
    return cel.id;
  });
  setState({ frame });
  return cel.id;
}

/** Assigns a cel (null: nothing) to a frame of a track (Timeline palette, Assign cel to frame). */
export function assignCel(folderId: Id, frame: number, celId: Id | null): void {
  actions.changeDoc(celId ? 'Assign cel to frame' : 'Assign blank to frame', (doc) => {
    const f = findLayer(doc.layers, folderId);
    if (!isAnimationFolder(f)) return;
    if (doc.timeline && frame > doc.timeline.frames) doc.timeline = { ...doc.timeline, frames: Math.min(MAX_FRAMES, frame) };
    withClipAt(f, frame, doc.timeline?.frames ?? frame);
    f.animation = assignAt(f.animation, frame, celId);
  });
  selectTrackFrame(folderId, frame);
}

/** Animation > Edit track > Delete: removes the assignment at the frame; the cel before shows on. */
export function removeAssignedCel(folderId?: Id, frame = getState().frame): void {
  const folder = folderId ? findLayer(getState().doc.layers, folderId) : activeTrack();
  if (!isAnimationFolder(folder) || !entryAt(folder.animation, frame)) {
    setState({ hint: 'No cel is assigned at this frame' });
    return;
  }
  const id = folder.id;
  actions.changeDoc('Delete assigned cel', (doc) => {
    const f = findLayer(doc.layers, id);
    if (isAnimationFolder(f)) f.animation = removeAt(f.animation, frame);
  });
  selectTrackFrame(id, frame);
}

/** Animation > Edit track > Select previous / next cel: the neighbouring assigned cel in the track. */
export function selectNeighbourCel(dir: -1 | 1): void {
  const s = getState();
  const folder = activeTrack(s);
  if (!folder) return;
  const starts = folder.animation.cels.filter((a) => a.cel !== null).map((a) => a.frame);
  const current = folder.animation.cels.findLast((a) => a.frame <= s.frame)?.frame ?? 0;
  const target = dir > 0 ? starts.find((f) => f > current) : starts.findLast((f) => f < current);
  if (target !== undefined) selectTrackFrame(folder.id, target);
}

// ------------------------------------------------------------------ clips

/** Selects a clip in the Timeline palette (`add`: Ctrl/⌘-click adds it to the selection or takes it out). */
export function selectClip(track: Id, start: number, add = false): void {
  const s = getState();
  const has = s.clipSelection.some((c) => c.track === track && c.start === start);
  if (!add) setState({ clipSelection: [{ track, start }] });
  else setState({ clipSelection: has ? s.clipSelection.filter((c) => !(c.track === track && c.start === start)) : [...s.clipSelection, { track, start }] });
}

export const clearClipSelection = () => {
  if (getState().clipSelection.length) setState({ clipSelection: [] });
};

/** The selected clips by track, as indices into each track's clips. */
function selectedByTrack(s: PaintState): { track: AnyTrack; indices: number[] }[] {
  const frames = s.doc.timeline?.frames ?? 1;
  const out = new Map<Id, { track: AnyTrack; indices: number[] }>();
  for (const ref of s.clipSelection) {
    const track = trackById(s.doc, ref.track);
    if (!track) continue;
    const i = contentOf(track, frames).clips.findIndex((c) => c.start === ref.start);
    if (i < 0) continue;
    const entry = out.get(track.id) ?? { track, indices: [] };
    entry.indices.push(i);
    out.set(track.id, entry);
  }
  return [...out.values()];
}

/** The clip a command works on: a selected clip of the current track, else the one at the current frame. */
function commandClip(s: PaintState): { track: AnyTrack; index: number } | null {
  const id = currentTrackId(s);
  const frames = s.doc.timeline?.frames ?? 1;
  const selected = selectedByTrack(s);
  const own = selected.find((x) => x.track.id === id) ?? selected[0];
  if (own) return { track: own.track, index: Math.min(...own.indices) };
  const track = id ? trackById(s.doc, id) : null;
  if (!track) return null;
  const index = clipIndexAt(contentOf(track, frames).clips, s.frame);
  return index >= 0 ? { track, index } : null;
}

/**
 * Changes tracks in one undo step: `op` gets each track's content (clips made explicit) and returns
 * the new content, or null to leave it.
 */
function editTracks(label: string, ids: Id[], op: (t: Content, id: Id, timeline: Timeline) => Content | null, key?: string): boolean {
  const s = getState();
  const t = s.doc.timeline;
  if (!t) return false;
  const results = new Map<Id, Content>();
  for (const id of ids) {
    const track = trackById(s.doc, id);
    if (!track) continue;
    const next = op(contentOf(track, t.frames), id, t);
    if (next) results.set(id, next);
  }
  if (results.size === 0) return false;
  actions.changeDoc(
    label,
    (doc) => {
      for (const [id, content] of results) storeContent(doc, id, content);
    },
    key ? { key } : {},
  );
  return true;
}

const NO_CLIP = 'Select a track with clips, and a frame or clip on it, in the Timeline palette';

/**
 * Animation > Edit track > Set as first displayed frame: on a frame without a clip, a clip starts
 * there (after a clip: showing its last cel; before the first one: that clip starts there).
 */
export function setFirstDisplayedFrame(): void {
  const s = getState();
  const id = currentTrackId(s);
  if (!id || !editTracks('Set as first displayed frame', [id], (t, _id, tl) => setFirstDisplayed(t, s.frame, tl.frames, tl.fps)))
    setState({ hint: 'Set as first displayed frame needs a frame without a clip, on a track with clips' });
  else setState({ clipSelection: [] });
}

/** Animation > Edit track > Set as last displayed frame: the clip ends before the selected frame. */
export function setLastDisplayedFrame(): void {
  const s = getState();
  const id = currentTrackId(s);
  if (!id || !editTracks('Set as last displayed frame', [id], (t) => setLastDisplayed(t, s.frame))) setState({ hint: NO_CLIP });
  else setState({ clipSelection: [] });
}

/** Animation > Edit track > Split clip: at the current frame of the current track. */
export function splitClipAtFrame(): void {
  const s = getState();
  const id = currentTrackId(s);
  if (!id || !editTracks('Split clip', [id], (t, _id, tl) => splitClip(t, s.frame, tl.fps))) setState({ hint: 'Select a frame inside a clip (not its first frame) to split it there' });
  else setState({ clipSelection: [{ track: id, start: s.frame }] });
}

/** Animation > Edit track > Merge clips: the selected clips of a track (one selected: with the next). */
export function mergeSelectedClips(): void {
  const s = getState();
  const sel = selectedByTrack(s);
  const target = sel[0] ?? (() => {
    const c = commandClip(s);
    return c ? { track: c.track, indices: [c.index] } : null;
  })();
  if (!target || !editTracks('Merge clips', [target.track.id], (t) => mergeClips(t, target.indices))) {
    setState({ hint: 'Select two clips of one track (or a clip followed by another) to merge them' });
    return;
  }
  const start = contentOf(target.track, s.doc.timeline?.frames ?? 1).clips[Math.min(...target.indices)]?.start;
  setState({ clipSelection: start !== undefined ? [{ track: target.track.id, start }] : [] });
}

/** Animation > Edit track > Delete clip: the selected clips (or the one at the current frame) and what lies in them. */
export function deleteSelectedClips(): void {
  const s = getState();
  let sel = selectedByTrack(s);
  if (sel.length === 0) {
    const c = commandClip(s);
    sel = c ? [{ track: c.track, indices: [c.index] }] : [];
  }
  if (sel.length === 0 || !editTracks('Delete clip', sel.map((x) => x.track.id), (t, id) => deleteClips(t, sel.find((x) => x.track.id === id)!.indices))) {
    setState({ hint: NO_CLIP });
    return;
  }
  setState({ clipSelection: [] });
}

/** What Copy (clip) put on the clipboard: the clip and the names of its cels (for other animation folders). */
let clipboard: { track: Id; copy: ClipCopy<Timed>; names: Map<Id, string>; sound: boolean } | null = null;

export const hasCopiedClip = () => clipboard !== null;

/** Copy (clip): the selected clip, or the one at the current frame. */
export function copySelectedClip(): void {
  const s = getState();
  const c = commandClip(s);
  const copy = c ? copyClipContent(contentOf(c.track, s.doc.timeline?.frames ?? 1), c.index) : null;
  if (!c || !copy) {
    setState({ hint: NO_CLIP });
    return;
  }
  const names = new Map<Id, string>();
  if (c.track.layer.kind === 'folder') for (const cel of c.track.layer.children) names.set(cel.id, cel.name);
  clipboard = { track: c.track.id, copy, names, sound: c.track.sound };
  setState({ hint: 'Clip copied: select a frame and use Paste clip' });
}

/**
 * Paste (clip) at the current frame of the current track. In another animation folder, its cels
 * of the same names are assigned; missing ones are made (empty), like Create all supported cels.
 */
export function pasteCopiedClip(): void {
  const s = getState();
  const id = currentTrackId(s);
  const track = id ? trackById(s.doc, id) : null;
  if (!clipboard || !track) {
    setState({ hint: clipboard ? NO_CLIP : 'Copy a clip first' });
    return;
  }
  const { copy, names } = clipboard;
  const sameTrack = clipboard.track === track.id;
  if (Boolean(copy.cels) !== isAnimationFolder(track.layer) || clipboard.sound !== track.sound) {
    setState({ hint: 'Clips can only be pasted on tracks of the same kind' });
    return;
  }
  const frame = s.frame;
  actions.changeDoc('Paste clip', (doc) => {
    const t = trackById(doc, track.id);
    if (!t || !doc.timeline) return;
    const l = t.layer;
    let pasted = copy;
    if (l && isAnimationFolder(l) && copy.cels && !sameTrack) {
      // Cels by name; missing ones are made.
      const byName = new Map(l.children.map((c) => [c.name, c.id]));
      const map = new Map<Id, Id>();
      for (const a of copy.cels) {
        if (a.cel === null || map.has(a.cel)) continue;
        const name = names.get(a.cel) ?? nextCelName(l.children.map((c) => c.name));
        let id = byName.get(name);
        if (!id) {
          const cel = createRasterLayer(name);
          l.children.unshift(cel);
          ensureSurface(cel.id, doc.width, doc.height);
          byName.set(name, cel.id);
          id = cel.id;
        }
        map.set(a.cel, id);
      }
      pasted = { ...copy, cels: copy.cels.map((a) => ({ ...a, cel: a.cel === null ? null : (map.get(a.cel) ?? null) })) };
    }
    storeContent(doc, t.id, pasteClipContent(contentOf(t, doc.timeline.frames), pasted, frame, doc.timeline.fps));
  });
  setState({ clipSelection: [{ track: track.id, start: frame }] });
}

/** Dragging selected clips: the move every selected track allows nearest to `delta`. */
export function clipMoveDelta(delta: number, s: PaintState = getState()): number {
  const frames = s.doc.timeline?.frames ?? 1;
  return nearestMove(
    selectedByTrack(s).map((x) => ({ clips: contentOf(x.track, frames).clips, indices: x.indices })),
    delta,
  );
}

/** Moves the selected clips (with their cels and keys) by `delta` frames. */
export function moveSelectedClips(delta: number): void {
  const s = getState();
  const d = clipMoveDelta(delta, s);
  if (!d) return;
  const sel = selectedByTrack(s);
  editTracks('Move clip', sel.map((x) => x.track.id), (t, id) => moveClips(t, sel.find((x) => x.track.id === id)!.indices, d));
  setState({ clipSelection: s.clipSelection.map((c) => ({ ...c, start: c.start + d })) });
}

/** What a track looks like with a clip's edge dragged to `frame` (Alt: time stretch), for previews and commits. */
export function draggedEdge(t: Content, index: number, edge: ClipEdge, frame: number, stretch: boolean, fps: number): Content {
  return stretch ? stretchClip(t, index, edge, frame, fps) : trimClip(t, index, edge, frame, fps);
}

/** Trim (or with Alt, stretch) a clip by dragging its edge to `frame`. */
export function dragClipEdge(trackId: Id, start: number, edge: ClipEdge, frame: number, stretch: boolean): void {
  let newStart = start;
  const ok = editTracks(stretch ? 'Stretch clip' : 'Trim clip', [trackId], (t, _id, tl) => {
    const i = t.clips.findIndex((c) => c.start === start);
    if (i < 0) return null;
    const next = draggedEdge(t, i, edge, frame, stretch, tl.fps);
    if (next === t) return null;
    newStart = edge === 'start' ? (next.clips.find((c) => c.end === t.clips[i].end)?.start ?? start) : start;
    return next;
  });
  if (ok) setState({ clipSelection: [{ track: trackId, start: newStart }] });
}

/** Makes sure a clip shows a frame of a track before something is assigned there. */
function withClipAt(l: Layer, frame: number, frames: number): void {
  if (!l.clips) return;
  setTrackContent(l, ensureClipAt(trackContent(l, frames), frame, frames));
}

/** The content of a track for the Timeline palette (previews of dragged clips). */
export function trackContentOf(id: Id, s: PaintState = getState()): Content | null {
  const t = trackById(s.doc, id);
  return t ? contentOf(t, s.doc.timeline?.frames ?? 1) : null;
}

export type { ClipRef };

// ------------------------------------------------------------------ keyframes

/** The track whose keyframes are edited: the current track, when its keyframes are on (2D camera folders: always). */
export function keyTrack(s: PaintState = getState()): Layer | null {
  const t = currentTrack(s);
  // Audio layers have volume keyframes, set in the Tool Settings palette.
  return t && s.doc.timeline && keysOn(t) && t.kind !== 'audio' ? t : null;
}

/** A track's placement at a frame: from its keyframes, else as it is. */
export function placementNow(track: Layer, frame = getState().frame, s: PaintState = getState()): Placement {
  const rest = restOf(s.doc);
  return placementAt(track.keys?.frames ?? [], frame, rest) ?? rest;
}

/** Animation > Edit track > Enable keyframes on this layer (the keyframes stay when turned off). */
export function toggleKeyframes(): void {
  const s = getState();
  const track = currentTrack(s);
  if (!track || !s.doc.timeline) {
    setState({ hint: 'Select a layer or animation folder on the timeline' });
    return;
  }
  if (isCameraFolder(track) || track.kind === 'audio') {
    setState({ hint: `Keyframes are always on for ${track.kind === 'audio' ? 'audio layers' : '2D camera folders'}` });
    return;
  }
  if (track.kind === 'correction') {
    setState({ hint: 'Correction layers have no keyframes' });
    return;
  }
  const on = !track.keys?.enabled;
  actions.changeDoc(on ? 'Enable keyframes' : 'Disable keyframes', (doc) => {
    const l = findLayer(doc.layers, track.id);
    if (l) l.keys = { enabled: on, frames: l.keys?.frames ?? [] };
  });
  if (!on) setState({ keySelection: [], editKeyed: false });
}

/** What a layer mask's keyframes record: its placement within the layer (no opacity). */
export const MASK_CHANNELS: PlacementChannel[] = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'pivotX', 'pivotY'];

/**
 * The track whose layer mask the Object tool places: the current track's mask is selected (Layer
 * palette: its thumbnail; Timeline palette: the Mask row) and the track's keyframes are on.
 */
export function maskKeyed(s: PaintState = getState()): Layer | null {
  if (!s.maskEditing || !s.doc.timeline) return null;
  const t = currentTrack(s);
  return t && t.id === s.activeLayerId && t.mask && t.keys?.enabled && !isCameraFolder(t) ? t : null;
}

/** The keyframes edited now: the current track's, or (mask selected) its mask's. */
export function keyTrackId(s: PaintState = getState()): Id | null {
  const m = maskKeyed(s);
  return m ? maskTrackId(m.id) : currentTrackId(s);
}

/** A layer mask's placement at a frame (within the layer). */
export function maskPlacementNow(layer: Layer, frame = getState().frame, s: PaintState = getState()): Placement {
  const rest = restOf(s.doc);
  return placementAt(layer.mask?.keys ?? [], frame, rest) ?? rest;
}

/** Timeline palette: the Mask row of a track selects its mask (and the frame). */
export function selectMaskFrame(trackId: Id, frame: number): void {
  const s = getState();
  if (!findLayer(s.doc.layers, trackId)?.mask) return;
  setState({ frame: clampFrame(frame, timelineOf(s)), activeLayerId: trackId, maskEditing: true, ...(trackId !== s.activeLayerId ? { selectedObjects: [] } : {}) });
}

/**
 * Records a placement at `frame` of a track (or of its mask: see maskTrackId): the settings of the
 * given properties (all when left out; X records the position) go into the keyframe there, or a
 * new one (a clip is made there if needed; `enable` turns keyframes on).
 */
export function setKeyframe(trackId: Id, frame: number, p: Placement, label = 'Keyframe', key?: string, enable = false, channels: readonly PlacementChannel[] = PLACEMENT_CHANNELS): void {
  const s = getState();
  const owner = maskOwner(trackId);
  const recorded = withSettings(channels).filter((c) => !owner || MASK_CHANNELS.includes(c));
  if (recorded.length === 0) return;
  const interp = s.keyInterp;
  const values = Object.fromEntries(recorded.map((c) => [c, p[c]]));
  actions.changeDoc(
    label,
    (doc) => {
      const l = findLayer(doc.layers, owner ?? trackId);
      if (!l || !doc.timeline) return;
      if (l.clips) setTrackContent(l, ensureClipAt(trackContent(l, doc.timeline.frames), frame, doc.timeline.frames, true));
      if (owner) {
        if (l.mask) l.mask = { ...l.mask, keys: recordKey(l.mask.keys ?? [], frame, values, interp) };
        return;
      }
      if (!l.keys) l.keys = { enabled: true, frames: [] };
      l.keys = { enabled: l.keys.enabled || enable, frames: recordKey(l.keys.frames, frame, values, interp) };
    },
    key ? { key } : {},
  );
}

/** Timeline palette / Animation > Edit track > Add keyframe: the current placement (audio: volume) at the current frame. */
export function addKeyframe(): void {
  const s = getState();
  const sound = activeAudio(s);
  if (sound) {
    const volume = volumeAt({ volume: sound.volume, keys: sound.keys.frames }, s.frame);
    actions.changeDoc('Add keyframe', (doc) => {
      const t = findLayer(doc.layers, sound.id);
      if (t?.kind === 'audio') t.keys = { ...t.keys, frames: setVolumeKey(t.keys.frames, s.frame, volume, s.keyInterp) };
    });
    setState({ keySelection: [{ track: sound.id, frame: s.frame }] });
    return;
  }
  const masked = maskKeyed(s);
  if (masked) {
    const id = maskTrackId(masked.id);
    setKeyframe(id, s.frame, maskPlacementNow(masked, s.frame, s), 'Add keyframe', undefined, false, MASK_CHANNELS);
    setState({ keySelection: [{ track: id, frame: s.frame }] });
    return;
  }
  const track = currentTrack(s);
  if (!track || !s.doc.timeline || track.kind === 'correction') {
    setState({ hint: 'Select a layer or animation folder on the timeline' });
    return;
  }
  // Adding a keyframe turns keyframes on.
  setKeyframe(track.id, s.frame, placementNow(track, s.frame, s), 'Add keyframe', undefined, true);
  setState({ keySelection: [{ track: track.id, frame: s.frame }] });
}

/** The keyframes of a track or a layer mask (a document copy's, to change them), as a list and a way to replace it. */
function keysOfTrack(doc: PaintDocument, id: Id): { list: Keyframe[]; set: (list: Keyframe[]) => void } | null {
  const owner = maskOwner(id);
  if (owner) {
    const l = findLayer(doc.layers, owner);
    const mask = l?.mask;
    return l && mask ? { list: mask.keys ?? [], set: (list) => (l.mask = { ...mask, keys: list }) } : null;
  }
  const l = findLayer(doc.layers, id);
  const keys = l?.keys;
  return l && keys ? { list: keys.frames, set: (list) => (l.keys = { ...keys, frames: list }) } : null;
}

/** Selected keyframes grouped by track and property row (`channels` undefined: whole keyframes). */
interface KeyTarget {
  track: Id;
  frames: number[];
  channels?: Channel[];
}

/** The selected keyframes, or the current track's keyframe at the current frame. */
function keyTargets(s: PaintState): KeyTarget[] {
  const out = new Map<string, KeyTarget>();
  // A whole keyframe (or its Transform) selected covers its rows' selections at that frame.
  const has = (track: Id, frame: number, group?: ChannelGroup) => s.keySelection.some((k) => k.track === track && k.frame === frame && k.group === group);
  const covered = (k: KeyRef) => k.group !== undefined && (has(k.track, k.frame) || (TRANSFORM_GROUPS.includes(k.group) && has(k.track, k.frame, 'transform')));
  for (const k of s.keySelection) {
    if (covered(k)) continue;
    const id = `${k.track}|${k.group ?? ''}`;
    const t = out.get(id) ?? { track: k.track, frames: [], ...(k.group ? { channels: GROUPS[k.group].channels } : {}) };
    t.frames.push(k.frame);
    out.set(id, t);
  }
  if (out.size === 0) {
    const id = keyTrackId(s);
    if (id && keysOfTrack(s.doc, id)?.list.some((k) => k.frame === s.frame)) return [{ track: id, frames: [s.frame] }];
  }
  return [...out.values()];
}

/** Delete keyframe: the selected keyframes (on a property row: that property only), or the one at the current frame. */
export function deleteKeyframes(): void {
  const s = getState();
  if (s.graphEditor && s.graphSelection.length) {
    deleteCurvePoints();
    return;
  }
  const targets = keyTargets(s);
  if (targets.length === 0) {
    setState({ hint: 'Select a keyframe in the Timeline palette' });
    return;
  }
  actions.changeDoc('Delete keyframe', (doc) => {
    for (const t of targets) {
      const k = keysOfTrack(doc, t.track);
      if (!k) continue;
      let list = k.list;
      for (const f of t.frames) list = removeChannels(list, f, t.channels);
      k.set(list);
    }
  });
  setState({ keySelection: [] });
}

/** Animation > Edit track > Delete all keyframes of the current track. */
export function deleteAllKeyframes(): void {
  const s = getState();
  const id = keyTrackId(s);
  if (!id || !keysOfTrack(s.doc, id)?.list.length) {
    setState({ hint: 'This track has no keyframes' });
    return;
  }
  actions.changeDoc('Delete all keyframes', (doc) => keysOfTrack(doc, id)?.set([]));
  setState({ keySelection: [] });
}

/** Keyframe interpolation (Timeline palette) / Switch keyframe to … interpolation: for new keyframes and the selected ones. */
export function setKeyInterp(interp: Interp): void {
  const s = getState();
  setState({ keyInterp: interp });
  if (s.graphEditor && s.graphSelection.length) {
    editCurvePoints(`Switch keyframe to ${interp} interpolation`, (keys, points) => points.reduce((out, p) => setInterp(out, [p.frame], interp, [p.ch]), keys));
    return;
  }
  const targets = keyTargets(s);
  if (targets.length === 0) return;
  actions.changeDoc(`Switch keyframe to ${interp} interpolation`, (doc) => {
    for (const t of targets) {
      const k = keysOfTrack(doc, t.track);
      k?.set(setInterp(k.list, t.frames, interp, t.channels));
    }
  });
}

/** Selects a keyframe (`add`: Ctrl/⌘-click adds it or takes it out; `group`: on a property row) and goes to its frame. */
export function selectKeyframe(track: Id, frame: number, add = false, group?: ChannelGroup): void {
  const s = getState();
  const same = (k: KeyRef) => k.track === track && k.frame === frame && k.group === group;
  const ref: KeyRef = { track, frame, ...(group ? { group } : {}) };
  const keySelection = !add ? [ref] : s.keySelection.some(same) ? s.keySelection.filter((k) => !same(k)) : [...s.keySelection, ref];
  setState({ keySelection, clipSelection: [] });
  const owner = maskOwner(track);
  if (owner) selectMaskFrame(owner, frame);
  else selectTrackFrame(track, frame);
}

/** Selects the keyframes inside a rectangle dragged on the Timeline palette (Shift: adds, Ctrl/⌘: takes out). */
export function selectKeyframes(refs: KeyRef[], mode: 'set' | 'add' | 'remove' = 'set'): void {
  const s = getState();
  const id = (k: KeyRef) => `${k.track}|${k.frame}|${k.group ?? ''}`;
  const these = new Set(refs.map(id));
  const rest = s.keySelection.filter((k) => !these.has(id(k)));
  setState({ keySelection: mode === 'set' ? refs : mode === 'add' ? [...rest, ...refs] : rest, clipSelection: [] });
}

export const clearKeySelection = () => {
  if (getState().keySelection.length) setState({ keySelection: [] });
};

/** Drags the selected keyframes by `delta` frames (Alt: copies them; on a property row: that property only). */
export function moveSelectedKeys(delta: number, copy = false): void {
  const s = getState();
  if (!delta || s.keySelection.length === 0) return;
  const targets = keyTargets(s);
  actions.changeDoc(copy ? 'Duplicate keyframe' : 'Move keyframe', (doc) => {
    for (const t of targets) {
      const k = keysOfTrack(doc, t.track);
      if (!k || !doc.timeline) continue;
      k.set(moveKeys(k.list, t.frames, delta, copy, t.channels));
      // Keyframes need a clip where they land (audio layers: only where a sound plays).
      const l = findLayer(doc.layers, t.track);
      if (l?.clips && l.kind !== 'audio') for (const f of t.frames) setTrackContent(l, ensureClipAt(trackContent(l, doc.timeline.frames), Math.max(1, f + delta), doc.timeline.frames, true));
    }
  });
  setState({ keySelection: s.keySelection.map((k) => ({ ...k, frame: Math.max(1, k.frame + delta) })) });
}

/** A track's keyframes as they would be after dragging the selected ones (Timeline palette preview). */
export function movedKeys(id: Id, delta: number, copy: boolean, s: PaintState = getState()): Keyframe[] | null {
  const list = keysOfTrack(s.doc, id)?.list;
  if (!list) return null;
  let out = list;
  for (const t of keyTargets(s)) if (t.track === id) out = moveKeys(out, t.frames, delta, copy, t.channels);
  return out;
}

/** Timeline palette: Details (+) shows a track's property rows (Transform, Opacity). */
export function toggleKeyDetails(id: Id): void {
  setState((s) => ({ keyDetails: s.keyDetails.includes(id) ? s.keyDetails.filter((x) => x !== id) : [...s.keyDetails, id] }));
}

/** Timeline palette: > on a track's Transform row shows Position, Scale ratio, Rotate and Center of rotation. */
export function toggleTransformDetails(id: Id): void {
  setState((s) => ({ transformDetails: s.transformDetails.includes(id) ? s.transformDetails.filter((x) => x !== id) : [...s.transformDetails, id] }));
}

const NO_KEYS: Keyframe[] = [];

/** The keyframes of a track (for the Timeline palette and the Graph Editor). */
export function trackKeys(id: Id, s: PaintState = getState()): Keyframe[] {
  return keysOfTrack(s.doc, id)?.list ?? NO_KEYS;
}

/** Changes a track's keyframes (Graph Editor edits), one undo step per `key`. */
export function editTrackKeys(id: Id, fn: (keys: Keyframe[]) => Keyframe[], label: string, key?: string): void {
  actions.changeDoc(
    label,
    (doc) => {
      const k = keysOfTrack(doc, id);
      if (k) k.set(fn(k.list));
    },
    key ? { key } : {},
  );
}

// ------------------------------------------------------------------ Graph Editor

/** Timeline palette / Animation > Animation curve > Graph Editor. */
export function toggleGraphEditor(): void {
  setState((s) => ({ graphEditor: !s.graphEditor, graphSelection: [] }));
}

const sameRef = (a: CurveRef, b: CurveRef) => a.track === b.track && a.frame === b.frame && a.ch === b.ch;

/** Selects points of curves (`add`: to the selection; `toggle`: in or out; `remove`: out). */
export function selectCurvePoints(refs: CurveRef[], mode: 'set' | 'add' | 'toggle' | 'remove' = 'set'): void {
  const cur = getState().graphSelection;
  const rest = cur.filter((c) => !refs.some((r) => sameRef(r, c)));
  let next: CurveRef[];
  if (mode === 'set') next = refs;
  else if (mode === 'add') next = [...rest, ...refs];
  else if (mode === 'remove') next = rest;
  else next = [...rest, ...refs.filter((r) => !cur.some((c) => sameRef(r, c)))];
  setState({ graphSelection: next });
}

/** Changes the selected points' curves, track by track, as one undo step. */
function editCurvePoints(label: string, fn: (keys: Keyframe[], points: CurvePoint[]) => Keyframe[]): void {
  const s = getState();
  const tracks = [...new Set(s.graphSelection.map((r) => r.track))];
  actions.changeDoc(label, (doc) => {
    for (const id of tracks) {
      const k = keysOfTrack(doc, id);
      if (k) k.set(fn(k.list, s.graphSelection.filter((r) => r.track === id)));
    }
  });
}

/** Delete keyframe in the Graph Editor: the selected points (other curves keep their keyframes). */
export function deleteCurvePoints(): void {
  if (getState().graphSelection.length === 0) return;
  editCurvePoints('Delete keyframe', (keys, points) => points.reduce((out, p) => removeChannels(out, p.frame, [p.ch]), keys));
  setState({ graphSelection: [] });
}

/** Animation > Animation curve > Unpair handles: the selected points' two slope handles move separately (again: reset). */
export function toggleUnpairHandles(): void {
  if (getState().graphSelection.length === 0) {
    setState({ hint: 'Select a keyframe in the Graph Editor' });
    return;
  }
  editCurvePoints('Unpair handles', (keys, points) => points.reduce((out, p) => toggleUnpaired(out, p.frame, p.ch), keys));
}

/** Animation > Edit track > Edit layers with active keyframes: the current track is drawn as it is and can be drawn on. */
export function toggleEditKeyed(): void {
  const s = getState();
  if (!s.editKeyed && !(currentTrack(s)?.keys?.enabled)) {
    setState({ hint: 'Keyframes are not on for this track' });
    return;
  }
  setState({ editKeyed: !s.editKeyed });
}

/** Object tool > 2D camera: Show camera's field of view (on) or field guides (off). */
export const toggleCameraView = () => setState((s) => ({ cameraView: !s.cameraView }));

/** Animation > New animation layer > 2D camera folder: its keyframes move a camera over the layers put in it. */
export function newCameraFolder(name = '2D camera folder', output?: { w: number; h: number }): Id {
  const folder = createFolder(name, [], { camera: true, blend: 'normal', keys: { enabled: true, frames: [] } });
  actions.changeDoc('New 2D camera folder', (doc, st) => {
    if (!doc.timeline) doc.timeline = { ...DEFAULT_TIMELINE };
    // The output frame: added when the canvas has none; resized (about its middle) unless another camera folder uses it.
    if (output && !flatten(doc.layers).some(isCameraFolder)) doc.outputFrame = resizeOutputFrame(doc.outputFrame, output.w, output.h, doc.width, doc.height);
    // Above the current track, never inside an animation folder.
    const anchor = tracksOf(doc.layers, st.activeLayerId)[0]?.id ?? st.activeLayerId;
    const loc = locate(doc.layers, anchor);
    if (loc) loc.siblings.splice(loc.index, 0, folder);
    else doc.layers.unshift(folder);
    return folder.id;
  });
  setState({ timelineShown: true });
  return folder.id;
}

// ------------------------------------------------------------------ playback

let raf = 0;

/** Animation > Play/Stop: plays the timeline at its frame rate (Loop play starts again at the end). */
export function togglePlay(): void {
  if (getState().playing) stop();
  else play();
}

export function play(): void {
  const t = timelineOf();
  if (!t?.enabled || getState().playing) return;
  // Playback covers the start … end frame; from the start when outside or at the end.
  const first = startOf(t);
  const last0 = endOf(t);
  if (getState().frame >= last0 || getState().frame < first) setFrame(first, false);
  setState({ playing: true });
  startSound(soundMix(getState().doc), getState().frame, last0, t.fps);
  let last = performance.now();
  let carry = 0;
  const tick = (now: number) => {
    const s = getState();
    const tl = timelineOf(s);
    if (!s.playing || !tl?.enabled) return stop();
    carry += now - last;
    last = now;
    const step = 1000 / tl.fps;
    const start = startOf(tl);
    const end = endOf(tl);
    let frame = s.frame;
    while (carry >= step) {
      carry -= step;
      if (frame < end) frame++;
      else if (s.loop) {
        frame = start;
        // The sound starts again with the animation.
        startSound(soundMix(s.doc), start, end, tl.fps);
      } else return stop();
    }
    if (frame !== s.frame) setState({ frame });
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

export function stop(): void {
  cancelAnimationFrame(raf);
  stopSound();
  if (!getState().playing) return;
  setState({ playing: false });
  // The cel shown where playback stopped becomes the layer being edited.
  setFrame(getState().frame);
}

export const toggleLoop = () => setState((s) => ({ loop: !s.loop }));

/** Window > Timeline. */
export const toggleTimelinePalette = () => setState((s) => ({ timelineShown: !s.timelineShown }));

// ------------------------------------------------------------------ onion skin

export const toggleOnionSkin = () => setState((s) => ({ onionSkin: !s.onionSkin }));

export function setOnion(patch: Partial<OnionSkin>): void {
  setState((s) => ({ onion: { ...s.onion, ...patch } }));
}
