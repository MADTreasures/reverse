/** Document operations. Every change that should be undoable goes through `commit`. */
import { celBlocker, celOf, isAnimationFolder, keyedTrackOf, nearestFrameOf, pruneTracks } from '../model/animation';
import { celAt } from '../paint/animation';
import { docLightImages } from '../paint/lightTable';
import { pruneSounds } from '../engine/sounds';
import { pushHistory } from '../model/color';
import { createDocument } from '../model/document';
import {
  cloneDocument,
  cloneLayer,
  createCorrectionLayer,
  createFolder,
  createGradientLayer,
  createLayerMask,
  createRasterLayer,
  createVectorLayer,
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
  nextRev,
  pixelIds,
  rasterLayers,
  removeLayer,
  shiftLayer as shiftLayerInTree,
  type DropPosition,
} from '../model/layers';
import type { AudioLayer, DrawnLayer, FolderLayer, GradientLayer, Id, Layer, LayerMask, PaintDocument, RasterLayer, RulerRange, TextLayer, VectorLayer } from '../model/types';
import { defaultPerspective, rulerLine, type Affine, type Ruler, type RulerInput } from '../paint/rulers';
import { eraseWhere, keepWhere, type VectorStroke } from '../paint/vector';
import { editable } from '../paint/vectorEdit';
import type { Rect } from '../paint/rect';
import { contentOf, EMPTY_CONTENT, idsTouching, objectIds, removeObjects, transformContent, type Content } from '../paint/objects';
import type { Balloon, TextBox } from '../paint/text';
import type { FrameBorder } from '../paint/frames';
import { fitTextBox } from '../engine/textRender';
import { sanitizeCurve01 } from '../paint/curve';
import type { LayerEffects } from '../paint/effects';
import { defaultTone, DOT_SHAPES, type ToneEffect } from '../paint/tone';
import type { GradientFill } from '../paint/gradient';
import { applyCorrection, correctionLabel, type Correction } from '../paint/tonal';
import { combine, createMask, expandMask, invertMask, isMaskEmpty, isSelected, maskBounds, rectMask, type Mask, type SelectionOp } from '../paint/mask';
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
  const doc = cloneDocument(s.doc);
  const active = fn(doc, s) ?? s.activeLayerId;
  // Cels that left their animation folder leave its track too.
  pruneTracks(doc);
  const activeLayerId = findLayer(doc.layers, active) ? active : flatten(doc.layers)[0]?.id ?? '';
  setState({ doc, activeLayerId, ...(activeLayerId !== s.activeLayerId ? { maskEditing: false, selectedObjects: [] } : {}) });
  commit({ label, before, after: { doc, activeLayerId }, patches: opts.patches ?? [], key: opts.key });
}

export function commitPixels(label: string, patches: (PixelPatch | null)[]): void {
  const list = patches.filter((p): p is PixelPatch => p !== null);
  if (list.length) commit({ label, patches: list });
}

function setActiveDoc(d: DocState): void {
  const changed = d.activeLayerId !== getState().activeLayerId;
  setState({ doc: d.doc, activeLayerId: d.activeLayerId, ...(changed ? { maskEditing: false, selectedObjects: [] } : {}) });
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
  engine.load(doc, images, docLightImages(doc));
  pruneSounds(new Set(doc.sound?.files.map((f) => f.id)));
  setState({
    textEdit: null,
    selectedObjects: [],
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
    frame: 1,
    playing: false,
    clipSelection: [],
    keySelection: [],
    lightSelection: null,
    lockedCel: null,
    graphSelection: [],
    ...(doc.timeline ? { timelineShown: true } : {}),
  });
  fitToWindow();
}

/**
 * File > New. An animated illustration gets a timeline (number of cels = frames, frame rate) and an
 * animation folder "A" with cel "1" on the first frame.
 */
