/**
 * Brush materials at run time: the built-in tips and paper textures (drawn when first used) and
 * the images the user imported (kept in local storage, compressed), as masks, coloured tip canvases
 * and texture height maps.
 */
import { unzlibSync, zlibSync } from 'fflate';
import { adjustHeights, BUILTIN_TEXTURES, BUILTIN_TIPS, imageToMask, textureMask, tipMask, type Mask, type MaterialInfo, type MaterialKind, type PaperSettings } from '../paint/materials';
import { createCanvas, ctx2d } from './canvas';

const STORAGE_KEY = 'mad-paint:materials';
/** Sizes of the built-in materials and the largest imported ones (px). */
const TIP_SIZE = 128;
const TEXTURE_SIZE = 256;
const MAX_IMPORT: Record<MaterialKind, number> = { tip: 256, texture: 512 };

interface Imported extends MaterialInfo {
  mask: Mask;
}

const masks = new Map<string, Mask | null>();
let imported: Imported[] = load();
const listeners = new Set<() => void>();
let version = 0;

function changed(): void {
  version++;
  for (const l of listeners) l();
}

// ------------------------------------------------------------------ storage

const toBase64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function load(): Imported[] {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 200).flatMap((m): Imported[] => {
      if (!m || typeof m !== 'object') return [];
      const r = m as Record<string, unknown>;
      const w = Number(r.w);
      const h = Number(r.h);
      if (typeof r.id !== 'string' || !/^img-[a-z0-9]{1,30}$/.test(r.id) || (r.kind !== 'tip' && r.kind !== 'texture') || typeof r.data !== 'string') return [];
      if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 1024 || h > 1024) return [];
      const data = unzlibSync(fromBase64(r.data));
      if (data.length !== w * h) return [];
      return [{ id: r.id, name: typeof r.name === 'string' ? r.name.slice(0, 60) : 'Image', kind: r.kind, mask: { w, h, data: new Uint8ClampedArray(data) } }];
    });
  } catch {
    return [];
  }
}

function save(): void {
  try {
    globalThis.localStorage?.setItem(
      STORAGE_KEY,
      JSON.stringify(imported.map((m) => ({ id: m.id, name: m.name, kind: m.kind, w: m.mask.w, h: m.mask.h, data: toBase64(zlibSync(new Uint8Array(m.mask.data.buffer, m.mask.data.byteOffset, m.mask.data.length), { level: 9 })) }))),
    );
  } catch {
    // Storage full or blocked: the material stays for this session.
  }
}

// ------------------------------------------------------------------ lookup

/** All tips or textures: the built-in ones, then the imported ones. */
export function materialList(kind: MaterialKind): MaterialInfo[] {
  return [...(kind === 'tip' ? BUILTIN_TIPS : BUILTIN_TEXTURES), ...imported.filter((m) => m.kind === kind).map(({ id, name, kind: k }) => ({ id, name, kind: k }))];
}

