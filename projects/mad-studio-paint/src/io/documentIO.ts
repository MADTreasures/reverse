/** Open, save, import, export and autosave – the browser/Electron side of the document format. */
import { createRasterLayer, flatten, insertAbove, nextLayerName, pixelIds } from '../model/layers';
import { createDocument } from '../model/document';
import type { FolderLayer, Id, Layer, PaintDocument } from '../model/types';
import { bytesToCanvas, canvasToBytes, createCanvas, ctx2d } from '../engine/canvas';
import { framePath, strokeFrame } from '../engine/compositor';
import { engine } from '../engine/engine';
import { ensureSurface, getSurface } from '../engine/surfaces';
import { drawBalloons, drawTextBox, fitTextBox } from '../engine/textRender';
import { native, openFiles, saveFile, type OpenedFile, type SavedFile } from '../platform/platform';
import * as actions from '../store/actions';
import { getState, setState, useStore } from '../store/store';
import { confirmDialog, toast } from '../ui/overlays';
import { SEQUENCE_EXT, sequenceNames, type SequenceType } from './sequence';
import { expressColors, IMAGE_FORMATS, jpegWithDpi, outputSize, type ExpressionColor, type ImageFormat, type OutputSize } from './imageExport';
import { pngWithDpi } from './png';
import { maskBounds } from '../paint/mask';
import { hardenMask } from '../paint/effects';
import { EXTENSION, IMAGE_EXTENSIONS, isDocumentFileName, isImageFileName, isPsdFileName, mimeForName, packDocument, PSD_EXTENSIONS, unpackDocument } from './format';
import { idbDelete, idbGet, idbSet } from './idb';
import { docLightImages } from '../paint/lightTable';
import { clearSounds, mixSound, setSoundBytes, soundBytes } from '../engine/sounds';
import { hasSound, soundMix } from '../model/animation';
import { usedMovieFiles, usedSoundFiles } from '../store/soundActions';
import { clearMovies, movieBytes, prepareMovieFrame, setMovieBytes } from '../engine/movies';
// Type only: the PSD code (and ag-psd) loads when a PSD is opened or saved.
import type { Pixels } from './psd';
import { areaRect, safeRect, type DrawingArea, type FrameRect, type OutputFrame } from '../paint/outputFrame';

const DOC_FILTERS = [{ name: 'MAD Studio Paint Document', extensions: [EXTENSION] }];
const OPEN_FILTERS = [{ name: 'Documents and images', extensions: [EXTENSION, ...PSD_EXTENSIONS, ...IMAGE_EXTENSIONS] }];
const PSD_FILTERS = [{ name: 'Photoshop document', extensions: ['psd'] }];
const PSB_FILTERS = [{ name: 'Photoshop big document', extensions: ['psb'] }];
const PSD_MIME = 'image/vnd.adobe.photoshop';
const AUTOSAVE_KEY = 'autosave';

let currentFile: SavedFile | null = null;

const baseName = (name: string) => name.replace(/\.[^.]+$/, '');

export async function confirmDiscard(): Promise<boolean> {
  if (!getState().dirty) return true;
  return confirmDialog('Unsaved changes', 'The current canvas has unsaved changes. Discard them?', 'Discard', true);
}

// ------------------------------------------------------------------ saving

/**
 * Merged image of the document (optionally on paper, without draft or text layers; a frame of the
 * timeline): an area of the canvas, scaled (or brought to `size`).
 */
