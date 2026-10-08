import { describe, expect, it } from 'vitest';
import {
  assignAt,
  celAt,
  deleteFrames,
  emptyTrack,
  insertFrames,
  nextCelName,
  nextTrackName,
  onionCels,
  onionOpacity,
  pruneTrack,
  remapTrack,
  removeAt,
  sanitizeOnion,
  sanitizeTimeline,
  sanitizeTrack,
  tintOnion,
  DEFAULT_ONION,
  type AnimationTrack,
} from './animation';

const track = (...pairs: [number, string | null][]): AnimationTrack => ({ cels: pairs.map(([frame, cel]) => ({ frame, cel })) });

describe('animation tracks', () => {
  it('shows a cel from its frame until the next assignment; an empty one shows nothing', () => {
    const t = track([1, 'a'], [3, 'b'], [5, null], [7, 'a']);
    expect([1, 2, 3, 4, 5, 6, 7, 9].map((f) => celAt(t, f))).toEqual(['a', 'a', 'b', 'b', null, null, 'a', 'a']);
    expect(celAt(track([2, 'a']), 1)).toBeNull();
    expect(celAt(emptyTrack(), 1)).toBeNull();
  });

  it('assigns, replaces and removes assignments, keeping them sorted', () => {
    let t = assignAt(emptyTrack(), 4, 'b');
    t = assignAt(t, 1, 'a');
    t = assignAt(t, 4, 'c');
    expect(t.cels).toEqual([
      { frame: 1, cel: 'a' },
      { frame: 4, cel: 'c' },
    ]);
    // Removing an assignment lets the one before show on.
    expect(celAt(removeAt(t, 4), 5)).toBe('a');
  });

  it('inserts and deletes frames', () => {
    const t = track([1, 'a'], [3, 'b'], [6, 'c']);
    expect(insertFrames(t, 3, 2).cels.map((a) => a.frame)).toEqual([1, 5, 8]);
    // Deleting frames 2–4: b (from 3) still shows right after, now at frame 2; c moves to 3.
    const d = deleteFrames(t, 2, 3);
    expect([1, 2, 3].map((f) => celAt(d, f))).toEqual(['a', 'b', 'c']);
    // Deleting frames that only held a cel changes nothing but the length.
    expect(deleteFrames(track([1, 'a'], [5, 'b']), 2, 2).cels).toEqual([
      { frame: 1, cel: 'a' },
      { frame: 3, cel: 'b' },
    ]);
  });

  it('drops deleted cels and remaps copied ones', () => {
    const t = track([1, 'a'], [2, 'b'], [3, null]);
    expect(pruneTrack(t, new Set(['a'])).cels).toEqual([
      { frame: 1, cel: 'a' },
      { frame: 3, cel: null },
    ]);
    expect(pruneTrack(t, new Set(['a', 'b']))).toBe(t);
    expect(remapTrack(t, new Map([['a', 'x']])).cels.map((a) => a.cel)).toEqual(['x', 'b', null]);
  });

  it('finds the onion skin cels before and after in timeline order', () => {
    const t = track([1, 'a'], [2, 'b'], [3, 'c'], [5, 'b'], [6, 'd'], [8, 'e']);
    // At frame 3 (c) the next cel in timeline order is b again (frame 5).
    expect(onionCels(t, 3, 2, 2)).toEqual({ prev: ['b', 'a'], next: ['b', 'd'] });
    // The current cel is never its own skin; each cel only once.
    expect(onionCels(t, 5, 3, 1)).toEqual({ prev: ['c', 'a'], next: ['d'] });
    expect(onionCels(t, 9, 1, 1)).toEqual({ prev: ['d'], next: [] });
  });
});

describe('animation names', () => {
  it('numbers cels and letters animation folders like the reference', () => {
    expect(nextCelName([])).toBe('1');
    expect(nextCelName(['1', '2', 'Layer'])).toBe('3');
    expect(nextCelName(['A'])).toBe('B');
    expect(nextTrackName([])).toBe('A');
    expect(nextTrackName(['A', 'Folder', 'C'])).toBe('D');
  });
});

describe('onion skin', () => {
  it('fades further skins and tints them', () => {
    expect(onionOpacity(DEFAULT_ONION, 0)).toBe(0.5);
    expect(onionOpacity(DEFAULT_ONION, 1)).toBeCloseTo(0.35);
    expect(onionOpacity({ ...DEFAULT_ONION, step: 1 }, 3)).toBe(0.05);
    const half = new Uint8ClampedArray([0, 0, 0, 255, 9, 9, 9, 0]);
    tintOnion(half, 'half', { r: 200, g: 100, b: 0 });
    expect([...half]).toEqual([100, 50, 0, 255, 9, 9, 9, 0]);
    const mono = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
    tintOnion(mono, 'mono', { r: 10, g: 20, b: 30 });
    expect([...mono]).toEqual([10, 20, 30, 255, 10, 20, 30, 0]);
  });
});

describe('animation files', () => {
  it('sanitizes timelines, tracks and onion settings', () => {
    expect(sanitizeTimeline({ fps: 500, frames: -3, enabled: false })).toEqual({ enabled: false, fps: 120, frames: 1 });
    expect(sanitizeTimeline(null)).toBeUndefined();
    expect(sanitizeTrack({ cels: [{ frame: 3, cel: 'b' }, { frame: 1, cel: 'a' }, { frame: 3, cel: 'c' }, { frame: 0, cel: 'x' }, { frame: 2 }] })).toEqual({
      cels: [
        { frame: 1, cel: 'a' },
        { frame: 2, cel: null },
        { frame: 3, cel: 'c' },
      ],
    });
    expect(sanitizeOnion({ before: 99, mode: 'mono', prevColor: 'red' })).toEqual({ ...DEFAULT_ONION, before: 10, mode: 'mono' });
  });
});
