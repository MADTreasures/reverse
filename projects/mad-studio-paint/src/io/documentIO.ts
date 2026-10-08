/** Open, save, import, export and autosave – the browser/Electron side of the document format. */
import { createRasterLayer, flatten, insertAbove, nextLayerName, pixelIds } from '../model/layers';
import { createDocument } from '../model/document';
import type { FolderLayer, Id, PaintDocument } from '../model/types';
import { bytesToCanvas, canvasToBytes, createCanvas, ctx2d } from '../engine/canvas';
import { framePath, strokeFrame } from '../engine/compositor';
import { engine } from '../engine/engine';
import { ensureSurface, getSurface } from '../engine/surfaces';
import { drawBalloons, drawTextBox, fitTextBox } from '../engine/textRender';
import { native, openFiles, saveFile, type OpenedFile, type SavedFile } from '../platform/platform';
import * as actions from '../store/actions';
import { getState, setState, useStore } from '../store/store';
import { confirmDialog, toast } from '../ui/overlays';
import { EXTENSION, IMAGE_EXTENSIONS, isDocumentFileName, isImageFileName, isPsdFileName, mimeForName, packDocument, PSD_EXTENSIONS, unpackDocument } from './format';
import { idbDelete, idbGet, idbSet } from './idb';
// Type only: the PSD code (and ag-psd) loads when a PSD is opened or saved.
import type { Pixels } from './psd';

const DOC_FILTERS = [{ name: 'MAD Studio Paint Document', extensions: [EXTENSION] }];
const OPEN_FILTERS = [{ name: 'Documents and images', extensions: [EXTENSION, ...PSD_EXTENSIONS, ...IMAGE_EXTENSIONS] }];
const PSD_FILTERS = [{ name: 'Photoshop document', extensions: ['psd'] }];
const PSD_MIME = 'image/vnd.adobe.photoshop';
const AUTOSAVE_KEY = 'autosave';

let currentFile: SavedFile | null = null;

const baseName = (name: string) => name.replace(/\.[^.]+$/, '');

export async function confirmDiscard(): Promise<boolean> {
  if (!getState().dirty) return true;
  return confirmDialog('Unsaved changes', 'The current canvas has unsaved changes. Discard them?', 'Discard', true);
}

// ------------------------------------------------------------------ saving

