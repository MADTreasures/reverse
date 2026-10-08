/** Document operations. Every change that should be undoable goes through `commit`. */
import { pushHistory } from '../model/color';
import { createDocument } from '../model/document';
import {
  cloneLayer,
  createCorrectionLayer,
  createFolder,
  createLayerMask,
  createRasterLayer,
  findLayer,
  flatten,
  insertAbove,
  isEffectivelyLocked,
  isEffectivelyVisible,
  layerBelow,
  locate,
  moveLayer as moveLayerInTree,
  maskIds,
  nextLayerName,
  pixelIds,
  rasterLayers,
  removeLayer,
  shiftLayer as shiftLayerInTree,
  type DropPosition,
} from '../model/layers';
import type { FolderLayer, Id, Layer, LayerMask, PaintDocument, RasterLayer, RulerRange } from '../model/types';
import { defaultPerspective, type Ruler, type RulerInput } from '../paint/rulers';
import { sanitizeCurve01 } from '../paint/curve';
import type { LayerEffects } from '../paint/effects';
import { applyCorrection, correctionLabel, type Correction } from '../paint/tonal';
import { combine, createMask, expandMask, invertMask, isMaskEmpty, maskBounds, rectMask, type Mask, type SelectionOp } from '../paint/mask';
import { mergeSubTools, type SubTool, type ToolId } from '../paint/tools';
import { normalizeAngle, rotatePan } from '../paint/viewMath';
import { createCanvas, ctx2d, withClip } from '../engine/canvas';
import { captureLayerChange, DirectEdit, type PixelPatch } from '../engine/edit';
import { engine, type DocState, type HistoryEntry } from '../engine/engine';
import { ensureSurface, getSurface, setSurface, touch } from '../engine/surfaces';
import { currentSubTool, getState, initialView, setState, type ColorState, type PaintState, type Preferences, type ViewState } from './store';

// ------------------------------------------------------------------ history

const COALESCE_MS = 1200;

function syncHistoryFlags(dirty = true): void {
  setState((s) => ({ canUndo: engine.history.canUndo, canRedo: engine.history.canRedo, historyVersion: s.historyVersion + 1, ...(dirty ? { dirty: true } : {}) }));
}

/** History palette: undo or redo until `undoCount` steps are applied. */
export function goToHistory(undoCount: number): void {
  let guard = 1000;
  while (engine.history.undoCount > undoCount && guard-- > 0) undo();
  while (engine.history.undoCount < undoCount && engine.history.canRedo && guard-- > 0) redo();
}

function docState(s: PaintState = getState()): DocState {
  return { doc: s.doc, activeLayerId: s.activeLayerId };
}

/** Records an entry that has already been applied. */
export function commit(entry: HistoryEntry): void {
  const last = engine.history.peek();
  const now = performance.now();
  if (
    entry.key &&
    last?.key === entry.key &&
    !engine.history.canRedo &&
    entry.patches.length === 0 &&
    last.patches.length === 0 &&
    now - (last.time ?? 0) < COALESCE_MS
  ) {
    last.after = entry.after;
    last.time = now;
    syncHistoryFlags();
    return;
  }
  engine.history.push({ ...entry, time: now });
  syncHistoryFlags();
}

/** Applies a structural change to a copy of the document and records it. */
export function changeDoc(label: string, fn: (doc: PaintDocument, s: PaintState) => Id | void, opts: { patches?: PixelPatch[]; key?: string } = {}): void {
  const s = getState();
  const before = docState(s);
  const doc = structuredClone(s.doc);
  const active = fn(doc, s) ?? s.activeLayerId;
  const activeLayerId = findLayer(doc.layers, active) ? active : flatten(doc.layers)[0]?.id ?? '';
  setState({ doc, activeLayerId, ...(activeLayerId !== s.activeLayerId ? { maskEditing: false } : {}) });
  commit({ label, before, after: { doc, activeLayerId }, patches: opts.patches ?? [], key: opts.key });
}

export function commitPixels(label: string, patches: (PixelPatch | null)[]): void {
  const list = patches.filter((p): p is PixelPatch => p !== null);
  if (list.length) commit({ label, patches: list });
}

function setActiveDoc(d: DocState): void {
  const changed = d.activeLayerId !== getState().activeLayerId;
  setState({ doc: d.doc, activeLayerId: d.activeLayerId, ...(changed ? { maskEditing: false } : {}) });
}

export function undo(): void {
  if (getState().transforming) return;
  const e = engine.history.undo();
  if (!e) return;
  if (e.canvasSize) engine.resizeCanvas(e.canvasSize.before.w, e.canvasSize.before.h);
  engine.applyPatches(e, 'before');
  if (e.before) setActiveDoc(e.before);
  if (e.selection) setState({ selection: e.selection.before });
  engine.invalidate();
  syncHistoryFlags();
}

export function redo(): void {
  if (getState().transforming) return;
  const e = engine.history.redo();
  if (!e) return;
  if (e.canvasSize) engine.resizeCanvas(e.canvasSize.after.w, e.canvasSize.after.h);
  engine.applyPatches(e, 'after');
  if (e.after) setActiveDoc(e.after);
  if (e.selection) setState({ selection: e.selection.after });
  engine.invalidate();
  syncHistoryFlags();
}

// ------------------------------------------------------------------ document

export function loadDocument(doc: PaintDocument, images: Map<Id, HTMLCanvasElement>, fileName: string | null): void {
  engine.load(doc, images);
  setState({
    doc,
    activeLayerId: rasterLayers(doc.layers)[0]?.id ?? flatten(doc.layers)[0]?.id ?? '',
    maskEditing: false,
    selection: null,
    canUndo: false,
    canRedo: false,
    historyVersion: getState().historyVersion + 1,
    dirty: false,
    fileName,
    transforming: false,
  });
  fitToWindow();
}

export function newDocument(name: string, width: number, height: number, dpi: number, paperColor = '#ffffff'): void {
  const doc = createDocument(name, width, height, dpi);
  doc.paper.color = paperColor;
  loadDocument(doc, new Map(), null);
}

export function markSaved(fileName: string | null): void {
  setState({ dirty: false, fileName });
}

export function renameDocument(name: string): void {
  changeDoc('Rename canvas', (doc) => {
    doc.name = name.trim() || 'Untitled';
  });
}

export function setPaper(patch: Partial<PaintDocument['paper']>): void {
  changeDoc('Paper', (doc) => {
    doc.paper = { ...doc.paper, ...patch };
  }, { key: 'paper' });
}

// ------------------------------------------------------------------ layers

export const activeLayer = (s: PaintState = getState()): Layer | null => findLayer(s.doc.layers, s.activeLayerId);

export function activeRaster(s: PaintState = getState()): RasterLayer | null {
  const l = activeLayer(s);
  return l?.kind === 'raster' ? l : null;
}

/** What the drawing tools change: the active layer's mask (its thumbnail is selected) or its pixels. */
export interface EditTarget {
  layer: Layer;
  /** Surface that receives the pixels. */
  surfaceId: Id;
  isMask: boolean;
  lockAlpha: boolean;
}

export function editTarget(s: PaintState = getState()): EditTarget | null {
  const l = activeLayer(s);
  if (!l) return null;
  if (s.maskEditing && l.mask) return { layer: l, surfaceId: l.mask.id, isMask: true, lockAlpha: false };
  return l.kind === 'raster' ? { layer: l, surfaceId: l.id, isMask: false, lockAlpha: l.lockAlpha } : null;
}

