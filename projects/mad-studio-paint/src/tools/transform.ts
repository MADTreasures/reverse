/**
 * Edit > Transform: lifts the selection (or the whole layer) into a box with handles, like the
 * reference. The box is four corners – a projective map of the original rectangle, affine while
 * they form a parallelogram – or, for Mesh transformation, a lattice of points the image follows
 * smoothly. Modes: Scale up/Scale down/Rotate (⌘T), Scale up/Scale down, Rotate, Free transform
 * (⇧⌘T), Distort, Skew, Perspective and Mesh transformation. Enter, a double click inside or OK
 * confirms; Esc or Cancel cancels. Rotation and flips turn around the reference point (+).
 */
import { create } from 'zustand';
import { findLayer, maskIds } from '../model/layers';
import type { Id } from '../model/types';
import type { Img } from '../paint/filters/core';
import { maskBounds, type Mask } from '../paint/mask';
import { union, type Rect } from '../paint/rect';
import { contentBounds, contentOf, transformContent, warpContent, type Content } from '../paint/objects';
import { apply as applyMatrix } from '../paint/viewMath';
import {
  applyH,
  boxQuad,
  invertH,
  isParallelogram,
  meshFrom,
  meshOutline,
  meshPoint,
  meshTriangles,
  pointsBounds,
  quadAffine,
  quadHomography,
  warpMesh,
  warpProjective,
  type Interpolation,
  type Mesh,
  type Pt,
  type Quad,
} from '../paint/warp';
import { createCanvas, ctx2d } from '../engine/canvas';
import { DirectEdit, type PixelPatch } from '../engine/edit';
import { engine } from '../engine/engine';
import { getSurface } from '../engine/surfaces';
import * as actions from '../store/actions';
import { getState, setState } from '../store/store';
import type { OverlayView, PointerInfo, ToolSession } from './types';

export type TransformMode = 'scaleRotate' | 'scale' | 'rotate' | 'free' | 'distort' | 'skew' | 'perspective' | 'mesh';

/** Edit > Transform, in the reference's order. */
export const TRANSFORM_MODES: { id: TransformMode; label: string }[] = [
  { id: 'scaleRotate', label: 'Scale up/Scale down/Rotate' },
  { id: 'scale', label: 'Scale up/Scale down' },
  { id: 'rotate', label: 'Rotate' },
  { id: 'free', label: 'Free transform' },
  { id: 'distort', label: 'Distort' },
  { id: 'skew', label: 'Skew' },
  { id: 'perspective', label: 'Perspective' },
  { id: 'mesh', label: 'Mesh transformation' },
];

export type ReferencePoint = 'center' | 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft' | 'top' | 'left' | 'right' | 'bottom' | 'free';

export const REFERENCE_POINTS: [ReferencePoint, string][] = [
  ['center', 'Center'],
  ['topLeft', 'Top left'],
  ['topRight', 'Top right'],
  ['bottomRight', 'Bottom right'],
  ['bottomLeft', 'Bottom left'],
  ['top', 'Top'],
  ['left', 'Left'],
  ['right', 'Right'],
  ['bottom', 'Bottom'],
  ['free', 'Free position'],
];

/** Where each reference point sits in the box (0..1 across, 0..1 down). */
const REF_AT: Record<Exclude<ReferencePoint, 'free'>, [number, number]> = {
  center: [0.5, 0.5],
  topLeft: [0, 0],
  topRight: [1, 0],
  bottomRight: [1, 1],
  bottomLeft: [0, 1],
  top: [0.5, 0],
  left: [0, 0.5],
  right: [1, 0.5],
  bottom: [0.5, 1],
};

/** Settings kept from one transform to the next, like tool settings. */
export interface TransformPrefs {
  keepAspect: boolean;
  keepOriginal: boolean;
  /** Change vector width: line widths scale with the transform. */
  scaleWidth: boolean;
  interpolation: Interpolation;
  /** Number of horizontal / vertical lattice points of Mesh transformation. */
  latticeX: number;
  latticeY: number;
  reference: ReferencePoint;
}

const prefs: TransformPrefs = { keepAspect: true, keepOriginal: false, scaleWidth: true, interpolation: 'bicubic', latticeX: 4, latticeY: 4, reference: 'center' };

