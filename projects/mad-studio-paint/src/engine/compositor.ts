/**
 * Composites the layer tree into one document-sized canvas.
 * Supports blend modes, opacity, layer masks, folders (isolated or pass-through), clipping groups and
 * correction layers. Only the dirty region is recomposed, so painting stays fast on large canvases.
 */
import { nativeOp } from '../model/blend';
import { clipGroups, flatten } from '../model/layers';
import type { BlendMode, CorrectionLayer, FolderBlendMode, FolderLayer, GradientLayer, Layer, PaintDocument, RasterLayer, TextLayer, VectorLayer } from '../model/types';
import { applyEdge, applyLayerColor, applyWatercolorEdge, effectReach } from '../paint/effects';
import { inflate, intersect, union, type Rect } from '../paint/rect';
import { applyCorrection } from '../paint/tonal';
import type { FrameBorder, FramePanel } from '../paint/frames';
import { applyTone } from '../paint/tone';
import { blendInto } from './blendPixels';
import { clearRect, createCanvas, ctx2d, type Ctx } from './canvas';
import { getSurface } from './surfaces';

export interface ComposeOptions {
  /**
   * Paper colour under all layers. Like the reference's paper layer it is part of the stack: blend
   * modes and correction layers at the top level see it. Left out for transparent exports and fills.
   */
  paper?: string | null;
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
  /** Frame panels shown instead of the document's while a tool changes them. */
  readonly framePreview = new Map<string, FramePanel[]>();
  /** Resolution of the document being composed (screentone frequencies are per inch). */
  private dpi = 72;

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

  private get bounds(): Rect {
    return { x: 0, y: 0, w: this.canvas.width, h: this.canvas.height };
  }

  get isDirty(): boolean {
    return this.dirty !== null;
  }

  /** Recomposes the dirty region. Returns the region that changed, or null. */
  update(doc: PaintDocument): Rect | null {
    let r = this.dirty;
    if (!r) return null;
    this.dirty = null;
    // Border effects reach beyond the changed pixels.
    const reach = flatten(doc.layers).reduce((n, l) => n + (l.visible ? effectReach(l.effects) : 0), 0);
    if (reach) r = intersect(inflate(r, reach), this.bounds) ?? r;
    this.compose(doc, this.ctx, r, { paper: doc.paper.visible ? doc.paper.color : null });
    return r;
  }

  /** Composes the document into `target` within `r`. Used for exports and colour sampling too. */
  compose(doc: PaintDocument, target: Ctx, r: Rect, opts: ComposeOptions): void {
    this.dpi = doc.dpi;
    target.save();
    target.beginPath();
    target.rect(r.x, r.y, r.w, r.h);
    target.clip();
    clearRect(target, r);
    if (opts.paper) {
      target.fillStyle = opts.paper;
      target.fillRect(r.x, r.y, r.w, r.h);
    }
    this.composeList(doc.layers, target, r, opts);
    target.restore();
  }

