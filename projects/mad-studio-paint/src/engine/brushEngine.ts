/** Turns pointer input into dabs on a layer: pens, pencils, brushes, airbrush, eraser and blend tools. */
import { hexToRgb, type RGB } from '../model/color';
import type { Id } from '../model/types';
import { evalPressureCurve } from '../paint/curve';
import { applyWatercolorEdge } from '../paint/effects';
import { amountAt, densityFactor, nextDab, type Paint } from '../paint/mixing';
import { circleBounds, inflate, intersect, union, type Rect } from '../paint/rect';
import { affineAngle, applyAffine, type Affine, type Constraint } from '../paint/rulers';
import { dabAlpha, interpolateDabs, pressureCurve, seededRandom, Stabilizer, stabilizerWindow, taperFactor, type Dab, type StrokePoint } from '../paint/stroke';
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
  private tint: HTMLCanvasElement | null = null;
  private readonly hard: boolean;
  private readonly aa: number;
  /** Random source of the stroke (grain variants). */
  rand: () => number = Math.random;

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

  /** `tip` recoloured to `color` (colour mixing), on a reused scratch canvas. */
  private tinted(tip: HTMLCanvasElement, color: Paint): HTMLCanvasElement {
    const t = this.tint && this.tint.width >= tip.width && this.tint.height >= tip.height ? this.tint : (this.tint = createCanvas(tip.width, tip.height));
    const ctx = ctx2d(t);
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(tip, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = paintCss(color);
    ctx.fillRect(0, 0, tip.width, tip.height);
    ctx.globalCompositeOperation = 'source-over';
    return t;
  }

  /**
   * Draws one dab; returns the touched rect. `thickness` < 1 squashes the tip across `angle`
   * (radians); `color` overrides the stroke colour (colour mixing).
   */
  draw(ctx: Ctx, x: number, y: number, radius: number, alpha: number, angle = 0, thickness = 1, color: Paint | null = null): Rect {
    const squash = Math.max(0.05, Math.min(1, thickness));
    const shaped = squash < 1;
    if (this.aa === 0 && !shaped) {
      const d = Math.max(1, Math.round(radius * 2));
      const left = Math.round(x - d / 2);
      const top = Math.round(y - d / 2);
      const tip = this.aliasedTip(d);
      ctx.globalAlpha = alpha;
      ctx.drawImage(color ? this.tinted(tip, color) : tip, 0, 0, d, d, left, top, d, d);
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
      ctx.fillStyle = color ? paintCss(color) : `rgb(${this.rgb.r},${this.rgb.g},${this.rgb.b})`;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * squash, angle, 0, Math.PI * 2);
      ctx.fill();
      return circleBounds(x, y, r);
    }
    let tip: HTMLCanvasElement;
    let rr: number;
    if (this.aa === 0) {
      const d = Math.max(1, Math.round(r * 2));
      tip = this.aliasedTip(d);
      rr = d / 2;
    } else {
      // Hard tips get a soft edge of a fixed pixel width; soft tips keep their own falloff.
      const hardness = this.hard ? Math.max(0, Math.min(0.97, 1 - AA_EDGE[this.aa] / Math.max(r, 0.5))) : this.brush.hardness;
      const tips = this.softTips(hardness);
      tip = tips[(this.rand() * tips.length) | 0];
      rr = this.hard ? r + AA_EDGE[this.aa] / 2 : r;
    }
    const src = color ? this.tinted(tip, color) : tip;
    if (shaped || angle !== 0) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.scale(1, squash);
      ctx.imageSmoothingEnabled = this.aa > 0;
      ctx.drawImage(src, 0, 0, tip.width, tip.height, -rr, -rr, rr * 2, rr * 2);
      ctx.restore();
    } else ctx.drawImage(src, 0, 0, tip.width, tip.height, x - rr, y - rr, rr * 2, rr * 2);
    return circleBounds(x, y, rr);
  }
}

const paintCss = (c: Paint) => `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`;

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

/**
 * Brush strokes for paint and erase modes (buffered: no opacity build-up within a stroke).
 * Dynamics (pressure graphs, tilt, random), tip shape, starting and ending, colour mixing and the
 * watercolor edge are applied per dab. The stroke keeps its points and random seed, so it can be
 * redrawn identically once its length is known (ending taper) at pen-up.
 */