/** What the Tool Property palette shows while transforming. */
export interface TransformInfo extends TransformPrefs {
  mode: TransformMode;
  pivot: Pt;
  /** Scale (%) and rotation (degrees) while the box is a turned rectangle, else null. */
  scale: { x: number; y: number } | null;
  angle: number | null;
}

export const useTransformInfo = create<{ info: TransformInfo | null }>(() => ({ info: null }));

type Handle =
  | { kind: 'corner'; index: number }
  | { kind: 'edge'; index: number }
  | { kind: 'lattice'; index: number }
  | { kind: 'pivot' }
  | { kind: 'move' }
  | { kind: 'rotate' }
  | { kind: 'none' };

const HANDLE_PX = 9;

/** One surface being transformed: its edit, the lifted pixels and what stays behind. */
interface Part {
  edit: DirectEdit;
  source: HTMLCanvasElement;
  hole: HTMLCanvasElement;
  /** The lifted pixels as bytes, for the perspective and mesh drawing (made on first use). */
  pixels: Img | null;
}

/** A vector or text layer being transformed: its objects are transformed, not its pixels (lossless). */
interface ObjectPart {
  layer: actions.ObjectLayer;
  original: Content;
  which: Set<string>;
  box: Rect | null;
  shown: Rect | null;
}

const rotateAbout = (p: Pt, c: Pt, a: number): Pt => {
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin, y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos };
};

class FreeTransform {
  private parts: Part[];
  private objects: ObjectPart[] = [];
  readonly bounds: Rect;
  mode: TransformMode;
  quad: Quad;
  mesh: Mesh | null = null;
  pivot: Pt;
  private readonly initialQuad: Quad;
  private selection: Mask | null;
  private frame = 0;

