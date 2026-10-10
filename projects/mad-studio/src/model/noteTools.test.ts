import { describe, expect, it } from 'vitest';
import { arpSequence, defaultToolValues, findTool, glue, lfoShape, quickChop, quickQuantize, random, stampNotes, tensionCurve, type ToolContext } from './noteTools';
import { inScale, scaleDegreeKey, snapToScale, stampIntervals } from './scales';
import type { Note } from './types';

const ctx: ToolContext = { grid: 24, beatsPerBar: 4, patternLength: 384, scale: null, position: 0 };
const n = (id: string, key: number, start: number, length = 24, extra: Partial<Note> = {}): Note => ({ id, key, start, length, velocity: 0.8, ...extra });
const none = new Set<string>();
const tool = (id: string) => findTool(id)!;
const run = (id: string, notes: Note[], values: Record<string, unknown> = {}, selected: Set<string> = none, c: ToolContext = ctx) =>
  tool(id).apply(notes, selected, { ...defaultToolValues(tool(id), c), ...(values as Record<string, number | string | boolean>) }, c);

describe('quantize and chop', () => {
  it('quantizes starts (and ends) with a strength', () => {
    const notes = [n('a', 60, 5, 20), n('b', 62, 30, 40)];
    expect(quickQuantize(notes, none, 24, false).map((x) => [x.start, x.length])).toEqual([[0, 20], [24, 40]]);
    expect(quickQuantize(notes, none, 24, true).map((x) => [x.start, x.length])).toEqual([[0, 24], [24, 48]]);
    expect(run('quantize', notes, { strength: 50 }).map((x) => x.start)).toEqual([3, 27]);
  });

  it('works on the selection only when there is one', () => {
    const notes = [n('a', 60, 5), n('b', 62, 29)];
    expect(quickQuantize(notes, new Set(['b']), 24, false).map((x) => x.start)).toEqual([5, 24]);
    // A stale selection counts as none.
    expect(quickQuantize(notes, new Set(['gone']), 24, false).map((x) => x.start)).toEqual([0, 24]);
  });

  it('chops long notes by the snap, keeping the properties', () => {
    const out = quickChop([n('a', 60, 0, 60, { pan: 0.5, color: 2 })], none, 24);
    expect(out.map((x) => [x.start, x.length])).toEqual([[0, 24], [24, 24], [48, 12]]);
    expect(out.every((x) => x.pan === 0.5 && x.color === 2)).toBe(true);
    expect(out[0].id).toBe('a');
    expect(run('chop', [n('a', 60, 0, 48)], { time: '24', gate: 50 }).map((x) => x.length)).toEqual([12, 12]);
  });

  it('glues touching notes of the same key and colour group', () => {
    const out = glue([n('a', 60, 0, 24), n('b', 60, 24, 24), n('c', 60, 60, 12), n('d', 62, 24, 24), n('e', 60, 30, 10, { color: 1 })], none);
    expect(out.filter((x) => x.key === 60 && !x.color).map((x) => [x.start, x.length])).toEqual([[0, 48], [60, 12]]);
    expect(out).toHaveLength(4);
  });
});

