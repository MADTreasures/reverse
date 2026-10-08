/**
 * Correct line tools on vector layers: Control point (move, add, delete, corner, width, opacity,
 * split), Pinch vector line, Simplify vector line, Connect vector line, Adjust line width, Redraw
 * vector line and Redraw vector line width; also the Object tool's control points of selected
 * lines. Changes show while dragging and are one undo step.
 */
import type { VectorLayer } from '../model/types';
import { evalPressureCurve } from '../paint/curve';
import { smoothPolyline } from '../paint/curves';
import { union, type Rect } from '../paint/rect';
import type { Pt } from '../paint/rulers';
import type { CorrectSettings, SubTool } from '../paint/tools';
import { linePath, linesBounds, strokeBounds, type VectorStroke } from '../paint/vector';
import {
  adjustedWidth,
  applyPinch,
  deleteControlPoint,
  editable,
  findJoin,
  hitControlPoint,
  hitLinePath,
  insertControlPoint,
  joinInList,
  moveControlPoint,
  pathLengths,
  redrawLine,
  rewidth,
  setPointProps,
  simplifyLine,
  splitLine,
  startPinch,
  toggleCorner,
  type Pinch,
} from '../paint/vectorEdit';
import { apply as applyMatrix } from '../paint/viewMath';
import { engine } from '../engine/engine';
import * as actions from '../store/actions';
import { getState, setState } from '../store/store';
import type { OverlayView, PointerInfo, ToolSession } from './types';

/** How near (screen px) the pointer must be to a control point or line. */
const HIT_PX = 8;

/** The active vector layer, if its lines can be corrected (else a hint says why not). */
function correctTarget(): VectorLayer | null {
  const s = getState();
  const l = actions.activeLayer(s);
  if (l?.kind !== 'vector') {
    setState({ hint: 'Correct line works on vector layers' });
    return null;
  }
  const why = actions.objectBlocker(s);
  if (why) {
    setState({ hint: why });
    return null;
  }
  return l;
}

/** True when a line's bounds come within `r` of p. */
function near(line: VectorStroke, p: Pt, r: number): boolean {
  const b = strokeBounds(line);
  return Boolean(b && p.x + r >= b.x && p.x - r <= b.x + b.w && p.y + r >= b.y && p.y - r <= b.y + b.h);
}

/** A change of a vector layer's lines, shown while dragging and recorded as one undo step. */
abstract class LineEdit implements ToolSession {
  cursor = 'crosshair';
  protected lines: VectorStroke[];
  protected readonly original: VectorStroke[];
  private dirty: Rect | null = null;

  constructor(
    protected readonly layer: VectorLayer,
    private readonly label: string,
  ) {
    this.original = layer.strokes;
    this.lines = layer.strokes;
  }

  /** Shows new lines: the area of what changed is drawn again. */
  protected show(next: VectorStroke[]): void {
    const kept = new Set(next);
    const had = new Set(this.lines);
    const changed = [...this.lines.filter((x) => !kept.has(x)), ...next.filter((x) => !had.has(x))];
    this.lines = next;
    const area = linesBounds(changed);
    if (!area) return;
    this.dirty = union(this.dirty, area);
    engine.renderVectorLines(this.layer.id, next, area);
  }

  protected commit(): void {
    if (this.lines === this.original) return;
    engine.expectVectorLines(this.layer.id, this.lines);
    actions.setVectorStrokes(this.layer.id, this.lines, this.label);
  }

  abstract move(p: PointerInfo, coalesced: PointerInfo[]): void;

  up(p: PointerInfo): void {
    this.move(p, []);
    this.commit();
  }

  cancel(): void {
    if (this.dirty) engine.renderVectorLines(this.layer.id, this.original, this.dirty);
  }
}

// ------------------------------------------------------------------ control points