/** True when the drawing tools edit the active layer's mask. */
export const editingMask = (s: PaintState = getState()): boolean => editTarget(s)?.isMask ?? false;

/** Why the current layer cannot be painted on, or null if it can. */
export function editBlocker(s: PaintState = getState()): string | null {
  const l = activeLayer(s);
  if (!l) return 'No layer selected';
  if (!editTarget(s)) return 'Select a raster layer to draw on (folders cannot be drawn on)';
  if (isEffectivelyLocked(s.doc.layers, l.id)) return 'The layer is locked';
  if (!l.visible) return 'The layer is hidden';
  return null;
}

/** Selects a layer; with `mask`, its mask thumbnail (the mask becomes the drawing target). */
export function selectLayer(id: Id, mask = false): void {
  const l = findLayer(getState().doc.layers, id);
  if (l) setState({ activeLayerId: id, maskEditing: mask && Boolean(l.mask) });
}

/**
 * Surfaces that move with the active layer (Move layer tool, transforms, flips): its pixels, those of
 * every layer inside a folder, and linked masks. An unlinked mask whose thumbnail is selected moves alone.
 * Locked layers are left out.
 */
export function movingSurfaces(s: PaintState = getState()): Id[] {
  const l = activeLayer(s);
  if (!l) return [];
  if (s.maskEditing && l.mask && !l.mask.linked) return [l.mask.id];
  const ids: Id[] = [];
  for (const x of flatten([l])) {
    if (isEffectivelyLocked(s.doc.layers, x.id)) continue;
    if (x.kind === 'raster') ids.push(x.id);
    if (x.mask?.linked) ids.push(x.mask.id);
  }
  return ids;
}

/** New layers go directly above the selected layer, or to the top of a selected folder. */
function insertNew(doc: PaintDocument, layer: Layer, activeId: Id): void {
  const active = findLayer(doc.layers, activeId);
  if (active?.kind === 'folder') {
    active.children.unshift(layer);
    active.expanded = true;
  } else insertAbove(doc.layers, layer, activeId);
}

export function addRasterLayer(): Id {
  const layer = createRasterLayer(nextLayerName(getState().doc));
  changeDoc('New raster layer', (doc, s) => {
    insertNew(doc, layer, s.activeLayerId);
    ensureSurface(layer.id, doc.width, doc.height);
    return layer.id;
  });
  return layer.id;
}

export function addFolder(): Id {
  const folder = createFolder(nextLayerName(getState().doc, 'Folder'));
  changeDoc('New layer folder', (doc, s) => {
    insertNew(doc, folder, s.activeLayerId);
    return folder.id;
  });
  return folder.id;
}

/** Layer > Ungroup layer folder: the folder's layers take its place. */
export function ungroupFolder(id: Id = getState().activeLayerId): void {
  const l = findLayer(getState().doc.layers, id);
  if (l?.kind !== 'folder') return;
  changeDoc('Ungroup layer folder', (doc) => {
    const loc = locate(doc.layers, id);
    if (!loc || loc.layer.kind !== 'folder') return;
    loc.siblings.splice(loc.index, 1, ...loc.layer.children);
    return loc.layer.children[0]?.id ?? loc.siblings[loc.index]?.id;
  });
}

/** Alt+] / Alt+[: selects the layer above or below in the layer palette. */
export function selectAdjacentLayer(dir: -1 | 1): void {
  const s = getState();
  const rows: Id[] = [];
  const walk = (layers: Layer[]) => {
    for (const l of layers) {
      rows.push(l.id);
      if (l.kind === 'folder' && l.expanded) walk(l.children);
    }
  };
  walk(s.doc.layers);
  const i = rows.indexOf(s.activeLayerId);
  const next = rows[i + dir];
  if (next) setState({ activeLayerId: next, maskEditing: false });
}

/** Puts the selected layer into a new folder ("Create folder and insert layer"). */
export function groupLayer(id: Id = getState().activeLayerId): void {
  changeDoc('Insert into new folder', (doc) => {
    const loc = locate(doc.layers, id);
    if (!loc) return;
    const folder = createFolder(nextLayerName(doc, 'Folder'), [loc.layer]);
    loc.siblings.splice(loc.index, 1, folder);
    return id;
  });
}

export function deleteLayer(id: Id = getState().activeLayerId): void {
  const s = getState();
  if (flatten(s.doc.layers).length <= 1) return;
  changeDoc('Delete layer', (doc) => {
    const loc = locate(doc.layers, id);
    if (!loc) return;
    // Select the neighbour below (or above) like the layer palette does.
    const next = loc.siblings[loc.index + 1] ?? loc.siblings[loc.index - 1] ?? loc.parent;
    removeLayer(doc.layers, id);
    if (doc.layers.length === 0) {
      const l = createRasterLayer('Layer 1');
      doc.layers.push(l);
      ensureSurface(l.id, doc.width, doc.height);
      return l.id;
    }
    return next?.id;
  });
}

export function duplicateLayer(id: Id = getState().activeLayerId): void {
  changeDoc('Duplicate layer', (doc) => {
    const loc = locate(doc.layers, id);
    if (!loc) return;
    const { copy, idMap } = cloneLayer(loc.layer);
    copy.name = `${loc.layer.name} Copy`;
    for (const [from, to] of idMap) {
      const src = getSurface(from);
      if (!src) continue;
      ctx2d(ensureSurface(to, doc.width, doc.height)).drawImage(src, 0, 0);
    }
    loc.siblings.splice(loc.index, 0, copy);
    return copy.id;
  });
}

/** Properties a locked layer refuses (drawing, transforms and settings are blocked). */
const LOCKED_PROPS = ['blend', 'opacity', 'clip', 'lockAlpha', 'reference', 'draft'];

export function setLayerProps(id: Id, patch: Partial<RasterLayer> | Partial<FolderLayer>, label = 'Layer property', key?: string): void {
  const current = findLayer(getState().doc.layers, id);
  if (current?.locked && Object.keys(patch).some((k) => LOCKED_PROPS.includes(k))) {
    setState({ hint: 'The layer is locked' });
    return;
  }
  changeDoc(
    label,
    (doc) => {
      const l = findLayer(doc.layers, id);
      if (l) Object.assign(l, patch);
    },
    { key: key ?? `${label}:${id}` },
  );
}

/** Layer Property palette: changes one effect (slider drags merge into one undo step). */
export function setLayerEffects(id: Id, effects: LayerEffects, label = 'Layer property'): void {
  const l = findLayer(getState().doc.layers, id);
  if (!l) return;
  if (isEffectivelyLocked(getState().doc.layers, id)) {
    setState({ hint: 'The layer is locked' });
    return;
  }
  changeDoc(
    label,
    (doc) => {
      const x = findLayer(doc.layers, id);
      if (x) x.effects = effects;
    },
    { key: `effects:${id}` },
  );
}

export function renameLayer(id: Id, name: string): void {
  const n = name.trim();
  if (n) setLayerProps(id, { name: n }, 'Rename layer');
}

