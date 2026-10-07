import { findPattern, patternLength, songLength } from './patterns';
import { ticksPerBar } from './timing';
import type { Id, Project } from './types';

/** A note (or audio clip trigger) placed on the absolute timeline. */
export interface SequencedEvent {
  tick: number;
  length: number;
  channelId: Id;
  key: number;
  velocity: number;
  /** Audio clips: ticks into the sample where playback starts. */
  sampleOffset?: number;
  /** True for audio clips, which are gated by the clip length. */
  audioClip?: boolean;
}

export interface Timeline {
  events: SequencedEvent[];
  /** Loop start in ticks. */
  start: number;
  /** Loop end in ticks (exclusive). */
  end: number;
}

function sortEvents(events: SequencedEvent[]): SequencedEvent[] {
  return events.sort((a, b) => a.tick - b.tick || (a.channelId < b.channelId ? -1 : a.channelId > b.channelId ? 1 : a.key - b.key));
}

/** Events of a single pattern, looping over its length. */
export function patternTimeline(project: Project, patternId: Id | null): Timeline {
  const pattern = findPattern(project, patternId);
  if (!pattern) return { events: [], start: 0, end: ticksPerBar(project.beatsPerBar) };
  const channelIds = new Set(project.channels.map((c) => c.id));
  const events: SequencedEvent[] = [];
  for (const [channelId, notes] of Object.entries(pattern.notes)) {
    if (!channelIds.has(channelId)) continue;
    for (const n of notes) {
      events.push({ tick: n.start, length: n.length, channelId, key: n.key, velocity: n.velocity });
    }
  }
  return { events: sortEvents(events), start: 0, end: patternLength(pattern, project.beatsPerBar) };
}

/** Events of the whole arrangement. Pattern clips loop their pattern across the clip length. */
export function songTimeline(project: Project): Timeline {
  const mutedTracks = new Set(project.tracks.filter((t) => t.muted).map((t) => t.id));
  const trackIds = new Set(project.tracks.map((t) => t.id));
  const channels = new Map(project.channels.map((c) => [c.id, c]));
  const events: SequencedEvent[] = [];

  for (const clip of project.clips) {
    if (!trackIds.has(clip.trackId) || mutedTracks.has(clip.trackId) || clip.length <= 0) continue;
    const clipEnd = clip.start + clip.length;

    if (clip.kind === 'audio') {
      const ch = channels.get(clip.channelId);
      if (!ch || ch.kind !== 'sampler') continue;
      events.push({
        tick: clip.start,
        length: clip.length,
        channelId: ch.id,
        key: ch.sampler.rootKey,
        velocity: 1,
        sampleOffset: clip.offset,
        audioClip: true,
      });
      continue;
    }

    const pattern = findPattern(project, clip.patternId);
    if (!pattern) continue;
    const period = patternLength(pattern, project.beatsPerBar);
    for (const [channelId, notes] of Object.entries(pattern.notes)) {
      if (!channels.has(channelId)) continue;
      for (const n of notes) {
        // Source positions of this note: n.start + k * period, visible when inside [offset, offset + length).
        let k = Math.max(0, Math.ceil((clip.offset - n.start) / period));
        for (;;) {
          const source = n.start + k * period;
          if (source >= clip.offset + clip.length) break;
          const tick = clip.start + source - clip.offset;
          const length = Math.min(n.length, clipEnd - tick);
          if (length > 0) events.push({ tick, length, channelId, key: n.key, velocity: n.velocity });
          k++;
        }
      }
    }
  }
  return { events: sortEvents(events), start: 0, end: songLength(project) };
}

/** Index of the first event at or after the given tick (binary search). */
export function firstEventAtOrAfter(events: SequencedEvent[], tick: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].tick < tick) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