describe('chord tools', () => {
  const chord = [n('c', 60, 0, 96), n('e', 64, 0, 96), n('g', 67, 0, 96)];

  it('builds arpeggio sequences', () => {
    expect(arpSequence([67, 60, 64], 'up', 1)).toEqual([60, 64, 67]);
    expect(arpSequence([60, 64, 67], 'down', 1)).toEqual([67, 64, 60]);
    expect(arpSequence([60, 64, 67], 'upDown', 1)).toEqual([60, 64, 67, 64]);
    expect(arpSequence([60, 64], 'up', 2)).toEqual([60, 64, 72, 76]);
  });

  it('arpeggiates a chord over its length', () => {
    const out = run('arpeggiate', chord, { time: '24', gate: 50 });
    expect(out.map((x) => [x.start, x.key, x.length])).toEqual([
      [0, 60, 12],
      [24, 64, 12],
      [48, 67, 12],
      [72, 60, 12],
    ]);
  });

  it('strums a chord, keeping the note ends', () => {
    const out = run('strum', chord, { time: 12, direction: 'up' });
    expect(out.map((x) => [x.key, x.start, x.start + x.length])).toEqual([
      [60, 0, 96],
      [64, 6, 96],
      [67, 12, 96],
    ]);
    const down = run('strum', chord, { time: 12, direction: 'down', keepEnds: false });
    expect(down.find((x) => x.key === 67)!.start).toBe(0);
    expect(down.find((x) => x.key === 60)!.length).toBe(96);
  });

  it('bends the strum timing with the tension', () => {
    expect(tensionCurve(0.5, 0)).toBe(0.5);
    expect(tensionCurve(0.5, 1)).toBeLessThan(0.5);
    expect(tensionCurve(0.5, -1)).toBeGreaterThan(0.5);
    expect(tensionCurve(1, 0.7)).toBeCloseTo(1);
  });

  it('adds flams before the notes', () => {
    const out = run('flam', [n('a', 60, 24, 24), n('b', 62, 0, 24)], { time: 6, velocity: 50 });
    expect(out.map((x) => [x.start, x.key, x.length])).toEqual([
      [0, 62, 24],
      [18, 60, 6],
      [24, 60, 24],
    ]);
    expect(out[1].velocity).toBeCloseTo(0.4);
  });
});

describe('shape tools', () => {
  const line = [0, 1, 2, 3, 4, 5].map((i) => n(`n${i}`, 60 + i, i * 24));

  it('claw machine keeps and removes in a pattern and closes gaps', () => {
    expect(run('claw', line, { keep: 2, remove: 1 }).map((x) => x.start)).toEqual([0, 24, 72, 96]);
    expect(run('claw', line, { keep: 1, remove: 1, close: true }).map((x) => [x.key, x.start])).toEqual([
      [60, 0],
      [62, 24],
      [64, 48],
    ]);
  });

  it('limits notes to a key range by octaves or clamping', () => {
    const notes = [n('a', 30, 0), n('b', 100, 24), n('c', 60, 48)];
    expect(run('limit', notes, { low: 48, high: 72 }).map((x) => x.key)).toEqual([54, 64, 60]);
    expect(run('limit', notes, { low: 48, high: 72, mode: 'clamp' }).map((x) => x.key)).toEqual([48, 72, 60]);
  });

  it('flips horizontally and vertically', () => {
    const notes = [n('a', 60, 0, 24), n('b', 67, 48, 48)];
    expect(run('flip', notes).map((x) => [x.key, x.start])).toEqual([
      [67, 0],
      [60, 72],
    ]);
    expect(run('flip', notes, { direction: 'vertical' }).map((x) => x.key)).toEqual([67, 60]);
  });

  it('randomizes deterministically with a seed', () => {
    const a = run('randomize', line, { time: 6, velocity: 30, seed: 5 });
    const b = run('randomize', line, { time: 6, velocity: 30, seed: 5 });
    const c = run('randomize', line, { time: 6, velocity: 30, seed: 6 });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a.every((x) => x.velocity >= 0 && x.velocity <= 1)).toBe(true);
    const r = random(1);
    expect(r()).not.toBe(r());
  });

  it('scales and inverts levels', () => {
    const notes = [n('a', 60, 0, 24, { velocity: 0.2 }), n('b', 62, 24, 24, { velocity: 0.6 })];
    const scaled = run('scaleLevels', notes, { property: 'velocity', scale: 50, center: 'average' }).map((x) => x.velocity);
    expect(scaled[0]).toBeCloseTo(0.3);
    expect(scaled[1]).toBeCloseTo(0.5);
    const pans = run('scaleLevels', [n('a', 60, 0, 24, { pan: 0.5 })], { property: 'pan', invert: true });
    expect(pans[0].pan).toBeCloseTo(-0.5);
  });

  it('articulates note lengths', () => {
    const notes = [n('a', 60, 0, 48), n('b', 62, 96, 48)];
    expect(run('articulate', notes, { amount: 50 }).map((x) => x.length)).toEqual([24, 24]);
    expect(run('articulate', notes, { mode: 'legato', amount: 100 }).map((x) => x.length)).toEqual([96, 48]);
    expect(run('articulate', notes, { mode: 'fixed', time: '12', amount: 100 }).map((x) => x.length)).toEqual([12, 12]);
  });

  it('draws an LFO into a property', () => {
    expect(lfoShape('sine', 0.25)).toBeCloseTo(1);
    expect(lfoShape('triangle', 0.5)).toBe(1);
    expect(lfoShape('square', 0.75)).toBe(-1);
    const out = run('lfo', [0, 96, 192, 288].map((t, i) => n(`l${i}`, 60, t)), { property: 'pan', time: 'bar', amount: 100 });
    expect(out.map((x) => Math.round((x.pan ?? 0) * 100) / 100)).toEqual([0, 1, 0, -1]);
  });
});

