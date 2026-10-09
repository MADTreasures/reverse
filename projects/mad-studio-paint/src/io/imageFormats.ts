/**
 * Still image formats the browser cannot encode (File > Export animation > Image sequence, File >
 * Export (single layer)): BMP (24 bits), Targa (uncompressed, 24 or 32 bits) and TIFF (baseline,
 * uncompressed RGB or RGBA with unassociated alpha). Pure (no DOM): pixels come in as straight RGBA.
 */
import type { Pixels } from './psd';

/** BMP: BITMAPINFOHEADER, 24 bits, rows bottom up and padded to 4 bytes. No alpha. */
export function encodeBmp(p: Pixels, dpi = 72): Uint8Array {
  const row = Math.ceil((p.width * 3) / 4) * 4;
  const size = 54 + row * p.height;
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  out.set([0x42, 0x4d]);
  v.setUint32(2, size, true);
  v.setUint32(10, 54, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, p.width, true);
  v.setInt32(22, p.height, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  v.setUint32(34, row * p.height, true);
  // Resolution in pixels per metre.
  const ppm = Math.round(dpi / 0.0254);
  v.setInt32(38, ppm, true);
  v.setInt32(42, ppm, true);
  for (let y = 0; y < p.height; y++) {
    const o = 54 + (p.height - 1 - y) * row;
    for (let x = 0, i = y * p.width * 4; x < p.width; x++, i += 4) {
      out[o + x * 3] = p.data[i + 2];
      out[o + x * 3 + 1] = p.data[i + 1];
      out[o + x * 3 + 2] = p.data[i];
    }
  }
  return out;
}

/** Targa: uncompressed true colour, rows top down; 32 bits with alpha, else 24. */
export function encodeTga(p: Pixels, alpha: boolean): Uint8Array {
  const bpp = alpha ? 4 : 3;
  const footer = [0, 0, 0, 0, 0, 0, 0, 0, ...[...'TRUEVISION-XFILE.'].map((c) => c.charCodeAt(0)), 0];
  const out = new Uint8Array(18 + p.width * p.height * bpp + footer.length);
  const v = new DataView(out.buffer);
  out[2] = 2;
  v.setUint16(12, p.width, true);
  v.setUint16(14, p.height, true);
  out[16] = bpp * 8;
  // Origin top left; alpha bits.
  out[17] = 0x20 | (alpha ? 8 : 0);
  for (let i = 0, o = 18; i < p.width * p.height * 4; i += 4, o += bpp) {
    out[o] = p.data[i + 2];
    out[o + 1] = p.data[i + 1];
    out[o + 2] = p.data[i];
    if (alpha) out[o + 3] = p.data[i + 3];
  }
  out.set(footer, out.length - footer.length);
  return out;
}

/** TIFF (little endian): one uncompressed strip, RGB or RGBA (unassociated alpha), resolution in dpi. */
export function encodeTiff(p: Pixels, alpha: boolean, dpi = 72): Uint8Array {
  const spp = alpha ? 4 : 3;
  const dataSize = p.width * p.height * spp;
  // Header, pixels, the values that do not fit into an entry, then the directory.
  const bitsAt = 8 + dataSize + (dataSize % 2);
  const resAt = bitsAt + spp * 2;
  const tags: [number, number, number, number][] = [
    // tag, type (3 SHORT, 4 LONG, 5 RATIONAL), count, value or offset
    [256, 4, 1, p.width],
    [257, 4, 1, p.height],
    [258, 3, spp, bitsAt],
    [259, 3, 1, 1],
    [262, 3, 1, 2],
    [273, 4, 1, 8],
    [277, 3, 1, spp],
    [278, 4, 1, p.height],
    [279, 4, 1, dataSize],
    [282, 5, 1, resAt],
    [283, 5, 1, resAt + 8],
    [284, 3, 1, 1],
    [296, 3, 1, 2],
    ...(alpha ? [[338, 3, 1, 2] as [number, number, number, number]] : []),
  ];
  const ifdAt = resAt + 16;
  const out = new Uint8Array(ifdAt + 2 + tags.length * 12 + 4);
  const v = new DataView(out.buffer);
  out.set([0x49, 0x49, 42, 0]);
  v.setUint32(4, ifdAt, true);
  for (let i = 0, o = 8; i < p.width * p.height * 4; i += 4, o += spp) {
    out[o] = p.data[i];
    out[o + 1] = p.data[i + 1];
    out[o + 2] = p.data[i + 2];
    if (alpha) out[o + 3] = p.data[i + 3];
  }
  for (let s = 0; s < spp; s++) v.setUint16(bitsAt + s * 2, 8, true);
  const res = Math.max(1, Math.round(dpi));
  for (const o of [resAt, resAt + 8]) {
    v.setUint32(o, res, true);
    v.setUint32(o + 4, 1, true);
  }
  v.setUint16(ifdAt, tags.length, true);
  tags.forEach(([tag, type, count, value], i) => {
    const o = ifdAt + 2 + i * 12;
    v.setUint16(o, tag, true);
    v.setUint16(o + 2, type, true);
    v.setUint32(o + 4, count, true);
    // A single SHORT sits in the first two bytes of the value.
    if (type === 3 && count === 1) v.setUint16(o + 8, value, true);
    else v.setUint32(o + 8, value, true);
  });
  return out;
}
