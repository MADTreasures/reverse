/**
 * Animation (Timeline palette and Animation menu): the timeline, animation folders and cels,
 * assigning cels to frames, moving between frames, playback and onion skin.
 */
import { animationFolders, celOf, isAnimationFolder, isCameraFolder, keysOn, setTrackContent, trackContent, trackFolderOf, tracksOf, type AnimationFolder } from '../model/animation';
import { createFolder, createRasterLayer, findLayer, flatten, locate } from '../model/layers';
import type { Id, Layer, PaintDocument } from '../model/types';
import { assignAt, celAt, DEFAULT_TIMELINE, emptyTrack, entryAt, MAX_FRAMES, nextCelName, nextTrackName, removeAt, type OnionSkin, type Timeline } from '../paint/animation';
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
  type TrackContent,
} from '../paint/clips';
import { moveKeys, placementAt, placementOf, restPlacement, setKey, type Interp, type Keyframe, type Placement } from '../paint/keyframes';
import { ensureSurface } from '../engine/surfaces';
import * as actions from './actions';
import { getState, setState, type ClipRef, type PaintState } from './store';

/** A track's content with its keyframes. */
type Content = TrackContent<Keyframe>;

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
export function setTimeline(patch: Partial<Timeline>, label = 'Timeline settings'): void {
  actions.changeDoc(label, (doc) => {
    doc.timeline = { ...(doc.timeline ?? DEFAULT_TIMELINE), ...patch };
    doc.timeline.frames = Math.max(1, Math.min(MAX_FRAMES, Math.round(doc.timeline.frames)));
  });
  const t = timelineOf();
  if (t && getState().frame > t.frames) setFrame(t.frames);
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
    if (!l.clips && !isAnimationFolder(l)) continue;
    // A track that shows over the whole timeline still does afterwards.
    const whole = !l.clips;
    const t = trackContent(l, frames);
    setTrackContent(l, op(whole ? { ...t, clips: [{ start: 1, end: MAX_FRAMES }] } : t));
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
function selectedByTrack(s: PaintState): { layer: Layer; indices: number[] }[] {
  const frames = s.doc.timeline?.frames ?? 1;
  const out = new Map<Id, { layer: Layer; indices: number[] }>();
  for (const ref of s.clipSelection) {
    const layer = findLayer(s.doc.layers, ref.track);
    if (!layer) continue;
    const i = trackContent(layer, frames).clips.findIndex((c) => c.start === ref.start);
    if (i < 0) continue;
    const entry = out.get(layer.id) ?? { layer, indices: [] };
    entry.indices.push(i);
    out.set(layer.id, entry);
  }
  return [...out.values()];
}

/** The clip a command works on: a selected clip of the current track, else the one at the current frame. */
function commandClip(s: PaintState): { layer: Layer; index: number } | null {
  const track = currentTrack(s);
  const frames = s.doc.timeline?.frames ?? 1;
  const selected = selectedByTrack(s);
  const own = selected.find((x) => x.layer.id === track?.id) ?? selected[0];
  if (own) return { layer: own.layer, index: Math.min(...own.indices) };
  if (!track) return null;
  const index = clipIndexAt(trackContent(track, frames).clips, s.frame);
  return index >= 0 ? { layer: track, index } : null;
}

/**
 * Changes tracks in one undo step: `op` gets each track's content (clips made explicit) and returns
 * the new content, or null to leave it.
 */
function editTracks(label: string, ids: Id[], op: (t: Content, layer: Layer, timeline: Timeline) => Content | null, key?: string): boolean {
  const s = getState();
  const t = s.doc.timeline;
  if (!t) return false;
  const results = new Map<Id, Content>();
  for (const id of ids) {
    const layer = findLayer(s.doc.layers, id);
    if (!layer) continue;
    const next = op(trackContent(layer, t.frames), layer, t);
    if (next) results.set(id, next);
  }
  if (results.size === 0) return false;
  actions.changeDoc(
    label,
    (doc) => {
      for (const [id, content] of results) {
        const l = findLayer(doc.layers, id);
        if (l) setTrackContent(l, content);
      }
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
  const track = currentTrack(s);
  if (!track || !editTracks('Set as first displayed frame', [track.id], (t, _l, tl) => setFirstDisplayed(t, s.frame, tl.frames, tl.fps)))
    setState({ hint: 'Set as first displayed frame needs a frame without a clip, on a track with clips' });
  else setState({ clipSelection: [] });
}

/** Animation > Edit track > Set as last displayed frame: the clip ends before the selected frame. */
export function setLastDisplayedFrame(): void {
  const s = getState();
  const track = currentTrack(s);
  if (!track || !editTracks('Set as last displayed frame', [track.id], (t) => setLastDisplayed(t, s.frame))) setState({ hint: NO_CLIP });
  else setState({ clipSelection: [] });
}

/** Animation > Edit track > Split clip: at the current frame of the current track. */
export function splitClipAtFrame(): void {
  const s = getState();
  const track = currentTrack(s);
  if (!track || !editTracks('Split clip', [track.id], (t, _l, tl) => splitClip(t, s.frame, tl.fps))) setState({ hint: 'Select a frame inside a clip (not its first frame) to split it there' });
  else setState({ clipSelection: [{ track: track.id, start: s.frame }] });
}

/** Animation > Edit track > Merge clips: the selected clips of a track (one selected: with the next). */
export function mergeSelectedClips(): void {
  const s = getState();
  const sel = selectedByTrack(s);
  const target = sel[0] ?? (() => {
    const c = commandClip(s);
    return c ? { layer: c.layer, indices: [c.index] } : null;
  })();
  if (!target || !editTracks('Merge clips', [target.layer.id], (t) => mergeClips(t, target.indices))) {
    setState({ hint: 'Select two clips of one track (or a clip followed by another) to merge them' });
    return;
  }
  const start = trackContent(target.layer, s.doc.timeline?.frames ?? 1).clips[Math.min(...target.indices)]?.start;
  setState({ clipSelection: start !== undefined ? [{ track: target.layer.id, start }] : [] });
}

/** Animation > Edit track > Delete clip: the selected clips (or the one at the current frame) and what lies in them. */
export function deleteSelectedClips(): void {
  const s = getState();
  let sel = selectedByTrack(s);
  if (sel.length === 0) {
    const c = commandClip(s);
    sel = c ? [{ layer: c.layer, indices: [c.index] }] : [];
  }
  if (sel.length === 0 || !editTracks('Delete clip', sel.map((x) => x.layer.id), (t, layer) => deleteClips(t, sel.find((x) => x.layer.id === layer.id)!.indices))) {
    setState({ hint: NO_CLIP });
    return;
  }
  setState({ clipSelection: [] });
}

/** What Copy (clip) put on the clipboard: the clip and the names of its cels (for other animation folders). */
let clipboard: { track: Id; copy: ClipCopy<Keyframe>; names: Map<Id, string> } | null = null;

export const hasCopiedClip = () => clipboard !== null;

/** Copy (clip): the selected clip, or the one at the current frame. */
export function copySelectedClip(): void {
  const s = getState();
  const c = commandClip(s);
  const copy = c ? copyClipContent(trackContent(c.layer, s.doc.timeline?.frames ?? 1), c.index) : null;
  if (!c || !copy) {
    setState({ hint: NO_CLIP });
    return;
  }
  const names = new Map<Id, string>();
  if (c.layer.kind === 'folder') for (const cel of c.layer.children) names.set(cel.id, cel.name);
  clipboard = { track: c.layer.id, copy, names };
  setState({ hint: 'Clip copied: select a frame and use Paste clip' });
}

/**
 * Paste (clip) at the current frame of the current track. In another animation folder, its cels
 * of the same names are assigned; missing ones are made (empty), like Create all supported cels.
 */
export function pasteCopiedClip(): void {
  const s = getState();
  const track = currentTrack(s);
  if (!clipboard || !track) {
    setState({ hint: clipboard ? NO_CLIP : 'Copy a clip first' });
    return;
  }
  const { copy, names } = clipboard;
  const sameTrack = clipboard.track === track.id;
  if (Boolean(copy.cels) !== isAnimationFolder(track)) {
    setState({ hint: 'Clips can only be pasted on tracks of the same kind' });
    return;
  }
  const frame = s.frame;
  actions.changeDoc('Paste clip', (doc) => {
    const l = findLayer(doc.layers, track.id);
    if (!l || !doc.timeline) return;
    let pasted = copy;
    if (isAnimationFolder(l) && copy.cels && !sameTrack) {
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
    setTrackContent(l, pasteClipContent(trackContent(l, doc.timeline.frames), pasted, frame, doc.timeline.fps));
  });
  setState({ clipSelection: [{ track: track.id, start: frame }] });
}

/** Dragging selected clips: the move every selected track allows nearest to `delta`. */
export function clipMoveDelta(delta: number, s: PaintState = getState()): number {
  const frames = s.doc.timeline?.frames ?? 1;
  return nearestMove(
    selectedByTrack(s).map((x) => ({ clips: trackContent(x.layer, frames).clips, indices: x.indices })),
    delta,
  );
}

/** Moves the selected clips (with their cels and keys) by `delta` frames. */
export function moveSelectedClips(delta: number): void {
  const s = getState();
  const d = clipMoveDelta(delta, s);
  if (!d) return;
  const sel = selectedByTrack(s);
  editTracks('Move clip', sel.map((x) => x.layer.id), (t, layer) => moveClips(t, sel.find((x) => x.layer.id === layer.id)!.indices, d));
  setState({ clipSelection: s.clipSelection.map((c) => ({ ...c, start: c.start + d })) });
}

/** What a track looks like with a clip's edge dragged to `frame` (Alt: time stretch), for previews and commits. */
export function draggedEdge(t: Content, index: number, edge: ClipEdge, frame: number, stretch: boolean, fps: number): Content {
  return stretch ? stretchClip(t, index, edge, frame, fps) : trimClip(t, index, edge, frame, fps);
}

/** Trim (or with Alt, stretch) a clip by dragging its edge to `frame`. */
export function dragClipEdge(trackId: Id, start: number, edge: ClipEdge, frame: number, stretch: boolean): void {
  let newStart = start;
  const ok = editTracks(stretch ? 'Stretch clip' : 'Trim clip', [trackId], (t, _l, tl) => {
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

export type { ClipRef };

// ------------------------------------------------------------------ keyframes

/** The track whose keyframes are edited: the current track, when its keyframes are on (2D camera folders: always). */
export function keyTrack(s: PaintState = getState()): Layer | null {
  const t = currentTrack(s);
  return t && s.doc.timeline && keysOn(t) ? t : null;
}

/** A track's placement at a frame: from its keyframes, else as it is. */
export function placementNow(track: Layer, frame = getState().frame, s: PaintState = getState()): Placement {
  return placementAt(track.keys?.frames ?? [], frame) ?? restPlacement(s.doc.width, s.doc.height);
}

/** Animation > Edit track > Enable keyframes on this layer (the keyframes stay when turned off). */
export function toggleKeyframes(): void {
  const s = getState();
  const track = currentTrack(s);
  if (!track || !s.doc.timeline) {
    setState({ hint: 'Select a layer or animation folder on the timeline' });
    return;
  }
  if (isCameraFolder(track)) {
    setState({ hint: 'Keyframes are always on for 2D camera folders' });
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

/** Records a placement as the keyframe at `frame` of a track (a clip is made there if needed; `enable` turns keyframes on). */
export function setKeyframe(trackId: Id, frame: number, p: Placement, label = 'Keyframe', key?: string, enable = false): void {
  const s = getState();
  const old = findLayer(s.doc.layers, trackId)?.keys?.frames.find((k) => k.frame === frame);
  const interp = old?.interp ?? s.keyInterp;
  actions.changeDoc(
    label,
    (doc) => {
      const l = findLayer(doc.layers, trackId);
      if (!l || !doc.timeline) return;
      if (!l.keys) l.keys = { enabled: true, frames: [] };
      if (l.clips) setTrackContent(l, ensureClipAt(trackContent(l, doc.timeline.frames), frame, doc.timeline.frames, true));
      l.keys = { enabled: l.keys.enabled || enable, frames: setKey(l.keys.frames, { ...placementOf(p), frame, interp }) };
    },
    key ? { key } : {},
  );
}

/** Timeline palette / Animation > Edit track > Add keyframe: the current placement at the current frame. */
export function addKeyframe(): void {
  const s = getState();
  const track = currentTrack(s);
  if (!track || !s.doc.timeline || track.kind === 'correction') {
    setState({ hint: 'Select a layer or animation folder on the timeline' });
    return;
  }
  // Adding a keyframe turns keyframes on.
  setKeyframe(track.id, s.frame, placementNow(track, s.frame, s), 'Add keyframe', undefined, true);
  setState({ keySelection: [{ track: track.id, frame: s.frame }] });
}

/** The selected keyframes by track, or the current track's keyframe at the current frame. */
function keyTargets(s: PaintState): Map<Id, number[]> {
  const out = new Map<Id, number[]>();
  for (const k of s.keySelection) out.set(k.track, [...(out.get(k.track) ?? []), k.frame]);
  if (out.size === 0) {
    const track = currentTrack(s);
    if (track?.keys?.frames.some((k) => k.frame === s.frame)) out.set(track.id, [s.frame]);
  }
  return out;
}

/** Delete keyframe: the selected keyframes (or the one at the current frame). */
export function deleteKeyframes(): void {
  const s = getState();
  const targets = keyTargets(s);
  if (targets.size === 0) {
    setState({ hint: 'Select a keyframe in the Timeline palette' });
    return;
  }
  actions.changeDoc('Delete keyframe', (doc) => {
    for (const [id, frames] of targets) {
      const l = findLayer(doc.layers, id);
      if (l?.keys) l.keys = { ...l.keys, frames: l.keys.frames.filter((k) => !frames.includes(k.frame)) };
    }
  });
  setState({ keySelection: [] });
}

/** Animation > Edit track > Delete all keyframes of the current track. */
export function deleteAllKeyframes(): void {
  const track = currentTrack();
  if (!track?.keys?.frames.length) {
    setState({ hint: 'This track has no keyframes' });
    return;
  }
  actions.changeDoc('Delete all keyframes', (doc) => {
    const l = findLayer(doc.layers, track.id);
    if (l?.keys) l.keys = { ...l.keys, frames: [] };
  });
  setState({ keySelection: [] });
}

/** Keyframe interpolation (Timeline palette) / Switch keyframe to … interpolation: for new keyframes and the selected ones. */
export function setKeyInterp(interp: Interp): void {
  const s = getState();
  setState({ keyInterp: interp });
  const targets = keyTargets(s);
  if (targets.size === 0) return;
  actions.changeDoc(`Switch keyframe to ${interp} interpolation`, (doc) => {
    for (const [id, frames] of targets) {
      const l = findLayer(doc.layers, id);
      if (l?.keys) l.keys = { ...l.keys, frames: l.keys.frames.map((k) => (frames.includes(k.frame) ? { ...k, interp } : k)) };
    }
  });
}

/** Selects a keyframe (`add`: Ctrl/⌘-click adds it or takes it out) and goes to its frame. */
export function selectKeyframe(track: Id, frame: number, add = false): void {
  const s = getState();
  const has = s.keySelection.some((k) => k.track === track && k.frame === frame);
  const keySelection = !add ? [{ track, frame }] : has ? s.keySelection.filter((k) => !(k.track === track && k.frame === frame)) : [...s.keySelection, { track, frame }];
  setState({ keySelection, clipSelection: [] });
  selectTrackFrame(track, frame);
}

export const clearKeySelection = () => {
  if (getState().keySelection.length) setState({ keySelection: [] });
};

/** Drags the selected keyframes by `delta` frames (Alt: copies them). */
export function moveSelectedKeys(delta: number, copy = false): void {
  const s = getState();
  if (!delta || s.keySelection.length === 0) return;
  const targets = keyTargets(s);
  actions.changeDoc(copy ? 'Duplicate keyframe' : 'Move keyframe', (doc) => {
    for (const [id, frames] of targets) {
      const l = findLayer(doc.layers, id);
      if (!l?.keys || !doc.timeline) continue;
      l.keys = { ...l.keys, frames: moveKeys(l.keys.frames, frames, delta, copy) };
      // Keyframes need a clip where they land.
      if (l.clips) for (const f of frames) setTrackContent(l, ensureClipAt(trackContent(l, doc.timeline.frames), Math.max(1, f + delta), doc.timeline.frames, true));
    }
  });
  setState({ keySelection: s.keySelection.map((k) => ({ ...k, frame: Math.max(1, k.frame + delta) })) });
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
export function newCameraFolder(name = '2D camera folder'): Id {
  const folder = createFolder(name, [], { camera: true, blend: 'normal', keys: { enabled: true, frames: [] } });
  actions.changeDoc('New 2D camera folder', (doc, st) => {
    if (!doc.timeline) doc.timeline = { ...DEFAULT_TIMELINE };
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
  // From the start when at the end.
  if (getState().frame >= t.frames) setFrame(1, false);
  setState({ playing: true });
  let last = performance.now();
  let carry = 0;
  const tick = (now: number) => {
    const s = getState();
    const tl = timelineOf(s);
    if (!s.playing || !tl?.enabled) return stop();
    carry += now - last;
    last = now;
    const step = 1000 / tl.fps;
    let frame = s.frame;
    while (carry >= step) {
      carry -= step;
      if (frame < tl.frames) frame++;
      else if (s.loop) frame = 1;
      else return stop();
    }
    if (frame !== s.frame) setState({ frame });
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

export function stop(): void {
  cancelAnimationFrame(raf);
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
