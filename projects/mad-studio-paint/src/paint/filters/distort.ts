/**
 * Filter > Distort. Each filter says, for every output pixel, where in the layer its colour comes
 * from; the layer is sampled bilinearly. Filters with a centre act inside an ellipse around the red
 * × on the canvas: half the selection (or canvas) size with "Entire selection", else Radius and
 * Shape. The curves are our own models of the documented settings.
 */
import { clamp, hash2, remap, type Img, type Rect } from './core';

export interface Ellipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export type AreaMode = 'selection' | 'specify';

/** The area a centred distortion works in. Shape > 0 narrows it horizontally, < 0 vertically. */
export function effectEllipse(cx: number, cy: number, bounds: Rect, area: AreaMode, radius: number, shape: number): Ellipse {
  if (area === 'selection') return { cx, cy, rx: Math.max(1, bounds.w / 2), ry: Math.max(1, bounds.h / 2) };
  const s = clamp(shape, -100, 100) / 100;
  const r = Math.max(1, radius);
  return { cx, cy, rx: r * (1 - Math.max(0, s) * 0.9), ry: r * (1 - Math.max(0, -s) * 0.9) };
}

/** Runs `radial` on points inside the ellipse with (u, v) normalised to the unit circle. */
function inEllipse(e: Ellipse, edgeOutside: boolean, radial: (u: number, v: number, r: number, out: Float64Array) => boolean) {
  return (x: number, y: number, pt: Float64Array): boolean => {
    const u = (x - e.cx) / e.rx;
    const v = (y - e.cy) / e.ry;
    const r = Math.hypot(u, v);
    if (r >= 1) {
      pt[0] = x;
      pt[1] = y;
      return edgeOutside;
    }
    if (!radial(u, v, r, pt)) return false;
    pt[0] = e.cx + pt[0] * e.rx;
    pt[1] = e.cy + pt[1] * e.ry;
    return true;
  };
}

/** Scales (u, v) to radius r2 (r is its current radius). */
function toRadius(u: number, v: number, r: number, r2: number, out: Float64Array): boolean {
  const k = r > 1e-9 ? r2 / r : 0;
  out[0] = u * k;
  out[1] = v * k;
  return true;
}

function rotate(u: number, v: number, a: number, out: Float64Array): boolean {
  const c = Math.cos(a);
  const s = Math.sin(a);
  out[0] = u * c - v * s;
  out[1] = u * s + v * c;
  return true;
}

/** Pinch: positive pulls the image towards the centre, negative pushes it out (r·sin(πr/2)^−a). */
export function pinch(src: Img, rect: Rect, e: Ellipse, strength: number): Img {
  // Below 1 the centre stays put (at a = 1 the middle would collapse into a point).
  const a = (clamp(strength, -100, 100) / 100) * 0.75;
  return remap(src, rect, 'clamp', inEllipse(e, true, (u, v, r, out) => toRadius(u, v, r, r === 0 ? 0 : r * Math.sin((Math.PI / 2) * r) ** -a, out)));
}

/** Ripple: a rotation that swings back and forth with the distance from the centre. */
export function ripple(src: Img, rect: Rect, e: Ellipse, rotation: number, waves: number): Img {
  const amp = (rotation * Math.PI) / 180;
  const n = Math.max(1, waves);
  return remap(src, rect, 'clamp', inEllipse(e, true, (u, v, r, out) => rotate(u, v, -amp * Math.sin(2 * Math.PI * n * r) * (1 - r), out)));
}

/** Twirl: rotation by `twist` degrees at the centre, fading to none at the edge; tension pulls it inwards. */
export function twirl(src: Img, rect: Rect, e: Ellipse, twist: number, tension: number): Img {
  const amp = (twist * Math.PI) / 180;
  const p = 1 + clamp(tension, 0, 100) / 25;
  return remap(src, rect, 'clamp', inEllipse(e, true, (u, v, r, out) => rotate(u, v, -amp * (1 - r) ** p, out)));
}

/** Fish-eye lens: the middle of the lens is magnified; outside the lens is transparent. */
export function fisheye(src: Img, rect: Rect, e: Ellipse, distortion: number): Img {
  const k = 1 + clamp(distortion, 0, 100) / 40;
  return remap(src, rect, 'clamp', inEllipse(e, false, (u, v, r, out) => toRadius(u, v, r, r ** k, out)));
}

