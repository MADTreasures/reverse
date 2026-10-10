import { channelSettings } from './channelSettings';
import { clipFades, clipGain, clipVariant, variantSampleId } from './clips';
import { arpSequence, random } from './noteTools';
import { MAX_NOTE_BENDS, type PitchBend } from './notes';
import { CHORDS } from './scales';
import { findPattern, patternLength, songLength } from './patterns';
import { ticksPerBar } from './timing';
import type { ArpSettings, Id, Note, Project } from './types';

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
  /** Audio clips: sample variant to play instead of the channel's sample (pitch, stretch, reverse; clips.ts). */
  sample?: string;
  /** Audio clips: linear clip gain and fades (ticks from the clip's start / before its end, tension -1..1). */
  clipGain?: number;
  fadeIn?: number;
  fadeOut?: number;
  fadeInTension?: number;
  fadeOutTension?: number;
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

/** Arpeggiates a channel's notes on a grid that starts with each phrase (FL Studio: channel arpeggiator). */
function arpeggiateEvents(notes: RawEvent[], arp: ArpSettings): RawEvent[] {
  const sorted = [...notes].sort((a, b) => a.tick - b.tick || a.key - b.key);
  if (sorted.length === 0) return [];
  const step = Math.max(1, arp.time);
  const end = Math.max(...sorted.map((n) => n.tick + n.length));
  const out: RawEvent[] = [];
  let t = sorted[0].tick;
  let heldKey = '';
  let seq: { key: number; source: RawEvent }[] = [];
  let idx = 0;
  for (let guard = 0; t < end && guard < 100000; guard++) {
    const held = sorted.filter((n) => n.tick <= t && t < n.tick + n.length);
    if (held.length === 0) {
      // Silence: the next phrase starts its grid with its first note.
      const next = sorted.find((n) => n.tick > t);
      if (!next) break;
      t = next.tick;
      heldKey = '';
      continue;
    }
    const key = held.map((n) => n.key).join(',');
    if (key !== heldKey) {
      heldKey = key;
      idx = 0;
      const chord = arp.chord !== 'none' && held.length === 1 ? CHORDS.find((c) => c.id === arp.chord) : undefined;
      const keys = chord ? chord.intervals.map((i) => held[0].key + i).filter((k) => k <= 127) : held.map((n) => n.key);
      const byClass = (k: number) => held.find((n) => n.key % 12 === k % 12) ?? held[0];
      seq = arpSequence(keys, arp.direction === 'random' ? 'up' : arp.direction, arp.range).map((k) => ({ key: k, source: byClass(k) }));
    }
    const position = Math.floor(idx / Math.max(1, arp.repeat));
    const pick = arp.direction === 'random' ? seq[Math.floor(random(t + 1)() * seq.length)] : seq[position % seq.length];
    if (pick) {
      const { slide: _slide, porta: _porta, ...source } = pick.source;
      out.push({ ...source, tick: t, length: Math.max(1, Math.round(step * arp.gate)), key: pick.key, bends: undefined });
    }
    idx++;
    t += step;
  }
  return out.map((e) => {
    const { bends: _b, ...rest } = e;
    return rest;
  });
}

/** One note at a time: each note ends where the next begins, of a chord only the highest note plays (Mono). */
function monophonic(notes: RawEvent[]): RawEvent[] {
  const sorted = [...notes].sort((a, b) => a.tick - b.tick || b.key - a.key);
  const out: RawEvent[] = [];
  for (const n of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.tick === n.tick) continue;
    if (prev && prev.tick + prev.length > n.tick) prev.length = n.tick - prev.tick;
    out.push({ ...n });
  }
  return out;
}

/**
 * Applies the channel settings and resolves slide and portamento notes per channel (FL Studio):
 * - the arpeggiator replaces held notes by arpeggios, Mono keeps one note at a time;
 * - a slide note plays nothing itself; the notes of its colour group sounding when it starts glide over
 *   its length so that the highest of them lands on the slide note's key (a chord keeps its shape);
 * - a portamento note (or every note with the channel's Porta switch) starts at the pitch of the previous
 *   note on its channel and glides to its own key in the channel's slide time.
 */
