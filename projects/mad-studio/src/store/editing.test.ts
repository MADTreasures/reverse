import { beforeEach, describe, expect, it } from 'vitest';
import { compileAutomationLanes } from '../model/automation';
import { foldIntoLoop, songTimeline, withLoop } from '../model/timeline';
import { PPQ, TICKS_PER_STEP, formatDuration, gridLineTicks, snapTicks } from '../model/timing';
import {
  addNotes,
  addPattern,
  redo,
  setBpm,
  undo,
  cloneTrack,
  findFirstEmptyPattern,
  insertPattern,
  movePattern,
  splitPatternByChannel,
  transposePattern,
  deleteTrack,
  insertTrack,
  legatoNotes,
  makeClipUnique,
  moveTrack,
  placePatternClip,
  setClipPattern,
  setClipsMuted,
  setTrackClipsMuted,
  sliceClips,
  sliceNotes,
} from './actions';
import { createAutomationClip } from './automationActions';
import { pianoRollSnap, patternStartTick } from './snap';
import { resetStore, useStore } from './store';

const state = () => useStore.getState();

beforeEach(() => resetStore());

describe('snap (FL Studio: Main, Line, Cell)', () => {
  it('follows the zoom for Line and Cell', () => {
    expect(gridLineTicks(0.9, 4)).toBe(TICKS_PER_STEP);
    expect(gridLineTicks(2, 4)).toBe(12);
    expect(gridLineTicks(0.18, 4)).toBe(PPQ);
    expect(gridLineTicks(0.01, 4)).toBe(PPQ * 4 * 8);
    expect(snapTicks('line', 4, 48)).toBe(48);
    expect(snapTicks('cell', 4, 12)).toBe(12);
  });

  it('resolves Main through the toolbar snap', () => {
    expect(snapTicks('main', 4, 24, 'beat')).toBe(PPQ);
    expect(snapTicks('main', 4, 24, 'line')).toBe(24);
    expect(snapTicks('1/6 beat', 4)).toBe(16);
    expect(snapTicks('1/4 beat', 4)).toBe(24);
    useStore.setState((s) => ({ ui: { ...s.ui, mainSnap: 'bar', pianoRoll: { ...s.ui.pianoRoll, snap: 'main' } } }));
    expect(pianoRollSnap(state())).toBe(PPQ * 4);
  });

  it('formats lengths from zero', () => {
    expect(formatDuration(TICKS_PER_STEP * 6, 4)).toBe('0:06:00');
    expect(formatDuration(PPQ * 4 + 5, 4)).toBe('1:00:05');
  });
});

describe('pattern start position', () => {
  it('only applies inside the pattern', () => {
    useStore.setState((s) => ({ transport: { ...s.transport, patternStart: PPQ } }));
    expect(patternStartTick(state())).toBe(PPQ);
    useStore.setState((s) => ({ transport: { ...s.transport, patternStart: PPQ * 400 } }));
    expect(patternStartTick(state())).toBe(0);
  });
});

describe('quick legato', () => {
  it('extends notes to the next note start', () => {
    const { ui, project } = state();
    const ch = project.channels[0].id;
    addNotes(ui.selectedPatternId, ch, [
      { key: 60, start: 0, length: 12, velocity: 0.8 },
      { key: 64, start: 0, length: 12, velocity: 0.8 },
      { key: 62, start: 96, length: 12, velocity: 0.8 },
      { key: 65, start: 240, length: 12, velocity: 0.8 },
    ]);
    legatoNotes(ui.selectedPatternId, ch, new Set());
    const notes = state().project.patterns[0].notes[ch];
    expect(notes.filter((n) => n.start === 0).map((n) => n.length)).toEqual([96, 96]);
    expect(notes.find((n) => n.start === 96)?.length).toBe(144);
    expect(notes.find((n) => n.start === 240)?.length).toBe(12);
  });
});