  constructor(ids: string[], bounds: Rect, mode: TransformMode) {
    this.bounds = bounds;
    this.mode = mode;
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
      return [{ edit, source, hole, pixels: null }];
    });
    this.quad = boxQuad(bounds);
    this.initialQuad = boxQuad(bounds);
    this.pivot = this.referencePoint(prefs.reference) ?? { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
    if (mode === 'mesh') this.mesh = this.newMesh();
    this.render();
  }

  get w(): number {
    return this.bounds.w;
  }

  get h(): number {
    return this.bounds.h;
  }

  /** Local (lifted pixel) → document, projective. */
  homography() {
    return quadHomography(this.w, this.h, this.quad);
  }

  /** Where a local point of the box is now. */
  mapLocal(x: number, y: number): Pt {
    return this.mesh ? meshPoint(this.mesh, this.w, this.h, x, y) : applyH(this.homography(), x, y);
  }

  /** Document → document map of the transform (for vector lines). */
  docMap(): (p: Pt) => Pt {
    const { x, y } = this.bounds;
    return (p) => this.mapLocal(p.x - x, p.y - y);
  }

  get affine(): boolean {
    return !this.mesh && isParallelogram(this.quad);
  }

  newMesh(): Mesh {
    return meshFrom(this.w, this.h, prefs.latticeX, prefs.latticeY, (x, y) => this.mapLocal(x, y));
  }

  /** The reference point's place on the box now, or null for a free position. */
  referencePoint(ref: ReferencePoint): Pt | null {
    if (ref === 'free') return null;
    const [u, v] = REF_AT[ref];
    return this.mapLocal(u * this.w, v * this.h);
  }

  /** Keeps a box-bound reference point on its place after the box changed. */
  followPivot(): void {
    this.pivot = this.referencePoint(prefs.reference) ?? this.pivot;
  }

  /** Handle positions: corners, then edge middles (top, right, bottom, left). */
  handles(): { corners: Pt[]; edges: Pt[] } {
    const { w, h } = this;
    const at = (x: number, y: number) => this.mapLocal(x, y);
    return {
      corners: [at(0, 0), at(w, 0), at(w, h), at(0, h)],
      edges: [at(w / 2, 0), at(w, h / 2), at(w / 2, h), at(0, h / 2)],
    };
  }

  private get changed(): boolean {
    if (this.mesh) return true;
    return this.quad.some((p, i) => Math.abs(p.x - this.initialQuad[i].x) > 1e-9 || Math.abs(p.y - this.initialQuad[i].y) > 1e-9);
  }

  /** Redraws on the next frame (perspective and mesh drawing is done in JavaScript). */
  scheduleRender(): void {
    if (this.affine) {
      this.render();
      return;
    }
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private flush(): void {
    if (!this.frame) return;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.render();
  }

  private pixelsOf(part: Part): Img {
    if (!part.pixels) {
      const d = ctx2d(part.source, true).getImageData(0, 0, part.source.width, part.source.height);
      part.pixels = { data: d.data, width: d.width, height: d.height };
    }
    return part.pixels;
  }

  /** The document rectangle the transformed box covers. */
  private coverage(width: number, height: number): Rect | null {
    if (this.mesh) {
      const { doc } = meshTriangles(this.mesh, this.w, this.h, 4);
      const pts: Pt[] = [];
      for (let i = 0; i < doc.length; i += 2) pts.push({ x: doc[i], y: doc[i + 1] });
      return pointsBounds(pts, width, height);
    }
    return pointsBounds(this.quad, width, height);
  }

  /** The lifted pixels warped by the current box, for the document rectangle it covers. */
  private warped(img: Img, width: number, height: number): { img: Img; at: Rect } | null {
    const at = this.coverage(width, height);
    if (!at) return null;
    const out = this.mesh ? warpMesh(img, this.mesh, this.w, this.h, at, prefs.interpolation) : warpProjective(img, this.homography(), at, prefs.interpolation);
    return { img: out, at };
  }

  render(): void {
    const affine = this.affine;
    for (const part of this.parts) {
      const { edit, hole, source } = part;
      const ctx = edit.ctx;
      const { width, height } = hole;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, width, height);
      // Keep original image: the pixels stay where they were, the transformed copy goes on top.
      ctx.drawImage(prefs.keepOriginal ? edit.backup : hole, 0, 0);
      if (affine) {
        const [a, b, c, d] = quadAffine(this.w, this.h, this.quad);
        const o = this.quad[0];
        ctx.setTransform(a, b, c, d, o.x, o.y);
        ctx.imageSmoothingEnabled = prefs.interpolation !== 'nearest';
        ctx.imageSmoothingQuality = prefs.interpolation === 'bilinear' ? 'low' : 'high';
        ctx.drawImage(source, 0, 0);
      } else {
        const res = this.warped(this.pixelsOf(part), width, height);
        if (res) {
          const tmp = createCanvas(res.at.w, res.at.h);
          ctx2d(tmp).putImageData(new ImageData(new Uint8ClampedArray(res.img.data), res.at.w, res.at.h), 0, 0);
          ctx.drawImage(tmp, res.at.x, res.at.y);
        }
      }
      ctx.restore();
      edit.changed({ x: 0, y: 0, w: width, h: height });
    }
    for (const v of this.objects) {
      const c = this.transformed(v);
      const now = contentBounds(c, v.which);
      actions.previewContent(v.layer, c, union(v.shown, now));
      v.shown = now;
    }
    publish();
  }

  private transformed(v: ObjectPart): Content {
    const opts = { scaleWidth: prefs.scaleWidth };
    if (this.affine) {
      const [a, b, c, d, e, f] = quadAffine(this.w, this.h, this.quad);
      const { x, y } = this.bounds;
      return transformContent(v.original, v.which, [a, b, c, d, e - a * x - c * y, f - b * x - d * y], opts);
    }
    return warpContent(v.original, v.which, this.docMap(), opts);
  }

  commit(): void {
    this.flush();
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
    // The selection follows the transformed pixels.
    const after = this.transformSelection();
    actions.commitTransform('Transform', patches, contents, { before: this.selection, after: prefs.keepOriginal ? this.selection : after });
  }

  private transformSelection(): Mask {
    const { width, height } = getState().doc;
    const src = engine.selectionCanvas();
    const lifted = createCanvas(this.w, this.h);
    const l = ctx2d(lifted, true);
    if (src) l.drawImage(src, -this.bounds.x, -this.bounds.y);
    else {
      l.fillStyle = '#000';
      l.fillRect(0, 0, this.w, this.h);
    }
    const mask = { width, height, data: new Uint8Array(width * height) };
    if (this.affine) {
      const sel = createCanvas(width, height);
      const s = ctx2d(sel, true);
      const [a, b, c, d] = quadAffine(this.w, this.h, this.quad);
      s.setTransform(a, b, c, d, this.quad[0].x, this.quad[0].y);
      s.drawImage(lifted, 0, 0);
      const data = s.getImageData(0, 0, width, height).data;
      for (let i = 0, p = 3; i < mask.data.length; i++, p += 4) mask.data[i] = data[p];
      return mask;
    }
    const d = l.getImageData(0, 0, this.w, this.h);
    const res = this.warped({ data: d.data, width: d.width, height: d.height }, width, height);
    if (!res) return mask;
    for (let y = 0; y < res.at.h; y++) for (let x = 0; x < res.at.w; x++) mask.data[(res.at.y + y) * width + res.at.x + x] = res.img.data[(y * res.at.w + x) * 4 + 3];
    return mask;
  }

  cancel(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    for (const { edit } of this.parts) edit.cancel();
    for (const v of this.objects) actions.previewContent(v.layer, v.original, union(v.shown, v.box));
    engine.resync();
  }

  // ---------------------------------------------------------------- edits

  /** Moves everything by (dx, dy). */
  translate(dx: number, dy: number): void {
    const mv = (p: Pt) => ({ x: p.x + dx, y: p.y + dy });
    this.quad = this.quad.map(mv) as Quad;
    if (this.mesh) this.mesh = { ...this.mesh, pts: this.mesh.pts.map(mv) };
    this.pivot = mv(this.pivot);
  }

  rotate(angle: number): void {
    const c = this.pivot;
    this.quad = this.quad.map((p) => rotateAbout(p, c, angle)) as Quad;
    if (this.mesh) this.mesh = { ...this.mesh, pts: this.mesh.pts.map((p) => rotateAbout(p, c, angle)) };
  }

  /** Mirrors the box across the reference point (horizontally or vertically). */
  flip(horizontal: boolean): void {
    const c = this.pivot;
    const m = (p: Pt) => (horizontal ? { x: 2 * c.x - p.x, y: p.y } : { x: p.x, y: 2 * c.y - p.y });
    this.quad = this.quad.map(m) as Quad;
    if (this.mesh) this.mesh = { ...this.mesh, pts: this.mesh.pts.map(m) };
  }

  /** Angle of the top edge (radians). */
  get topAngle(): number {
    const [a, b] = this.quad;
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  /** Scale (as factors) and angle while the box is a turned rectangle. */
  rectangleParams(): { sx: number; sy: number; angle: number } | null {
    if (!this.affine) return null;
    const [p0, p1, , p3] = this.quad;
    const ux = p1.x - p0.x;
    const uy = p1.y - p0.y;
    const vx = p3.x - p0.x;
    const vy = p3.y - p0.y;
    const lu = Math.hypot(ux, uy);
    const lv = Math.hypot(vx, vy);
    if (lu === 0 || lv === 0) return null;
    // Not a rectangle (skewed): the numbers would not describe it.
    const cross = ux * vy - uy * vx;
    const dot = ux * vx + uy * vy;
    if (Math.abs(dot) > 1e-6 * lu * lv) return null;
    return { sx: lu / this.w, sy: (Math.sign(cross) * lv) / this.h, angle: Math.atan2(uy, ux) };
  }

  /** A turned rectangle with these scale factors and angle around the box centre. */
  setRectangle(sx: number, sy: number, angle: number): void {
    const c = this.mapLocal(this.w / 2, this.h / 2);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const at = (x: number, y: number): Pt => {
      const lx = (x - this.w / 2) * sx;
      const ly = (y - this.h / 2) * sy;
      return { x: c.x + lx * cos - ly * sin, y: c.y + lx * sin + ly * cos };
    };
    this.quad = [at(0, 0), at(this.w, 0), at(this.w, this.h), at(0, this.h)];
    this.mesh = null;
  }
}

