/**
 * Light table (Animation cels palette, Animation > Light table): registering layers, image files
 * and onion skin images as light table layers of the target cel or the general light table, their
 * order, colour mode, opacity, flips and position, Move canvas to center, and locking the target
 * cel.
 */
import { animationFolders, celOf, type AnimationFolder } from '../model/animation';
import { cloneDocument, findLayer, flatten } from '../model/layers';
import type { Id, Layer, PaintDocument } from '../model/types';
import { onionCels, type OnionMode } from '../paint/animation';
import { betweenLights, insertLight, movedView, newLightLayer, rebaseLight, resetLight, type CanvasMove, type LightLayer } from '../paint/lightTable';
import { createCanvas, ctx2d } from '../engine/canvas';
import { setSurface } from '../engine/surfaces';
import * as actions from './actions';
import * as anim from './animationActions';
import { getState, setState, type PaintState, type ViewState } from './store';

/** Largest side of an image registered from a file (px). */
const MAX_IMAGE = 4096;

/** The target cel: the locked one, else the cel the current layer is (or lies in). */
export function targetCel(s: PaintState = getState()): { folder: AnimationFolder; cel: Layer } | null {
  if (s.lockedCel) {
    const c = celOf(s.doc.layers, s.lockedCel);
    if (c && c.cel.id === s.lockedCel) return c;
  }
  return celOf(s.doc.layers, s.activeLayerId);
}

/** The light table layers shown now: the target cel's (cel-specific) and the general ones, top first. */
export function shownLightLayers(s: PaintState = getState()): { folder: Id | null; layers: LightLayer[] } | null {
  if (!s.lightOn) return null;
  const target = targetCel(s);
  const cel = s.lightShowCel && target ? (target.cel.lightTable ?? []) : [];
  const general = s.lightShowGeneral ? (s.doc.lightTable?.general ?? []) : [];
  const layers = [...cel, ...general].filter((l) => l.source.kind === 'image' || findLayer(s.doc.layers, l.source.layer));
  return layers.length ? { folder: target?.folder.id ?? null, layers } : null;
}

/** Where a light table layer is registered: the cel it belongs to, or the general light table (null). */
function locateLight(doc: PaintDocument, id: string): { cel: Layer | null; layer: LightLayer } | null {
  const g = doc.lightTable?.general.find((l) => l.id === id);
  if (g) return { cel: null, layer: g };
  for (const l of flatten(doc.layers)) {
    const x = l.lightTable?.find((e) => e.id === id);
    if (x) return { cel: l, layer: x };
  }
  return null;
}

/** Changes one light table layer in place (in a document copy being edited). */
function editLight(doc: PaintDocument, id: string, fn: (l: LightLayer) => LightLayer | null): void {
  const at = locateLight(doc, id);
  if (!at) return;
  const apply = (list: LightLayer[]) => list.flatMap((l) => (l.id === id ? (fn(l) ?? []) : [l]));
  if (at.cel) {
    const cel = findLayer(doc.layers, at.cel.id)!;
    cel.lightTable = apply(cel.lightTable ?? []);
    if (cel.lightTable.length === 0) delete cel.lightTable;
  } else if (doc.lightTable) {
    doc.lightTable = { general: apply(doc.lightTable.general) };
    if (doc.lightTable.general.length === 0) delete doc.lightTable;
  }
}

/** Adds light table layers to the target cel's light table (or the general one). */
function register(layers: LightLayer[], label: string, general = false): void {
  if (layers.length === 0) return;
  const target = general ? null : targetCel();
  actions.changeDoc(label, (doc) => {
    const cel = target ? findLayer(doc.layers, target.cel.id) : null;
    if (cel) cel.lightTable = [...layers, ...(cel.lightTable ?? [])];
    else doc.lightTable = { general: [...layers, ...(doc.lightTable?.general ?? [])] };
  });
  setState({ lightSelection: layers[0].id, lightPicked: [], lightOn: true, ...(target ? { lightShowCel: true } : { lightShowGeneral: true }) });
}

/** Adds a light table layer at a place of the target cel's light table or the general one. */
function putLight(doc: PaintDocument, l: LightLayer, to: 'cel' | 'general', celId: Id | null, index: number): void {
  const cel = to === 'cel' && celId ? findLayer(doc.layers, celId) : null;
  if (cel) cel.lightTable = insertLight(cel.lightTable ?? [], l, index);
  else doc.lightTable = { general: insertLight(doc.lightTable?.general ?? [], l, index) };
}

