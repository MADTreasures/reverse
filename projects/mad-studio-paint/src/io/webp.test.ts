import { describe, expect, it } from 'vitest';
import { imageChunks, muxAnimatedWebp } from './webp';

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const u32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
const chunk = (fourcc: string, data: number[]) => [...ascii(fourcc), ...u32(data.length), ...data, ...(data.length % 2 ? [0] : [])];
const riff = (body: number[]) => new Uint8Array([...ascii('RIFF'), ...u32(body.length + 4), ...ascii('WEBP'), ...body]);

// Still pictures as a browser writes them (payloads are placeholders: the muxer copies them as they are).
const lossless = riff(chunk('VP8L', [0x2f, 1, 2, 3, 4]));
const lossy = riff([...chunk('VP8X', [0x10, 0, 0, 0, 1, 0, 0, 1, 0, 0]), ...chunk('ALPH', [9, 8, 7]), ...chunk('VP8 ', [1, 2, 3, 4, 5, 6])]);

/** The chunks of a RIFF body: fourcc, data and where it starts. */
function chunks(b: Uint8Array, from: number, to: number) {
  const out: { fourcc: string; data: Uint8Array }[] = [];
  for (let p = from; p < to; ) {
    const size = b[p + 4] | (b[p + 5] << 8) | (b[p + 6] << 16) | (b[p + 7] << 24);
    out.push({ fourcc: String.fromCharCode(...b.slice(p, p + 4)), data: b.slice(p + 8, p + 8 + size) });
    p += 8 + size + (size % 2);
  }
  return out;
}
const u24 = (d: Uint8Array, o: number) => d[o] | (d[o + 1] << 8) | (d[o + 2] << 16);

describe('animated WebP', () => {
  it('takes the image chunks of a still picture', () => {
    expect(imageChunks(lossless).map((c) => [c.fourcc, [...c.data]])).toEqual([['VP8L', [0x2f, 1, 2, 3, 4]]]);
    expect(imageChunks(lossy).map((c) => c.fourcc)).toEqual(['ALPH', 'VP8 ']);
    expect(() => imageChunks(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]))).toThrow(/Not a WebP/);
    expect(() => imageChunks(riff(chunk('VP8X', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0])))).toThrow(/no image data/);
  });

  it('joins frames with their durations, the loop count and the canvas size', () => {
    const out = muxAnimatedWebp(
      [
        { data: lossless, duration: 125 },
        { data: lossy, duration: 42 },
      ],
      300,
      200,
      3,
      true,
    );
    expect(String.fromCharCode(...out.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...out.slice(8, 12))).toBe('WEBP');
    expect(out[4] | (out[5] << 8) | (out[6] << 16) | (out[7] << 24)).toBe(out.length - 8);
    const top = chunks(out, 12, out.length);
    expect(top.map((c) => c.fourcc)).toEqual(['VP8X', 'ANIM', 'ANMF', 'ANMF']);
    // VP8X: animation and alpha flags, canvas size minus one.
    const x = top[0].data;
    expect(x[0]).toBe(0x12);
    expect([u24(x, 4) + 1, u24(x, 7) + 1]).toEqual([300, 200]);
    // ANIM: background colour, loop count.
    expect(top[1].data[4] | (top[1].data[5] << 8)).toBe(3);
    const frame = (d: Uint8Array) => ({ x: u24(d, 0), y: u24(d, 3), w: u24(d, 6) + 1, h: u24(d, 9) + 1, duration: u24(d, 12), flags: d[15], parts: chunks(d, 16, d.length) });
    const f1 = frame(top[2].data);
    expect([f1.x, f1.y, f1.w, f1.h, f1.duration, f1.flags]).toEqual([0, 0, 300, 200, 125, 2]);
    expect(f1.parts.map((c) => [c.fourcc, [...c.data]])).toEqual([['VP8L', [0x2f, 1, 2, 3, 4]]]);
    const f2 = frame(top[3].data);
    expect(f2.duration).toBe(42);
    expect(f2.parts.map((c) => [c.fourcc, [...c.data]])).toEqual([
      ['ALPH', [9, 8, 7]],
      ['VP8 ', [1, 2, 3, 4, 5, 6]],
    ]);
  });

  it('loops endlessly with 0 and leaves the alpha flag off for opaque pictures', () => {
    const out = muxAnimatedWebp([{ data: lossless, duration: 100 }], 1, 1, 0, false);
    const top = chunks(out, 12, out.length);
    expect(top[0].data[0]).toBe(0x02);
    expect(top[1].data[4] | (top[1].data[5] << 8)).toBe(0);
    expect(() => muxAnimatedWebp([], 1, 1, 0, false)).toThrow();
  });
});
