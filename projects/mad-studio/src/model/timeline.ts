import { DEFAULT_GLIDE_TIME, MAX_NOTE_BENDS, type PitchBend } from './notes';
import { findPattern, patternLength, songLength } from './patterns';
import { ticksPerBar } from './timing';
import type { Id, Note, Project } from './types';

/**
 * A note (or audio clip trigger) placed on the absolute timeline. Both engines play these: the web
 * engine directly, the native engine via timeline.set (engine/PROTOCOL.md). Optional fields are
 * only present when they differ from their default.
 */
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
  /** Note properties (see notes.ts for ranges and defaults). */
  release?: number;
  pan?: number;
  fine?: number;
  modX?: number;
  modY?: number;
  /** Colour group 1..15 (plugins: MIDI channel color + 1). */
  color?: number;
  /** Portamento: the note starts this many semitones away from its key and glides there in `glideTime` seconds. */
  glideFrom?: number;
  glideTime?: number;
  /** Slide notes that move this note's pitch while it sounds. */
  bends?: PitchBend[];
}

/** Timeline entry before slide and portamento notes are resolved. */
interface RawEvent extends SequencedEvent {
  slide?: boolean;
  porta?: boolean;
}

export interface Timeline {
  events: SequencedEvent[];
  /** Loop start in ticks. */
  start: number;
  /** Loop end in ticks (exclusive). */
  end: number;
}

function sortEvents<T extends SequencedEvent>(events: T[]): T[] {
  return events.sort((a, b) => a.tick - b.tick || (a.channelId < b.channelId ? -1 : a.channelId > b.channelId ? 1 : a.key - b.key));
}

/** The event of a pattern note at `tick` (muted notes return null). */
function noteEvent(n: Note, channelId: Id, tick: number, length: number): RawEvent | null {
  if (n.muted) return null;
  const ev: RawEvent = { tick, length, channelId, key: n.key, velocity: n.velocity };
  if (n.release !== undefined) ev.release = n.release;
  if (n.pan !== undefined) ev.pan = n.pan;
  if (n.fine !== undefined) ev.fine = n.fine;
  if (n.modX !== undefined) ev.modX = n.modX;
  if (n.modY !== undefined) ev.modY = n.modY;
  if (n.color) ev.color = n.color;
  if (n.slide) ev.slide = true;
  if (n.porta) ev.porta = true;
  return ev;
}

/**
 * Resolves slide and portamento notes per channel (FL Studio): a slide note plays nothing itself; the
 * notes of its colour group sounding when it starts glide over its length so that the highest of them
 * lands on the slide note's key (a chord keeps its shape). A portamento note starts at the pitch of the
 * previous note on its channel and glides to its own key.
 */
function resolveNoteFx(events: RawEvent[], glideTime: (channelId: Id) => number): SequencedEvent[] {
  if (!events.some((e) => e.slide || e.porta)) return events;
  const byChannel = new Map<Id, RawEvent[]>();
  for (const e of events) {
    if (e.audioClip) continue;
    let list = byChannel.get(e.channelId);
    if (!list) byChannel.set(e.channelId, (list = []));
    list.push(e);
  }
  const lastBend = (e: SequencedEvent) => (e.bends && e.bends.length ? e.bends[e.bends.length - 1].to : 0);
  for (const list of byChannel.values()) {
    if (!list.some((e) => e.slide || e.porta)) continue;
    const notes = list.filter((e) => !e.slide);
    for (const s of list) {
      if (!s.slide) continue;
      const group = s.color ?? 0;
      const hit = notes.filter((n) => (n.color ?? 0) === group && n.tick <= s.tick && s.tick < n.tick + n.length);
      if (hit.length === 0) continue;
      const highest = Math.max(...hit.map((n) => n.key + lastBend(n)));
      const interval = s.key - highest;
      for (const n of hit) {
        const bends = (n.bends ??= []);
        if (bends.length < MAX_NOTE_BENDS) bends.push({ at: s.tick - n.tick, length: s.length, to: lastBend(n) + interval });
      }
    }
    let prev: RawEvent | null = null;
    let i = 0;
    while (i < notes.length) {
      // Notes starting together (a chord) all glide from the note before them.
      let j = i;
      while (j < notes.length && notes[j].tick === notes[i].tick) j++;
      for (let k = i; k < j; k++) {
        const n = notes[k];
        if (!n.porta || !prev) continue;
        const from = prev.key + lastBend(prev) - n.key;
        if (from !== 0) {
          n.glideFrom = from;
          n.glideTime = glideTime(n.channelId);
        }
      }
      prev = notes[j - 1];
      i = j;
    }
  }
  return events.filter((e) => !e.slide).map(({ slide: _slide, porta: _porta, ...e }) => e);
}

const channelGlideTime = (_channelId: Id) => DEFAULT_GLIDE_TIME;

/** Events of a single pattern, looping over its length. */
export function patternTimeline(project: Project, patternId: Id | null): Timeline {
  const pattern = findPattern(project, patternId);
  if (!pattern) return { events: [], start: 0, end: ticksPerBar(project.beatsPerBar) };
  const channelIds = new Set(project.channels.filter((c) => c.kind !== 'automation').map((c) => c.id));
  const events: RawEvent[] = [];
  for (const [channelId, notes] of Object.entries(pattern.notes)) {
    if (!channelIds.has(channelId)) continue;
    for (const n of notes) {
      const ev = noteEvent(n, channelId, n.start, n.length);
      if (ev) events.push(ev);
    }
  }
  return { events: resolveNoteFx(sortEvents(events), channelGlideTime), start: 0, end: patternLength(pattern, project.beatsPerBar) };
}

/** Events of the whole arrangement. Pattern clips loop their pattern across the clip length. */
export function songTimeline(project: Project): Timeline {
  const mutedTracks = new Set(project.tracks.filter((t) => t.muted).map((t) => t.id));
  const trackIds = new Set(project.tracks.map((t) => t.id));
  const channels = new Map(project.channels.filter((c) => c.kind !== 'automation').map((c) => [c.id, c]));
  const events: RawEvent[] = [];

  for (const clip of project.clips) {
    if (!trackIds.has(clip.trackId) || mutedTracks.has(clip.trackId) || clip.muted || clip.length <= 0) continue;
    if (clip.kind === 'automation') continue; // evaluated separately (automation.ts)
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
          const ev = length > 0 ? noteEvent(n, channelId, tick, length) : null;
          if (ev) events.push(ev);
          k++;
        }
      }
    }
  }
  return { events: resolveNoteFx(sortEvents(events), channelGlideTime), start: 0, end: songLength(project) };
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

/** The song timeline looping inside a time selection (FL Studio: playback loops in the selected range). */
export function withLoop(tl: Timeline, loop: { start: number; end: number } | null): Timeline {
  if (!loop || loop.end <= loop.start) return tl;
  return { events: tl.events, start: Math.max(0, loop.start), end: loop.end };
}

/** Maps a position into a loop range the way playback wraps (positions outside fold back in). */
export function foldIntoLoop(tick: number, loop: { start: number; end: number } | null): number {
  if (!loop || loop.end <= loop.start || (tick >= loop.start && tick < loop.end)) return tick;
  const len = loop.end - loop.start;
  return loop.start + ((((tick - loop.start) % len) + len) % len);
}