/**
 * A layer dragged from the Layer palette onto the cel-specific or the general light table (at a
 * place in it). The cel-specific one needs a target cel; the target cel itself goes to the general one.
 */
export function registerLayerAt(id: Id, to: 'cel' | 'general', index = 0): void {
  const s = getState();
  const layer = findLayer(s.doc.layers, id);
  if (!layer) return;
  if (layer.kind === 'audio') {
    setState({ hint: 'Audio layers cannot be registered on the light table' });
    return;
  }
  const target = targetCel(s);
  if (to === 'cel' && !target) {
    setState({ hint: 'Select a cel of an animation folder first' });
    return;
  }
  const own = target && (target.cel.id === id || findLayer([target.cel], id));
  const where = own ? 'general' : to;
  const l = newLightLayer({ kind: 'layer', layer: id });
  actions.changeDoc('Register layer on light table', (doc) => putLight(doc, l, where, target?.cel.id ?? null, where === to ? index : 0));
  setState({ lightSelection: l.id, lightPicked: [], lightOn: true, ...(where === 'cel' ? { lightShowCel: true } : { lightShowGeneral: true }) });
}

/**
 * Reorder light table layers: one dragged to a place (`index` among the rows shown, itself
 * included) of the cel-specific or the general light table. One that shows the target cel cannot
 * go to the general light table.
 */
export function moveLight(id: string, to: 'cel' | 'general', index: number): void {
  const s = getState();
  const target = targetCel(s);
  const at = locateLight(s.doc, id);
  if (!at || (to === 'cel' && !target)) return;
  if (to === 'general' && target && at.layer.source.kind === 'layer' && at.layer.source.layer === target.cel.id) {
    setState({ hint: 'A light table layer showing the target cel cannot move to the general light table' });
    return;
  }
  // Within one list, the rows after it move up by one when it leaves.
  const list = to === 'cel' ? (target?.cel.lightTable ?? []) : (s.doc.lightTable?.general ?? []);
  const from = list.findIndex((l) => l.id === id);
  const place = from >= 0 && from < index ? index - 1 : index;
  if (from === place) return;
  actions.changeDoc('Reorder light table layers', (doc) => {
    editLight(doc, id, () => null);
    putLight(doc, at.layer, to, target?.cel.id ?? null, place);
  });
}

/**
 * Animation > Light table > Register selected layer: to the target cel's light table, or (when the
 * layer is the target cel itself, or there is none) to the general light table.
 */
export function registerSelectedLayer(): void {
  const s = getState();
  const layer = actions.activeLayer(s);
  if (!layer) return;
  if (layer.kind === 'audio') {
    setState({ hint: 'Audio layers cannot be registered on the light table' });
    return;
  }
  const target = targetCel(s);
  const own = target && (target.cel.id === layer.id || findLayer([target.cel], layer.id));
  register([newLightLayer({ kind: 'layer', layer: layer.id })], 'Register layer on light table', !target || Boolean(own));
}

