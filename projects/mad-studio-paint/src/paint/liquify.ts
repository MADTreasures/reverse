/**
 * Liquify tool, like the reference's: each dab warps the pixels under the brush – Push along the
 * stroke, Expand / Pinch from the middle, Push left / right of the stroke, Twirl clockwise /
 * anticlockwise (Alt does the opposite). Strength sets how far, hardness how evenly the brush area
 * moves. The dabs of a stroke build up a warp field (where each pixel's colour comes from), and the
 * image as it was before the stroke is sampled once through it – bilinear on premultiplied colour,
 * so edges do not darken, or the nearest pixel without anti-aliasing – so lines stay sharp however
 * many dabs pass over them. A selection limits it (soft edges move partly), Only refer to editing
 * area keeps colours from outside the selection out, and Lock transparent pixels keeps the shape.
 * Pure, unit tested.
 */
import type { Mask } from './mask';

export type LiquifyMode = 'push' | 'expand' | 'pinch' | 'pushLeft' | 'pushRight' | 'twirlCW' | 'twirlCCW';

export const LIQUIFY_MODES: [LiquifyMode, string][] = [
  ['push', 'Push'],
  ['expand', 'Expand'],
  ['pinch', 'Pinch'],
  ['pushLeft', 'Push left'],
  ['pushRight', 'Push right'],
  ['twirlCW', 'Twirl clockwise'],
  ['twirlCCW', 'Twirl anti-clockwise'],
];

/** Modes that act where the pen stays (press and hold), not only along the stroke. */
export const STATIONARY_MODES: LiquifyMode[] = ['expand', 'pinch', 'twirlCW', 'twirlCCW'];

/**
 * Push modes: the part of the pen's way the pixels under the core of the brush move at strength
 * 100 – less than all of it, so they fall behind the pen and stay near where they were (the
 * reference's push shifts the image along the stroke, it does not carry it to the stroke's end).
 */
export const PUSH_GAIN = 0.35;
/** Expand, Pinch and Twirl: the part of a full step one dab does along the stroke, and while the pen is held (about every 50 ms). */
export const STROKE_AMOUNT = 0.3;
export const HOLD_AMOUNT = 0.2;

/** The strength (0..1) of one dab for the tool's Strength (1..100), along the stroke or while held. */
export function dabStrength(mode: LiquifyMode, strength: number, held: boolean): number {
  const s = Math.max(0, Math.min(100, strength)) / 100;
  if (!STATIONARY_MODES.includes(mode)) return s * PUSH_GAIN;
  return s * (held ? HOLD_AMOUNT : STROKE_AMOUNT);
}

/** Alt: the opposite effect (Push pushes against the stroke). */
export function invertMode(m: LiquifyMode): LiquifyMode {
  const opposite: Record<LiquifyMode, LiquifyMode> = { push: 'push', expand: 'pinch', pinch: 'expand', pushLeft: 'pushRight', pushRight: 'pushLeft', twirlCW: 'twirlCCW', twirlCCW: 'twirlCW' };
  return opposite[m];
}

/** How much of the effect reaches distance `d` from the middle of a dab of radius `r`: all of it in the hard core, then smoothly less to nothing at the rim. */
export function falloff(d: number, r: number, hardness: number): number {
  if (d >= r) return 0;
  const core = Math.min(0.95, Math.max(0, hardness)) * r;
  if (d <= core) return 1;
  const t = (d - core) / (r - core);
  return 1 - t * t * (3 - 2 * t);
}

export interface LiquifyDab {
  /** Middle of the dab (document pixels). */
  x: number;
  y: number;
  radius: number;
  mode: LiquifyMode;
  /** 0..1 */
  strength: number;
  /** 0..1 */
  hardness: number;
  /** How the pen moved since the last dab (push modes). */
  dx: number;
  dy: number;
  /** Alt held: push against the stroke (other modes: use invertMode). */
  reverse?: boolean;
}

