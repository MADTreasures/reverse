import { beforeEach, describe, expect, it } from 'vitest';
import { TICKS_PER_STEP } from '../model/timing';
import {
  addEffect,
  addFactoryChannel,
  addPattern,
  addSynthChannel,
  cloneChannel,
  clonePattern,
  deleteChannel,
  deletePattern,
  endCoalesce,
  isStepOn,
  placePatternClip,
  redo,
  setBpm,
  setChannelProps,
  setStep,
  soloChannel,
  toggleStep,
  undo,
} from './actions';
import { resetStore, useStore } from './store';

const state = () => useStore.getState();

beforeEach(() => resetStore());

describe('undo / redo', () => {
  it('undoes and redoes step toggles', () => {
    const { project, ui } = state();
    const ch = project.channels[0].id;
    toggleStep(ui.selectedPatternId, ch, 2);
    expect(isStepOn(state().project, ui.selectedPatternId, ch, 2)).toBe(true);
    undo();
    expect(isStepOn(state().project, ui.selectedPatternId, ch, 2)).toBe(false);
    redo();
    expect(isStepOn(state().project, ui.selectedPatternId, ch, 2)).toBe(true);
  });

  it('merges coalesced edits into a single undo step', () => {
    const before = state().project.bpm;
    setBpm(100, { coalesce: 'tempo' });
    setBpm(110, { coalesce: 'tempo' });
    setBpm(120, { coalesce: 'tempo' });
    endCoalesce();
    expect(state().project.bpm).toBe(120);
    expect(state().past).toHaveLength(1);
    undo();
    expect(state().project.bpm).toBe(before);
  });

  it('clears the redo stack on new edits', () => {
    setBpm(90);
    undo();
    expect(state().future).toHaveLength(1);
    setBpm(95);
    expect(state().future).toHaveLength(0);
  });
});

describe('channels', () => {
  it('routes new channels to the first free insert and names that insert', () => {
    const id = addFactoryChannel('ride');
    const { project } = state();
    const ch = project.channels.find((c) => c.id === id)!;
    expect(ch.mixerTrack).toBe(5);
    expect(project.mixer[5].name).toBe('Ride');
    expect(project.samples['factory:ride']).toBeDefined();
    expect(state().ui.selectedChannelId).toBe(id);
  });

  it('removes notes and windows of deleted channels', () => {
    const pat = state().ui.selectedPatternId;
    const id = addSynthChannel('pluck');
    setStep(pat, id, 0, true);
    deleteChannel(id);
    const { project, ui } = state();
    expect(project.channels.some((c) => c.id === id)).toBe(false);
    expect(project.patterns[0].notes[id]).toBeUndefined();
    expect(ui.selectedChannelId).not.toBe(id);
  });

  it('clones a channel together with its notes', () => {
    const pat = state().ui.selectedPatternId;
    const src = state().project.channels[0].id;
    setStep(pat, src, 4, true);
    const copy = cloneChannel(src)!;
    expect(isStepOn(state().project, pat, copy, 4)).toBe(true);
    expect(state().project.channels[1].id).toBe(copy);
  });

  it('solo mutes all other channels and toggles back', () => {
    const target = state().project.channels[1].id;
    soloChannel(target);
    expect(state().project.channels.filter((c) => c.muted)).toHaveLength(3);
    soloChannel(target);
    expect(state().project.channels.some((c) => c.muted)).toBe(false);
  });

  it('clamps channel properties', () => {
    const id = state().project.channels[0].id;
    setChannelProps(id, { volume: 3, pan: -4, mixerTrack: 999 });
    const ch = state().project.channels[0];
    expect(ch.volume).toBe(1);
    expect(ch.pan).toBe(-1);
    expect(ch.mixerTrack).toBe(state().project.mixer.length - 1);
  });
});

describe('patterns and playlist', () => {
  it('clones patterns with fresh note ids', () => {
    const pat = state().ui.selectedPatternId;
    const ch = state().project.channels[0].id;
    setStep(pat, ch, 0, true);
    const copy = clonePattern(pat)!;
    const { project } = state();
    const a = project.patterns.find((p) => p.id === pat)!.notes[ch][0];
    const b = project.patterns.find((p) => p.id === copy)!.notes[ch][0];
    expect(b.start).toBe(a.start);
    expect(b.id).not.toBe(a.id);
    expect(state().ui.selectedPatternId).toBe(copy);
  });

  it('deleting a pattern removes its clips and keeps at least one pattern', () => {
    const pat = state().ui.selectedPatternId;
    placePatternClip(pat, state().project.tracks[0].id, 0);
    expect(state().project.clips).toHaveLength(1);
    deletePattern(pat);
    const { project, ui } = state();
    expect(project.clips).toHaveLength(0);
    expect(project.patterns).toHaveLength(1);
    expect(ui.selectedPatternId).toBe(project.patterns[0].id);
  });

  it('sizes placed clips to the pattern length', () => {
    const pat = addPattern();
    const ch = state().project.channels[0].id;
    setStep(pat, ch, 20, true);
    placePatternClip(pat, state().project.tracks[2].id, 0);
    expect(state().project.clips[0].length).toBe(TICKS_PER_STEP * 32);
  });
});

describe('mixer', () => {
  it('adds effects with default parameters', () => {
    const id = addEffect(0, 'reverb');
    const slot = state().project.mixer[0].effects[0];
    expect(slot.id).toBe(id);
    expect(slot.params.decay).toBeGreaterThan(0);
  });
});