  /**
   * One layer drawn on its own at document size with its mask and effects (a folder composed in
   * isolation), for exports that keep layers.
   */
  layerImage(doc: PaintDocument, layer: Layer, opts: ComposeOptions = {}): HTMLCanvasElement {
    this.dpi = doc.dpi;
    const out = createCanvas(this.canvas.width, this.canvas.height);
    this.drawContent(layer, ctx2d(out), this.bounds, opts);
    return out;
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
      if (opts.filter && base.kind !== 'folder' && !opts.filter(base)) continue;
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
        if (layer.kind === 'correction') {
          // A clipped correction layer corrects only its clipping group.
          this.drawCorrection(layer, group$, r);
          continue;
        }
        const tmp = this.pool.acquire(r);
        this.drawContent(layer, tmp, r, opts);
        tmp.globalCompositeOperation = 'destination-in';
        tmp.drawImage(baseAlpha.canvas, 0, 0);
        tmp.globalCompositeOperation = 'source-over';
        paint(group$, tmp.canvas, r, opacityOf(layer), layer.blend === 'pass-through' ? 'normal' : layer.blend);
        this.pool.release(tmp);
      }
      this.pool.release(baseAlpha);
      paint(target, group$.canvas, r, opacityOf(base), base.blend === 'pass-through' ? 'normal' : base.blend);
      this.pool.release(group$);
    }
  }

  /**
   * Corrects what is already in `target` (everything below the layer in this stack) and mixes the
   * result in with the layer's blending mode, opacity and mask.
   */
  private drawCorrection(layer: CorrectionLayer, target: Ctx, r: Rect): void {
    const result = this.pool.acquire(r);
    result.drawImage(target.canvas, 0, 0);
    const img = result.getImageData(r.x, r.y, r.w, r.h);
    applyCorrection(img.data, layer.correction);
    result.putImageData(img, r.x, r.y);
    let mixed = result;
    if (layer.blend !== 'normal') {
      // Other modes blend the corrected image onto the backdrop like a layer.
      mixed = this.pool.acquire(r);
      mixed.drawImage(target.canvas, 0, 0);
      paint(mixed, result.canvas, r, 1, layer.blend);
      this.pool.release(result);
    }
    mixInto(target, mixed, r, layer.opacity, maskOf(layer));
    this.pool.release(mixed);
  }

  /** Draws a layer with its own opacity and blend mode. */
  private drawLayer(layer: Layer, target: Ctx, r: Rect, opts: ComposeOptions): void {
    if (layer.kind === 'correction') {
      this.drawCorrection(layer, target, r);
      return;
    }
    if (layer.kind === 'raster' || layer.kind === 'vector' || layer.kind === 'text' || layer.kind === 'gradient') {
      const s = getSurface(layer.id);
      if (!s) return;
      if (!maskOf(layer) && !hasEffects(layer)) {
        paint(target, s, r, layer.opacity, layer.blend);
        return;
      }
      const c = this.content(layer, r, opts);
      paint(target, c.canvas, r, opacityOf(layer), layer.blend);
      this.pool.release(c);
      return;
    }
    const mask = maskOf(layer);
    // Frame border folders are always isolated (their panels clip the result).
    if (layer.blend === 'pass-through' && !layer.frame) {
      if (layer.opacity >= 1 && !mask) {
        this.composeList(layer.children, target, r, opts);
        return;
      }
      // The children blend straight into (a copy of) the backdrop; opacity and mask then mix that
      // result with the untouched backdrop.
      const tmp = this.pool.acquire(r);
      tmp.drawImage(target.canvas, 0, 0);
      this.composeList(layer.children, tmp, r, opts);
      mixInto(target, tmp, r, layer.opacity, mask);
      this.pool.release(tmp);
      return;
    }
    const c = this.content(layer, r, opts);
    paint(target, c.canvas, r, opacityOf(layer), layer.blend);
    this.pool.release(c);
  }

  /**
   * A layer's own pixels (raster surface or isolated folder) with its mask and effects applied,
   * valid inside `r`. Border effects need the pixels around `r`, so they are drawn wider. The
   * caller releases the canvas.
   */
  private content(layer: RasterLayer | VectorLayer | TextLayer | GradientLayer | FolderLayer, r: Rect, opts: ComposeOptions): Ctx {
    const rr = intersect(inflate(r, effectReach(layer.effects)), this.bounds) ?? r;
    const ctx = this.pool.acquire(rr);
    if (layer.kind !== 'folder') {
      const s = getSurface(layer.id);
      if (s) ctx.drawImage(s, 0, 0);
    } else this.composeList(layer.children, ctx, rr, opts);
    const mask = maskOf(layer);
    if (mask) applyMask(ctx, mask);
    if (layer.kind === 'folder' && layer.frame) this.drawFrame(ctx, layer.id, layer.frame);
    const fx = layer.effects;
    if (fx && hasEffects(layer)) {
      const img = ctx.getImageData(rr.x, rr.y, rr.w, rr.h);
      let data: Uint8ClampedArray<ArrayBuffer> = img.data;
      if (fx.tone?.enabled) applyTone(data, rr.w, rr.h, rr.x, rr.y, fx.tone, this.dpi, layer.opacity);
      if (fx.layerColor?.enabled) applyLayerColor(data, fx.layerColor);
      if (fx.border?.enabled) {
        if (fx.border.kind === 'edge') data = applyEdge(data, rr.w, rr.h, fx.border);
        else applyWatercolorEdge(data, rr.w, rr.h, fx.border);
      }
      ctx.putImageData(new ImageData(data, rr.w, rr.h), rr.x, rr.y);
    }
    return ctx;
  }

  /** Frame border folder: keeps the content inside the panels and draws their border on top. */
  private drawFrame(ctx: Ctx, id: string, frame: FrameBorder): void {
    const panels = this.framePreview.get(id) ?? frame.panels;
    if (panels.length === 0) return;
    const path = framePath(panels);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = '#000';
    ctx.fill(path, 'nonzero');
    ctx.restore();
    strokeFrame(ctx, path, frame);
  }

  /**
   * Draws a layer's pixels (mask applied) at full opacity in normal mode onto an empty `target`;
   * clipping groups apply opacity and blending later.
   */
  private drawContent(layer: Layer, target: Ctx, r: Rect, opts: ComposeOptions): void {
    if (layer.kind === 'correction') return;
    if (layer.kind !== 'folder' && !maskOf(layer) && !hasEffects(layer)) {
      const s = getSurface(layer.id);
      if (s) target.drawImage(s, 0, 0);
      return;
    }
    const c = this.content(layer, r, opts);
    target.drawImage(c.canvas, 0, 0);
    this.pool.release(c);
  }
}