export class BrushStroke implements Stroke {
  private edit: LayerEdit;
  private tips: Tips;
  private stabilizer: Stabilizer;
  private last: StrokePoint | null = null;
  private start: StrokePoint | null = null;
  private carry = 0;
  /** Distance travelled along the stroke (px), for starting/ending and colour stretch. */
  private travel = 0;
  /** Smoothed points drawn so far (for redrawing). */
  private trail: StrokePoint[] = [];
  private readonly seed = (Math.random() * 2 ** 32) >>> 0;
  private rand: () => number;
  private readonly erase: boolean;
  private readonly brushPaint: Paint;
  /** Paint carried by a "Blend" colour-mixing brush. */
  private carried: Paint;
  /** Symmetrical ruler: every dab is repeated with these transforms (identity first). */
  copies: Affine[] | null = null;
  /** Ruler snapping: maps each (smoothed) point onto the ruler's path. */
  constrain: Constraint | null = null;

  constructor(
    private brush: BrushSettings,
    color: string,
    erase: boolean,
    target: StrokeTarget,
  ) {
    const rgb = hexToRgb(color) ?? { r: 0, g: 0, b: 0 };
    this.tips = new Tips(brush, rgb);
    this.rand = seededRandom(this.seed);
    this.tips.rand = this.rand;
    this.brushPaint = { ...rgb, a: 1 };
    this.carried = { ...this.brushPaint };
    this.stabilizer = new Stabilizer(stabilizerWindow(brush.stabilization));
    this.erase = erase || brush.mode === 'erase';
    this.edit = new LayerEdit(target.layerId, target.layer, {
      mode: this.erase ? 'erase' : 'paint',
      opacity: brush.opacity,
      lockAlpha: target.lockAlpha,
      selection: target.selection,
      onChange: target.onChange,
    });
  }

  private get mixing(): 'blend' | 'running' | null {
    return this.brush.mixing !== 'none' && !this.erase ? this.brush.mixing : null;
  }

  /** Random variation 1 − amount … 1. */
  private jitter(amount: number): number {
    return amount > 0 ? 1 - amount * this.rand() : 1;
  }

  private radius(p: StrokePoint, d: number, total: number): number {
    const b = this.brush;
    let f = b.sizePressure ? b.minSize + (1 - b.minSize) * evalPressureCurve(b.sizeCurve, p.pressure) : 1;
    if (b.sizeTilt) f *= 1 + (p.tilt ?? 0);
    if (b.taperSize) f *= taperFactor(d, total, b.taperStart, b.taperEnd);
    return (b.size / 2) * f * this.jitter(b.sizeRandom);
  }

  private alpha(p: StrokePoint, d: number, total: number): number {
    const b = this.brush;
    let density = b.flow * (b.opacityPressure ? b.minDensity + (1 - b.minDensity) * evalPressureCurve(b.densityCurve, p.pressure) : 1);
    if (b.densityTilt) density *= 1 - 0.7 * (p.tilt ?? 0);
    if (b.taperDensity) density *= taperFactor(d, total, b.taperStart, b.taperEnd);
    density *= this.jitter(b.densityRandom);
    return dabAlpha(density, b.spacing, b.scatter > 0);
  }

  private tipAngle(p: Dab | StrokePoint): number {
    const b = this.brush;
    const base = (b.angle * Math.PI) / 180;
    if (b.angleSource === 'line') return base + ((p as Dab).angle ?? 0);
    if (b.angleSource === 'tilt') return base + (p.azimuth ?? 0);
    return base;
  }

  private dab(p: Dab | StrokePoint, d: number, total: number): Rect | null {
    const ctx = this.edit.bufferCtx;
    let x = p.x;
    let y = p.y;
    if (this.brush.scatter > 0) {
      const a = this.rand() * Math.PI * 2;
      const s = Math.sqrt(this.rand()) * this.brush.scatter * this.brush.size;
      x += Math.cos(a) * s;
      y += Math.sin(a) * s;
    }
    const r = this.radius(p, d, total);
    let alpha = this.alpha(p, d, total);
    let color: Paint | null = null;
    const mixing = this.mixing;
    if (mixing) {
      const under = this.edit.sampleBackup(x, y, r);
      const keep = amountAt(d, this.brush.size, this.brush.colorStretch, this.brush.paintAmount);
      const next = nextDab(mixing, this.brushPaint, this.carried, under, keep);
      this.carried = next.carried;
      color = next.color;
      alpha *= densityFactor(under.a, this.brush.paintDensity);
    }
    if (r <= 0 || alpha <= 0) return null;
    const angle = this.tipAngle(p);
    let rect = this.tips.draw(ctx, x, y, r, alpha, angle, this.brush.thickness, color);
    if (this.copies) {
      for (let i = 1; i < this.copies.length; i++) {
        const m = this.copies[i];
        const q = applyAffine(m, { x, y });
        const { angle: turn, mirrored } = affineAngle(m);
        rect = union(rect, this.tips.draw(ctx, q.x, q.y, r, alpha, mirrored ? turn - angle : angle + turn, this.brush.thickness, color))!;
      }
    }
    return rect;
  }