let active: FreeTransform | null = null;

export const isTransforming = () => active !== null;

function publish(): void {
  const t = active;
  if (!t) {
    useTransformInfo.setState({ info: null });
    return;
  }
  const r = t.rectangleParams();
  useTransformInfo.setState({
    info: {
      ...prefs,
      mode: t.mode,
      pivot: { ...t.pivot },
      scale: r ? { x: r.sx * 100, y: r.sy * 100 } : null,
      angle: r ? (r.angle * 180) / Math.PI : null,
    },
  });
}

/**
 * Starts transforming the selection or the current layer's content in the given mode
 * (Edit > Transform; ⌘T Scale up/Scale down/Rotate, ⇧⌘T Free transform).
 */
export function startTransform(mode: TransformMode = 'scaleRotate'): boolean {
  if (active) {
    setTransformMode(mode);
    return true;
  }
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
  setState({ transforming: true, hint: hintFor(mode) });
  publish();
  return true;
}

const hintFor = (mode: TransformMode) =>
  mode === 'mesh'
    ? 'Drag the lattice points · Enter to confirm, Esc to cancel'
    : mode === 'scaleRotate' || mode === 'scale' || mode === 'rotate'
      ? 'Drag handles to scale, outside to rotate · Enter to confirm, Esc to cancel'
      : 'Drag the corners and edges · Enter to confirm, Esc to cancel';

