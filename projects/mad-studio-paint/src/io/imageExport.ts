/**
 * File > Export (single layer): the formats with the settings the reference's export settings
 * dialog shows for each, the output size (scale ratio, size in a unit, or resolution), the
 * expression colour (duotone by threshold or by toning, grey, RGB) and the resolution written into
 * JPEG files. Pure, unit tested.
 */
import { applyTone, defaultTone } from '../paint/tone';
import type { Pixels } from './psd';

export type ImageFormat = 'bmp' | 'jpeg' | 'png' | 'webp' | 'tiff' | 'tga' | 'psd' | 'psb';

export interface FormatInfo {
  /** Menu item: extension and name. */
  menu: string;
  /** In "… export settings". */
  name: string;
  ext: string;
  mime: string;
  /** Export transparency can be chosen (PNG, WebP). */
  transparency: boolean;
}

export const IMAGE_FORMATS: Record<ImageFormat, FormatInfo> = {
  bmp: { menu: '.bmp (BMP)', name: 'BMP', ext: 'bmp', mime: 'image/bmp', transparency: false },
  jpeg: { menu: '.jpg (JPEG)', name: 'JPEG', ext: 'jpg', mime: 'image/jpeg', transparency: false },
  png: { menu: '.png (PNG)', name: 'PNG', ext: 'png', mime: 'image/png', transparency: true },
  webp: { menu: '.webp (WebP)', name: 'WebP', ext: 'webp', mime: 'image/webp', transparency: true },
  tiff: { menu: '.tif (TIFF)', name: 'TIFF', ext: 'tif', mime: 'image/tiff', transparency: false },
  tga: { menu: '.tga (Targa)', name: 'Targa', ext: 'tga', mime: 'image/x-tga', transparency: false },
  psd: { menu: '.psd (Photoshop Document)', name: 'Photoshop document', ext: 'psd', mime: 'image/vnd.adobe.photoshop', transparency: false },
  psb: { menu: '.psb (Photoshop Big Document)', name: 'Photoshop big document', ext: 'psb', mime: 'image/vnd.adobe.photoshop', transparency: false },
};

export const IMAGE_FORMAT_ORDER: ImageFormat[] = ['bmp', 'jpeg', 'png', 'webp', 'tiff', 'tga', 'psd', 'psb'];

export type ExpressionColor = 'auto' | 'threshold' | 'toning' | 'gray' | 'rgb';

export const EXPRESSION_COLORS: [ExpressionColor, string][] = [
  ['auto', 'Auto detect appropriate color depth'],
  ['threshold', 'Duotone (Threshold)'],
  ['toning', 'Duotone (Toning)'],
  ['gray', 'Gray'],
  ['rgb', 'RGB color'],
];

/**
 * Expression color, in place: grey levels, or black and white at 50 % brightness (Threshold) or
 * as screentone dots at the default frequency (Toning). Duotones keep only fully opaque or fully
 * transparent pixels. Auto and RGB keep the colours (the canvas is RGB).
 */
export function expressColors(p: Pixels, mode: ExpressionColor, dpi: number): void {
  if (mode === 'auto' || mode === 'rgb') return;
  const d = p.data;
  if (mode === 'toning') applyTone(d, p.width, p.height, 0, 0, defaultTone(dpi), dpi);
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = mode === 'gray' ? Math.round(y) : y >= 127.5 ? 255 : 0;
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
    if (mode !== 'gray') d[i + 3] = d[i + 3] >= 128 ? 255 : 0;
  }
}

export type SizeUnit = 'px' | 'mm' | 'cm' | 'in';

/** Output size: Scale ratio from original data, Specify output size, or Specify resolution. */
export type OutputSize = { mode: 'scale'; percent: number } | { mode: 'size'; width: number; height: number; unit: SizeUnit } | { mode: 'resolution'; dpi: number };

/** Longest side of an exported image (browsers draw no larger canvases). */
export const MAX_EXPORT_SIDE = 16384;

/** Pixels for a length in a unit at a resolution. */
export const toPixels = (v: number, unit: SizeUnit, dpi: number): number => (unit === 'px' ? v : unit === 'in' ? v * dpi : (v / (unit === 'mm' ? 25.4 : 2.54)) * dpi);

/** A length in pixels in a unit at a resolution. */
export const fromPixels = (px: number, unit: SizeUnit, dpi: number): number => (unit === 'px' ? px : unit === 'in' ? px / dpi : (px / dpi) * (unit === 'mm' ? 25.4 : 2.54));

/**
 * The exported image's size in pixels and its resolution, for an area of w × h canvas pixels at
 * `dpi`: a scale ratio and an output size keep the canvas's resolution; a resolution changes the
 * pixels in proportion (the printed size stays).
 */
export function outputSize(size: OutputSize, w: number, h: number, dpi: number): { width: number; height: number; dpi: number } {
  const side = (v: number) => Math.max(1, Math.min(MAX_EXPORT_SIDE, Math.round(v)));
  if (size.mode === 'scale') return { width: side((w * size.percent) / 100), height: side((h * size.percent) / 100), dpi };
  if (size.mode === 'size') return { width: side(toPixels(size.width, size.unit, dpi)), height: side(toPixels(size.height, size.unit, dpi)), dpi };
  const k = size.dpi / dpi;
  return { width: side(w * k), height: side(h * k), dpi: size.dpi };
}

/** The JPEG with its resolution in the JFIF header (one is added when the encoder wrote none). */
export function jpegWithDpi(jpeg: Uint8Array, dpi: number): Uint8Array {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;
  const d = Math.max(1, Math.min(65535, Math.round(dpi)));
  const jfif = jpeg[2] === 0xff && jpeg[3] === 0xe0 && String.fromCharCode(...jpeg.subarray(6, 11)) === 'JFIF\0';
  if (jfif) {
    const out = jpeg.slice();
    // Units: dots per inch; X and Y density.
    out.set([1, d >> 8, d & 255, d >> 8, d & 255], 13);
    return out;
  }
  const app0 = [0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, d >> 8, d & 255, d >> 8, d & 255, 0, 0];
  const out = new Uint8Array(jpeg.length + app0.length);
  out.set([0xff, 0xd8]);
  out.set(app0, 2);
  out.set(jpeg.subarray(2), 2 + app0.length);
  return out;
}
