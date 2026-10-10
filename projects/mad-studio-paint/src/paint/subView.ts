/**
 * Sub View palette: the zoom that fits a (turned) image into the palette, zoom steps, angles and
 * reordering the image list. The view itself uses the canvas's view transform (zoom, rotation,
 * flips, pan). Pure, unit tested.
 */
import type { Size } from './viewMath';

export const MIN_SUB_ZOOM = 0.01;
export const MAX_SUB_ZOOM = 32;
/** Rotate Left / Rotate Right turn by this many degrees. */
export const ROTATE_STEP = 5;

/** The zoom at which the image, turned by `rotation` degrees, fits into the box. */
export function fitZoom(img: Size, box: Size, rotation: number): number {
  const t = (rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(t));
  const s = Math.abs(Math.sin(t));
  const w = img.w * c + img.h * s;
  const h = img.w * s + img.h * c;
  if (w <= 0 || h <= 0 || box.w <= 0 || box.h <= 0) return 1;
  return clampZoom(Math.min(box.w / w, box.h / h));
}

export const clampZoom = (z: number) => Math.min(MAX_SUB_ZOOM, Math.max(MIN_SUB_ZOOM, z));

/** Zoom in / Zoom out: the next step of 1, 1.25, 1.5, 2, 3, 5, 7 × powers of ten. */
export function zoomStep(z: number, dir: 1 | -1): number {
  const ladder: number[] = [];
  for (let e = -2; e <= 2; e++) for (const m of [1, 1.25, 1.5, 2, 3, 5, 7]) ladder.push(Number((m * 10 ** e).toPrecision(6)));
  const steps = ladder.filter((x) => x >= MIN_SUB_ZOOM && x <= MAX_SUB_ZOOM);
  const next = dir > 0 ? steps.find((x) => x > z * 1.001) : [...steps].reverse().find((x) => x < z / 1.001);
  return next ?? (dir > 0 ? MAX_SUB_ZOOM : MIN_SUB_ZOOM);
}

/** An angle in -180 … 180. */
export const wrapAngle = (deg: number) => {
  const a = ((((deg + 180) % 360) + 360) % 360) - 180;
  return a === -180 && deg > 0 ? 180 : a;
};

/** The image list: moves the item at `from` to `to`. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return list;
  const out = [...list];
  const [item] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, item);
  return out;
}
