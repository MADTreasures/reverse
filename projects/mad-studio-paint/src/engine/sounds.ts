/**
 * Sound at run time: the bytes of the document's sound files (saved with it), decoded audio,
 * waveform peaks, playback in step with the timeline and the mix for movie exports (Web Audio).
 */
import { peaks, soundPlays, volumeSteps, type SoundMix, type SoundTrack } from '../paint/sound';

interface Entry {
  bytes: Uint8Array;
  type: string;
  buffer?: AudioBuffer;
  decoding?: Promise<AudioBuffer | null>;
}

const store = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;

function changed(): void {
  version++;
  for (const l of listeners) l();
}

export const subscribeSounds = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const soundsVersion = () => version;

export function setSoundBytes(id: string, bytes: Uint8Array, type: string): void {
  store.set(id, { bytes, type });
  void decodeSound(id);
}

export const soundBytes = (id: string): { bytes: Uint8Array; type: string } | null => {
  const e = store.get(id);
  return e ? { bytes: e.bytes, type: e.type } : null;
};

/** Forgets every sound (a document is opened). */
export function clearSounds(): void {
  store.clear();
  changed();
}

/** Forgets the sounds a document does not use (after it is loaded: no undo step refers to others). */
export function pruneSounds(keep: Set<string>): void {
  for (const id of [...store.keys()]) if (!keep.has(id)) store.delete(id);
}

let decoder: BaseAudioContext | null = null;

/** Decodes audio bytes (any format the browser knows), or null. */
export async function decodeBytes(bytes: Uint8Array): Promise<AudioBuffer | null> {
  try {
    decoder ??= new OfflineAudioContext(1, 1, 44100);
    // decodeAudioData detaches its buffer: give it a copy.
    return await decoder.decodeAudioData(bytes.slice().buffer);
  } catch {
    return null;
  }
}

export function decodeSound(id: string): Promise<AudioBuffer | null> {
  const e = store.get(id);
  if (!e) return Promise.resolve(null);
  if (e.buffer) return Promise.resolve(e.buffer);
  e.decoding ??= decodeBytes(e.bytes).then((b) => {
    if (b) e.buffer = b;
    changed();
    return b;
  });
  return e.decoding;
}

export const decodedSound = (id: string): AudioBuffer | null => store.get(id)?.buffer ?? null;

const peakCache = new Map<string, Float32Array>();

/** Peaks of a stretch of a sound for a waveform (empty until it is decoded). */
export function soundPeaks(id: string, start: number, duration: number, buckets: number): Float32Array {
  const b = decodedSound(id);
  if (!b) return new Float32Array(0);
  const key = `${id}|${start.toFixed(4)}|${duration.toFixed(4)}|${buckets}`;
  let p = peakCache.get(key);
  if (!p) {
    p = peaks(b.getChannelData(0), b.sampleRate, start, duration, buckets);
    peakCache.set(key, p);
    if (peakCache.size > 200) peakCache.delete(peakCache.keys().next().value!);
  }
  return p;
}

// ------------------------------------------------------------------ playing and mixing

/** Schedules what the tracks play from frame `from` to `to` on a context, starting at its time `at`. */
function schedule(ctx: BaseAudioContext, sound: SoundMix, from: number, to: number, fps: number, at: number): AudioBufferSourceNode[] {
  const nodes: AudioBufferSourceNode[] = [];
  for (const play of soundPlays(sound.tracks, sound.files, from, to, fps)) {
    const buffer = decodedSound(play.sound);
    const track = sound.tracks.find((t) => t.id === play.track) as SoundTrack;
    if (!buffer) continue;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    for (const [t, v] of volumeSteps(track, play, from, fps)) gain.gain.setValueAtTime(v, at + Math.max(0, t));
    src.connect(gain).connect(ctx.destination);
    src.start(at + play.when, play.offset, play.duration);
    nodes.push(src);
  }
  return nodes;
}

let player: AudioContext | null = null;
let playing: AudioBufferSourceNode[] = [];

/** Timeline playback: plays the sound from frame `from` on (to the end frame). */
export function startSound(sound: SoundMix | undefined, from: number, to: number, fps: number): void {
  stopSound();
  if (!sound?.tracks.length) return;
  try {
    player ??= new AudioContext();
    void player.resume();
    playing = schedule(player, sound, from, to, fps, player.currentTime + 0.02);
  } catch {
    // No audio output: the animation plays silently.
  }
}

export function stopSound(): void {
  for (const n of playing) {
    try {
      n.stop();
    } catch {
      // Already stopped.
    }
  }
  playing = [];
}

/** The mix of frames `from` … `to` for a movie (null without sound). */
export async function mixSound(sound: SoundMix | undefined, from: number, to: number, fps: number, sampleRate: number, channels: number): Promise<AudioBuffer | null> {
  if (!sound?.tracks.some((t) => t.visible && t.clips.length)) return null;
  await Promise.all(sound.files.map((f) => decodeSound(f.id)));
  const length = Math.max(1, Math.ceil(((to - from + 1) / fps) * sampleRate));
  const ctx = new OfflineAudioContext(channels, length, sampleRate);
  if (schedule(ctx, sound, from, to, fps, 0).length === 0) return null;
  return ctx.startRendering();
}
