/**
 * Image material layers, like the reference's: an image (a material from the Material palette, or
 * one registered by the user) placed on the canvas. Its middle, scale and turn stay editable with
 * the Object tool without losing quality, and it can be tiled across the canvas – Repeat, Reverse
 * (every other copy turned round) or Flip (mirrored) – both ways, across or down. Pure, unit tested.
 */
import type { Id, Layer, PaintDocument } from '../model/types';
import { docLightImages } from './lightTable';

export type TilingMode = 'repeat' | 'reverse' | 'flip';
export type TilingDirection = 'both' | 'horizontal' | 'vertical';

export const TILING_MODES: [TilingMode, string][] = [
  ['repeat', 'Repeat'],
  ['reverse', 'Reverse'],
  ['flip', 'Flip'],
];

export const TILING_DIRECTIONS: [TilingDirection, string][] = [
  ['both', 'Vertical and horizontal'],
  ['horizontal', 'Horizontal'],
  ['vertical', 'Vertical'],
];

export interface ImagePlacement {
  /** The image: its pixels are kept with the document under this id and never change. */
  image: Id;
  /** Its size (px). */
  w: number;
  h: number;
  /** Where its middle lies on the canvas. */
  cx: number;
  cy: number;
  /** Scale across and down (negative: mirrored). */
  sx: number;
  sy: number;
  /** Turn (radians). */
  rotation: number;
  /** Tiling: off (null) or how the copies repeat. */
  tiling: TilingMode | null;
  tilingDirection: TilingDirection;
  /** Hard edges (nearest neighbour) instead of smooth ones when scaled. */
  hardEdges: boolean;
}

export interface Pt {
  x: number;
  y: number;
}

/** An affine map [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f. */
export type Affine = [number, number, number, number, number, number];

/** Image pixels → canvas. */
export function placementMatrix(p: ImagePlacement): Affine {
  const c = Math.cos(p.rotation);
  const s = Math.sin(p.rotation);
  const a = c * p.sx;
  const b = s * p.sx;
  const cc = -s * p.sy;
  const d = c * p.sy;
  return [a, b, cc, d, p.cx - (a * p.w) / 2 - (cc * p.h) / 2, p.cy - (b * p.w) / 2 - (d * p.h) / 2];
}

/** The placement under an affine map (Move layer, transforms, flips); a skew is left out. */
export function transformPlacement(p: ImagePlacement, m: Affine): ImagePlacement {
  const c = Math.cos(p.rotation);
  const s = Math.sin(p.rotation);
  const lin = (x: number, y: number): Pt => ({ x: m[0] * x + m[2] * y, y: m[1] * x + m[3] * y });
  // The image's axes as they are mapped.
  const ux = lin(c * p.sx, s * p.sx);
  const uy = lin(-s * p.sy, c * p.sy);
  const sx = Math.hypot(ux.x, ux.y);
  return {
    ...p,
    cx: m[0] * p.cx + m[2] * p.cy + m[4],
    cy: m[1] * p.cx + m[3] * p.cy + m[5],
    sx,
    // Down: what is left across the new x axis (negative when the map mirrors).
    sy: (ux.x * uy.y - ux.y * uy.x) / (sx || 1),
    rotation: Math.atan2(ux.y, ux.x),
  };
}

const apply = (m: Affine, x: number, y: number): Pt => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

/** The corners of the image (one copy) on the canvas. */
export function placementCorners(p: ImagePlacement): Pt[] {
  const m = placementMatrix(p);
  return [apply(m, 0, 0), apply(m, p.w, 0), apply(m, p.w, p.h), apply(m, 0, p.h)];
}

