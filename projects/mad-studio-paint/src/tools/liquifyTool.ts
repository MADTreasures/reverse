/**
 * The Liquify tool on the canvas, like the reference's: dragging warps the pixels of the current
 * raster layer (or its mask, or a selection layer) dab by dab along the stroke; pressing and
 * holding keeps expanding, pinching or twirling in place. ⌥ (also pressed mid-stroke) does the
 * opposite, ⇧-drag works along a straight line (on release), Stabilization smooths the stroke.
 * Each dab adds to the stroke's warp field and redraws its area from the layer as it was before
 * the stroke. One undo step per stroke. The warp itself is in paint/liquify.ts.
 */
import { ctx2d, type Ctx } from '../engine/canvas';
import { DirectEdit } from '../engine/edit';
import type { StrokeTarget } from '../engine/brushEngine';
import type { Mask } from '../paint/mask';
import { Stabilizer, stabilizerWindow } from '../paint/stroke';
import { apply as applyMatrix } from '../paint/viewMath';
import { dabRect, dabStrength, invertMode, STATIONARY_MODES, warpDab, WarpField, warpPixels, type LiquifyDab } from '../paint/liquify';
import type { LiquifySettings, SubTool } from '../paint/tools';
import * as actions from '../store/actions';
import { getState, setState } from '../store/store';
import { strokeTarget } from './sessions';
import type { Modifiers, OverlayView, PointerInfo, ToolSession } from './types';

/** Press and hold: Expand, Pinch and Twirl repeat this often (ms). */
export const LIQUIFY_HOLD_MS = 50;
/** Dabs along the stroke, this part of the brush radius apart. */
const SPACING = 0.15;

export class LiquifySession implements ToolSession {
  private edit: DirectEdit;
  /** The layer as it was before the stroke. */
  private before: Ctx;
  private field: WarpField;
  private lockAlpha: boolean;
  private selection: Mask | null;
  /** Where the last dab was, and where the pen is. */
  private last: { x: number; y: number };
  private pen: { x: number; y: number };
  private alt: boolean;
  private lastDab = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stabilizer: Stabilizer;
  /** ⇧-drag: the straight line, applied on release. */
  private line: { from: { x: number; y: number }; to: { x: number; y: number } } | null = null;
  overlay?: (ctx: CanvasRenderingContext2D, view: OverlayView) => void;
  readonly cursor = 'none';

  static create(sub: SubTool, p: PointerInfo): ToolSession | null {
    if (!sub.liquify) return null;
    // Raster layers, selection layers and layer masks; not vector lines.
    const reason = actions.rasterOnlyBlocker();
    if (reason) {
      setState({ hint: reason });
      return null;
    }
    const target = strokeTarget();
    return target ? new LiquifySession(sub.name, sub.liquify, p, target) : null;
  }

  private constructor(
    private label: string,
    private o: LiquifySettings,
    p: PointerInfo,
    target: StrokeTarget,
  ) {
    this.edit = new DirectEdit(target.layerId, target.layer, target.onChange);
    this.before = ctx2d(this.edit.backup, true);
    this.field = new WarpField(target.layer.width, target.layer.height);
    this.lockAlpha = target.lockAlpha;
    this.selection = getState().selection;
    this.alt = p.alt;
    this.last = { x: p.x, y: p.y };
    this.pen = { x: p.x, y: p.y };
    this.stabilizer = new Stabilizer(stabilizerWindow(o.stabilization));
    if (p.shift) {
      this.line = { from: { x: p.x, y: p.y }, to: { x: p.x, y: p.y } };
      this.overlay = (ctx, view) => this.drawLine(ctx, view);
    } else if (STATIONARY_MODES.includes(o.mode)) {
      this.dab(p.x, p.y, 0, 0, true);
      this.timer = setInterval(() => this.hold(), LIQUIFY_HOLD_MS);
    }
  }

