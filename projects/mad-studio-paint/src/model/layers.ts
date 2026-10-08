import { uid } from './ids';
import type { Correction } from '../paint/tonal';
import type { CorrectionLayer, FolderLayer, GradientLayer, Id, Layer, LayerMask, PaintDocument, RasterLayer, TextLayer, VectorLayer } from './types';
import type { GradientFill } from '../paint/gradient';

export function createRasterLayer(name: string, patch: Partial<RasterLayer> = {}): RasterLayer {
  return {
    id: uid('l'),
    kind: 'raster',
    name,
    visible: true,
    opacity: 1,
    blend: 'normal',
    clip: false,
    locked: false,
    lockAlpha: false,
    reference: false,
    draft: false,
    ...patch,
  };
}

export function createFolder(name: string, children: Layer[] = [], patch: Partial<FolderLayer> = {}): FolderLayer {
  return {
    id: uid('f'),
    kind: 'folder',
    name,
    visible: true,
    opacity: 1,
    blend: 'normal',
    clip: false,
    locked: false,
    reference: false,
    draft: false,
    expanded: true,
    children,
    ...patch,
  };
}

let revCounter = Date.now();
/** A fresh revision number for the content of a vector or text layer. */
export const nextRev = () => ++revCounter;

export function createVectorLayer(name: string, patch: Partial<VectorLayer> = {}): VectorLayer {
  return {
    id: uid('v'),
    kind: 'vector',
    name,
    visible: true,
    opacity: 1,
    blend: 'normal',
    clip: false,
    locked: false,
    reference: false,
    draft: false,
    strokes: [],
    rev: nextRev(),
    ...patch,
  };
}

export function createTextLayer(name: string, patch: Partial<TextLayer> = {}): TextLayer {
  return {
    id: uid('t'),
    kind: 'text',
    name,
    visible: true,
    opacity: 1,
    blend: 'normal',
    clip: false,
    locked: false,
    reference: false,
    draft: false,
    texts: [],
    balloons: [],
    rev: nextRev(),
    ...patch,
  };
}

export function createGradientLayer(name: string, gradient: GradientFill, patch: Partial<GradientLayer> = {}): GradientLayer {
  return {
    id: uid('g'),
    kind: 'gradient',
    name,
    visible: true,
    opacity: 1,
    blend: 'normal',
    clip: false,
    locked: false,
    reference: false,
    draft: false,
    gradient,
    rev: nextRev(),
    ...patch,
  };
}

export function createCorrectionLayer(name: string, correction: Correction, patch: Partial<CorrectionLayer> = {}): CorrectionLayer {
  return {
    id: uid('c'),
    kind: 'correction',
    name,
    visible: true,
    opacity: 1,
    blend: 'normal',
    clip: false,
    locked: false,
    reference: false,
    draft: false,
    correction,
    ...patch,
  };
}

/** New folders blend in isolation ("Normal"), like the reference; "Through" is a choice. */

export interface LayerLocation {
  layer: Layer;
  /** Sibling list that contains the layer. */
  siblings: Layer[];
  index: number;
  parent: FolderLayer | null;
}

export function locate(layers: Layer[], id: Id, parent: FolderLayer | null = null): LayerLocation | null {
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    if (layer.id === id) return { layer, siblings: layers, index: i, parent };
    if (layer.kind === 'folder') {
      const found = locate(layer.children, id, layer);
      if (found) return found;
    }
  }
  return null;
}

export const findLayer = (layers: Layer[], id: Id | null): Layer | null => (id ? locate(layers, id)?.layer ?? null : null);

/** All layers, depth first, top-most first (panel order). */
export function flatten(layers: Layer[], out: Layer[] = []): Layer[] {
  for (const layer of layers) {
    out.push(layer);
    if (layer.kind === 'folder') flatten(layer.children, out);
  }
  return out;
}