/** Bulges towards the viewer (s > 0, centre magnified) or away (s < 0); 0..1 maps to 0..1. */
function bulge(t: number, s: number): number {
  const a = Math.abs(t);
  const f = s > 0 ? (2 / Math.PI) * Math.asin(Math.min(1, a)) : Math.sin((Math.PI / 2) * a);
  return Math.sign(t) * (a + Math.abs(s) * (f - a));
}

/**
 * Curved surface: the image as if on a cylinder (its axis at `angle` degrees, curving across it)
 * or a sphere. Positive strength bulges towards the viewer.
 */
export function curvedSurface(src: Img, rect: Rect, e: Ellipse, strength: number, sphere: boolean, angle: number): Img {
  const s = clamp(strength, -100, 100) / 100;
  if (sphere) return remap(src, rect, 'clamp', inEllipse(e, true, (u, v, r, out) => toRadius(u, v, r, bulge(r, s), out)));
  // Across the axis; the band is as wide as the ellipse in that direction.
  const a = ((angle + 90) * Math.PI) / 180;
  const ax = Math.cos(a);
  const ay = -Math.sin(a);
  const half = 1 / Math.hypot(ax / e.rx, ay / e.ry);
  return remap(src, rect, 'clamp', (x, y, pt) => {
    const dx = x - e.cx;
    const dy = y - e.cy;
    const t = (dx * ax + dy * ay) / half;
    pt[0] = x;
    pt[1] = y;
    if (Math.abs(t) >= 1) return true;
    const d = (bulge(t, s) - t) * half;
    pt[0] = x + ax * d;
    pt[1] = y + ay * d;
    return true;
  });
}

/**
 * Convert to panorama: the image as seen by a camera turning around the central axis (cylindrical
 * projection). Lines parallel to the axis stay straight; scale ratio (%) enlarges against gaps.
 */