/** ⌥-drag in the layer palette: a copy of the layer is placed at the drop position. */
export function duplicateLayerTo(id: Id, targetId: Id, position: DropPosition): void {
  changeDoc('Duplicate layer', (doc) => {
    const src = findLayer(doc.layers, id);
    const target = findLayer(doc.layers, targetId);
    if (!src || !target || (position === 'inside' && target.kind !== 'folder')) return;
    const { copy, idMap } = cloneLayer(src);
    copy.name = `${src.name} Copy`;
    for (const [from, to] of idMap) {
      const surface = getSurface(from);
      if (surface) ctx2d(ensureSurface(to, doc.width, doc.height)).drawImage(surface, 0, 0);
    }
    if (position === 'inside' && target.kind === 'folder') {
      target.children.unshift(copy);
      target.expanded = true;
    } else {
      const loc = locate(doc.layers, targetId)!;
      loc.siblings.splice(position === 'above' ? loc.index : loc.index + 1, 0, copy);
    }
    return copy.id;
  });
}

export function moveLayer(id: Id, targetId: Id, position: DropPosition): void {
  const test = structuredClone(getState().doc);
  if (!moveLayerInTree(test.layers, id, targetId, position)) return;
  changeDoc('Move layer', (doc) => {
    moveLayerInTree(doc.layers, id, targetId, position);
    return id;
  });
}

export function shiftLayer(delta: -1 | 1, id: Id = getState().activeLayerId): void {
  const test = structuredClone(getState().doc);
  if (!shiftLayerInTree(test.layers, id, delta)) return;
  changeDoc('Move layer', (doc) => {
    shiftLayerInTree(doc.layers, id, delta);
    return id;
  });
}

/** Composes a small layer stack (top-most first) into a new document-sized canvas. */
function composeStack(layers: Layer[], doc: PaintDocument): HTMLCanvasElement {
  const out = createCanvas(doc.width, doc.height);
  const mini: PaintDocument = { ...doc, layers };
  engine.compositor.compose(mini, ctx2d(out), { x: 0, y: 0, w: doc.width, h: doc.height }, {});
  return out;
}

/** Why "Merge with layer below" is not possible, or null. Locked, hidden and draft layers are refused. */
export function mergeDownBlocker(s: PaintState = getState()): string | null {
  const upper = activeLayer(s);
  const lower = layerBelow(s.doc.layers, s.activeLayerId);
  if (!upper || !lower) return 'There is no layer below';
  if (lower.kind !== 'raster') return 'The layer below must be a raster layer';
  if (upper.locked || lower.locked) return 'Locked layers cannot be merged';
  if (!upper.visible || !lower.visible) return 'Hidden layers cannot be merged';
  if (upper.draft || lower.draft) return 'Draft layers cannot be merged';
  return null;
}

export function canMergeDown(s: PaintState = getState()): boolean {
  return mergeDownBlocker(s) === null;
}

export function mergeDown(): void {
  const s = getState();
  const blocker = mergeDownBlocker(s);
  if (blocker) {
    setState({ hint: blocker });
    return;
  }
  const upper = activeLayer(s);
  const lower = layerBelow(s.doc.layers, s.activeLayerId);
  if (!upper || lower?.kind !== 'raster') return;
  const surface = getSurface(lower.id);
  if (!surface) return;
  const merged = composeStack(
    [
      { ...structuredClone(upper), visible: true },
      // The lower layer's mask stays on the merged layer, so its pixels are merged unmasked.
      { ...structuredClone(lower), visible: true, opacity: 1, blend: 'normal', clip: false, mask: undefined },
    ],
    s.doc,
  );
  const patch = captureLayerChange(lower.id, surface, null, (ctx) => {
    ctx.clearRect(0, 0, surface.width, surface.height);
    ctx.drawImage(merged, 0, 0);
  });
  changeDoc(
    'Merge with layer below',
    (doc) => {
      removeLayer(doc.layers, upper.id);
      return lower.id;
    },
    { patches: patch ? [patch] : [] },
  );
}

/** Merges all visible layers into one raster layer; hidden and draft layers stay separate (paper too). */
export function mergeVisible(): void {
  const s = getState();
  const merges = (l: Layer) => l.visible && !l.draft;
  const visible = s.doc.layers.filter(merges);
  if (visible.length < 2 && !(visible[0]?.kind === 'folder')) return;
  const merged = createCanvas(s.doc.width, s.doc.height);
  engine.compositor.compose({ ...s.doc, layers: structuredClone(visible) }, ctx2d(merged), { x: 0, y: 0, w: s.doc.width, h: s.doc.height }, { skipDraft: true });
  const target = createRasterLayer(nextLayerName(s.doc));
  const surface = ensureSurface(target.id, s.doc.width, s.doc.height);
  ctx2d(surface).drawImage(merged, 0, 0);
  changeDoc('Merge visible layers', (doc) => {
    const topIndex = doc.layers.findIndex(merges);
    const keep = doc.layers.filter((l) => !merges(l));
    const before = doc.layers.slice(0, topIndex).filter((l) => !merges(l)).length;
    doc.layers = keep;
    doc.layers.splice(before, 0, target);
    return target.id;
  });
}

export function flattenImage(): void {
  const s = getState();
  const merged = composeStack(structuredClone(s.doc.layers), s.doc);
  const target = createRasterLayer('Layer 1');
  ctx2d(ensureSurface(target.id, s.doc.width, s.doc.height)).drawImage(merged, 0, 0);
  changeDoc('Flatten image', (doc) => {
    doc.layers = [target];
    return target.id;
  });
}

/** "Transfer to lower layer": moves the pixels into the layer below and leaves this layer empty. */
export function transferToLowerLayer(): void {
  const s = getState();
  const upper = activeRaster(s);
  const lower = layerBelow(s.doc.layers, s.activeLayerId);
  if (!upper || lower?.kind !== 'raster' || lower.locked || upper.locked) return;
  const us = getSurface(upper.id);
  const ls = getSurface(lower.id);
  if (!us || !ls) return;
  const merged = composeStack(
    [
      { ...structuredClone(upper), visible: true, clip: upper.clip },
      { ...structuredClone(lower), visible: true, opacity: 1, blend: 'normal', clip: false, mask: undefined },
    ],
    s.doc,
  );
  const lowerPatch = captureLayerChange(lower.id, ls, null, (ctx) => {
    ctx.clearRect(0, 0, ls.width, ls.height);
    ctx.drawImage(merged, 0, 0);
  });
  const upperPatch = captureLayerChange(upper.id, us, null, (ctx) => ctx.clearRect(0, 0, us.width, us.height));
  engine.invalidate();
  commitPixels('Transfer to lower layer', [lowerPatch, upperPatch]);
}

/** ⌥-click on an eye: show only this layer (and its folders); again: show all. */
export function soloLayer(id: Id): void {
  const s = getState();
  const keep = new Set<Id>();
  let loc = locate(s.doc.layers, id);
  while (loc) {
    keep.add(loc.layer.id);
    loc = loc.parent ? locate(s.doc.layers, loc.parent.id) : null;
  }
  const target = findLayer(s.doc.layers, id);
  if (target) for (const l of flatten([target])) keep.add(l.id);
  const others = flatten(s.doc.layers).filter((l) => !keep.has(l.id));
  const alreadySolo = others.every((l) => !l.visible);
  changeDoc(alreadySolo ? 'Show all layers' : 'Show only this layer', (doc) => {
    for (const l of flatten(doc.layers)) {
      if (keep.has(l.id)) l.visible = true;
      else l.visible = alreadySolo;
    }
  });
}

// ------------------------------------------------------------------ rulers

/**
 * Rulers that apply to the current layer: its own first, then those of other layers whose range
 * includes it (all layers, or the same folder). Hidden rulers and hidden layers do not count.
 */
