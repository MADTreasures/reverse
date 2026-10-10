/**
 * Notes played live on the typing keyboard or a MIDI keyboard. Like FL Studio, MAD Studio keeps a
 * score log of everything played (also while stopped) that can be dumped into the selected pattern
 * later, and can start playback with the first note ("Start on input").
 */
import { engine } from '../audio/engine';
import { channelSettings } from '../model/channelSettings';
import { DEFAULT_VELOCITY } from '../model/defaults';
import { arpSequence } from '../model/noteTools';
import { CHORDS } from '../model/scales';
import { PPQ } from '../model/timing';
import type { Id, Note } from '../model/types';
import { addNotes, endCoalesce, gestureKey } from '../store/actions';
import { useStore } from '../store/store';
import { toast } from './overlays';

/** How far back the score log reaches. */
const LOG_MS = 10 * 60_000;

interface LoggedNote {
  channelId: Id;
  key: number;
  velocity: number;
  /** performance.now() at note on / off. */
  on: number;
  off: number | null;
}

interface LiveNote {
  engineHandle: number | null;
  entry: LoggedNote;
  released: boolean;
  /** Played through the channel's arpeggiator (the engine only records this key). */
  arp: boolean;
  /** Waiting for Start on input to begin playback. */
  pending: boolean;
}

const log: LoggedNote[] = [];
const live = new Map<number, LiveNote>();
let nextHandle = 1;
/** Last live key per channel, for portamento (channel settings: Porta). */
const lastKey = new Map<Id, number>();

/**
 * The channel arpeggiator for live notes (FL Studio: channel settings › Arpeggiator): the held keys are
 * played one after another at the arpeggio's step length and the current tempo.
 */
class LiveArp {
  private held: { key: number; velocity: number }[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sounding: number | null = null;
  private signature = '';
  private index = 0;
  private next = 0;

  constructor(private readonly channelId: Id) {}

  get active(): boolean {
    return this.held.length > 0;
  }

  press(key: number, velocity: number): void {
    this.held = [...this.held.filter((h) => h.key !== key), { key, velocity }];
    if (this.timer === null) {
      this.next = performance.now();
      this.step();
    }
  }

  release(key: number): void {
    this.held = this.held.filter((h) => h.key !== key);
    if (this.held.length === 0) this.stop();
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.sounding !== null) engine.noteOff(this.sounding);
    this.sounding = null;
    this.signature = '';
  }

  private step(): void {
    const s = useStore.getState();
    const channel = s.project.channels.find((c) => c.id === this.channelId);
    const arp = channelSettings(channel).arp;
    if (!channel || arp.direction === 'off' || this.held.length === 0) {
      this.stop();
      return;
    }
    const keys = [...this.held].sort((a, b) => a.key - b.key);
    const signature = keys.map((h) => h.key).join(',');
    if (signature !== this.signature) {
      this.signature = signature;
      this.index = 0;
    }
    const chord = arp.chord !== 'none' && keys.length === 1 ? CHORDS.find((c) => c.id === arp.chord) : undefined;
    const pool = chord ? chord.intervals.map((i) => keys[0].key + i).filter((k) => k <= 127) : keys.map((h) => h.key);
    const seq = arpSequence(pool, arp.direction === 'random' ? 'up' : arp.direction, arp.range);
    const key = arp.direction === 'random' ? seq[Math.floor(Math.random() * seq.length)] : seq[Math.floor(this.index / arp.repeat) % seq.length];
    const velocity = (keys.find((h) => h.key % 12 === key % 12) ?? keys[0]).velocity;
    this.index++;
    if (this.sounding !== null) engine.noteOff(this.sounding);
    const handle = engine.noteOn(this.channelId, key, velocity, { record: false });
    this.sounding = handle;
    const stepMs = (arp.time * 60_000) / (PPQ * s.project.bpm);
    setTimeout(() => {
      if (this.sounding === handle) {
        engine.noteOff(handle);
        this.sounding = null;
      }
    }, stepMs * arp.gate);
    // Steps follow the clock, not the timer: late timers do not accumulate.
    this.next += stepMs;
    this.timer = setTimeout(() => this.step(), Math.max(0, this.next - performance.now()));
  }
}

const arps = new Map<Id, LiveArp>();

