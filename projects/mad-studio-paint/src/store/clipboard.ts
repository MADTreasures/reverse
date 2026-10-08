/** Copy / cut / paste of pixels. An internal clipboard always works; the system clipboard is best effort. */
import { createRasterLayer, insertAbove, nextLayerName } from '../model/layers';
import { maskBounds } from '../paint/mask';
import { canvasToBlob, createCanvas, ctx2d } from '../engine/canvas';
import { engine } from '../engine/engine';
import { ensureSurface, getSurface } from '../engine/surfaces';
import * as actions from './actions';
import { getState } from './store';

interface Clip {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
}

let clip: Clip | null = null;

function copySelection(): Clip | null {
  const s = getState();
  const layer = actions.activeRaster(s);
  const surface = layer ? getSurface(layer.id) : null;
  if (!layer || !surface) return null;
  const r = s.selection ? maskBounds(s.selection) : { x: 0, y: 0, w: surface.width, h: surface.height };
  if (!r) return null;
  const c = createCanvas(r.w, r.h);
  const ctx = ctx2d(c);
  ctx.drawImage(surface, -r.x, -r.y);
  const sel = engine.selectionCanvas();
  if (sel) {
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(sel, -r.x, -r.y);
  }
  return { canvas: c, x: r.x, y: r.y };
}

async function writeSystemClipboard(c: HTMLCanvasElement): Promise<void> {
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return;
    const blob = await canvasToBlob(c);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  } catch {
    // Permission denied or unsupported: the internal clipboard still works.
  }
}

export function copy(): boolean {
  const c = copySelection();
  if (!c) return false;
  clip = c;
  void writeSystemClipboard(c.canvas);
  return true;
}

export function cut(): boolean {
  if (actions.editBlocker()) return false;
  if (!copy()) return false;
  actions.clearLayer();
  return true;
}

/** Pastes the internal clipboard (or a given image) as a new layer above the current one. */
export function pasteImage(image?: HTMLCanvasElement | ImageBitmap): boolean {
  const s = getState();
  const src = image ?? clip?.canvas;
  if (!src) return false;
  const x = image ? Math.round((s.doc.width - src.width) / 2) : clip!.x;
  const y = image ? Math.round((s.doc.height - src.height) / 2) : clip!.y;
  const layer = createRasterLayer(nextLayerName(s.doc));
  ctx2d(ensureSurface(layer.id, s.doc.width, s.doc.height)).drawImage(src, x, y);
  actions.changeDoc('Paste', (doc, st) => {
    insertAbove(doc.layers, layer, st.activeLayerId);
    return layer.id;
  });
  return true;
}

export const hasClip = () => clip !== null;

/** Selection launcher: copies the selected pixels into a new layer at the same position. */
export function copyAndPaste(): boolean {
  return copy() && pasteImage();
}

/** Selection launcher: moves the selected pixels into a new layer at the same position. */
export function cutAndPaste(): boolean {
  return cut() && pasteImage();
}
