import { describe, expect, it } from 'vitest';
import { createEmptyProject, createPattern, createSynthChannel } from './defaults';
import { DEFAULT_GLIDE_TIME, MAX_NOTE_BENDS, minPitch, modXFactor, noteResonance, noteStyle, noteValue, pitchAt, pitchCurve, releaseScale, setNoteValue } from './notes';
import { parseProject } from './serialization';
import { patternTimeline, songTimeline } from './timeline';
import type { Note, Project } from './types';

function setup(notes: Omit<Note, 'id'>[]): { project: Project; channelId: string; patternId: string } {
  const project = createEmptyProject();
  const ch = createSynthChannel();
  project.channels = [ch];
  const pattern = createPattern('P', '#fff');
  pattern.notes[ch.id] = notes.map((n, i) => ({ ...n, id: `n${i}` }));
  project.patterns = [pattern];
  return { project, channelId: ch.id, patternId: pattern.id };
}

describe('note values', () => {
  it('reads defaults for absent properties and drops values equal to the default', () => {
    const n: Note = { id: 'n', key: 60, start: 0, length: 24, velocity: 0.8 };
    expect(noteValue(n, 'pan')).toBe(0);
    expect(noteValue(n, 'release')).toBe(0.5);
    setNoteValue(n, 'pan', -2);
    expect(n.pan).toBe(-1);
    setNoteValue(n, 'fine', 37.4);
    expect(n.fine).toBe(37);
    setNoteValue(n, 'pan', 0);
    expect('pan' in n).toBe(false);
    setNoteValue(n, 'velocity', 3);
    expect(n.velocity).toBe(1);
  });

  it('copies a note style without position', () => {
    const style = noteStyle({ id: 'n', key: 61, start: 5, length: 9, velocity: 0.4, pan: 0.5, color: 3 });
    expect(style).toEqual({ velocity: 0.4, pan: 0.5, color: 3 });
  });

  it('shapes the sound with the shared formulas', () => {
    expect(modXFactor(undefined)).toBe(1);
    expect(modXFactor(1)).toBeCloseTo(16);
    expect(modXFactor(0)).toBeCloseTo(1 / 16);
    expect(noteResonance(2, undefined)).toBe(2);
    expect(noteResonance(2, 1)).toBeCloseTo(8);
    expect(noteResonance(20, 1)).toBe(24);
    expect(releaseScale(0.5)).toBe(1);
    expect(releaseScale(1)).toBeCloseTo(2);
    expect(releaseScale(0)).toBeCloseTo(0.5);
  });
});

describe('pitch curves', () => {
  it('is null for a note that never moves', () => {
    expect(pitchCurve(undefined, undefined, undefined, 0.01)).toBeNull();
    expect(pitchCurve(0, 0.1, [], 0.01)).toBeNull();
  });

  it('glides linearly in semitones and lets a bend take over mid-glide', () => {
    const c = pitchCurve(5, 1, [{ at: 50, length: 100, to: -3 }], 0.01)!;
    expect(pitchAt(c, 0)).toBe(5);
    expect(pitchAt(c, 0.25)).toBeCloseTo(3.75);
    // The bend starts at 0.5 s from the glide's 2.5 semitones and reaches -3 at 1.5 s.
    expect(pitchAt(c, 1)).toBeCloseTo((2.5 - 3) / 2);
    expect(pitchAt(c, 3)).toBe(-3);
    expect(minPitch(c)).toBe(-3);
  });
});

