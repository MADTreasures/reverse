/**
 * The pixel side of the app: surfaces, compositing, selection canvas, undo history.
 * The document structure (layer tree, flags) lives in the store; this module owns the pixels.
 */
import { flatten, maskIds, pixelIds, vectorIds } from '../model/layers';
import type { Id, PaintDocument, VectorLayer } from '../model/types';
import { HistoryStack } from '../paint/history';
import type { Mask } from '../paint/mask';
import { intersect, type Rect } from '../paint/rect';
import { linesBounds, strokeBounds, type VectorStroke } from '../paint/vector';
import { renderVectorStroke } from './brushEngine';
import { createCanvas, ctx2d, maskToCanvas } from './canvas';
import { Compositor } from './compositor';
import { patchBytes, type PixelPatch } from './edit';
import { deleteSurface, ensureSurface, getSurface, resizeSurfaces, setSurface, surfaceIds, touch } from './surfaces';

export interface DocState {
  doc: PaintDocument;
  activeLayerId: Id;
}

export interface HistoryEntry {
  label: string;
  /** Structure before/after (omitted for pure pixel edits). */
  before?: DocState;
  after?: DocState;
  patches: PixelPatch[];
  selection?: { before: Mask | null; after: Mask | null };
  /** Canvas size change: surfaces are resized before full-size patches are applied. */
  canvasSize?: { before: { w: number; h: number }; after: { w: number; h: number } };
  /** Consecutive entries with the same key (slider drags) merge into one undo step. */
  key?: string;
  time?: number;
}

const maskBytes = (m: Mask | null | undefined) => (m ? m.data.byteLength : 0);

const lineIds = (strokes: VectorStroke[]) => strokes.map((s) => s.id).join(',');

export const DEFAULT_UNDO_STEPS = 200;

class PaintEngine {
  compositor: Compositor = null!;
  private selectionMask: Mask | null = null;
  private selectionCanvasCache: HTMLCanvasElement | null = null;
  private renderListeners = new Set<() => void>();
  private currentDoc: PaintDocument | null = null;
  /** Revision of the strokes each vector layer's pixels were rendered from. */
  private vectorRevs = new Map<Id, number>();
  /** Lines a tool already drew into a vector layer's pixels (ids in order), see expectVectorLines. */
  private drawnLines = new Map<Id, string>();

  readonly history = new HistoryStack<HistoryEntry>({
    maxEntries: DEFAULT_UNDO_STEPS,
    maxBytes: 1.5 * 1024 ** 3,
    sizeOf: (e) => e.patches.reduce((n, p) => n + patchBytes(p), 0) + maskBytes(e.selection?.before) + maskBytes(e.selection?.after),
    onDrop: () => queueMicrotask(() => this.gc()),
  });

  get ready(): boolean {
    return this.compositor !== null;
  }

  /** Sets up surfaces and compositor for a (new or opened) document. */
  load(doc: PaintDocument, images: Map<Id, HTMLCanvasElement> = new Map()): void {
    for (const id of surfaceIds()) deleteSurface(id);
    const masks = new Set(maskIds(doc.layers));
    for (const id of pixelIds(doc.layers)) {
      const s = ensureSurface(id, doc.width, doc.height);
      const img = images.get(id);
      const ctx = ctx2d(s);
      if (img) ctx.drawImage(img, 0, 0);
      else if (masks.has(id)) {
        // A mask without pixels hides nothing.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, s.width, s.height);
      }
      touch(id);
    }
    if (this.compositor) this.compositor.resize(doc.width, doc.height);
    else this.compositor = new Compositor(doc.width, doc.height);
    this.vectorRevs.clear();
    this.syncVectors(doc);
    this.history.clear();
    this.selectionMask = null;
    this.selectionCanvasCache = null;
    this.currentDoc = doc;
    this.invalidate();
  }

  /** Must be called whenever the store's document object changes. */
  setDocument(doc: PaintDocument): void {
    const resized = this.currentDoc && (this.currentDoc.width !== doc.width || this.currentDoc.height !== doc.height);
    this.currentDoc = doc;
    for (const id of pixelIds(doc.layers)) ensureSurface(id, doc.width, doc.height);
    if (resized) this.compositor.resize(doc.width, doc.height);
    this.syncVectors(doc);
    this.invalidate();
  }

  /** Renders vector layers whose strokes changed (new lines, erasing, undo …). */
  private syncVectors(doc: PaintDocument): void {
    for (const l of flatten(doc.layers)) {
      if (l.kind !== 'vector') continue;
      const known = getSurface(l.id);
      const sized = known && known.width === doc.width && known.height === doc.height;
      if (sized && this.vectorRevs.get(l.id) === l.rev) continue;
      if (sized && this.drawnLines.get(l.id) === lineIds(l.strokes)) {
        // A tool already drew exactly these lines.
        this.vectorRevs.set(l.id, l.rev);
        continue;
      }
      const surface = sized ? known : createCanvas(doc.width, doc.height);
      if (surface !== known) setSurface(l.id, surface);
      const ctx = ctx2d(surface);
      ctx.clearRect(0, 0, surface.width, surface.height);
      for (const stroke of l.strokes) renderVectorStroke(ctx, stroke);
      this.vectorRevs.set(l.id, l.rev);
      touch(l.id);
      this.compositor?.invalidate();
    }
    this.drawnLines.clear();
  }

