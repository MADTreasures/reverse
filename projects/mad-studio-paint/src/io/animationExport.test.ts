import { crc32 } from 'node:zlib';
import { unzipSync, unzlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { cropPixels, drawnArea, encodeApng, encodeGif, exportFrames, frameDelays, zipSequence } from './animationExport';
import { sequenceNames } from './sequence';
import type { Pixels } from './psd';

const image = (w: number, h: number, colors: [number, number, number, number][]): Pixels => {
  const data = new Uint8ClampedArray(w * h * 4);
  colors.forEach((c, i) => data.set(c, i * 4));
  return { width: w, height: h, data };
};

// ------------------------------------------------------------------ a small GIF reader for the tests

function lzw(minCode: number, data: number[], n: number): Uint8Array {
  const out = new Uint8Array(n);
  const clear = 1 << minCode;
  let dict: number[][] = [];
  let size = 0;
  let prev: number[] | null = null;
  const reset = () => {
    dict = Array.from({ length: clear + 2 }, (_, i) => [i]);
    size = minCode + 1;
    prev = null;
  };
  reset();
  let bit = 0;
  let op = 0;
  while (bit + size <= data.length * 8) {
    let code = 0;
    for (let i = 0; i < size; i++, bit++) code |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
    if (code === clear) {
      reset();
      continue;
    }
    if (code === clear + 1) break;
    const p: number[] | null = prev;
    const entry: number[] | null = code < dict.length ? dict[code] : p ? [...p, p[0]] : null;
    if (!entry) break;
    for (const v of entry) if (op < n) out[op++] = v;
    if (p) dict.push([...p, entry[0]]);
    prev = entry;
    if (dict.length === 1 << size && size < 12) size++;
  }
  return out;
}

function readGif(bytes: Uint8Array) {
  let p = 6;
  const u8 = () => bytes[p++];
  const u16 = () => bytes[p++] | (bytes[p++] << 8);
  const header = String.fromCharCode(...bytes.slice(0, 6));
  const width = u16();
  const height = u16();
  const packed = u8();
  p += 2;
  const table = (bits: number) => Array.from({ length: 2 << bits }, () => [u8(), u8(), u8()]);
  const global = packed & 0x80 ? table(packed & 7) : [];
  const frames: { delay: number; transparent: boolean; index: number; colors: (number[] | null)[] }[] = [];
  let gce = { delay: 0, transparent: false, index: 0 };
  let loops: number | null = null;
  const blocks = () => {
    const data: number[] = [];
    for (let n = u8(); n; n = u8()) {
      data.push(...bytes.slice(p, p + n));
      p += n;
    }
    return data;
  };
  while (p < bytes.length) {
    const b = u8();
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = u8();
      const data = blocks();
      if (label === 0xf9) gce = { transparent: Boolean(data[0] & 1), delay: data[1] | (data[2] << 8), index: data[3] };
      if (label === 0xff && String.fromCharCode(...data.slice(0, 11)) === 'NETSCAPE2.0') loops = data[12] | (data[13] << 8);
    } else if (b === 0x2c) {
      p += 4;
      const w = u16();
      const h = u16();
      const pk = u8();
      const palette = pk & 0x80 ? table(pk & 7) : global;
      const min = u8();
      const indices = lzw(min, blocks(), w * h);
      frames.push({ ...gce, colors: [...indices].map((i) => (gce.transparent && i === gce.index ? null : palette[i])) });
    }
  }
  return { header, width, height, frames, loops };
}