function resolveNotes(events: RawEvent[], project: Project): SequencedEvent[] {
  const settings = new Map(project.channels.map((c) => [c.id, channelSettings(c)]));
  const special = (id: Id) => {
    const st = settings.get(id);
    return !!st && (st.mono || st.porta || st.arp.direction !== 'off');
  };
  const strip = ({ slide: _slide, porta: _porta, ...e }: RawEvent): SequencedEvent => e;
  if (!events.some((e) => e.slide || e.porta || special(e.channelId))) return events.map(strip);

  const byChannel = new Map<Id, RawEvent[]>();
  const out: RawEvent[] = [];
  for (const e of events) {
    if (e.audioClip) {
      out.push(e);
      continue;
    }
    let list = byChannel.get(e.channelId);
    if (!list) byChannel.set(e.channelId, (list = []));
    list.push(e);
  }
  const lastBend = (e: SequencedEvent) => (e.bends && e.bends.length ? e.bends[e.bends.length - 1].to : 0);
  for (const [channelId, list] of byChannel) {
    const st = settings.get(channelId) ?? channelSettings(undefined);
    if (!list.some((e) => e.slide || e.porta) && !special(channelId)) {
      out.push(...list);
      continue;
    }
    let notes = list.filter((e) => !e.slide);
    if (st.arp.direction !== 'off') notes = arpeggiateEvents(notes, st.arp);
    if (st.mono) notes = monophonic(notes);
    notes.sort((a, b) => a.tick - b.tick || a.key - b.key);
    for (const sl of list) {
      if (!sl.slide) continue;
      const group = sl.color ?? 0;
      const hit = notes.filter((n) => (n.color ?? 0) === group && n.tick <= sl.tick && sl.tick < n.tick + n.length);
      if (hit.length === 0) continue;
      const highest = Math.max(...hit.map((n) => n.key + lastBend(n)));
      const interval = sl.key - highest;
      for (const n of hit) {
        const bends = (n.bends ??= []);
        if (bends.length < MAX_NOTE_BENDS) bends.push({ at: sl.tick - n.tick, length: sl.length, to: lastBend(n) + interval });
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
        if (!(n.porta || st.porta) || !prev) continue;
        const from = prev.key + lastBend(prev) - n.key;
        if (from !== 0) {
          n.glideFrom = from;
          n.glideTime = st.glide;
        }
      }
      prev = notes[j - 1];
      i = j;
    }
    out.push(...notes);
  }
  return sortEvents(out).map(strip);
}

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
  return { events: resolveNotes(sortEvents(events), project), start: 0, end: patternLength(pattern, project.beatsPerBar) };
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
      const ev: RawEvent = {
        tick: clip.start,
        length: clip.length,
        channelId: ch.id,
        key: ch.sampler.rootKey,
        velocity: 1,
        sampleOffset: clip.offset,
        audioClip: true,
      };
      // Instance properties (clips.ts): variant sample, gain and fades.
      const variant = clipVariant(clip);
      if (variant && ch.sampler.sampleId) ev.sample = variantSampleId(ch.sampler.sampleId, variant);
      const gain = clipGain(clip.gain);
      if (gain !== 1) ev.clipGain = gain;
      const { fadeIn, fadeOut } = clipFades(clip);
      if (fadeIn > 0) {
        ev.fadeIn = fadeIn;
        if (clip.fadeInTension) ev.fadeInTension = clip.fadeInTension;
      }
      if (fadeOut > 0) {
        ev.fadeOut = fadeOut;
        if (clip.fadeOutTension) ev.fadeOutTension = clip.fadeOutTension;
      }
      events.push(ev);
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
  return { events: resolveNotes(sortEvents(events), project), start: 0, end: songLength(project) };
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
