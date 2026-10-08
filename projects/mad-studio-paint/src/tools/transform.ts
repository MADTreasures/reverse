/**
 * Free transform (⌘T): lifts the selection (or the whole layer) and lets the user move, scale
 * and rotate it with handles. Enter confirms, Esc cancels.
 */
import { findLayer, maskIds } from '../model/layers';
import type { Id } from '../model/types';
import { maskBounds, type Mask } from '../paint/mask';
import { union, type Rect } from '../paint/rect';
import type { Affine } from '../paint/rulers';
import { contentBounds, contentOf, transformContent, type Content } from '../paint/objects';
import { apply as applyMatrix, invert, type Matrix } from '../paint/viewMath';
import { createCanvas, ctx2d } from '../engine/canvas';
import { DirectEdit, type PixelPatch } from '../engine/edit';
import { engine } from '../engine/engine';
import { getSurface } from '../engine/surfaces';
import * as actions from '../store/actions';
import { getState, setState } from '../store/store';
import type { OverlayView, PointerInfo, ToolSession } from './types';

interface Params {
  cx: number;
  cy: number;
  sx: number;
  sy: number;
  /** Radians. */
  angle: number;
}

type Handle = { kind: 'scale'; hx: -1 | 0 | 1; hy: -1 | 0 | 1 } | { kind: 'move' } | { kind: 'rotate' };

const HANDLE_PX = 9;

export type TransformMode = 'scaleRotate' | 'free';

/** One surface being transformed: its edit, the lifted pixels and what stays behind. */
interface Part {
  edit: DirectEdit;
  source: HTMLCanvasElement;
  hole: HTMLCanvasElement;
}

/** A vector or text layer being transformed: its objects are transformed, not its pixels (lossless). */
interface ObjectPart {
  layer: actions.ObjectLayer;
  original: Content;
  which: Set<string>;
  /** Bounds of the lines before the transform and where they were last drawn. */
  box: Rect | null;
  shown: Rect | null;
}

class FreeTransform {
  private parts: Part[];
  private objects: ObjectPart[] = [];
  readonly bounds: Rect;
  params: Params;
  private readonly initial: Params;
  private selection: Mask | null;

  constructor(
    ids: string[],
    bounds: Rect,
    readonly mode: TransformMode,
  ) {
    this.bounds = bounds;
    const state = getState();
    this.selection = state.selection;
    const sel = engine.selectionCanvas();
    this.parts = ids.flatMap((id, i) => {
      const layer = findLayer(state.doc.layers, id);
      if (actions.isObjectLayer(layer)) {
        const which = actions.objectsToMove(layer, state.selection);
        const original = contentOf(layer);
        const box = contentBounds(original, which);
        this.objects.push({ layer, original, which, box, shown: box });
        return [];
      }
      const surface = getSurface(id);
      if (!surface) return [];
      const edit = new DirectEdit(id, surface, (r) => engine.invalidate(r), `transform:${i}`);
      const source = createCanvas(bounds.w, bounds.h);
      const sctx = ctx2d(source);
      sctx.drawImage(edit.backup, -bounds.x, -bounds.y);
      if (sel) {
        sctx.globalCompositeOperation = 'destination-in';
        sctx.drawImage(sel, -bounds.x, -bounds.y);
      }
      const hole = createCanvas(surface.width, surface.height);
      const hctx = ctx2d(hole);
      if (sel) {
        hctx.drawImage(edit.backup, 0, 0);
        hctx.globalCompositeOperation = 'destination-out';
        hctx.drawImage(sel, 0, 0);
      }
      return [{ edit, source, hole }];
    });
    this.params = { cx: bounds.x + bounds.w / 2, cy: bounds.y + bounds.h / 2, sx: 1, sy: 1, angle: 0 };
    this.initial = { ...this.params };
    this.render();
  }

