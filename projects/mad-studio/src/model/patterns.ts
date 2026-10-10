import { TICKS_PER_STEP, ceilToBar, stepsPerBar } from './timing';
import type { Channel, Note, Pattern, Project } from './types';

/** Key that the step sequencer writes for a channel (samplers: their root key). */
export function stepKey(channel: Channel): number {
  return channel.kind === 'sampler' ? channel.sampler.rootKey : 60;
}

export function contentEnd(pattern: Pattern): number {
  let end = 0;
  for (const notes of Object.values(pattern.notes)) {
    for (const n of notes) end = Math.max(end, n.start + n.length);
  }
  return end;
}

/** Pattern length in ticks: whole bars, at least minLength, growing with the content. */
export function patternLength(pattern: Pattern, beatsPerBar: number): number {
  return Math.max(pattern.minLength, ceilToBar(contentEnd(pattern), beatsPerBar));
}

/** Number of step buttons the channel rack shows for a pattern. */
export function patternSteps(pattern: Pattern, beatsPerBar: number): number {
  const steps = patternLength(pattern, beatsPerBar) / TICKS_PER_STEP;
  return Math.max(stepsPerBar(beatsPerBar), Math.ceil(steps));
}

/**
 * A note the step sequencer can show as a step: at most one step long. Like FL Studio's steps it may
 * have its own pitch and a small delay inside its step (the graph editor's "Note pitch" and "Shift").
 */
export function isStepNote(note: Note): boolean {
  return note.length <= TICKS_PER_STEP;
}

/** Step cell a note belongs to. */
export function stepIndex(note: Note): number {
  return Math.floor(note.start / TICKS_PER_STEP);
}

export interface StepView {
  /** False when the notes need the piano roll to be shown faithfully. */
  representable: boolean;
  /** Velocity per step, or 0 when the step is off. */
  steps: number[];
}

export function stepView(notes: Note[] | undefined, _channel: Channel, stepCount: number): StepView {
  const steps = new Array<number>(stepCount).fill(0);
  if (!notes || notes.length === 0) return { representable: true, steps };
  let representable = true;
  for (const n of notes) {
    if (!isStepNote(n)) {
      representable = false;
      continue;
    }
    const idx = stepIndex(n);
    if (idx < stepCount) {
      if (steps[idx] > 0) representable = false;
      steps[idx] = Math.max(n.velocity, 0.01);
    }
  }
  return { representable, steps };
}

/** The notes of each step cell (graph editor), first note per cell. */
export function stepNotes(notes: Note[] | undefined, stepCount: number): (Note | null)[] {
  const cells = new Array<Note | null>(stepCount).fill(null);
  for (const n of notes ?? []) {
    const idx = stepIndex(n);
    if (idx >= 0 && idx < stepCount && !cells[idx]) cells[idx] = n;
  }
  return cells;
}

export function songLength(project: Project): number {
  let end = 0;
  for (const c of project.clips) end = Math.max(end, c.start + c.length);
  return ceilToBar(end, project.beatsPerBar);
}

export function channelIndex(project: Project, channelId: string): number {
  return project.channels.findIndex((c) => c.id === channelId);
}

export function findChannel(project: Project, channelId: string | null | undefined): Channel | undefined {
  if (!channelId) return undefined;
  return project.channels.find((c) => c.id === channelId);
}

export function findPattern(project: Project, patternId: string | null | undefined): Pattern | undefined {
  if (!patternId) return undefined;
  return project.patterns.find((p) => p.id === patternId);
}

/** Lowest/highest key used by a pattern (for clip previews). */
export function keyRange(pattern: Pattern): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const notes of Object.values(pattern.notes)) {
    for (const n of notes) {
      lo = Math.min(lo, n.key);
      hi = Math.max(hi, n.key);
    }
  }
  return Number.isFinite(lo) ? [lo, hi] : null;
}