describe('generators and scales', () => {
  it('knows scales and snaps to them', () => {
    const cMajor = { root: 0, type: 'major' as const };
    expect(inScale(61, cMajor)).toBe(false);
    expect(snapToScale(61, cMajor)).toBe(62);
    expect(snapToScale(61, cMajor, -1)).toBe(60);
    expect(scaleDegreeKey({ root: 9, type: 'minor' }, 57, 2)).toBe(60);
    expect(scaleDegreeKey(cMajor, 60, 7)).toBe(72);
  });

  it('generates a chord progression from the last click in the project scale', () => {
    const c = { ...ctx, position: 384, scale: { root: 9, type: 'minor' as const } };
    const values = defaultToolValues(tool('chords'), c);
    expect(values).toMatchObject({ root: '9', scale: 'minor' });
    const out = tool('chords').apply([], none, { ...values, progression: '0,3,4,0', octave: 4, time: 'bar' }, c);
    // A minor: Am (A C E), Dm (D F A), Em (E G B), Am – four bars from tick 384.
    expect(out.filter((x) => x.start === 384).map((x) => x.key)).toEqual([57, 60, 64]);
    expect(out.filter((x) => x.start === 768).map((x) => x.key)).toEqual([62, 65, 69]);
    expect(out.filter((x) => x.start === 1152).map((x) => x.key)).toEqual([64, 67, 71]);
    expect(out).toHaveLength(12);
  });

  it('generates a riff inside the scale', () => {
    const c = { ...ctx, scale: { root: 0, type: 'majorPentatonic' as const } };
    const out = tool('riff').apply([], none, { ...defaultToolValues(tool('riff'), c), seed: 3 }, c);
    expect(out.length).toBeGreaterThan(4);
    expect(out.every((x) => inScale(x.key, c.scale) && x.start < 768)).toBe(true);
    expect(tool('riff').apply([], none, { ...defaultToolValues(tool('riff'), c), seed: 3 }, c).map((x) => [x.key, x.start])).toEqual(out.map((x) => [x.key, x.start]));
  });

  it('stamps chords and scales', () => {
    expect(stampIntervals('chord:maj7')).toEqual([0, 4, 7, 11]);
    expect(stampIntervals('scale:minorPentatonic')).toEqual([0, 3, 5, 7, 10]);
    const notes = stampNotes(stampIntervals('chord:minor'), 69, 96, 48, { velocity: 0.7, color: 3 });
    expect(notes.map((x) => x.key)).toEqual([69, 72, 76]);
    expect(notes.every((x) => x.start === 96 && x.length === 48 && x.color === 3)).toBe(true);
  });
});