export function confirmTransform(): void {
  if (!active) return;
  active.commit();
  active = null;
  setState({ transforming: false, hint: '' });
  publish();
}

export function cancelTransform(): void {
  if (!active) return;
  active.cancel();
  active = null;
  setState({ transforming: false, hint: '' });
  publish();
}

// ------------------------------------------------------------------ Tool Property settings

/** Switches the mode while transforming; the current shape stays (a mesh keeps its corners). */
export function setTransformMode(mode: TransformMode): void {
  const t = active;
  if (!t || t.mode === mode) return;
  if (mode === 'mesh') t.mesh = t.newMesh();
  else if (t.mesh) {
    const { corners } = t.handles();
    t.quad = corners as Quad;
    t.mesh = null;
  }
  t.mode = mode;
  setState({ hint: hintFor(mode) });
  t.render();
}

export function setTransformPrefs(patch: Partial<TransformPrefs>): void {
  const lattice = (patch.latticeX !== undefined && patch.latticeX !== prefs.latticeX) || (patch.latticeY !== undefined && patch.latticeY !== prefs.latticeY);
  Object.assign(prefs, patch);
  prefs.latticeX = Math.min(16, Math.max(2, Math.round(prefs.latticeX)));
  prefs.latticeY = Math.min(16, Math.max(2, Math.round(prefs.latticeY)));
  const t = active;
  if (!t) return;
  // A new lattice keeps the current shape.
  if (lattice && t.mesh) t.mesh = t.newMesh();
  if (patch.reference && patch.reference !== 'free') t.followPivot();
  t.render();
}

/** Moves the reference point (Free position). */
export function setTransformPivot(x: number, y: number): void {
  const t = active;
  if (!t) return;
  prefs.reference = 'free';
  t.pivot = { x, y };
  publish();
}

/** Scale ratio (%) and rotation angle (degrees) typed into the Tool Property palette. */
export function setTransformNumbers(scaleX: number, scaleY: number, angle: number): void {
  const t = active;
  if (!t) return;
  t.setRectangle(scaleX / 100, scaleY / 100, (angle * Math.PI) / 180);
  t.followPivot();
  t.render();
}

export function resetTransform(): void {
  const t = active;
  if (!t) return;
  t.quad = boxQuad(t.bounds);
  t.mesh = t.mode === 'mesh' ? t.newMesh() : null;
  if (prefs.reference !== 'free') t.followPivot();
  t.render();
}