  /** The pen stays: Expand, Pinch and Twirl go on where it is. */
  private hold(): void {
    if (performance.now() - this.lastDab < LIQUIFY_HOLD_MS * 0.8) return;
    this.dab(this.pen.x, this.pen.y, 0, 0, true);
    this.last = { ...this.pen };
  }

  private get radius(): number {
    return Math.max(0.5, this.o.size / 2);
  }

  /** Dabs along the way to (x, y), each a little way on from the last. */
  private to(x: number, y: number): void {
    this.pen = { x, y };
    const spacing = Math.max(1, this.radius * SPACING);
    let dx = x - this.last.x;
    let dy = y - this.last.y;
    let dist = Math.hypot(dx, dy);
    while (dist >= spacing) {
      const nx = this.last.x + (dx * spacing) / dist;
      const ny = this.last.y + (dy * spacing) / dist;
      this.dab(nx, ny, nx - this.last.x, ny - this.last.y, false);
      this.last = { x: nx, y: ny };
      dx = x - nx;
      dy = y - ny;
      dist = Math.hypot(dx, dy);
    }
  }

  private dab(x: number, y: number, dx: number, dy: number, held: boolean): void {
    const o = this.o;
    const d: LiquifyDab = {
      x,
      y,
      radius: this.radius,
      mode: this.alt ? invertMode(o.mode) : o.mode,
      strength: dabStrength(o.mode, o.strength, held),
      hardness: o.hardness / 100,
      dx,
      dy,
      reverse: this.alt && o.mode === 'push',
    };
    const { width, height } = this.edit.layer;
    const rect = dabRect(d, width, height);
    if (!rect.w || !rect.h) return;
    // The dab's area, redrawn from the pixels before the stroke where the warp now takes them from.
    const need = warpDab(this.field, d, rect, this.selection);
    const src = this.before.getImageData(need.x, need.y, need.w, need.h);
    const out = warpPixels({ x: need.x, y: need.y, width: src.width, height: src.height, data: src.data }, this.field, rect, {
      antiAlias: o.antiAlias,
      lockAlpha: this.lockAlpha,
      selection: this.selection,
      onlyArea: o.onlyArea,
    });
    const ctx = this.edit.ctx;
    ctx.putImageData(new ImageData(out, rect.w, rect.h), rect.x, rect.y);
    this.edit.changed(rect);
    this.lastDab = performance.now();
  }

  move(p: PointerInfo, coalesced: PointerInfo[]): void {
    this.alt = p.alt;
    if (this.line) {
      this.line.to = { x: p.x, y: p.y };
      return;
    }
    for (const q of coalesced.length ? coalesced : [p]) {
      const s = this.stabilizer.push({ x: q.x, y: q.y, pressure: q.pressure });
      this.to(s.x, s.y);
    }
  }

  /** ⇧-drag: the line and the brush at its end. */
  private drawLine(ctx: CanvasRenderingContext2D, view: OverlayView): void {
    const line = this.line!;
    const a = applyMatrix(view.matrix, line.from.x, line.from.y);
    const b = applyMatrix(view.matrix, line.to.x, line.to.y);
    ctx.save();
    ctx.lineWidth = 1;
    for (const [color, offset] of [
      ['rgba(255,255,255,0.8)', 1],
      ['rgba(0,0,0,0.75)', 0],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.moveTo(b.x + this.radius * view.zoom + offset, b.y);
      ctx.arc(b.x, b.y, this.radius * view.zoom + offset, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  modifiers(m: Modifiers): void {
    this.alt = m.alt;
  }

  private stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  up(p: PointerInfo): void {
    this.stop();
    if (this.line) {
      this.alt = p.alt;
      this.to(p.x, p.y);
    } else {
      this.move(p, []);
      for (const q of this.stabilizer.finish()) this.to(q.x, q.y);
    }
    actions.commitPixels(this.label, [this.edit.commit()]);
  }

  cancel(): void {
    this.stop();
    this.edit.cancel();
  }
}
