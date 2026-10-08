/**
 * Notes played live on the typing keyboard or a MIDI keyboard. Like FL Studio, MAD Studio keeps a
 * score log of everything played (also while stopped) that can be dumped into the selected pattern
 * later, and can start playback with the first note ("Start on input").
 */
import { engine } from '../audio/engine';
import { DEFAULT_VELOCITY } from '../model/defaults';
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
}

const log: LoggedNote[] = [];
const live = new Map<number, LiveNote>();
let nextHandle = 1;

function prune(now: number): void {
  while (log.length > 0 && (log[0].off ?? now) < now - LOG_MS) log.shift();
}

export function liveNoteOn(channelId: Id, key: number, velocity = DEFAULT_VELOCITY): number {
  const now = performance.now();
  prune(now);
  const entry: LoggedNote = { channelId, key, velocity, on: now, off: null };
  log.push(entry);
  const handle = nextHandle++;
  const note: LiveNote = { engineHandle: null, entry, released: false };
  live.set(handle, note);
  const t = useStore.getState().transport;
  if (t.startOnInput && t.recording && !engine.playing) {
    // Start on input: playback (and recording) begins with this note, which is then recorded too.
    void engine.play().then(() => {
      const h = engine.noteOn(channelId, key, velocity);
      if (note.released) engine.noteOff(h);
      else note.engineHandle = h;
    });
  } else {
    note.engineHandle = engine.noteOn(channelId, key, velocity);
  }
  return handle;
}

export function liveNoteOff(handle: number): void {
  const note = live.get(handle);
  if (!note) return;
  live.delete(handle);
  note.released = true;
  note.entry.off = performance.now();
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