export function panorama(src: Img, rect: Rect, cx: number, cy: number, bounds: Rect, distortion: number, angle: number, scale: number): Img {
  const fov = (clamp(distortion, 0, 100) / 100) * (Math.PI / 2) * 0.9;
  const zoom = Math.max(0.01, scale / 100);
  const a = (angle * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const half = Math.max(1, Math.abs(bounds.w * c) / 2 + Math.abs(bounds.h * s) / 2);
  return remap(src, rect, 'transparent', (x, y, pt) => {
    // Into the frame where the axis is vertical.
    const dx = (x - cx) / zoom;
    const dy = (y - cy) / zoom;
    const u = dx * c - dy * s;
    const v = dx * s + dy * c;
    let su = u;
    let sv = v;
    if (fov > 1e-4) {
      const th = (u / half) * fov;
      if (Math.abs(th) >= Math.PI / 2 - 1e-3) return false;
      su = (Math.tan(th) / Math.tan(fov)) * half;
      sv = v / Math.cos(th);
    }
    pt[0] = cx + su * c + sv * s;
    pt[1] = cy - su * s + sv * c;
    return true;
  });
}

/** Geometric distortion: barrel (positive, bulging out) or pincushion (negative); scale ratio in %. */
export function geometricDistortion(src: Img, rect: Rect, cx: number, cy: number, bounds: Rect, distortion: number, scale: number): Img {
  const k = (clamp(distortion, -100, 100) / 100) * 0.6;
  const zoom = Math.max(0.01, scale / 100);
  const norm = Math.max(1, Math.hypot(bounds.w, bounds.h) / 2);
  return remap(src, rect, 'transparent', (x, y, pt) => {
    const u = (x - cx) / norm;
    const v = (y - cy) / norm;
    const f = (1 + k * (u * u + v * v)) / zoom;
    pt[0] = cx + u * f * norm;
    pt[1] = cy + v * f * norm;
    return true;
  });
}

export type PolarMethod = 'rectToPolar' | 'polarToRect' | 'spherize';

/**
 * Polar coordinates over the selection (or canvas) rectangle: Rectangular to polar wraps the
 * rows around the centre (top row in the middle, angle clockwise from the top); Polar to
 * rectangular unwraps; Spherize wraps onto a sphere inside the inscribed circle.
 */
export function polarCoordinates(src: Img, rect: Rect, bounds: Rect, method: PolarMethod): Img {
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  const R = Math.max(1, Math.min(bounds.w, bounds.h) / 2);
  return remap(src, rect, method === 'spherize' ? 'transparent' : 'clamp', (x, y, pt) => {
    if (method === 'polarToRect') {
      const phi = ((x - bounds.x) / bounds.w) * 2 * Math.PI;
      const r = ((y - bounds.y) / bounds.h) * R;
      pt[0] = cx + r * Math.sin(phi);
      pt[1] = cy - r * Math.cos(phi);
      return true;
    }
    const dx = x - cx;
    const dy = y - cy;
    let r = Math.hypot(dx, dy) / R;
    if (method === 'spherize') {
      if (r >= 1) return false;
      r = Math.asin(r) / (Math.PI / 2);
    }
    const phi = (Math.atan2(dx, -dy) + 2 * Math.PI) % (2 * Math.PI);
    pt[0] = bounds.x + (phi / (2 * Math.PI)) * bounds.w;
    pt[1] = bounds.y + r * bounds.h;
    return true;
  });
}

/** ZigZag: the image swings sideways (along `angle`) in `waves` sine waves of `height` pixels. */
export function zigzag(src: Img, rect: Rect, bounds: Rect, angle: number, height: number, waves: number): Img {
  const a = (angle * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = -Math.sin(a);
  // The waves follow each other across the swing direction.
  const nx = -dy;
  const ny = dx;
  const len = Math.max(1, Math.abs(bounds.w * nx) + Math.abs(bounds.h * ny));
  const k = (2 * Math.PI * Math.max(0, waves)) / len;
  return remap(src, rect, 'clamp', (x, y, pt) => {
    const t = (x - bounds.x) * nx + (y - bounds.y) * ny;
    const off = height * Math.sin(t * k);
    pt[0] = x - dx * off;
    pt[1] = y - dy * off;
    return true;
  });
}

export type WaveShape = 'sine' | 'triangle' | 'square';

export interface WaveOptions {
  shape: WaveShape;
  generators: number;
  wavelengthMin: number;
  wavelengthMax: number;
  amplitudeMin: number;
  amplitudeMax: number;
  horizontal: number;
  vertical: number;
  wrap: boolean;
  seed: number;
}

const waveFn = (shape: WaveShape, t: number) => {
  if (shape === 'sine') return Math.sin(t);
  const f = (((t / (2 * Math.PI)) % 1) + 1) % 1;
  if (shape === 'square') return f < 0.5 ? 1 : -1;
  return f < 0.25 ? f * 4 : f < 0.75 ? 2 - f * 4 : f * 4 - 4;
};

/**
 * Wave: several wave generators with random wavelengths and amplitudes between the minimum and
 * maximum (Regenerate picks new ones); horizontal / vertical ratio scale the swing in %.
 */
export function wave(src: Img, rect: Rect, o: WaveOptions): Img {
  const n = clamp(Math.round(o.generators), 1, 99);
  const lMin = Math.max(1, Math.min(o.wavelengthMin, o.wavelengthMax));
  const lMax = Math.max(lMin, o.wavelengthMax);
  const aMin = Math.max(0, Math.min(o.amplitudeMin, o.amplitudeMax));
  const aMax = Math.max(aMin, o.amplitudeMax);
  const gens = Array.from({ length: n }, (_, i) => {
    const r = (k: number) => hash2(i, k, o.seed);
    return {
      lx: lMin + (lMax - lMin) * r(1),
      ax: aMin + (aMax - aMin) * r(2),
      px: r(3) * 2 * Math.PI,
      ly: lMin + (lMax - lMin) * r(4),
      ay: aMin + (aMax - aMin) * r(5),
      py: r(6) * 2 * Math.PI,
    };
  });
  const hx = clamp(o.horizontal, 0, 100) / 100 / n;
  const vy = clamp(o.vertical, 0, 100) / 100 / n;
  return remap(src, rect, o.wrap ? 'wrap' : 'clamp', (x, y, pt) => {
    let dx = 0;
    let dy = 0;
    for (const g of gens) {
      dx += g.ax * waveFn(o.shape, (2 * Math.PI * y) / g.lx + g.px);
      dy += g.ay * waveFn(o.shape, (2 * Math.PI * x) / g.ly + g.py);
    }
    pt[0] = x + dx * hx;
    pt[1] = y + dy * vy;
    return true;
  });
}