/** Draws the control points of lines (corners as diamonds), and the hovered one bigger. */
function drawControlPoints(ctx: CanvasRenderingContext2D, view: OverlayView, lines: VectorStroke[], hot?: { line: VectorStroke; point: number } | null): void {
  ctx.save();
  ctx.lineWidth = 1;
  for (const line of lines) {
    const e = editable(line);
    const corners = new Set(e.corners ?? []);
    ctx.strokeStyle = 'rgba(47,128,237,0.55)';
    ctx.beginPath();
    linePath(e).forEach((q, i) => {
      const s = applyMatrix(view.matrix, q.x, q.y);
      if (i) ctx.lineTo(s.x, s.y);
      else ctx.moveTo(s.x, s.y);
    });
    ctx.stroke();
    e.points.forEach((q, i) => {
      const s = applyMatrix(view.matrix, q.x, q.y);
      const big = hot && hot.line === line && hot.point === i;
      const r = big ? 4.5 : 3;
      ctx.fillStyle = big ? '#2f80ed' : '#ffffff';
      ctx.strokeStyle = '#2f80ed';
      ctx.beginPath();
      if (corners.has(i) || e.curve === 'polyline') {
        ctx.moveTo(s.x, s.y - r - 1);
        ctx.lineTo(s.x + r + 1, s.y);
        ctx.lineTo(s.x, s.y + r + 1);
        ctx.lineTo(s.x - r - 1, s.y);
        ctx.closePath();
      } else ctx.rect(s.x - r, s.y - r, r * 2, r * 2);
      ctx.fill();
      ctx.stroke();
    });
  }
  ctx.restore();
}

/** Control point tool: what a click or drag on a control point (or the line) does, per mode. */
class ControlPointSession extends LineEdit {
  private line: VectorStroke;
  private point: number;

  constructor(
    layer: VectorLayer,
    private mode: CorrectSettings['mode'],
    private index: number,
    point: number,
    private start: PointerInfo,
  ) {
    super(layer, LABELS[mode]);
    this.line = editable(this.lines[index]);
    this.point = point;
    const replace = (next: VectorStroke[]) => this.show(this.lines.flatMap((x, i) => (i === index ? next : [x])));
    switch (mode) {
      case 'delete': {
        const out = deleteControlPoint(this.line, point);
        replace(out ? [out] : []);
        break;
      }
      case 'corner':
        replace([toggleCorner(this.line, point)]);
        break;
      case 'split': {
        const parts = splitLine(this.line, point);
        if (parts) replace(parts);
        break;
      }
    }
  }

  /** Add mode on the line: a new control point there, then dragged like the others. */
  static add(layer: VectorLayer, index: number, at: number, p: PointerInfo): ControlPointSession {
    const ins = insertControlPoint(layer.strokes[index], at);
    const s = new ControlPointSession(layer, 'add', index, ins.index, p);
    s.line = ins.line;
    s.show(s.lines.map((x, i) => (i === index ? ins.line : x)));
    return s;
  }

  move(p: PointerInfo): void {
    const dx = p.sx - this.start.sx;
    let next: VectorStroke | null = null;
    switch (this.mode) {
      case 'move':
      case 'add':
        if (Math.hypot(p.sx - this.start.sx, p.sy - this.start.sy) < 2) return;
        next = moveControlPoint(this.line, this.point, p);
        break;
      case 'width':
        // Right: thicker, left: thinner.
        next = setPointProps(this.line, this.point, { s: this.line.points[this.point].s * Math.pow(2, dx / 60) });
        break;
      case 'opacity':
        next = setPointProps(this.line, this.point, { d: this.line.points[this.point].d + dx / 150 });
        break;
      default:
        return;
    }
    const index = this.index;
    this.show(this.lines.map((x, i) => (i === index ? next! : x)));
  }

  overlay(ctx: CanvasRenderingContext2D, view: OverlayView): void {
    const current = this.lines[this.index];
    if (current && this.mode !== 'delete' && this.mode !== 'split') drawControlPoints(ctx, view, [current], { line: current, point: this.point });
  }
}

const LABELS: Record<CorrectSettings['mode'], string> = {
  move: 'Move control point',
  add: 'Add control point',
  delete: 'Delete control point',
  corner: 'Switch corner',
  width: 'Adjust line width',
  opacity: 'Adjust opacity',
  split: 'Split line',
};

function controlPointSession(c: CorrectSettings, layer: VectorLayer, p: PointerInfo, view: OverlayView): ToolSession | null {
  const tol = HIT_PX / Math.max(0.01, view.zoom);
  const hit = hitControlPoint(layer.strokes, p, tol);
  if (hit) return new ControlPointSession(layer, c.mode, hit.line, hit.point, p);
  if (c.mode === 'add') {
    const on = hitLinePath(layer.strokes, p, tol);
    if (on) return ControlPointSession.add(layer, on.line, on.at, p);
  }
  return null;
}

// ------------------------------------------------------------------ pinch

class PinchSession extends LineEdit {
  private pinch: Pinch;

