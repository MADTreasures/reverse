/**
 * Animation (Timeline palette and Animation menu): the timeline, animation folders and cels,
 * assigning cels to frames, moving between frames, playback and onion skin.
 */
import { animationFolders, celOf, isAnimationFolder, trackFolderOf, type AnimationFolder } from '../model/animation';
import { createFolder, createRasterLayer, findLayer, flatten, locate } from '../model/layers';
import type { Id, Layer, PaintDocument } from '../model/types';
import {
  assignAt,
  celAt,
  deleteFrames,
  DEFAULT_TIMELINE,
  emptyTrack,
  entryAt,
  insertFrames,
  MAX_FRAMES,
  nextCelName,
  nextTrackName,
  removeAt,
  type OnionSkin,
  type Timeline,
} from '../paint/animation';
import { ensureSurface } from '../engine/surfaces';
import * as actions from './actions';
import { getState, setState, type PaintState } from './store';

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

/** Clicking a frame of a track: that track and frame are selected (and the cel shown there). */
export function selectTrackFrame(folderId: Id, frame: number): void {
  const s = getState();
  const folder = findLayer(s.doc.layers, folderId);
  if (!isAnimationFolder(folder)) return;
  const f = clampFrame(frame, timelineOf(s));
  setState({ frame: f, activeLayerId: editTargetAt(folder, f, s.activeLayerId, s.doc.layers), maskEditing: false, selectedObjects: [] });
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

/** Animation > Timeline > Insert frame / Delete frame at the current frame, on every track. */
export function insertFrame(count = 1): void {
  const { frame } = getState();
  actions.changeDoc('Insert frame', (doc) => {
    if (!doc.timeline) return;
    for (const f of animationFolders(doc.layers)) f.animation = insertFrames(f.animation, frame, count);
    doc.timeline = { ...doc.timeline, frames: Math.min(MAX_FRAMES, doc.timeline.frames + count) };
  });
}

export function deleteFrame(count = 1): void {
  const s = getState();
  const t = timelineOf(s);
  if (!t || t.frames <= 1) return;
  const n = Math.min(count, t.frames - s.frame + 1, t.frames - 1);
  actions.changeDoc('Delete frame', (doc) => {
    for (const f of animationFolders(doc.layers)) f.animation = deleteFrames(f.animation, s.frame, n);
    doc.timeline = { ...t, frames: t.frames - n };
  });
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
    f.animation = assignAt(f.animation, frame, cel.id);
    ensureSurface(cel.id, doc.width, doc.height);
    doc.timeline = { ...(doc.timeline ?? t), frames: Math.max((doc.timeline ?? t).frames, frame) };
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
    f.animation = assignAt(f.animation, frame, celId);
    if (doc.timeline && frame > doc.timeline.frames) doc.timeline = { ...doc.timeline, frames: Math.min(MAX_FRAMES, frame) };
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