export function activeRulers(s: PaintState = getState()): { layerId: Id; ruler: Ruler }[] {
  const active = locate(s.doc.layers, s.activeLayerId);
  const own: { layerId: Id; ruler: Ruler }[] = [];
  const others: { layerId: Id; ruler: Ruler }[] = [];
  for (const l of flatten(s.doc.layers)) {
    const set = l.rulers;
    if (!set?.visible || set.items.length === 0 || !isEffectivelyVisible(s.doc.layers, l.id)) continue;
    const mine = l.id === s.activeLayerId;
    const applies = mine || set.range === 'all' || (set.range === 'folder' && locate(s.doc.layers, l.id)?.parent?.id === active?.parent?.id);
    if (!applies) continue;
    for (const ruler of set.items) (mine ? own : others).push({ layerId: l.id, ruler });
  }
  return [...own, ...others];
}

const newRulerId = () => `r${Math.random().toString(36).slice(2, 10)}`;

/** Adds a ruler to a layer (the current one by default) and selects it. */
export function addRuler(ruler: RulerInput, layerId: Id = getState().activeLayerId, label = 'Create ruler'): string {
  const r = { ...ruler, id: ruler.id ?? newRulerId() } as Ruler;
  changeDoc(label, (doc) => {
    const l = findLayer(doc.layers, layerId);
    if (!l) return;
    l.rulers = { items: [...(l.rulers?.items ?? []), r], range: l.rulers?.range ?? 'all', visible: true };
  });
  setState({ selectedRuler: { layerId, rulerId: r.id } });
  return r.id;
}

/** Replaces a ruler (handle drags merge into one undo step through `key`). */
export function updateRuler(layerId: Id, ruler: Ruler, label = 'Edit ruler', key?: string): void {
  changeDoc(
    label,
    (doc) => {
      const set = findLayer(doc.layers, layerId)?.rulers;
      if (set) set.items = set.items.map((r) => (r.id === ruler.id ? ruler : r));
    },
    { key: key ?? `ruler:${ruler.id}` },
  );
}

export function deleteRuler(layerId: Id, rulerId: string): void {
  changeDoc('Delete ruler', (doc) => {
    const l = findLayer(doc.layers, layerId);
    if (!l?.rulers) return;
    const items = l.rulers.items.filter((r) => r.id !== rulerId);
    if (items.length) l.rulers = { ...l.rulers, items };
    else delete l.rulers;
  });
  setState({ selectedRuler: null });
}

/** Layer palette ruler icon: where the layer's rulers apply. */
export function setRulerRange(layerId: Id, range: RulerRange): void {
  changeDoc('Ruler range', (doc) => {
    const l = findLayer(doc.layers, layerId);
    if (l?.rulers) l.rulers = { ...l.rulers, range };
  });
}

export function toggleRulersVisible(layerId: Id = getState().activeLayerId): void {
  const set = findLayer(getState().doc.layers, layerId)?.rulers;
  if (!set) return;
  changeDoc(set.visible ? 'Hide ruler' : 'Show ruler', (doc) => {
    const l = findLayer(doc.layers, layerId);
    if (l?.rulers) l.rulers = { ...l.rulers, visible: !l.rulers.visible };
  });
}

/** Removes all rulers of a layer. */
export function deleteLayerRulers(layerId: Id = getState().activeLayerId): void {
  if (!findLayer(getState().doc.layers, layerId)?.rulers) return;
  changeDoc('Delete ruler', (doc) => {
    const l = findLayer(doc.layers, layerId);
    if (l) delete l.rulers;
  });
  setState({ selectedRuler: null });
}

/** Layer > Ruler/Frame > Create perspective ruler: 1, 2 or 3 vanishing points at default places. */
export function createPerspectiveRuler(points: 1 | 2 | 3): void {
  const { doc } = getState();
  addRuler({ kind: 'perspective', vps: defaultPerspective(points, doc.width, doc.height) }, getState().activeLayerId, 'Create perspective ruler');
}

/** View > Snap > Snap to ruler / Snap to special ruler. */
export function toggleSnap(which: 'ruler' | 'special'): void {
  setState((s) => (which === 'ruler' ? { snapRuler: !s.snapRuler } : { snapSpecial: !s.snapSpecial }));
  engine.requestRender();
}

// ------------------------------------------------------------------ dialog previews

/** A document change shown live while a dialog is open; OK records it as one undo step. */
export interface DocPreview {
  before: DocState;
}

export function beginDocPreview(): DocPreview {
  return { before: docState() };
}

/** Changes the document without an undo entry (the preview's commit records it). */
export function previewDoc(fn: (doc: PaintDocument) => Id | void): void {
  const s = getState();
  const doc = structuredClone(s.doc);
  const active = fn(doc) ?? s.activeLayerId;
  setState({ doc, activeLayerId: findLayer(doc.layers, active) ? active : s.activeLayerId });
}

export function commitDocPreview(p: DocPreview, label: string): void {
  const after = docState();
  if (after.doc !== p.before.doc) commit({ label, before: p.before, after, patches: [] });
}

export function cancelDocPreview(p: DocPreview): void {
  setActiveDoc(p.before);
}

// ------------------------------------------------------------------ correction layers