  constructor(
    layer: VectorLayer,
    private c: CorrectSettings,
    private index: number,
    at: number,
    private start: PointerInfo,
  ) {
    super(layer, 'Pinch vector line');
    const line = editable(this.lines[index]);
    const length = pathLengths(linePath(line)).at(-1) ?? 0;
    const strength = c.pressure ? 0.25 + 0.75 * Math.max(0, Math.min(1, start.pressure)) : 1;
    this.pinch = startPinch(line, at, (length * c.pinchLevel * strength) / 100, c.fixEnds, c.addPoint);
  }

  move(p: PointerInfo): void {
    const next = applyPinch(this.pinch, p.x - this.start.x, p.y - this.start.y);
    this.show(this.lines.map((x, i) => (i === this.index ? next : x)));
  }

  up(p: PointerInfo): void {
    this.move(p);
    if (this.c.connect) {
      // The dragged end joins another line's end near it.
      const gap = this.c.connectGap;
      const j = findJoin(this.lines, p, gap, gap, false);
      if (j && (j.a === this.index || j.b === this.index)) this.show(joinInList(this.lines, j));
    }
    this.commit();
  }

  overlay(ctx: CanvasRenderingContext2D, view: OverlayView): void {
    const line = this.lines[this.index];
    if (line) drawControlPoints(ctx, view, [line]);
  }
}

// ------------------------------------------------------------------ brush-like tools

/** A tool used like a brush over the lines: dabs along the drag, half a radius apart. */
abstract class BrushEdit extends LineEdit {
  private last: PointerInfo;
  protected readonly r: number;

  constructor(
    layer: VectorLayer,
    label: string,
    protected c: CorrectSettings,
    p: PointerInfo,
  ) {
    super(layer, label);
    this.cursor = 'none';
    this.r = Math.max(0.5, c.size / 2);
    this.last = p;
  }

  /** Called once at the start (after construction) and then for every dab. */
  protected abstract dab(c: Pt, p: PointerInfo): void;

  begin(p: PointerInfo): this {
    this.dab(p, p);
    return this;
  }

  move(p: PointerInfo, coalesced: PointerInfo[]): void {
    for (const q of coalesced.length ? coalesced : [p]) {
      const n = Math.max(1, Math.ceil(Math.hypot(q.x - this.last.x, q.y - this.last.y) / Math.max(0.5, this.r / 2)));
      for (let i = 1; i <= n; i++) this.dab({ x: this.last.x + ((q.x - this.last.x) * i) / n, y: this.last.y + ((q.y - this.last.y) * i) / n }, q);
      this.last = q;
    }
  }

  up(p: PointerInfo): void {
    this.move(p, []);
    this.finish();
    this.commit();
  }

  /** After the last dab. */
  protected finish(): void {}
}

/** Per original line: which of its control points (or path points) the brush touched. */
type Touched = Map<number, Set<number>>;

function touch(map: Touched, line: number, i: number): boolean {
  let set = map.get(line);
  if (!set) map.set(line, (set = new Set()));
  if (set.has(i)) return false;
  set.add(i);
  return true;
}

class SimplifySession extends BrushEdit {
  private touched: Touched = new Map();
  private dabs: Pt[] = [];

  protected dab(c: Pt): void {
    this.dabs.push(c);
    let changed = false;
    this.original.forEach((line, i) => {
      if (!near(line, c, this.r)) return;
      const e = editable(line);
      if (this.c.wholeLine) {
        if (linePath(e).some((q) => Math.hypot(q.x - c.x, q.y - c.y) <= this.r)) changed = touch(this.touched, i, -1) || changed;
        return;
      }
      e.points.forEach((q, k) => {
        if (Math.hypot(q.x - c.x, q.y - c.y) <= this.r) changed = touch(this.touched, i, k) || changed;
      });
    });
    if (!changed) return;
    // Looser with more "Simplify".
    const tol = 0.5 + (this.c.simplify / 100) * 10;
    this.show(
      this.original.flatMap((line, i) => {
        const set = this.touched.get(i);
        if (!set) return [line];
        const out = simplifyLine(line, tol, (k) => set.has(-1) || set.has(k), this.c.smoothCorners, this.c.convert);
        // Short touched lines go ("Delete short lines").
        if (this.c.deleteShort > 0 && (pathLengths(linePath(out)).at(-1) ?? 0) < this.c.deleteShort) return [];
        return [out];
      }),
    );
  }

