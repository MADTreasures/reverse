/** Selection masks: one byte per pixel, 0 = unselected, 255 = selected. Pure, unit tested. */
import type { Rect } from './rect';

export type SelectionOp = 'replace' | 'add' | 'subtract' | 'intersect';

export interface Mask {
  width: number;
  height: number;
  data: Uint8Array;
}

export const createMask = (width: number, height: number): Mask => ({ width, height, data: new Uint8Array(width * height) });

export function rectMask(width: number, height: number, r: Rect): Mask {
  const m = createMask(width, height);
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(width, r.x + r.w);
  const y1 = Math.min(height, r.y + r.h);
  for (let y = y0; y < y1; y++) m.data.fill(255, y * width + x0, y * width + Math.max(x0, x1));
  return m;
}

export function ellipseMask(width: number, height: number, r: Rect): Mask {
  const m = createMask(width, height);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const rx = r.w / 2;
  const ry = r.h / 2;
  if (rx <= 0 || ry <= 0) return m;
  for (let y = Math.max(0, Math.floor(r.y)); y < Math.min(height, Math.ceil(r.y + r.h)); y++) {
    const dy = (y + 0.5 - cy) / ry;
    if (Math.abs(dy) > 1) continue;
    const half = rx * Math.sqrt(1 - dy * dy);
    const x0 = Math.max(0, Math.round(cx - half));
    const x1 = Math.min(width, Math.round(cx + half));
    if (x1 > x0) m.data.fill(255, y * width + x0, y * width + x1);
  }
  return m;
}

/** Even-odd scanline fill of a polygon (lasso), sampled at pixel centres. */
export function polygonMask(width: number, height: number, pts: { x: number; y: number }[]): Mask {
  const m = createMask(width, height);
  if (pts.length < 3) return m;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const xs: number[] = [];
  for (let y = Math.max(0, Math.floor(minY)); y < Math.min(height, Math.ceil(maxY)); y++) {
    const sy = y + 0.5;
    xs.length = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i];
      const b = pts[j];
      if (a.y > sy !== b.y > sy) xs.push(a.x + ((sy - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.round(xs[k]));
      const x1 = Math.min(width, Math.round(xs[k + 1]));
      if (x1 > x0) m.data.fill(255, y * width + x0, y * width + x1);
    }
  }
  return m;
}

/** Combines `shape` into `base` (null base = nothing selected). Returns a new mask. */
export function combine(base: Mask | null, shape: Mask, op: SelectionOp): Mask {
  if (op === 'replace' || (!base && op !== 'intersect')) {
    return op === 'subtract' ? createMask(shape.width, shape.height) : { ...shape, data: shape.data.slice() };
  }
  const out = createMask(shape.width, shape.height);
  const a = base ? base.data : new Uint8Array(shape.data.length);
  const b = shape.data;
  for (let i = 0; i < b.length; i++) {
    out.data[i] = op === 'add' ? Math.max(a[i], b[i]) : op === 'subtract' ? Math.min(a[i], 255 - b[i]) : Math.min(a[i], b[i]);
  }
  return out;
}

export function invertMask(m: Mask): Mask {
  const out = createMask(m.width, m.height);
  for (let i = 0; i < m.data.length; i++) out.data[i] = 255 - m.data[i];
  return out;
}

/** Bounding box of selected pixels, or null if the mask is empty. */
/** True when the mask covers the point (at least half). */
export function isSelected(m: Mask, p: { x: number; y: number }): boolean {
  const x = Math.floor(p.x);
  const y = Math.floor(p.y);
  return x >= 0 && y >= 0 && x < m.width && y < m.height && m.data[y * m.width + x] >= 128;
}

export function maskBounds(m: Mask): Rect | null {
  let x0 = m.width;
  let y0 = m.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < m.height; y++) {
    const row = y * m.width;
    let first = -1;
    let last = -1;
    for (let x = 0; x < m.width; x++) {
      if (m.data[row + x]) {
        if (first < 0) first = x;
        last = x;
      }
    }
    if (first >= 0) {
      x0 = Math.min(x0, first);
      x1 = Math.max(x1, last);
      y0 = Math.min(y0, y);
      y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Grows (positive) or shrinks (negative) the selected area by `radius` pixels (square kernel, two passes). */
export function expandMask(m: Mask, radius: number): Mask {
  if (radius === 0) return { ...m, data: m.data.slice() };
  const grow = radius > 0;
  const r = Math.abs(Math.round(radius));
  const { width: w, height: h } = m;
  const pick = grow ? Math.max : Math.min;
  const tmp = new Uint8Array(w * h);
  // Horizontal pass, then vertical: separable max/min filter.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = m.data[y * w + x];
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) v = pick(v, m.data[y * w + k]);
      // Pixels outside the canvas count as unselected when shrinking.
      if (!grow && (x - r < 0 || x + r >= w)) v = 0;
      tmp[y * w + x] = v;
    }
  }
  const out = createMask(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = tmp[y * w + x];
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) v = pick(v, tmp[k * w + x]);
      if (!grow && (y - r < 0 || y + r >= h)) v = 0;
      out.data[y * w + x] = v;
    }
  }
  return out;
}

export function isMaskEmpty(m: Mask | null): boolean {
  if (!m) return true;
  for (let i = 0; i < m.data.length; i++) if (m.data[i]) return false;
  return true;
}

/**
 * Boundary of the selection as line segments between selected and unselected pixels,
 * merged into horizontal/vertical runs. Used to draw "marching ants".
 * Each segment is [x0, y0, x1, y1] in document pixels.
 */
export function maskOutline(m: Mask): number[] {
  const { width: w, height: h, data } = m;
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? data[y * w + x] >= 128 : false);
  const segs: number[] = [];
  // Horizontal edges between row y-1 and y.
  for (let y = 0; y <= h; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const edge = x < w && at(x, y - 1) !== at(x, y);
      if (edge && start < 0) start = x;
      if (!edge && start >= 0) {
        segs.push(start, y, x, y);
        start = -1;
      }
    }
  }
  // Vertical edges between column x-1 and x.
  for (let x = 0; x <= w; x++) {
    let start = -1;
    for (let y = 0; y <= h; y++) {
      const edge = y < h && at(x - 1, y) !== at(x, y);
      if (edge && start < 0) start = y;
      if (!edge && start >= 0) {
        segs.push(x, start, x, y);
        start = -1;
      }
    }
  }
  return segs;
}

/** Moves the selection by whole pixels; parts moved outside the canvas are dropped. */
export function translateMask(m: Mask, dx: number, dy: number): Mask {
  const out = createMask(m.width, m.height);
  for (let y = 0; y < m.height; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= m.height) continue;
    const x0 = Math.max(0, -dx);
    const x1 = Math.min(m.width, m.width - dx);
    if (x1 > x0) out.data.set(m.data.subarray(y * m.width + x0, y * m.width + x1), ty * m.width + x0 + dx);
  }
  return out;
}
