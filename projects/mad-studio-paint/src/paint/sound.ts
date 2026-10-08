/**
 * Sound: the audio tracks of the timeline. Each clip of an audio track plays a stretch of a sound
 * file (its offset says where in the sound the clip starts), at the track's volume or as its volume
 * keyframes say. What plays when (for playback, movie export), waveform peaks and 16-bit PCM. Pure,
 * unit tested.
 */
import { sanitizeClips, type Clip } from './clips';
import { ease, type Interp } from './keyframes';

/** A sound file kept with the document. */
export interface SoundFile {
  id: string;
  name: string;
  /** MIME type of the stored bytes. */
  type: string;
  /** Seconds. */
  duration: number;
}

/** A volume keyframe (0..1). */
export interface VolumeKey {
  frame: number;
  interp: Interp;
  volume: number;
}

export interface SoundTrack {
  id: string;
  name: string;
  /** Off: muted (the eye in the Timeline palette). */
  visible: boolean;
  /** 0..1, when there are no volume keyframes. */
  volume: number;
  /** Each clip plays its `sound` from its `offset` on. */
  clips: Clip[];
  keys: VolumeKey[];
}

/** The canvas's sound: audio tracks and the files their clips play. */
export interface DocSound {
  tracks: SoundTrack[];
  files: SoundFile[];
}

export const AUDIO_EXTENSIONS = ['wav', 'mp3', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'webm'];

let counter = 0;
export const newSoundId = (prefix: 's' | 'snd') => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

export function newSoundTrack(name: string): SoundTrack {
  return { id: newSoundId('s'), name, visible: true, volume: 1, clips: [], keys: [] };
}

/** The volume at `frame`: the keyframes' (interpolated as the earlier one says), else the track's. */
export function volumeAt(track: Pick<SoundTrack, 'volume' | 'keys'>, frame: number): number {
  const k = track.keys;
  if (k.length === 0) return track.volume;
  if (frame <= k[0].frame) return k[0].volume;
  for (let i = 0; i < k.length - 1; i++) {
    if (frame >= k[i + 1].frame) continue;
    return k[i].volume + (k[i + 1].volume - k[i].volume) * ease((frame - k[i].frame) / (k[i + 1].frame - k[i].frame), k[i].interp);
  }
  return k[k.length - 1].volume;
}

/** Sets a volume keyframe at its frame (replacing one there), sorted. */
export function setVolumeKey(keys: VolumeKey[], key: VolumeKey): VolumeKey[] {
  return [...keys.filter((k) => k.frame !== key.frame), key].sort((a, b) => a.frame - b.frame);
}

/** A stretch of sound to play: `when` seconds after the start, from `offset` seconds into the file, for `duration` seconds. */
export interface SoundPlay {
  track: string;
  sound: string;
  when: number;
  offset: number;
  duration: number;
  /** The clip's frames that play (for the volume). */
  from: number;
  to: number;
}

/** What the unmuted tracks play from frame `from` to frame `to` (inclusive), with `fps` frames per second. */
export function soundPlays(tracks: SoundTrack[], files: SoundFile[], from: number, to: number, fps: number): SoundPlay[] {
  const out: SoundPlay[] = [];
  for (const t of tracks) {
    if (!t.visible) continue;
    for (const c of t.clips) {
      const file = files.find((f) => f.id === c.sound);
      if (!file || c.end < from || c.start > to) continue;
      const s = Math.max(c.start, from);
      const e = Math.min(c.end, to);
      let when = (s - from) / fps;
      let offset = (c.offset ?? 0) + (s - c.start) / fps;
      let duration = (e - s + 1) / fps;
      // Silence before the sound starts.
      if (offset < 0) {
        when -= offset;
        duration += offset;
        offset = 0;
      }
      duration = Math.min(duration, file.duration - offset);
      if (duration <= 1e-6) continue;
      out.push({ track: t.id, sound: file.id, when, offset, duration, from: s, to: e });
    }
  }
  return out;
}

/** Volume changes of a play: [seconds after the start, volume] at each frame it covers. */
export function volumeSteps(track: Pick<SoundTrack, 'volume' | 'keys'>, play: Pick<SoundPlay, 'from' | 'to'>, from: number, fps: number): [number, number][] {
  if (track.keys.length === 0) return [[(play.from - from) / fps, track.volume]];
  const out: [number, number][] = [];
  for (let f = play.from; f <= play.to; f++) out.push([(f - from) / fps, volumeAt(track, f)]);
  return out;
}