describe('clips', () => {
  it('muted clips stay in the playlist but do not play', () => {
    const { ui, project } = state();
    const ch = project.channels[0].id;
    addNotes(ui.selectedPatternId, ch, [{ key: 60, start: 0, length: 24, velocity: 0.8 }]);
    const id = placePatternClip(ui.selectedPatternId, project.tracks[0].id, 0)!;
    expect(songTimeline(state().project).events.length).toBeGreaterThan(0);
    setClipsMuted([id]);
    expect(state().project.clips[0].muted).toBe(true);
    expect(songTimeline(state().project).events.length).toBe(0);
    setTrackClipsMuted(project.tracks[0].id, false);
    expect(state().project.clips[0].muted).toBeUndefined();
  });

  it('muted automation clips are ignored', () => {
    const target = `ch:${state().project.channels[0].id}:volume`;
    createAutomationClip(target);
    expect(compileAutomationLanes(state().project).some((l) => l.target === target)).toBe(true);
    const clip = state().project.clips.find((c) => c.kind === 'automation')!;
    setClipsMuted([clip.id], true);
    expect(compileAutomationLanes(state().project).some((l) => l.target === target)).toBe(false);
  });

  it('make unique gives a shared clip its own pattern', () => {
    const { ui, project } = state();
    const a = placePatternClip(ui.selectedPatternId, project.tracks[0].id, 0)!;
    placePatternClip(ui.selectedPatternId, project.tracks[0].id, PPQ * 8);
    const before = state().project.patterns.length;
    const copy = makeClipUnique(a)!;
    const s = state().project;
    expect(s.patterns.length).toBe(before + 1);
    expect(s.clips.find((c) => c.id === a)).toMatchObject({ kind: 'pattern', patternId: copy });
    expect(s.patterns.find((p) => p.id === copy)?.name).toMatch(/#2$/);
    setClipPattern(a, ui.selectedPatternId);
    expect(state().project.clips.find((c) => c.id === a)).toMatchObject({ patternId: ui.selectedPatternId });
  });
});

describe('playlist tracks', () => {
  it('inserts, clones, moves and deletes tracks with their clips', () => {
    const { ui, project } = state();
    const count = project.tracks.length;
    const first = project.tracks[0].id;
    placePatternClip(ui.selectedPatternId, first, 0);
    insertTrack(0);
    expect(state().project.tracks.length).toBe(count + 1);
    expect(state().project.tracks[1].id).toBe(first);
    cloneTrack(first);
    const s = state().project;
    expect(s.tracks[2].name).not.toBe(s.tracks[1].name);
    expect(s.clips.filter((c) => c.trackId === s.tracks[2].id).length).toBe(1);
    moveTrack(first, -1);
    expect(state().project.tracks[0].id).toBe(first);
    deleteTrack(first);
    expect(state().project.tracks.some((t) => t.id === first)).toBe(false);
    expect(state().project.clips.some((c) => c.trackId === first)).toBe(false);
  });
});

describe('patterns menu (FL Studio)', () => {
  it('finds the first empty pattern, inserts, moves and transposes', () => {
    const first = state().ui.selectedPatternId;
    const ch = state().project.channels[0].id;
    addNotes(first, ch, [{ key: 60, start: 0, length: 24, velocity: 0.8 }]);
    const second = addPattern();
    expect(findFirstEmptyPattern()).toBe(second);
    const inserted = insertPattern(second);
    expect(state().project.patterns.map((p) => p.id)).toEqual([first, inserted, second]);
    movePattern(inserted, 1);
    expect(state().project.patterns.map((p) => p.id)).toEqual([first, second, inserted]);
    movePattern(first, -1);
    expect(state().project.patterns[0].id).toBe(first);
    transposePattern(first, 12);
    expect(state().project.patterns[0].notes[ch][0].key).toBe(72);
    transposePattern(first, 100);
    expect(state().project.patterns[0].notes[ch][0].key).toBe(127);
  });
});

describe('time selection (loop)', () => {
  it('limits the song timeline and folds positions into it', () => {
    const tl = { events: [], start: 0, end: 4000 };
    expect(withLoop(tl, null)).toBe(tl);
    expect(withLoop(tl, { start: 384, end: 768 })).toMatchObject({ start: 384, end: 768 });
    expect(withLoop(tl, { start: 500, end: 500 })).toBe(tl);
    expect(foldIntoLoop(1000, { start: 384, end: 768 })).toBe(616);
    expect(foldIntoLoop(100, { start: 384, end: 768 })).toBe(484);
    expect(foldIntoLoop(400, { start: 384, end: 768 })).toBe(400);
    expect(foldIntoLoop(1000, null)).toBe(1000);
  });
});

describe('slice tool', () => {
  it('cuts clips and keeps the source position of the right part', () => {
    const { ui, project } = state();
    const id = placePatternClip(ui.selectedPatternId, project.tracks[0].id, 384)!;
    const before = state().project.clips.find((c) => c.id === id)!;
    const [right] = sliceClips([id], 384 + 96);
    const s = state().project;
    expect(s.clips.find((c) => c.id === id)).toMatchObject({ start: 384, length: 96, offset: 0 });
    expect(s.clips.find((c) => c.id === right)).toMatchObject({ start: 480, length: before.length - 96, offset: 96 });
    expect(sliceClips([id], 384)).toEqual([]); // at the edge: nothing to cut
  });

  it('cuts notes', () => {
    const { ui, project } = state();
    const ch = project.channels[0].id;
    const [id] = addNotes(ui.selectedPatternId, ch, [{ key: 60, start: 0, length: 96, velocity: 0.5 }]);
    sliceNotes(ui.selectedPatternId, ch, [id], 24);
    const notes = state().project.patterns[0].notes[ch].filter((n) => n.key === 60);
    expect(notes.map((n) => [n.start, n.length, n.velocity])).toEqual([
      [0, 24, 0.5],
      [24, 72, 0.5],
    ]);
  });
});

describe('named undo steps (FL Studio: "Undo piano roll add note", "Level 2/34")', () => {
  it('records labels, merges coalesced edits and reports the level', () => {
    const { ui, project } = state();
    const ch = project.channels[0].id;
    addNotes(ui.selectedPatternId, ch, [{ key: 60, start: 0, length: 24, velocity: 0.8 }], { coalesce: 'g1' });
    addNotes(ui.selectedPatternId, ch, [{ key: 62, start: 24, length: 24, velocity: 0.8 }], { coalesce: 'g1' });
    setBpm(140);
    expect(state().pastLabels).toEqual(['piano roll add note', 'tempo']);
    expect(undo()).toEqual({ label: 'tempo', level: 2, total: 3 });
    expect(state().futureLabels).toEqual(['tempo']);
    expect(undo()).toEqual({ label: 'piano roll add note', level: 3, total: 3 });
    expect(undo()).toBeNull();
    expect(redo()).toEqual({ label: 'piano roll add note', level: 2, total: 3 });
    expect(redo()).toEqual({ label: 'tempo', level: 1, total: 3 });
    expect(state().project.bpm).toBe(140);
  });
});

describe('split by channel (FL Studio)', () => {
  it('keeps the first channel in the pattern and moves the others to new patterns', () => {
    const { ui, project } = state();
    const [a, b, c] = project.channels;
    addNotes(ui.selectedPatternId, a.id, [{ key: 60, start: 0, length: 24, velocity: 0.8 }]);
    addNotes(ui.selectedPatternId, c.id, [{ key: 62, start: 48, length: 24, velocity: 0.8 }]);
    const clip = placePatternClip(ui.selectedPatternId, project.tracks[0].id, 0)!;
    const created = splitPatternByChannel(ui.selectedPatternId);
    const s = state().project;
    expect(created).toHaveLength(1);
    const original = s.patterns.find((p) => p.id === ui.selectedPatternId)!;
    expect(original.name).toBe(a.name);
    expect(Object.keys(original.notes).filter((k) => original.notes[k].length)).toEqual([a.id]);
    const split = s.patterns.find((p) => p.id === created[0])!;
    expect(split.name).toBe(c.name);
    expect(split.notes[c.id].map((n) => n.start)).toEqual([48]);
    expect(split.notes[b.id]).toBeUndefined();
    expect(s.clips.find((x) => x.id === clip)).toMatchObject({ patternId: ui.selectedPatternId });
    expect(splitPatternByChannel(ui.selectedPatternId)).toEqual([]);
  });
});
