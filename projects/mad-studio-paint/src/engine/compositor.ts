/**
 * Composites the layer tree into one document-sized canvas.
 * Supports blend modes, opacity, layer masks, folders (isolated or pass-through), clipping groups and
 * correction layers. Only the dirty region is recomposed, so painting stays fast on large canvases.
 */
import { nativeOp } from '../model/blend';
import { hexToRgb } from '../model/color';
import { celAt, onionCels, onionOpacity, tintOnion, type OnionSkin } from '../paint/animation';
import { maskTrackId } from '../model/animation';
import { inClips } from '../paint/clips';
import { cameraMatrix, invert, isRest, placementAt, placementMatrix, placedCorners, restPlacement, type Placement } from '../paint/keyframes';
import type { Affine } from '../paint/rulers';
import { lightMatrix, type LightLayer } from '../paint/lightTable';
import { clipGroups, findLayer, flatten } from '../model/layers';
import type { BlendMode, CorrectionLayer, FolderBlendMode, FolderLayer, GradientLayer, Id, Layer, PaintDocument, RasterLayer, TextLayer, VectorLayer } from '../model/types';
import { anyEffect, applyEdge, applyLayerColor, applyWatercolorEdge, effectReach } from '../paint/effects';
import { applyDropShadow, applyInnerGlow, applyInnerShadow, applyOuterGlow } from '../paint/styles';
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
  /** Frame of the timeline to show (default: the current frame). */
  frame?: number;
  /** Onion skins around the current cels (only the display shows them). */
  onion?: OnionSkin | null;
  /** Apply 2D camera effects: 2D camera folders show what their camera frame sees. */
  camera?: boolean;
  /** Show the light table layers (only the display does). */
  light?: boolean;
}

