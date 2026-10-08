/** Turns pointer input into dabs on a layer: pens, pencils, brushes, airbrush, eraser and blend tools. */
import { hexToRgb, type RGB } from '../model/color';
import type { Id } from '../model/types';
import { circleBounds, union, type Rect } from '../paint/rect';
import { dabAlpha, interpolateDabs, pressureCurve, Stabilizer, stabilizerWindow, type Dab, type StrokePoint } from '../paint/stroke';
import type { BrushSettings } from '../paint/tools';
import { createCanvas, ctx2d, type Ctx } from './canvas';
import { DirectEdit, LayerEdit, type PixelPatch } from './edit';

const MAX_TIP = 256;

/** Width of the soft edge (px) for anti-aliasing levels weak / medium / strong. */
const AA_EDGE = [0, 0, 0.8, 1.6];

/** Pre-rendered brush tips for one stroke (colour and hardness are fixed during a stroke). */
class Tips {
  /** Soft tips by quantised hardness (grain variants for the brush's own hardness). */
  private soft = new Map<number, HTMLCanvasElement[]>();
  private aliased = new Map<number, HTMLCanvasElement>();
  private readonly hard: boolean;
  private readonly aa: number;

  constructor(
    private brush: BrushSettings,
    private rgb: RGB,
  ) {
    this.aa = Math.max(0, Math.min(3, Math.round(brush.antiAlias)));
    this.hard = brush.texture === 'none' && brush.hardness >= 0.97;
  }

  private softTips(hardness: number): HTMLCanvasElement[] {
    const q = Math.round(hardness * 40) / 40;
    let tips = this.soft.get(q);
    if (!tips) {
      const grain = this.brush.texture === 'grain';
      tips = [];
      for (let i = 0; i < (grain ? 4 : 1); i++) tips.push(this.makeSoftTip(q, grain));
      this.soft.set(q, tips);
    }
    return tips;
  }

  private makeSoftTip(hardness: number, grain: boolean): HTMLCanvasElement {
    const size = Math.max(8, Math.min(MAX_TIP, Math.ceil(this.brush.size)));
    const c = createCanvas(size, size);
    const ctx = ctx2d(c, grain);
    const r = size / 2;
    const { r: R, g: G, b: B } = this.rgb;
    const g = ctx.createRadialGradient(r, r, 0, r, r, r);
    const h = Math.min(0.99, Math.max(0, hardness));
    g.addColorStop(0, `rgba(${R},${G},${B},1)`);
    g.addColorStop(h, `rgba(${R},${G},${B},1)`);
    // Smooth (cosine-like) falloff from the hard core to the edge.
    for (let i = 1; i <= 4; i++) {
      const t = i / 5;
      const a = 0.5 + 0.5 * Math.cos(t * Math.PI);
      g.addColorStop(h + (1 - h) * t, `rgba(${R},${G},${B},${a.toFixed(3)})`);
    }
    g.addColorStop(1, `rgba(${R},${G},${B},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    if (grain) {
      const img = ctx.getImageData(0, 0, size, size);
      for (let p = 3; p < img.data.length; p += 4) img.data[p] = img.data[p] * (0.35 + 0.65 * Math.random());
      ctx.putImageData(img, 0, 0);
    }
    return c;
  }

  private aliasedTip(d: number): HTMLCanvasElement {
    let c = this.aliased.get(d);
    if (c) return c;
    c = createCanvas(d, d);
    const ctx = ctx2d(c);
    ctx.fillStyle = `rgb(${this.rgb.r},${this.rgb.g},${this.rgb.b})`;
    const r = d / 2;
    for (let y = 0; y < d; y++) {
      const dy = y + 0.5 - r;
      const half = Math.sqrt(Math.max(0, r * r - dy * dy));
      const x0 = Math.round(r - half);
      const x1 = Math.round(r + half);
      if (x1 > x0) ctx.fillRect(x0, y, x1 - x0, 1);
    }
    if (d <= 2) ctx.fillRect(0, 0, d, d);
    this.aliased.set(d, c);
    return c;
  }

  /** Draws one dab; returns the touched rect. */
  draw(ctx: Ctx, x: number, y: number, radius: number, alpha: number): Rect {
    if (this.aa === 0) {
      const d = Math.max(1, Math.round(radius * 2));
      const left = Math.round(x - d / 2);
      const top = Math.round(y - d / 2);
      ctx.globalAlpha = alpha;
      ctx.drawImage(this.aliasedTip(d), left, top);
      return { x: left, y: top, w: d, h: d };
    }
    let r = radius;
    let a = alpha;
    if (r < 0.5) {
      // Sub-pixel dabs fade out instead of shrinking further (thin pen tips stay smooth).
      a *= (r / 0.5) ** 2;
      r = 0.5;
    }
    ctx.globalAlpha = a;
    if (this.hard && this.aa === 1) {
      ctx.fillStyle = `rgb(${this.rgb.r},${this.rgb.g},${this.rgb.b})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Hard tips get a soft edge of a fixed pixel width; soft tips keep their own falloff.
      const hardness = this.hard ? Math.max(0, Math.min(0.97, 1 - AA_EDGE[this.aa] / Math.max(r, 0.5))) : this.brush.hardness;
      const tips = this.softTips(hardness);
      const tip = tips[(Math.random() * tips.length) | 0];
      const rr = this.hard ? r + AA_EDGE[this.aa] / 2 : r;
      ctx.drawImage(tip, x - rr, y - rr, rr * 2, rr * 2);
      return circleBounds(x, y, rr);
    }
    return circleBounds(x, y, r);
  }
}

