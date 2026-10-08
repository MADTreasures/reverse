/** Press-drag-release interactions for every tool. */
import { hexToRgb } from '../model/color';
import { findLayer, flatten, isEffectivelyVisible } from '../model/layers';
import type { Id, VectorLayer } from '../model/types';
import { CLOSE_GAP_STEPS, floodFillMask } from '../paint/fill';
import { combine, ellipseMask, expandMask, isSelected, maskBounds, polygonMask, rectMask, translateMask, type Mask, type SelectionOp } from '../paint/mask';
import { fromPoints, union, type Rect } from '../paint/rect';
import { isSpecial, perspectiveConstraint, rulerConstraint, symmetryTransforms, type Affine, type Constraint, type Pt, type Ruler } from '../paint/rulers';
import { ellipsePoints, rectPoints, snapAngle, type StrokePoint } from '../paint/stroke';
import { evalPressureCurve } from '../paint/curve';
import { type FillReference, type SubTool } from '../paint/tools';
import { eraseAt, linesBounds, newStrokeId, transformStrokes, type VectorEraseMode, type VectorStroke } from '../paint/vector';
import { contentBounds, contentOf, pickContent, transformContent, type Content } from '../paint/objects';
import { newObjectId } from '../paint/text';
import { newPanelId, panelEdges } from '../paint/frames';
import { apply as applyMatrix, normalizeAngle } from '../paint/viewMath';
import { BlendStroke, BrushStroke, type Stroke, type StrokeTarget } from '../engine/brushEngine';
import { createCanvas, ctx2d, maskToCanvas } from '../engine/canvas';
import { captureLayerChange, DirectEdit, LayerEdit, type PixelPatch } from '../engine/edit';
import { engine } from '../engine/engine';
import { getSurface } from '../engine/surfaces';
import * as actions from '../store/actions';
import { drawingColor, getState, setState } from '../store/store';
import { referencePixels } from './reference';
import type { Modifiers, OverlayView, PointerInfo, ToolSession } from './types';

const DRAG_THRESHOLD = 3;

function blocked(reason: string | null): boolean {
  if (reason) setState({ hint: reason });
  return reason !== null;
}

/** Target for painting on the current layer (or its mask), or null (with a hint) if it cannot be edited. */
export function strokeTarget(): StrokeTarget | null {
  const s = getState();
  if (blocked(actions.editBlocker(s))) return null;
  const target = actions.editTarget(s)!;
  const surface = getSurface(target.surfaceId);
  if (!surface) return null;
  return {
    layerId: target.surfaceId,
    layer: surface,
    selection: engine.selectionCanvas(),
    lockAlpha: target.lockAlpha,
    onChange: (r) => engine.invalidate(r),
  };
}

/** Like strokeTarget, for tools that only work on pixels (fill, gradient, blend). */
function rasterTarget(): StrokeTarget | null {
  return blocked(actions.rasterOnlyBlocker()) ? null : strokeTarget();
}

const toStroke = (p: PointerInfo): StrokePoint => ({ x: p.x, y: p.y, pressure: p.pressure, tilt: p.tilt, azimuth: p.azimuth });

/** The active vector layer when the drawing tools draw lines (not on its mask). */
function vectorTarget(): VectorLayer | null {
  const t = actions.editTarget();
  return t?.vector && t.layer.kind === 'vector' ? t.layer : null;
}

/**
 * The finished stroke as vector lines (one per symmetry copy). Colour mixing and the watercolor edge
 * are pixel effects, so lines are stored without them; transparent strokes become erasing lines.
 */
function strokeLines(sub: SubTool, stroke: BrushStroke, erase: boolean): VectorStroke[] {
  const points = stroke.endAsLine();
  if (points.length === 0) return [];
  const s = getState();
  const line: VectorStroke = {
    id: newStrokeId(),
    color: drawingColor(s.colors),
    brush: { ...sub.brush!, mixing: 'none', watercolorEdge: false, stabilization: 0 },
    points,
    ...(erase ? { erase: true } : {}),
  };
  return (stroke.copies ?? [null]).map((m) => (m ? { ...transformStrokes([line], m)[0], id: newStrokeId() } : line));
}

/** Selection combine mode from modifier keys (Shift adds, Option subtracts, both intersect). */
export function selectionOpFor(m: Modifiers): SelectionOp {
  if (m.shift && m.alt) return 'intersect';
  if (m.shift) return 'add';
  if (m.alt) return 'subtract';
  return getState().selectionOp;
}

function strokeOverlayColor(ctx: CanvasRenderingContext2D): void {
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#000';
  ctx.setLineDash([4, 4]);
}

// ------------------------------------------------------------------ brushes

/** End of the last brush stroke per layer (⇧-click connects from there). */
let lastStrokeEnd: { layerId: Id; x: number; y: number; pressure: number } | null = null;

type PerspectiveRuler = Extract<Ruler, { kind: 'perspective' }>;

/** How the current rulers shape a stroke that starts at `start`. */
interface Snap {
  copies: Affine[] | null;
  constrain: Constraint | null;
  /** Perspective: the direction is chosen once the stroke has moved a little. */
  perspective: PerspectiveRuler | null;
}

/**
 * Ruler snapping (View > Snap): one special ruler (symmetry, perspective, parallel, radial,
 * concentric) or a linear ruler / guide the stroke starts near.
 */
