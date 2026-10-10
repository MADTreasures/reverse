import { beforeEach, describe, expect, it } from 'vitest';
import {
  addArrangement,
  addMarker,
  addTimeSignature,
  arrangementList,
  cloneArrangement,
  deleteArrangement,
  deleteMarker,
  placePatternClip,
  renameArrangement,
  switchArrangement,
  undo,
  updateMarker,
} from '../store/actions';
import { resetStore, useStore } from '../store/store';
import { createEmptyProject } from './defaults';
import { adjacentMarker, barLines, beatsIn, createMarker, formatSongPosition, parseSignature, positionAt, signatureMap, songStartTick } from './markers';
import { parseProject } from './serialization';
import { songTimeline } from './timeline';

const state = () => useStore.getState();

describe('time signatures', () => {
  // 4/4 from bar 1, 3/4 from tick 1536 (bar 5), 7/8 from tick 2400 (after 3 bars of 3/4 = 864 ticks).
  const project = { beatsPerBar: 4, markers: [createMarker(2400, '7/8', 'timeSignature', { numerator: 7, denominator: 8 }), createMarker(1536, '3/4', 'timeSignature', { numerator: 3, denominator: 4 })] };
  const map = signatureMap(project);

  it('builds the signature map from the markers', () => {
    expect(map).toEqual([
      { tick: 0, numerator: 4, denominator: 4 },
      { tick: 1536, numerator: 3, denominator: 4 },
      { tick: 2400, numerator: 7, denominator: 8 },
    ]);
    expect(parseSignature('6/8')).toEqual({ numerator: 6, denominator: 8 });
    expect(parseSignature('5/3')).toBeNull();
    expect(parseSignature('0/4')).toBeNull();
  });

  it('numbers bars and finds positions across changes', () => {
    expect(barLines(map, 0, 2700).map((b) => [b.tick, b.bar])).toEqual([
      [0, 0],
      [384, 1],
      [768, 2],
      [1152, 3],
      [1536, 4],
      [1824, 5],
      [2112, 6],
      [2400, 7],
      [2736 - 336 + 336, 8],
    ].filter(([t]) => t < 2700));
    expect(positionAt(map, 1824 + 96 + 10)).toMatchObject({ bar: 5, beat: 1, ticks: 10 });
    expect(positionAt(map, 2400 + 48 * 3)).toMatchObject({ bar: 7, beat: 3, ticks: 0 });
    expect(formatSongPosition(map, 1536)).toBe('5:01:00');
    expect(formatSongPosition(map, 2400 + 48)).toBe('8:03:00');
  });

  it('starts a new bar at a change in the middle of a bar', () => {
    const odd = signatureMap({ beatsPerBar: 4, markers: [createMarker(576, '3/4', 'timeSignature', { numerator: 3, denominator: 4 })] });
    expect(barLines(odd, 0, 1000).map((b) => [b.tick, b.bar])).toEqual([
      [0, 0],
      [384, 1],
      [576, 2],
      [864, 3],
    ]);
  });

  it('gives the metronome the beats and accents of the signature', () => {
    const beats = beatsIn(map, 2112, 2400 + 48 * 8);
    expect(beats.map((b) => [b.tick, b.accent])).toEqual([
      [2112, true],
      [2208, false],
      [2304, false],
      [2400, true],
      [2448, false],
      [2496, false],
      [2544, false],
      [2592, false],
      [2640, false],
      [2688, false],
      [2736, true],
    ]);
  });

  it('puts the map into the song timeline only when the signature changes', () => {
    const p = createEmptyProject();
    expect(songTimeline(p).signatures).toBeUndefined();
    p.markers = [createMarker(384, '6/8', 'timeSignature', { numerator: 6, denominator: 8 })];
    expect(songTimeline(p).signatures).toEqual([
      { tick: 0, numerator: 4, denominator: 4 },
      { tick: 384, numerator: 6, denominator: 8 },
    ]);
  });
});

