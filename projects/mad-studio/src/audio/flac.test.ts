import { describe, expect, it } from 'vitest';
import { BitWriter, crc16, crc8, encodeFlac, encodeFlacSamples, quantize, writeFrameNumber } from './flac';

// A small reference decoder for what the encoder writes (CONSTANT, VERBATIM and FIXED subframes with
// partitioned Rice residuals), checking both CRCs and the frame numbers on the way.

class BitReader {
  pos = 0;
  constructor(private readonly data: Uint8Array) {}

  read(bits: number): number {
    let v = 0;
    for (let i = 0; i < bits; i++) {
      v = v * 2 + ((this.data[this.pos >> 3] >> (7 - (this.pos & 7))) & 1);
      this.pos++;
    }
    return v;
  }

  readSigned(bits: number): number {
    const v = this.read(bits);
    return v >= 2 ** (bits - 1) ? v - 2 ** bits : v;
  }

  readUnary(): number {
    let q = 0;
    while (this.read(1) === 0) q++;
    return q;
  }

  align(): void {
    this.pos = Math.ceil(this.pos / 8) * 8;
  }

  get byte(): number {
    return this.pos >> 3;
  }
}

function decodeSubframe(r: BitReader, n: number, bps: number, kinds: string[]): Int32Array {
  expect(r.read(1)).toBe(0);
  const type = r.read(6);
  expect(r.read(1)).toBe(0); // no wasted bits
  const x = new Int32Array(n);
  if (type === 0) {
    x.fill(r.readSigned(bps));
    kinds.push('constant');
    return x;
  }
  if (type === 1) {
    for (let i = 0; i < n; i++) x[i] = r.readSigned(bps);
    kinds.push('verbatim');
    return x;
  }
  expect(type & 0b111000).toBe(0b001000);
  const order = type & 7;
  kinds.push(`fixed${order}`);
  for (let i = 0; i < order; i++) x[i] = r.readSigned(bps);
  expect(r.read(2)).toBe(0); // Rice with 4-bit parameters
  const porder = r.read(4);
  const size = n >> porder;
  const res = new Int32Array(n);
  for (let p = 0; p < 1 << porder; p++) {
    const start = p === 0 ? order : p * size;
    const end = (p + 1) * size;
    const k = r.read(4);
    if (k === 15) {
      const bits = r.read(5);
      for (let i = start; i < end; i++) res[i] = bits ? r.readSigned(bits) : 0;
      continue;
    }
    for (let i = start; i < end; i++) {
      const u = r.readUnary() * 2 ** k + (k ? r.read(k) : 0);
      res[i] = u % 2 ? -(u + 1) / 2 : u / 2;
    }
  }
  for (let i = order; i < n; i++) {
    if (order === 0) x[i] = res[i];
    else if (order === 1) x[i] = res[i] + x[i - 1];
    else if (order === 2) x[i] = res[i] + 2 * x[i - 1] - x[i - 2];
    else if (order === 3) x[i] = res[i] + 3 * x[i - 1] - 3 * x[i - 2] + x[i - 3];
    else x[i] = res[i] + 4 * x[i - 1] - 6 * x[i - 2] + 4 * x[i - 3] - x[i - 4];
  }
  return x;
}

function decodeFlac(data: Uint8Array) {
  expect(String.fromCharCode(...data.subarray(0, 4))).toBe('fLaC');
  const r = new BitReader(data);
  r.pos = 32;
  let sampleRate = 0;
  let channels = 0;
  let bps = 0;
  let total = 0;
  for (let last = 0; !last; ) {
    last = r.read(1);
    const type = r.read(7);
    const length = r.read(24);
    const start = r.byte;
    if (type === 0) {
      r.read(16 + 16 + 24 + 24);
      sampleRate = r.read(20);
      channels = r.read(3) + 1;
      bps = r.read(5) + 1;
      total = r.read(4) * 2 ** 32 + r.read(32);
    }
    r.pos = (start + length) * 8;
  }
  const samples = Array.from({ length: channels }, () => new Int32Array(total));
  const kinds: string[] = [];
  let offset = 0;
  for (let frame = 0; offset < total; frame++) {
    const begin = r.byte;
    expect(r.read(14)).toBe(0x3ffe);
    r.read(2);
    const sizeCode = r.read(4);
    expect(r.read(4)).toBe(0); // sample rate from STREAMINFO
    expect(r.read(4)).toBe(channels - 1);
    expect(r.read(3)).toBe(bps === 16 ? 0b100 : 0b110);
    r.read(1);
    const first = r.read(8);
    let number = first;
    if (first >= 0x80) {
      let cont = 0;
      let mask = 0x40;
      while (first & mask) {
        cont++;
        mask >>= 1;
      }
      number = first & (mask - 1);
      for (let i = 0; i < cont; i++) number = number * 64 + (r.read(8) & 0x3f);
    }
    expect(number).toBe(frame);
    expect(sizeCode).toBe(0b0111);
    const n = r.read(16) + 1;
    const headerEnd = r.byte;
    expect(r.read(8)).toBe(crc8(data.subarray(begin, headerEnd)));
    for (let c = 0; c < channels; c++) samples[c].set(decodeSubframe(r, n, bps, kinds), offset);
    r.align();
    const crcAt = r.byte;
    expect(r.read(16)).toBe(crc16(data.subarray(begin, crcAt)));
    offset += n;
  }
  expect(r.byte).toBe(data.length);
  return { sampleRate, channels, bps, total, samples, kinds };
}