/** The box round the image (one copy). */
export function placementBounds(p: ImagePlacement): { x: number; y: number; w: number; h: number } {
  const pts = placementCorners(p);
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Where canvas point `q` lies in the image's pixels (null when the image has no size). */
export function toImage(p: ImagePlacement, q: Pt): Pt | null {
  const [a, b, c, d, e, f] = placementMatrix(p);
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return null;
  const x = q.x - e;
  const y = q.y - f;
  return { x: (d * x - c * y) / det, y: (-b * x + a * y) / det };
}

/** Whether canvas point `q` shows the image: inside it, or anywhere its tiles reach. */
export function hitPlacement(p: ImagePlacement, q: Pt, tolerance = 0): boolean {
  if (p.tiling && p.tilingDirection === 'both') return true;
  const u = toImage(p, q);
  if (!u) return false;
  const k = tolerance / Math.max(1e-6, Math.min(Math.abs(p.sx), Math.abs(p.sy)));
  const inX = u.x >= -k && u.x <= p.w + k;
  const inY = u.y >= -k && u.y <= p.h + k;
  if (p.tiling === null) return inX && inY;
  return p.tilingDirection === 'horizontal' ? inY : inX;
}

/**
 * Tiling: the copies form a block of `cols` × `rows` that repeats; `flip` says which copies in it
 * are mirrored across (x) and down (y). Reverse turns every other copy round, Flip mirrors them.
 */
export function tileBlock(mode: TilingMode, direction: TilingDirection): { cols: 1 | 2; rows: 1 | 2; flip: (col: number, row: number) => [boolean, boolean] } {
  const across = direction !== 'vertical';
  const down = direction !== 'horizontal';
  const cols = mode !== 'repeat' && across ? 2 : 1;
  const rows = mode !== 'repeat' && down ? 2 : 1;
  if (mode === 'repeat') return { cols: 1, rows: 1, flip: () => [false, false] };
  if (mode === 'reverse')
    return {
      cols,
      rows,
      flip: (col, row) => {
        const odd = ((across ? col : 0) + (down ? row : 0)) % 2 === 1;
        return [odd, odd];
      },
    };
  return { cols, rows, flip: (col, row) => [across && col % 2 === 1, down && row % 2 === 1] };
}

/**
 * A new placement of an image of w × h with its middle at (cx, cy) at `scale`, made smaller to
 * fit the canvas when it would not (tiled images keep their scale).
 */
export function placeImage(image: Id, w: number, h: number, cx: number, cy: number, scale: number, canvas: { w: number; h: number }, tiling: TilingMode | null = null): ImagePlacement {
  const fit = tiling ? 1 : Math.min(1, canvas.w / Math.max(1, w * scale), canvas.h / Math.max(1, h * scale));
  const k = scale * fit;
  return { image, w, h, cx, cy, sx: k, sy: k, rotation: 0, tiling, tilingDirection: 'both', hardEdges: false };
}

/** The images image material layers of a document show. */
export function docMaterialImages(doc: PaintDocument): Id[] {
  const ids = new Set<Id>();
  const walk = (layers: Layer[]) => {
    for (const l of layers) {
      if (l.kind === 'image') ids.add(l.placement.image);
      if (l.kind === 'folder') walk(l.children);
    }
  };
  walk(doc.layers);
  return [...ids];
}

/** Images kept with a document at their own size (light tables, image material layers). */
export const keptImages = (doc: PaintDocument): Id[] => [...new Set([...docLightImages(doc), ...docMaterialImages(doc)])];

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);

/** A placement from a file, every value checked; null when it is not one. */
export function sanitizePlacement(raw: unknown): ImagePlacement | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.image !== 'string' || !ID.test(r.image)) return null;
  const scale = (v: unknown) => {
    const s = num(v, 1, -1000, 1000);
    return Math.abs(s) < 1e-4 ? (s < 0 ? -1e-4 : 1e-4) : s;
  };
  return {
    image: r.image,
    w: Math.round(num(r.w, 1, 1, 16384)),
    h: Math.round(num(r.h, 1, 1, 16384)),
    cx: num(r.cx, 0, -1e6, 1e6),
    cy: num(r.cy, 0, -1e6, 1e6),
    sx: scale(r.sx),
    sy: scale(r.sy),
    rotation: num(r.rotation, 0, -100, 100),
    tiling: TILING_MODES.some(([m]) => m === r.tiling) ? (r.tiling as TilingMode) : null,
    tilingDirection: TILING_DIRECTIONS.some(([d]) => d === r.tilingDirection) ? (r.tilingDirection as TilingDirection) : 'both',
    hardEdges: r.hardEdges === true,
  };
}