/** RGBA pixels (straight alpha) and where they lie in the document. */
export interface PixelArea {
  x: number;
  y: number;
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface LiquifyOptions {
  /** Smooth sampling; off takes the nearest pixel (jagged edges stay jagged). */
  antiAlias: boolean;
  /** Lock transparent pixels: the alpha stays, only the colours move. */
  lockAlpha?: boolean;
  /** The selection (document sized): only selected pixels change, partly selected ones partly. */
  selection?: Mask | null;
  /** Only refer to editing area: colours come only from inside the selection. */
  onlyArea?: boolean;
}

/** Expand / pinch: how much nearer (farther) the middle a fully affected pixel samples per dab. */
const ZOOM_STEP = 0.25;
/** Twirl: radians a fully affected pixel turns per dab. */
const TWIRL_STEP = 0.35;

/** Where the warp of one dab takes the colour of document point (px, py) from. */
function sourceOf(d: LiquifyDab, px: number, py: number, f: number): [number, number] {
  const k = f * d.strength;
  const rx = px - d.x;
  const ry = py - d.y;
  const sign = d.reverse ? -1 : 1;
  switch (d.mode) {
    case 'push':
      return [px - d.dx * k * sign, py - d.dy * k * sign];
    case 'pushLeft':
    case 'pushRight': {
      // Left of the stroke direction (y points down): (dy, -dx).
      const s = (d.mode === 'pushLeft' ? 1 : -1) * sign;
      return [px - d.dy * k * s, py + d.dx * k * s];
    }
    case 'expand':
    case 'pinch': {
      const z = d.mode === 'expand' ? 1 - ZOOM_STEP * k : 1 + ZOOM_STEP * k;
      return [d.x + rx * z, d.y + ry * z];
    }
    default: {
      // Clockwise on screen is a positive angle with y down; the colour comes from the other way.
      const a = (d.mode === 'twirlCW' ? -1 : 1) * TWIRL_STEP * k;
      const c = Math.cos(a);
      const s = Math.sin(a);
      return [d.x + rx * c - ry * s, d.y + rx * s + ry * c];
    }
  }
}

/** The rectangle a dab changes (whole pixels inside the document). */
export function dabRect(d: LiquifyDab, width: number, height: number): Rect {
  const x0 = Math.max(0, Math.floor(d.x - d.radius));
  const y0 = Math.max(0, Math.floor(d.y - d.radius));
  const x1 = Math.min(width, Math.ceil(d.x + d.radius));
  const y1 = Math.min(height, Math.ceil(d.y + d.radius));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const TILE = 64;
const TILE_SHIFT = 6;

/**
 * The warp of one stroke: for every pixel, how far (x, y) from it its colour now comes from in the
 * image as it was before the stroke. Kept in tiles, only where the stroke went.
 */
export class WarpField {
  private tiles = new Map<number, Float32Array>();
  private cols: number;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.cols = Math.ceil(width / TILE);
  }

  private tile(x: number, y: number, create: boolean): Float32Array | undefined {
    const key = (y >> TILE_SHIFT) * this.cols + (x >> TILE_SHIFT);
    let t = this.tiles.get(key);
    if (!t && create) {
      t = new Float32Array(TILE * TILE * 2);
      this.tiles.set(key, t);
    }
    return t;
  }

  /** The displacement of pixel (x, y) (inside the document) into `out`. */
  get(x: number, y: number, out: { x: number; y: number }): void {
    const t = this.tile(x, y, false);
    const k = ((y & (TILE - 1)) * TILE + (x & (TILE - 1))) * 2;
    out.x = t ? t[k] : 0;
    out.y = t ? t[k + 1] : 0;
  }

  set(x: number, y: number, dx: number, dy: number): void {
    const t = this.tile(x, y, dx !== 0 || dy !== 0);
    if (!t) return;
    const k = ((y & (TILE - 1)) * TILE + (x & (TILE - 1))) * 2;
    t[k] = dx;
    t[k + 1] = dy;
  }

  /** The displacement at document point (px, py) (pixel centres at +0.5, bilinear, the edge pixels beyond the document) into `out`. */
  sample(px: number, py: number, out: { x: number; y: number }): void {
    const fx = px - 0.5;
    const fy = py - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    let dx = 0;
    let dy = 0;
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 2; i++) {
        const w = (i ? tx : 1 - tx) * (j ? ty : 1 - ty);
        if (w === 0) continue;
        const x = Math.min(this.width - 1, Math.max(0, x0 + i));
        const y = Math.min(this.height - 1, Math.max(0, y0 + j));
        const t = this.tile(x, y, false);
        if (!t) continue;
        const k = ((y & (TILE - 1)) * TILE + (x & (TILE - 1))) * 2;
        dx += t[k] * w;
        dy += t[k + 1] * w;
      }
    out.x = dx;
    out.y = dy;
  }
}