export const rasterLayers = (layers: Layer[]) => flatten(layers).filter((l): l is RasterLayer => l.kind === 'raster');

/**
 * A deep copy of the document for the next undo step. Vector lines are never changed in place
 * (edits replace them), so the copy shares them instead of cloning every point.
 */
export function cloneDocument(doc: PaintDocument): PaintDocument {
  const lines = new Map<Id, VectorLayer['strokes']>();
  const strip = (layers: Layer[]): Layer[] =>
    layers.map((l) => {
      if (l.kind === 'vector') {
        lines.set(l.id, l.strokes);
        return { ...l, strokes: [] };
      }
      return l.kind === 'folder' ? { ...l, children: strip(l.children) } : l;
    });
  const copy = structuredClone({ ...doc, layers: strip(doc.layers) });
  for (const l of flatten(copy.layers)) if (l.kind === 'vector') l.strokes = [...(lines.get(l.id) ?? [])];
  return copy;
}

/** A new layer mask; the caller creates its surface. */
export const createLayerMask = (): LayerMask => ({ id: uid('m'), enabled: true, linked: true });

/** Ids of everything that owns pixels: raster layers and layer masks. */
export function pixelIds(layers: Layer[]): Id[] {
  const ids: Id[] = [];
  for (const l of flatten(layers)) {
    if (l.kind === 'raster') ids.push(l.id);
    if (l.mask) ids.push(l.mask.id);
  }
  return ids;
}

/** Ids of vector, text and gradient layers (their pixels are rendered from their content). */
export const renderedIds = (layers: Layer[]): Id[] => flatten(layers).flatMap((l) => (l.kind === 'vector' || l.kind === 'text' || l.kind === 'gradient' ? [l.id] : []));

/** Ids of all layer masks. */
export const maskIds = (layers: Layer[]): Id[] => flatten(layers).flatMap((l) => (l.mask ? [l.mask.id] : []));

export function countLayers(layers: Layer[]): number {
  return flatten(layers).length;
}

/** True if `id` is `ancestorId` itself or nested inside it. */
export function isInside(layers: Layer[], id: Id, ancestorId: Id): boolean {
  const ancestor = findLayer(layers, ancestorId);
  if (!ancestor) return false;
  return flatten([ancestor]).some((l) => l.id === id);
}

/** A layer is effectively visible when it and all its folders are visible. */
export function isEffectivelyVisible(layers: Layer[], id: Id): boolean {
  let loc = locate(layers, id);
  while (loc) {
    if (!loc.layer.visible) return false;
    if (!loc.parent) return true;
    loc = locate(layers, loc.parent.id);
  }
  return false;
}

/** Layer is locked by itself or by an enclosing folder. */
export function isEffectivelyLocked(layers: Layer[], id: Id): boolean {
  let loc = locate(layers, id);
  while (loc) {
    if (loc.layer.locked) return true;
    if (!loc.parent) return false;
    loc = locate(layers, loc.parent.id);
  }
  return false;
}

/** Inserts above the anchor (or at the top of the root when no anchor). Mutates `layers`. */
export function insertAbove(layers: Layer[], layer: Layer, anchorId: Id | null): void {
  const loc = anchorId ? locate(layers, anchorId) : null;
  if (!loc) {
    layers.unshift(layer);
    return;
  }
  loc.siblings.splice(loc.index, 0, layer);
}

/** Removes and returns the layer. Mutates `layers`. */
export function removeLayer(layers: Layer[], id: Id): Layer | null {
  const loc = locate(layers, id);
  if (!loc) return null;
  loc.siblings.splice(loc.index, 1);
  return loc.layer;
}

export type DropPosition = 'above' | 'below' | 'inside';