/** Flip horizontal / vertical at the reference point. */
export function flipTransform(horizontal: boolean): void {
  const t = active;
  if (!t) return;
  t.flip(horizontal);
  t.followPivot();
  t.render();
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

// ------------------------------------------------------------------ handles

const near = (view: OverlayView, p: PointerInfo, d: Pt, px = HANDLE_PX) => {
  const s = applyMatrix(view.matrix, d.x, d.y);
  return Math.abs(s.x - p.sx) <= px && Math.abs(s.y - p.sy) <= px;
};

/** Even-odd test of a point in a polygon. */
function insidePolygon(pts: Pt[], p: Pt): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Which handle is under a viewport point. */
export function hitHandle(p: PointerInfo, view: OverlayView): Handle {
  const t = active!;
  if (t.mesh) {
    for (let i = 0; i < t.mesh.pts.length; i++) if (near(view, p, t.mesh.pts[i])) return { kind: 'lattice', index: i };
  } else {
    const { corners, edges } = t.handles();
    for (let i = 0; i < 4; i++) if (near(view, p, corners[i])) return { kind: 'corner', index: i };
    for (let i = 0; i < 4; i++) if (near(view, p, edges[i])) return { kind: 'edge', index: i };
  }
  if (near(view, p, t.pivot, 6)) return { kind: 'pivot' };
  const outline = t.mesh ? meshOutline(t.mesh) : t.quad;
  if (insidePolygon(outline, p)) return { kind: 'move' };
  // Outside the box: rotate, except where the mode cannot rotate.
  return t.mode === 'scale' || t.mode === 'mesh' ? { kind: 'none' } : { kind: 'rotate' };
}

export function transformCursor(h: Handle): string {
  switch (h.kind) {
    case 'move':
      return 'move';
    case 'rotate':
      return 'alias';
    case 'pivot':
    case 'lattice':
      return 'crosshair';
    case 'none':
      return 'default';
    default:
      if (active?.mode === 'rotate') return 'alias';
      return 'pointer';
  }
}

/** Snaps a drag to horizontal, vertical or diagonal (⇧). */
function snap45(dx: number, dy: number): [number, number] {
  const len = Math.hypot(dx, dy);
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return [Math.cos(a) * len, Math.sin(a) * len];
}

/** Keeps only the larger of the two components (a drag "in a single direction"). */
const dominant = (dx: number, dy: number): [number, number] => (Math.abs(dx) >= Math.abs(dy) ? [dx, 0] : [0, dy]);

/** Corner indices of each edge: top, right, bottom, left. */
const EDGE_CORNERS: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
];

export class TransformSession implements ToolSession {
  private start: PointerInfo;
  private startQuad: Quad;
  private startMesh: Mesh | null;
  private startPivot: Pt;
  readonly cursor: string;

  constructor(
    p: PointerInfo,
    private handle: Handle,
  ) {
    const t = active!;
    this.start = p;
    this.startQuad = t.quad.map((q) => ({ ...q })) as Quad;
    this.startMesh = t.mesh ? { ...t.mesh, pts: t.mesh.pts.map((q) => ({ ...q })) } : null;
    this.startPivot = { ...t.pivot };
    this.cursor = transformCursor(handle);
    // ⌥-click away from the handles puts the reference point there.
    if (p.alt && (handle.kind === 'move' || handle.kind === 'rotate' || handle.kind === 'none')) {
      setTransformPivot(p.x, p.y);
      this.handle = { kind: 'pivot' };
    }
  }

  private restore(t: FreeTransform): void {
    t.quad = this.startQuad.map((q) => ({ ...q })) as Quad;
    t.mesh = this.startMesh ? { ...this.startMesh, pts: this.startMesh.pts.map((q) => ({ ...q })) } : null;
    t.pivot = { ...this.startPivot };
  }

  move(p: PointerInfo): void {
    const t = active;
    if (!t) return;
    this.restore(t);
    let dx = p.x - this.start.x;
    let dy = p.y - this.start.y;
    const h = this.handle;
    switch (h.kind) {
      case 'none':
        return;
      case 'pivot':
        setTransformPivot(this.startPivot.x + dx, this.startPivot.y + dy);
        return;
      case 'move':
        if (p.shift) [dx, dy] = snap45(dx, dy);
        t.translate(dx, dy);
        break;
      case 'rotate':
        this.rotateTo(t, p);
        break;
      case 'lattice': {
        if (p.shift) [dx, dy] = snap45(dx, dy);
        const pts = t.mesh!.pts.slice();
        pts[h.index] = { x: pts[h.index].x + dx, y: pts[h.index].y + dy };
        t.mesh = { ...t.mesh!, pts };
        break;
      }
      default:
        this.dragHandle(t, h, p, dx, dy);
    }
    if (prefs.reference !== 'free') t.followPivot();
    t.scheduleRender();
  }