describe('time markers', () => {
  beforeEach(() => resetStore());

  it('adds, moves, renames and deletes markers; jumps and the start marker', () => {
    const a = addMarker(768, 'Verse');
    const b = addMarker(96, 'Intro', 'start');
    expect(state().project.markers!.map((m) => m.name)).toEqual(['Intro', 'Verse']);
    expect(songStartTick(state().project)).toBe(96);
    expect(adjacentMarker(state().project, 100, 1)?.id).toBe(a);
    expect(adjacentMarker(state().project, 768, -1)?.id).toBe(b);
    updateMarker(a, (m) => {
      m.tick = 20.4;
      m.name = 'Pre';
    });
    expect(state().project.markers!.map((m) => [m.name, m.tick])).toEqual([
      ['Pre', 20],
      ['Intro', 96],
    ]);
    deleteMarker(b);
    expect(songStartTick(state().project)).toBe(0);
    undo();
    expect(state().project.markers).toHaveLength(2);
  });

  it('applies a time signature to the time selection and restores the old one after it', () => {
    addTimeSignature(0, { numerator: 7, denominator: 8 }, { start: 384, end: 1152 });
    const map = signatureMap(state().project);
    expect(map).toEqual([
      { tick: 0, numerator: 4, denominator: 4 },
      { tick: 384, numerator: 7, denominator: 8 },
      { tick: 1152, numerator: 4, denominator: 4 },
    ]);
  });

  it('round-trips markers and arrangements through the project file', () => {
    addMarker(384, 'Drop', 'start');
    addTimeSignature(768, { numerator: 3, denominator: 4 });
    addArrangement();
    renameArrangement('Radio edit');
    const raw = JSON.parse(JSON.stringify(state().project));
    raw.markers = [{ id: 'bad', tick: -5, name: 'Bad', action: 'timeSignature', numerator: 4, denominator: 3 }];
    const loaded = parseProject(raw);
    expect(loaded.arrangement?.name).toBe('Radio edit');
    expect(loaded.arrangements?.[0].markers.map((m) => [m.name, m.tick, m.action])).toEqual([
      ['Drop', 384, 'start'],
      ['3/4', 768, 'timeSignature'],
    ]);
    expect(loaded.markers).toEqual([{ id: 'bad', tick: 0, name: 'Bad' }]);
  });
});

describe('arrangements', () => {
  beforeEach(() => resetStore());

  it('adds, clones, switches, renames and deletes arrangements that share the patterns', () => {
    const pattern = state().ui.selectedPatternId;
    placePatternClip(pattern, state().project.tracks[0].id, 0);
    addMarker(192, 'A');
    expect(arrangementList(state().project).map((a) => a.name)).toEqual(['Arrangement']);

    const empty = addArrangement();
    expect(state().project.arrangement).toEqual({ id: empty, name: 'Arrangement 2' });
    expect(state().project.clips).toHaveLength(0);
    expect(state().project.markers).toBeUndefined();

    switchArrangement('arr_main');
    expect(state().project.clips).toHaveLength(1);
    expect(state().project.markers).toHaveLength(1);

    const copy = cloneArrangement();
    expect(state().project.arrangement?.name).toBe('Arrangement (clone)');
    expect(state().project.clips[0].id).not.toBe(state().project.arrangements!.find((a) => a.id === 'arr_main')!.clips[0].id);
    expect(arrangementList(state().project).map((a) => [a.name, a.current])).toEqual([
      ['Arrangement', false],
      ['Arrangement (clone)', true],
      ['Arrangement 2', false],
    ]);

    renameArrangement('Extended');
    expect(deleteArrangement()).toBe(true);
    expect(arrangementList(state().project).some((a) => a.id === copy)).toBe(false);
    expect(deleteArrangement()).toBe(true);
    expect(deleteArrangement()).toBe(false); // the last one stays
    expect(state().project.patterns.some((p) => p.id === pattern)).toBe(true);
  });
});
