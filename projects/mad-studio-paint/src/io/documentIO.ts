/** Open, save, import, export and autosave – the browser/Electron side of the document format. */
import { createRasterLayer, flatten, insertAbove, nextLayerName, pixelIds } from '../model/layers';
import { createDocument } from '../model/document';
import type { Id, PaintDocument } from '../model/types';
import { bytesToCanvas, canvasToBytes, createCanvas, ctx2d } from '../engine/canvas';
import { engine } from '../engine/engine';
import { ensureSurface, getSurface } from '../engine/surfaces';
import { native, openFiles, saveFile, type OpenedFile, type SavedFile } from '../platform/platform';
import * as actions from '../store/actions';
import { getState, setState, useStore } from '../store/store';
import { confirmDialog, toast } from '../ui/overlays';
import { EXTENSION, IMAGE_EXTENSIONS, isDocumentFileName, isImageFileName, mimeForName, packDocument, unpackDocument } from './format';
import { idbDelete, idbGet, idbSet } from './idb';

const DOC_FILTERS = [{ name: 'MAD Studio Paint Document', extensions: [EXTENSION] }];
const OPEN_FILTERS = [{ name: 'Documents and images', extensions: [EXTENSION, ...IMAGE_EXTENSIONS] }];
const AUTOSAVE_KEY = 'autosave';

let currentFile: SavedFile | null = null;

const baseName = (name: string) => name.replace(/\.[^.]+$/, '');

export async function confirmDiscard(): Promise<boolean> {
  if (!getState().dirty) return true;
  return confirmDialog('Unsaved changes', 'The current canvas has unsaved changes. Discard them?', 'Discard', true);
}

// ------------------------------------------------------------------ saving

/** Merged image of the document (optionally on paper, without draft layers). */
export function renderMerged(opts: { paper: boolean; skipDraft: boolean; scale?: number } = { paper: true, skipDraft: true }): HTMLCanvasElement {
  const { doc } = getState();
  const full = createCanvas(doc.width, doc.height);
  const ctx = ctx2d(full);
  const layers = createCanvas(doc.width, doc.height);
  engine.compositor.compose(doc, ctx2d(layers), { x: 0, y: 0, w: doc.width, h: doc.height }, { skipDraft: opts.skipDraft });
  if (opts.paper && doc.paper.visible) {
    ctx.fillStyle = doc.paper.color;
    ctx.fillRect(0, 0, doc.width, doc.height);
  }
  ctx.drawImage(layers, 0, 0);
  const scale = opts.scale ?? 1;
  if (scale === 1) return full;
  const out = createCanvas(Math.max(1, Math.round(doc.width * scale)), Math.max(1, Math.round(doc.height * scale)));
  const o = ctx2d(out);
  o.imageSmoothingQuality = 'high';
  o.drawImage(full, 0, 0, out.width, out.height);
  return out;
}

export async function buildDocumentBytes(): Promise<Uint8Array> {
  const { doc, activeLayerId } = getState();
  const layers = new Map<Id, Uint8Array>();
  for (const id of pixelIds(doc.layers)) {
    const s = getSurface(id);
    if (s) layers.set(id, await canvasToBytes(s));
  }
  const previewScale = Math.min(1, 512 / Math.max(doc.width, doc.height));
  const preview = await canvasToBytes(renderMerged({ paper: true, skipDraft: true, scale: previewScale }));
  return packDocument({ doc, activeLayerId, layers, preview });
}

export async function saveDocument(saveAs = false): Promise<boolean> {
  try {
    const bytes = await buildDocumentBytes();
    const name = `${getState().doc.name || 'Untitled'}.${EXTENSION}`;
    const saved = await saveFile(bytes, name, DOC_FILTERS, saveAs ? null : currentFile);
    if (!saved) return false;
    currentFile = saved;
    actions.markSaved(saved.name);
    void idbDelete(AUTOSAVE_KEY);
    toast(`Saved ${saved.name}`);
    return true;
  } catch (err) {
    toast(`Could not save: ${(err as Error).message}`, 'error');
    return false;
  }
}

// ------------------------------------------------------------------ opening

async function loadFromBytes(data: Uint8Array): Promise<{ doc: PaintDocument; images: Map<Id, HTMLCanvasElement>; activeLayerId: Id | null }> {
  const file = unpackDocument(data);
  const images = new Map<Id, HTMLCanvasElement>();
  await Promise.all(
    [...file.layers].map(async ([id, png]) => {
      try {
        images.set(id, await bytesToCanvas(png));
      } catch {
        // A damaged layer image leaves that layer empty.
      }
    }),
  );
  return { doc: file.doc, images, activeLayerId: file.activeLayerId };
}

/** Opens a .madpaint document or an image (as a new canvas). */
export async function openFileBytes(file: OpenedFile): Promise<boolean> {
  try {
    if (isDocumentFileName(file.name)) {
      const { doc, images, activeLayerId } = await loadFromBytes(file.data);
      actions.loadDocument(doc, images, file.name);
      if (activeLayerId && flatten(doc.layers).some((l) => l.id === activeLayerId)) setState({ activeLayerId });
      currentFile = file.path ? { name: file.name, path: file.path } : null;
    } else if (isImageFileName(file.name)) {
      const img = await bytesToCanvas(file.data, mimeForName(file.name));
      const doc = createDocument(baseName(file.name), img.width, img.height, 72);
      doc.layers[0].name = baseName(file.name);
      actions.loadDocument(doc, new Map([[doc.layers[0].id, img]]), null);
      currentFile = null;
    } else {
      toast(`Unsupported file: ${file.name}`, 'error');
      return false;
    }
    toast(`Opened ${file.name}`);
    return true;
  } catch (err) {
    toast(`Could not open ${file.name}: ${(err as Error).message}`, 'error');
    return false;
  }
}

