/** Brush-engine math shared by all painting tools. Pure functions, unit tested. */

export interface StrokePoint {
  x: number;
  y: number;
  /** 0..1; mice report 0.5 while a button is held and are mapped to 1 by the caller. */
  pressure: number;
  /** How far the pen leans: 0 upright … 1 lying flat (≤ 30° above the surface). */
  tilt?: number;
  /** Direction the pen leans, radians (0 = right, clockwise like canvas coordinates). */
  azimuth?: number;
}

export interface Dab extends StrokePoint {
  /** Direction of travel in radians (for oriented tips and textures). */
  angle: number;
}

/**
 * Places dabs between `from` and `to` every `spacing` pixels, continuing the distance left over
 * from the previous segment (`carry`). Returns the dabs and the new carry.
 * Pressure is interpolated linearly along the segment.
 */
export function interpolateDabs(
  from: StrokePoint,
  to: StrokePoint,
  spacing: number,
  carry: number,
): { dabs: Dab[]; carry: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const step = Math.max(0.25, spacing);
  const angle = Math.atan2(dy, dx);
  const dabs: Dab[] = [];
  let t = step - carry;
  if (dist === 0) return { dabs, carry };
  while (t <= dist) {
    const f = t / dist;
    const tilt = from.tilt !== undefined && to.tilt !== undefined ? from.tilt + (to.tilt - from.tilt) * f : to.tilt;
    dabs.push({ x: from.x + dx * f, y: from.y + dy * f, pressure: from.pressure + (to.pressure - from.pressure) * f, tilt, azimuth: to.azimuth, angle });
    t += step;
  }
  return { dabs, carry: dist - (t - step) };
}

/** Linear interpolation between a minimum fraction and 1. */
export const pressureCurve = (pressure: number, min: number, enabled: boolean): number =>
  enabled ? min + (1 - min) * Math.min(1, Math.max(0, pressure)) : 1;

/**
 * Stabilizer ("hand-shake correction"): a weighted moving average over the last `strength`
 * raw points. Strength 0 passes points through unchanged.
 */
export class Stabilizer {
  private window: StrokePoint[] = [];
  private last: StrokePoint | null = null;

  constructor(private strength: number) {}

  push(p: StrokePoint): StrokePoint {
    if (this.strength <= 0) return (this.last = p);
    this.window.push(p);
    const size = Math.max(1, Math.round(this.strength));
    while (this.window.length > size) this.window.shift();
    let sx = 0;
    let sy = 0;
    let sp = 0;
    let sw = 0;
    // Newer samples weigh more, so the line follows the pen with a gentle lag.
    this.window.forEach((q, i) => {
      const w = i + 1;
      sx += q.x * w;
      sy += q.y * w;
      sp += q.pressure * w;
      sw += w;
    });
    // Tilt is not averaged: it follows the pen directly.
    return (this.last = { x: sx / sw, y: sy / sw, pressure: sp / sw, tilt: p.tilt, azimuth: p.azimuth });
  }

  /** Points that close the lag between the smoothed line and the last raw point (pen-up). */
  finish(steps = 8): StrokePoint[] {
    const target = this.window[this.window.length - 1];
    const from = this.last;
    if (!target || !from || this.strength <= 0) return [];
    const out: StrokePoint[] = [];
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      out.push({ x: from.x + (target.x - from.x) * f, y: from.y + (target.y - from.y) * f, pressure: from.pressure + (target.pressure - from.pressure) * f });
    }
    return out;
  }
}

/** Snaps the end point of a straight line to multiples of 45° (Shift while dragging a figure). */
export function snapAngle(x0: number, y0: number, x1: number, y1: number, stepDeg = 45): { x: number; y: number } {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const step = (stepDeg * Math.PI) / 180;
  const a = Math.round(Math.atan2(y1 - y0, x1 - x0) / step) * step;
  return { x: x0 + Math.cos(a) * len, y: y0 + Math.sin(a) * len };
}

/** Points along an ellipse inscribed in the box (x0,y0)-(x1,y1), closed. */
export function ellipsePoints(x0: number, y0: number, x1: number, y1: number): StrokePoint[] {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = Math.abs(x1 - x0) / 2;
  const ry = Math.abs(y1 - y0) / 2;
  const n = Math.max(24, Math.ceil((Math.PI * (rx + ry)) / 4));
  const pts: StrokePoint[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry, pressure: 1 });
  }
  return pts;
}

export function rectPoints(x0: number, y0: number, x1: number, y1: number): StrokePoint[] {
  return [
    { x: x0, y: y0, pressure: 1 },
    { x: x1, y: y0, pressure: 1 },
    { x: x1, y: y1, pressure: 1 },
    { x: x0, y: y1, pressure: 1 },
    { x: x0, y: y0, pressure: 1 },
  ];
}

/**
 * Per-dab alpha so that one pass of a straight stroke reaches `density` at its centre,
 * independent of the dab spacing (about 1/spacing dabs overlap any point on the centre line).
 * Scattered dabs (spray) do not overlap systematically and use the density directly.
 */
export function dabAlpha(density: number, spacing: number, scattered: boolean): number {
  const d = Math.min(1, Math.max(0, density));
  if (scattered || d >= 1) return d;
  return 1 - Math.pow(1 - d, Math.max(0.01, Math.min(1, spacing)));
}

/** Number of samples the stabilizer averages for a stabilization level of 0..100. */
export const stabilizerWindow = (level: number): number => Math.round(Math.max(0, Math.min(100, level)) / 2);

/**
 * Pen tilt from pointer events: the altitude/azimuth angles when the browser has them, otherwise
 * from tiltX / tiltY (degrees). Returns how far the pen leans (0..1) and in which direction.
 */
export function penTilt(e: { tiltX?: number; tiltY?: number; altitudeAngle?: number; azimuthAngle?: number }): { tilt: number; azimuth: number } {
  let altitude: number;
  let azimuth: number;
  if (typeof e.altitudeAngle === 'number' && typeof e.azimuthAngle === 'number' && (e.tiltX || e.tiltY || e.altitudeAngle < Math.PI / 2)) {
    altitude = e.altitudeAngle;
    azimuth = e.azimuthAngle;
  } else {
    const tx = Math.tan(((e.tiltX ?? 0) * Math.PI) / 180);
    const ty = Math.tan(((e.tiltY ?? 0) * Math.PI) / 180);
    const len = Math.hypot(tx, ty);
    altitude = len === 0 ? Math.PI / 2 : Math.atan(1 / len);
    azimuth = len === 0 ? 0 : Math.atan2(ty, tx);
  }
  const flat = Math.PI / 6;
  const tilt = Math.min(1, Math.max(0, (Math.PI / 2 - altitude) / (Math.PI / 2 - flat)));
  return { tilt, azimuth };
}

/**
 * Starting and ending: size/density factor at distance `d` along a stroke of length `total`
 * (unknown while drawing: Infinity). Eases in over `start` px and out over the last `end` px.
 */
export function taperFactor(d: number, total: number, start: number, end: number): number {
  const ease = (t: number) => Math.sin((Math.min(1, Math.max(0, t)) * Math.PI) / 2);
  let f = 1;
  if (start > 0) f *= ease(d / start);
  if (end > 0 && Number.isFinite(total)) f *= ease((total - d) / end);
  return f;
}

/** Small fast PRNG (mulberry32) so a stroke can be redrawn identically (tapering at pen-up). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
