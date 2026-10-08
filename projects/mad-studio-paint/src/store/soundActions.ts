/**
 * Audio tracks (File > Import > Audio, Animation > New animation layer > Audio): importing sound
 * files as clips of an audio track, selecting, muting, renaming and deleting tracks, their volume.
 */
import { pasteClip } from '../paint/clips';
import { newSoundId, newSoundTrack, setVolumeKey, volumeAt, type DocSound, type SoundTrack } from '../paint/sound';
import { decodeBytes, setSoundBytes } from '../engine/sounds';
import { toast } from '../ui/overlays';
import * as actions from './actions';
import { getState, setState, type PaintState } from './store';

export const soundOf = (s: PaintState = getState()): DocSound | undefined => s.doc.sound;

/** The selected audio track, if it still exists. */
export function activeSoundTrack(s: PaintState = getState()): SoundTrack | null {
  return s.activeSound ? (s.doc.sound?.tracks.find((t) => t.id === s.activeSound) ?? null) : null;
}

const nextName = (tracks: SoundTrack[]) => {
  const used = new Set(tracks.map((t) => t.name));
  for (let n = 1; ; n++) if (!used.has(`Audio ${n}`)) return `Audio ${n}`;
};

/** Animation > New animation layer > Audio: an empty audio track (selected). */
export function newAudioTrack(): string | null {
  const s = getState();
  if (!s.doc.timeline) {
    setState({ hint: 'The canvas has no timeline yet (Animation > Timeline > New timeline)' });
    return null;
  }
  const track = newSoundTrack(nextName(s.doc.sound?.tracks ?? []));
  actions.changeDoc('New audio track', (doc) => {
    doc.sound = { tracks: [...(doc.sound?.tracks ?? []), track], files: doc.sound?.files ?? [] };
  });
  setState({ activeSound: track.id, timelineShown: true, clipSelection: [], keySelection: [] });
  return track.id;
}

/**
 * File > Import > Audio: the sound becomes a clip of the selected audio track (or a new one) from
 * the current frame on, as long as the sound lasts. Needs an enabled timeline.
 */
export async function importAudio(file: Blob, name: string): Promise<boolean> {
  const s = getState();
  const t = s.doc.timeline;
  if (!t?.enabled) {
    toast('Audio files can only be imported while the timeline is enabled (Animation > Timeline)', 'error');
    return false;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const decoded = await decodeBytes(bytes);
  if (!decoded) {
    toast(`${name} is not a sound file this system can play`, 'error');
    return false;
  }
  const id = newSoundId('snd');
  const type = file.type && /^audio\//.test(file.type) ? file.type : 'audio/wav';
  setSoundBytes(id, bytes, type);
  const frame = getState().frame;
  const length = Math.max(1, Math.ceil(decoded.duration * t.fps));
  const target = activeSoundTrack();
  const track = target ?? newSoundTrack(nextName(s.doc.sound?.tracks ?? []));
  const label = name.replace(/\.[^.]+$/, '').slice(0, 120) || 'Audio';
  actions.changeDoc('Import audio', (doc) => {
    const sound = doc.sound ?? { tracks: [], files: [] };
    sound.files = [...sound.files, { id, name: label, type, duration: decoded.duration }];
    let tr = sound.tracks.find((x) => x.id === track.id);
    if (!tr) {
      tr = { ...track, name: target ? track.name : label };
      sound.tracks = [...sound.tracks, tr];
    }
    const next = pasteClip({ clips: tr.clips, keys: tr.keys }, { length, offset: 0, sound: id }, frame, t.fps);
    tr.clips = next.clips;
    tr.keys = next.keys ?? tr.keys;
    doc.sound = sound;
  });
  setState({ activeSound: track.id, timelineShown: true, clipSelection: [{ track: track.id, start: frame }], keySelection: [] });
  return true;
}

/** Selects an audio track (and a frame) in the Timeline palette. */
export function selectSoundTrack(id: string, frame?: number): void {
  const s = getState();
  setState({ activeSound: id, ...(frame !== undefined ? { frame: Math.max(1, Math.min(s.doc.timeline?.frames ?? 1, frame)) } : {}) });
}

/** Changes an audio track (name, mute, volume). */
export function setSoundTrack(id: string, patch: Partial<Pick<SoundTrack, 'name' | 'visible' | 'volume'>>, label: string, key?: string): void {
  actions.changeDoc(
    label,
    (doc) => {
      const t = doc.sound?.tracks.find((x) => x.id === id);
      if (t) Object.assign(t, patch);
    },
    key ? { key } : {},
  );
}

/**
 * The volume of the selected audio track at the current frame: with volume keyframes, a keyframe
 * there; else the track's volume.
 */
export function setVolumeNow(volume: number): void {
  const s = getState();
  const t = activeSoundTrack(s);
  if (!t) return;
  if (t.keys.length === 0) {
    setSoundTrack(t.id, { volume }, 'Volume', `volume:${t.id}`);
    return;
  }
  const frame = s.frame;
  actions.changeDoc(
    'Volume keyframe',
    (doc) => {
      const x = doc.sound?.tracks.find((y) => y.id === t.id);
      if (!x) return;
      const old = x.keys.find((k) => k.frame === frame);
      x.keys = setVolumeKey(x.keys, { frame, interp: old?.interp ?? s.keyInterp, volume });
    },
    { key: `volkey:${t.id}:${frame}` },
  );
}

export const volumeNow = (s: PaintState = getState()): number => {
  const t = activeSoundTrack(s);
  return t ? volumeAt(t, s.frame) : 1;
};

/** Deletes the selected audio track (its sound files go with it when no other track plays them). */
export function deleteSoundTrack(id = getState().activeSound): void {
  if (!id) return;
  actions.changeDoc('Delete audio track', (doc) => {
    if (!doc.sound) return;
    const tracks = doc.sound.tracks.filter((t) => t.id !== id);
    const used = new Set(tracks.flatMap((t) => t.clips.map((c) => c.sound)));
    const files = doc.sound.files.filter((f) => used.has(f.id));
    doc.sound = { tracks, files };
    if (tracks.length === 0 && files.length === 0) delete doc.sound;
  });
  setState({ activeSound: null, clipSelection: [], keySelection: [] });
}