/** Largest absolute sample in each of `buckets` equal parts of a stretch of samples (for waveforms). */
export function peaks(samples: Float32Array, sampleRate: number, start: number, duration: number, buckets: number): Float32Array {
  const out = new Float32Array(Math.max(0, buckets));
  const first = Math.max(0, Math.floor(start * sampleRate));
  const count = Math.max(0, Math.floor(duration * sampleRate));
  for (let b = 0; b < buckets; b++) {
    const a = first + Math.floor((b * count) / buckets);
    const z = Math.min(samples.length, first + Math.floor(((b + 1) * count) / buckets));
    let m = 0;
    // Long stretches: every few samples is enough for a picture.
    const step = Math.max(1, Math.floor((z - a) / 256));
    for (let i = a; i < z; i += step) m = Math.max(m, Math.abs(samples[i]));
    out[b] = m;
  }
  return out;
}

/** Channels interleaved as signed 16-bit little-endian PCM. */
export function interleave16(channels: Float32Array[]): Uint8Array {
  const n = channels[0]?.length ?? 0;
  const out = new Uint8Array(n * channels.length * 2);
  const view = new DataView(out.buffer);
  let p = 0;
  for (let i = 0; i < n; i++) {
    for (const ch of channels) {
      const v = Math.max(-1, Math.min(1, ch[i]));
      view.setInt16(p, Math.round(v < 0 ? v * 0x8000 : v * 0x7fff), true);
      p += 2;
    }
  }
  return out;
}

/** A 16-bit PCM WAV file (for tests and sounds made in the app). */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const pcm = interleave16(channels);
  const out = new Uint8Array(44 + pcm.length);
  const v = new DataView(out.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels.length, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels.length * 2, true);
  v.setUint16(32, channels.length * 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

// ------------------------------------------------------------------ files

const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function sanitizeSound(raw: unknown): DocSound | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const files: SoundFile[] = [];
  for (const f of Array.isArray(r.files) ? r.files.slice(0, 200) : []) {
    if (!f || typeof f !== 'object') continue;
    const x = f as Record<string, unknown>;
    if (typeof x.id !== 'string' || !ID.test(x.id) || files.some((e) => e.id === x.id)) continue;
    files.push({
      id: x.id,
      name: typeof x.name === 'string' ? x.name.slice(0, 120) : 'Audio',
      type: typeof x.type === 'string' && /^audio\/[a-z0-9.+-]{1,40}$/i.test(x.type) ? x.type : 'audio/wav',
      duration: num(x.duration, 0, 0, 36000),
    });
  }
  const tracks: SoundTrack[] = [];
  for (const t of Array.isArray(r.tracks) ? r.tracks.slice(0, 64) : []) {
    if (!t || typeof t !== 'object') continue;
    const x = t as Record<string, unknown>;
    const keys = (Array.isArray(x.keys) ? x.keys.slice(0, 10000) : []).flatMap((k): VolumeKey[] => {
      if (!k || typeof k !== 'object') return [];
      const y = k as Record<string, unknown>;
      const frame = typeof y.frame === 'number' && Number.isFinite(y.frame) ? Math.round(y.frame) : NaN;
      if (!(frame >= 1 && frame <= 100000)) return [];
      return [{ frame, interp: y.interp === 'hold' || y.interp === 'smooth' ? y.interp : 'linear', volume: num(y.volume, 1, 0, 1) }];
    });
    tracks.push({
      id: typeof x.id === 'string' && ID.test(x.id) && !tracks.some((e) => e.id === x.id) ? x.id : newSoundId('s'),
      name: typeof x.name === 'string' && x.name ? x.name.slice(0, 120) : 'Audio',
      visible: x.visible !== false,
      volume: num(x.volume, 1, 0, 1),
      // Clips play files the document has.
      clips: (sanitizeClips(x.clips) ?? []).filter((c) => c.sound !== undefined && files.some((f) => f.id === c.sound)),
      keys: [...new Map(keys.map((k) => [k.frame, k])).values()].sort((a, b) => a.frame - b.frame),
    });
  }
  return tracks.length || files.length ? { tracks, files } : undefined;
}
