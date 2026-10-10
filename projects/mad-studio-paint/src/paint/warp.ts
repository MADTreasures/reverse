/**
 * Geometry and resampling of Edit > Transform. The transformed box is four corners: a projective
 * map of the original rectangle (an affine one while the corners form a parallelogram). Mesh
 * transformation moves a lattice of points; the image follows a smooth Catmull-Rom surface
 * through them. Drawing through either uses the reference's interpolation methods.
 */
import { premultiply, sample, unpremultiply, type Float, type Img, type Rect } from './filters/core';

export interface Pt {
  x: number;
  y: number;
}

/** Corners in the order top left, top right, bottom right, bottom left. */
export type Quad = [Pt, Pt, Pt, Pt];

/** Row-major 3 × 3 matrix acting on (x, y, 1). */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export type Interpolation = 'bilinear' | 'nearest' | 'bicubic' | 'average';

/** In the reference's order and wording. */
export const INTERPOLATIONS: [Interpolation, string][] = [
  ['bilinear', 'Smooth edges (bilinear)'],
  ['nearest', 'Hard edges (nearest neighbor)'],
  ['bicubic', 'Clear edges (bicubic)'],
  ['average', 'High accuracy (average colors)'],
];

export function applyH(m: Mat3, x: number, y: number): Pt {
  const w = m[6] * x + m[7] * y + m[8];
  return { x: (m[0] * x + m[1] * y + m[2]) / w, y: (m[3] * x + m[4] * y + m[5]) / w };
}

export function mulH(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}

export function invertH(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const k = det === 0 ? 0 : 1 / det;
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
}

/** The projective map of the rectangle 0..w × 0..h onto `q` (Heckbert's square-to-quad). */
export function quadHomography(w: number, h: number, q: Quad): Mat3 {
  const [p0, p1, p2, p3] = q;
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  let s: Mat3;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    s = [p1.x - p0.x, p3.x - p0.x, p0.x, p1.y - p0.y, p3.y - p0.y, p0.y, 0, 0, 1];
  } else {
    const dx1 = p1.x - p2.x;
    const dx2 = p3.x - p2.x;
    const dy1 = p1.y - p2.y;
    const dy2 = p3.y - p2.y;
    const den = dx1 * dy2 - dx2 * dy1 || 1e-12;
    const g = (sx * dy2 - dx2 * sy) / den;
    const hh = (dx1 * sy - sx * dy1) / den;
    s = [p1.x - p0.x + g * p1.x, p3.x - p0.x + hh * p3.x, p0.x, p1.y - p0.y + g * p1.y, p3.y - p0.y + hh * p3.y, p0.y, g, hh, 1];
  }
  return mulH(s, [1 / w, 0, 0, 0, 1 / h, 0, 0, 0, 1]);
}

export const boxQuad = (r: Rect): Quad => [
  { x: r.x, y: r.y },
  { x: r.x + r.w, y: r.y },
  { x: r.x + r.w, y: r.y + r.h },
  { x: r.x, y: r.y + r.h },
];

/** True while the corners form a parallelogram (the map is affine). */
export function isParallelogram(q: Quad, eps = 1e-6): boolean {
  const scale = Math.max(1, ...q.map((p) => Math.abs(p.x) + Math.abs(p.y)));
  return Math.abs(q[0].x + q[2].x - q[1].x - q[3].x) <= eps * scale && Math.abs(q[0].y + q[2].y - q[1].y - q[3].y) <= eps * scale;
}

/** A quad with no corner crossing over (convex, same winding all round). */
export function isConvexQuad(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(z) < 1e-9) return false;
    const s = Math.sign(z);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** The affine map local → document of a parallelogram quad, as [a, b, c, d, e, f] (canvas order). */
export function quadAffine(w: number, h: number, q: Quad): [number, number, number, number, number, number] {
  const [p0, p1, , p3] = q;
  return [(p1.x - p0.x) / w, (p1.y - p0.y) / w, (p3.x - p0.x) / h, (p3.y - p0.y) / h, p0.x, p0.y];
}

// ------------------------------------------------------------------ mesh