  /** Document → document matrix of the current transform (for vector lines). */
  private docMatrix(): Affine {
    const [a, b, c, d, e, f] = this.matrix();
    const { x, y } = this.bounds;
    return [a, b, c, d, e - a * x - c * y, f - b * x - d * y];
  }

  private transformed(v: ObjectPart): Content {
    return transformContent(v.original, v.which, this.docMatrix());
  }

  private get changed(): boolean {
    const p = this.params;
    const q = this.initial;
    return p.cx !== q.cx || p.cy !== q.cy || p.sx !== q.sx || p.sy !== q.sy || p.angle !== q.angle;
  }

  /** Local (source pixel) → document matrix. */
  matrix(p: Params = this.params): Matrix {
    const cos = Math.cos(p.angle);
    const sin = Math.sin(p.angle);
    const a = cos * p.sx;
    const b = sin * p.sx;
    const c = -sin * p.sy;
    const d = cos * p.sy;
    const w = this.bounds.w / 2;
    const h = this.bounds.h / 2;
    return [a, b, c, d, p.cx - a * w - c * h, p.cy - b * w - d * h];
  }

  corners(): { x: number; y: number }[] {
    const m = this.matrix();
    const { w, h } = this.bounds;
    return [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ].map(([x, y]) => applyMatrix(m, x, y));
  }

  render(): void {
    for (const { edit, hole, source } of this.parts) {
      const ctx = edit.ctx;
      const { width, height } = hole;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(hole, 0, 0);
      ctx.setTransform(...this.matrix());
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source, 0, 0);
      ctx.restore();
      edit.changed({ x: 0, y: 0, w: width, h: height });
    }
    for (const v of this.objects) {
      const c = this.transformed(v);
      const now = contentBounds(c, v.which);
      actions.previewContent(v.layer, c, union(v.shown, now));
      v.shown = now;
    }
  }

  commit(): void {
    const patches = this.parts.map(({ edit }) => edit.commit()).filter((p): p is PixelPatch => p !== null);
    const contents = new Map<Id, Content>();
    if (this.changed) for (const v of this.objects) if (v.which.size) contents.set(v.layer.id, this.transformed(v));
    if (patches.length === 0 && contents.size === 0) {
      engine.resync();
      return;
    }
    if (!this.selection) {
      actions.commitTransform('Transform', patches, contents);
      return;
    }
    // The selection follows the transformed pixels (rasterised from the new outline).
    const { width, height } = getState().doc;
    const sel = createCanvas(width, height);
    const s = ctx2d(sel, true);
    s.setTransform(...this.matrix());
    s.fillStyle = '#000';
    s.fillRect(0, 0, this.bounds.w, this.bounds.h);
    const src = engine.selectionCanvas();
    if (src) {
      s.globalCompositeOperation = 'destination-in';
      s.drawImage(src, -this.bounds.x, -this.bounds.y);
    }
    s.setTransform(1, 0, 0, 1, 0, 0);
    const data = s.getImageData(0, 0, sel.width, sel.height).data;
    const mask = { width: sel.width, height: sel.height, data: new Uint8Array(sel.width * sel.height) };
    for (let i = 0, p = 3; i < mask.data.length; i++, p += 4) mask.data[i] = data[p];
    actions.commitTransform('Transform', patches, contents, { before: this.selection, after: mask });
  }

  cancel(): void {
    for (const { edit } of this.parts) edit.cancel();
    for (const v of this.objects) actions.previewContent(v.layer, v.original, union(v.shown, v.box));
    engine.resync();
  }
}

let active: FreeTransform | null = null;

export const isTransforming = () => active !== null;

/**
 * Starts transforming the selection or the current layer's content.
 * "Scale/Rotate" (⌘T) keeps the aspect ratio at the corner handles; "Free transform" (⇧⌘T) does not.
 */