export async function openDocument(): Promise<void> {
  if (!(await confirmDiscard())) return;
  const files = await openFiles(OPEN_FILTERS);
  if (files?.[0]) await openFileBytes(files[0]);
}

/** File > Import > Image: adds images as new layers, centred on the canvas. */
export async function importImages(files?: OpenedFile[] | null): Promise<void> {
  const list = files ?? (await openFiles([{ name: 'Images', extensions: IMAGE_EXTENSIONS }], true));
  if (!list) return;
  for (const f of list) {
    if (!isImageFileName(f.name)) continue;
    try {
      const img = await bytesToCanvas(f.data, mimeForName(f.name));
      const { doc } = getState();
      const layer = createRasterLayer(baseName(f.name) || nextLayerName(doc));
      const s = ensureSurface(layer.id, doc.width, doc.height);
      ctx2d(s).drawImage(img, Math.round((doc.width - img.width) / 2), Math.round((doc.height - img.height) / 2));
      actions.changeDoc('Import image', (d, st) => {
        insertAbove(d.layers, layer, st.activeLayerId);
        return layer.id;
      });
    } catch (err) {
      toast(`Could not import ${f.name}: ${(err as Error).message}`, 'error');
    }
  }
}

/**
 * Files dropped on the window. Like the reference: dropped on the layer palette, images become
 * layers; dropped anywhere else, the (first) image or document opens as the canvas.
 */
export async function handleDroppedFiles(files: File[], onLayerPalette = false): Promise<void> {
  const opened: OpenedFile[] = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
  const doc = opened.find((f) => isDocumentFileName(f.name));
  const images = opened.filter((f) => isImageFileName(f.name));
  if (onLayerPalette && images.length) {
    await importImages(images);
    return;
  }
  const first = doc ?? images[0];
  if (first && (await confirmDiscard())) await openFileBytes(first);
}

export function listenForNativeOpen(): void {
  native?.onOpenFile((file) => {
    void (async () => {
      if (await confirmDiscard()) await openFileBytes(file);
    })();
  });
}

// ------------------------------------------------------------------ export

export type ExportFormat = 'png' | 'jpeg' | 'webp';

export async function exportImage(format: ExportFormat, opts: { scale: number; transparent: boolean; quality: number; skipDraft: boolean }): Promise<boolean> {
  const mime = format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'image/webp';
  // JPEG has no alpha: always on paper (white if the paper is hidden).
  let canvas = renderMerged({ paper: !opts.transparent || format === 'jpeg', skipDraft: opts.skipDraft, scale: opts.scale });
  if (format === 'jpeg' && !getState().doc.paper.visible) {
    const flat = createCanvas(canvas.width, canvas.height);
    const f = ctx2d(flat);
    f.fillStyle = '#ffffff';
    f.fillRect(0, 0, flat.width, flat.height);
    f.drawImage(canvas, 0, 0);
    canvas = flat;
  }
  try {
    const bytes = await canvasToBytes(canvas, mime, format === 'png' ? undefined : opts.quality);
    const ext = format === 'jpeg' ? 'jpg' : format;
    const saved = await saveFile(bytes, `${getState().doc.name || 'Untitled'}.${ext}`, [{ name: format.toUpperCase(), extensions: [ext] }], null, mime);
    if (saved) toast(`Exported ${saved.name}`);
    return Boolean(saved);
  } catch (err) {
    toast(`Export failed: ${(err as Error).message}`, 'error');
    return false;
  }
}

// ------------------------------------------------------------------ autosave

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let autosaving = false;

/** Saves the session to IndexedDB a few seconds after the last change (crash/reload recovery). */
export function startAutosave(): void {
  useStore.subscribe((s, prev) => {
    if (!s.dirty || (s.canUndo === prev.canUndo && s.doc === prev.doc && s.canRedo === prev.canRedo && s.dirty === prev.dirty)) return;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => void autosaveNow(), 4000);
  });
}

async function autosaveNow(): Promise<void> {
  if (autosaving || !getState().dirty) return;
  if (getState().transforming) {
    autosaveTimer = setTimeout(() => void autosaveNow(), 4000);
    return;
  }
  autosaving = true;
  try {
    await idbSet(AUTOSAVE_KEY, { bytes: await buildDocumentBytes(), fileName: getState().fileName, time: Date.now() });
  } catch {
    // Best effort.
  } finally {
    autosaving = false;
  }
}

export async function restoreAutosave(): Promise<boolean> {
  const saved = await idbGet<{ bytes: Uint8Array; fileName: string | null }>(AUTOSAVE_KEY);
  if (!saved?.bytes) return false;
  try {
    const { doc, images, activeLayerId } = await loadFromBytes(saved.bytes);
    actions.loadDocument(doc, images, saved.fileName);
    if (activeLayerId && flatten(doc.layers).some((l) => l.id === activeLayerId)) setState({ activeLayerId });
    setState({ dirty: true });
    return true;
  } catch {
    await idbDelete(AUTOSAVE_KEY);
    return false;
  }
}

export async function newCanvas(name: string, width: number, height: number, dpi: number, paper: string): Promise<void> {
  if (!(await confirmDiscard())) return;
  actions.newDocument(name, width, height, dpi, paper);
  currentFile = null;
  void idbDelete(AUTOSAVE_KEY);
}
