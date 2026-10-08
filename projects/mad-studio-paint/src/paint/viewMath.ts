/** Canvas view transform: document pixels ↔ viewport CSS pixels. Pure, unit tested. */

export interface ViewTransformInput {
  zoom: number;
  /** Degrees, clockwise on screen. */
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  /** Document centre offset from the viewport centre. */
  panX: number;
  panY: number;
}

export interface Size {
  w: number;
  h: number;
}

/** Affine matrix [a, b, c, d, e, f] as used by CanvasRenderingContext2D.setTransform. */
export type Matrix = [number, number, number, number, number, number];

export function viewMatrix(v: ViewTransformInput, viewport: Size, doc: Size): Matrix {
  const t = (v.rotation * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const sx = v.zoom * (v.flipH ? -1 : 1);
  const sy = v.zoom * (v.flipV ? -1 : 1);
  // M = Translate(centre + pan) · Rotate(t) · Scale(sx, sy) · Translate(-doc/2)
  const a = cos * sx;
  const b = sin * sx;
  const c = -sin * sy;
  const d = cos * sy;
  const cx = viewport.w / 2 + v.panX;
  const cy = viewport.h / 2 + v.panY;
  const e = cx - (a * doc.w) / 2 - (c * doc.h) / 2;
  const f = cy - (b * doc.w) / 2 - (d * doc.h) / 2;
  return [a, b, c, d, e, f];
}

export function apply(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

export function invert(m: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** Rotates the pan vector so that rotation happens around the viewport centre. */
export function rotatePan(panX: number, panY: number, deltaDeg: number): { panX: number; panY: number } {
  const t = (deltaDeg * Math.PI) / 180;
  return { panX: panX * Math.cos(t) - panY * Math.sin(t), panY: panX * Math.sin(t) + panY * Math.cos(t) };
}

/** Normalises an angle to (-180, 180]. */
export function normalizeAngle(deg: number): number {
  let r = deg % 360;
  if (r <= -180) r += 360;
  if (r > 180) r -= 360;
  return r;
}