export function rulerSnap(start: Pt): Snap {
  const s = getState();
  const none: Snap = { copies: null, constrain: null, perspective: null };
  const rulers = actions.activeRulers(s).map((x) => x.ruler);
  if (s.snapSpecial) {
    const special = rulers.find(isSpecial);
    if (special?.kind === 'symmetry') return { ...none, copies: symmetryTransforms(special) };
    if (special?.kind === 'perspective') return { ...none, perspective: special };
    const c = special ? rulerConstraint(special, start) : null;
    if (c) return { ...none, constrain: c };
  }
  if (s.snapRuler) {
    // Within about 16 screen pixels.
    const reach = 16 / Math.max(0.01, s.view.zoom);
    for (const r of rulers) {
      if (isSpecial(r)) continue;
      const c = rulerConstraint(r, start, reach);
      if (c) return { ...none, constrain: c };
    }
    // Comic frame borders work as rulers too.
    for (const l of flatten(s.doc.layers)) {
      if (!actions.isFrameFolder(l) || !isEffectivelyVisible(s.doc.layers, l.id)) continue;
      for (const [a, b] of panelEdges(l.frame.panels)) {
        const c = rulerConstraint({ kind: 'linear', id: 'frame', a, b }, start, reach);
        if (c) return { ...none, constrain: c };
      }
    }
  }
  return none;
}

/** Screen distance a stroke travels before a perspective direction is chosen. */
const PERSPECTIVE_DECIDE_PX = 6;

export class BrushSession implements ToolSession {
  private stroke: Stroke;
  private start: PointerInfo;
  private last: PointerInfo;
  private lineMode: boolean;
  /** ⇧-click: the straight line starts at the end of the previous stroke. */
  private connectFrom: StrokePoint | null;
  private layerId: Id;
  private snap: Snap;
  /** Points held back until a perspective direction is chosen. */
  private held: StrokePoint[] | null = null;
  /** Drawing on a vector layer: the stroke becomes a line. */
  private vector: boolean;
  readonly cursor = 'none';

  static create(sub: SubTool, p: PointerInfo): ToolSession | null {
    if (!sub.brush) return null;
    if (vectorTarget() && !actions.editBlocker()) {
      // On vector layers erasers erase lines; the blend tool only works on pixels.
      if (sub.brush.mode === 'blend') {
        blocked(actions.rasterOnlyBlocker());
        return null;
      }
      if (sub.brush.mode === 'erase') return VectorEraseSession.create(sub, p);
    }
    const target = strokeTarget();
    if (!target) return null;
    return new BrushSession(sub, p, target);
  }

  private constructor(
    private sub: SubTool,
    p: PointerInfo,
    target: StrokeTarget,
  ) {
    const s = getState();
    const brush = sub.brush!;
    this.layerId = target.layerId;
    this.vector = vectorTarget() !== null;
    this.stroke =
      brush.mode === 'blend'
        ? new BlendStroke(brush, target)
        : new BrushStroke(this.vector ? { ...brush, mixing: 'none', watercolorEdge: false } : brush, drawingColor(s.colors), s.colors.transparent, target);
    this.start = p;
    this.last = p;
    this.lineMode = p.shift && brush.mode !== 'blend';
    this.connectFrom = this.lineMode && lastStrokeEnd?.layerId === target.layerId ? { ...lastStrokeEnd } : null;
    this.snap = rulerSnap(this.connectFrom ?? p);
    if (this.stroke instanceof BrushStroke) {
      this.stroke.copies = this.snap.copies;
      this.stroke.constrain = this.snap.constrain;
    }
    if (this.lineMode) this.drawLine(p);
    else if (this.snap.perspective && this.stroke instanceof BrushStroke) this.held = [toStroke(p)];
    else this.stroke.add(toStroke(p));
  }

  /** End point of a straight line, following the rulers. */
  private lineEnd(from: StrokePoint, p: PointerInfo): StrokePoint {
    const end = { ...toStroke(p), pressure: from.pressure };
    if (this.snap.perspective) {
      const c = perspectiveConstraint(this.snap.perspective, from, end);
      return c ? { ...end, ...c(end) } : end;
    }
    return this.snap.constrain ? { ...end, ...this.snap.constrain(end) } : end;
  }

  private drawLine(p: PointerInfo): void {
    const from = this.connectFrom ?? toStroke(this.start);
    this.stroke.path([from, this.lineEnd(from, p)]);
  }

  move(p: PointerInfo, coalesced: PointerInfo[]): void {
    this.last = p;
    if (this.lineMode) {
      // Dragging (instead of clicking) draws a new straight line from the press point.
      if (this.connectFrom && Math.hypot(p.sx - this.start.sx, p.sy - this.start.sy) >= DRAG_THRESHOLD) this.connectFrom = null;
      this.drawLine(p);
      return;
    }
    const points = (coalesced.length ? coalesced : [p]).map(toStroke);
    if (this.held) {
      this.held.push(...points);
      if (Math.hypot(p.sx - this.start.sx, p.sy - this.start.sy) < PERSPECTIVE_DECIDE_PX) return;
      // The stroke follows the perspective direction closest to how it started.
      (this.stroke as BrushStroke).constrain = perspectiveConstraint(this.snap.perspective!, this.held[0], toStroke(p));
      const held = this.held;
      this.held = null;
      for (const q of held) this.stroke.add(q);
      return;
    }
    for (const q of points) this.stroke.add(q);
  }

