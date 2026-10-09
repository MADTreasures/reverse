/**
 * Audio layers (File > Import > Audio, Animation > New animation layer > Audio): importing sound
 * files as clips of an audio layer, selecting, muting (the eye), renaming and deleting them, their
 * volume and volume keyframes.
 */
import { isAnimationFolder, tracksOf } from '../model/animation';
import { createAudioLayer, createMovieLayer, findLayer, flatten, insertAbove } from '../model/layers';
import type { AudioLayer, Id, Layer, PaintDocument } from '../model/types';
import { pasteClip } from '../paint/clips';
import { newSoundId, setVolumeKey, volumeAt } from '../paint/sound';
import { decodeBytes, setSoundBytes } from '../engine/sounds';
import { probeMovie, setMovieBytes } from '../engine/movies';
import { toast } from '../ui/overlays';
import * as actions from './actions';
import { activeAudio } from './animationActions';
import { getState, setState, type PaintState } from './store';

/** The selected audio layer, if any. */
export const activeSoundTrack = (s: PaintState = getState()): AudioLayer | null => activeAudio(s);

const audioLayers = (layers: Layer[]): AudioLayer[] => flatten(layers).filter((l): l is AudioLayer => l.kind === 'audio');

const nextName = (layers: Layer[]) => {
  const used = new Set(flatten(layers).map((l) => l.name));
  for (let n = 1; ; n++) if (!used.has(`Audio ${n}`)) return `Audio ${n}`;
};

/** Puts a new audio or movie layer above the current layer (never inside an animation folder: above its track). */
function insertAudio(doc: PaintDocument, layer: Layer, activeId: Id): void {
  const track = tracksOf(doc.layers, activeId)[0];
  if (track && isAnimationFolder(track)) insertAbove(doc.layers, layer, track.id);
  else actions.insertNew(doc, layer, activeId);
}

/** Animation > New animation layer > Audio: an empty audio layer (selected). */
export function newAudioTrack(): string | null {
  const s = getState();
  if (!s.doc.timeline) {
    setState({ hint: 'The canvas has no timeline yet (Animation > Timeline > New timeline)' });
    return null;
  }
  const layer = createAudioLayer(nextName(s.doc.layers));
  actions.changeDoc('New audio layer', (doc, st) => {
    insertAudio(doc, layer, st.activeLayerId);
    return layer.id;
  });
  setState({ timelineShown: true, clipSelection: [], keySelection: [] });
  return layer.id;
}

/**
 * File > Import > Audio: the sound becomes a clip of the selected audio layer (or a new one) from
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
  const label = name.replace(/\.[^.]+$/, '').slice(0, 120) || 'Audio';
  const layer = target ?? createAudioLayer(label);
  actions.changeDoc('Import audio', (doc, st) => {
    doc.sound = { files: [...(doc.sound?.files ?? []), { id, name: label, type, duration: decoded.duration }] };
    let l = findLayer(doc.layers, layer.id);
    if (!l) {
      insertAudio(doc, layer, st.activeLayerId);
      l = layer;
    }
    if (l.kind !== 'audio') return;
    const next = pasteClip({ clips: l.clips, keys: l.keys.frames }, { length, offset: 0, sound: id }, frame, t.fps);
    l.clips = next.clips;
    if (next.keys) l.keys = { ...l.keys, frames: next.keys };
    return layer.id;
  });
  setState({ timelineShown: true, clipSelection: [{ track: layer.id, start: frame }], keySelection: [] });
  return true;
}

/** Selects an audio layer (and a frame) in the Timeline palette. */
export function selectSoundTrack(id: string, frame?: number): void {
  const s = getState();
  actions.selectLayer(id);
  if (frame !== undefined) setState({ frame: Math.max(1, Math.min(s.doc.timeline?.frames ?? 1, frame)) });
}

/** Changes an audio layer (name, mute, volume). */
export function setSoundTrack(id: string, patch: Partial<Pick<AudioLayer, 'name' | 'visible' | 'volume'>>, label: string, key?: string): void {
  actions.setLayerProps(id, patch, label, key);
}

/**
 * The volume of the selected audio layer at the current frame: with volume keyframes, a keyframe
 * there; else the layer's volume.
 */
export function setVolumeNow(volume: number): void {
  const s = getState();
  const t = activeSoundTrack(s);
  if (!t) return;
  if (t.keys.frames.length === 0) {
    setSoundTrack(t.id, { volume }, 'Volume', `volume:${t.id}`);
    return;
  }
  const frame = s.frame;
  actions.changeDoc(
    'Volume keyframe',
    (doc) => {
      const x = findLayer(doc.layers, t.id);
      if (x?.kind === 'audio') x.keys = { ...x.keys, frames: setVolumeKey(x.keys.frames, frame, volume, s.keyInterp) };
    },
    { key: `volkey:${t.id}:${frame}` },
  );
}

export const volumeNow = (s: PaintState = getState()): number => {
  const t = activeSoundTrack(s);
  return t ? volumeAt({ volume: t.volume, keys: t.keys.frames }, s.frame) : 1;
};

/** Deletes an audio layer. */
export function deleteSoundTrack(id: string | null = activeSoundTrack()?.id ?? null): void {
  if (!id) return;
  actions.deleteLayer(id);
  setState({ clipSelection: [], keySelection: [] });
}

/** The sound files the audio layers of a document play (others are not saved). */
export function usedSoundFiles(doc: PaintDocument): Set<string> {
  return new Set(audioLayers(doc.layers).flatMap((l) => l.clips.map((c) => c.sound).filter((x): x is string => Boolean(x))));
}

/**
 * File > Import > Movie: a movie layer above the current layer, its clip from the current frame on
 * as long as the movie lasts; its sound plays with it. Needs an enabled timeline.
 */
export async function importMovie(file: Blob, name: string): Promise<boolean> {
  const s = getState();
  const t = s.doc.timeline;
  if (!t?.enabled) {
    toast('Movies can only be imported while the timeline is enabled (Animation > Timeline)', 'error');
    return false;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = file.type && /^video\//.test(file.type) ? file.type : /\.mov$/i.test(name) ? 'video/quicktime' : /\.webm$/i.test(name) ? 'video/webm' : 'video/mp4';
  const info = await probeMovie(bytes, type);
  if (!info) {
    toast(`${name} is not a movie this system can play`, 'error');
    return false;
  }
  const id = newSoundId('mov');
  setMovieBytes(id, bytes, type);
  // The movie's sound (when it has one) plays like an audio clip.
  setSoundBytes(id, bytes, type);
  const frame = getState().frame;
  const length = Math.max(1, Math.ceil(info.duration * t.fps));
  const label = name.replace(/\.[^.]+$/, '').slice(0, 120) || 'Movie';
  const layer = createMovieLayer(label, id, { clips: [{ start: frame, end: frame + length - 1, offset: 0 }] });
  actions.changeDoc('Import movie', (doc, st) => {
    doc.movies = [...(doc.movies ?? []), { id, name: label, type, duration: info.duration, width: info.width, height: info.height }];
    insertAudio(doc, layer, st.activeLayerId);
    return layer.id;
  });
  setState({ timelineShown: true, clipSelection: [{ track: layer.id, start: frame }], keySelection: [] });
  return true;
}

/** The movie files the movie layers of a document show (others are not saved). */
export function usedMovieFiles(doc: PaintDocument): Set<string> {
  return new Set(flatten(doc.layers).flatMap((l) => (l.kind === 'movie' ? [l.movie] : [])));
}
