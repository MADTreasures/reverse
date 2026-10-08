/**
 * Pixel storage: one document-sized canvas per raster layer, keyed by layer id.
 * Surfaces of deleted layers are kept while undo history may still restore them (see History.gc).
 */
import type { Id } from '../model/types';
import { createCanvas, ctx2d } from './canvas';

const surfaces = new Map<Id, HTMLCanvasElement>();
/** Bumped on every pixel change; drives thumbnails. */
const revisions = new Map<Id, number>();
let listeners: (() => void)[] = [];
let notifyQueued = false;

export function getSurface(id: Id): HTMLCanvasElement | undefined {
  return surfaces.get(id);
}

export function ensureSurface(id: Id, width: number, height: number): HTMLCanvasElement {
  let s = surfaces.get(id);
  if (!s) {
    s = createCanvas(width, height);
    surfaces.set(id, s);
  }
  return s;
}

export function setSurface(id: Id, canvas: HTMLCanvasElement): void {
  surfaces.set(id, canvas);
  touch(id);
}

export function deleteSurface(id: Id): void {
  surfaces.delete(id);
  revisions.delete(id);
}

export function surfaceIds(): Id[] {
  return [...surfaces.keys()];
}

export function clearAllSurfaces(): void {
  surfaces.clear();
  revisions.clear();
}

/** Resizes every surface, keeping pixels anchored at (offsetX, offsetY) in the new canvas. */
export function resizeSurfaces(width: number, height: number, offsetX = 0, offsetY = 0): void {
  for (const [id, old] of surfaces) {
    const c = createCanvas(width, height);
    ctx2d(c).drawImage(old, offsetX, offsetY);
    surfaces.set(id, c);
    touch(id);
  }
}

export function surfaceCtx(id: Id): CanvasRenderingContext2D | null {
  const s = surfaces.get(id);
  return s ? ctx2d(s) : null;
}

export function touch(id: Id): void {
  revisions.set(id, (revisions.get(id) ?? 0) + 1);
  if (!notifyQueued) {
    notifyQueued = true;
    queueMicrotask(() => {
      notifyQueued = false;
      for (const l of listeners) l();
    });
  }
}

export const revisionOf = (id: Id) => revisions.get(id) ?? 0;

/** Subscribe to pixel changes (batched per microtask). */
export function onSurfaceChange(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}