/** Merged image of the document (optionally on paper, without draft layers; a frame of the timeline). */
export function renderMerged(opts: { paper: boolean; skipDraft: boolean; scale?: number; frame?: number } = { paper: true, skipDraft: true }): HTMLCanvasElement {
  const { doc } = getState();
  const full = createCanvas(doc.width, doc.height);
  // The paper is part of the stack (blend modes and correction layers see it), unless left out.
  const paper = opts.paper && doc.paper.visible ? doc.paper.color : null;
  engine.compositor.compose(doc, ctx2d(full), { x: 0, y: 0, w: doc.width, h: doc.height }, { skipDraft: opts.skipDraft, paper, frame: opts.frame });
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

/** File > Save duplicate > .madpaint: a copy elsewhere; the open document keeps its file. */
export async function saveDuplicate(): Promise<boolean> {
  try {
    const bytes = await buildDocumentBytes();
    const saved = await saveFile(bytes, `${getState().doc.name || 'Untitled'} copy.${EXTENSION}`, DOC_FILTERS, null);
    if (saved) toast(`Saved a copy as ${saved.name}`);
    return Boolean(saved);
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

/** Opens a .madpaint document, a Photoshop document or an image (as a new canvas). */
export async function openFileBytes(file: OpenedFile): Promise<boolean> {
  try {
    if (isDocumentFileName(file.name)) {
      const { doc, images, activeLayerId } = await loadFromBytes(file.data);
      actions.loadDocument(doc, images, file.name);
      if (activeLayerId && flatten(doc.layers).some((l) => l.id === activeLayerId)) setState({ activeLayerId });
      currentFile = file.path ? { name: file.name, path: file.path } : null;
    } else if (isPsdFileName(file.name)) {
      const { decodePsd } = await import('./psd');
      const images = new Map<Id, HTMLCanvasElement>();
      const { doc, notes } = decodePsd(file.data, baseName(file.name), (id, p) => images.set(id, pixelsToCanvas(p)), fitTextBox);
      // Saving keeps everything in a .madpaint file; the PSD stays as it was.
      actions.loadDocument(doc, images, null);
      currentFile = null;
      if (notes.length) toast(`${notes.join('. ')}.`);
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
  const doc = opened.find((f) => isDocumentFileName(f.name) || isPsdFileName(f.name));
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

export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'psd';

const MIME: Record<ExportFormat, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', psd: PSD_MIME };

function pixelsOf(canvas: HTMLCanvasElement): Pixels {
  const img = ctx2d(canvas).getImageData(0, 0, canvas.width, canvas.height);
  return { width: img.width, height: img.height, data: img.data };
}

function pixelsToCanvas(p: Pixels): HTMLCanvasElement {
  const c = createCanvas(p.width, p.height);
  ctx2d(c).putImageData(new ImageData(p.data as Uint8ClampedArray<ArrayBuffer>, p.width, p.height), 0, 0);
  return c;
}

/**
 * File > Export (single layer). PSD: the merged image as one layer, or as Photoshop's background
 * ("Output as background", always on paper).
 */
export async function exportImage(format: ExportFormat, opts: { scale: number; transparent: boolean; quality: number; skipDraft: boolean; background?: boolean }): Promise<boolean> {
  const mime = MIME[format];
  // JPEG and a background layer have no alpha: always on paper (white if the paper is hidden).
  const opaque = format === 'jpeg' || (format === 'psd' && Boolean(opts.background));
  let canvas = renderMerged({ paper: !opts.transparent || opaque, skipDraft: opts.skipDraft, scale: opts.scale });
  if (opaque && !getState().doc.paper.visible) {
    const flat = createCanvas(canvas.width, canvas.height);
    const f = ctx2d(flat);
    f.fillStyle = '#ffffff';
    f.fillRect(0, 0, flat.width, flat.height);
    f.drawImage(canvas, 0, 0);
    canvas = flat;
  }
  try {
    const bytes =
      format === 'psd'
        ? (await import('./psd')).encodeFlatPsd(pixelsOf(canvas), getState().doc.dpi, Boolean(opts.background))
        : await canvasToBytes(canvas, mime, format === 'png' ? undefined : opts.quality);
    const ext = format === 'jpeg' ? 'jpg' : format;
    const saved = await saveFile(bytes, `${getState().doc.name || 'Untitled'}.${ext}`, [{ name: format.toUpperCase(), extensions: [ext] }], null, mime);
    if (saved) toast(`Exported ${saved.name}`);
    return Boolean(saved);
  } catch (err) {
    toast(`Export failed: ${(err as Error).message}`, 'error');
    return false;
  }
}

/** A frame border folder's panels (with their border line) as alpha, and the border line itself. */
function frameShapes(folder: FolderLayer): { area: Pixels; border: Pixels | null } {
  const { doc } = getState();
  const frame = folder.frame!;
  const path = framePath(frame.panels);
  const area = createCanvas(doc.width, doc.height);
  const a = ctx2d(area);
  a.fillStyle = '#000';
  a.fill(path, 'nonzero');
  strokeFrame(a, path, frame);
  if (!frame.draw || frame.lineWidth <= 0) return { area: pixelsOf(area), border: null };
  const border = createCanvas(doc.width, doc.height);
  strokeFrame(ctx2d(border), path, frame);
  return { area: pixelsOf(area), border: pixelsOf(border) };
}

/**
 * File > Save duplicate > .psd: a Photoshop document with the layers (see io/psd.ts). Like the
 * reference, draft layers are left out unless "Draft layers" is ticked.
 */
export async function exportPsd(opts: { skipDraft: boolean }): Promise<boolean> {
  try {
    const { encodePsd } = await import('./psd');
    const { doc } = getState();
    const surface = (id: Id) => {
      const s = getSurface(id);
      return s ? pixelsOf(s) : null;
    };
    const bytes = encodePsd({
      doc,
      frame: getState().frame,
      composite: pixelsOf(renderMerged({ paper: true, skipDraft: opts.skipDraft })),
      skipDraft: opts.skipDraft,
      layerPixels: (l) => surface(l.id),
      bakedPixels: (l) => pixelsOf(engine.compositor.layerImage(doc, l, { skipDraft: opts.skipDraft })),
      maskPixels: (m) => surface(m.id),
      frameShapes,
      textPixels: (_layer, part) => {
        const c = createCanvas(doc.width, doc.height);
        if (part === 'balloons') drawBalloons(ctx2d(c), _layer.balloons);
        else drawTextBox(ctx2d(c), part);
        return pixelsOf(c);
      },
    });
    const saved = await saveFile(bytes, `${doc.name || 'Untitled'}.psd`, PSD_FILTERS, null, PSD_MIME);
    if (saved) toast(`Saved a copy as ${saved.name}`);
    return Boolean(saved);
  } catch (err) {
    toast(`Could not save: ${(err as Error).message}`, 'error');
    return false;
  }
}

// ------------------------------------------------------------------ animation

export type AnimationFormat = 'gif' | 'apng' | 'sequence';

export interface AnimationExportOptions {
  format: AnimationFormat;
  width: number;
  height: number;
  /** Timeline frames to export and the frame rate of the result. */
  start: number;
  end: number;
  fps: number;
  /** Times the animation plays (0: endlessly). */
  plays: number;
  dither: boolean;
  transparent: boolean;
  drafts: boolean;
  /** Image sequence: file names and type. */
  sequence: { prefix: string; suffix: string; separator: string; startNumber: number; type: 'png' | 'jpeg' };
}

/** A canvas on white (formats without transparency, with the paper hidden). */
function onWhite(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const flat = createCanvas(canvas.width, canvas.height);
  const f = ctx2d(flat);
  f.fillStyle = '#ffffff';
  f.fillRect(0, 0, flat.width, flat.height);
  f.drawImage(canvas, 0, 0);
  return flat;
}

/** File > Export animation: animated GIF, animated PNG (APNG) or an image sequence (ZIP). */
export async function exportAnimation(o: AnimationExportOptions): Promise<boolean> {
  const { doc } = getState();
  const t = doc.timeline;
  if (!t) {
    toast('The canvas has no timeline', 'error');
    return false;
  }
  try {
    const { encodeApng, encodeGif, exportFrames, frameDelays, sequenceNames, zipSequence } = await import('./animationExport');
    const frames = exportFrames(o.start, o.end, t.fps, o.fps);
    const transparent = o.transparent && !(o.format === 'sequence' && o.sequence.type === 'jpeg');
    const scale = o.width / doc.width;
    // Each timeline frame is drawn once, even when it is shown several times.
    const drawn = new Map<number, HTMLCanvasElement>();
    const draw = (f: number) => {
      let c = drawn.get(f);
      if (!c) {
        c = renderMerged({ paper: !transparent, skipDraft: !o.drafts, scale, frame: f });
        if (!transparent && !doc.paper.visible) c = onWhite(c);
        drawn.set(f, c);
      }
      return c;
    };
    let bytes: Uint8Array;
    let name: string;
    let filter: { name: string; extensions: string[] };
    let mime: string;
    const base = doc.name || 'Untitled';
    if (o.format === 'sequence') {
      const ext = o.sequence.type === 'jpeg' ? 'jpg' : 'png';
      const names = sequenceNames(frames.length, { ...o.sequence, start: o.sequence.startNumber, ext });
      const files = [];
      for (let i = 0; i < frames.length; i++) files.push({ name: names[i], data: await canvasToBytes(draw(frames[i]), o.sequence.type === 'jpeg' ? 'image/jpeg' : 'image/png', 0.92) });
      bytes = zipSequence(files);
      name = `${base}.zip`;
      filter = { name: 'Image sequence (ZIP)', extensions: ['zip'] };
      mime = 'application/zip';
    } else {
      const pixels = frames.map((f) => pixelsOf(draw(f)));
      if (o.format === 'gif') {
        bytes = encodeGif(pixels, { delays: frameDelays(pixels.length, o.fps, 10), plays: o.plays, transparent, dither: o.dither });
        name = `${base}.gif`;
        filter = { name: 'Animated GIF', extensions: ['gif'] };
        mime = 'image/gif';
      } else {
        bytes = encodeApng(pixels, frameDelays(pixels.length, o.fps, 1), o.plays);
        name = `${base}.png`;
        filter = { name: 'Animated PNG', extensions: ['png', 'apng'] };
        mime = 'image/apng';
      }
    }
    const saved = await saveFile(bytes, name, [filter], null, mime);
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

export async function newCanvas(name: string, width: number, height: number, dpi: number, paper: string, animation?: { cels: number; fps: number }): Promise<void> {
  if (!(await confirmDiscard())) return;
  actions.newDocument(name, width, height, dpi, paper, animation);
  currentFile = null;
  void idbDelete(AUTOSAVE_KEY);
}