export function newDocument(name: string, width: number, height: number, dpi: number, paperColor = '#ffffff', animation?: { cels: number; fps: number }): void {
  const doc = createDocument(name, width, height, dpi);
  doc.paper.color = paperColor;
  if (animation) {
    const cel = createRasterLayer('1');
    doc.layers = [createFolder('A', [cel], { animation: { cels: [{ frame: 1, cel: cel.id }] } })];
    doc.timeline = { enabled: true, fps: animation.fps, frames: animation.cels };
  }
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
  /** A vector layer: strokes become lines; the surface only shows them. */
  vector: boolean;
}

export function editTarget(s: PaintState = getState()): EditTarget | null {
  const l = activeLayer(s);
  if (!l) return null;
  if (s.maskEditing && l.mask) return { layer: l, surfaceId: l.mask.id, isMask: true, lockAlpha: false, vector: false };
  if (l.kind === 'raster') return { layer: l, surfaceId: l.id, isMask: false, lockAlpha: l.lockAlpha, vector: false };
  if (l.kind === 'vector') return { layer: l, surfaceId: l.id, isMask: false, lockAlpha: false, vector: true };
  return null;
}

/** Shows why an action is refused (in the status bar); true when it is. */
function blocked(reason: string | null): boolean {
  if (reason) setState({ hint: reason });
  return reason !== null;
}

/** Tools and commands that only work on pixels (fill, gradient, blend, filters) refuse vector layers. */
export function rasterOnlyBlocker(s: PaintState = getState()): string | null {
  return editTarget(s)?.vector ? 'This cannot be used on vector layers (Layer > Rasterize converts the layer)' : editBlocker(s);
}

/** True when the drawing tools edit the active layer's mask. */
export const editingMask = (s: PaintState = getState()): boolean => editTarget(s)?.isMask ?? false;

/** Why the current layer cannot be painted on, or null if it can. */
export function editBlocker(s: PaintState = getState()): string | null {
  const l = activeLayer(s);
  if (!l) return 'No layer selected';
  if (!editTarget(s)) {
    if (l.kind === 'text' || l.kind === 'gradient') return `${l.kind === 'text' ? 'Text' : 'Gradient'} layers cannot be drawn on (Layer > Rasterize converts the layer)`;
    if (isAnimationFolder(l)) return 'Select a cel to draw on, or make one with New animation cel';
    if (l.kind === 'audio') return 'Audio layers cannot be drawn on';
    return 'Select a raster layer to draw on (folders cannot be drawn on)';
  }
  if (isEffectivelyLocked(s.doc.layers, l.id)) return 'The layer is locked';
  if (!l.visible) return 'The layer is hidden';
  if (s.doc.timeline?.enabled && !s.editKeyed && keyedTrackOf(s.doc.layers, l.id))
    return 'Keyframes are on for this track: turn on Edit layers with active keyframes to draw on it (Timeline palette)';
  return celBlocker(s.doc, l.id, s.frame);
}

/** Why the active layer cannot be moved, flipped or transformed, or null. Text layers can be, although they cannot be drawn on. */
export function transformBlocker(s: PaintState = getState()): string | null {
  const kind = activeLayer(s)?.kind;
  return (kind === 'text' || kind === 'gradient') && !s.maskEditing ? objectBlocker(s) : editBlocker(s);
}

/** Selects a layer; with `mask`, its mask thumbnail (the mask becomes the drawing target). */
export function selectLayer(id: Id, mask = false): void {
  const s = getState();
  const l = findLayer(s.doc.layers, id);
  if (!l) return;
  setState({ activeLayerId: id, maskEditing: mask && Boolean(l.mask), ...(id !== s.activeLayerId ? { selectedObjects: [] } : {}) });
  // A cel that is not shown at the current frame: go to the nearest frame that shows it.
  const c = s.doc.timeline?.enabled && !s.playing ? celOf(s.doc.layers, id) : null;
  if (c && celAt(c.folder.animation, s.frame) !== c.cel.id) {
    const frame = nearestFrameOf(c.folder, c.cel.id, s.frame);
    if (frame !== null) setState({ frame });
  }
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
    if (x.kind === 'raster' || x.kind === 'vector' || x.kind === 'text' || x.kind === 'gradient') ids.push(x.id);
    if (x.mask?.linked) ids.push(x.mask.id);
  }
  return ids;
}