  up(p: PointerInfo): void {
    this.last = p;
    if (this.lineMode) this.drawLine(p);
    if (this.held) {
      for (const q of this.held) this.stroke.add(q);
      this.held = null;
    }
    let drawn: boolean;
    if (this.vector && this.stroke instanceof BrushStroke) {
      const lines = strokeLines(this.sub, this.stroke, getState().colors.transparent);
      actions.addVectorLines(this.layerId, lines, this.sub.name);
      drawn = lines.length > 0;
    } else {
      const patch = this.stroke.end();
      actions.commitPixels(this.sub.name, [patch]);
      drawn = patch !== null;
    }
    lastStrokeEnd = { layerId: this.layerId, x: this.last.x, y: this.last.y, pressure: this.lineMode ? (this.connectFrom ?? toStroke(this.start)).pressure : this.last.pressure };
    const s = getState();
    if (drawn && this.sub.brush?.mode === 'paint' && !s.colors.transparent && !actions.editingMask(s)) actions.addColorToHistory(drawingColor(s.colors));
  }

  cancel(): void {
    this.stroke.cancel();
  }
}

// ------------------------------------------------------------------ figure (shapes drawn with the brush)

export class FigureSession implements ToolSession {
  private stroke: BrushStroke;
  private start: PointerInfo;
  private last: PointerInfo;
  private snap: Snap;

  static create(sub: SubTool, p: PointerInfo): FigureSession | null {
    const target = strokeTarget();
    if (!target || !sub.brush) return null;
    return new FigureSession(sub, p, target);
  }

  private constructor(
    private sub: SubTool,
    p: PointerInfo,
    target: StrokeTarget,
  ) {
    const s = getState();
    this.stroke = new BrushStroke({ ...sub.brush!, stabilization: 0 }, drawingColor(s.colors), s.colors.transparent, target);
    this.start = p;
    this.last = p;
    this.snap = rulerSnap(p);
    this.stroke.copies = this.snap.copies;
  }

  private points(p: PointerInfo, m: Modifiers): StrokePoint[] {
    let { x: x0, y: y0 } = this.start;
    let { x: x1, y: y1 } = p;
    const shape = this.sub.figureShape ?? 'line';
    if (shape === 'line') {
      const from = { x: x0, y: y0, pressure: 1 };
      if (this.snap.perspective) {
        const c = perspectiveConstraint(this.snap.perspective, from, { x: x1, y: y1 });
        if (c) ({ x: x1, y: y1 } = c({ x: x1, y: y1 }));
      } else if (this.snap.constrain) ({ x: x1, y: y1 } = this.snap.constrain({ x: x1, y: y1 }));
      else if (m.shift) ({ x: x1, y: y1 } = snapAngle(x0, y0, x1, y1));
      return [from, { x: x1, y: y1, pressure: 1 }];
    }
    if (m.shift) {
      // Square / circle.
      const d = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      x1 = x0 + Math.sign(x1 - x0 || 1) * d;
      y1 = y0 + Math.sign(y1 - y0 || 1) * d;
    }
    if (m.alt) {
      // Drawn from the centre.
      const dx = x1 - x0;
      const dy = y1 - y0;
      x0 -= dx;
      y0 -= dy;
    }
    return shape === 'rect' ? rectPoints(x0, y0, x1, y1) : ellipsePoints(x0, y0, x1, y1);
  }

  move(p: PointerInfo): void {
    this.last = p;
    this.stroke.path(this.points(p, p));
  }

  modifiers(m: Modifiers): void {
    this.stroke.path(this.points(this.last, m));
  }

  up(p: PointerInfo): void {
    if (Math.hypot(p.sx - this.start.sx, p.sy - this.start.sy) < DRAG_THRESHOLD) {
      this.stroke.cancel();
      return;
    }
    this.stroke.path(this.points(p, p));
    const layer = vectorTarget();
    if (layer) actions.addVectorLines(layer.id, strokeLines(this.sub, this.stroke, getState().colors.transparent), this.sub.name);
    else actions.commitPixels(this.sub.name, [this.stroke.end()]);
  }

  cancel(): void {
    this.stroke.cancel();
  }
}

// ------------------------------------------------------------------ vector eraser

/**
 * Erasers on vector layers erase lines instead of pixels: the touched parts, the touched part up to
 * the nearest crossings with other lines, or whole lines (sub tool setting "Vector eraser").
 */
export class VectorEraseSession implements ToolSession {
  private lines: VectorStroke[];
  private readonly original: VectorStroke[];
  private readonly mode: VectorEraseMode;
  /** Lines on the other vector layers ("Refer all layers" for erasing up to intersections). */
  private readonly others: VectorStroke[];
  private last: PointerInfo;
  /** Area redrawn so far (restored on cancel). */
  private dirty: Rect | null = null;
  readonly cursor = 'none';

  static create(sub: SubTool, p: PointerInfo): VectorEraseSession | null {
    const layer = vectorTarget();
    return layer && !blocked(actions.editBlocker()) ? new VectorEraseSession(sub, layer, p) : null;
  }

  private constructor(
    private sub: SubTool,
    private layer: VectorLayer,
    p: PointerInfo,
  ) {
    this.original = layer.strokes;
    this.lines = layer.strokes;
    this.mode = sub.vectorErase ?? 'touched';
    const { doc } = getState();
    this.others =
      this.mode === 'intersection' && sub.vectorReferAll
        ? flatten(doc.layers).flatMap((l) => (l.kind === 'vector' && l.id !== layer.id && isEffectivelyVisible(doc.layers, l.id) ? l.strokes : []))
        : [];
    this.last = p;
    this.erase(p, p);
  }

