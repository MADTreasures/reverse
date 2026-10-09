/**
 * Light table (Animation cels palette, Animation > Light table): registering layers, image files
 * and onion skin images as light table layers of the target cel or the general light table, their
 * colour mode, opacity, flips and position, and locking the target cel.
 */
import { animationFolders, celOf, type AnimationFolder } from '../model/animation';
import { findLayer, flatten } from '../model/layers';
import type { Id, Layer, PaintDocument } from '../model/types';
import { onionCels, type OnionMode } from '../paint/animation';
import { newLightLayer, resetLight, type LightLayer } from '../paint/lightTable';
import { createCanvas, ctx2d } from '../engine/canvas';
import { setSurface } from '../engine/surfaces';
import * as actions from './actions';
import * as anim from './animationActions';
import { getState, setState, type PaintState } from './store';

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
  setState({ lightSelection: layers[0].id, lightOn: true, ...(target ? { lightShowCel: true } : { lightShowGeneral: true }) });
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

/** Deregister selected image from light table. */
export function deregisterSelected(): void {
  const id = getState().lightSelection;
  if (!id) return;
  actions.changeDoc('Deregister from light table', (doc) => editLight(doc, id, () => null));
  setState({ lightSelection: null });
}

/** Deregister all images from light table: the target cel's and the general ones. */
export function deregisterAll(): void {
  const target = targetCel();
  actions.changeDoc('Deregister all from light table', (doc) => {
    const cel = target ? findLayer(doc.layers, target.cel.id) : null;
    if (cel) delete cel.lightTable;
    delete doc.lightTable;
  });
  setState({ lightSelection: null });
}

export const selectLight = (id: string | null) => setState({ lightSelection: id });

/** Changes a light table layer (one undo step per label and key). */
export function updateLight(id: string, fn: (l: LightLayer) => LightLayer, label: string, key?: string): void {
  actions.changeDoc(label, (doc) => editLight(doc, id, fn), key ? { key } : {});
}

/** The selected light table layer, or (when `all`) every one shown. */
function targets(all: boolean): string[] {
  const s = getState();
  if (all) return shownLightLayers({ ...s, lightOn: true })?.layers.map((l) => l.id) ?? [];
  return s.lightSelection ? [s.lightSelection] : [];
}

function editMany(ids: string[], fn: (l: LightLayer) => LightLayer, label: string, key?: string): void {
  if (ids.length === 0) {
    setState({ hint: 'Select a light table layer in the Animation cels palette' });
    return;
  }
  actions.changeDoc(label, (doc) => ids.forEach((id) => editLight(doc, id, fn)), key ? { key } : {});
}

/** Reset position of layers on light table: the selected one (none selected: all). */
export function resetLightPosition(): void {
  const s = getState();
  editMany(s.lightSelection ? [s.lightSelection] : targets(true), resetLight, 'Reset light table position');
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

/** Window > Animation cels. */
export const showCelsPalette = () => setState((s) => ({ layerDockTab: s.layerDockTab === 'cels' ? 'layer' : 'cels' }));

/** Whether the canvas has animation folders (the Animation cels palette needs one). */
export const hasAnimation = (s: PaintState = getState()) => animationFolders(s.doc.layers).length > 0;