/** Lattice points (cols × rows, row by row) in document coordinates. */
export interface Mesh {
  cols: number;
  rows: number;
  pts: Pt[];
}

/** A lattice laid over the rectangle 0..w × 0..h and placed by `map`. */
export function meshFrom(w: number, h: number, cols: number, rows: number, map: (x: number, y: number) => Pt): Mesh {
  const pts: Pt[] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) pts.push(map((i / (cols - 1)) * w, (j / (rows - 1)) * h));
  return { cols, rows, pts };
}

const cr = (t: number): [number, number, number, number] => {
  const t2 = t * t;
  const t3 = t2 * t;
  return [(-t3 + 2 * t2 - t) / 2, (3 * t3 - 5 * t2 + 2) / 2, (-3 * t3 + 4 * t2 + t) / 2, (t3 - t2) / 2];
};

/** Lattice point (i, j); outside the lattice it continues in a straight line. */
function latticeAt(m: Mesh, i: number, j: number): Pt {
  const ci = Math.min(m.cols - 1, Math.max(0, i));
  const cj = Math.min(m.rows - 1, Math.max(0, j));
  if (ci === i && cj === j) return m.pts[j * m.cols + i];
  // Reflect linearly: P(-1) = 2·P(0) − P(1).
  const inner = latticeAt(m, i < 0 ? Math.min(m.cols - 1, 1) : i >= m.cols ? Math.max(0, m.cols - 2) : i, j < 0 ? Math.min(m.rows - 1, 1) : j >= m.rows ? Math.max(0, m.rows - 2) : j);
  const edge = latticeAt(m, ci, cj);
  const di = i !== ci ? 1 : 0;
  const dj = j !== cj ? 1 : 0;
  if (di && dj) {
    // Corner beyond both edges: extrapolate along both.
    const a = latticeAt(m, i, cj);
    const b = latticeAt(m, ci, j);
    return { x: a.x + b.x - edge.x, y: a.y + b.y - edge.y };
  }
  return { x: 2 * edge.x - inner.x, y: 2 * edge.y - inner.y };
}

/** Where the local point (x, y) of the w × h box lands on the mesh surface. */
export function meshPoint(m: Mesh, w: number, h: number, x: number, y: number): Pt {
  const u = (x / w) * (m.cols - 1);
  const v = (y / h) * (m.rows - 1);
  const i = Math.min(m.cols - 2, Math.max(0, Math.floor(u)));
  const j = Math.min(m.rows - 2, Math.max(0, Math.floor(v)));
  const wu = cr(u - i);
  const wv = cr(v - j);
  let px = 0;
  let py = 0;
  for (let b = 0; b < 4; b++) {
    for (let a = 0; a < 4; a++) {
      const k = wu[a] * wv[b];
      if (k === 0) continue;
      const p = latticeAt(m, i - 1 + a, j - 1 + b);
      px += p.x * k;
      py += p.y * k;
    }
  }
  return { x: px, y: py };
}

/** The outline of the mesh (its border lattice points, clockwise from the top left). */
export function meshOutline(m: Mesh): Pt[] {
  const at = (i: number, j: number) => m.pts[j * m.cols + i];
  const out: Pt[] = [];
  for (let i = 0; i < m.cols; i++) out.push(at(i, 0));
  for (let j = 1; j < m.rows; j++) out.push(at(m.cols - 1, j));
  for (let i = m.cols - 2; i >= 0; i--) out.push(at(i, m.rows - 1));
  for (let j = m.rows - 2; j > 0; j--) out.push(at(0, j));
  return out;
}

// ------------------------------------------------------------------ resampling

