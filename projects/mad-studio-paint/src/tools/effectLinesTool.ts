/**
 * Comic tool > Flash, Focus lines and Speed lines, like the reference's: focus lines and flashes
 * are drawn by dragging from their centre (how far sets where the lines start; ⇧: a circle), speed
 * lines by dragging a line across the area they fill (they run across it). As the sub tool's
 * Destination layer says, the lines go on a new focus / speed lines layer (editable with the Object
 * tool), are added to the selected lines layer with the settings of the lines already there, or are
 * drawn straight onto the editing raster layer. With Use radial / parallel line ruler, a special
 * ruler sets the centre or the lines' direction.
 */
import { createLinesLayer, findLayer, nextRev } from '../model/layers';
import { createCanvas, ctx2d } from '../engine/canvas';
import { captureLayerChange } from '../engine/edit';
import { engine } from '../engine/engine';
import { getSurface } from '../engine/surfaces';
import { DEFAULT_FOCUS_LINES, drawEffectLines, newLinesId, newSeed, type EffectLines } from '../paint/effectLines';
import type { Pt } from '../paint/rulers';
import { defaultTone } from '../paint/tone';
import type { EffectLinesSettings, LinesColor, SubTool } from '../paint/tools';
import { apply as applyMatrix } from '../paint/viewMath';
import * as actions from '../store/actions';
import { getState, setState } from '../store/store';
import type { OverlayView, PointerInfo, ToolSession } from './types';

/** Lines shorter than this (screen px) are a click, not a drag. */
const MIN_DRAG_PX = 4;
/** Toning: the lines are grey, so the tone shows them as dots. */
const TONING_GREY = '#808080';

export type Placement = Pick<EffectLines, 'cx' | 'cy' | 'rx' | 'ry' | 'rotation'> & Partial<Pick<EffectLines, 'fx' | 'fy' | 'angle'>>;

/** A special ruler that applies now (with special snapping on): radial ones give a centre, parallel ones an angle. */
function specialRuler(): { center?: Pt; angle?: number } {
  const s = getState();
  if (!s.snapSpecial) return {};
  for (const { ruler } of actions.activeRulers(s)) {
    if (ruler.kind === 'radial' || ruler.kind === 'radialCurve') return { center: ruler.center };
    if (ruler.kind === 'parallel' || ruler.kind === 'multiCurve') return { angle: ruler.angle };
  }
  return {};
}

const colorOf = (c: LinesColor, user: string): string => {
  const { colors } = getState();
  return c === 'main' ? colors.main : c === 'sub' ? colors.sub : user;
};

/** The new lines of a sub tool at a place (on a lines layer: with the settings of the lines already there). */
export function newLines(o: EffectLinesSettings, at: Placement, like: EffectLines | null): EffectLines {
  const base: EffectLines = like
    ? like
    : {
        ...DEFAULT_FOCUS_LINES,
        ...o.style,
        color: o.toning && o.destination !== 'editing' ? TONING_GREY : colorOf(o.lineColor, o.userLineColor),
        fillColor: colorOf(o.fillColor, o.userFillColor),
      };
  return { ...base, id: newLinesId(), seed: newSeed(), fx: 0, fy: 0, ...at };
}

/** Puts the lines where the sub tool's Destination layer says, as one undo step. */
function place(sub: SubTool, at: Placement): void {
  const o = sub.effectLines!;
  const s = getState();
  const active = actions.activeLayer(s);
  const label = sub.name;
  // A selected lines layer of the same kind takes them (Draw on … lines layer, or Draw on editing layer).
  if (active?.kind === 'lines' && o.destination !== 'new' && (active.items[0]?.kind ?? o.style.kind) === o.style.kind && !s.maskEditing) {
    if (actions.objectBlocker(s)) {
      setState({ hint: actions.objectBlocker(s) ?? '' });
      return;
    }
    const item = newLines(o, at, active.items[active.items.length - 1] ?? null);
    actions.changeDoc(label, (doc) => {
      const l = findLayer(doc.layers, active.id);
      if (l?.kind !== 'lines') return;
      l.items = [...l.items, item];
      l.rev = nextRev();
    });
    actions.selectObjects([item.id]);
    return;
  }
  const item = newLines(o, at, null);
  if (o.destination === 'editing') {
    drawOnEditingLayer(label, item);
    return;
  }
  const layer = createLinesLayer(label, [item], o.toning ? { effects: { tone: defaultTone(s.doc.dpi) } } : {});
  actions.changeDoc(label, (doc, st) => {
    actions.insertNew(doc, layer, st.activeLayerId);
    return layer.id;
  });
}

/** Draw on editing layer: the lines become pixels of the editing raster layer (inside the selection). */
function drawOnEditingLayer(label: string, item: EffectLines): void {
  const s = getState();
  const reason = actions.rasterOnlyBlocker(s);
  if (reason) {
    setState({ hint: reason });
    return;
  }
  const target = actions.editTarget(s)!;
  const surface = getSurface(target.surfaceId);
  if (!surface) return;
  const lines = createCanvas(surface.width, surface.height);
  const lctx = ctx2d(lines);
  drawEffectLines(lctx, item, { x: 0, y: 0, w: surface.width, h: surface.height });
  const selection = engine.selectionCanvas();
  if (selection) {
    lctx.globalCompositeOperation = 'destination-in';
    lctx.drawImage(selection, 0, 0);
  }
  const patch = captureLayerChange(target.surfaceId, surface, null, (ctx) => {
    ctx.save();
    ctx.globalCompositeOperation = target.lockAlpha ? 'source-atop' : 'source-over';
    ctx.drawImage(lines, 0, 0);
    ctx.restore();
  });
  engine.invalidate();
  actions.commitPixels(label, [patch]);
}