  protected finish(): void {
    if (!this.c.connect) return;
    let lines = this.lines;
    for (const c of this.dabs) {
      for (let j = findJoin(lines, c, this.r, this.c.connectGap, this.c.anyProps); j; j = findJoin(lines, c, this.r, this.c.connectGap, this.c.anyProps)) lines = joinInList(lines, j);
    }
    this.show(lines);
  }
}

class ConnectSession extends BrushEdit {
  protected dab(c: Pt): void {
    let lines = this.lines;
    for (let j = findJoin(lines, c, this.r, this.c.connectGap, this.c.anyProps); j; j = findJoin(lines, c, this.r, this.c.connectGap, this.c.anyProps)) lines = joinInList(lines, j);
    if (lines !== this.lines) this.show(lines);
  }
}

/**
 * Adjust line width and Redraw vector line width: new widths for the touched parts of the path,
 * fading out towards the edge of the brush.
 */
class WidthSession extends BrushEdit {
  /** Per original line and path point: how much of the change applies (0: untouched) … */
  private weights = new Map<number, Float64Array>();
  /** … and, redrawing the width, the width the pen pressure gave there. */
  private targets = new Map<number, Float64Array>();

  protected dab(c: Pt, p: PointerInfo): void {
    let changed = false;
    this.original.forEach((line, i) => {
      if (!near(line, c, this.r)) return;
      const path = linePath(editable(line));
      for (let k = 0; k < path.length; k++) {
        const d = Math.hypot(path[k].x - c.x, path[k].y - c.y);
        if (d > this.r) continue;
        // Full strength in the inner part of the brush, fading out over its outer third.
        const w = Math.min(1, (this.r - d) / (this.r / 3));
        let weights = this.weights.get(i);
        let targets = this.targets.get(i);
        if (!weights || !targets) {
          this.weights.set(i, (weights = new Float64Array(path.length)));
          this.targets.set(i, (targets = new Float64Array(path.length)));
        }
        if (w <= weights[k]) continue;
        weights[k] = w;
        targets[k] = this.pressureWidth(line, p);
        changed = true;
      }
    });
    if (!changed) return;
    this.show(this.original.map((line, i) => this.result(line, i)));
  }

  private result(line: VectorStroke, i: number): VectorStroke {
    const weights = this.weights.get(i);
    const targets = this.targets.get(i);
    if (!weights || !targets) return line;
    const c = this.c;
    const size = line.brush.size;
    if (c.kind === 'width' && c.wholeLine) {
      // The whole line: every control point.
      const e = editable(line);
      return { ...e, points: e.points.map((q) => ({ ...q, s: Math.max(0, Math.min(10, adjustedWidth(q.s, size, c.widthMode, c.widthAmount, c.atLeast1))) })) };
    }
    return rewidth(line, (k, s) => {
      if (!weights[k]) return undefined;
      const target = c.kind === 'width' ? adjustedWidth(s, size, c.widthMode, c.widthAmount, c.atLeast1) : targets[k];
      return s + (target - s) * weights[k];
    });
  }

  /** Redraw vector line width: the pen pressure, through the line's own pressure settings. */
  private pressureWidth(line: VectorStroke, p: PointerInfo): number {
    const b = line.brush;
    return b.minSize + (1 - b.minSize) * evalPressureCurve(b.sizeCurve, Math.max(0, Math.min(1, p.pressure)));
  }
}

// ------------------------------------------------------------------ redraw

class RedrawSession extends LineEdit {
  private points: Pt[];

  constructor(
    layer: VectorLayer,
    private c: CorrectSettings,
    p: PointerInfo,
    private zoom: number,
  ) {
    super(layer, 'Redraw vector line');
    this.points = [{ x: p.x, y: p.y }];
  }

  move(p: PointerInfo, coalesced: PointerInfo[]): void {
    for (const q of coalesced.length ? coalesced : [p]) this.points.push({ x: q.x, y: q.y });
  }