describe('timeline note properties', () => {
  it('passes note properties to the events and leaves muted notes out', () => {
    const { project, patternId } = setup([
      { key: 60, start: 0, length: 24, velocity: 0.8, pan: -0.5, fine: 20, release: 0.9, modX: 0.2, modY: 0.7, color: 2 },
      { key: 62, start: 24, length: 24, velocity: 0.8, muted: true },
    ]);
    const tl = patternTimeline(project, patternId);
    expect(tl.events).toHaveLength(1);
    expect(tl.events[0]).toMatchObject({ pan: -0.5, fine: 20, release: 0.9, modX: 0.2, modY: 0.7, color: 2 });
    expect(tl.events[0].bends).toBeUndefined();
  });

  it('resolves slide notes into bends of the notes of their colour group', () => {
    const { project, patternId } = setup([
      // A C major chord (group 0) and a separate note in group 1.
      { key: 60, start: 0, length: 192, velocity: 0.8 },
      { key: 64, start: 0, length: 192, velocity: 0.8 },
      { key: 67, start: 0, length: 192, velocity: 0.8 },
      { key: 48, start: 0, length: 192, velocity: 0.8, color: 1 },
      // Slide the chord so its top note lands on A (69) over 24 ticks, then again to C6 (72).
      { key: 69, start: 48, length: 24, velocity: 0.8, slide: true },
      { key: 72, start: 96, length: 12, velocity: 0.8, slide: true },
      // A slide with nothing to move plays nothing.
      { key: 50, start: 300, length: 12, velocity: 0.8, slide: true },
    ]);
    const tl = patternTimeline(project, patternId);
    expect(tl.events.map((e) => e.key)).toEqual([48, 60, 64, 67]);
    const byKey = new Map(tl.events.map((e) => [e.key, e]));
    expect(byKey.get(67)!.bends).toEqual([
      { at: 48, length: 24, to: 2 },
      { at: 96, length: 12, to: 5 },
    ]);
    expect(byKey.get(60)!.bends).toEqual(byKey.get(67)!.bends);
    expect(byKey.get(48)!.bends).toBeUndefined();
  });

  it('gives portamento notes the pitch of the previous note on their channel', () => {
    const { project, patternId } = setup([
      { key: 60, start: 0, length: 24, velocity: 0.8 },
      { key: 67, start: 24, length: 24, velocity: 0.8, porta: true },
      { key: 64, start: 48, length: 24, velocity: 0.8, porta: true },
      { key: 64, start: 72, length: 24, velocity: 0.8, porta: true },
    ]);
    const tl = patternTimeline(project, patternId);
    expect(tl.events.map((e) => e.glideFrom)).toEqual([undefined, -7, 3, undefined]);
    expect(tl.events[1].glideTime).toBe(DEFAULT_GLIDE_TIME);
  });

  it('caps the bends of one note at the native engine limit', () => {
    const notes: Omit<Note, 'id'>[] = [{ key: 60, start: 0, length: 960, velocity: 0.8 }];
    for (let i = 0; i < MAX_NOTE_BENDS + 3; i++) notes.push({ key: 61 + i, start: 10 + i * 20, length: 10, velocity: 0.8, slide: true });
    const { project, patternId } = setup(notes);
    expect(patternTimeline(project, patternId).events[0].bends).toHaveLength(MAX_NOTE_BENDS);
  });

  it('resolves slides across pattern clips in the song', () => {
    const { project, patternId } = setup([
      { key: 60, start: 0, length: 384, velocity: 0.8 },
      { key: 65, start: 96, length: 48, velocity: 0.8, slide: true },
    ]);
    project.clips = [{ id: 'c1', kind: 'pattern', trackId: project.tracks[0].id, start: 384, length: 384, offset: 0, patternId }];
    const tl = songTimeline(project);
    expect(tl.events).toHaveLength(1);
    expect(tl.events[0]).toMatchObject({ tick: 384, key: 60, bends: [{ at: 96, length: 48, to: 5 }] });
  });
});

describe('note properties in project files', () => {
  it('round-trips the properties and drops defaults and junk', () => {
    const { project, channelId } = setup([
      { key: 60, start: 0, length: 24, velocity: 0.8, pan: 0.25, fine: -50, release: 0.1, modX: 0.9, modY: 0.3, color: 4, porta: true, muted: true },
      { key: 62, start: 24, length: 24, velocity: 0.8, slide: true },
    ]);
    const json = JSON.parse(JSON.stringify(project)) as { patterns: { notes: Record<string, Record<string, unknown>[]> }[] };
    json.patterns[0].notes[channelId].push({ id: 'x', key: 64, start: 48, length: 24, velocity: 0.8, pan: 'left', fine: 99999, color: 40, modX: 0.5, slide: true, porta: true });
    const back = parseProject(json);
    const notes = back.patterns[0].notes[channelId];
    expect(notes[0]).toEqual({ id: 'n0', key: 60, start: 0, length: 24, velocity: 0.8, pan: 0.25, fine: -50, release: 0.1, modX: 0.9, modY: 0.3, color: 4, porta: true, muted: true });
    expect(notes[1]).toEqual({ id: 'n1', key: 62, start: 24, length: 24, velocity: 0.8, slide: true });
    // Out-of-range values are clamped, the default Mod X is dropped, a note is slide or porta, not both.
    expect(notes[2]).toEqual({ id: 'x', key: 64, start: 48, length: 24, velocity: 0.8, fine: 1200, color: 15, slide: true });
  });
});