  /** Applies the ruler constraint to a point (keeping pressure and tilt). */
  private snapped(p: StrokePoint): StrokePoint {
    return this.constrain ? { ...p, ...this.constrain(p) } : p;
  }

  /** Dabs between two points; `total` is the stroke length when known (ending taper). */
  private segment(from: StrokePoint, to: StrokePoint, total: number): Rect | null {
    const thin = Math.max(0.1, Math.min(1, this.brush.thickness));
    const spacing = Math.max(0.5, this.brush.spacing * this.radius(from, this.travel, total) * 2 * thin);
    const { dabs, carry } = interpolateDabs(from, to, spacing, this.carry);
    this.carry = carry;
    let r: Rect | null = null;
    for (const dab of dabs) r = union(r, this.dab(dab, this.travel + Math.hypot(dab.x - from.x, dab.y - from.y), total));
    this.travel += Math.hypot(to.x - from.x, to.y - from.y);
    return r;
  }

  /** Clears the stroke and draws `points` again from the same random seed. */
  private redraw(points: StrokePoint[], total: number): void {
    this.edit.reset();
    this.rand = seededRandom(this.seed);
    this.tips.rand = this.rand;
    this.carried = { ...this.brushPaint };
    this.carry = 0;
    this.travel = 0;
    if (points.length === 0) return;
    let r = this.dab({ ...points[0], angle: 0 }, 0, total);
    for (let i = 1; i < points.length; i++) r = union(r, this.segment(points[i - 1], points[i], total));
    if (r) this.edit.update(r);
  }

  add(raw: StrokePoint): void {
    const p = this.snapped(this.stabilizer.push(raw));
    if (!this.start) {
      this.start = raw;
      this.last = p;
      this.trail.push(p);
      const r = this.dab({ ...p, angle: 0 }, 0, Infinity);
      if (r) this.edit.update(r);
      return;
    }
    const r = this.segment(this.last!, p, Infinity);
    this.last = p;
    this.trail.push(p);
    if (r) this.edit.update(r);
  }

  lineTo(p: StrokePoint): void {
    const start = this.start ?? p;
    this.start = start;
    this.path([start, { ...p, pressure: start.pressure }]);
  }

  path(points: StrokePoint[]): void {
    this.trail = [...points];
    this.last = points[points.length - 1] ?? null;
    this.redraw(points, pathLength(points));
  }

  end(): PixelPatch | null {
    let r: Rect | null = null;
    for (const raw of this.stabilizer.finish()) {
      const p = this.snapped(raw);
      if (this.last) r = union(r, this.segment(this.last, p, Infinity));
      this.last = p;
      this.trail.push(p);
    }
    if (r) this.edit.update(r);
    // Now that the length is known, the end of the stroke can taper.
    if (this.brush.taperEnd > 0 && (this.brush.taperSize || this.brush.taperDensity)) this.redraw(this.trail, pathLength(this.trail));
    if (this.brush.watercolorEdge && !this.erase) this.applyWatercolorEdge();
    return this.edit.commit();
  }

  /** Denser, darker paint along the border of the finished stroke. */
  private applyWatercolorEdge(): void {
    const touched = this.edit.touchedRect;
    if (!touched) return;
    const { width, height } = this.edit.buffer;
    const range = Math.max(0.5, this.brush.edgeRange);
    const r = intersect(inflate(touched, Math.ceil(range) + 1), { x: 0, y: 0, w: width, h: height });
    if (!r) return;
    const ctx = this.edit.bufferCtx;
    const img = ctx.getImageData(r.x, r.y, r.w, r.h);
    applyWatercolorEdge(img.data, r.w, r.h, {
      enabled: true,
      kind: 'watercolor',
      width: 0,
      color: '#000000',
      range,
      opacity: this.brush.edgeOpacity * 100,
      darkness: this.brush.edgeDarkness * 100,
      blur: range / 2,
    });
    ctx.putImageData(img, r.x, r.y);
    this.edit.update(r);
  }

  cancel(): void {
    this.edit.cancel();
  }
}

const pathLength = (pts: StrokePoint[]) => pts.reduce((n, p, i) => (i ? n + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);

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