  up(p: PointerInfo): void {
    this.move(p, []);
    const stroke = smoothPolyline(this.points, Math.round(this.c.stabilization / 3));
    const tol = (HIT_PX * 1.5) / Math.max(0.01, this.zoom);
    const fitTol = 0.3 + (this.c.simplify / 100) * 4;
    for (let i = this.lines.length - 1; i >= 0; i--) {
      if (!near(this.lines[i], stroke[0], tol) && !near(this.lines[i], stroke[stroke.length - 1], tol)) continue;
      const out = redrawLine(this.lines[i], stroke, tol, this.c.fixEnds, fitTol);
      if (!out) continue;
      let lines = this.lines.map((x, k) => (k === i ? out : x));
      if (this.c.connect) {
        for (const end of [stroke[0], stroke[stroke.length - 1]]) {
          const j = findJoin(lines, end, this.c.connectGap, this.c.connectGap, false);
          if (j) lines = joinInList(lines, j);
        }
      }
      this.show(lines);
      this.commit();
      return;
    }
    setState({ hint: 'Start and end the stroke on a line of the vector layer' });
  }

  overlay(ctx: CanvasRenderingContext2D, view: OverlayView): void {
    ctx.save();
    ctx.strokeStyle = '#2f80ed';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    this.points.forEach((q, i) => {
      const s = applyMatrix(view.matrix, q.x, q.y);
      if (i) ctx.lineTo(s.x, s.y);
      else ctx.moveTo(s.x, s.y);
    });
    ctx.stroke();
    ctx.restore();
  }
}

// ------------------------------------------------------------------ entry points

/** Correct line tool: the session for the sub tool, or null (with a hint when nothing applies). */
export function correctSession(sub: SubTool, p: PointerInfo, view: OverlayView): ToolSession | null {
  const c = sub.correct;
  const layer = c ? correctTarget() : null;
  if (!c || !layer) return null;
  switch (c.kind) {
    case 'controlPoint':
      return controlPointSession(c, layer, p, view);
    case 'pinch': {
      const hit = hitLinePath(layer.strokes, p, c.range / Math.max(0.01, view.zoom));
      return hit ? new PinchSession(layer, c, hit.line, hit.at, p) : null;
    }
    case 'simplify':
      return new SimplifySession(layer, 'Simplify vector line', c, p).begin(p);
    case 'connect':
      return new ConnectSession(layer, 'Connect vector line', c, p).begin(p);
    case 'width':
      return new WidthSession(layer, 'Adjust line width', c, p).begin(p);
    case 'redrawWidth':
      return new WidthSession(layer, 'Redraw vector line width', c, p).begin(p);
    case 'redraw':
      return new RedrawSession(layer, c, p, view.zoom);
  }
}

/** Without a session: the control points of the lines near the pointer, or the tool's brush circle. */
export function drawCorrectHover(ctx: CanvasRenderingContext2D, view: OverlayView, hover: PointerInfo | null, sub: SubTool): void {
  const c = sub.correct;
  const l = actions.activeLayer();
  if (!c || !hover || l?.kind !== 'vector') return;
  if (c.kind === 'controlPoint' || c.kind === 'pinch') {
    const reach = (c.kind === 'pinch' ? c.range : HIT_PX * 4) / Math.max(0.01, view.zoom);
    const lines = l.strokes.filter((x) => near(x, hover, reach));
    const tol = HIT_PX / Math.max(0.01, view.zoom);
    const hit = c.kind === 'controlPoint' ? hitControlPoint(lines, hover, tol) : null;
    drawControlPoints(ctx, view, lines, hit && { line: lines[hit.line], point: hit.point });
    return;
  }
  if (c.kind === 'redraw') return;
  const s = applyMatrix(view.matrix, hover.x, hover.y);
  const r = (c.size / 2) * view.zoom;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.beginPath();
  ctx.arc(s.x, s.y, Math.max(2, r), 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath();
  ctx.arc(s.x, s.y, Math.max(2, r) + 1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Object tool: the control points of the selected lines (drawn, and dragged to move them). */
export function drawSelectedControlPoints(ctx: CanvasRenderingContext2D, view: OverlayView): void {
  const sel = actions.selectedVectorLines();
  if (sel) drawControlPoints(ctx, view, sel.lines);
}

export function selectedPointSession(p: PointerInfo, view: OverlayView): ToolSession | null {
  const sel = actions.selectedVectorLines();
  if (!sel || actions.objectBlocker()) return null;
  const tol = (HIT_PX * 0.75) / Math.max(0.01, view.zoom);
  const hit = hitControlPoint(sel.lines, p, tol);
  if (!hit) return null;
  const index = sel.layer.strokes.indexOf(sel.lines[hit.line]);
  return index >= 0 ? new ControlPointSession(sel.layer, 'move', index, hit.point, p) : null;
}