describe('animation export timing', () => {
  it('picks the frames for an export rate and keeps the playing time exact', () => {
    expect(exportFrames(1, 8, 8, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(exportFrames(1, 8, 8, 4)).toEqual([1, 3, 5, 7]);
    expect(exportFrames(1, 3, 12, 24)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(exportFrames(3, 4, 8, 8)).toEqual([3, 4]);
    const delays = frameDelays(6, 24);
    expect(delays.every((d) => d === 40 || d === 50)).toBe(true);
    expect(delays.reduce((a, b) => a + b, 0)).toBe(250);
    expect(frameDelays(3, 8, 1)).toEqual([125, 125, 125]);
  });

  it('names image sequences like the reference', () => {
    expect(sequenceNames(3, { prefix: 'walk', suffix: '', separator: '_', start: 1, ext: 'png' })).toEqual(['walk_0001.png', 'walk_0002.png', 'walk_0003.png']);
    expect(sequenceNames(1, { prefix: 'a/b', suffix: 'x', separator: '-', start: 0, ext: 'jpg' })).toEqual(['ab-0000-x.jpg']);
    const zip = unzipSync(zipSequence([{ name: 'a.png', data: new Uint8Array([1, 2]) }]));
    expect([...zip['a.png']]).toEqual([1, 2]);
  });
});

describe('animated GIF', () => {
  const red: [number, number, number, number] = [255, 0, 0, 255];
  const blue: [number, number, number, number] = [0, 0, 255, 255];
  const clear: [number, number, number, number] = [0, 0, 0, 0];
  const frames = [image(2, 2, [red, blue, red, blue]), image(2, 2, [blue, red, clear, red])];

  it('writes every frame with its delay, loops endlessly by default', () => {
    const gif = readGif(encodeGif(frames, { delays: [120, 130], plays: 0, transparent: false, dither: false }));
    expect(gif.header).toBe('GIF89a');
    expect([gif.width, gif.height, gif.loops]).toEqual([2, 2, 0]);
    expect(gif.frames.map((f) => f.delay)).toEqual([12, 13]);
    expect(gif.frames[0].colors).toEqual([
      [255, 0, 0],
      [0, 0, 255],
      [255, 0, 0],
      [0, 0, 255],
    ]);
  });

  it('keeps transparency and the loop count', () => {
    const once = readGif(encodeGif(frames, { delays: [100, 100], plays: 1, transparent: true, dither: true }));
    expect(once.loops).toBeNull();
    expect(once.frames[1].colors).toEqual([[0, 0, 255], [255, 0, 0], null, [255, 0, 0]]);
    expect(readGif(encodeGif(frames, { delays: [100, 100], plays: 3, transparent: false, dither: false })).loops).toBe(2);
  });
});

describe('animated PNG', () => {
  it('writes valid chunks whose frames decode to the pixels', () => {
    const a = image(3, 2, [
      [255, 0, 0, 255],
      [0, 255, 0, 128],
      [0, 0, 255, 0],
      [10, 20, 30, 255],
      [40, 50, 60, 255],
      [70, 80, 90, 255],
    ]);
    const b = image(3, 2, Array.from({ length: 6 }, (_, i) => [i * 40, 255 - i * 40, 7, 255] as [number, number, number, number]));
    const png = encodeApng([a, b], [100, 250], 0);
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(png.buffer, png.byteOffset);
    const chunks: { type: string; data: Uint8Array }[] = [];
    for (let p = 8; p < png.length; ) {
      const len = view.getUint32(p);
      const type = String.fromCharCode(...png.slice(p + 4, p + 8));
      const data = png.slice(p + 8, p + 8 + len);
      expect(view.getUint32(p + 8 + len)).toBe(crc32(png.slice(p + 4, p + 8 + len)));
      chunks.push({ type, data });
      p += 12 + len;
    }
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'acTL', 'fcTL', 'IDAT', 'fcTL', 'fdAT', 'IEND']);
    const acTL = new DataView(chunks[1].data.buffer);
    expect([acTL.getUint32(0), acTL.getUint32(4)]).toEqual([2, 0]);
    // Sequence numbers: fcTL 0, (IDAT has none), fcTL 1, fdAT 2.
    const fc = new DataView(chunks[4].data.buffer);
    expect([fc.getUint32(0), fc.getUint16(20), fc.getUint16(22)]).toEqual([1, 250, 1000]);
    expect(new DataView(chunks[5].data.buffer).getUint32(0)).toBe(2);
    const unfilter = (raw: Uint8Array) => {
      const row = 3 * 4;
      const out = new Uint8Array(row * 2);
      for (let y = 0; y < 2; y++) {
        const f = raw[y * (row + 1)];
        for (let i = 0; i < row; i++) {
          const v = raw[y * (row + 1) + 1 + i];
          const left = i >= 4 ? out[y * row + i - 4] : 0;
          const up = y > 0 ? out[(y - 1) * row + i] : 0;
          out[y * row + i] = (v + (f === 1 ? left : f === 2 ? up : 0)) & 255;
        }
      }
      return out;
    };
    expect([...unfilter(unzlibSync(chunks[3].data))]).toEqual([...a.data]);
    expect([...unfilter(unzlibSync(chunks[5].data.slice(4)))]).toEqual([...b.data]);
  });
});

/** The chunks of a PNG (CRCs checked). */
function pngChunks(png: Uint8Array): { type: string; data: Uint8Array }[] {
  const view = new DataView(png.buffer, png.byteOffset);
  const chunks: { type: string; data: Uint8Array }[] = [];
  for (let p = 8; p < png.length; ) {
    const len = view.getUint32(p);
    const data = png.slice(p + 8, p + 8 + len);
    expect(view.getUint32(p + 8 + len)).toBe(crc32(png.slice(p + 4, p + 8 + len)));
    chunks.push({ type: String.fromCharCode(...png.slice(p + 4, p + 8)), data });
    p += 12 + len;
  }
  return chunks;
}

describe('animated PNG: Color reduction and Delete blank spaces', () => {
  it('writes an indexed image with a palette and alpha per entry', () => {
    const a = image(2, 2, [
      [255, 0, 0, 255],
      [0, 255, 0, 128],
      [0, 0, 0, 0],
      [16, 32, 48, 255],
    ]);
    const b = image(2, 2, [
      [16, 32, 48, 255],
      [255, 0, 0, 255],
      [0, 255, 0, 128],
      [0, 0, 0, 0],
    ]);
    const png = encodeApng([a, b], [100, 100], 1, true);
    const chunks = pngChunks(png);
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'PLTE', 'tRNS', 'acTL', 'fcTL', 'IDAT', 'fcTL', 'fdAT', 'IEND']);
    // 8 bits, colour type 3 (indexed).
    expect([...chunks[0].data.slice(8, 10)]).toEqual([8, 3]);
    const plte = chunks[1].data;
    const trns = chunks[2].data;
    expect(plte.length % 3).toBe(0);
    expect(plte.length / 3).toBeLessThanOrEqual(256);
    expect(trns.length).toBeLessThanOrEqual(plte.length / 3);
    const decode = (raw: Uint8Array) => {
      const out: number[] = [];
      for (let y = 0; y < 2; y++) {
        // Filter None.
        expect(raw[y * 3]).toBe(0);
        for (let x = 0; x < 2; x++) {
          const i = raw[y * 3 + 1 + x];
          out.push(plte[i * 3], plte[i * 3 + 1], plte[i * 3 + 2], i < trns.length ? trns[i] : 255);
        }
      }
      return out;
    };
    // Few colours: each keeps its exact value.
    expect(decode(unzlibSync(chunks[5].data))).toEqual([...a.data]);
    expect(decode(unzlibSync(chunks[7].data.slice(4)))).toEqual([...b.data]);
  });

  it('crops all frames to the area drawn in any of them', () => {
    const blank = image(4, 3, []);
    const one = image(4, 3, []);
    one.data.set([1, 2, 3, 255], (1 * 4 + 1) * 4);
    const two = image(4, 3, []);
    two.data.set([4, 5, 6, 10], (2 * 4 + 2) * 4);
    expect(drawnArea([blank])).toBeNull();
    expect(drawnArea([one])).toEqual({ x: 1, y: 1, w: 1, h: 1 });
    const r = drawnArea([one, blank, two])!;
    expect(r).toEqual({ x: 1, y: 1, w: 2, h: 2 });
    const c = cropPixels(two, r);
    expect([c.width, c.height]).toEqual([2, 2]);
    expect([...c.data]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 5, 6, 10]);
  });
});

describe('image sequence ZIP', () => {
  it('stores compressed pictures and deflates uncompressed ones', () => {
    const files = [{ name: 'a.bmp', data: new Uint8Array(4000).fill(7) }];
    const stored = zipSequence(files);
    const deflated = zipSequence(files, true);
    expect(deflated.length).toBeLessThan(stored.length / 10);
    expect([...unzipSync(deflated)['a.bmp']]).toEqual([...files[0].data]);
  });
});