  private rotateTo(t: FreeTransform, p: PointerInfo): void {
    const c = this.startPivot;
    const a0 = Math.atan2(this.start.y - c.y, this.start.x - c.x);
    const a1 = Math.atan2(p.y - c.y, p.x - c.x);
    let delta = a1 - a0;
    if (p.shift) {
      // ⇧: the box ends at a multiple of 45°.
      const top = t.topAngle;
      delta = Math.round((top + delta) / (Math.PI / 4)) * (Math.PI / 4) - top;
    }
    t.rotate(delta);
  }

  private dragHandle(t: FreeTransform, h: { kind: 'corner' | 'edge'; index: number }, p: PointerInfo, dx: number, dy: number): void {
    const q = this.startQuad;
    switch (t.mode) {
      case 'scaleRotate':
      case 'scale':
        t.quad = scaledQuad(t, q, h, p, prefs.keepAspect || p.shift);
        return;
      case 'rotate':
        this.rotateTo(t, p);
        return;
      case 'free': {
        if (p.shift) [dx, dy] = dominant(dx, dy);
        const moved = q.map((c) => ({ ...c })) as Quad;
        const which = h.kind === 'corner' ? [h.index] : EDGE_CORNERS[h.index];
        for (const i of which) moved[i] = { x: q[i].x + dx, y: q[i].y + dy };
        t.quad = moved;
        return;
      }
      case 'distort': {
        const moved = q.map((c) => ({ ...c })) as Quad;
        if (h.kind === 'corner') {
          // A corner moves in one direction only.
          [dx, dy] = dominant(dx, dy);
          moved[h.index] = { x: q[h.index].x + dx, y: q[h.index].y + dy };
        } else slideEdge(moved, q, h.index, dx, dy);
        t.quad = moved;
        return;
      }
      case 'skew': {
        const moved = q.map((c) => ({ ...c })) as Quad;
        slideEdge(moved, q, h.kind === 'edge' ? h.index : edgeAlong(q, h.index, dx, dy), dx, dy);
        t.quad = moved;
        return;
      }
      case 'perspective': {
        const moved = q.map((c) => ({ ...c })) as Quad;
        if (h.kind === 'edge') slideEdge(moved, q, h.index, dx, dy);
        else {
          // The corner slides along its edge; the edge's other corner moves the opposite way.
          const e = edgeAlong(q, h.index, dx, dy);
          const [a, b] = EDGE_CORNERS[e];
          const other = a === h.index ? b : a;
          const d = along(q, e, dx, dy);
          moved[h.index] = { x: q[h.index].x + d.x, y: q[h.index].y + d.y };
          moved[other] = { x: q[other].x - d.x, y: q[other].y - d.y };
        }
        t.quad = moved;
        return;
      }
    }
  }

  up(p: PointerInfo): void {
    this.move(p);
  }

  cancel(): void {
    const t = active;
    if (!t) return;
    this.restore(t);
    t.render();
  }
}

/** The drag projected onto edge e's direction. */
function along(q: Quad, e: number, dx: number, dy: number): Pt {
  const [a, b] = EDGE_CORNERS[e];
  const ux = q[b].x - q[a].x;
  const uy = q[b].y - q[a].y;
  const len2 = ux * ux + uy * uy || 1;
  const k = (dx * ux + dy * uy) / len2;
  return { x: ux * k, y: uy * k };
}

/** Moves both corners of edge e along the edge (skews the box). */
function slideEdge(moved: Quad, q: Quad, e: number, dx: number, dy: number): void {
  const d = along(q, e, dx, dy);
  for (const i of EDGE_CORNERS[e]) moved[i] = { x: q[i].x + d.x, y: q[i].y + d.y };
}

/** Of the two edges meeting at a corner, the one the drag runs along. */
function edgeAlong(q: Quad, corner: number, dx: number, dy: number): number {
  const edges = EDGE_CORNERS.map((c, i) => [c, i] as const).filter(([c]) => c.includes(corner));
  let best = edges[0][1];
  let score = -1;
  for (const [[a, b], i] of edges) {
    const ux = q[b].x - q[a].x;
    const uy = q[b].y - q[a].y;
    const s = Math.abs(dx * ux + dy * uy) / (Math.hypot(ux, uy) || 1);
    if (s > score) {
      score = s;
      best = i;
    }
  }
  return best;
}

