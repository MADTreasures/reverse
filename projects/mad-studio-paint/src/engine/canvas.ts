/** Small Canvas 2D helpers shared by the engine. Browser only. */
import type { Mask } from '../paint/mask';
import type { Rect } from '../paint/rect';

export type Ctx = CanvasRenderingContext2D;

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round(height));
  return c;
}

export function ctx2d(c: HTMLCanvasElement, readback = false): Ctx {
  const ctx = c.getContext('2d', readback ? { willReadFrequently: true } : undefined);
  if (!ctx) throw new Error('Canvas 2D is not available');
  return ctx;
}

/** Runs `fn` with drawing restricted to `r` and the context state restored afterwards. */
export function withClip(ctx: Ctx, r: Rect | null, fn: () => void): void {
  ctx.save();
  if (r) {
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
  }
  try {
    fn();
  } finally {
    ctx.restore();
  }
}

export function clearRect(ctx: Ctx, r: Rect | null): void {
  if (r) ctx.clearRect(r.x, r.y, r.w, r.h);
  else ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

/** Copies `src` onto `dst` (same size canvases) inside `r`, replacing what was there. */
export function copyRegion(src: HTMLCanvasElement, dst: Ctx, r: Rect | null): void {
  withClip(dst, r, () => {
    clearRect(dst, r);
    dst.globalCompositeOperation = 'source-over';
    dst.globalAlpha = 1;
    dst.drawImage(src, 0, 0);
  });
}

/** A canvas whose alpha channel is the mask (used with destination-in / source-in). */
export function maskToCanvas(mask: Mask, color: [number, number, number] = [0, 0, 0]): HTMLCanvasElement {
  const c = createCanvas(mask.width, mask.height);
  const img = new ImageData(mask.width, mask.height);
  const d = img.data;
  for (let i = 0, p = 0; i < mask.data.length; i++, p += 4) {
    d[p] = color[0];
    d[p + 1] = color[1];
    d[p + 2] = color[2];
    d[p + 3] = mask.data[i];
  }
  ctx2d(c).putImageData(img, 0, 0);
  return c;
}

export function getPixels(c: HTMLCanvasElement, r?: Rect): ImageData {
  const ctx = ctx2d(c);
  return r ? ctx.getImageData(r.x, r.y, r.w, r.h) : ctx.getImageData(0, 0, c.width, c.height);
}

export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = createCanvas(src.width, src.height);
  ctx2d(c).drawImage(src, 0, 0);
  return c;
}

export function canvasToBlob(c: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Encoding failed'))), type, quality));
}

export async function canvasToBytes(c: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Uint8Array> {
  return new Uint8Array(await (await canvasToBlob(c, type, quality)).arrayBuffer());
}

/** Decodes PNG/JPEG/WebP bytes into a canvas. */
export async function bytesToCanvas(bytes: Uint8Array, type = 'image/png'): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  const c = createCanvas(bitmap.width, bitmap.height);
  ctx2d(c).drawImage(bitmap, 0, 0);
  bitmap.close();
  return c;
}
