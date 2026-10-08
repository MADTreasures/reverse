/**
 * Editing a raster layer with undo support.
 *
 * LayerEdit keeps a copy of the layer from before the edit ("backup") and a stroke buffer.
 * Every update recomposes the touched region as backup ⊕ buffer, so stroke opacity never
 * builds up within one stroke and previews (straight lines, gradients) can be redrawn freely.
 */
import type { Id } from '../model/types';
import { intersect, union, type Rect } from '../paint/rect';
import { clearRect, createCanvas, ctx2d, withClip, type Ctx } from './canvas';
import { touch } from './surfaces';

export interface PixelPatch {
  layerId: Id;
  rect: Rect;
  before: ImageData;
  after: ImageData;
}

export const patchBytes = (p: PixelPatch) => p.before.data.byteLength + p.after.data.byteLength;

/** Re-used scratch canvases (document sized) so strokes do not allocate. */
const scratch = new Map<string, HTMLCanvasElement>();
export function scratchCanvas(key: string, width: number, height: number): HTMLCanvasElement {
  let c = scratch.get(key);
  if (!c || c.width !== width || c.height !== height) {
    c = createCanvas(width, height);
    scratch.set(key, c);
  }
  return c;
}

export type ApplyMode = 'paint' | 'erase';

export interface EditOptions {
  mode: ApplyMode;
  /** Stroke opacity 0..1. */
  opacity: number;
  lockAlpha: boolean;
  /** Canvas whose alpha is the selection (null = everything editable). */
  selection: HTMLCanvasElement | null;
  /** Called with every changed region (to recomposite and redraw). */
  onChange: (r: Rect) => void;
}

export class LayerEdit {
  readonly backup: HTMLCanvasElement;
  readonly buffer: HTMLCanvasElement;
  readonly bufferCtx: Ctx;
  private layerCtx: Ctx;
  private backupCtx: Ctx;
  private touched: Rect | null = null;
  private bounds: Rect;

  constructor(
    readonly layerId: Id,
    readonly layer: HTMLCanvasElement,
    private opts: EditOptions,
  ) {
    const { width, height } = layer;
    this.bounds = { x: 0, y: 0, w: width, h: height };
    this.backup = scratchCanvas('backup', width, height);
    this.backupCtx = ctx2d(this.backup, true);
    this.backupCtx.clearRect(0, 0, width, height);
    this.backupCtx.drawImage(layer, 0, 0);
    this.buffer = scratchCanvas('buffer', width, height);
    this.bufferCtx = ctx2d(this.buffer);
    this.bufferCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.bufferCtx.globalAlpha = 1;
    this.bufferCtx.globalCompositeOperation = 'source-over';
    this.bufferCtx.clearRect(0, 0, width, height);
    this.layerCtx = ctx2d(layer, true);
  }

  get touchedRect(): Rect | null {
    return this.touched;
  }

  /** Average colour (straight, alpha 0..1) of the layer before the edit, around (x, y). */
  sampleBackup(x: number, y: number, radius: number): { r: number; g: number; b: number; a: number } {
    const h = Math.max(1, Math.min(6, Math.round(radius)));
    const r = intersect({ x: Math.round(x) - h, y: Math.round(y) - h, w: 2 * h + 1, h: 2 * h + 1 }, this.bounds);
    if (!r) return { r: 0, g: 0, b: 0, a: 0 };
    const d = this.backupCtx.getImageData(r.x, r.y, r.w, r.h).data;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let sa = 0;
    for (let p = 0; p < d.length; p += 4) {
      const a = d[p + 3];
      sr += d[p] * a;
      sg += d[p + 1] * a;
      sb += d[p + 2] * a;
      sa += a;
    }
    if (sa === 0) return { r: 0, g: 0, b: 0, a: 0 };
    return { r: sr / sa, g: sg / sa, b: sb / sa, a: sa / (255 * (d.length / 4)) };
  }

  setOptions(patch: Partial<EditOptions>): void {
    this.opts = { ...this.opts, ...patch };
  }

  /** Re-renders `r` of the layer from backup + buffer. */
  update(r: Rect | null): void {
    const rr = r ? intersect(r, this.bounds) : null;
    if (!rr) return;
    this.touched = union(this.touched, rr);
    const { selection, mode, opacity, lockAlpha } = this.opts;
    if (selection) {
      withClip(this.bufferCtx, rr, () => {
        this.bufferCtx.globalCompositeOperation = 'destination-in';
        this.bufferCtx.drawImage(selection, 0, 0);
      });
    }
    withClip(this.layerCtx, rr, () => {
      const ctx = this.layerCtx;
      clearRect(ctx, rr);
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(this.backup, 0, 0);
      ctx.globalAlpha = opacity;
      ctx.globalCompositeOperation = mode === 'erase' ? 'destination-out' : lockAlpha ? 'source-atop' : 'source-over';
      ctx.drawImage(this.buffer, 0, 0);
    });
    touch(this.layerId);
    this.opts.onChange(rr);
  }