  private radius(p: PointerInfo): number {
    const b = this.sub.brush!;
    const f = b.sizePressure ? b.minSize + (1 - b.minSize) * evalPressureCurve(b.sizeCurve, p.pressure) : 1;
    return Math.max(0.5, (b.size / 2) * f);
  }

  /** Erases along the way from `a` to `b` (dabs half a radius apart), then redraws what changed. */
  private erase(a: PointerInfo, b: PointerInfo): void {
    const r = this.radius(b);
    const sel = getState().selection;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(0.5, r / 2)));
    const before = this.lines;
    let lines = before;
    for (let i = a === b ? n : 1; i <= n; i++) {
      const c = { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n };
      // With a selection, only lines inside it are erased.
      if (sel && !isSelected(sel, c)) continue;
      lines = eraseAt(lines, c, r, this.mode, this.others.length ? [...lines, ...this.others] : lines);
    }
    const kept = new Set(lines);
    const removed = before.filter((x) => !kept.has(x));
    if (removed.length === 0) return;
    this.lines = lines;
    const area = linesBounds(removed);
    this.dirty = union(this.dirty, area);
    engine.renderVectorLines(this.layer.id, lines, area);
  }

  move(p: PointerInfo, coalesced: PointerInfo[]): void {
    for (const q of coalesced.length ? coalesced : [p]) {
      this.erase(this.last, q);
      this.last = q;
    }
  }

  up(p: PointerInfo): void {
    this.erase(this.last, p);
    if (this.lines === this.original) return;
    engine.expectVectorLines(this.layer.id, this.lines);
    actions.setVectorStrokes(this.layer.id, this.lines, this.sub.name);
  }

  cancel(): void {
    if (this.dirty) engine.renderVectorLines(this.layer.id, this.original, this.dirty);
  }
}

// ------------------------------------------------------------------ fill & auto select

/** "Refer multiple" toggled for one click (⇧ with the fill tool, ⌘ with auto select). */
const toggled = (ref: FillReference): FillReference => (ref === 'layer' ? 'all' : 'layer');

function regionMask(sub: SubTool, p: PointerInfo, toggleReference: boolean): Mask | null {
  const s = getState();
  const opts = sub.fill!;
  const reference = toggleReference ? toggled(opts.reference) : opts.reference;
  const pixels = referencePixels(s.doc, actions.editTarget(s)?.surfaceId ?? s.activeLayerId, reference);
  let mask = floodFillMask(pixels.data, s.doc.width, s.doc.height, p.x, p.y, {
    tolerance: opts.tolerance,
    alphaOnly: opts.alphaOnly,
    contiguous: opts.contiguous,
    closeGap: CLOSE_GAP_STEPS[Math.max(0, Math.min(5, Math.round(opts.closeGap ?? 0)))],
  });
  if (opts.expand) mask = expandMask(mask, opts.expand);
  return mask;
}

export function fillAt(sub: SubTool, p: PointerInfo): void {
  const target = rasterTarget();
  if (!target || !sub.fill) return;
  const s = getState();
  let mask = regionMask(sub, p, p.shift);
  if (!mask) return;
  if (s.selection) mask = combine(s.selection, mask, 'intersect');
  const bounds = maskBounds(mask);
  if (!bounds) return;
  const transparent = s.colors.transparent;
  const rgb = hexToRgb(drawingColor(s.colors)) ?? { r: 0, g: 0, b: 0 };
  const paint = createCanvas(s.doc.width, s.doc.height);
  const img = new ImageData(s.doc.width, s.doc.height);
  for (let i = 0, q = 0; i < mask.data.length; i++, q += 4) {
    if (!mask.data[i]) continue;
    img.data[q] = rgb.r;
    img.data[q + 1] = rgb.g;
    img.data[q + 2] = rgb.b;
    img.data[q + 3] = mask.data[i];
  }
  ctx2d(paint).putImageData(img, 0, 0);
  const patch = captureLayerChange(target.layerId, target.layer, bounds, (ctx) => {
    ctx.save();
    ctx.globalCompositeOperation = transparent ? 'destination-out' : target.lockAlpha ? 'source-atop' : 'source-over';
    ctx.drawImage(paint, 0, 0);
    ctx.restore();
  });
  if (patch) {
    engine.invalidate(patch.rect);
    actions.commitPixels(sub.name, [patch]);
    if (!transparent && !actions.editingMask(s)) actions.addColorToHistory(drawingColor(s.colors));
  }
}

export function autoSelectAt(sub: SubTool, p: PointerInfo): void {
  if (!sub.fill) return;
  const mask = regionMask(sub, p, p.mod);
  if (mask) actions.applySelection(mask, selectionOpFor(p), 'Auto select');
}

// ------------------------------------------------------------------ gradient

export class GradientSession implements ToolSession {
  private edit: LayerEdit;
  private start: PointerInfo;
  private end: PointerInfo;
  readonly cursor = 'crosshair';

  static create(sub: SubTool, p: PointerInfo): GradientSession | null {
    const target = rasterTarget();
    return target ? new GradientSession(sub, p, target) : null;
  }