export function startTransform(mode: TransformMode = 'scaleRotate'): boolean {
  if (active) return true;
  const s = getState();
  const blocker = actions.transformBlocker(s);
  if (blocker) {
    setState({ hint: blocker });
    return false;
  }
  const ids = actions.movingSurfaces(s);
  if (ids.length === 0) {
    setState({ hint: 'The layer is locked' });
    return false;
  }
  // The box fits the selection or the drawn pixels; masks (mostly opaque) only count when they move alone.
  const masks = new Set(maskIds(s.doc.layers));
  const content = ids.filter((id) => !masks.has(id));
  let bounds: Rect | null = s.selection ? maskBounds(s.selection) : null;
  if (!s.selection) {
    for (const id of content.length ? content : ids) {
      const surface = getSurface(id);
      bounds = union(bounds, surface ? opaqueBounds(surface) : null);
    }
  }
  if (!bounds) {
    setState({ hint: 'Nothing to transform' });
    return false;
  }
  active = new FreeTransform(ids, bounds, mode);
  setState({ transforming: true, hint: 'Drag handles to scale, outside to rotate · Enter to confirm, Esc to cancel' });
  return true;
}

export function confirmTransform(): void {
  if (!active) return;
  active.commit();
  active = null;
  setState({ transforming: false, hint: '' });
}

export function cancelTransform(): void {
  if (!active) return;
  active.cancel();
  active = null;
  setState({ transforming: false, hint: '' });
}

