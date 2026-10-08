/** Animation folders and their cels in the layer tree (see paint/animation.ts for the tracks). */
import { celAt, framesOf, pruneTrack, type AnimationTrack } from '../paint/animation';
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

/**
 * Why a layer cannot be edited at `frame` because of the timeline, or null: a cel that is not shown
 * there (the layers of other folders always can be).
 */
export function celBlocker(doc: PaintDocument, id: Id, frame: number): string | null {
  if (!doc.timeline?.enabled) return null;
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
