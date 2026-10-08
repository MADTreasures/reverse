/**
 * Animation folders and their cels in the layer tree, and the timeline's tracks: every layer that is
 * not a cel (or inside one) is a track with clips (see paint/animation.ts and paint/clips.ts).
 */
import { celAt, framesOf, pruneTrack, type AnimationTrack } from '../paint/animation';
import { clipsOf, inClips, type TrackContent } from '../paint/clips';
import type { Keyframe } from '../paint/keyframes';
import { findLayer, flatten, locate } from './layers';
import type { FolderLayer, Id, Layer, PaintDocument } from './types';

export type AnimationFolder = FolderLayer & { animation: AnimationTrack };

export const isAnimationFolder = (l: Layer | null | undefined): l is AnimationFolder => l?.kind === 'folder' && Boolean(l.animation);

export const animationFolders = (layers: Layer[]): AnimationFolder[] => flatten(layers).filter(isAnimationFolder);

/** The animation folder a layer belongs to and the cel (a layer of that folder) it is or is inside. */
export function celOf(layers: Layer[], id: Id): { folder: AnimationFolder; cel: Layer } | null {
  let loc = locate(layers, id);
  while (loc) {
    if (isAnimationFolder(loc.parent)) return { folder: loc.parent, cel: loc.layer };
    loc = loc.parent ? locate(layers, loc.parent.id) : null;
  }
  return null;
}

/** The animation folder of a layer: the layer itself, or the folder it is a cel of. */
export function trackFolderOf(layers: Layer[], id: Id): AnimationFolder | null {
  const l = findLayer(layers, id);
  return isAnimationFolder(l) ? l : (celOf(layers, id)?.folder ?? null);
}

/** Drops assignments of cels that left their folder (deleted, moved, merged). */
export function pruneTracks(doc: PaintDocument): void {
  for (const f of animationFolders(doc.layers)) {
    const pruned = pruneTrack(f.animation, new Set(f.children.map((c) => c.id)));
    if (pruned !== f.animation) f.animation = pruned;
  }
}

/** A layer and the folders around it, innermost first. */
function chainOf(layers: Layer[], id: Id): Layer[] {
  const chain: Layer[] = [];
  let loc = locate(layers, id);
  while (loc) {
    chain.push(loc.layer);
    loc = loc.parent ? locate(layers, loc.parent.id) : null;
  }
  return chain;
}

/** The tracks a layer belongs to: itself and its folders, or for a cel its animation folder and the folders around that. */
export function tracksOf(layers: Layer[], id: Id): Layer[] {
  const chain = chainOf(layers, id);
  const top = chain.findLastIndex(isAnimationFolder);
  return top >= 0 ? chain.slice(top) : chain;
}

/** Whether a layer is a track of the timeline (not a cel or inside one). */
export const isTrack = (layers: Layer[], id: Id): boolean => tracksOf(layers, id)[0]?.id === id;

/** Whether the clips of a layer's tracks show it at `frame`. */
export const clipShown = (layers: Layer[], id: Id, frame: number): boolean => tracksOf(layers, id).every((l) => inClips(l.clips, frame));

/** A row of the Timeline palette: a track and how deep it lies in folders. */
export interface TrackRow {
  layer: Layer;
  depth: number;
}

/** The Timeline palette's tracks, top first: every layer but cels; closed folders hide theirs. */
export function timelineTracks(layers: Layer[], depth = 0, out: TrackRow[] = []): TrackRow[] {
  for (const layer of layers) {
    out.push({ layer, depth });
    if (layer.kind === 'folder' && !layer.animation && layer.expanded) timelineTracks(layer.children, depth + 1, out);
  }
  return out;
}

/** What a track holds: its clips (made explicit), an animation folder's cel assignments and its keyframes. */
export function trackContent(layer: Layer, frames: number): TrackContent<Keyframe> {
  return {
    clips: clipsOf(layer.clips, frames),
    ...(isAnimationFolder(layer) ? { cels: layer.animation.cels } : {}),
    ...(layer.keys ? { keys: layer.keys.frames } : {}),
  };
}

/** Stores a track's changed content in its layer (which is mutated). */
export function setTrackContent(layer: Layer, t: TrackContent<Keyframe>): void {
  layer.clips = t.clips;
  if (layer.kind === 'folder' && layer.animation && t.cels) layer.animation = { cels: t.cels };
  if (layer.keys && t.keys) layer.keys = { ...layer.keys, frames: t.keys };
}

export const isCameraFolder = (l: Layer | null | undefined): l is FolderLayer => l?.kind === 'folder' && Boolean(l.camera);

/** Whether a track's keyframes are in effect: turned on, or a 2D camera folder's. */
export const keysOn = (l: Layer): boolean => isCameraFolder(l) || Boolean(l.keys?.enabled);

/** The track with keyframes turned on that a layer belongs to (2D camera folders do not count: their layers stay editable). */
export const keyedTrackOf = (layers: Layer[], id: Id): Layer | null => tracksOf(layers, id).find((l) => !isCameraFolder(l) && l.keys?.enabled) ?? null;

/**
 * Why a layer cannot be edited at `frame` because of the timeline, or null: a cel that is not shown
 * there, or a layer whose track has no clip there (the layers of other folders always can be).
 */
export function celBlocker(doc: PaintDocument, id: Id, frame: number): string | null {
  if (!doc.timeline?.enabled) return null;
  if (!clipShown(doc.layers, id, frame)) return 'This layer has no clip at the current frame (Timeline palette)';
  const c = celOf(doc.layers, id);
  if (!c || celAt(c.folder.animation, frame) === c.cel.id) return null;
  return framesOf(c.folder.animation, c.cel.id).length
    ? 'This cel is not shown at the current frame'
    : 'This cel is not on the timeline: assign it to a frame first (Timeline palette)';
}

/** The frame nearest to `frame` at which a cel is shown, or null if it is not on the timeline. */
export function nearestFrameOf(folder: AnimationFolder, cel: Id, frame: number): number | null {
  const frames = framesOf(folder.animation, cel);
  if (frames.length === 0) return null;
  return frames.reduce((best, f) => (Math.abs(f - frame) < Math.abs(best - frame) ? f : best));
}
