import { describe, expect, it } from 'vitest';
import { expressColors, fromPixels, jpegWithDpi, MAX_EXPORT_SIDE, outputSize, toPixels } from './imageExport';
import { crc32, pngChunk, pngWithDpi } from './png';
import type { Pixels } from './psd';

const picture = (rgba: number[][]): Pixels => ({ width: rgba.length, height: 1, data: new Uint8ClampedArray(rgba.flat()) });

describe('export (single layer): expression color', () => {
  it('turns colours into grey levels', () => {
    const p = picture([
      [255, 0, 0, 255],
      [0, 255, 0, 128],
      [10, 20, 30, 0],
    ]);
    expressColors(p, 'gray', 72);
    expect([...p.data]).toEqual([76, 76, 76, 255, 150, 150, 150, 128, 18, 18, 18, 0]);
  });

  it('makes black and white at 50 % brightness, pixels fully opaque or transparent', () => {
    const p = picture([
      [200, 200, 200, 255],
      [100, 100, 100, 200],
      [255, 255, 255, 100],
    ]);
    expressColors(p, 'threshold', 72);
    expect([...p.data]).toEqual([255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 0]);
  });

  it('tones grey into black dots on white', () => {
    const w = 64;
    const p: Pixels = { width: w, height: w, data: new Uint8ClampedArray(w * w * 4) };
    for (let i = 0; i < w * w; i++) p.data.set([128, 128, 128, 255], i * 4);
    expressColors(p, 'toning', 300);
    const values = new Set<number>();
    let black = 0;
    for (let i = 0; i < w * w; i++) {
      values.add(p.data[i * 4]);
      if (p.data[i * 4] === 0) black++;
    }
    expect([...values].sort((a, b) => a - b)).toEqual([0, 255]);
    // About half of a mid grey becomes dots.
    expect(black / (w * w)).toBeGreaterThan(0.35);
    expect(black / (w * w)).toBeLessThan(0.65);
  });

  it('keeps the colours for Auto and RGB', () => {
    const p = picture([[1, 2, 3, 4]]);
    expressColors(p, 'auto', 72);
    expressColors(p, 'rgb', 72);
    expect([...p.data]).toEqual([1, 2, 3, 4]);
  });
});

describe('export (single layer): output size', () => {
  it('scales, sizes in units or changes the resolution', () => {
    expect(outputSize({ mode: 'scale', percent: 50 }, 401, 300, 350)).toEqual({ width: 201, height: 150, dpi: 350 });
    expect(outputSize({ mode: 'size', width: 800, height: 600, unit: 'px' }, 400, 300, 72)).toEqual({ width: 800, height: 600, dpi: 72 });
    expect(outputSize({ mode: 'size', width: 25.4, height: 2.54, unit: 'mm' }, 400, 300, 300)).toEqual({ width: 300, height: 30, dpi: 300 });
    expect(outputSize({ mode: 'resolution', dpi: 144 }, 400, 300, 72)).toEqual({ width: 800, height: 600, dpi: 144 });
    expect(outputSize({ mode: 'scale', percent: 10000 }, 400, 300, 72).width).toBe(MAX_EXPORT_SIDE);
    expect(toPixels(2, 'in', 300)).toBe(600);
    expect(fromPixels(600, 'cm', 300)).toBeCloseTo(5.08, 6);
  });
});

describe('export (single layer): resolution in the file', () => {
  it('puts a pHYs chunk after the PNG header', () => {
    const ihdr = pngChunk('IHDR', new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]));
    const idat = pngChunk('IDAT', new Uint8Array([1, 2, 3]));
    const iend = pngChunk('IEND', new Uint8Array(0));
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...ihdr, ...pngChunk('pHYs', new Uint8Array(9)), ...idat, ...iend]);
    const out = pngWithDpi(png, 300);
    const v = new DataView(out.buffer);
    const types: string[] = [];
    for (let p = 8; p < out.length; p += 12 + v.getUint32(p)) {
      const len = v.getUint32(p);
      types.push(String.fromCharCode(...out.subarray(p + 4, p + 8)));
      expect(v.getUint32(p + 8 + len)).toBe(crc32(out.subarray(p + 4, p + 8 + len)));
    }
    expect(types).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND']);
    // 300 dpi = 11811 pixels per metre, unit metre.
    expect([v.getUint32(8 + 25 + 8), v.getUint32(8 + 25 + 12), out[8 + 25 + 16]]).toEqual([11811, 11811, 1]);
    expect(pngWithDpi(new Uint8Array([1, 2, 3]), 300)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('writes the resolution into the JFIF header, or adds one', () => {
    const jfif = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
    const a = jpegWithDpi(jfif, 350);
    expect([...a.subarray(13, 18)]).toEqual([1, 1, 94, 1, 94]);
    expect(a.length).toBe(jfif.length);
    const bare = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 2, 0xff, 0xd9]);
    const b = jpegWithDpi(bare, 72);
    expect([...b.subarray(0, 4)]).toEqual([0xff, 0xd8, 0xff, 0xe0]);
    expect(String.fromCharCode(...b.subarray(6, 10))).toBe('JFIF');
    expect([...b.subarray(13, 18)]).toEqual([1, 0, 72, 0, 72]);
    expect([...b.subarray(20)]).toEqual([0xff, 0xdb, 0, 2, 0xff, 0xd9]);
  });
});
