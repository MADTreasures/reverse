/**
 * Composites the layer tree into one document-sized canvas.
 * Supports blend modes, opacity, folders (isolated or pass-through) and clipping groups.
 * Only the dirty region is recomposed, so painting stays fast on large canvases.
 */
import { nativeOp } from '../model/blend';
import { clipGroups } from '../model/layers';
import type { BlendMode, FolderBlendMode, Layer, PaintDocument } from '../model/types';
import { intersect, union, type Rect } from '../paint/rect';
import { blendInto } from './blendPixels';
import { clearRect, createCanvas, ctx2d, type Ctx } from './canvas';
import { getSurface } from './surfaces';

export interface ComposeOptions {
  /** Skip draft layers (exports). */
  skipDraft?: boolean;
  /** Only layers for which this returns true are drawn (e.g. reference layers for fill). */
  filter?: (layer: Layer) => boolean;
}

/**
 * Draws `source` onto `target` inside `r` with a layer's opacity and blending mode. Modes the
 * canvas lacks are blended per pixel (only inside the dirty region, so strokes stay fast).
 */
function paint(target: Ctx, source: HTMLCanvasElement, r: Rect, opacity: number, mode: FolderBlendMode): void {
  const op = nativeOp(mode);
  if (op) {
    target.globalAlpha = opacity;
    target.globalCompositeOperation = op;
    target.drawImage(source, 0, 0);
    target.globalAlpha = 1;
    target.globalCompositeOperation = 'source-over';
    return;
  }
  const dst = target.getImageData(r.x, r.y, r.w, r.h);
  const src = ctx2d(source).getImageData(r.x, r.y, r.w, r.h);
  blendInto(dst.data, src.data, mode as BlendMode, opacity);
  target.putImageData(dst, r.x, r.y);
}

/** Pool of document-sized scratch canvases. */
class CanvasPool {
  private free: HTMLCanvasElement[] = [];
  private width = 0;
  private height = 0;

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.free = [];
  }

  acquire(r: Rect): Ctx {
    const c = this.free.pop() ?? createCanvas(this.width, this.height);
    const ctx = ctx2d(c);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    clearRect(ctx, r);
    return ctx;
  }

  release(ctx: Ctx): void {
    ctx.restore();
    if (ctx.canvas.width === this.width && ctx.canvas.height === this.height) this.free.push(ctx.canvas);
  }
}

export class Compositor {
  readonly canvas: HTMLCanvasElement;
  private ctx: Ctx;
  private pool = new CanvasPool();
  private dirty: Rect | null = null;

  constructor(width: number, height: number) {
    this.canvas = createCanvas(width, height);
    this.ctx = ctx2d(this.canvas);
    this.pool.resize(width, height);
    this.dirty = { x: 0, y: 0, w: width, h: height };
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
    this.pool.resize(width, height);
    this.invalidate();
  }

  /** Marks a region (or everything) for recomposition. */
  invalidate(r?: Rect | null): void {
    const full = { x: 0, y: 0, w: this.canvas.width, h: this.canvas.height };
    const clipped = r ? intersect(r, full) : full;
    if (clipped) this.dirty = union(this.dirty, clipped);
  }

  get isDirty(): boolean {
    return this.dirty !== null;
  }

  /** Recomposes the dirty region. Returns the region that changed, or null. */
  update(doc: PaintDocument): Rect | null {
    const r = this.dirty;
    if (!r) return null;
    this.dirty = null;
    this.compose(doc, this.ctx, r, {});
    return r;
  }

  /** Composes the document into `target` within `r`. Used for exports and colour sampling too. */
  compose(doc: PaintDocument, target: Ctx, r: Rect, opts: ComposeOptions): void {
    target.save();
    target.beginPath();
    target.rect(r.x, r.y, r.w, r.h);
    target.clip();
    clearRect(target, r);
    this.composeList(doc.layers, target, r, opts);
    target.restore();
  }

  private shown(layer: Layer, opts: ComposeOptions): boolean {
    if (!layer.visible || layer.opacity <= 0) return false;
    if (opts.skipDraft && layer.draft) return false;
    return true;
  }

  private composeList(layers: Layer[], target: Ctx, r: Rect, opts: ComposeOptions): void {
    for (const group of clipGroups(layers)) {
      const base = group.base;
      if (!this.shown(base, opts)) continue;
      // A filtered-out base hides its whole clipping group.
      if (opts.filter && base.kind === 'raster' && !opts.filter(base)) continue;
      const clipped = group.clipped.filter((l) => this.shown(l, opts) && (!opts.filter || l.kind === 'folder' || opts.filter(l)));
      if (clipped.length === 0) {
        this.drawLayer(base, target, r, opts);
        continue;
      }
      // Clipping group: base content, clipped layers masked by the base's alpha and blended onto it.
      const group$ = this.pool.acquire(r);
      this.drawContent(base, group$, r, opts);
      const baseAlpha = this.pool.acquire(r);
      baseAlpha.drawImage(group$.canvas, 0, 0);
      for (const layer of clipped) {
        const tmp = this.pool.acquire(r);
        this.drawContent(layer, tmp, r, opts);
        tmp.globalCompositeOperation = 'destination-in';
        tmp.drawImage(baseAlpha.canvas, 0, 0);
        tmp.globalCompositeOperation = 'source-over';
        paint(group$, tmp.canvas, r, layer.opacity, layer.blend === 'pass-through' ? 'normal' : layer.blend);
        this.pool.release(tmp);
      }
      this.pool.release(baseAlpha);
      paint(target, group$.canvas, r, base.opacity, base.blend === 'pass-through' ? 'normal' : base.blend);
      this.pool.release(group$);
    }
  }

  /** Draws a layer with its own opacity and blend mode. */
  private drawLayer(layer: Layer, target: Ctx, r: Rect, opts: ComposeOptions): void {
    if (layer.kind === 'raster') {
      const s = getSurface(layer.id);
      if (s) paint(target, s, r, layer.opacity, layer.blend);
      return;
    }
    if (layer.blend === 'pass-through' && layer.opacity >= 1) {
      this.composeList(layer.children, target, r, opts);
      return;
    }
    const tmp = this.pool.acquire(r);
    this.composeList(layer.children, tmp, r, opts);
    paint(target, tmp.canvas, r, layer.opacity, layer.blend === 'pass-through' ? 'normal' : layer.blend);
    this.pool.release(tmp);
  }

  /** Draws a layer's pixels at full opacity in normal mode (clipping groups apply opacity later). */
  private drawContent(layer: Layer, target: Ctx, r: Rect, opts: ComposeOptions): void {
    if (layer.kind === 'raster') {
      const s = getSurface(layer.id);
      if (s) target.drawImage(s, 0, 0);
      return;
    }
    this.composeList(layer.children, target, r, opts);
  }
}