describe('FLAC encoder', () => {
  it('computes the CRCs FLAC uses', () => {
    const check = new TextEncoder().encode('123456789');
    expect(crc8(check)).toBe(0xf4); // CRC-8, polynomial 0x07
    expect(crc16(check)).toBe(0xfee8); // CRC-16, polynomial 0x8005
  });

  it('codes frame numbers like UTF-8', () => {
    const bytes = (n: number) => {
      const w = new BitWriter();
      writeFrameNumber(w, n);
      return [...w.finish()];
    };
    expect(bytes(0)).toEqual([0x00]);
    expect(bytes(0x7f)).toEqual([0x7f]);
    expect(bytes(0x80)).toEqual([0xc2, 0x80]);
    expect(bytes(0x7ff)).toEqual([0xdf, 0xbf]);
    expect(bytes(0x800)).toEqual([0xe0, 0xa0, 0x80]);
    expect(bytes(0xffff)).toEqual([0xef, 0xbf, 0xbf]);
    expect(bytes(0x10000)).toEqual([0xf0, 0x90, 0x80, 0x80]);
  });

  it('round-trips stereo 16-bit audio losslessly and compresses tonal material', () => {
    const total = 10000; // two full blocks and a short one
    const left = new Int32Array(total);
    for (let i = 0; i < total; i++) left[i] = Math.round(16000 * Math.sin((2 * Math.PI * 440 * i) / 44100));
    const right = new Int32Array(total); // silence: constant subframes
    const flac = encodeFlacSamples([left, right], 44100, 16);
    const out = decodeFlac(flac);
    expect(out).toMatchObject({ sampleRate: 44100, channels: 2, bps: 16, total });
    expect(out.samples[0]).toEqual(left);
    expect(out.samples[1]).toEqual(right);
    expect(out.kinds.filter((k) => k === 'constant')).toHaveLength(3);
    expect(out.kinds.some((k) => k.startsWith('fixed'))).toBe(true);
    expect(flac.length).toBeLessThan(total * 2 * 0.5);
  });

  it('round-trips full-scale noise, short blocks and 24-bit audio', () => {
    let seed = 1;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const noise = Int32Array.from({ length: 5000 }, () => Math.round(rand() * 65535) - 32768);
    const decoded = decodeFlac(encodeFlacSamples([noise], 48000, 16));
    expect(decoded.samples[0]).toEqual(noise);

    const tiny = Int32Array.from([5, -3, 7, 8388607, -8388608, 0, 1, 2, 3, 4]);
    const t = decodeFlac(encodeFlacSamples([tiny], 96000, 24));
    expect(t).toMatchObject({ sampleRate: 96000, bps: 24, total: 10 });
    expect(t.samples[0]).toEqual(tiny);

    expect(decodeFlac(encodeFlacSamples([new Int32Array(0)], 44100, 16)).total).toBe(0);
  });

  it('quantizes float audio like the WAV export and encodes it', () => {
    const frames = 6000;
    const a = Float32Array.from({ length: frames }, (_, i) => 0.8 * Math.sin(i / 20));
    const b = Float32Array.from({ length: frames }, (_, i) => (i % 100 < 50 ? 1.5 : -1.5)); // clipped
    const expected = quantize([a, b], 16);
    expect(Math.max(...expected[1])).toBe(32767);
    expect(Math.min(...expected[1])).toBe(-32767);
    const out = decodeFlac(encodeFlac([a, b], 44100, 16));
    expect(out.samples).toEqual(expected);
    const deep = quantize([a], 24);
    expect(decodeFlac(encodeFlac([a], 44100, 24)).samples[0]).toEqual(deep[0]);
  });
});