export function renderMerged(
  opts: { paper: boolean; skipDraft: boolean; skipText?: boolean; scale?: number; size?: { w: number; h: number }; frame?: number; camera?: boolean; area?: FrameRect; frameLines?: boolean } = {
    paper: true,
    skipDraft: true,
  },
): HTMLCanvasElement {
  const { doc } = getState();
  const full = createCanvas(doc.width, doc.height);
  // The paper is part of the stack (blend modes and correction layers see it), unless left out.
  const paper = opts.paper && doc.paper.visible ? doc.paper.color : null;
  const filter = opts.skipText ? (l: Layer) => l.kind !== 'text' : undefined;
  engine.compositor.compose(doc, ctx2d(full), { x: 0, y: 0, w: doc.width, h: doc.height }, { skipDraft: opts.skipDraft, paper, frame: opts.frame, camera: opts.camera, filter });
  if (opts.frameLines && doc.outputFrame) drawExportFrameLines(ctx2d(full), doc.outputFrame);
  // Drawing area: part of the canvas (the output frame or the overflow frame), scaled.
  const area = opts.area ?? { x: 0, y: 0, w: doc.width, h: doc.height };
  const scale = opts.scale ?? 1;
  const w = opts.size?.w ?? Math.max(1, Math.round(area.w * scale));
  const h = opts.size?.h ?? Math.max(1, Math.round(area.h * scale));
  if (w === doc.width && h === doc.height && area.x === 0 && area.y === 0 && area.w === doc.width && area.h === doc.height) return full;
  const out = createCanvas(w, h);
  const o = ctx2d(out);
  o.imageSmoothingQuality = 'high';
  o.drawImage(full, area.x, area.y, area.w, area.h, 0, 0, out.width, out.height);
  return out;
}

/** Waits until the movie layers' pictures at a timeline frame are decoded (exports draw exact pictures). */
async function prepareMovies(frame: number): Promise<void> {
  const { doc } = getState();
  const fps = doc.timeline?.fps ?? 24;
  const waits: Promise<void>[] = [];
  for (const l of flatten(doc.layers)) {
    if (l.kind !== 'movie') continue;
    const clip = l.clips.find((c) => frame >= c.start && frame <= c.end);
    if (clip) waits.push(prepareMovieFrame(l.movie, (clip.offset ?? 0) + (frame - clip.start) / fps));
  }
  await Promise.all(waits);
}

/** Export frames: the overflow and output frames in black, the title-safe area in grey. */
function drawExportFrameLines(ctx: CanvasRenderingContext2D, f: OutputFrame): void {
  ctx.save();
  ctx.lineWidth = 1;
  const line = (r: FrameRect, color: string) => {
    ctx.strokeStyle = color;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  };
  if (f.overflow) line(f.overflow, '#000000');
  line(f, '#000000');
  const safe = safeRect(f);
  if (safe) line(safe, '#808080');
  ctx.restore();
}