/** A mask surface that shows everything, or only the selection when there is one. */
function maskFromSelection(): LayerMask {
  const { width, height } = getState().doc;
  const mask = createLayerMask();
  const ctx = ctx2d(ensureSurface(mask.id, width, height));
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  const sel = engine.selectionCanvas();
  if (sel) {
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(sel, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }
  touch(mask.id);
  return mask;
}

/**
 * Layer > New correction layer: added above the current layer with its paired mask (limited to the
 * selection, if any). With `preview` the change is not recorded yet (the settings dialog is open).
 */
export function addCorrectionLayer(correction: Correction, preview = false): Id {
  const s = getState();
  const layer = createCorrectionLayer(nextLayerName(s.doc, correctionLabel(correction.type)), correction, { mask: maskFromSelection() });
  const insert = (doc: PaintDocument) => {
    insertNew(doc, layer, s.activeLayerId);
    return layer.id;
  };
  if (preview) previewDoc(insert);
  else changeDoc('New correction layer', insert);
  setState({ maskEditing: false });
  return layer.id;
}

/** Changes a correction layer's settings without an undo entry (dialog preview). */
export function previewCorrection(id: Id, correction: Correction): void {
  previewDoc((doc) => {
    const l = findLayer(doc.layers, id);
    if (l?.kind === 'correction') l.correction = correction;
  });
}

// ------------------------------------------------------------------ layer masks

function maskedLayer(id: Id): Layer | null {
  const s = getState();
  const l = findLayer(s.doc.layers, id);
  if (!l) return null;
  if (isEffectivelyLocked(s.doc.layers, id)) {
    setState({ hint: 'The layer is locked' });
    return null;
  }
  return l;
}

/**
 * Layer > Layer mask > Mask outside selection (`outside`) or Mask selection. Without a selection the
 * first hides the whole layer and the second creates a mask that hides nothing. A layer that already
 * has a mask gets the area added to it. The mask thumbnail becomes the drawing target.
 */
export function maskLayer(outside: boolean, id: Id = getState().activeLayerId): void {
  const layer = maskedLayer(id);
  if (!layer) return;
  const { width, height } = getState().doc;
  const sel = engine.selectionCanvas();
  // Alpha of `hide` is the area to mask.
  const hide = createCanvas(width, height);
  const h = ctx2d(hide);
  if (outside) {
    h.fillStyle = '#000';
    h.fillRect(0, 0, width, height);
    if (sel) {
      h.globalCompositeOperation = 'destination-out';
      h.drawImage(sel, 0, 0);
    }
  } else if (sel) h.drawImage(sel, 0, 0);
  const label = outside ? 'Mask outside selection' : 'Mask selection';
  const hideIn = (ctx: CanvasRenderingContext2D) => {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(hide, 0, 0);
    ctx.restore();
  };
  if (layer.mask) {
    const surface = getSurface(layer.mask.id);
    const patch = surface ? captureLayerChange(layer.mask.id, surface, null, hideIn) : null;
    if (patch) {
      engine.invalidate();
      commitPixels(label, [patch]);
    }
  } else {
    const mask = createLayerMask();
    const surface = ensureSurface(mask.id, width, height);
    const m = ctx2d(surface);
    m.fillStyle = '#ffffff';
    m.fillRect(0, 0, width, height);
    hideIn(m);
    touch(mask.id);
    changeDoc(label, (doc) => {
      const l = findLayer(doc.layers, id);
      if (l) l.mask = mask;
      return id;
    });
  }
  setState({ activeLayerId: id, maskEditing: true });
}

/** Layer > Layer mask > Delete mask. */
export function deleteMask(id: Id = getState().activeLayerId): void {
  const l = maskedLayer(id);
  if (!l?.mask) return;
  changeDoc('Delete mask', (doc) => {
    const x = findLayer(doc.layers, id);
    if (x) delete x.mask;
    return id;
  });
  setState({ maskEditing: false });
}

/**
 * Layer > Layer mask > Apply mask to layer: erases what the mask hides and removes the mask.
 * A folder becomes one raster layer, as in the reference.
 */
export function applyMaskToLayer(id: Id = getState().activeLayerId): void {
  const l = maskedLayer(id);
  if (!l?.mask) return;
  if (l.kind === 'correction') {
    setState({ hint: 'The mask of a correction layer limits its effect; it cannot be applied' });
    return;
  }
  const s = getState();
  const maskSurface = getSurface(l.mask.id);
  if (!maskSurface) return;
  if (l.kind === 'raster') {
    const surface = getSurface(l.id);
    if (!surface) return;
    const patch = captureLayerChange(l.id, surface, null, (ctx) => {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(maskSurface, 0, 0);
      ctx.restore();
    });
    changeDoc(
      'Apply mask to layer',
      (doc) => {
        const x = findLayer(doc.layers, id);
        if (x) delete x.mask;
        return id;
      },
      { patches: patch ? [patch] : [] },
    );
  } else {
    const raster = createRasterLayer(l.name, {
      visible: l.visible,
      opacity: l.opacity,
      blend: l.blend === 'pass-through' ? 'normal' : l.blend,
      clip: l.clip,
      reference: l.reference,
      draft: l.draft,
    });
    const merged = composeStack([{ ...structuredClone(l), visible: true, opacity: 1, blend: 'normal', clip: false, mask: { ...l.mask, enabled: true } }], s.doc);
    ctx2d(ensureSurface(raster.id, s.doc.width, s.doc.height)).drawImage(merged, 0, 0);
    changeDoc('Apply mask to layer', (doc) => {
      const loc = locate(doc.layers, id);
      if (!loc) return;
      loc.siblings.splice(loc.index, 1, raster);
      return raster.id;
    });
  }
  setState({ maskEditing: false });
}

export function setMaskProps(id: Id, patch: Partial<Pick<LayerMask, 'enabled' | 'linked'>>, label: string): void {
  if (!findLayer(getState().doc.layers, id)?.mask) return;
  changeDoc(label, (doc) => {
    const x = findLayer(doc.layers, id);
    if (x?.mask) x.mask = { ...x.mask, ...patch };
  });
}

/** Layer > Layer mask > Enable mask. */
export function toggleMaskEnabled(id: Id = getState().activeLayerId): void {
  const m = findLayer(getState().doc.layers, id)?.mask;
  if (m) setMaskProps(id, { enabled: !m.enabled }, m.enabled ? 'Disable mask' : 'Enable mask');
}

/** Layer > Layer mask > Link mask to layer (the check mark between the thumbnails). */
export function toggleMaskLink(id: Id = getState().activeLayerId): void {
  const m = findLayer(getState().doc.layers, id)?.mask;
  if (m) setMaskProps(id, { linked: !m.linked }, m.linked ? 'Unlink mask' : 'Link mask to layer');
}

/** Layer > Layer mask > Show mask area: tints the masked part of the active layer. */
export function toggleShowMaskArea(): void {
  setState((s) => ({ showMaskArea: !s.showMaskArea }));
  engine.requestRender();
}

/** ⌘-click on a mask thumbnail: selects the area the mask shows. */
export function selectMaskArea(id: Id, op: SelectionOp = 'replace'): void {
  const m = findLayer(getState().doc.layers, id)?.mask;
  if (m) selectLayerOpacity(m.id, op, 'Select mask area');
}

/** Live preview of a CSS filter on the current layer (tonal correction dialogs). */
export class FilterPreview {
  private edit: DirectEdit | null = null;
  private lifted: HTMLCanvasElement | null = null;

  constructor() {
    const s = getState();
    if (editBlocker(s)) return;
    const target = editTarget(s)!;
    const surface = getSurface(target.surfaceId);
    if (!surface) return;
    this.edit = new DirectEdit(target.surfaceId, surface, (r) => engine.invalidate(r), 'filter');
    this.lifted = createCanvas(surface.width, surface.height);
    ctx2d(this.lifted).drawImage(this.edit.backup, 0, 0);
  }

  get ok(): boolean {
    return this.edit !== null;
  }

  /** Renders the layer with a CSS filter applied (inside the selection only, if there is one). */
  apply(filter: string): void {
    this.render((ctx, lifted) => {
      ctx.filter = filter || 'none';
      ctx.drawImage(lifted, 0, 0);
      ctx.filter = 'none';
    });
  }

  /** Renders the layer with a tonal correction applied (exact pixel maths, see paint/tonal.ts). */
  applyCorrection(c: Correction | null): void {
    this.render((ctx, lifted) => {
      if (!c) {
        ctx.drawImage(lifted, 0, 0);
        return;
      }
      this.original ??= ctx2d(lifted, true).getImageData(0, 0, lifted.width, lifted.height);
      const img = new ImageData(new Uint8ClampedArray(this.original.data), lifted.width, lifted.height);
      applyCorrection(img.data, c);
      const tmp = createCanvas(lifted.width, lifted.height);
      ctx2d(tmp).putImageData(img, 0, 0);
      ctx.drawImage(tmp, 0, 0);
    });
  }

  /** The layer's pixels before the preview (for histograms). */
  get pixels(): ImageData | null {
    if (!this.lifted) return null;
    this.original ??= ctx2d(this.lifted, true).getImageData(0, 0, this.lifted.width, this.lifted.height);
    return this.original;
  }

  private original: ImageData | null = null;

  private render(draw: (ctx: CanvasRenderingContext2D, lifted: HTMLCanvasElement) => void): void {
    const edit = this.edit;
    if (!edit || !this.lifted) return;
    const { width, height } = this.lifted;
    const sel = engine.selectionCanvas();
    const ctx = edit.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'copy';
    ctx.globalAlpha = 1;
    draw(ctx, this.lifted);
    if (sel) {
      // Outside the selection the original pixels stay.
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(sel, 0, 0);
      ctx.globalCompositeOperation = 'destination-over';
      const outside = createCanvas(width, height);
      const o = ctx2d(outside);
      o.drawImage(edit.backup, 0, 0);
      o.globalCompositeOperation = 'destination-out';
      o.drawImage(sel, 0, 0);
      ctx.drawImage(outside, 0, 0);
    }
    ctx.restore();
    edit.changed({ x: 0, y: 0, w: width, h: height });
  }

  commit(label: string): void {
    const patch = this.edit?.commit() ?? null;
    this.edit = null;
    commitPixels(label, [patch]);
  }

  cancel(): void {
    this.edit?.cancel();
    this.edit = null;
  }
}

/** Applies a tonal correction to the current layer in one step (e.g. Reverse gradient). */
export function applyCorrectionNow(c: Correction): void {
  const p = new FilterPreview();
  if (!p.ok) {
    setState({ hint: editBlocker() ?? '' });
    return;
  }
  p.applyCorrection(c);
  p.commit(correctionLabel(c.type));
}

/** Resizes the canvas, keeping the image anchored at the centre (Edit > Change canvas size). */
export function changeCanvasSize(width: number, height: number): void {
  const s = getState();
  const w = Math.round(width);
  const h = Math.round(height);
  if (w === s.doc.width && h === s.doc.height) return;
  resizeDocument('Change canvas size', w, h, (old) => {
    const c = createCanvas(w, h);
    ctx2d(c).drawImage(old, Math.round((w - old.width) / 2), Math.round((h - old.height) / 2));
    return c;
  });
}

/** Scales every layer (Edit > Change image resolution). */
export function changeImageResolution(width: number, height: number, dpi: number): void {
  const s = getState();
  const w = Math.round(width);
  const h = Math.round(height);
  if (w === s.doc.width && h === s.doc.height) {
    if (dpi !== s.doc.dpi) changeDoc('Change image resolution', (doc) => void (doc.dpi = dpi));
    return;
  }
  resizeDocument(
    'Change image resolution',
    w,
    h,
    (old) => {
      const c = createCanvas(w, h);
      const ctx = ctx2d(c);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(old, 0, 0, w, h);
      return c;
    },
    dpi,
  );
}

/** A mask after a canvas change: area that did not exist before hides nothing. */
function maskWithNewAreaVisible(old: HTMLCanvasElement, w: number, h: number, transform: (old: HTMLCanvasElement) => HTMLCanvasElement): HTMLCanvasElement {
  const solid = createCanvas(old.width, old.height);
  const sctx = ctx2d(solid);
  sctx.fillStyle = '#000';
  sctx.fillRect(0, 0, solid.width, solid.height);
  const out = createCanvas(w, h);
  const o = ctx2d(out);
  o.fillStyle = '#ffffff';
  o.fillRect(0, 0, w, h);
  o.globalCompositeOperation = 'destination-out';
  o.drawImage(transform(solid), 0, 0);
  o.globalCompositeOperation = 'source-over';
  o.drawImage(transform(old), 0, 0);
  return out;
}

function resizeDocument(label: string, w: number, h: number, transform: (old: HTMLCanvasElement) => HTMLCanvasElement, dpi?: number): void {
  const s = getState();
  const before = docState(s);
  const patches: PixelPatch[] = [];
  const masks = new Set(maskIds(s.doc.layers));
  for (const id of pixelIds(s.doc.layers)) {
    const surf = getSurface(id);
    if (!surf) continue;
    const b = ctx2d(surf, true).getImageData(0, 0, surf.width, surf.height);
    const next = masks.has(id) ? maskWithNewAreaVisible(surf, w, h, transform) : transform(surf);
    setSurface(id, next);
    patches.push({ layerId: id, rect: { x: 0, y: 0, w, h }, before: b, after: ctx2d(next, true).getImageData(0, 0, w, h) });
  }
  engine.compositor.resize(w, h);
  const doc = { ...structuredClone(s.doc), width: w, height: h, ...(dpi ? { dpi } : {}) };
  const selectionBefore = s.selection;
  setState({ doc, selection: null });
  commit({
    label,
    before,
    after: { doc, activeLayerId: s.activeLayerId },
    patches,
    selection: { before: selectionBefore, after: null },
    canvasSize: { before: { w: s.doc.width, h: s.doc.height }, after: { w, h } },
  });
  fitToWindow();
}

/** Crops the canvas to a rectangle (Selection launcher → Crop). */
export function cropCanvas(r: { x: number; y: number; w: number; h: number }): void {
  const s = getState();
  const w = Math.max(1, Math.round(r.w));
  const h = Math.max(1, Math.round(r.h));
  if (w === s.doc.width && h === s.doc.height && r.x === 0 && r.y === 0) return;
  const before = docState(s);
  const patches: PixelPatch[] = [];
  const beforeImages = new Map<Id, ImageData>();
  for (const id of pixelIds(s.doc.layers)) {
    const surf = getSurface(id);
    if (surf) beforeImages.set(id, ctx2d(surf, true).getImageData(0, 0, surf.width, surf.height));
  }
  engine.resizeCanvas(w, h, -Math.round(r.x), -Math.round(r.y));
  for (const id of pixelIds(s.doc.layers)) {
    const surf = getSurface(id);
    const b = beforeImages.get(id);
    if (!surf || !b) continue;
    const after = ctx2d(surf, true).getImageData(0, 0, w, h);
    patches.push({ layerId: id, rect: { x: 0, y: 0, w, h }, before: b, after });
  }
  const doc = { ...structuredClone(s.doc), width: w, height: h };
  const selectionBefore = s.selection;
  setState({ doc, selection: null });
  commit({
    label: 'Crop',
    before,
    after: { doc, activeLayerId: s.activeLayerId },
    patches,
    selection: { before: selectionBefore, after: null },
    canvasSize: { before: { w: s.doc.width, h: s.doc.height }, after: { w, h } },
  });
  fitToWindow();
}

// ------------------------------------------------------------------ pixel operations on the current layer

function withEditSurface(fn: (target: EditTarget, surface: HTMLCanvasElement) => PixelPatch | null, label: string): boolean {
  const s = getState();
  const blocker = editBlocker(s);
  const target = editTarget(s);
  if (blocker || !target) {
    setState({ hint: blocker ?? '' });
    return false;
  }
  const surface = getSurface(target.surfaceId);
  if (!surface) return false;
  const patch = fn(target, surface);
  if (patch) {
    engine.invalidate(patch.rect);
    commitPixels(label, [patch]);
  }
  return true;
}

/** Makes a mask show everything inside `area` (alpha), or everywhere when `area` is null. */
function revealMask(ctx: CanvasRenderingContext2D, area: HTMLCanvasElement | null): void {
  ctx.save();
  if (area) ctx.drawImage(area, 0, 0);
  else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
  ctx.restore();
}

/** Opaque everywhere except the selection. */
function outsideOf(sel: HTMLCanvasElement): HTMLCanvasElement {
  const c = createCanvas(sel.width, sel.height);
  const x = ctx2d(c);
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'destination-out';
  x.drawImage(sel, 0, 0);
  return c;
}

/** Delete key: clears the selection (or the whole layer). On a layer mask it unmasks instead. */
export function clearLayer(): void {
  const sel = engine.selectionCanvas();
  const bounds = getState().selection ? maskBounds(getState().selection!) : null;
  withEditSurface((target, surface) => {
    if (getState().selection && !bounds) return null;
    return captureLayerChange(target.surfaceId, surface, bounds, (ctx) => {
      if (target.isMask) revealMask(ctx, sel);
      else if (sel) {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.drawImage(sel, 0, 0);
        ctx.restore();
      } else ctx.clearRect(0, 0, surface.width, surface.height);
    });
  }, 'Clear');
}

export function clearOutsideSelection(): void {
  const sel = engine.selectionCanvas();
  if (!sel) return;
  withEditSurface(
    (target, surface) =>
      captureLayerChange(target.surfaceId, surface, null, (ctx) => {
        if (target.isMask) {
          revealMask(ctx, outsideOf(sel));
          return;
        }
        ctx.save();
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(sel, 0, 0);
        ctx.restore();
      }),
    'Clear outside selection',
  );
}

/** Edit > Fill: fills the selection (or the layer) with the drawing colour. */
export function fillWithColor(): void {
  const s = getState();
  const sel = engine.selectionCanvas();
  const bounds = s.selection ? maskBounds(s.selection) : null;
  const color = s.colors.active === 'main' ? s.colors.main : s.colors.sub;
  const ok = withEditSurface((target, surface) => {
    if (s.selection && !bounds) return null;
    const tmp = createCanvas(surface.width, surface.height);
    const t = ctx2d(tmp);
    t.fillStyle = color;
    t.fillRect(0, 0, tmp.width, tmp.height);
    if (sel) {
      t.globalCompositeOperation = 'destination-in';
      t.drawImage(sel, 0, 0);
    }
    return captureLayerChange(target.surfaceId, surface, bounds, (ctx) => {
      ctx.save();
      ctx.globalCompositeOperation = target.lockAlpha ? 'source-atop' : 'source-over';
      ctx.drawImage(tmp, 0, 0);
      ctx.restore();
    });
  }, 'Fill');
  if (ok && !editingMask(s)) addColorToHistory(color);
}

/** Flips the layer (and its linked mask, or a whole folder's layers) or the selected pixels. */
export function flipLayer(horizontal: boolean): void {
  const s = getState();
  const blocker = editBlocker(s);
  if (blocker) {
    setState({ hint: blocker });
    return;
  }
  const bounds = s.selection ? maskBounds(s.selection) : null;
  const sel = engine.selectionCanvas();
  const patches: (PixelPatch | null)[] = [];
  for (const id of movingSurfaces(s)) {
    const surface = getSurface(id);
    if (!surface) continue;
    const r = bounds ?? { x: 0, y: 0, w: surface.width, h: surface.height };
    const lifted = createCanvas(surface.width, surface.height);
    const l = ctx2d(lifted);
    l.drawImage(surface, 0, 0);
    if (sel) {
      l.globalCompositeOperation = 'destination-in';
      l.drawImage(sel, 0, 0);
    }
    patches.push(
      captureLayerChange(id, surface, r, (ctx) => {
        ctx.save();
        if (sel) {
          ctx.globalCompositeOperation = 'destination-out';
          ctx.drawImage(sel, 0, 0);
          ctx.globalCompositeOperation = 'source-over';
        } else ctx.clearRect(0, 0, surface.width, surface.height);
        withClip(ctx, r, () => {
          if (horizontal) ctx.setTransform(-1, 0, 0, 1, 2 * r.x + r.w, 0);
          else ctx.setTransform(1, 0, 0, -1, 0, 2 * r.y + r.h);
          ctx.drawImage(lifted, 0, 0);
        });
        ctx.restore();
      }),
    );
  }
  engine.invalidate();
  commitPixels(horizontal ? 'Flip horizontal' : 'Flip vertical', patches);
}

// ------------------------------------------------------------------ selection

export function setSelection(mask: Mask | null, label = 'Selection'): void {
  const before = getState().selection;
  const after = mask && !isMaskEmpty(mask) ? mask : null;
  if (!before && !after) return;
  setState({ selection: after });
  if (after) lastSelection = after;
  commit({ label, patches: [], selection: { before, after } });
}

let lastSelection: Mask | null = null;

/** Combines a new shape into the selection with the given operation. */
export function applySelection(shape: Mask, op: SelectionOp, label = 'Select'): void {
  setSelection(combine(getState().selection, shape, op), label);
}

export function selectAll(): void {
  const { doc } = getState();
  setSelection(rectMask(doc.width, doc.height, { x: 0, y: 0, w: doc.width, h: doc.height }), 'Select all');
}

export function deselect(): void {
  setSelection(null, 'Deselect');
}

export function reselect(): void {
  const { doc } = getState();
  if (lastSelection && lastSelection.width === doc.width && lastSelection.height === doc.height) setSelection(lastSelection, 'Reselect');
}

export function invertSelection(): void {
  const { doc, selection } = getState();
  setSelection(invertMask(selection ?? createMask(doc.width, doc.height)), 'Invert selected area');
}

export function growSelection(px: number): void {
  const { selection } = getState();
  if (selection && px !== 0) setSelection(expandMask(selection, px), px > 0 ? 'Expand selected area' : 'Shrink selected area');
}

/** Selects the opaque pixels of a surface (⌘-click on a layer or mask thumbnail). */
export function selectLayerOpacity(id: Id, op: SelectionOp = 'replace', label = 'Select layer opacity'): void {
  const s = getState();
  const surface = getSurface(id);
  if (!surface) return;
  const img = ctx2d(surface, true).getImageData(0, 0, surface.width, surface.height).data;
  const m = createMask(surface.width, surface.height);
  for (let i = 0, p = 3; i < m.data.length; i++, p += 4) m.data[i] = img[p];
  if (s.doc.width === m.width) applySelection(m, op, label);
}

// ------------------------------------------------------------------ tools

const SUBTOOLS_KEY = 'mad-paint:subtools';

export function setTool(tool: ToolId): void {
  if (getState().transforming) return;
  setState({ tool });
}

export function setSubTool(tool: ToolId, id: string): void {
  setState((s) => ({ tool, activeSub: { ...s.activeSub, [tool]: id } }));
}

export function updateSubTool(id: string, patch: Partial<SubTool>): void {
  setState((s) => ({
    subTools: s.subTools.map((t) =>
      t.id === id
        ? {
            ...t,
            ...patch,
            brush: patch.brush && t.brush ? { ...t.brush, ...patch.brush } : t.brush,
            fill: patch.fill && t.fill ? { ...t.fill, ...patch.fill } : t.fill,
          }
        : t,
    ),
  }));
  persistSubTools();
}

export function resetSubTool(id: string): void {
  const def = mergeSubTools([]).find((t) => t.id === id);
  if (!def) return;
  setState((s) => ({ subTools: s.subTools.map((t) => (t.id === id ? def : t)) }));
  persistSubTools();
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persistSubTools(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      const { subTools, activeSub, tool } = getState();
      localStorage.setItem(SUBTOOLS_KEY, JSON.stringify({ subTools, activeSub, tool }));
    } catch {
      // Storage unavailable.
    }
  }, 300);
}