/** Catmull-Rom bicubic sample (premultiplied), transparent outside the image. */
function sampleBicubic(src: Float, x: number, y: number, out: Float32Array, o: number): void {
  const fx = x - 0.5;
  const fy = y - 0.5;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  if (ix < -2 || iy < -2 || ix > src.w || iy > src.h) {
    out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
    return;
  }
  const wx = cr(fx - ix);
  const wy = cr(fy - iy);
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (let j = 0; j < 4; j++) {
    const yy = iy - 1 + j;
    if (yy < 0 || yy >= src.h) continue;
    for (let i = 0; i < 4; i++) {
      const xx = ix - 1 + i;
      if (xx < 0 || xx >= src.w) continue;
      const k = wx[i] * wy[j];
      const p = (yy * src.w + xx) * 4;
      r += src.f[p] * k;
      g += src.f[p + 1] * k;
      b += src.f[p + 2] * k;
      a += src.f[p + 3] * k;
    }
  }
  // Overshoot stays within valid premultiplied values.
  a = Math.min(255, Math.max(0, a));
  out[o] = Math.min(a, Math.max(0, r));
  out[o + 1] = Math.min(a, Math.max(0, g));
  out[o + 2] = Math.min(a, Math.max(0, b));
  out[o + 3] = a;
}

function sampleWith(src: Float, x: number, y: number, interp: Interpolation, out: Float32Array, o: number): void {
  if (interp === 'nearest') {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= src.w || iy >= src.h) {
      out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
      return;
    }
    const p = (iy * src.w + ix) * 4;
    out[o] = src.f[p];
    out[o + 1] = src.f[p + 1];
    out[o + 2] = src.f[p + 2];
    out[o + 3] = src.f[p + 3];
  } else if (interp === 'bicubic') sampleBicubic(src, x, y, out, o);
  else sample(src, x, y, 'transparent', out, o);
}

/**
 * Draws `src` (the lifted pixels; local coordinates 0..w × 0..h) into the document rectangle
 * `out`: `toLocal` says where each output pixel centre comes from (false = nothing there).
 * "High accuracy" averages 3 × 3 samples per pixel.
 */
export function warpInverse(src: Img, out: Rect, interp: Interpolation, toLocal: (x: number, y: number, pt: Float64Array) => boolean): Img {
  const pre = premultiply(src);
  const res: Float = { f: new Float32Array(out.w * out.h * 4), w: out.w, h: out.h };
  const pt = new Float64Array(2);
  const tmp = new Float32Array(4);
  const acc = new Float32Array(4);
  const offsets = interp === 'average' ? [-1 / 3, 0, 1 / 3] : [0];
  const n = offsets.length * offsets.length;
  const base = interp === 'average' ? 'bilinear' : interp;
  for (let y = 0; y < out.h; y++) {
    for (let x = 0; x < out.w; x++) {
      const o = (y * out.w + x) * 4;
      if (n === 1) {
        if (toLocal(out.x + x + 0.5, out.y + y + 0.5, pt)) sampleWith(pre, pt[0], pt[1], base, res.f, o);
        continue;
      }
      acc.fill(0);
      for (const oy of offsets) {
        for (const ox of offsets) {
          if (!toLocal(out.x + x + 0.5 + ox, out.y + y + 0.5 + oy, pt)) continue;
          sampleWith(pre, pt[0], pt[1], base, tmp, 0);
          acc[0] += tmp[0];
          acc[1] += tmp[1];
          acc[2] += tmp[2];
          acc[3] += tmp[3];
        }
      }
      for (let c = 0; c < 4; c++) res.f[o + c] = acc[c] / n;
    }
  }
  return unpremultiply(res);
}

/** `src` drawn through the projective map `H` (local → document) into `out`. */
export function warpProjective(src: Img, H: Mat3, out: Rect, interp: Interpolation): Img {
  const inv = invertH(H);
  return warpInverse(src, out, interp, (x, y, pt) => {
    const w = inv[6] * x + inv[7] * y + inv[8];
    if (w <= 1e-12) return false;
    pt[0] = (inv[0] * x + inv[1] * y + inv[2]) / w;
    pt[1] = (inv[3] * x + inv[4] * y + inv[5]) / w;
    return true;
  });
}