export async function buildDocumentBytes(): Promise<Uint8Array> {
  const { doc, activeLayerId } = getState();
  const layers = new Map<Id, Uint8Array>();
  for (const id of [...pixelIds(doc.layers), ...docLightImages(doc)]) {
    const s = getSurface(id);
    if (s) layers.set(id, await canvasToBytes(s));
  }
  // The sound files the audio layers play (deleted layers' files stay in memory for undo, not in the file).
  const used = usedSoundFiles(doc);
  const files = (doc.sound?.files ?? []).filter((f) => used.has(f.id));
  const sounds = new Map<Id, Uint8Array>();
  for (const f of files) {
    const b = soundBytes(f.id);
    if (b) sounds.set(f.id, b.bytes);
  }
  // The movie files the movie layers show.
  const shownMovies = usedMovieFiles(doc);
  const movieFiles = (doc.movies ?? []).filter((m) => shownMovies.has(m.id));
  const movies = new Map<Id, Uint8Array>();
  for (const m of movieFiles) {
    const b = movieBytes(m.id);
    if (b) movies.set(m.id, b.bytes);
  }
  const previewScale = Math.min(1, 512 / Math.max(doc.width, doc.height));
  const preview = await canvasToBytes(renderMerged({ paper: true, skipDraft: true, scale: previewScale }));
  return packDocument({ doc: { ...doc, sound: files.length ? { files } : undefined, movies: movieFiles.length ? movieFiles : undefined }, activeLayerId, layers, sounds, movies, preview });
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
  // The sound files come back before the document shows.
  clearSounds();
  for (const f of file.doc.sound?.files ?? []) {
    const bytes = file.sounds?.get(f.id);
    if (bytes) setSoundBytes(f.id, bytes, f.type);
  }
  clearMovies();
  for (const m of file.doc.movies ?? []) {
    const bytes = file.movies?.get(m.id);
    if (!bytes) continue;
    setMovieBytes(m.id, bytes, m.type);
    // Its sound plays like an audio clip.
    setSoundBytes(m.id, bytes, m.type);
  }
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

function pixelsOf(canvas: HTMLCanvasElement): Pixels {
  const img = ctx2d(canvas).getImageData(0, 0, canvas.width, canvas.height);
  return { width: img.width, height: img.height, data: img.data };
}

function pixelsToCanvas(p: Pixels): HTMLCanvasElement {
  const c = createCanvas(p.width, p.height);
  ctx2d(c).putImageData(new ImageData(p.data as Uint8ClampedArray<ArrayBuffer>, p.width, p.height), 0, 0);
  return c;
}

/** Export range: the entire canvas, the selection's bounding box, or the output frame. */
export type ExportRange = 'canvas' | 'selection' | 'output';

/** File > Export (single layer): what the export settings dialog sets. */
export interface ImageExportOptions {
  format: ImageFormat;
  /** JPEG, and WebP with Prioritize file size: 0…1. */
  quality: number;
  /** WebP: Prioritize quality (lossless). */
  lossless: boolean;
  /** Photoshop file settings: Output as background. */
  background: boolean;
  /** Output image: draft layers, text layers. */
  drafts: boolean;
  text: boolean;
  range: ExportRange;
  color: ExpressionColor;
  /** Export transparency (PNG, WebP). */
  transparent: boolean;
  size: OutputSize;
}

/** The canvas rectangle an export range covers. */
export function exportArea(range: ExportRange): FrameRect {
  const { doc, selection } = getState();
  const whole = { x: 0, y: 0, w: doc.width, h: doc.height };
  if (range === 'output' && doc.outputFrame) return areaRect(doc.outputFrame, 'output', doc.width, doc.height);
  if (range === 'selection' && selection) return maskBounds(selection) ?? whole;
  return whole;
}

/** The image an export writes (before encoding) and its resolution. */
export function renderExport(o: ImageExportOptions): { canvas: HTMLCanvasElement; dpi: number } {
  const { doc } = getState();
  const area = exportArea(o.range);
  const out = outputSize(o.size, area.w, area.h, doc.dpi);
  // WebP is always 72 dpi (as in the reference).
  const dpi = o.format === 'webp' ? 72 : out.dpi;
  const transparent = o.transparent && IMAGE_FORMATS[o.format].transparency;
  // A Photoshop layer keeps what the canvas leaves transparent; the other formats are flat on paper.
  const layer = (o.format === 'psd' || o.format === 'psb') && !o.background;
  let canvas = renderMerged({ paper: !transparent, skipDraft: !o.drafts, skipText: !o.text, size: { w: out.width, h: out.height }, area });
  if (!transparent && !layer && !getState().doc.paper.visible) canvas = onWhite(canvas);
  if (o.color !== 'auto' && o.color !== 'rgb') {
    const p = pixelsOf(canvas);
    expressColors(p, o.color, dpi);
    canvas = pixelsToCanvas(p);
  }
  return { canvas, dpi };
}

/** The file bytes of an export. */
export async function encodeExport(canvas: HTMLCanvasElement, dpi: number, o: ImageExportOptions): Promise<Uint8Array> {
  switch (o.format) {
    case 'png':
      return pngWithDpi(await canvasToBytes(canvas, 'image/png'), dpi);
    case 'jpeg':
      return jpegWithDpi(await canvasToBytes(canvas, 'image/jpeg', o.quality), dpi);
    case 'webp':
      return webpBytes(canvas, o.lossless, o.quality);
    case 'bmp':
      return (await import('./imageFormats')).encodeBmp(pixelsOf(canvas), dpi);
    case 'tiff':
      return (await import('./imageFormats')).encodeTiff(pixelsOf(canvas), false, dpi);
    case 'tga':
      return (await import('./imageFormats')).encodeTga(pixelsOf(canvas), false);
    default:
      return (await import('./psd')).encodeFlatPsd(pixelsOf(canvas), dpi, o.background, o.format === 'psb');
  }
}

/** Saves an export's bytes under the canvas's name. */
export async function saveExport(bytes: Uint8Array, format: ImageFormat): Promise<boolean> {
  const f = IMAGE_FORMATS[format];
  const saved = await saveFile(bytes, `${getState().doc.name || 'Untitled'}.${f.ext}`, [{ name: f.name, extensions: [f.ext] }], null, f.mime);
  if (saved) toast(`Exported ${saved.name}`);
  return Boolean(saved);
}

/** File > Export (single layer) > format: the merged image with the export settings. */
export async function exportImage(o: ImageExportOptions): Promise<boolean> {
  try {
    const { canvas, dpi } = renderExport(o);
    return await saveExport(await encodeExport(canvas, dpi, o), o.format);
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
 * File > Save duplicate > .psd / .psb: a Photoshop (big) document with the layers (see io/psd.ts).
 * Like the reference, draft layers are left out unless "Draft layers" is ticked.
 */
export async function exportPsd(opts: { skipDraft: boolean; psb?: boolean }): Promise<boolean> {
  try {
    const { encodePsd } = await import('./psd');
    const { doc } = getState();
    const surface = (id: Id) => {
      const s = getSurface(id);
      return s ? pixelsOf(s) : null;
    };
    const bytes = encodePsd(
      {
        doc,
        frame: getState().frame,
        composite: pixelsOf(renderMerged({ paper: true, skipDraft: opts.skipDraft })),
        skipDraft: opts.skipDraft,
        // A movie layer: its picture at the current frame.
        layerPixels: (l) => (l.kind === 'movie' ? pixelsOf(engine.compositor.layerImage(doc, { ...l, mask: undefined, effects: undefined }, { frame: getState().frame })) : surface(l.id)),
        bakedPixels: (l) => pixelsOf(engine.compositor.layerImage(doc, l, { skipDraft: opts.skipDraft })),
        // Mask expression without gradients: the mask as it shows.
        maskPixels: (m) => {
          const p = surface(m.id);
          if (p && m.gradients === false) hardenMask(p.data, m.threshold ?? 128);
          return p;
        },
        frameShapes,
        textPixels: (_layer, part) => {
          const c = createCanvas(doc.width, doc.height);
          if (part === 'balloons') drawBalloons(ctx2d(c), _layer.balloons);
          else drawTextBox(ctx2d(c), part);
          return pixelsOf(c);
        },
      },
      opts.psb,
    );
    const ext = opts.psb ? 'psb' : 'psd';
    const saved = await saveFile(bytes, `${doc.name || 'Untitled'}.${ext}`, opts.psb ? PSB_FILTERS : PSD_FILTERS, null, PSD_MIME);
    if (saved) toast(`Saved a copy as ${saved.name}`);
    return Boolean(saved);
  } catch (err) {
    toast(`Could not save: ${(err as Error).message}`, 'error');
    return false;
  }
}

// ------------------------------------------------------------------ animation

export type AnimationFormat = 'gif' | 'apng' | 'webp' | 'sequence';

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
  /** Apply 2D camera effects. */
  camera: boolean;
  /** Drawing area: the output frame, the overflow frame or the entire canvas. */
  area: DrawingArea;
  /** Image sequence: draw the frame lines (Export frames). */
  frameLines?: boolean;
  /** APNG: Delete blank spaces (crop to what is drawn) and Color reduction (256 colours). */
  cropBlank?: boolean;
  reduceColors?: boolean;
  /** Animated WebP: Prioritize quality (lossless) or file size (lossy at `quality`, 0…1). */
  webp?: { lossless: boolean; quality: number };
  /** Image sequence: file names, type and (JPEG, WebP) quality. */
  sequence: { prefix: string; suffix: string; separator: string; startNumber: number; type: SequenceType; quality?: number; lossless?: boolean };
}

/**
 * A still WebP picture. Lossless at quality 1 (the browser's convention); lossy otherwise (at most
 * 0.99, which the browser would take as lossless).
 */
async function webpBytes(canvas: HTMLCanvasElement, lossless: boolean, quality: number): Promise<Uint8Array> {
  const bytes = await canvasToBytes(canvas, 'image/webp', lossless ? 1 : Math.max(0.01, Math.min(0.99, quality)));
  // Browsers without a WebP encoder return PNG.
  if (String.fromCharCode(...bytes.subarray(8, 12)) !== 'WEBP') throw new Error('this system cannot encode WebP pictures');
  return bytes;
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

/**
 * File > Export animation: animated GIF, animated sticker (APNG, always transparent), animated
 * WebP or an image sequence (ZIP).
 */
export async function exportAnimation(o: AnimationExportOptions): Promise<boolean> {
  const { doc } = getState();
  const t = doc.timeline;
  if (!t) {
    toast('The canvas has no timeline', 'error');
    return false;
  }
  try {
    const { cropPixels, drawnArea, encodeApng, encodeGif, exportFrames, frameDelays, zipSequence } = await import('./animationExport');
    const frames = exportFrames(o.start, o.end, t.fps, o.fps);
    const type = o.sequence.type;
    // BMP and JPEG have no alpha; stickers (APNG) always keep it.
    const transparent = o.format === 'apng' || (o.transparent && !(o.format === 'sequence' && (type === 'jpeg' || type === 'bmp')));
    const area = areaRect(doc.outputFrame, o.area, doc.width, doc.height);
    const scale = o.width / area.w;
    // Each timeline frame is drawn once, even when it is shown several times.
    const drawn = new Map<number, HTMLCanvasElement>();
    const draw = async (f: number) => {
      let c = drawn.get(f);
      if (!c) {
        await prepareMovies(f);
        c = renderMerged({ paper: !transparent, skipDraft: !o.drafts, scale, frame: f, camera: o.camera, area, frameLines: o.format === 'sequence' && o.frameLines });
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
      const { encodeBmp, encodeTga, encodeTiff } = await import('./imageFormats');
      const ext = SEQUENCE_EXT[type];
      const names = sequenceNames(frames.length, { ...o.sequence, start: o.sequence.startNumber, ext });
      const quality = o.sequence.quality ?? 0.92;
      const encode = async (c: HTMLCanvasElement): Promise<Uint8Array> => {
        if (type === 'png') return canvasToBytes(c, 'image/png');
        if (type === 'jpeg') return canvasToBytes(c, 'image/jpeg', quality);
        if (type === 'webp') return webpBytes(c, o.sequence.lossless ?? true, quality);
        if (type === 'bmp') return encodeBmp(pixelsOf(c), doc.dpi);
        if (type === 'tiff') return encodeTiff(pixelsOf(c), transparent, doc.dpi);
        return encodeTga(pixelsOf(c), transparent);
      };
      // A frame shown several times is encoded once.
      const encoded = new Map<number, Uint8Array>();
      const files = [];
      for (let i = 0; i < frames.length; i++) {
        let data = encoded.get(frames[i]);
        if (!data) encoded.set(frames[i], (data = await encode(await draw(frames[i]))));
        files.push({ name: names[i], data });
      }
      bytes = zipSequence(files, type === 'bmp' || type === 'tiff' || type === 'tga');
      name = `${base}.zip`;
      filter = { name: 'Image sequence (ZIP)', extensions: ['zip'] };
      mime = 'application/zip';
    } else if (o.format === 'webp') {
      const { muxAnimatedWebp } = await import('./webp');
      const delays = frameDelays(frames.length, o.fps, 1);
      const encoded = new Map<number, Uint8Array>();
      const parts = [];
      for (let i = 0; i < frames.length; i++) {
        let data = encoded.get(frames[i]);
        if (!data) encoded.set(frames[i], (data = await webpBytes(await draw(frames[i]), o.webp?.lossless ?? true, o.webp?.quality ?? 1)));
        parts.push({ data, duration: delays[i] });
      }
      const first = await draw(frames[0]);
      bytes = muxAnimatedWebp(parts, first.width, first.height, o.plays, transparent);
      name = `${base}.webp`;
      filter = { name: 'Animated WebP', extensions: ['webp'] };
      mime = 'image/webp';
    } else {
      let pixels = [];
      for (const f of frames) pixels.push(pixelsOf(await draw(f)));
      if (o.format === 'gif') {
        bytes = encodeGif(pixels, { delays: frameDelays(pixels.length, o.fps, 10), plays: o.plays, transparent, dither: o.dither });
        name = `${base}.gif`;
        filter = { name: 'Animated GIF', extensions: ['gif'] };
        mime = 'image/gif';
      } else {
        // Delete blank spaces: every frame cropped to what any of them shows.
        const drawnRect = o.cropBlank ? drawnArea(pixels) : null;
        if (drawnRect) pixels = pixels.map((p) => cropPixels(p, drawnRect));
        bytes = encodeApng(pixels, frameDelays(pixels.length, o.fps, 1), o.plays, o.reduceColors);
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

export interface MovieOptions {
  format: 'mp4' | 'mov';
  /** Width of the movie (the height keeps the drawing area's aspect ratio; both even). */
  width: number;
  /** Drawing area: the output frame, the overflow frame or the entire canvas. */
  area: DrawingArea;
  start: number;
  end: number;
  fps: number;
  /** Apply 2D camera effects. */
  camera: boolean;
  sampleRate: number;
  channels: number;
}

/** File > Export animation > Movie: MP4 or QuickTime with the sound of the audio tracks. */
export async function exportMovie(o: MovieOptions, progress?: (done: number, total: number) => void): Promise<boolean> {
  const { doc } = getState();
  const t = doc.timeline;
  if (!t) {
    toast('The canvas has no timeline', 'error');
    return false;
  }
  try {
    const { exportFrames } = await import('./animationExport');
    const { chooseCodecs, encodeMovie, evenSize } = await import('./movie');
    const area = areaRect(doc.outputFrame, o.area, doc.width, doc.height);
    const w = evenSize(o.width);
    const h = evenSize(Math.round((o.width * area.h) / area.w));
    const sound = hasSound(doc) ? soundMix(doc) : undefined;
    const codecs = await chooseCodecs(o.format, w, h, o.fps, o.sampleRate, o.channels, Boolean(sound));
    if (!codecs) {
      toast('This system cannot encode MP4 video: export a MOV movie instead', 'error');
      return false;
    }
    const scale = w / area.w;
    // Frames shown several times in a row are drawn once.
    let last: { frame: number; canvas: HTMLCanvasElement } | null = null;
    const render = async (frame: number) => {
      if (last?.frame !== frame) {
        await prepareMovies(frame);
        last = { frame, canvas: renderMerged({ paper: true, skipDraft: true, scale, frame, camera: o.camera, area }) };
      }
      return last.canvas;
    };
    const bytes = await encodeMovie({
      format: o.format,
      codecs,
      width: w,
      height: h,
      fps: o.fps,
      frames: exportFrames(o.start, o.end, t.fps, o.fps),
      channels: o.channels,
      render,
      mix: () => mixSound(sound, o.start, o.end, t.fps, codecs.sampleRate, o.channels),
      progress,
    });
    const base = doc.name || 'Untitled';
    const filter = o.format === 'mp4' ? { name: 'MPEG-4 movie', extensions: ['mp4'] } : { name: 'QuickTime movie', extensions: ['mov'] };
    const saved = await saveFile(bytes, `${base}.${o.format}`, [filter], null, o.format === 'mp4' ? 'video/mp4' : 'video/quicktime');
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

export async function newCanvas(name: string, width: number, height: number, dpi: number, paper: string, animation?: { cels: number; fps: number }, outputFrame?: OutputFrame): Promise<void> {
  if (!(await confirmDiscard())) return;
  actions.newDocument(name, width, height, dpi, paper, animation, outputFrame);
  currentFile = null;
  void idbDelete(AUTOSAVE_KEY);
}