/**
 * Scale handle: the box scales in its own (local) frame with the opposite side fixed; with Keep
 * aspect ratio (or ⇧) both directions scale alike, also from the edge handles.
 */
function scaledQuad(t: FreeTransform, q: Quad, h: { kind: 'corner' | 'edge'; index: number }, p: PointerInfo, keep: boolean): Quad {
  const { w, h: hh } = t;
  const H = quadHomography(w, hh, q);
  const local = applyH(invertH(H), p.x, p.y);
  // Handle direction in the box: −1, 0 or 1 per axis.
  const CORNER_DIR: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const EDGE_DIR: [number, number][] = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];
  const [hx, hy] = h.kind === 'corner' ? CORNER_DIR[h.index] : EDGE_DIR[h.index];
  const ax = hx === 0 ? w / 2 : ((1 - hx) / 2) * w;
  const ay = hy === 0 ? hh / 2 : ((1 - hy) / 2) * hh;
  const hxL = ((hx + 1) / 2) * w;
  const hyL = ((hy + 1) / 2) * hh;
  let kx = hx !== 0 ? (local.x - ax) / (hxL - ax) : 1;
  let ky = hy !== 0 ? (local.y - ay) / (hyL - ay) : 1;
  if (keep) {
    const k = hx !== 0 && hy !== 0 ? Math.max(Math.abs(kx), Math.abs(ky)) : hx !== 0 ? Math.abs(kx) : Math.abs(ky);
    kx = Math.sign(hx !== 0 ? kx || 1 : 1) * k;
    ky = Math.sign(hy !== 0 ? ky || 1 : 1) * k;
  }
  const min = 1 / Math.max(w, hh);
  if (Math.abs(kx) < min) kx = Math.sign(kx || 1) * min;
  if (Math.abs(ky) < min) ky = Math.sign(ky || 1) * min;
  const at = (x: number, y: number) => applyH(H, ax + (x - ax) * kx, ay + (y - ay) * ky);
  return [at(0, 0), at(w, 0), at(w, hh), at(0, hh)];
}

// ------------------------------------------------------------------ overlay

export function drawTransformOverlay(ctx: CanvasRenderingContext2D, view: OverlayView): void {
  const t = active;
  if (!t) return;
  const toView = (d: Pt) => applyMatrix(view.matrix, d.x, d.y);
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#2f80ed';
  const box = (pts: Pt[]) => {
    ctx.fillStyle = '#fff';
    for (const d of pts) {
      const s = toView(d);
      ctx.fillRect(s.x - 4, s.y - 4, 8, 8);
      ctx.strokeRect(s.x - 4, s.y - 4, 8, 8);
    }
  };
  if (t.mesh) {
    // Lattice lines between the points (straight, like the reference).
    const m = t.mesh;
    ctx.beginPath();
    for (let j = 0; j < m.rows; j++) {
      for (let i = 0; i < m.cols; i++) {
        const s = toView(m.pts[j * m.cols + i]);
        if (i < m.cols - 1) {
          const r = toView(m.pts[j * m.cols + i + 1]);
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(r.x, r.y);
        }
        if (j < m.rows - 1) {
          const d = toView(m.pts[(j + 1) * m.cols + i]);
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(d.x, d.y);
        }
      }
    }
    ctx.stroke();
    box(m.pts);
  } else {
    const { corners, edges } = t.handles();
    ctx.beginPath();
    // The edges of a perspective box are straight lines between its corners.
    corners.map(toView).forEach((s, i) => (i === 0 ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y)));
    ctx.closePath();
    ctx.stroke();
    if (t.mode !== 'rotate') box([...corners, ...edges]);
    else box(corners);
  }
  // Reference point (+).
  const c = toView(t.pivot);
  ctx.strokeStyle = '#000';
  ctx.beginPath();
  ctx.moveTo(c.x - 6, c.y);
  ctx.lineTo(c.x + 6, c.y);
  ctx.moveTo(c.x, c.y - 6);
  ctx.lineTo(c.x, c.y + 6);
  ctx.stroke();
  ctx.strokeStyle = '#fff';
  ctx.beginPath();
  ctx.arc(c.x, c.y, 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
