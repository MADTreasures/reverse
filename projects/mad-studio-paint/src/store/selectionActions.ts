/**
 * Selection functions like the reference's: Select color gamut (picking colours on the canvas
 * while its dialog is open), Quick Mask (the selection painted as a red layer, back to a selection
 * when turned off), and selection layers (Convert to selection layer: a stored selection shown in
 * green; Convert selection layer to selection). Each change is one undo step.
 */
import { createRasterLayer, findLayer, flatten, nextLayerName, removeLayer } from '../model/layers';
import type { Id, Layer, RasterLayer } from '../model/types';
import { hexToRgb } from '../model/color';
import { floodFillMask } from '../paint/fill';
import { combine, maskFromAlpha, pixelsFromMask, type Mask } from '../paint/mask';
import type { FillReference } from '../paint/tools';
import { ctx2d } from '../engine/canvas';
import { ensureSurface, getSurface } from '../engine/surfaces';
import { referencePixels } from '../tools/reference';
import * as actions from './actions';
import { getState, setState } from './store';

// ------------------------------------------------------------------ Select color gamut

export type GamutType = 'new' | 'add' | 'delete';

export interface GamutSettings {
  /** Error margin of color, 0..100. */
  margin: number;
  /** Selection type: new selection, add to it, delete from it. */
  type: GamutType;
  /** Refer multiple: off reads the editing layer only; on, the layers `reference` names. */
  multiple: boolean;
  reference: FillReference;
}

export const DEFAULT_GAMUT: GamutSettings = { margin: 10, type: 'new', multiple: false, reference: 'all' };

/** A click on the canvas with the Select color gamut dialog open: every pixel of a similar colour (not saved in the history yet). */
export function pickColorGamut(x: number, y: number, o: GamutSettings): void {
  const s = getState();
  const { width: w, height: h } = s.doc;
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const pixels = referencePixels(s.doc, actions.editTarget(s)?.surfaceId ?? s.activeLayerId, o.multiple ? o.reference : 'layer');
  const picked = floodFillMask(pixels.data, w, h, x, y, { tolerance: o.margin, contiguous: false });
  const next = o.type === 'new' ? picked : combine(s.selection, picked, o.type === 'add' ? 'add' : 'subtract');
  setState({ selection: next.data.some((v) => v) ? next : null });
}

// ------------------------------------------------------------------ Quick Mask

/** Quick Mask red and selection layer green (own colours; the reference lets both be chosen). */
export const QUICK_MASK_COLOR = '#ff0000';
export const SELECTION_LAYER_COLOR = '#00b000';

const isQuickMask = (l: Layer): l is RasterLayer => l.kind === 'raster' && Boolean(l.quickMask);
export const quickMaskLayer = (layers = getState().doc.layers): RasterLayer | null => flatten(layers).find(isQuickMask) ?? null;

/** The layer being edited before the Quick Mask, to go back to. */
let beforeQuickMask: Id | null = null;

/** A new raster layer of one colour with the selection as its opacity, shown in that colour at 50 %. */
function layerFromSelection(name: string, color: string, flag: Partial<RasterLayer>): RasterLayer {
  const s = getState();
  const layer = createRasterLayer(name, { ...flag, opacity: 0.5, effects: { layerColor: { enabled: true, color, sub: color } } });
  const surface = ensureSurface(layer.id, s.doc.width, s.doc.height);
  if (s.selection) {
    const px = pixelsFromMask(s.selection, hexToRgb(color)!);
    ctx2d(surface).putImageData(new ImageData(px, s.doc.width, s.doc.height), 0, 0);
  }
  return layer;
}

/** The selection a layer's opacity makes. */
function maskOfLayer(id: Id): Mask | null {
  const s = getState();
  const surface = getSurface(id);
  if (!surface) return null;
  return maskFromAlpha(ctx2d(surface, true).getImageData(0, 0, s.doc.width, s.doc.height).data, s.doc.width, s.doc.height);
}

/**
 * Select > Quick Mask: on, the selection becomes a red layer at the top to paint on (any tool,
 * any colour; the eraser takes away); off, what is painted becomes the selection again.
 */
export function toggleQuickMask(): void {
  const s = getState();
  const qm = quickMaskLayer(s.doc.layers);
  if (qm) {
    const mask = maskOfLayer(qm.id);
    const back = beforeQuickMask && beforeQuickMask !== qm.id ? beforeQuickMask : null;
    actions.changeDoc(
      'Quick Mask',
      (doc) => {
        removeLayer(doc.layers, qm.id);
        return back && findLayer(doc.layers, back) ? back : undefined;
      },
      { selection: mask },
    );
    beforeQuickMask = null;
    return;
  }
  const layer = layerFromSelection('Quick mask', QUICK_MASK_COLOR, { quickMask: true });
  beforeQuickMask = s.activeLayerId;
  actions.changeDoc(
    'Quick Mask',
    (doc) => {
      doc.layers.unshift(layer);
      return layer.id;
    },
    { selection: null },
  );
}

// ------------------------------------------------------------------ selection layers

/** Select > Convert to selection layer: the selection kept as a layer (green), the selection itself goes. */
export function convertToSelectionLayer(): void {
  const s = getState();
  if (!s.selection) {
    setState({ hint: 'Make a selection first' });
    return;
  }
  const layer = layerFromSelection(nextLayerName(s.doc, 'Selection'), SELECTION_LAYER_COLOR, { selectionLayer: true });
  actions.changeDoc(
    'Convert to selection layer',
    (doc, st) => {
      actions.insertNew(doc, layer, st.activeLayerId);
      return layer.id;
    },
    { selection: null },
  );
}

export const isSelectionLayer = (l: Layer | null | undefined): boolean => l?.kind === 'raster' && Boolean(l.selectionLayer);

/** Layer > Convert selection layer to selection: the layer stays for later. */
export function selectionLayerToSelection(id: Id = getState().activeLayerId): void {
  const l = findLayer(getState().doc.layers, id);
  if (!isSelectionLayer(l)) {
    setState({ hint: 'Select a selection layer in the Layer palette' });
    return;
  }
  const mask = maskOfLayer(id);
  if (mask) actions.setSelection(mask, 'Convert selection layer to selection');
}