  /** Clears the buffer and restores the layer (for previews that are redrawn from scratch). */
  reset(): void {
    const r = this.touched;
    if (!r) return;
    clearRect(this.bufferCtx, r);
    this.update(r);
  }

  /** Restores the layer to its state before the edit. */
  cancel(): void {
    const r = this.touched;
    if (!r) return;
    withClip(this.layerCtx, r, () => {
      clearRect(this.layerCtx, r);
      this.layerCtx.drawImage(this.backup, 0, 0);
    });
    touch(this.layerId);
    this.opts.onChange(r);
    this.touched = null;
  }

  /** Finishes the edit and returns the undo patch (null if nothing changed). */
  commit(): PixelPatch | null {
    const r = this.touched;
    if (!r) return null;
    const before = this.backupCtx.getImageData(r.x, r.y, r.w, r.h);
    const after = this.layerCtx.getImageData(r.x, r.y, r.w, r.h);
    if (sameBytes(before.data, after.data)) return null;
    return { layerId: this.layerId, rect: r, before, after };
  }
}

/**
 * Direct editing (blend/smudge, move, transform): callers draw on the layer themselves and report
 * the touched region; the backup provides the "before" image for undo.
 */
export class DirectEdit {
  readonly backup: HTMLCanvasElement;
  readonly ctx: Ctx;
  private backupCtx: Ctx;
  private touched: Rect | null = null;
  private bounds: Rect;

  constructor(
    readonly layerId: Id,
    readonly layer: HTMLCanvasElement,
    private onChange: (r: Rect) => void,
    backupKey = 'direct',
  ) {
    const { width, height } = layer;
    this.bounds = { x: 0, y: 0, w: width, h: height };
    this.backup = scratchCanvas(backupKey, width, height);
    this.backupCtx = ctx2d(this.backup, true);
    this.backupCtx.clearRect(0, 0, width, height);
    this.backupCtx.drawImage(layer, 0, 0);
    this.ctx = ctx2d(layer, true);
  }

  get touchedRect(): Rect | null {
    return this.touched;
  }

  changed(r: Rect | null): void {
    const rr = r ? intersect(r, this.bounds) : null;
    if (!rr) return;
    this.touched = union(this.touched, rr);
    touch(this.layerId);
    this.onChange(rr);
  }

  /** Puts the original pixels back inside `r` (or everything touched so far). */
  restore(r: Rect | null = this.touched): void {
    if (!r) return;
    withClip(this.ctx, r, () => {
      clearRect(this.ctx, r);
      this.ctx.drawImage(this.backup, 0, 0);
    });
    touch(this.layerId);
    this.onChange(r);
  }

  cancel(): void {
    this.restore();
    this.touched = null;
  }

  commit(): PixelPatch | null {
    const r = this.touched;
    if (!r) return null;
    const before = this.backupCtx.getImageData(r.x, r.y, r.w, r.h);
    const after = this.ctx.getImageData(r.x, r.y, r.w, r.h);
    if (sameBytes(before.data, after.data)) return null;
    return { layerId: this.layerId, rect: r, before, after };
  }
}

function sameBytes(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  // Compare 32 bits at a time.
  const a32 = new Uint32Array(a.buffer, a.byteOffset, a.byteLength >> 2);
  const b32 = new Uint32Array(b.buffer, b.byteOffset, b.byteLength >> 2);
  for (let i = 0; i < a32.length; i++) if (a32[i] !== b32[i]) return false;
  return true;
}

/** Captures before/after of a whole-layer operation done by `fn` (filters, clears, flips). */
export function captureLayerChange(layerId: Id, layer: HTMLCanvasElement, rect: Rect | null, fn: (ctx: Ctx) => void): PixelPatch | null {
  const full = { x: 0, y: 0, w: layer.width, h: layer.height };
  const r = rect ? intersect(rect, full) : full;
  if (!r) return null;
  const ctx = ctx2d(layer, true);
  const before = ctx.getImageData(r.x, r.y, r.w, r.h);
  fn(ctx);
  const after = ctx.getImageData(r.x, r.y, r.w, r.h);
  touch(layerId);
  if (sameBytes(before.data, after.data)) return null;
  return { layerId, rect: r, before, after };
}