export interface StrokeTarget {
  layerId: Id;
  layer: HTMLCanvasElement;
  selection: HTMLCanvasElement | null;
  lockAlpha: boolean;
  onChange: (r: Rect) => void;
}

export interface Stroke {
  add(p: StrokePoint): void;
  /** Straight-line preview from the stroke start to `p` (Shift). */
  lineTo(p: StrokePoint): void;
  /** Replaces the stroke by a polyline (figure tool previews). */
  path(points: StrokePoint[]): void;
  end(): PixelPatch | null;
  cancel(): void;
}

/** Brush strokes for paint and erase modes (buffered: no opacity build-up within a stroke). */
export class BrushStroke implements Stroke {
  private edit: LayerEdit;
  private tips: Tips;
  private stabilizer: Stabilizer;
  private last: StrokePoint | null = null;
  private start: StrokePoint | null = null;
  private carry = 0;

  constructor(
    private brush: BrushSettings,
    color: string,
    erase: boolean,
    target: StrokeTarget,
  ) {
    this.tips = new Tips(brush, hexToRgb(color) ?? { r: 0, g: 0, b: 0 });
    this.stabilizer = new Stabilizer(stabilizerWindow(brush.stabilization));
    this.edit = new LayerEdit(target.layerId, target.layer, {
      mode: erase || brush.mode === 'erase' ? 'erase' : 'paint',
      opacity: brush.opacity,
      lockAlpha: target.lockAlpha,
      selection: target.selection,
      onChange: target.onChange,
    });
  }

  private radius(p: StrokePoint): number {
    return (this.brush.size / 2) * pressureCurve(p.pressure, this.brush.minSize, this.brush.sizePressure);
  }

  private alpha(p: StrokePoint): number {
    const density = this.brush.flow * pressureCurve(p.pressure, 0, this.brush.opacityPressure);
    return dabAlpha(density, this.brush.spacing, this.brush.scatter > 0);
  }

  private dab(d: StrokePoint): Rect {
    const ctx = this.edit.bufferCtx;
    let x = d.x;
    let y = d.y;
    if (this.brush.scatter > 0) {
      const a = Math.random() * Math.PI * 2;
      const s = Math.sqrt(Math.random()) * this.brush.scatter * this.brush.size;
      x += Math.cos(a) * s;
      y += Math.sin(a) * s;
    }
    return this.tips.draw(ctx, x, y, this.radius(d), this.alpha(d));
  }

  private segment(from: StrokePoint, to: StrokePoint): Rect | null {
    const spacing = Math.max(0.5, this.brush.spacing * this.radius(from) * 2);
    const { dabs, carry } = interpolateDabs(from, to, spacing, this.carry);
    this.carry = carry;
    let r: Rect | null = null;
    for (const d of dabs) r = union(r, this.dab(d));
    return r;
  }

  add(raw: StrokePoint): void {
    const p = this.stabilizer.push(raw);
    if (!this.start) {
      this.start = raw;
      this.last = p;
      this.edit.update(this.dab({ ...p, angle: 0 } as Dab));
      return;
    }
    const r = this.segment(this.last!, p);
    this.last = p;
    if (r) this.edit.update(r);
  }

  lineTo(p: StrokePoint): void {
    const start = this.start ?? p;
    this.start = start;
    this.path([start, { ...p, pressure: start.pressure }]);
  }

