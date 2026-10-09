/**
 * PNG chunks (CRC-checked containers): writing them, and giving a browser-encoded PNG its
 * resolution (pHYs). Pure, unit tested.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A chunk: length, type, data, CRC of type and data. */
export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * The PNG with its resolution (a pHYs chunk in pixels per metre right after the header; one there
 * already is replaced). Not a PNG: returned as it is.
 */
export function pngWithDpi(png: Uint8Array, dpi: number): Uint8Array {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (png.length < 33 || sig.some((b, i) => png[i] !== b)) return png;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const ppm = Math.round(dpi / 0.0254);
  const data = new Uint8Array(9);
  new DataView(data.buffer).setUint32(0, ppm);
  new DataView(data.buffer).setUint32(4, ppm);
  data[8] = 1;
  const parts: Uint8Array[] = [png.subarray(0, 8)];
  for (let p = 8; p + 12 <= png.length; ) {
    const len = view.getUint32(p);
    const type = String.fromCharCode(...png.subarray(p + 4, p + 8));
    const end = p + 12 + len;
    if (type !== 'pHYs') parts.push(png.subarray(p, end));
    if (type === 'IHDR') parts.push(pngChunk('pHYs', data));
    p = end;
  }
  const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of parts) {
    out.set(x, o);
    o += x.length;
  }
  return out;
}