  private constructor(
    private sub: SubTool,
    p: PointerInfo,
    target: StrokeTarget,
  ) {
    const s = getState();
    this.edit = new LayerEdit(target.layerId, target.layer, {
      mode: s.colors.transparent ? 'erase' : 'paint',
      opacity: 1,
      lockAlpha: target.lockAlpha,
      selection: target.selection,
      onChange: target.onChange,
    });
    this.start = p;
    this.end = p;
  }

  private render(m: Modifiers): void {
    const { doc, colors } = getState();
    let { x: x1, y: y1 } = this.end;
    const { x: x0, y: y0 } = this.start;
    if (m.shift) ({ x: x1, y: y1 } = snapAngle(x0, y0, x1, y1));
    const ctx = this.edit.bufferCtx;
    ctx.clearRect(0, 0, doc.width, doc.height);
    const g =
      this.sub.gradientShape === 'radial'
        ? ctx.createRadialGradient(x0, y0, 0, x0, y0, Math.max(1, Math.hypot(x1 - x0, y1 - y0)))
        : ctx.createLinearGradient(x0, y0, x1, y1);
    // Main colour → sub colour (or → transparent).
    g.addColorStop(0, colors.main);
    if (this.sub.gradientToTransparent) {
      const rgb = hexToRgb(colors.main) ?? { r: 0, g: 0, b: 0 };
      g.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
    } else g.addColorStop(1, colors.sub);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, doc.width, doc.height);
    this.edit.update({ x: 0, y: 0, w: doc.width, h: doc.height });
  }

  move(p: PointerInfo): void {
    this.end = p;
    this.render(p);
  }

  modifiers(m: Modifiers): void {
    this.render(m);
  }

  up(p: PointerInfo): void {
    this.end = p;
    if (Math.hypot(p.sx - this.start.sx, p.sy - this.start.sy) < DRAG_THRESHOLD) {
      this.edit.cancel();
      return;
    }
    this.render(p);
    actions.commitPixels(`Gradient: ${this.sub.name}`, [this.edit.commit()]);
  }

  cancel(): void {
    this.edit.cancel();
  }

  overlay(ctx: CanvasRenderingContext2D, view: OverlayView): void {
    const a = applyMatrix(view.matrix, this.start.x, this.start.y);
    const b = applyMatrix(view.matrix, this.end.x, this.end.y);
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#2f80ed';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

// ------------------------------------------------------------------ selection

export class SelectSession implements ToolSession {
  private points: { x: number; y: number }[] = [];
  private start: PointerInfo;
  private last: PointerInfo;
  private op: SelectionOp;
  /** ⇧ held at the start means "add"; ⇧ pressed during the drag makes a square / circle. */
  private shiftAtStart: boolean;
  readonly cursor = 'crosshair';

  constructor(
    private sub: SubTool,
    p: PointerInfo,
  ) {
    this.start = p;
    this.last = p;
    this.op = selectionOpFor(p);
    this.shiftAtStart = p.shift;
    this.points.push({ x: p.x, y: p.y });
  }

  modifiers(m: Modifiers): void {
    this.last = { ...this.last, ...m };
  }

  move(p: PointerInfo): void {
    this.last = p;
    if (this.sub.selectShape === 'lasso') this.points.push({ x: p.x, y: p.y });
  }

  private box(): Rect {
    let { x, y } = this.last;
    if (!this.shiftAtStart && this.last.shift) {
      const d = Math.max(Math.abs(x - this.start.x), Math.abs(y - this.start.y));
      x = this.start.x + Math.sign(x - this.start.x || 1) * d;
      y = this.start.y + Math.sign(y - this.start.y || 1) * d;
    }
    return fromPoints(this.start.x, this.start.y, x, y);
  }

  up(p: PointerInfo): void {
    this.move(p);
    const { doc } = getState();
    const dragged = Math.hypot(p.sx - this.start.sx, p.sy - this.start.sy) >= DRAG_THRESHOLD;
    if (!dragged) {
      // A plain click outside a drag clears the selection.
      if (this.op === 'replace') actions.deselect();
      return;
    }
    const shape = this.sub.selectShape ?? 'rect';
    const mask =
      shape === 'lasso'
        ? polygonMask(doc.width, doc.height, this.points)
        : shape === 'ellipse'
          ? ellipseMask(doc.width, doc.height, this.box())
          : rectMask(doc.width, doc.height, this.box());
    actions.applySelection(mask, this.op, `Selection: ${this.sub.name}`);
  }

  cancel(): void {}

  overlay(ctx: CanvasRenderingContext2D, view: OverlayView): void {
    const shape = this.sub.selectShape ?? 'rect';
    ctx.save();
    strokeOverlayColor(ctx);
    ctx.beginPath();
    if (shape === 'lasso') {
      this.points.forEach((q, i) => {
        const s = applyMatrix(view.matrix, q.x, q.y);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
    } else {
      const r = this.box();
      if (shape === 'ellipse') {
        const n = 64;
        for (let i = 0; i <= n; i++) {
          const a = (i / n) * Math.PI * 2;
          const s = applyMatrix(view.matrix, r.x + r.w / 2 + (Math.cos(a) * r.w) / 2, r.y + r.h / 2 + (Math.sin(a) * r.h) / 2);
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        }
      } else {
        const corners = [
          [r.x, r.y],
          [r.x + r.w, r.y],
          [r.x + r.w, r.y + r.h],
          [r.x, r.y + r.h],
        ].map(([x, y]) => applyMatrix(view.matrix, x, y));
        corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
        ctx.closePath();
      }
    }
    ctx.stroke();
    ctx.strokeStyle = '#fff';
    ctx.lineDashOffset = 4;
    ctx.stroke();
    ctx.restore();
  }
}

// ------------------------------------------------------------------ eyedropper

export class EyedropperSession implements ToolSession {
  readonly cursor = 'crosshair';

  constructor(
    private fromLayer: boolean,
    p: PointerInfo,
  ) {
    this.pick(p);
  }

  private pick(p: PointerInfo): void {
    const s = getState();
    const rgba = this.fromLayer
      ? engine.sampleLayer(s.activeLayerId, p.x, p.y)
      : engine.sampleDisplayed(p.x, p.y, s.doc.paper.visible ? s.doc.paper.color : null);
    if (!rgba) return;
    if (rgba[3] === 0) {
      if (this.fromLayer) actions.setColor({ transparent: true });
      return;
    }
    const hex = `#${[rgba[0], rgba[1], rgba[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    actions.setDrawingColor(hex);
  }

  move(p: PointerInfo): void {
    this.pick(p);
  }

  up(): void {}
  cancel(): void {}
}

// ------------------------------------------------------------------ navigation

export class HandSession implements ToolSession {
  private last: PointerInfo;
  readonly cursor = 'grabbing';

  constructor(p: PointerInfo) {
    this.last = p;
  }

  move(p: PointerInfo): void {
    const { view } = getState();
    actions.setView({ panX: view.panX + (p.sx - this.last.sx), panY: view.panY + (p.sy - this.last.sy) });
    this.last = p;
  }

  up(): void {}
  cancel(): void {}
}

export class RotateSession implements ToolSession {
  private startAngle: number;
  private startRotation: number;
  readonly cursor = 'grabbing';

  constructor(
    p: PointerInfo,
    private center: { x: number; y: number },
  ) {
    this.startAngle = this.angle(p);
    this.startRotation = getState().view.rotation;
  }

  private angle(p: PointerInfo): number {
    return (Math.atan2(p.sy - this.center.y, p.sx - this.center.x) * 180) / Math.PI;
  }

  move(p: PointerInfo): void {
    let target = this.startRotation + (this.angle(p) - this.startAngle);
    if (p.shift) target = Math.round(target / 15) * 15;
    actions.setRotation(normalizeAngle(target));
  }

  up(): void {}
  cancel(): void {}
}

export class ZoomSession implements ToolSession {
  private start: PointerInfo;
  private startZoom: number;
  private dragged = false;
  readonly cursor: string;

  constructor(
    p: PointerInfo,
    private out: boolean,
    private center: { x: number; y: number },
  ) {
    this.start = p;
    this.startZoom = getState().view.zoom;
    this.cursor = out ? 'zoom-out' : 'zoom-in';
  }

  /** Zoom-in tool, or the zoom-out sub tool; ⌥ flips the direction. */
  static create(p: PointerInfo, sub: SubTool | null, center: { x: number; y: number }, forceOut = false): ZoomSession {
    const out = forceOut || (Boolean(sub?.zoomOut) !== p.alt);
    return new ZoomSession(p, out, center);
  }

  private anchor(p: PointerInfo) {
    return { x: p.sx - this.center.x, y: p.sy - this.center.y };
  }

  move(p: PointerInfo): void {
    const dx = p.sx - this.start.sx;
    if (!this.dragged && Math.abs(dx) < DRAG_THRESHOLD) return;
    this.dragged = true;
    // Dragging right zooms in, left zooms out (continuous).
    actions.zoomTo(this.startZoom * Math.pow(2, dx / 120), this.anchor(this.start));
  }

  up(p: PointerInfo): void {
    if (!this.dragged) actions.zoomStep(this.out ? -1 : 1, this.anchor(p));
  }

  cancel(): void {}
}

/** ⌘⌥-drag: changes the brush size; the circle shows the new size. */
export class BrushSizeSession implements ToolSession {
  private start: PointerInfo;
  private startSize: number;
  private size: number;
  readonly cursor = 'ew-resize';

  constructor(
    private sub: SubTool,
    p: PointerInfo,
  ) {
    this.start = p;
    this.startSize = sub.brush?.size ?? 10;
    this.size = this.startSize;
  }

  move(p: PointerInfo): void {
    const zoom = getState().view.zoom;
    this.size = Math.max(1, Math.min(2000, this.startSize + ((p.sx - this.start.sx) * 2) / zoom));
    actions.setBrushSize(this.size);
  }

  up(): void {}
  cancel(): void {
    actions.setBrushSize(this.startSize);
  }

  overlay(ctx: CanvasRenderingContext2D, view: OverlayView): void {
    const c = applyMatrix(view.matrix, this.start.x, this.start.y);
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#2f80ed';
    ctx.beginPath();
    ctx.arc(c.x, c.y, Math.max(1, (this.size / 2) * view.zoom), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    void this.sub;
  }
}

/** ⌘⇧-click: selects the top-most layer that has a visible pixel under the pointer. */
export function pickLayerAt(p: PointerInfo): void {
  const { doc } = getState();
  for (const layer of flatten(doc.layers)) {
    if ((layer.kind !== 'raster' && layer.kind !== 'vector') || !isEffectivelyVisible(doc.layers, layer.id)) continue;
    const px = engine.sampleLayer(layer.id, p.x, p.y);
    if (px && px[3] > 8) {
      actions.selectLayer(layer.id);
      return;
    }
  }
}

// ------------------------------------------------------------------ move layer

/** A vector or text layer taken along by Move layer: its objects are moved, not its pixels. */
interface MovingObjects {
  layer: actions.ObjectLayer;
  original: Content;
  which: Set<string>;
  /** Bounds of the moving objects before the move. */
  box: Rect | null;
  /** Where they were last drawn. */
  shown: Rect | null;
  /** ⌥ copies the objects instead of moving them. */
  copy: boolean;
}

const offset = (r: Rect | null, dx: number, dy: number): Rect | null => (r ? { ...r, x: r.x + dx, y: r.y + dy } : null);

/** Copies of objects with new ids (⌥ with Move layer). */
function duplicateContent(c: Content): Content {
  return {
    strokes: c.strokes.map((x) => ({ ...x, id: newStrokeId() })),
    texts: c.texts.map((x) => ({ ...x, id: newObjectId('t') })),
    balloons: c.balloons.map((x) => ({ ...x, id: newObjectId('b'), tails: x.tails.map((t) => ({ ...t, id: newObjectId('q') })) })),
    panels: c.panels.map((x) => ({ ...x, id: newPanelId() })),
  };
}

export class MoveSession implements ToolSession {
  private edits: { edit: DirectEdit; hole: HTMLCanvasElement; lifted: HTMLCanvasElement }[] = [];
  private objects: MovingObjects[] = [];
  private start: PointerInfo;
  private dx = 0;
  private dy = 0;
  private selection: Mask | null;
  readonly cursor = 'move';

  static create(p: PointerInfo): MoveSession | null {
    const s = getState();
    if (!actions.activeLayer(s)) return null;
    const ids = actions.movingSurfaces(s);
    if (blocked(ids.length === 0 ? 'The layer is locked' : null)) return null;
    return new MoveSession(ids, p);
  }

  private constructor(ids: Id[], p: PointerInfo) {
    this.start = p;
    const s = getState();
    this.selection = s.selection;
    const sel = engine.selectionCanvas();
    ids.forEach((id, i) => {
      const layer = findLayer(s.doc.layers, id);
      if (actions.isObjectLayer(layer)) {
        const which = actions.objectsToMove(layer, s.selection);
        const original = contentOf(layer);
        const box = contentBounds(original, which);
        this.objects.push({ layer, original, which, box, shown: box, copy: p.alt });
        return;
      }
      const surface = getSurface(id);
      if (!surface) return;
      const edit = new DirectEdit(id, surface, (r) => engine.invalidate(r), `move:${i}`);
      const lifted = createCanvas(surface.width, surface.height);
      const lctx = ctx2d(lifted);
      lctx.drawImage(edit.backup, 0, 0);
      const hole = createCanvas(surface.width, surface.height);
      const hctx = ctx2d(hole);
      if (sel) {
        lctx.globalCompositeOperation = 'destination-in';
        lctx.drawImage(sel, 0, 0);
        hctx.drawImage(edit.backup, 0, 0);
        if (!p.alt) {
          hctx.globalCompositeOperation = 'destination-out';
          hctx.drawImage(sel, 0, 0);
        }
      } else if (p.alt) {
        // Option keeps the original image (copies it).
        hctx.drawImage(edit.backup, 0, 0);
      }
      this.edits.push({ edit, hole, lifted });
    });
  }

  /** A layer's objects at the current offset. */
  private moved(v: MovingObjects): Content {
    const m: Affine = [1, 0, 0, 1, this.dx, this.dy];
    if (!v.copy) return transformContent(v.original, v.which, m);
    const copies = duplicateContent(transformContent(pickContent(v.original, v.which), null, m));
    return {
      strokes: [...v.original.strokes, ...copies.strokes],
      texts: [...v.original.texts, ...copies.texts],
      balloons: [...v.original.balloons, ...copies.balloons],
      panels: [...v.original.panels, ...copies.panels],
    };
  }

  private render(): void {
    for (const { edit, hole, lifted } of this.edits) {
      const ctx = edit.ctx;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, hole.width, hole.height);
      ctx.drawImage(hole, 0, 0);
      ctx.drawImage(lifted, this.dx, this.dy);
      ctx.restore();
      edit.changed({ x: 0, y: 0, w: hole.width, h: hole.height });
    }
    for (const v of this.objects) {
      const now = offset(v.box, this.dx, this.dy);
      actions.previewContent(v.layer, this.moved(v), union(v.shown, now));
      v.shown = now;
    }
  }

  move(p: PointerInfo): void {
    let dx = Math.round(p.x - this.start.x);
    let dy = Math.round(p.y - this.start.y);
    if (p.shift) {
      // Fix the direction to the dominant axis.
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    if (dx === this.dx && dy === this.dy) return;
    this.dx = dx;
    this.dy = dy;
    this.render();
  }

  up(p: PointerInfo): void {
    this.move(p);
    const patches: (PixelPatch | null)[] = this.edits.map(({ edit }) => edit.commit());
    const list = patches.filter((x): x is PixelPatch => x !== null);
    const contents = new Map<Id, Content>();
    if (this.dx || this.dy) for (const v of this.objects) if (v.which.size) contents.set(v.layer.id, this.moved(v));
    if (list.length === 0 && contents.size === 0) {
      engine.resync();
      return;
    }
    const moved = this.selection ? translateMask(this.selection, this.dx, this.dy) : null;
    actions.commitTransform('Move layer', list, contents, this.selection ? { before: this.selection, after: moved } : undefined);
  }

  cancel(): void {
    for (const { edit } of this.edits) edit.cancel();
    for (const v of this.objects) if (v.shown !== v.box || this.dx || this.dy) actions.previewContent(v.layer, v.original, union(v.shown, v.box));
    engine.resync();
  }
}

// ------------------------------------------------------------------ polyline selection

/**
 * Polyline input: each click adds a corner; double-click, Enter or clicking the first point closes
 * it. Used for the polyline selection and polyline frames (`onClose`).
 */
export class PolylineSelect {
  static active: PolylineSelect | null = null;
  private points: { x: number; y: number; sx: number; sy: number }[] = [];
  private lastClick = 0;
  private op: SelectionOp;
  hover: { x: number; y: number } | null = null;

  private constructor(
    p: PointerInfo,
    private onClose: ((points: { x: number; y: number }[]) => void) | null,
  ) {
    this.op = selectionOpFor(p);
  }

  static click(p: PointerInfo, onClose: ((points: { x: number; y: number }[]) => void) | null = null): void {
    let poly = PolylineSelect.active;
    if (!poly) poly = PolylineSelect.active = new PolylineSelect(p, onClose);
    poly.add(p);
  }

  private add(p: PointerInfo): void {
    const first = this.points[0];
    const prev = this.points[this.points.length - 1];
    const double = prev && p.time - this.lastClick < 350 && Math.hypot(p.sx - prev.sx, p.sy - prev.sy) < 6;
    const onFirst = first && this.points.length >= 3 && Math.hypot(p.sx - first.sx, p.sy - first.sy) < 7;
    this.lastClick = p.time;
    if (double || onFirst) {
      this.close();
      return;
    }
    this.points.push({ x: p.x, y: p.y, sx: p.sx, sy: p.sy });
  }

  /** Backspace / Delete removes the last corner. */
  static undoPoint(): void {
    const poly = PolylineSelect.active;
    if (!poly) return;
    poly.points.pop();
    if (poly.points.length === 0) PolylineSelect.active = null;
  }

  static cancel(): void {
    PolylineSelect.active = null;
  }

  static finish(): void {
    PolylineSelect.active?.close();
  }

  private close(): void {
    PolylineSelect.active = null;
    if (this.points.length < 3) return;
    if (this.onClose) {
      this.onClose(this.points.map(({ x, y }) => ({ x, y })));
      return;
    }
    const { doc } = getState();
    actions.applySelection(polygonMask(doc.width, doc.height, this.points), this.op, 'Selection: Polyline');
  }

  static overlay(ctx: CanvasRenderingContext2D, view: OverlayView): void {
    const poly = PolylineSelect.active;
    if (!poly || poly.points.length === 0) return;
    ctx.save();
    strokeOverlayColor(ctx);
    ctx.beginPath();
    poly.points.forEach((q, i) => {
      const s = applyMatrix(view.matrix, q.x, q.y);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    if (poly.hover) {
      const h = applyMatrix(view.matrix, poly.hover.x, poly.hover.y);
      ctx.lineTo(h.x, h.y);
    }
    ctx.stroke();
    ctx.strokeStyle = '#fff';
    ctx.lineDashOffset = 4;
    ctx.stroke();
    ctx.restore();
  }
}

// ------------------------------------------------------------------ selection pen / erase selection

/** Paints the selection with a brush; shown as a blue overlay while drawing. */
export class SelectionPenSession implements ToolSession {
  private canvas: HTMLCanvasElement;
  private stroke: BrushStroke;
  readonly cursor = 'none';

  constructor(
    private sub: SubTool,
    p: PointerInfo,
  ) {
    const { doc, selection } = getState();
    this.canvas = selection ? maskToCanvas(selection, [58, 123, 255]) : createCanvas(doc.width, doc.height);
    const erase = sub.selectShape === 'erase';
    this.stroke = new BrushStroke({ ...sub.brush!, mode: erase ? 'erase' : 'paint' }, '#3a7bff', false, {
      layerId: '__selection',
      layer: this.canvas,
      selection: null,
      lockAlpha: false,
      onChange: () => engine.requestRender(),
    });
    this.stroke.add(toStroke(p));
  }

  move(p: PointerInfo, coalesced: PointerInfo[]): void {
    for (const c of coalesced.length ? coalesced : [p]) this.stroke.add(toStroke(c));
  }

  up(): void {
    this.stroke.end();
    const { width, height } = this.canvas;
    const data = ctx2d(this.canvas, true).getImageData(0, 0, width, height).data;
    const mask = { width, height, data: new Uint8Array(width * height) };
    for (let i = 0, q = 3; i < mask.data.length; i++, q += 4) mask.data[i] = data[q] >= 128 ? 255 : 0;
    actions.setSelection(mask, `Selection: ${this.sub.name}`);
  }

  cancel(): void {}

  overlay(ctx: CanvasRenderingContext2D, view: OverlayView): void {
    ctx.save();
    ctx.transform(...view.matrix);
    ctx.globalAlpha = 0.4;
    ctx.imageSmoothingEnabled = view.zoom < 2;
    ctx.drawImage(this.canvas, 0, 0);
    ctx.restore();
  }
}