  /**
   * A tool drew the lines into vector layer `id` itself (live, while drawing or erasing); the next
   * document that gives the layer exactly these lines does not render it again.
   */
  expectVectorLines(id: Id, strokes: VectorStroke[]): void {
    this.drawnLines.set(id, lineIds(strokes));
  }

  /** Draws lines added to a vector layer on top of its pixels, so the next document need not render it again. */
  drawNewLines(layer: VectorLayer, added: VectorStroke[]): void {
    const surface = getSurface(layer.id);
    if (!surface || this.vectorRevs.get(layer.id) !== layer.rev) return;
    const ctx = ctx2d(surface);
    for (const line of added) renderVectorStroke(ctx, line);
    touch(layer.id);
    this.invalidate(linesBounds(added));
    this.expectVectorLines(layer.id, [...layer.strokes, ...added]);
  }

  /** Draws lines into a vector layer's pixels: only inside `r` (cleared first), or the whole layer. */
  renderVectorLines(id: Id, strokes: VectorStroke[], r: Rect | null = null): void {
    const surface = getSurface(id);
    if (!surface) return;
    const area = r ? intersect(r, { x: 0, y: 0, w: surface.width, h: surface.height }) : { x: 0, y: 0, w: surface.width, h: surface.height };
    if (!area) return;
    const ctx = ctx2d(surface);
    ctx.save();
    ctx.beginPath();
    ctx.rect(area.x, area.y, area.w, area.h);
    ctx.clip();
    ctx.clearRect(area.x, area.y, area.w, area.h);
    for (const stroke of strokes) {
      const b = strokeBounds(stroke);
      if (b && intersect(b, area)) renderVectorStroke(ctx, stroke);
    }
    ctx.restore();
    touch(id);
    this.invalidate(area);
  }

  get doc(): PaintDocument {
    return this.currentDoc!;
  }

  // ------------------------------------------------------------ rendering

  invalidate(r?: Rect | null): void {
    this.compositor?.invalidate(r);
    this.requestRender();
  }

  requestRender(): void {
    for (const l of this.renderListeners) l();
  }

  onRender(fn: () => void): () => void {
    this.renderListeners.add(fn);
    return () => this.renderListeners.delete(fn);
  }

  /** Brings the composite up to date and returns it. */
  composite(): HTMLCanvasElement {
    if (this.currentDoc) this.compositor.update(this.currentDoc);
    return this.compositor.canvas;
  }

  // ------------------------------------------------------------ selection

  setSelection(mask: Mask | null): void {
    this.selectionMask = mask;
    this.selectionCanvasCache = null;
    this.requestRender();
  }

  get selection(): Mask | null {
    return this.selectionMask;
  }

  /** Canvas with the selection as alpha, or null when nothing is selected. */
  selectionCanvas(): HTMLCanvasElement | null {
    if (!this.selectionMask) return null;
    if (!this.selectionCanvasCache) this.selectionCanvasCache = maskToCanvas(this.selectionMask);
    return this.selectionCanvasCache;
  }

  // ------------------------------------------------------------ history

  /** Applies the pixel side of an undo (dir = 'before') or redo (dir = 'after'). */
  applyPatches(entry: HistoryEntry, dir: 'before' | 'after'): void {
    const patches = dir === 'before' ? [...entry.patches].reverse() : entry.patches;
    for (const p of patches) {
      const s = getSurface(p.layerId);
      if (!s) continue;
      ctx2d(s).putImageData(dir === 'before' ? p.before : p.after, p.rect.x, p.rect.y);
      touch(p.layerId);
      this.compositor.invalidate(p.rect);
    }
  }

  /** Resizes all surfaces (canvas size changes). Pixels are anchored at the offset. */
  resizeCanvas(width: number, height: number, offsetX = 0, offsetY = 0): void {
    resizeSurfaces(width, height, offsetX, offsetY);
    this.compositor.resize(width, height);
  }

  /** Frees surfaces that neither the document nor any undo step refers to. */
  gc(): void {
    const keep = new Set<Id>();
    const add = (doc: PaintDocument | undefined) => {
      if (doc) for (const id of [...pixelIds(doc.layers), ...vectorIds(doc.layers)]) keep.add(id);
    };
    add(this.currentDoc ?? undefined);
    for (const e of this.history.entries()) {
      add(e.before?.doc);
      add(e.after?.doc);
      for (const p of e.patches) keep.add(p.layerId);
    }
    for (const id of surfaceIds()) if (!keep.has(id)) deleteSurface(id);
  }

  // ------------------------------------------------------------ sampling

  /** Displayed colour at a document position (composite over paper). */
  sampleDisplayed(x: number, y: number, paper: string | null): [number, number, number, number] | null {
    const c = this.composite();
    if (x < 0 || y < 0 || x >= c.width || y >= c.height) return null;
    const probe = createCanvas(1, 1);
    const ctx = ctx2d(probe, true);
    if (paper) {
      ctx.fillStyle = paper;
      ctx.fillRect(0, 0, 1, 1);
    }
    ctx.drawImage(c, Math.floor(x), Math.floor(y), 1, 1, 0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  }

  sampleLayer(id: Id, x: number, y: number): [number, number, number, number] | null {
    const s = getSurface(id);
    if (!s || x < 0 || y < 0 || x >= s.width || y >= s.height) return null;
    const d = ctx2d(s, true).getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  }
}

export const engine = new PaintEngine();