const crosshair = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
  ctx.moveTo(x - 6, y);
  ctx.lineTo(x + 6, y);
  ctx.moveTo(x, y - 6);
  ctx.lineTo(x, y + 6);
};

/** Focus lines and flashes: drag from the centre; the drag sets the reference ellipse (⇧: a circle). */
class FocusLinesSession implements ToolSession {
  private center: Pt;
  private rx = 0;
  private ry = 0;
  private start: PointerInfo;
  readonly cursor = 'crosshair';

  constructor(
    private sub: SubTool,
    p: PointerInfo,
  ) {
    this.start = p;
    const ruler = sub.effectLines!.useRuler ? specialRuler().center : undefined;
    this.center = ruler ? { ...ruler } : { x: p.x, y: p.y };
  }

  move(p: PointerInfo): void {
    // With a radial ruler the drag sets the size about its centre.
    let dx = Math.abs(p.x - this.center.x);
    let dy = Math.abs(p.y - this.center.y);
    if (this.center.x !== this.start.x || this.center.y !== this.start.y) {
      dx = dy = Math.hypot(p.x - this.center.x, p.y - this.center.y);
    } else if (p.shift) dx = dy = Math.max(dx, dy);
    this.rx = dx;
    this.ry = dy;
  }

  up(p: PointerInfo): void {
    this.move(p);
    if (Math.hypot(p.sx - this.start.sx, p.sy - this.start.sy) < MIN_DRAG_PX && this.center.x === this.start.x && this.center.y === this.start.y) {
      setState({ hint: 'Drag from the centre to set the size of the lines' });
      return;
    }
    place(this.sub, { cx: this.center.x, cy: this.center.y, rx: this.rx, ry: this.ry, rotation: 0 });
  }

  cancel(): void {}

  overlay(ctx: CanvasRenderingContext2D, view: OverlayView): void {
    const c = applyMatrix(view.matrix, this.center.x, this.center.y);
    // The view may be turned: draw the ellipse in document space.
    ctx.save();
    ctx.lineWidth = 1;
    for (const [color, w] of [
      ['rgba(255,255,255,0.85)', 3],
      ['#2f80ed', 1],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.beginPath();
      for (let i = 0; i <= 64; i++) {
        const t = (i / 64) * Math.PI * 2;
        const q = applyMatrix(view.matrix, this.center.x + this.rx * Math.cos(t), this.center.y + this.ry * Math.sin(t));
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      }
      crosshair(ctx, c.x, c.y);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** Speed lines: drag a line across the area; the lines run across it (or along a parallel line ruler). */
class SpeedLinesSession implements ToolSession {
  private a: Pt;
  private b: Pt;
  private start: PointerInfo;
  readonly cursor = 'crosshair';

  constructor(
    private sub: SubTool,
    p: PointerInfo,
  ) {
    this.start = p;
    this.a = { x: p.x, y: p.y };
    this.b = { ...this.a };
  }

  move(p: PointerInfo): void {
    let b = { x: p.x, y: p.y };
    if (p.shift) {
      // ⇧: in 45° steps.
      const step = Math.PI / 4;
      const ang = Math.round(Math.atan2(b.y - this.a.y, b.x - this.a.x) / step) * step;
      const len = Math.hypot(b.x - this.a.x, b.y - this.a.y);
      b = { x: this.a.x + Math.cos(ang) * len, y: this.a.y + Math.sin(ang) * len };
    }
    this.b = b;
  }

  up(p: PointerInfo): void {
    this.move(p);
    if (Math.hypot(p.sx - this.start.sx, p.sy - this.start.sy) < MIN_DRAG_PX) {
      setState({ hint: 'Drag a line across the area for the speed lines' });
      return;
    }
    const o = this.sub.effectLines!;
    const rotation = Math.atan2(this.b.y - this.a.y, this.b.x - this.a.x);
    const at: Placement = { cx: (this.a.x + this.b.x) / 2, cy: (this.a.y + this.b.y) / 2, rx: Math.hypot(this.b.x - this.a.x, this.b.y - this.a.y) / 2, ry: 0, rotation };
    // Along a parallel line ruler: the lines take its direction.
    const ruler = o.useRuler ? specialRuler().angle : undefined;
    if (ruler !== undefined) {
      const normal = rotation + Math.PI / 2;
      let turn = ((ruler - normal) * 180) / Math.PI;
      // A line has no front: the smallest turn either way.
      turn = ((((turn + 90) % 180) + 180) % 180) - 90;
      at.angle = turn;
    }
    place(this.sub, at);
  }

  cancel(): void {}

  overlay(ctx: CanvasRenderingContext2D, view: OverlayView): void {
    const a = applyMatrix(view.matrix, this.a.x, this.a.y);
    const b = applyMatrix(view.matrix, this.b.x, this.b.y);
    ctx.save();
    for (const [color, w] of [
      ['rgba(255,255,255,0.85)', 3],
      ['#2f80ed', 1],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#2f80ed';
    for (const q of [a, b]) {
      ctx.beginPath();
      ctx.arc(q.x, q.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** A press with a flash, focus lines or speed lines sub tool. */
export function effectLinesSession(sub: SubTool, p: PointerInfo): ToolSession | null {
  if (!sub.effectLines) return null;
  return sub.effectLines.style.kind === 'speed' ? new SpeedLinesSession(sub, p) : new FocusLinesSession(sub, p);
}