export function restoreSubTools(): void {
  try {
    const raw = localStorage.getItem(SUBTOOLS_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as { subTools?: unknown; activeSub?: Record<string, string> };
    const subTools = mergeSubTools(saved.subTools);
    const activeSub = { ...getState().activeSub };
    for (const [tool, id] of Object.entries(saved.activeSub ?? {})) {
      if (subTools.some((t) => t.id === id && t.tool === tool)) activeSub[tool as ToolId] = id;
    }
    setState({ subTools, activeSub });
  } catch {
    // Ignore broken settings.
  }
}

/** Changes the brush size of the current sub tool by a factor or to an absolute value. */
export function setBrushSize(size: number): void {
  const sub = currentSubTool();
  if (!sub.brush) return;
  updateSubTool(sub.id, { brush: { ...sub.brush, size: Math.max(0.5, Math.min(2000, Math.round(size * 10) / 10)) } });
}

export function stepBrushSize(dir: 1 | -1): void {
  const sub = currentSubTool();
  if (!sub.brush) return;
  const steps = BRUSH_SIZE_PRESETS;
  const size = sub.brush.size;
  const next = dir > 0 ? steps.find((v) => v > size + 1e-6) ?? steps[steps.length - 1] : [...steps].reverse().find((v) => v < size - 1e-6) ?? steps[0];
  setBrushSize(next);
}

/** ⌘[ / ⌘] opacity, ⇧⌘O / ⇧⌘P brush density of the current tool, in steps. */
export function stepBrushValue(key: 'opacity' | 'flow', delta: number): void {
  const sub = currentSubTool();
  if (!sub.brush) return;
  const v = Math.round(Math.min(1, Math.max(key === 'flow' ? 0.01 : 0, sub.brush[key] + delta)) * 100) / 100;
  updateSubTool(sub.id, { brush: { ...sub.brush, [key]: v } });
}

/** "0": switches the fill / auto select tool between referring to the editing layer and to all layers. */
export function toggleReferMultiple(): void {
  const sub = currentSubTool();
  if (!sub.fill) return;
  updateSubTool(sub.id, { fill: { ...sub.fill, reference: sub.fill.reference === 'layer' ? 'all' : 'layer' } });
}

/** "," / ".": previous / next tool within the current tool group. */
export function cycleSubTool(dir: -1 | 1): void {
  const s = getState();
  const sub = currentSubTool(s);
  const list = s.subTools.filter((t) => t.tool === s.tool && (t.group ?? '') === (sub.group ?? ''));
  const i = list.findIndex((t) => t.id === sub.id);
  const next = list[(i + dir + list.length) % list.length];
  if (next) setSubTool(s.tool, next.id);
}

export const BRUSH_SIZE_PRESETS = [0.7, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10, 12, 15, 17, 20, 25, 30, 40, 50, 60, 70, 80, 100, 120, 150, 170, 200, 250, 300, 400, 500, 600, 700, 800, 1000, 1200, 1500, 1700, 2000];

// ------------------------------------------------------------------ colours

export function setColor(patch: Partial<ColorState>): void {
  setState((s) => ({ colors: { ...s.colors, ...patch } }));
}

/** Sets the colour of the active slot (main or sub) and leaves transparent mode. */
export function setDrawingColor(hex: string): void {
  setState((s) => ({ colors: { ...s.colors, [s.colors.active]: hex.toLowerCase(), transparent: false } }));
}

export function swapColors(): void {
  setState((s) => ({ colors: { ...s.colors, main: s.colors.sub, sub: s.colors.main } }));
}

export function toggleTransparentColor(): void {
  setState((s) => ({ colors: { ...s.colors, transparent: !s.colors.transparent } }));
}

export function setActiveColorSlot(active: 'main' | 'sub'): void {
  setState((s) => ({ colors: { ...s.colors, active, transparent: false } }));
}

export function addColorToHistory(hex: string): void {
  setState((s) => ({ colors: { ...s.colors, history: pushHistory(s.colors.history, hex) } }));
}

// ------------------------------------------------------------------ preferences

const PREFS_KEY = 'mad-paint:preferences';

export function setPreferences(patch: Partial<Preferences>): void {
  setState((s) => ({ prefs: { ...s.prefs, ...patch } }));
  const { prefs } = getState();
  engine.history.setMaxEntries(prefs.undoLevels);
  document.documentElement.dataset.theme = prefs.theme;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable.
  }
}