function prune(now: number): void {
  while (log.length > 0 && (log[0].off ?? now) < now - LOG_MS) log.shift();
}

export function liveNoteOn(channelId: Id, key: number, velocity = DEFAULT_VELOCITY): number {
  const now = performance.now();
  prune(now);
  const entry: LoggedNote = { channelId, key, velocity, on: now, off: null };
  log.push(entry);
  const handle = nextHandle++;
  const s = useStore.getState();
  const settings = channelSettings(s.project.channels.find((c) => c.id === channelId));
  const arpeggiated = settings.arp.direction !== 'off';
  const note: LiveNote = { engineHandle: null, entry, released: false, arp: arpeggiated, pending: false };
  live.set(handle, note);

  // Channel settings: Mono ends the channel's other live notes, Porta glides from the last key.
  if (settings.mono && !arpeggiated) {
    for (const other of live.values()) {
      if (other === note || other.arp || other.entry.channelId !== channelId || other.engineHandle === null) continue;
      engine.noteOff(other.engineHandle);
      other.engineHandle = null;
    }
  }
  const previous = lastKey.get(channelId);
  const glide = settings.porta && previous !== undefined && previous !== key ? { glideFrom: previous - key, glideTime: settings.glide } : {};
  lastKey.set(channelId, key);

  const start = () => {
    if (arpeggiated) {
      // The held key is recorded (silently); the arpeggiator plays.
      note.engineHandle = engine.noteOn(channelId, key, velocity, { silent: true });
      let arp = arps.get(channelId);
      if (!arp) arps.set(channelId, (arp = new LiveArp(channelId)));
      arp.press(key, velocity);
    } else {
      note.engineHandle = engine.noteOn(channelId, key, velocity, glide);
    }
  };
  const t = s.transport;
  if (t.startOnInput && t.recording && !engine.playing) {
    // Start on input: playback (and recording) begins with this note, which is then recorded too.
    note.pending = true;
    void engine.play().then(() => {
      note.pending = false;
      start();
      if (note.released) finishNote(handle, note);
    });
  } else {
    start();
  }
  return handle;
}

export function liveNoteOff(handle: number): void {
  const note = live.get(handle);
  if (!note || note.released) return;
  note.released = true;
  note.entry.off = performance.now();
  // Released before Start on input began playback: finished once the note has started.
  if (!note.pending) finishNote(handle, note);
}

function finishNote(handle: number, note: LiveNote): void {
  live.delete(handle);
  if (note.arp) arps.get(note.entry.channelId)?.release(note.entry.key);
  if (note.engineHandle !== null) engine.noteOff(note.engineHandle);
}

/**
 * FL Studio's Tools › Dump score log to selected pattern: the notes played in the last `minutes`,
 * with their timing at the current tempo, starting at the beginning of the pattern.
 */
export function dumpScoreLog(minutes: number): number {
  const now = performance.now();
  const s = useStore.getState();
  const channels = new Set(s.project.channels.filter((c) => c.kind !== 'automation').map((c) => c.id));
  const notes = log.filter((n) => n.on >= now - minutes * 60_000 && channels.has(n.channelId));
  if (notes.length === 0) {
    toast(`Nothing was played in the last ${minutes === 1 ? 'minute' : `${minutes} minutes`}.`);
    return 0;
  }
  const ticksPerMs = (PPQ * s.project.bpm) / 60_000;
  const t0 = notes[0].on;
  const byChannel = new Map<Id, Omit<Note, 'id'>[]>();
  for (const n of notes) {
    const list = byChannel.get(n.channelId) ?? [];
    list.push({
      key: n.key,
      start: Math.round((n.on - t0) * ticksPerMs),
      length: Math.max(1, Math.round(((n.off ?? now) - n.on) * ticksPerMs)),
      velocity: n.velocity,
    });
    byChannel.set(n.channelId, list);
  }
  const key = gestureKey('score-log');
  for (const [channelId, list] of byChannel) addNotes(s.ui.selectedPatternId, channelId, list, { coalesce: key });
  endCoalesce();
  toast(`${notes.length} note${notes.length === 1 ? '' : 's'} from the score log added to the pattern.`);
  return notes.length;
}

export function clearScoreLog(): void {
  log.length = 0;
}

export function scoreLogSize(): number {
  return log.length;
}