/** Animation > Light table > Select and register file: an image, centred on the canvas. */
export async function registerFile(file: Blob, name: string): Promise<void> {
  const bitmap = await createImageBitmap(file);
  const k = Math.min(1, MAX_IMAGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * k));
  const h = Math.max(1, Math.round(bitmap.height * k));
  const canvas = createCanvas(w, h);
  const ctx = ctx2d(canvas);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const image = `img${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  setSurface(image, canvas);
  register([newLightLayer({ kind: 'image', image, name: name.replace(/\.[^.]+$/, '').slice(0, 120) || 'Image', w, h })], 'Register file on light table');
}

/** Animation > Light table > Register onion skin images: the cels the onion skin shows, in its colours. */
export function registerOnionSkins(): void {
  const s = getState();
  const target = targetCel(s);
  if (!target) {
    setState({ hint: 'Select a cel of an animation folder first' });
    return;
  }
  const o = s.onion;
  const { prev, next } = onionCels(target.folder.animation, s.frame, o.before, o.after);
  const make = (id: Id, color: string) => ({ ...newLightLayer({ kind: 'layer', layer: id }, color), mode: (o.mode === 'color' ? 'half' : o.mode) as OnionMode });
  const layers = [...prev.map((id) => make(id, o.prevColor)), ...next.map((id) => make(id, o.nextColor))];
  if (layers.length === 0) {
    setState({ hint: 'The onion skin shows no other cels at this frame' });
    return;
  }
  register(layers, 'Register onion skin images');
}

/** Deregister selected image from light table (every selected one). */
export function deregisterSelected(): void {
  const ids = selectedLights();
  if (ids.length === 0) return;
  actions.changeDoc('Deregister from light table', (doc) => ids.forEach((id) => editLight(doc, id, () => null)));
  setState({ lightSelection: null, lightPicked: [] });
}

/** Deregister all images from light table: the target cel's and the general ones. */
export function deregisterAll(): void {
  const target = targetCel();
  actions.changeDoc('Deregister all from light table', (doc) => {
    const cel = target ? findLayer(doc.layers, target.cel.id) : null;
    if (cel) delete cel.lightTable;
    delete doc.lightTable;
  });
  setState({ lightSelection: null, lightPicked: [] });
}

/** Every selected light table layer, the one clicked last at the end. */
export const selectedLights = (s: PaintState = getState()): string[] => [...s.lightPicked.filter((id) => id !== s.lightSelection), ...(s.lightSelection ? [s.lightSelection] : [])];

/** Selects a light table layer; `add` (Ctrl/⌘-click) adds it to the selection or takes it out. */
export function selectLight(id: string | null, add = false): void {
  if (!add || id === null) {
    setState({ lightSelection: id, lightPicked: [] });
    return;
  }
  const all = selectedLights();
  if (all.includes(id)) {
    const rest = all.filter((x) => x !== id);
    setState({ lightSelection: rest[rest.length - 1] ?? null, lightPicked: rest.slice(0, -1) });
  } else setState({ lightSelection: id, lightPicked: all });
}

/** Changes a light table layer (one undo step per label and key). */
export function updateLight(id: string, fn: (l: LightLayer) => LightLayer, label: string, key?: string): void {
  actions.changeDoc(label, (doc) => editLight(doc, id, fn), key ? { key } : {});
}

/** The selected light table layers, or (when `all`) every one shown. */
function targets(all: boolean): string[] {
  const s = getState();
  if (all) return shownLightLayers({ ...s, lightOn: true })?.layers.map((l) => l.id) ?? [];
  return selectedLights(s);
}

function editMany(ids: string[], fn: (l: LightLayer) => LightLayer, label: string, key?: string): void {
  if (ids.length === 0) {
    setState({ hint: 'Select a light table layer in the Animation cels palette' });
    return;
  }
  actions.changeDoc(label, (doc) => ids.forEach((id) => editLight(doc, id, fn)), key ? { key } : {});
}

/** Reset position of layers on light table: the selected ones (none selected: all). */
export function resetLightPosition(): void {
  const picked = targets(false);
  editMany(picked.length ? picked : targets(true), resetLight, 'Reset light table position');
}

/** Reverse layers horizontally / vertically on light table. */
export function flipLight(axis: 'h' | 'v'): void {
  editMany(targets(false), (l) => (axis === 'h' ? { ...l, flipH: !l.flipH } : { ...l, flipV: !l.flipV }), axis === 'h' ? 'Reverse light table layer horizontally' : 'Reverse light table layer vertically');
}

/** Opacity of the selected light table layer, or of all of them (Switch opacity target). */
export function setLightOpacity(opacity: number): void {
  const s = getState();
  editMany(targets(s.lightOpacityAll), (l) => ({ ...l, opacity }), 'Light table opacity', 'light:opacity');
}

/** Color mode and display colour of the selected light table layer. */
export function setLightMode(mode: OnionMode): void {
  editMany(targets(false), (l) => ({ ...l, mode }), 'Light table color mode');
}

export function setLightColor(color: string): void {
  editMany(targets(false), (l) => ({ ...l, color }), 'Light table color', 'light:color');
}

export const toggleLightTable = () => setState((s) => ({ lightOn: !s.lightOn }));
export const toggleShowCelLight = () => setState((s) => ({ lightShowCel: !s.lightShowCel }));
export const toggleShowGeneralLight = () => setState((s) => ({ lightShowGeneral: !s.lightShowGeneral }));
export const toggleLightOpacityAll = () => setState((s) => ({ lightOpacityAll: !s.lightOpacityAll }));

/** Lock current animation cel as editing target. */
export function toggleCelLock(): void {
  const s = getState();
  if (s.lockedCel) {
    setState({ lockedCel: null });
    return;
  }
  const c = celOf(s.doc.layers, s.activeLayerId);
  if (!c) setState({ hint: 'Select a cel of an animation folder first' });
  else setState({ lockedCel: c.cel.id });
}

/** Animation cels palette: Select previous / next cel (a locked target cel moves along). */
export function selectNeighbourCel(dir: -1 | 1): void {
  const s = getState();
  anim.selectNeighbourCel(dir);
  if (!s.lockedCel) return;
  const c = celOf(getState().doc.layers, getState().activeLayerId);
  if (c) setState({ lockedCel: c.cel.id });
}

// ------------------------------------------------------------------ Move canvas to center

/**
 * The two light table layers Move canvas to center works between: the two selected ones, else
 * the first two of the target cel's light table.
 */
export function centerPair(s: PaintState = getState()): [LightLayer, LightLayer] | null {
  const target = targetCel(s);
  const cel = target?.cel.lightTable ?? [];
  const shown = [...cel, ...(s.doc.lightTable?.general ?? [])];
  const picked = selectedLights(s)
    .map((id) => shown.find((l) => l.id === id))
    .filter((l): l is LightLayer => Boolean(l));
  if (picked.length === 2) return [picked[0], picked[1]];
  return cel.length >= 2 ? [cel[0], cel[1]] : null;
}

/** The light table layers of the target cel and the general ones, seen from the moved canvas. */
function rebaseLights(doc: PaintDocument, celId: Id | null, c: CanvasMove): void {
  const cel = celId ? findLayer(doc.layers, celId) : null;
  if (cel?.lightTable) cel.lightTable = cel.lightTable.map((l) => rebaseLight(l, c));
  if (doc.lightTable) doc.lightTable = { general: doc.lightTable.general.map((l) => rebaseLight(l, c)) };
}

let centering: { doc: PaintDocument; view: ViewState; cel: Id | null; pair: [LightLayer, LightLayer] } | null = null;

/**
 * Animation > Light table > Move canvas to center, while its slider moves: the canvas (the view)
 * at `t` (0…1) between the two light table layers, which stay where they are on screen. A preview
 * (no undo step) until finishCanvasCenter.
 */
export function previewCanvasCenter(t: number): void {
  const s = getState();
  if (!centering) {
    const pair = centerPair(s);
    if (!pair) return;
    centering = { doc: s.doc, view: s.view, cel: targetCel(s)?.cel.id ?? null, pair };
  }
  const c = betweenLights(centering.pair[0], centering.pair[1], t);
  const doc = cloneDocument(centering.doc);
  rebaseLights(doc, centering.cel, c);
  setState({ doc, view: movedView(centering.view, c) });
}

/** OK (`t`): the canvas stays there, the light table layers change in one undo step. Cancel (null): back as it was. */
export function finishCanvasCenter(t: number | null): void {
  const start = centering;
  centering = null;
  if (!start) {
    if (t !== null && centerPair()) {
      previewCanvasCenter(t);
      finishCanvasCenter(t);
    }
    return;
  }
  setState({ doc: start.doc, view: start.view });
  if (t === null) return;
  const c = betweenLights(start.pair[0], start.pair[1], t);
  actions.changeDoc('Move canvas to center', (doc) => rebaseLights(doc, start.cel, c));
  setState({ view: movedView(start.view, c) });
}

/** Window > Animation cels. */
export const showCelsPalette = () => setState((s) => (s.layerDockTab === 'animationCels' && !s.hiddenPalettes.includes('animationCels') ? { layerDockTab: 'layer' } : { layerDockTab: 'animationCels', hiddenPalettes: s.hiddenPalettes.filter((x) => x !== 'animationCels') }));

/** Whether the canvas has animation folders (the Animation cels palette needs one). */
export const hasAnimation = (s: PaintState = getState()) => animationFolders(s.doc.layers).length > 0;