/**
 * One dab on the field: inside `rect`, each pixel now takes its colour from where the dab brings it
 * from, carried on through what the stroke did so far. Partly selected pixels move partly,
 * unselected ones not at all. Returns the part of the image before the stroke that the rectangle
 * needs (itself and where its colours come from) for warpPixels.
 */
export function warpDab(field: WarpField, d: LiquifyDab, rect: Rect, selection?: Mask | null): Rect {
  const next = new Float32Array(rect.w * rect.h * 2);
  const at = { x: 0, y: 0 };
  let x0 = rect.x;
  let y0 = rect.y;
  let x1 = rect.x + rect.w;
  let y1 = rect.y + rect.h;
  for (let y = 0; y < rect.h; y++)
    for (let x = 0; x < rect.w; x++) {
      const X = rect.x + x;
      const Y = rect.y + y;
      const px = X + 0.5;
      const py = Y + 0.5;
      const m = selection ? (X < selection.width && Y < selection.height ? selection.data[Y * selection.width + X] / 255 : 0) : 1;
      const f = m > 0 ? falloff(Math.hypot(px - d.x, py - d.y), d.radius, d.hardness) * m : 0;
      let dx: number;
      let dy: number;
      if (f <= 0) {
        field.get(X, Y, at);
        dx = at.x;
        dy = at.y;
      } else {
        const [sx, sy] = sourceOf(d, px, py, f);
        field.sample(sx, sy, at);
        dx = sx - px + at.x;
        dy = sy - py + at.y;
      }
      const k = (y * rect.w + x) * 2;
      next[k] = dx;
      next[k + 1] = dy;
      const sx = px + dx;
      const sy = py + dy;
      // With a pixel more round it for the bilinear samples.
      x0 = Math.min(x0, Math.floor(sx) - 1);
      y0 = Math.min(y0, Math.floor(sy) - 1);
      x1 = Math.max(x1, Math.ceil(sx) + 1);
      y1 = Math.max(y1, Math.ceil(sy) + 1);
    }
  for (let y = 0; y < rect.h; y++)
    for (let x = 0; x < rect.w; x++) {
      const k = (y * rect.w + x) * 2;
      field.set(rect.x + x, rect.y + y, next[k], next[k + 1]);
    }
  x0 = Math.max(0, x0);
  y0 = Math.max(0, y0);
  x1 = Math.min(field.width, x1);
  y1 = Math.min(field.height, y1);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/**
 * The pixels of `rect` (straight RGBA) through the field: the image before the stroke (`src`, which
 * covers what warpDab returned; outside it counts as transparent) sampled where each pixel's colour
 * now comes from.
 */
export function warpPixels(src: PixelArea, field: WarpField, rect: Rect, o: LiquifyOptions = { antiAlias: true }): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(rect.w * rect.h * 4);
  const sel = o.selection ?? null;
  const only = Boolean(o.onlyArea && sel);
  /** Whether document pixel (x, y) is selected (everything is without a selection). */
  const selected = (x: number, y: number) => !sel || (x >= 0 && y >= 0 && x < sel.width && y < sel.height && sel.data[y * sel.width + x] > 0);
  // Premultiplied colour (0..255) and alpha (0..1) of the last sample.
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  const sample = (sx: number, sy: number) => {
    r = g = b = a = 0;
    if (!o.antiAlias) {
      const xx = Math.floor(sx) - src.x;
      const yy = Math.floor(sy) - src.y;
      if (xx < 0 || yy < 0 || xx >= src.width || yy >= src.height) return;
      const p = (yy * src.width + xx) * 4;
      a = src.data[p + 3] / 255;
      r = src.data[p] * a;
      g = src.data[p + 1] * a;
      b = src.data[p + 2] * a;
      return;
    }
    // Bilinear (pixel centres at +0.5); with Only refer to editing area, pixels outside the selection do not count.
    const fx = sx - 0.5 - src.x;
    const fy = sy - 0.5 - src.y;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    let wsum = 0;
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 2; i++) {
        const xx = x0 + i;
        const yy = y0 + j;
        const w = (i ? tx : 1 - tx) * (j ? ty : 1 - ty);
        if (only && !selected(xx + src.x, yy + src.y)) continue;
        wsum += w;
        if (xx < 0 || yy < 0 || xx >= src.width || yy >= src.height) continue;
        const p = (yy * src.width + xx) * 4;
        const al = (src.data[p + 3] / 255) * w;
        r += src.data[p] * al;
        g += src.data[p + 1] * al;
        b += src.data[p + 2] * al;
        a += al;
      }
    if (wsum > 0 && wsum < 1) {
      r /= wsum;
      g /= wsum;
      b /= wsum;
      a /= wsum;
    }
  };
  const at = { x: 0, y: 0 };
  for (let y = 0; y < rect.h; y++)
    for (let x = 0; x < rect.w; x++) {
      const X = rect.x + x;
      const Y = rect.y + y;
      const o4 = (y * rect.w + x) * 4;
      const sx0 = X - src.x;
      const sy0 = Y - src.y;
      const inSrc = sx0 >= 0 && sy0 >= 0 && sx0 < src.width && sy0 < src.height;
      const p0 = (sy0 * src.width + sx0) * 4;
      field.get(X, Y, at);
      if (at.x === 0 && at.y === 0) {
        // Not moved: as it was.
        if (inSrc) out.set(src.data.subarray(p0, p0 + 4), o4);
        continue;
      }
      const px = X + 0.5;
      const py = Y + 0.5;
      let sx = px + at.x;
      let sy = py + at.y;
      if (only && !selected(Math.floor(sx), Math.floor(sy))) {
        // Take the colour from as far along the way as the selection reaches.
        let lo = 0;
        let hi = 1;
        for (let k = 0; k < 8; k++) {
          const t = (lo + hi) / 2;
          if (selected(Math.floor(px + at.x * t), Math.floor(py + at.y * t))) lo = t;
          else hi = t;
        }
        sx = px + at.x * lo;
        sy = py + at.y * lo;
      }
      sample(sx, sy);
      if (o.lockAlpha) {
        // The shape stays: the old alpha, the new colour where there is one.
        const oa = inSrc ? src.data[p0 + 3] : 0;
        out[o4 + 3] = oa;
        if (a > 0) {
          out[o4] = r / a;
          out[o4 + 1] = g / a;
          out[o4 + 2] = b / a;
        } else if (inSrc) {
          out[o4] = src.data[p0];
          out[o4 + 1] = src.data[p0 + 1];
          out[o4 + 2] = src.data[p0 + 2];
        }
        continue;
      }
      if (a > 0) {
        out[o4] = r / a;
        out[o4 + 1] = g / a;
        out[o4 + 2] = b / a;
        out[o4 + 3] = a * 255;
      }
    }
  return out;
}