/** The outline of a frame border folder's panels. */
export function framePath(panels: FramePanel[]): Path2D {
  const path = new Path2D();
  for (const panel of panels) {
    panel.points.forEach((p, i) => (i === 0 ? path.moveTo(p.x, p.y) : path.lineTo(p.x, p.y)));
    path.closePath();
  }
  return path;
}

/** Draws a frame border folder's border line (if it has one) along `path`. */
export function strokeFrame(ctx: Ctx, path: Path2D, frame: FrameBorder): void {
  if (!frame.draw || frame.lineWidth <= 0) return;
  ctx.save();
  ctx.lineWidth = frame.lineWidth;
  ctx.lineJoin = 'miter';
  ctx.strokeStyle = frame.color;
  ctx.stroke(path);
  ctx.restore();
}

const hasEffects = (layer: Layer) => Boolean(layer.effects?.border?.enabled || layer.effects?.layerColor?.enabled || layer.effects?.tone?.enabled);

/** A screentone that reflects the layer opacity shows it in the dot size, so the dots stay opaque. */
const opacityOf = (layer: Layer) => (layer.effects?.tone?.enabled && layer.effects.tone.reflectOpacity ? 1 : layer.opacity);

/** The surface of a layer's enabled mask, or null. */
function maskOf(layer: Layer): HTMLCanvasElement | null {
  return layer.mask?.enabled ? (getSurface(layer.mask.id) ?? null) : null;
}

/** Keeps only the parts of `ctx` that the mask shows. */
function applyMask(ctx: Ctx, mask: HTMLCanvasElement): void {
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * target = target × (1 − k) + result × k, with k = opacity × mask alpha. Canvas pixels are
 * premultiplied, so 'lighter' (a plain sum) adds the two weighted parts exactly.
 */
function mixInto(target: Ctx, result: Ctx, r: Rect, opacity: number, mask: HTMLCanvasElement | null): void {
  if (opacity >= 1 && !mask) {
    // Within the clip, 'copy' replaces the target with the result.
    target.globalCompositeOperation = 'copy';
    target.drawImage(result.canvas, 0, 0);
    target.globalCompositeOperation = 'source-over';
    return;
  }
  const weigh = (ctx: Ctx, op: GlobalCompositeOperation) => {
    ctx.globalCompositeOperation = op;
    ctx.globalAlpha = opacity;
    if (mask) ctx.drawImage(mask, 0, 0);
    else {
      ctx.fillStyle = '#000';
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };
  weigh(result, 'destination-in');
  weigh(target, 'destination-out');
  target.globalCompositeOperation = 'lighter';
  target.drawImage(result.canvas, 0, 0);
  target.globalCompositeOperation = 'source-over';
}