/** Moves a layer relative to a target. Moving a folder into itself is rejected. Mutates `layers`. */
export function moveLayer(layers: Layer[], id: Id, targetId: Id, position: DropPosition): boolean {
  if (id === targetId || isInside(layers, targetId, id)) return false;
  const target = findLayer(layers, targetId);
  if (!target || (position === 'inside' && target.kind !== 'folder')) return false;
  const layer = removeLayer(layers, id);
  if (!layer) return false;
  if (position === 'inside' && target.kind === 'folder') {
    target.children.unshift(layer);
    target.expanded = true;
    return true;
  }
  const loc = locate(layers, targetId)!;
  loc.siblings.splice(position === 'above' ? loc.index : loc.index + 1, 0, layer);
  return true;
}

/** Moves one step up (-1) or down (+1) among its siblings. Mutates `layers`. */
export function shiftLayer(layers: Layer[], id: Id, delta: -1 | 1): boolean {
  const loc = locate(layers, id);
  if (!loc) return false;
  const to = loc.index + delta;
  if (to < 0 || to >= loc.siblings.length) return false;
  loc.siblings.splice(loc.index, 1);
  loc.siblings.splice(to, 0, loc.layer);
  return true;
}

/** Layer directly below in the same sibling list (target of "merge down" and clipping). */
export function layerBelow(layers: Layer[], id: Id): Layer | null {
  const loc = locate(layers, id);
  return loc ? loc.siblings[loc.index + 1] ?? null : null;
}

/**
 * Groups siblings (top-most first) into clipping stacks: a base layer followed by the
 * clipped layers above it. Returned bottom-up, i.e. in compositing order.
 * A clipped layer without a non-clipped layer below it is drawn as a normal layer.
 */
export interface ClipGroup {
  base: Layer;
  clipped: Layer[];
}

export function clipGroups(siblings: Layer[]): ClipGroup[] {
  const bottomUp = [...siblings].reverse();
  const groups: ClipGroup[] = [];
  for (const layer of bottomUp) {
    const current = groups[groups.length - 1];
    // Nothing can clip to a "Through" folder or a correction layer: such layers are drawn as normal layers.
    const canClip = current && current.base.kind !== 'correction' && !(current.base.kind === 'folder' && current.base.blend === 'pass-through');
    if (layer.clip && canClip) current.clipped.push(layer);
    else groups.push({ base: layer, clipped: [] });
  }
  return groups;
}

/** Deep copy with fresh ids (masks too). Returns the copy and a map old id → new id (to copy pixels). */
export function cloneLayer(layer: Layer, idMap: Map<Id, Id> = new Map()): { copy: Layer; idMap: Map<Id, Id> } {
  const copyMask = (m: LayerMask | undefined): LayerMask | undefined => {
    if (!m) return undefined;
    const id = uid('m');
    idMap.set(m.id, id);
    return { ...m, id };
  };
  const copyOne = (l: Layer): Layer => {
    const id = uid(l.kind === 'folder' ? 'f' : l.kind === 'correction' ? 'c' : l.kind === 'vector' ? 'v' : l.kind === 'text' ? 't' : l.kind === 'gradient' ? 'g' : 'l');
    idMap.set(l.id, id);
    const mask = copyMask(l.mask);
    if (l.kind === 'folder') return { ...l, id, mask, children: l.children.map(copyOne) };
    // Lines are never changed in place, so the copy can share them.
    if (l.kind === 'vector') return { ...l, id, mask, strokes: [...l.strokes], rev: nextRev() };
    if (l.kind === 'text') return { ...l, id, mask, texts: [...l.texts], balloons: [...l.balloons], rev: nextRev() };
    if (l.kind === 'gradient') return { ...l, id, mask, rev: nextRev() };
    return { ...l, id, mask };
  };
  return { copy: copyOne(layer), idMap };
}

/** A unique "Layer N" style name. */
export function nextLayerName(doc: PaintDocument, base = 'Layer'): string {
  const used = new Set(flatten(doc.layers).map((l) => l.name));
  for (let n = 1; ; n++) {
    const name = `${base} ${n}`;
    if (!used.has(name)) return name;
  }
}
