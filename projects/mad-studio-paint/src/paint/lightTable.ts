/**
 * Light table: reference layers and images shown under the cel being drawn (Animation cels palette).
 * A cel-specific light table belongs to a cel; the general light table shows for every cel. Each light
 * table layer shows another layer or an imported image, recoloured (colour, half colour, monochrome),
 * faded and placed with the Light table tool (moved, scaled, rotated, flipped) without changing what
 * it shows. Only the display shows them. Pure, unit tested.
 */
import type { Id, Layer, PaintDocument } from '../model/types';
import { type OnionMode } from './animation';
import { placementMatrix, type Placement } from './keyframes';
import type { Affine } from './rulers';

export type LightSource = { kind: 'layer'; layer: Id } | { kind: 'image'; image: Id; name: string; w: number; h: number };

export interface LightLayer {
  id: string;
  source: LightSource;
  /** Color: as drawn; Half color: mixed with `color`; Monochrome: in `color`. */
  mode: OnionMode;
  color: string;
  /** 0..1 */
  opacity: number;
  /** Light table tool: movement (px), scale, rotation (degrees) about the middle of the canvas, flips. */
  x: number;
  y: number;
  scale: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

/** The canvas's light table: its general light table layers (cel-specific ones live on their cels). */
export interface LightTable {
  general: LightLayer[];
}

let counter = 0;
export const newLightId = () => `lt${Date.now().toString(36)}${(counter++).toString(36)}`;

/** A new light table layer: as it is, half colour in the onion skin's colour for earlier cels. */
export function newLightLayer(source: LightSource, color = '#2f6bff'): LightLayer {
  return { id: newLightId(), source, mode: 'color', color, opacity: 0.5, x: 0, y: 0, scale: 1, rotation: 0, flipH: false, flipV: false };
}

/** The light table tool's placement of a layer (centre of rotation: the middle of the canvas). */
export function lightPlacement(l: LightLayer, width: number, height: number): Placement {
  return {
    x: l.x,
    y: l.y,
    scaleX: l.scale * (l.flipH ? -1 : 1),
    scaleY: l.scale * (l.flipV ? -1 : 1),
    rotation: l.rotation,
    pivotX: width / 2,
    pivotY: height / 2,
    opacity: l.opacity,
  };
}

/** Back from a placement (the Light table tool scales evenly; flips stay). */
export function fromPlacement(l: LightLayer, p: Placement): LightLayer {
  return { ...l, x: p.x, y: p.y, scale: Math.max(0.01, Math.min(100, Math.abs(p.scaleX))), rotation: p.rotation };
}

/**
 * Where the source is drawn: a layer covers the canvas, an image is centred on it (the reference
 * centres registered files in the output frame).
 */
export function sourceRect(l: LightLayer, width: number, height: number): { x: number; y: number; w: number; h: number } {
  return l.source.kind === 'image' ? { x: (width - l.source.w) / 2, y: (height - l.source.h) / 2, w: l.source.w, h: l.source.h } : { x: 0, y: 0, w: width, h: height };
}

/** Source → canvas: the source rectangle, then the placement. */
export function lightMatrix(l: LightLayer, width: number, height: number): Affine {
  const m = placementMatrix(lightPlacement(l, width, height));
  const r = sourceRect(l, width, height);
  return [m[0], m[1], m[2], m[3], m[0] * r.x + m[2] * r.y + m[4], m[1] * r.x + m[3] * r.y + m[5]];
}

/** Reset position of layers on light table. */
export const resetLight = (l: LightLayer): LightLayer => ({ ...l, x: 0, y: 0, scale: 1, rotation: 0, flipH: false, flipV: false });

/** Every image the light tables show (for saving them with the document). */
export function lightImages(general: LightLayer[], perCel: LightLayer[][]): Id[] {
  const ids = new Set<Id>();
  for (const l of [...general, ...perCel.flat()]) if (l.source.kind === 'image') ids.add(l.source.image);
  return [...ids];
}

/** Every image the light tables of a document show (their pixels are kept like layer pixels). */
export function docLightImages(doc: PaintDocument): Id[] {
  const perCel: LightLayer[][] = [];
  const walk = (layers: Layer[]) => {
    for (const l of layers) {
      if (l.lightTable) perCel.push(l.lightTable);
      if (l.kind === 'folder') walk(l.children);
    }
  };
  walk(doc.layers);
  return lightImages(doc.lightTable?.general ?? [], perCel);
}

// ------------------------------------------------------------------ files

const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function sanitizeLightLayer(raw: unknown): LightLayer | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const s = (r.source && typeof r.source === 'object' ? r.source : {}) as Record<string, unknown>;
  let source: LightSource;
  if (s.kind === 'layer' && typeof s.layer === 'string' && ID.test(s.layer)) source = { kind: 'layer', layer: s.layer };
  else if (s.kind === 'image' && typeof s.image === 'string' && ID.test(s.image))
    source = { kind: 'image', image: s.image, name: typeof s.name === 'string' ? s.name.slice(0, 120) : 'Image', w: Math.round(num(s.w, 1, 1, 16384)), h: Math.round(num(s.h, 1, 1, 16384)) };
  else return null;
  return {
    id: typeof r.id === 'string' && ID.test(r.id) ? r.id : newLightId(),
    source,
    mode: r.mode === 'half' || r.mode === 'mono' ? r.mode : 'color',
    color: typeof r.color === 'string' && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color.toLowerCase() : '#2f6bff',
    opacity: num(r.opacity, 0.5, 0, 1),
    x: num(r.x, 0, -1e6, 1e6),
    y: num(r.y, 0, -1e6, 1e6),
    scale: num(r.scale, 1, 0.01, 100),
    rotation: num(r.rotation, 0, -36000, 36000),
    flipH: r.flipH === true,
    flipV: r.flipV === true,
  };
}

export function sanitizeLightLayers(raw: unknown): LightLayer[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const list = raw.slice(0, 100).map(sanitizeLightLayer).filter((l): l is LightLayer => l !== null);
  return list.length ? list : undefined;
}
