import { describe, expect, it } from 'vitest';
import { findBox, muxMovie, readBoxes, type MovieTrack } from './mp4';

const text = (d: Uint8Array, at: number, n = 4) => String.fromCharCode(...d.subarray(at, at + n));
const u32 = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset).getUint32(at);
const has = (d: Uint8Array, s: string) => {
  const codes = [...s].map((c) => c.charCodeAt(0));
  for (let i = 0; i + codes.length <= d.length; i++) if (codes.every((c, k) => d[i + k] === c)) return true;
  return false;
};
/** The chunk offsets of a track (stco). */
function offsets(d: Uint8Array, trak: { start: number; size: number }): number[] {
  const boxes = readBoxes(d, trak.start + 8, trak.start + trak.size);
  const stco = findBox(boxes, ['mdia', 'minf', 'stbl', 'stco'])!;
  const n = u32(d, stco.start + 12);
  return Array.from({ length: n }, (_, i) => u32(d, stco.start + 16 + i * 4));
}

const frame = (v: number, n: number) => Uint8Array.from({ length: n }, () => v);

describe('MP4 and MOV', () => {
  it('writes an MP4: header first, then the samples the tables point at', () => {
    const video: MovieTrack = {
      kind: 'video',
      codec: 'vp09',
      width: 64,
      height: 48,
      timescale: 1200,
      vp9: { profile: 0, level: 10, bitDepth: 8 },
      samples: [
        { data: frame(1, 30), duration: 100, sync: true },
        { data: frame(2, 10), duration: 100, sync: false },
        { data: frame(3, 12), duration: 100, sync: false },
      ],
    };
    const audio: MovieTrack = {
      kind: 'audio',
      codec: 'Opus',
      sampleRate: 48000,
      channels: 2,
      samples: [
        { data: frame(7, 5), duration: 960, sync: true },
        { data: frame(8, 6), duration: 960, sync: true },
      ],
    };
    const d = muxMovie([video, audio], { qt: false });
    const boxes = readBoxes(d);
    expect(boxes.map((b) => b.type)).toEqual(['ftyp', 'moov', 'mdat']);
    expect(text(d, 8)).toBe('isom');
    const traks = findBox(boxes, ['moov'])!.children!.filter((b) => b.type === 'trak');
    expect(traks).toHaveLength(2);
    expect(has(d, 'vpcC')).toBe(true);
    expect(has(d, 'dOps')).toBe(true);
    // Video: three chunks at the samples' bytes; only the first is a key frame (stss).
    const vo = offsets(d, traks[0]);
    expect(vo.map((o) => d[o])).toEqual([1, 2, 3]);
    expect(has(d, 'stss')).toBe(true);
    const ao = offsets(d, traks[1]);
    expect(ao.map((o) => d[o])).toEqual([7, 8]);
    // mvhd: 300 / 1200 s = 250 ms.
    const mvhd = findBox(boxes, ['moov', 'mvhd'])!;
    expect([u32(d, mvhd.start + 20), u32(d, mvhd.start + 24)]).toEqual([1000, 250]);
  });

  it('writes a QuickTime movie with Photo-JPEG and 16-bit PCM', () => {
    const pcm = new Uint8Array(4 * 1500); // 1500 stereo frames: chunks of 1000 and 500
    pcm[4000] = 9;
    const d = muxMovie(
      [
        { kind: 'video', codec: 'jpeg', width: 32, height: 32, timescale: 600, samples: [{ data: frame(5, 20), duration: 100, sync: true }] },
        { kind: 'audio', codec: 'sowt', sampleRate: 1000, channels: 2, samples: [], pcm },
      ],
      { qt: true },
    );
    expect(text(d, 8)).toBe('qt  ');
    expect(has(d, 'jpeg')).toBe(true);
    expect(has(d, 'sowt')).toBe(true);
    expect(has(d, 'mhlr')).toBe(true);
    const boxes = readBoxes(d);
    const traks = findBox(boxes, ['moov'])!.children!.filter((b) => b.type === 'trak');
    const ao = offsets(d, traks[1]);
    expect(ao).toHaveLength(2);
    expect(ao[1] - ao[0]).toBe(4000);
    expect(d[ao[1]]).toBe(9);
    // All key frames: no sync table; sample size 1 for PCM, 1500 samples.
    expect(has(d, 'stss')).toBe(false);
    const stsz = findBox(readBoxes(d, traks[1].start + 8, traks[1].start + traks[1].size), ['mdia', 'minf', 'stbl', 'stsz'])!;
    expect([u32(d, stsz.start + 12), u32(d, stsz.start + 16)]).toEqual([1, 1500]);
  });
});