/** A track placed by its keyframes (or a 2D camera folder seen through its camera). */
interface Placed {
  m: Affine;
  opacity: number;
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
  /** Current frame of the timeline (1 = first), and the onion skin the display shows (or null). */
  frame = 1;
  onion: OnionSkin | null = null;
  /** What the composition under way shows: the frame (null: no timeline, every cel) and onion skins. */
  private anim: { frame: number | null; onion: OnionSkin | null } = { frame: null, onion: null };
  /** How many animation folders the layers being composed lie in (cels are not tracks: no clips). */
  private inCel = 0;
  /** The display applies 2D camera effects (Show camera's field of view). */
  camera = false;
  /** Placements shown instead of the keyframes' while the Object tool changes them. */
  readonly keyPreview = new Map<string, Placement>();
  /** Edit layers with active keyframes: this track is drawn without its keyframes. */
  unkeyed: string | null = null;
  private applyCamera = false;
  /** Light table layers shown under the target cel (in its animation folder; null: over the paper). */
  light: { folder: string | null; layers: LightLayer[] } | null = null;
  /** The document being composed (light table layers refer to its layers). */
  private doc: PaintDocument | null = null;
  private inLight = false;
  /** Masks placed by their keyframes, per layer. */
  private placedMasks = new Map<Id, HTMLCanvasElement>();
  /** The masks of the composition under way (each placed once). */
  private masksNow = new Map<Id, HTMLCanvasElement | null>();

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
    // Border effects reach beyond the changed pixels. Layers seen through a 2D camera can be drawn
    // on, and their changes show elsewhere (layers placed by keyframes are locked while placed).
    const layers = flatten(doc.layers);
    const reach = layers.reduce((n, l) => n + (l.visible ? effectReach(l.effects) : 0), 0);
    if (reach) r = intersect(inflate(r, reach), this.bounds) ?? r;
    if (this.camera && doc.timeline?.enabled && layers.some((l) => l.kind === 'folder' && l.camera)) r = this.bounds;
    this.compose(doc, this.ctx, r, { paper: doc.paper.visible ? doc.paper.color : null, onion: this.onion, camera: this.camera, light: true });
    return r;
  }

  /** Composes the document into `target` within `r`. Used for exports and colour sampling too. */
  compose(doc: PaintDocument, target: Ctx, r: Rect, opts: ComposeOptions): void {
    this.dpi = doc.dpi;
    this.inCel = 0;
    this.applyCamera = Boolean(opts.camera);
    this.anim = doc.timeline?.enabled ? { frame: opts.frame ?? this.frame, onion: opts.onion ?? null } : { frame: null, onion: null };
    target.save();
    target.beginPath();
    target.rect(r.x, r.y, r.w, r.h);
    target.clip();
    clearRect(target, r);
    if (opts.paper) {
      target.fillStyle = opts.paper;
      target.fillRect(r.x, r.y, r.w, r.h);
    }
    this.doc = doc;
    this.masksNow.clear();
    // Without a target cel, the light table lies on the paper.
    if (opts.light && this.light && this.light.folder === null) this.drawLightTable(target, r, opts);
    this.composeList(doc.layers, target, r, opts);
    target.restore();
  }

  /**
   * One layer drawn on its own at document size with its mask and effects (a folder composed in
   * isolation), for exports that keep layers.
   */
  layerImage(doc: PaintDocument, layer: Layer, opts: ComposeOptions = {}): HTMLCanvasElement {
    this.dpi = doc.dpi;
    this.inCel = 0;
    this.applyCamera = Boolean(opts.camera);
    this.anim = { frame: doc.timeline?.enabled ? (opts.frame ?? this.frame) : null, onion: null };
    this.doc = doc;
    this.masksNow.clear();
    const out = createCanvas(this.canvas.width, this.canvas.height);
    this.drawContent(layer, ctx2d(out), this.bounds, opts);
    return out;
  }

  private shown(layer: Layer, opts: ComposeOptions): boolean {
    if (!layer.visible || layer.opacity <= 0) return false;
    if (opts.skipDraft && layer.draft) return false;
    // A track shows only where it has a clip.
    if (this.anim.frame !== null && this.inCel === 0 && !inClips(layer.clips, this.anim.frame)) return false;
    return true;
  }

  /**
   * The surface of a layer's enabled mask (or null); while the layer's keyframes are on, placed by
   * the mask's keyframes at the frame. Where the moved mask leaves the canvas uncovered it shows
   * the layer, unless it hides what lies beyond it (Mask outside selection).
   */
  private maskOf(layer: Layer): HTMLCanvasElement | null {
    const known = this.masksNow.get(layer.id);
    if (known !== undefined) return known;
    const out = this.placedMask(layer);
    this.masksNow.set(layer.id, out);
    return out;
  }

  private placedMask(layer: Layer): HTMLCanvasElement | null {
    const mask = layer.mask;
    const surface = mask?.enabled ? (getSurface(mask.id) ?? null) : null;
    if (!mask || !surface || this.anim.frame === null || !layer.keys?.enabled || layer.id === this.unkeyed) return surface;
    const rest = restPlacement(this.doc?.width ?? surface.width, this.doc?.height ?? surface.height);
    const p = this.keyPreview.get(maskTrackId(layer.id)) ?? (mask.keys?.length ? placementAt(mask.keys, this.anim.frame, rest) : null);
    if (!p || isRest(p)) return surface;
    let out = this.placedMasks.get(layer.id);
    if (!out || out.width !== surface.width || out.height !== surface.height) {
      out = createCanvas(surface.width, surface.height);
      this.placedMasks.set(layer.id, out);
    }
    const ctx = ctx2d(out);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, out.width, out.height);
    const m = placementMatrix(p);
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.drawImage(surface, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (mask.outside !== 'hide') {
      const c = placedCorners(p, surface.width, surface.height);
      ctx.beginPath();
      ctx.rect(0, 0, out.width, out.height);
      c.forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
      ctx.closePath();
      ctx.fillStyle = '#000';
      ctx.fill('evenodd');
    }
    return out;
  }

  /** How a track is placed at the frame by its keyframes, or seen through its 2D camera; null: as it is. */
  private placed(layer: Layer): Placed | null {
    if (this.anim.frame === null || this.inCel > 0 || layer.kind === 'correction') return null;
    const camera = layer.kind === 'folder' && Boolean(layer.camera);
    if (camera ? !this.applyCamera : !layer.keys?.enabled || layer.id === this.unkeyed) return null;
    const rest = restPlacement(this.doc?.width ?? this.canvas.width, this.doc?.height ?? this.canvas.height);
    const p = this.keyPreview.get(layer.id) ?? placementAt(layer.keys?.frames ?? [], this.anim.frame, rest);
    if (!p || isRest(p)) return null;
    return { m: camera ? cameraMatrix(p) : placementMatrix(p), opacity: p.opacity };
  }

  /** A placed layer's pixels (mask and effects applied, then moved; its keyframe opacity too), valid inside `r`. */
  private placedContent(layer: RasterLayer | VectorLayer | TextLayer | GradientLayer | FolderLayer, xf: Placed, r: Rect, opts: ComposeOptions): Ctx {
    const out = this.pool.acquire(r);
    // Only the part of the layer that lands in `r` is needed.
    const src = this.sourceOf(xf.m, r);
    if (!src) return out;
    const plain = layer.kind !== 'folder' && !this.maskOf(layer) && !hasEffects(layer);
    const c = plain ? null : this.content(layer, src, opts);
    const source = c ? c.canvas : getSurface(layer.id);
    if (source) this.drawPlaced(out, source, xf.m, xf.opacity);
    if (c) this.pool.release(c);
    return out;
  }

  /** Composes a folder's children (an animation folder's: the cel shown at the frame). */
  private composeChildren(folder: FolderLayer, target: Ctx, r: Rect, opts: ComposeOptions): void {
    const cel = Boolean(folder.animation) && this.anim.frame !== null;
    if (cel) this.inCel++;
    try {
      this.composeList(this.childrenShown(folder), target, r, opts);
    } finally {
      if (cel) this.inCel--;
    }
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
    mixInto(target, mixed, r, layer.opacity, this.maskOf(layer));
    this.pool.release(mixed);
  }

  /** Draws a layer with its own opacity and blend mode. */
  private drawLayer(layer: Layer, target: Ctx, r: Rect, opts: ComposeOptions): void {
    if (layer.kind === 'correction') {
      this.drawCorrection(layer, target, r);
      return;
    }
    const xf = this.placed(layer);
    if (xf) {
      // Placed folders are composed on their own, like isolated ones.
      const c = this.placedContent(layer, xf, r, opts);
      paint(target, c.canvas, r, opacityOf(layer), layer.blend === 'pass-through' ? 'normal' : layer.blend);
      this.pool.release(c);
      return;
    }
    if (layer.kind === 'raster' || layer.kind === 'vector' || layer.kind === 'text' || layer.kind === 'gradient') {
      const s = getSurface(layer.id);
      if (!s) return;
      if (!this.maskOf(layer) && !hasEffects(layer)) {
        paint(target, s, r, layer.opacity, layer.blend);
        return;
      }
      const c = this.content(layer, r, opts);
      paint(target, c.canvas, r, opacityOf(layer), layer.blend);
      this.pool.release(c);
      return;
    }
    const mask = this.maskOf(layer);
    // Frame border folders are always isolated (their panels clip the result), and so are
    // animation folders showing onion skins.
    if (layer.blend === 'pass-through' && !layer.frame && !this.skinned(layer) && !this.lit(layer, opts)) {
      if (layer.opacity >= 1 && !mask) {
        this.composeChildren(layer, target, r, opts);
        return;
      }
      // The children blend straight into (a copy of) the backdrop; opacity and mask then mix that
      // result with the untouched backdrop.
      const tmp = this.pool.acquire(r);
      tmp.drawImage(target.canvas, 0, 0);
      this.composeChildren(layer, tmp, r, opts);
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
    } else {
      if (this.skinned(layer)) this.drawOnionSkins(layer, ctx, rr, opts);
      // The light table lies under the cels of the target cel's animation folder.
      if (opts.light && this.light?.folder === layer.id) this.drawLightTable(ctx, rr, opts);
      this.composeChildren(layer, ctx, rr, opts);
    }
    const mask = this.maskOf(layer);
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
      // Layer styles: inside the shape first, then what falls around it.
      if (fx.innerShadow?.enabled) applyInnerShadow(data, rr.w, rr.h, fx.innerShadow);
      if (fx.innerGlow?.enabled) applyInnerGlow(data, rr.w, rr.h, fx.innerGlow);
      if (fx.outerGlow?.enabled) applyOuterGlow(data, rr.w, rr.h, fx.outerGlow);
      if (fx.dropShadow?.enabled) applyDropShadow(data, rr.w, rr.h, fx.dropShadow);
      ctx.putImageData(new ImageData(data, rr.w, rr.h), rr.x, rr.y);
    }
    return ctx;
  }

  /** The layers of a folder that show: for an animation folder, the cel of the frame. */
  private childrenShown(folder: FolderLayer): Layer[] {
    if (!folder.animation || this.anim.frame === null) return folder.children;
    const id = celAt(folder.animation, this.anim.frame);
    const cel = id ? folder.children.find((c) => c.id === id) : undefined;
    return cel ? [cel] : [];
  }

  /** Animation folders that show onion skins or the light table are composed on their own. */
  private skinned(layer: Layer): boolean {
    return layer.kind === 'folder' && Boolean(layer.animation) && this.anim.frame !== null && this.anim.onion !== null;
  }

  private lit(layer: Layer, opts: ComposeOptions): boolean {
    return Boolean(opts.light) && this.light?.folder === layer.id;
  }

  /** The part of the source that lands in `r` under the placement `m` (document space, in the canvas). */
  private sourceOf(m: Affine, r: Rect): Rect | null {
    const inv = invert(m);
    const pts = [
      [r.x, r.y],
      [r.x + r.w, r.y],
      [r.x, r.y + r.h],
      [r.x + r.w, r.y + r.h],
    ].map(([x, y]) => ({ x: inv[0] * x + inv[2] * y + inv[4], y: inv[1] * x + inv[3] * y + inv[5] }));
    const x0 = Math.floor(Math.min(...pts.map((p) => p.x))) - 2;
    const y0 = Math.floor(Math.min(...pts.map((p) => p.y))) - 2;
    return intersect({ x: x0, y: y0, w: Math.ceil(Math.max(...pts.map((p) => p.x))) + 2 - x0, h: Math.ceil(Math.max(...pts.map((p) => p.y))) + 2 - y0 }, this.bounds);
  }

  /** Draws `source` placed by `m`. */
  private drawPlaced(out: Ctx, source: CanvasImageSource, m: Affine, alpha: number): void {
    out.save();
    out.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    out.globalAlpha = alpha;
    out.imageSmoothingQuality = 'high';
    out.drawImage(source, 0, 0);
    out.restore();
  }

  /**
   * Light table: each layer's source (another layer, or an image) placed by the Light table tool,
   * recoloured like onion skins and faded, bottom one first.
   */
  private drawLightTable(target: Ctx, r: Rect, opts: ComposeOptions): void {
    const light = this.light;
    if (!light || this.inLight || !this.doc) return;
    const { width, height } = this.doc;
    this.inLight = true;
    // The layers shown are drawn as they are, whatever the timeline shows.
    this.inCel++;
    try {
      for (const l of [...light.layers].reverse()) {
        const m = lightMatrix(l, width, height);
        const tmp = this.pool.acquire(r);
        if (l.source.kind === 'image') {
          const img = getSurface(l.source.image);
          if (img) this.drawPlaced(tmp, img, m, 1);
        } else {
          const layer = findLayer(this.doc.layers, l.source.layer);
          const src = layer && layer.kind !== 'correction' ? this.sourceOf(m, r) : null;
          if (layer && src) {
            const c = this.pool.acquire(src);
            this.drawContent(layer, c, src, opts);
            this.drawPlaced(tmp, c.canvas, m, 1);
            this.pool.release(c);
          }
        }
        if (l.mode !== 'color') {
          const img = tmp.getImageData(r.x, r.y, r.w, r.h);
          tintOnion(img.data, l.mode, hexToRgb(l.color) ?? { r: 0, g: 0, b: 0 });
          tmp.putImageData(img, r.x, r.y);
        }
        target.globalAlpha = l.opacity;
        target.drawImage(tmp.canvas, 0, 0);
        target.globalAlpha = 1;
        this.pool.release(tmp);
      }
    } finally {
      this.inCel--;
      this.inLight = false;
    }
  }

  /** Onion skin: the cels before and after the current one, tinted and faded, under it. */
  private drawOnionSkins(folder: FolderLayer, ctx: Ctx, r: Rect, opts: ComposeOptions): void {
    const o = this.anim.onion!;
    const { prev, next } = onionCels(folder.animation!, this.anim.frame!, o.before, o.after);
    const skin = (id: Id, color: string, n: number) => {
      const cel = folder.children.find((c) => c.id === id);
      if (!cel) return;
      this.inCel++;
      const tmp = this.pool.acquire(r);
      try {
        if (this.shown(cel, opts)) this.drawContent(cel, tmp, r, opts);
      } finally {
        this.inCel--;
      }
      if (o.mode !== 'color') {
        const img = tmp.getImageData(r.x, r.y, r.w, r.h);
        tintOnion(img.data, o.mode, hexToRgb(color) ?? { r: 0, g: 0, b: 0 });
        tmp.putImageData(img, r.x, r.y);
      }
      ctx.globalAlpha = onionOpacity(o, n);
      ctx.drawImage(tmp.canvas, 0, 0);
      ctx.globalAlpha = 1;
      this.pool.release(tmp);
    };
    // Further skins first, so the nearest lie on top.
    for (const [ids, color] of [
      [prev, o.prevColor],
      [next, o.nextColor],
    ] as const) {
      for (let n = ids.length - 1; n >= 0; n--) skin(ids[n], color, n);
    }
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
    const xf = this.placed(layer);
    if (xf) {
      const c = this.placedContent(layer, xf, r, opts);
      target.drawImage(c.canvas, 0, 0);
      this.pool.release(c);
      return;
    }
    if (layer.kind !== 'folder' && !this.maskOf(layer) && !hasEffects(layer)) {
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

const hasEffects = (layer: Layer) => anyEffect(layer.effects);

/** A screentone that reflects the layer opacity shows it in the dot size, so the dots stay opaque. */
const opacityOf = (layer: Layer) => (layer.effects?.tone?.enabled && layer.effects.tone.reflectOpacity ? 1 : layer.opacity);

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