export function restorePreferences(): void {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const p = raw ? (JSON.parse(raw) as Partial<Preferences>) : {};
    const clean: Partial<Preferences> = {};
    if (p.theme === 'dark' || p.theme === 'light') clean.theme = p.theme;
    if (typeof p.rotationStep === 'number' && p.rotationStep > 0 && p.rotationStep <= 90) clean.rotationStep = p.rotationStep;
    if (typeof p.undoLevels === 'number' && p.undoLevels >= 1 && p.undoLevels <= 500) clean.undoLevels = Math.round(p.undoLevels);
    if (typeof p.holdMs === 'number' && p.holdMs >= 100 && p.holdMs <= 3000) clean.holdMs = p.holdMs;
    const curve = sanitizeCurve01(p.pressureCurve);
    if (curve) clean.pressureCurve = curve;
    setPreferences(clean);
  } catch {
    setPreferences({});
  }
}

// ------------------------------------------------------------------ view

/** Zoom in / out steps (the reference's scale list: 3200 % … 25 %, then halving down to 0.78 %). */
export const ZOOM_STEPS = [0.0078, 0.0156, 0.0313, 0.0625, 0.125, 0.25, 0.3333, 0.5, 0.6667, 1, 1.5, 2, 4, 8, 16, 32];
export const MIN_ZOOM = 0.0078;
export const MAX_ZOOM = 32;

