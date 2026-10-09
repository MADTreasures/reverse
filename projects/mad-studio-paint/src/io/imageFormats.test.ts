import { describe, expect, it } from 'vitest';
import { encodeBmp, encodeTga, encodeTiff } from './imageFormats';
import type { Pixels } from './psd';

// 3 × 2 pixels, straight RGBA.
const picture: Pixels = {
  width: 3,
  height: 2,
  data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255]),
};
const px = (x: number, y: number) => [...picture.data.slice((y * 3 + x) * 4, (y * 3 + x) * 4 + 4)];

describe('BMP', () => {
  it('writes 24-bit rows bottom up, padded to 4 bytes', () => {
    const b = encodeBmp(picture, 300);
    const v = new DataView(b.buffer);
    expect(String.fromCharCode(b[0], b[1])).toBe('BM');
    // Rows of 9 bytes padded to 12.
    expect(b.length).toBe(54 + 12 * 2);
    expect([v.getUint32(2, true), v.getUint32(10, true), v.getUint32(14, true)]).toEqual([b.length, 54, 40]);
    expect([v.getInt32(18, true), v.getInt32(22, true), v.getUint16(28, true), v.getUint32(30, true)]).toEqual([3, 2, 24, 0]);
    expect(v.getInt32(38, true)).toBe(Math.round(300 / 0.0254));
    const at = (x: number, y: number) => {
      const o = 54 + (1 - y) * 12 + x * 3;
      return [b[o + 2], b[o + 1], b[o]];
    };
    for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) expect(at(x, y)).toEqual(px(x, y).slice(0, 3));
  });
});

describe('Targa', () => {
  it('writes 32-bit BGRA top down with alpha bits, or 24-bit', () => {
    const t = encodeTga(picture, true);
    const v = new DataView(t.buffer);
    expect([t[2], v.getUint16(12, true), v.getUint16(14, true), t[16], t[17]]).toEqual([2, 3, 2, 32, 0x28]);
    for (let i = 0; i < 6; i++) {
      const o = 18 + i * 4;
      expect([t[o + 2], t[o + 1], t[o], t[o + 3]]).toEqual(px(i % 3, Math.floor(i / 3)));
    }
    expect(String.fromCharCode(...t.slice(t.length - 18, t.length - 1))).toBe('TRUEVISION-XFILE.');
    const opaque = encodeTga(picture, false);
    expect([opaque[16], opaque[17]]).toEqual([24, 0x20]);
    expect(opaque.length).toBe(18 + 6 * 3 + 26);
    expect([opaque[18 + 3 * 3 + 2], opaque[18 + 3 * 3 + 1], opaque[18 + 3 * 3]]).toEqual([10, 20, 30]);
  });
});

/** A small baseline TIFF reader: the tags and the pixels of the first strip. */
function readTiff(t: Uint8Array) {
  const v = new DataView(t.buffer);
  expect(String.fromCharCode(t[0], t[1])).toBe('II');
  expect(v.getUint16(2, true)).toBe(42);
  const ifd = v.getUint32(4, true);
  const n = v.getUint16(ifd, true);
  const tags = new Map<number, number[]>();
  let last = 0;
  for (let i = 0; i < n; i++) {
    const o = ifd + 2 + i * 12;
    const tag = v.getUint16(o, true);
    // Tags in ascending order.
    expect(tag).toBeGreaterThan(last);
    last = tag;
    const type = v.getUint16(o + 2, true);
    const count = v.getUint32(o + 4, true);
    const size = type === 3 ? 2 : type === 4 ? 4 : 8;
    const at = count * size > 4 ? v.getUint32(o + 8, true) : o + 8;
    const values: number[] = [];
    for (let k = 0; k < count; k++) {
      if (type === 3) values.push(v.getUint16(at + k * 2, true));
      else if (type === 4) values.push(v.getUint32(at + k * 4, true));
      else values.push(v.getUint32(at + k * 8, true) / v.getUint32(at + k * 8 + 4, true));
    }
    tags.set(tag, values);
  }
  expect(v.getUint32(ifd + 2 + n * 12, true)).toBe(0);
  const offset = tags.get(273)![0];
  const strip = t.slice(offset, offset + tags.get(279)![0]);
  return { tags, strip };
}

describe('TIFF', () => {
  it('writes an RGBA strip with unassociated alpha and the resolution', () => {
    const { tags, strip } = readTiff(encodeTiff(picture, true, 350));
    expect(tags.get(256)).toEqual([3]);
    expect(tags.get(257)).toEqual([2]);
    expect(tags.get(258)).toEqual([8, 8, 8, 8]);
    expect(tags.get(259)).toEqual([1]);
    expect(tags.get(262)).toEqual([2]);
    expect(tags.get(277)).toEqual([4]);
    expect(tags.get(278)).toEqual([2]);
    expect(tags.get(282)).toEqual([350]);
    expect(tags.get(283)).toEqual([350]);
    expect(tags.get(296)).toEqual([2]);
    expect(tags.get(338)).toEqual([2]);
    expect([...strip]).toEqual([...picture.data]);
  });

  it('writes RGB without alpha', () => {
    const { tags, strip } = readTiff(encodeTiff(picture, false));
    expect(tags.get(258)).toEqual([8, 8, 8]);
    expect(tags.get(277)).toEqual([3]);
    expect(tags.has(338)).toBe(false);
    expect(tags.get(282)).toEqual([72]);
    expect([...strip]).toEqual([...picture.data].filter((_, i) => i % 4 !== 3));
  });
});