/** New layers go directly above the selected layer, or to the top of a selected folder. */
export function insertNew(doc: PaintDocument, layer: Layer, activeId: Id): void {
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
const LOCKED_PROPS = ['blend', 'opacity', 'clip', 'lockAlpha', 'reference', 'draft', 'volume'];

export function setLayerProps(id: Id, patch: Partial<RasterLayer> | Partial<FolderLayer> | Partial<AudioLayer>, label = 'Layer property', key?: string): void {
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
  const test = cloneDocument(getState().doc);
  if (!moveLayerInTree(test.layers, id, targetId, position)) return;
  changeDoc('Move layer', (doc) => {
    moveLayerInTree(doc.layers, id, targetId, position);
    return id;
  });
}

export function shiftLayer(delta: -1 | 1, id: Id = getState().activeLayerId): void {
  const test = cloneDocument(getState().doc);
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
  if (upper.kind === 'audio' || lower.kind === 'audio') return 'Audio layers cannot be merged';
  if (lower.kind === 'vector' && !linesMerge(upper)) return 'Lines merge into a vector layer only from a plain vector layer (rasterize the layer below first)';
  if (lower.kind !== 'raster' && lower.kind !== 'vector') return 'The layer below must be a raster layer';
  if (upper.locked || lower.locked) return 'Locked layers cannot be merged';
  if (!upper.visible || !lower.visible) return 'Hidden layers cannot be merged';
  if (upper.draft || lower.draft) return 'Draft layers cannot be merged';
  return null;
}

/** A vector layer whose lines can move into the vector layer below unchanged (nothing else affects their look). */
const linesMerge = (l: Layer): l is VectorLayer => l.kind === 'vector' && l.opacity === 1 && l.blend === 'normal' && !l.mask && !l.clip && !l.effects;

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
  if (upper && lower?.kind === 'vector' && linesMerge(upper)) {
    changeDoc('Merge with layer below', (doc) => {
      const below = findLayer(doc.layers, lower.id);
      if (below?.kind !== 'vector') return;
      below.strokes = [...below.strokes, ...upper.strokes];
      below.rev = nextRev();
      removeLayer(doc.layers, upper.id);
      return below.id;
    });
    return;
  }
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
  // Audio layers stay as they are.
  const merges = (l: Layer) => l.visible && !l.draft && l.kind !== 'audio';
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
    // The audio layers stay, above the picture.
    doc.layers = [...flatten(doc.layers).filter((l) => l.kind === 'audio'), target];
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

// ------------------------------------------------------------------ vector and text layers

/** A folder with comic frame panels. */
export type FrameFolder = FolderLayer & { frame: FrameBorder };
export const isFrameFolder = (l: Layer | null | undefined): l is FrameFolder => l?.kind === 'folder' && Boolean(l.frame);

/** Layers with objects for the Object tool: vector lines, text boxes and balloons, frame panels, a gradient. */
export type ObjectLayer = VectorLayer | TextLayer | FrameFolder | GradientLayer;
export const isObjectLayer = (l: Layer | null | undefined): l is ObjectLayer => l?.kind === 'vector' || l?.kind === 'text' || l?.kind === 'gradient' || isFrameFolder(l);

export function addVectorLayer(): Id {
  const layer = createVectorLayer(nextLayerName(getState().doc));
  changeDoc('New vector layer', (doc, s) => {
    insertNew(doc, layer, s.activeLayerId);
    return layer.id;
  });
  return layer.id;
}

/** Replaces the objects of a vector or text layer as one undo step (`key` merges slider drags). */
export function setLayerContent(layerId: Id, c: Content, label: string, key?: string): void {
  changeDoc(
    label,
    (doc) => {
      const l = findLayer(doc.layers, layerId);
      if (l) setContentIn(l, c);
    },
    { key },
  );
}

/** Puts new objects into a layer of a document copy (a frame folder without panels becomes a plain folder). */
function setContentIn(l: Layer, c: Content): void {
  if (l.kind === 'vector') {
    l.strokes = c.strokes;
    l.rev = nextRev();
  } else if (l.kind === 'text') {
    l.texts = c.texts;
    l.balloons = c.balloons;
    l.rev = nextRev();
  } else if (l.kind === 'folder' && l.frame) {
    if (c.panels.length) l.frame = { ...l.frame, panels: c.panels };
    else delete l.frame;
  } else if (l.kind === 'gradient' && c.gradient) {
    l.gradient = c.gradient;
    l.rev = nextRev();
  }
}

/** Replaces a vector layer's lines as one undo step; its pixels are rendered again from them. */
export const setVectorStrokes = (layerId: Id, strokes: VectorStroke[], label: string) => setLayerContent(layerId, { ...EMPTY_CONTENT, strokes }, label);

/**
 * Adds lines a tool drew to a vector layer (only their parts inside the selection). They are drawn
 * on top of the layer's pixels instead of rendering the whole layer again.
 */
export function addVectorLines(layerId: Id, lines: VectorStroke[], label: string): void {
  const s = getState();
  const l = findLayer(s.doc.layers, layerId);
  if (l?.kind !== 'vector') return;
  const sel = s.selection;
  const added = sel ? keepWhere(lines, (p) => isSelected(sel, p)) : lines;
  if (added.length === 0) return;
  engine.drawNewLines(l, added);
  setVectorStrokes(layerId, [...l.strokes, ...added], label);
}

/** The objects of the active vector or text layer selected with the Object tool. */
export function selectedObjectsOf(s: PaintState = getState()): { layer: ObjectLayer; ids: Set<string>; content: Content } | null {
  const l = activeLayer(s);
  if (!isObjectLayer(l) || s.selectedObjects.length === 0) return null;
  const content = contentOf(l);
  const present = new Set(objectIds(content));
  const ids = new Set(s.selectedObjects.filter((id) => present.has(id)));
  return ids.size ? { layer: l, ids, content } : null;
}

/** The selected lines of the active vector layer. */
export function selectedVectorLines(s: PaintState = getState()): { layer: VectorLayer; lines: VectorStroke[] } | null {
  const sel = selectedObjectsOf(s);
  if (sel?.layer.kind !== 'vector') return null;
  const lines = sel.content.strokes.filter((x) => sel.ids.has(x.id));
  return lines.length ? { layer: sel.layer, lines } : null;
}

/** The selected text boxes and balloons of the active text layer. */
export function selectedTextObjects(s: PaintState = getState()): { layer: TextLayer; texts: TextBox[]; balloons: Balloon[] } | null {
  const sel = selectedObjectsOf(s);
  if (sel?.layer.kind !== 'text') return null;
  return { layer: sel.layer, texts: sel.content.texts.filter((t) => sel.ids.has(t.id)), balloons: sel.content.balloons.filter((b) => sel.ids.has(b.id)) };
}

/** Object tool: selects objects of the active layer; `add` keeps the ones already selected. */
export function selectObjects(ids: string[], add = false): void {
  const cur = getState().selectedObjects;
  setState({ selectedObjects: add ? [...new Set([...cur, ...ids])] : ids });
}

/** Changes the selected objects (colour, width, font …), one undo step per slider drag (`key`). */
function updateSelected(change: (c: Content, ids: Set<string>) => Content, label: string, key?: string): void {
  const s = getState();
  const sel = selectedObjectsOf(s);
  if (!sel || blocked(objectBlocker(s))) return;
  setLayerContent(sel.layer.id, change(sel.content, sel.ids), label, key);
}

export const updateSelectedLines = (fn: (line: VectorStroke) => VectorStroke, label: string, key?: string) =>
  updateSelected((c, ids) => ({ ...c, strokes: c.strokes.map((x) => (ids.has(x.id) ? fn(x) : x)) }), label, key);

/** Text boxes keep fitting their text after a change (font, size …). */
export const updateSelectedTexts = (fn: (t: TextBox) => TextBox, label: string, key?: string) =>
  updateSelected((c, ids) => ({ ...c, texts: c.texts.map((x) => (ids.has(x.id) ? fitTextBox(fn(x)) : x)) }), label, key);

export const updateSelectedBalloons = (fn: (b: Balloon) => Balloon, label: string, key?: string) =>
  updateSelected((c, ids) => ({ ...c, balloons: c.balloons.map((x) => (ids.has(x.id) ? fn(x) : x)) }), label, key);

/** Why the objects of the active layer cannot be changed (locked or hidden layer), or null. */
export function objectBlocker(s: PaintState = getState()): string | null {
  const l = activeLayer(s);
  if (!l) return 'No layer selected';
  if (isEffectivelyLocked(s.doc.layers, l.id)) return 'The layer is locked';
  if (!l.visible) return 'The layer is hidden';
  return null;
}

/** Delete with the Object tool: removes the selected objects. */
export function deleteSelectedObjects(): void {
  const s = getState();
  const sel = selectedObjectsOf(s);
  if (!sel || blocked(objectBlocker(s))) return;
  setLayerContent(sel.layer.id, removeObjects(sel.content, sel.ids), sel.layer.kind === 'vector' ? 'Delete lines' : 'Delete');
  setState({ selectedObjects: [] });
}

/** Select > Select overlapping vectors / Select vectors within area (lines of the active vector layer). */
export function selectVectorsInSelection(within: boolean): void {
  const s = getState();
  const l = activeLayer(s);
  const sel = s.selection;
  if (l?.kind !== 'vector' || !sel) {
    setState({ hint: l?.kind !== 'vector' ? 'Select a vector layer first' : 'Make a selection first' });
    return;
  }
  const inside = (p: { x: number; y: number }) => isSelected(sel, p);
  const ids = l.strokes.filter((x) => (within ? eraseWhere([x], inside).length === 0 : keepWhere([x], inside).length > 0)).map((x) => x.id);
  setState({ selectedObjects: ids, tool: 'object', hint: `${ids.length} line${ids.length === 1 ? '' : 's'} selected` });
}

export const isVectorLayer = (id: Id, s: PaintState = getState()) => findLayer(s.doc.layers, id)?.kind === 'vector';

/**
 * Records moved or transformed pixels (patches) together with the new objects of vector and text
 * layers as one undo step (Move layer, Transform, Flip, Object tool). The tools already show
 * the new lines, so vector layers are not rendered again.
 */
export function commitTransform(label: string, patches: PixelPatch[], contents: Map<Id, Content>, selection?: { before: Mask | null; after: Mask | null }): void {
  const s = getState();
  const before = docState(s);
  let after: DocState | null = null;
  if (contents.size) {
    const doc = cloneDocument(s.doc);
    for (const [id, c] of contents) {
      const l = findLayer(doc.layers, id);
      if (!l) continue;
      if (l.kind === 'vector') engine.expectVectorLines(id, c.strokes);
      if (l.kind === 'folder') engine.previewFrame(id, null);
      setContentIn(l, c);
    }
    after = { doc, activeLayerId: s.activeLayerId };
    setState({ doc });
  }
  if (selection) setState({ selection: selection.after });
  if (!after && patches.length === 0 && !selection) return;
  commit({ label, ...(after ? { before, after } : {}), patches, ...(selection ? { selection } : {}) });
}

/** The objects a move or transform takes along: all, or those touching the selection. */
export function objectsToMove(l: ObjectLayer, selection: Mask | null): Set<string> {
  const c = contentOf(l);
  return selection ? idsTouching(c, (p) => isSelected(selection, p)) : new Set(objectIds(c));
}

/** Shows new objects of a vector or text layer while a tool changes them (lines only inside `r`). */
export function previewContent(l: ObjectLayer, c: Content, r: Rect | null): void {
  if (l.kind === 'vector') engine.renderVectorLines(l.id, c.strokes, r);
  else if (l.kind === 'text') engine.previewText(l, c);
  else if (l.kind === 'gradient') {
    if (c.gradient) engine.previewGradient(l, c.gradient);
  } else engine.previewFrame(l.id, c.panels);
}

/** Vector, text and gradient layers: their pixels are rendered from their content. */
export const isRenderedLayer = (l: Layer | null | undefined): l is VectorLayer | TextLayer | GradientLayer => l?.kind === 'vector' || l?.kind === 'text' || l?.kind === 'gradient';

/** Layer > Rasterize: a vector or text layer becomes a raster layer with the same pixels. */
export function rasterizeLayer(id: Id = getState().activeLayerId): void {
  const s = getState();
  const l = findLayer(s.doc.layers, id);
  if (!isRenderedLayer(l)) return;
  const src = getSurface(l.id);
  const raster = createRasterLayer(l.name, {
    visible: l.visible,
    opacity: l.opacity,
    blend: l.blend,
    clip: l.clip,
    reference: l.reference,
    draft: l.draft,
    ...(l.mask ? { mask: l.mask } : {}),
    ...(l.effects ? { effects: l.effects } : {}),
    ...(l.rulers ? { rulers: l.rulers } : {}),
  });
  const surface = ensureSurface(raster.id, s.doc.width, s.doc.height);
  if (src) ctx2d(surface).drawImage(src, 0, 0);
  changeDoc('Rasterize', (doc) => {
    const loc = locate(doc.layers, id);
    if (!loc) return;
    loc.siblings.splice(loc.index, 1, raster);
    return raster.id;
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

/** The ruler Draw along ruler uses: the selected one, else the only applicable one it can draw. */
export function rulerToDrawAlong(s: PaintState = getState()): Ruler | null {
  const size = { w: s.doc.width, h: s.doc.height };
  const list = activeRulers(s).filter((x) => rulerLine(x.ruler, size) !== null);
  const selected = list.find((x) => x.ruler.id === s.selectedRuler?.rulerId);
  return selected?.ruler ?? (list.length === 1 ? list[0].ruler : null);
}

/** Layer > Ruler/Frame > Ruler from vector: a curve ruler along each selected vector line (one undo step). */
export function rulerFromVector(): void {
  const sel = selectedVectorLines();
  if (!sel) {
    setState({ hint: 'Select vector lines with the Object tool first' });
    return;
  }
  const rulers: Ruler[] = sel.lines.map((line) => {
    const e = editable(line);
    return {
      kind: 'curve',
      id: newRulerId(),
      curve: e.curve === 'polyline' ? 'polyline' : 'spline',
      points: e.points.map(({ x, y }) => ({ x, y })),
      ...(e.corners?.length ? { corners: [...e.corners] } : {}),
    };
  });
  changeDoc('Ruler from vector', (doc) => {
    const l = findLayer(doc.layers, sel.layer.id);
    if (!l) return;
    l.rulers = { items: [...(l.rulers?.items ?? []), ...rulers], range: l.rulers?.range ?? 'all', visible: true };
  });
  setState({ selectedRuler: { layerId: sel.layer.id, rulerId: rulers[rulers.length - 1].id } });
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
  const doc = cloneDocument(s.doc);
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
  return sel ? { ...mask, outside: 'hide' } : mask;
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

/**
 * Layer > New layer > Tone: a layer filled with black and shown as a tone of the set density, with a
 * mask limited to the selection (everywhere without one), named after the tone like the reference.
 */
export function addToneLayer(tone: Pick<ToneEffect, 'frequency' | 'value' | 'shape' | 'angle'>): Id {
  const s = getState();
  const shape = DOT_SHAPES.find(([id]) => id === tone.shape)?.[1] ?? 'Circle';
  const layer = createRasterLayer(`${shape} ${tone.frequency.toFixed(1)} line ${Math.round(tone.value)}%`, {
    mask: maskFromSelection(),
    effects: { tone: defaultTone(s.doc.dpi, { ...tone, density: 'fixed', enabled: true }) },
  });
  const surface = ensureSurface(layer.id, s.doc.width, s.doc.height);
  const ctx = ctx2d(surface);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, surface.width, surface.height);
  touch(layer.id);
  changeDoc('New tone layer', (doc) => {
    insertNew(doc, layer, s.activeLayerId);
    return layer.id;
  });
  setState({ maskEditing: false });
  return layer.id;
}

/** A new gradient layer (gradient tool with "Gradient layer", Layer > New gradient layer), masked to the selection. */
export function addGradientLayer(fill: GradientFill): Id {
  const s = getState();
  const layer = createGradientLayer(nextLayerName(s.doc, 'Gradient'), fill, { mask: maskFromSelection() });
  changeDoc('New gradient layer', (doc) => {
    insertNew(doc, layer, s.activeLayerId);
    return layer.id;
  });
  setState({ maskEditing: false });
  return layer.id;
}

/** Layer > New gradient layer: from the main to the sub colour, top to bottom across the canvas. */
export function newGradientLayer(): Id {
  const { doc, colors } = getState();
  return addGradientLayer({
    stops: [
      { pos: 0, color: colors.main, opacity: 1 },
      { pos: 1, color: colors.sub, opacity: 1 },
    ],
    shape: 'line',
    edge: 'none',
    dither: true,
    a: { x: doc.width / 2, y: 0 },
    b: { x: doc.width / 2, y: doc.height },
  });
}

/** Changes a gradient layer's gradient (colours, shape, edge rule); `key` merges slider drags. */
export function setGradientFill(id: Id, patch: Partial<GradientFill>, label = 'Edit gradient', key?: string): void {
  const l = findLayer(getState().doc.layers, id);
  if (l?.kind !== 'gradient' || blocked(objectBlocker())) return;
  setLayerContent(id, { ...EMPTY_CONTENT, gradient: { ...l.gradient, ...patch } }, label, key);
}

/** Changes a correction layer's settings without an undo entry (dialog preview). */
export function previewCorrection(id: Id, correction: Correction): void {
  previewDoc((doc) => {
    const l = findLayer(doc.layers, id);
    if (l?.kind === 'correction') l.correction = correction;
  });
}

// ------------------------------------------------------------------ layer masks

function maskedLayer(id: Id): DrawnLayer | null {
  const s = getState();
  const l = findLayer(s.doc.layers, id);
  if (!l) return null;
  if (l.kind === 'audio') {
    setState({ hint: 'Audio layers have no layer mask' });
    return null;
  }
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
    const mask: LayerMask = outside ? { ...createLayerMask(), outside: 'hide' } : createLayerMask();
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
    if (rasterOnlyBlocker(s)) return;
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
    setState({ hint: rasterOnlyBlocker() ?? '' });
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
  const dx = Math.round((w - s.doc.width) / 2);
  const dy = Math.round((h - s.doc.height) / 2);
  resizeDocument(
    'Change canvas size',
    w,
    h,
    (old) => {
      const c = createCanvas(w, h);
      ctx2d(c).drawImage(old, Math.round((w - old.width) / 2), Math.round((h - old.height) / 2));
      return c;
    },
    undefined,
    [1, 0, 0, 1, dx, dy],
  );
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
    [w / s.doc.width, 0, 0, h / s.doc.height, 0, 0],
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

/** Applies `m` to the objects of every vector and text layer and frame (canvas size and resolution changes). */
function transformVectorLayers(doc: PaintDocument, m: Affine): void {
  const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
  for (const l of flatten(doc.layers)) {
    if (!isObjectLayer(l)) continue;
    // The whole image scales: letters, balloon outlines and frame lines too.
    setContentIn(l, transformContent(contentOf(l), null, m, { scaleText: true, scaleLine: true }));
    if (l.kind === 'folder' && l.frame) l.frame = { ...l.frame, lineWidth: l.frame.lineWidth * k };
  }
}

function resizeDocument(
  label: string,
  w: number,
  h: number,
  transform: (old: HTMLCanvasElement) => HTMLCanvasElement,
  dpi: number | undefined,
  vectorMap: Affine,
): void {
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
  const doc = { ...cloneDocument(s.doc), width: w, height: h, ...(dpi ? { dpi } : {}) };
  transformVectorLayers(doc, vectorMap);
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
  const doc = { ...cloneDocument(s.doc), width: w, height: h };
  transformVectorLayers(doc, [1, 0, 0, 1, -Math.round(r.x), -Math.round(r.y)]);
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
  const selection = getState().selection;
  const bounds = selection ? maskBounds(selection) : null;
  const t = editTarget();
  if (t?.vector && !editBlocker()) {
    // Lines inside the selection are erased (all lines without one).
    const l = t.layer.kind === 'vector' ? t.layer : null;
    if (l) setVectorStrokes(l.id, selection ? eraseWhere(l.strokes, (p) => isSelected(selection, p)) : [], 'Clear');
    return;
  }
  const active = activeLayer();
  if (active?.kind === 'text' && !getState().maskEditing) {
    // Text and balloons in the selection are removed (all of them without one).
    if (blocked(objectBlocker())) return;
    const c = contentOf(active);
    setLayerContent(active.id, selection ? removeObjects(c, idsTouching(c, (p) => isSelected(selection, p))) : EMPTY_CONTENT, 'Clear');
    return;
  }
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
  const t = editTarget();
  const selection = getState().selection;
  if (t?.vector && t.layer.kind === 'vector' && selection && !editBlocker()) {
    setVectorStrokes(t.layer.id, eraseWhere(t.layer.strokes, (p) => !isSelected(selection, p)), 'Clear outside selection');
    return;
  }
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
  if (editTarget(s)?.vector) {
    setState({ hint: rasterOnlyBlocker(s) ?? '' });
    return;
  }
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
  const blocker = transformBlocker(s);
  if (blocker) {
    setState({ hint: blocker });
    return;
  }
  const bounds = s.selection ? maskBounds(s.selection) : null;
  const sel = engine.selectionCanvas();
  const patches: (PixelPatch | null)[] = [];
  const area = bounds ?? { x: 0, y: 0, w: s.doc.width, h: s.doc.height };
  const cx = area.x + area.w / 2;
  const cy = area.y + area.h / 2;
  const flip: Affine = horizontal ? [-1, 0, 0, 1, 2 * cx, 0] : [1, 0, 0, -1, 0, 2 * cy];
  const contents = new Map<Id, Content>();
  const objectLayers = new Set<Id>();
  for (const id of movingSurfaces(s)) {
    const l = findLayer(s.doc.layers, id);
    if (!isObjectLayer(l)) continue;
    objectLayers.add(id);
    const flipped = transformContent(contentOf(l), objectsToMove(l, s.selection), flip);
    previewContent(l, flipped, null);
    contents.set(id, flipped);
  }
  for (const id of movingSurfaces(s).filter((x) => !objectLayers.has(x))) {
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
  commitTransform(horizontal ? 'Flip horizontal' : 'Flip vertical', patches.filter((p): p is PixelPatch => p !== null), contents);
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