export function setView(patch: Partial<ViewState>): void {
  setState((s) => ({ view: { ...s.view, ...patch } }));
}

/** Zooms so that the document point under `anchor` (viewport coords relative to centre) stays put. */
export function zoomTo(zoom: number, anchor: { x: number; y: number } = { x: 0, y: 0 }): void {
  const { view } = getState();
  const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
  const k = z / view.zoom;
  setView({ zoom: z, panX: anchor.x - (anchor.x - view.panX) * k, panY: anchor.y - (anchor.y - view.panY) * k });
}

export function zoomStep(dir: 1 | -1, anchor?: { x: number; y: number }): void {
  const z = getState().view.zoom;
  const next = dir > 0 ? ZOOM_STEPS.find((v) => v > z * 1.001) ?? MAX_ZOOM : [...ZOOM_STEPS].reverse().find((v) => v < z / 1.001) ?? MIN_ZOOM;
  zoomTo(next, anchor);
}

export function fitToWindow(): void {
  const { doc, viewport } = getState();
  const margin = 24;
  const z = Math.min((viewport.w - margin * 2) / doc.width, (viewport.h - margin * 2) / doc.height);
  setView({ ...initialView, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z)) });
}

export function actualPixels(): void {
  setView({ zoom: 1, panX: 0, panY: 0 });
}

/** Angle of View > Rotate left / right and the rotation buttons (Preferences, default 5°). */
export const rotationStep = () => getState().prefs.rotationStep;

/** Rotates the view around the viewport centre. */
export function rotateView(deltaDeg: number): void {
  const { view } = getState();
  setView({ rotation: Math.round(normalizeAngle(view.rotation + deltaDeg) * 100) / 100, ...rotatePan(view.panX, view.panY, deltaDeg) });
}

export function setRotation(deg: number): void {
  rotateView(normalizeAngle(deg - getState().view.rotation));
}

export function resetRotation(): void {
  setRotation(0);
}

/** View > Reset display: fit the canvas, no rotation, no flip. */
export function resetDisplay(): void {
  fitToWindow();
}

/** Mirrors the view (not the pixels) around the viewport's vertical or horizontal axis. */
export function flipView(horizontal: boolean): void {
  const { view } = getState();
  setView(
    horizontal
      ? { flipH: !view.flipH, rotation: normalizeAngle(-view.rotation), panX: -view.panX }
      : { flipV: !view.flipV, rotation: normalizeAngle(-view.rotation), panY: -view.panY },
  );
}