  path(points: StrokePoint[]): void {
    this.edit.reset();
    if (points.length === 0) return;
    this.carry = 0;
    let r: Rect | null = this.dab(points[0] as Dab);
    for (let i = 1; i < points.length; i++) r = union(r, this.segment(points[i - 1], points[i]));
    this.last = points[points.length - 1];
    if (r) this.edit.update(r);
  }

  end(): PixelPatch | null {
    let r: Rect | null = null;
    for (const p of this.stabilizer.finish()) {
      if (this.last) r = union(r, this.segment(this.last, p));
      this.last = p;
    }
    if (r) this.edit.update(r);
    return this.edit.commit();
  }

  cancel(): void {
    this.edit.cancel();
  }
}

/** Blend tool: blur or smudge directly on the layer pixels. */
export class BlendStroke implements Stroke {
  private edit: DirectEdit;
  private tip: HTMLCanvasElement;
  private tmp: HTMLCanvasElement;
  private tmpCtx: Ctx;
  private load: HTMLCanvasElement;
  private loadCtx: Ctx;
  private loaded = false;
  private last: StrokePoint | null = null;
  private carry = 0;
  private d: number;

  constructor(
    private brush: BrushSettings,
    private target: StrokeTarget,
  ) {
    this.edit = new DirectEdit(target.layerId, target.layer, target.onChange);
    this.d = Math.max(2, Math.ceil(brush.size) + 2);
    this.tip = createCanvas(this.d, this.d);
    const tctx = ctx2d(this.tip);
    const r = this.d / 2;
    const g = tctx.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(Math.min(0.95, brush.hardness), 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    tctx.fillStyle = g;
    tctx.fillRect(0, 0, this.d, this.d);
    this.tmp = createCanvas(this.d, this.d);
    this.tmpCtx = ctx2d(this.tmp);
    this.load = createCanvas(this.d, this.d);
    this.loadCtx = ctx2d(this.load);
  }

  private dab(p: StrokePoint): Rect {
    const d = this.d;
    const x0 = Math.round(p.x - d / 2);
    const y0 = Math.round(p.y - d / 2);
    const layer = this.target.layer;
    const t = this.tmpCtx;
    const strength = this.brush.flow * pressureCurve(p.pressure, 0, this.brush.opacityPressure);
    t.globalCompositeOperation = 'copy';
    t.globalAlpha = 1;
    if (this.brush.blendStyle === 'smudge') {
      if (!this.loaded) {
        this.loadCtx.globalCompositeOperation = 'copy';
        this.loadCtx.drawImage(layer, x0, y0, d, d, 0, 0, d, d);
        this.loaded = true;
      }
      t.drawImage(this.load, 0, 0);
    } else {
      t.filter = `blur(${Math.max(1, d / 8).toFixed(1)}px)`;
      t.drawImage(layer, x0, y0, d, d, 0, 0, d, d);
      t.filter = 'none';
    }
    t.globalCompositeOperation = 'destination-in';
    t.drawImage(this.tip, 0, 0);
    if (this.target.selection) t.drawImage(this.target.selection, x0, y0, d, d, 0, 0, d, d);
    const ctx = this.edit.ctx;
    ctx.save();
    ctx.globalAlpha = Math.min(1, strength);
    ctx.globalCompositeOperation = this.target.lockAlpha ? 'source-atop' : 'source-over';
    ctx.drawImage(this.tmp, x0, y0);
    ctx.restore();
    if (this.brush.blendStyle === 'smudge') {
      // Pick up some of the colour under the tip for the next dab.
      this.loadCtx.globalCompositeOperation = 'source-over';
      this.loadCtx.globalAlpha = Math.max(0.05, 1 - this.brush.flow);
      this.loadCtx.drawImage(layer, x0, y0, d, d, 0, 0, d, d);
      this.loadCtx.globalAlpha = 1;
    }
    return { x: x0, y: y0, w: d, h: d };
  }

  add(p: StrokePoint): void {
    if (!this.last) {
      this.last = p;
      this.edit.changed(this.dab(p));
      return;
    }
    const { dabs, carry } = interpolateDabs(this.last, p, Math.max(1, this.brush.spacing * this.brush.size), this.carry);
    this.carry = carry;
    this.last = p;
    let r: Rect | null = null;
    for (const d of dabs) r = union(r, this.dab(d));
    this.edit.changed(r);
  }

  lineTo(p: StrokePoint): void {
    this.add(p);
  }

  path(points: StrokePoint[]): void {
    for (const p of points) this.add(p);
  }

  end(): PixelPatch | null {
    return this.edit.commit();
  }

  cancel(): void {
    this.edit.cancel();
  }
}
