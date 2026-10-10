import { describe, expect, it } from 'vitest';
import { createEmptyProject, createPattern, createSynthChannel } from './defaults';
import { patternLength, patternSteps, stepKey, stepView } from './patterns';
import { firstEventAtOrAfter, patternTimeline, songTimeline } from './timeline';
import {
  PPQ,
  TICKS_PER_STEP,
  formatPosition,
  noteName,
  secondsPerTick,
  snapRound,
  snapTicks,
  volumeToGain,
} from './timing';
import type { Note, Project } from './types';

function note(start: number, length = TICKS_PER_STEP, key = 60, velocity = 0.8): Note {
  return { id: `n${start}-${key}`, key, start, length, velocity };
}

describe('timing', () => {
  it('converts tempo to seconds per tick', () => {
    expect(secondsPerTick(120) * PPQ).toBeCloseTo(0.5);
  });

  it('formats positions as bar:step:tick', () => {
    expect(formatPosition(0, 4)).toBe('1:01:00');
    expect(formatPosition(PPQ * 4 + TICKS_PER_STEP * 3 + 5, 4)).toBe('2:04:05');
  });

  it('names notes with C5 = MIDI 60', () => {
    expect(noteName(60)).toBe('C5');
    expect(noteName(69)).toBe('A5');
    expect(noteName(61)).toBe('C#5');
  });

  it('snaps to grids including triplets', () => {
    expect(snapTicks('1/3 beat', 4)).toBe(32);
    expect(snapTicks('bar', 3)).toBe(PPQ * 3);
    expect(snapRound(37, 24)).toBe(48);
  });

  it('maps fader position 0.8 to unity gain', () => {
    expect(volumeToGain(0.8)).toBeCloseTo(1);
    expect(volumeToGain(0)).toBe(0);
  });
});

describe('patterns', () => {
  it('is at least one bar long and grows by whole bars', () => {
    const p = createPattern('P', '#fff');
    expect(patternLength(p, 4)).toBe(PPQ * 4);
    p.notes.ch = [note(PPQ * 4 + 10)];
    expect(patternLength(p, 4)).toBe(PPQ * 8);
    expect(patternSteps(p, 4)).toBe(32);
  });

  it('detects whether notes fit the step sequencer', () => {
    const ch = createSynthChannel();
    expect(stepKey(ch)).toBe(60);
    const steps = stepView([note(0), note(TICKS_PER_STEP * 4)], ch, 16);
    expect(steps.representable).toBe(true);
    expect(steps.steps[0]).toBeGreaterThan(0);
    expect(steps.steps[4]).toBeGreaterThan(0);
    expect(steps.steps[1]).toBe(0);
    expect(stepView([note(0, 48)], ch, 16).representable).toBe(false);
    // Like FL Studio's steps, a step may have its own pitch and a delay inside the step (graph editor).
    expect(stepView([note(0, 24, 64)], ch, 16).representable).toBe(true);
    expect(stepView([note(30, 12)], ch, 16).steps[1]).toBeGreaterThan(0);
    expect(stepView([note(0), note(6, 12)], ch, 16).representable).toBe(false);
  });
});

describe('timeline', () => {
  function projectWithPattern(): Project {
    const project = createEmptyProject();
    const ch = project.channels[0];
    project.patterns[0].notes[ch.id] = [note(0), note(TICKS_PER_STEP * 8)];
    return project;
  }

  it('lists pattern events sorted with the pattern length as loop', () => {
    const project = projectWithPattern();
    const tl = patternTimeline(project, project.patterns[0].id);
    expect(tl.events.map((e) => e.tick)).toEqual([0, TICKS_PER_STEP * 8]);
    expect(tl.end).toBe(PPQ * 4);
  });

  it('loops pattern clips over their length and honours offset', () => {
    const project = projectWithPattern();
    const bar = PPQ * 4;
    project.clips.push({
      id: 'c1',
      kind: 'pattern',
      patternId: project.patterns[0].id,
      trackId: project.tracks[0].id,
      start: bar,
      length: bar * 2,
      offset: 0,
    });
    const ticks = songTimeline(project).events.map((e) => e.tick);
    expect(ticks).toEqual([bar, bar + 192, bar * 2, bar * 2 + 192]);

    project.clips[0].offset = 100;
    project.clips[0].length = bar;
    const shifted = songTimeline(project).events.map((e) => e.tick);
    // Source note at 192 appears at clip start + (192 - 100); next loop's 0 at start + (384 - 100).
    expect(shifted).toEqual([bar + 92, bar + 284]);
  });

  it('skips muted tracks and truncates notes at the clip end', () => {
    const project = projectWithPattern();
    project.patterns[0].notes[project.channels[0].id] = [note(0, 300)];
    project.clips.push({
      id: 'c1',
      kind: 'pattern',
      patternId: project.patterns[0].id,
      trackId: project.tracks[0].id,
      start: 0,
      length: 100,
      offset: 0,
    });
    const tl = songTimeline(project);
    expect(tl.events).toHaveLength(1);
    expect(tl.events[0].length).toBe(100);
    project.tracks[0].muted = true;
    expect(songTimeline(project).events).toHaveLength(0);
  });

  it('finds the first event at or after a tick', () => {
    const project = projectWithPattern();
    const { events } = patternTimeline(project, project.patterns[0].id);
    expect(firstEventAtOrAfter(events, 0)).toBe(0);
    expect(firstEventAtOrAfter(events, 1)).toBe(1);
    expect(firstEventAtOrAfter(events, 10_000)).toBe(2);
  });
});