/** Bounding box of non-transparent pixels. */
function opaqueBounds(surface: HTMLCanvasElement): Rect | null {
  const { width: w, height: h } = surface;
  const data = ctx2d(surface, true).getImageData(0, 0, w, h).data;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Which handle is under a viewport point. */
export function hitHandle(p: PointerInfo, view: OverlayView): Handle {
  const t = active!;
  const m = t.matrix();
  const { w, h } = t.bounds;
  for (const hy of [-1, 0, 1] as const) {
    for (const hx of [-1, 0, 1] as const) {
      if (hx === 0 && hy === 0) continue;
      const d = applyMatrix(m, ((hx + 1) / 2) * w, ((hy + 1) / 2) * h);
      const s = applyMatrix(view.matrix, d.x, d.y);
      if (Math.abs(s.x - p.sx) <= HANDLE_PX && Math.abs(s.y - p.sy) <= HANDLE_PX) return { kind: 'scale', hx, hy };
    }
  }
  const local = applyMatrix(invert(m), p.x, p.y);
  if (local.x >= 0 && local.y >= 0 && local.x <= w && local.y <= h) return { kind: 'move' };
  return { kind: 'rotate' };
}

export function transformCursor(h: Handle): string {
  if (h.kind === 'move') return 'move';
  if (h.kind === 'rotate') return 'alias';
  return h.hx === 0 ? 'ns-resize' : h.hy === 0 ? 'ew-resize' : h.hx === h.hy ? 'nwse-resize' : 'nesw-resize';
}

export class TransformSession implements ToolSession {
  private start: PointerInfo;
  private startParams: Params;
  readonly cursor: string;

  constructor(
    p: PointerInfo,
    private handle: Handle,
  ) {
    this.start = p;
    this.startParams = { ...active!.params };
    this.cursor = transformCursor(handle);
  }

  move(p: PointerInfo): void {
    const t = active;
    if (!t) return;
    const s0 = this.startParams;
    const h = this.handle;
    if (h.kind === 'move') {
      let dx = p.x - this.start.x;
      let dy = p.y - this.start.y;
      if (p.shift) {
        // ⇧ constrains the move to 45° directions.
        const len = Math.hypot(dx, dy);
        const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        dx = Math.cos(a) * len;
        dy = Math.sin(a) * len;
      }
      t.params = { ...s0, cx: s0.cx + dx, cy: s0.cy + dy };
    } else if (h.kind === 'rotate') {
      const a0 = Math.atan2(this.start.y - s0.cy, this.start.x - s0.cx);
      const a1 = Math.atan2(p.y - s0.cy, p.x - s0.cx);
      let angle = s0.angle + (a1 - a0);
      if (p.shift) angle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
      t.params = { ...s0, angle };
    } else {
      const corner = h.hx !== 0 && h.hy !== 0;
      const keep = corner && (t.mode === 'scaleRotate' || p.shift);
      t.params = scaleParams(s0, t.bounds, h.hx, h.hy, p, keep);
    }
    t.render();
  }

  up(p: PointerInfo): void {
    this.move(p);
  }

  cancel(): void {
    if (active) {
      active.params = this.startParams;
      active.render();
    }
  }
}

/** New parameters when dragging a scale handle; the opposite side stays fixed. */
function scaleParams(s0: Params, b: Rect, hx: number, hy: number, p: { x: number; y: number }, keepAspect: boolean): Params {
  const cos = Math.cos(s0.angle);
  const sin = Math.sin(s0.angle);
  // Pointer in the rotated frame centred on the original centre.
  const lx = (p.x - s0.cx) * cos + (p.y - s0.cy) * sin;
  const ly = -(p.x - s0.cx) * sin + (p.y - s0.cy) * cos;
  const halfW = (b.w * s0.sx) / 2;
  const halfH = (b.h * s0.sy) / 2;
  // Fixed anchor on the opposite side.
  const ax = -hx * halfW;
  const ay = -hy * halfH;
  let sx = s0.sx;
  let sy = s0.sy;
  if (hx !== 0) sx = ((lx - ax) * hx) / b.w || s0.sx;
  if (hy !== 0) sy = ((ly - ay) * hy) / b.h || s0.sy;
  if (keepAspect) {
    const k = hx !== 0 && hy !== 0 ? Math.max(Math.abs(sx / s0.sx), Math.abs(sy / s0.sy)) : hx !== 0 ? Math.abs(sx / s0.sx) : Math.abs(sy / s0.sy);
    sx = Math.sign(sx || 1) * Math.abs(s0.sx) * k;
    sy = Math.sign(sy || 1) * Math.abs(s0.sy) * k;
  }
  const min = 1 / Math.max(b.w, b.h);
  if (Math.abs(sx) < min) sx = Math.sign(sx || 1) * min;
  if (Math.abs(sy) < min) sy = Math.sign(sy || 1) * min;
  // New centre: anchor + half the new size along the handle direction (in the rotated frame).
  const ncx = hx !== 0 ? ax + (hx * b.w * sx) / 2 : 0;
  const ncy = hy !== 0 ? ay + (hy * b.h * sy) / 2 : 0;
  return {
    ...s0,
    sx,
    sy,
    cx: s0.cx + ncx * cos - ncy * sin,
    cy: s0.cy + ncx * sin + ncy * cos,
  };
}

export function drawTransformOverlay(ctx: CanvasRenderingContext2D, view: OverlayView): void {
  const t = active;
  if (!t) return;
  const pts = t.corners().map((c) => applyMatrix(view.matrix, c.x, c.y));
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#2f80ed';
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.stroke();
  const m = t.matrix();
  const { w, h } = t.bounds;
  ctx.fillStyle = '#fff';
  for (const hy of [-1, 0, 1]) {
    for (const hx of [-1, 0, 1]) {
      if (hx === 0 && hy === 0) continue;
      const d = applyMatrix(m, ((hx + 1) / 2) * w, ((hy + 1) / 2) * h);
      const s = applyMatrix(view.matrix, d.x, d.y);
      ctx.fillRect(s.x - 4, s.y - 4, 8, 8);
      ctx.strokeRect(s.x - 4, s.y - 4, 8, 8);
    }
  }
  // Centre mark.
  const c = applyMatrix(view.matrix, t.params.cx, t.params.cy);
  ctx.beginPath();
  ctx.moveTo(c.x - 5, c.y);
  ctx.lineTo(c.x + 5, c.y);
  ctx.moveTo(c.x, c.y - 5);
  ctx.lineTo(c.x, c.y + 5);
  ctx.stroke();
  ctx.restore();
}