/** Listens for imported or deleted materials. */
export function subscribeMaterials(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Changes with every import or deletion (for React's useSyncExternalStore). */
export const materialsVersion = () => version;

/** The mask of a material (null when it is unknown, e.g. an image imported on another computer). */
export function materialMask(id: string, kind: MaterialKind): Mask | null {
  const key = `${kind}:${id}`;
  if (masks.has(key)) return masks.get(key)!;
  const own = imported.find((m) => m.id === id && m.kind === kind);
  const mask = own ? own.mask : kind === 'tip' ? tipMask(id, TIP_SIZE) : textureMask(id, TEXTURE_SIZE);
  masks.set(key, mask);
  return mask;
}

/** A tip in a colour: the colour with the mask as alpha. */
export function tipCanvas(id: string, rgb: { r: number; g: number; b: number }): HTMLCanvasElement | null {
  const mask = materialMask(id, 'tip');
  if (!mask) return null;
  const c = createCanvas(mask.w, mask.h);
  const ctx = ctx2d(c);
  const img = ctx.createImageData(mask.w, mask.h);
  for (let i = 0; i < mask.data.length; i++) {
    img.data[i * 4] = rgb.r;
    img.data[i * 4 + 1] = rgb.g;
    img.data[i * 4 + 2] = rgb.b;
    img.data[i * 4 + 3] = mask.data[i];
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const heightCache = new Map<string, { heights: Uint8ClampedArray; size: number } | null>();

/** A paper texture's heights after its brightness, contrast and invert settings (square tiles only; others are cropped). */
export function paperHeights(id: string, p: Pick<PaperSettings, 'brightness' | 'contrast' | 'invert'>): { heights: Uint8ClampedArray; size: number } | null {
  const key = `${id}|${p.brightness}|${p.contrast}|${p.invert}`;
  if (heightCache.has(key)) return heightCache.get(key)!;
  const mask = materialMask(id, 'texture');
  let out: { heights: Uint8ClampedArray; size: number } | null = null;
  if (mask) {
    const size = Math.min(mask.w, mask.h);
    const square = mask.w === size && mask.h === size ? mask : { w: size, h: size, data: Uint8ClampedArray.from({ length: size * size }, (_, i) => mask.data[Math.floor(i / size) * mask.w + (i % size)]) };
    out = { heights: adjustHeights(square, p), size };
  }
  heightCache.set(key, out);
  if (heightCache.size > 24) heightCache.delete(heightCache.keys().next().value!);
  return out;
}

/** A small preview of a material (for the pickers): dark paint on light. */
export function materialPreview(id: string, kind: MaterialKind, px = 40): string {
  const mask = materialMask(id, kind);
  if (!mask) return '';
  const c = createCanvas(px, px);
  const ctx = ctx2d(c);
  const src = createCanvas(mask.w, mask.h);
  const sctx = ctx2d(src);
  const img = sctx.createImageData(mask.w, mask.h);
  for (let i = 0; i < mask.data.length; i++) {
    const v = kind === 'tip' ? 255 - mask.data[i] : mask.data[i];
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);
  const s = Math.min(px / mask.w, px / mask.h);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, px, px);
  ctx.drawImage(src, (px - mask.w * s) / 2, (px - mask.h * s) / 2, mask.w * s, mask.h * s);
  return c.toDataURL();
}

const alphaUrls = new Map<string, string>();

/** A tip as a PNG whose transparency is the tip (for masks in the user interface). */
export function tipAlphaUrl(id: string): string {
  let url = alphaUrls.get(id);
  if (url !== undefined) return url;
  const c = tipCanvas(id, { r: 0, g: 0, b: 0 });
  url = c ? c.toDataURL() : '';
  alphaUrls.set(id, url);
  return url;
}

// ------------------------------------------------------------------ import

/** Imports an image file as a brush tip or paper texture (scaled down to fit). */
export async function importMaterial(file: Blob, name: string, kind: MaterialKind): Promise<MaterialInfo> {
  const bitmap = await createImageBitmap(file);
  const max = MAX_IMPORT[kind];
  const s = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * s));
  const h = Math.max(1, Math.round(bitmap.height * s));
  const c = createCanvas(w, h);
  const ctx = ctx2d(c, true);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const mask = imageToMask(ctx.getImageData(0, 0, w, h).data, w, h);
  const id = `img-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const m: Imported = { id, name: name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Image', kind, mask };
  imported = [...imported, m];
  masks.delete(`${kind}:${id}`);
  save();
  changed();
  return { id, name: m.name, kind };
}

/** Deletes an imported material (brushes that use it fall back to a round tip or no texture). */
export function deleteMaterial(id: string): void {
  if (!imported.some((m) => m.id === id)) return;
  imported = imported.filter((m) => m.id !== id);
  for (const key of [...masks.keys()]) if (key.endsWith(`:${id}`)) masks.delete(key);
  for (const key of [...heightCache.keys()]) if (key.startsWith(`${id}|`)) heightCache.delete(key);
  save();
  changed();
}