/** Fine triangles of a mesh: local and document positions of their corners. */
export function meshTriangles(m: Mesh, w: number, h: number, subdiv = 8): { local: Float64Array; doc: Float64Array } {
  const n = (m.cols - 1) * subdiv;
  const k = (m.rows - 1) * subdiv;
  const lp: number[] = [];
  const dp: Pt[] = [];
  for (let j = 0; j <= k; j++) {
    for (let i = 0; i <= n; i++) {
      const x = (i / n) * w;
      const y = (j / k) * h;
      lp.push(x, y);
      dp.push(meshPoint(m, w, h, x, y));
    }
  }
  const local: number[] = [];
  const doc: number[] = [];
  const idx = (i: number, j: number) => j * (n + 1) + i;
  const push = (a: number) => {
    local.push(lp[a * 2], lp[a * 2 + 1]);
    doc.push(dp[a].x, dp[a].y);
  };
  for (let j = 0; j < k; j++) {
    for (let i = 0; i < n; i++) {
      const a = idx(i, j);
      const b = idx(i + 1, j);
      const c = idx(i + 1, j + 1);
      const d = idx(i, j + 1);
      for (const t of [a, b, c, a, c, d]) push(t);
    }
  }
  return { local: Float64Array.from(local), doc: Float64Array.from(doc) };
}

/**
 * `src` drawn through a mesh into `out`: each fine triangle is filled with the part of the
 * source it covers (affine within the triangle), so the result follows the smooth surface.
 */
export function warpMesh(src: Img, m: Mesh, w: number, h: number, out: Rect, interp: Interpolation, subdiv = 8): Img {
  const { local, doc } = meshTriangles(m, w, h, subdiv);
  const pre = premultiply(src);
  const res: Float = { f: new Float32Array(out.w * out.h * 4), w: out.w, h: out.h };
  const base = interp === 'average' ? 'bicubic' : interp;
  for (let t = 0; t < doc.length; t += 6) {
    const x0 = doc[t];
    const y0 = doc[t + 1];
    const x1 = doc[t + 2];
    const y1 = doc[t + 3];
    const x2 = doc[t + 4];
    const y2 = doc[t + 5];
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-9) continue;
    const u0 = local[t];
    const v0 = local[t + 1];
    const u1 = local[t + 2];
    const v1 = local[t + 3];
    const u2 = local[t + 4];
    const v2 = local[t + 5];
    const minX = Math.max(out.x, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(out.x + out.w - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(out.y, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(out.y + out.h - 1, Math.ceil(Math.max(y0, y1, y2)));
    for (let py = minY; py <= maxY; py++) {
      const cy = py + 0.5;
      for (let px = minX; px <= maxX; px++) {
        const cx = px + 0.5;
        // Barycentric weights; a pixel on a shared edge goes to one triangle only.
        const b1 = ((cx - x0) * (y2 - y0) - (x2 - x0) * (cy - y0)) / area;
        const b2 = ((x1 - x0) * (cy - y0) - (cx - x0) * (y1 - y0)) / area;
        const b0 = 1 - b1 - b2;
        if (b0 < 0 || b1 < 0 || b2 < 0) continue;
        if ((b1 === 0 || b2 === 0 || b0 === 0) && !ownsEdge(b0, b1, b2)) continue;
        const lu = u0 * b0 + u1 * b1 + u2 * b2;
        const lv = v0 * b0 + v1 * b1 + v2 * b2;
        sampleWith(pre, lu, lv, base, res.f, ((py - out.y) * out.w + (px - out.x)) * 4);
      }
    }
  }
  return unpremultiply(res);
}

/** Tie-break for pixel centres exactly on an edge: keep those where the zero weight is b2 or b0 (deterministic). */
const ownsEdge = (b0: number, b1: number, b2: number) => !(b1 === 0 && b0 > 0 && b2 > 0);

/** Bounds of points, grown to whole pixels and kept inside w × h. */
export function pointsBounds(pts: Pt[], w: number, h: number): Rect | null {
  if (pts.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const x = Math.max(0, Math.floor(x0) - 1);
  const y = Math.max(0, Math.floor(y0) - 1);
  const r = Math.min(w, Math.ceil(x1) + 1);
  const b = Math.min(h, Math.ceil(y1) + 1);
  return r > x && b > y ? { x, y, w: r - x, h: b - y } : null;
}
