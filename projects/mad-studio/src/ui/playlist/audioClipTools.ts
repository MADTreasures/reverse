/**
 * Audio clip tools of the playlist (FL Studio): normalize from the gain handle's menu and the clip
 * menu's Chop (beat detection, Dull / Medium / Sharp).
 */
import { CLIP_GAIN_MAX_DB } from '../../model/clips';
import { ticksToSeconds } from '../../model/timing';
import type { AudioClip, Id, Project } from '../../model/types';
import { endCoalesce, gestureKey, sliceClips, updateAudioClips } from '../../store/actions';
import { useStore } from '../../store/store';
import { audioClipBuffer } from './draw';

/** The audible part of a clip in its buffer: [from, to) frames. */
function clipFrames(project: Project, clip: AudioClip, buffer: AudioBuffer): [number, number] {
  const from = Math.max(0, Math.floor(ticksToSeconds(clip.offset, project.bpm) * buffer.sampleRate));
  const to = Math.min(buffer.length, from + Math.ceil(ticksToSeconds(clip.length, project.bpm) * buffer.sampleRate));
  return [from, to];
}

/** Peak level of the audio a clip plays (before its gain and fades). */
export function clipPeak(project: Project, clip: AudioClip): number {
  const buffer = audioClipBuffer(project, clip);
  if (!buffer) return 0;
  const [from, to] = clipFrames(project, clip, buffer);
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(data[i]));
  }
  return peak;
}

/** FL Studio's gain handle › Normalize selection individually / as a group: peaks to 0 dB. */
export function normalizeClips(ids: Id[], asGroup: boolean): void {
  const project = useStore.getState().project;
  const clips = project.clips.filter((c): c is AudioClip => c.kind === 'audio' && ids.includes(c.id));
  const peaks = new Map(clips.map((c) => [c.id, clipPeak(project, c)]));
  const groupPeak = Math.max(0, ...peaks.values());
  const gainFor = (peak: number) => (peak > 1e-6 ? Math.min(CLIP_GAIN_MAX_DB, Math.round(-20 * Math.log10(peak) * 100) / 100) : 0);
  updateAudioClips(
    clips.map((c) => c.id),
    (c) => void (c.gain = gainFor(asGroup ? groupPeak : (peaks.get(c.id) ?? 0))),
    { label: 'playlist normalize clips' },
  );
}

export type ChopSensitivity = 'dull' | 'medium' | 'sharp';

const CHOP: Record<ChopSensitivity, { rise: number; gap: number }> = {
  dull: { rise: 9, gap: 0.15 },
  medium: { rise: 6, gap: 0.08 },
  sharp: { rise: 3.5, gap: 0.05 },
};

/** Onset times (seconds from the clip's start) found by a 10 ms energy rise detector. */
export function detectOnsets(channels: Float32Array[], sampleRate: number, from: number, to: number, sensitivity: ChopSensitivity): number[] {
  const { rise, gap } = CHOP[sensitivity];
  const hop = Math.max(1, Math.round(0.01 * sampleRate));
  const levels: number[] = [];
  for (let start = from; start + hop <= to; start += hop) {
    let sum = 0;
    for (const ch of channels) for (let i = start; i < start + hop; i++) sum += ch[i] * ch[i];
    levels.push(10 * Math.log10(sum / (hop * channels.length) + 1e-12));
  }
  const loudest = Math.max(-120, ...levels);
  const onsets: number[] = [];
  let last = -Infinity;
  for (let k = 3; k < levels.length; k++) {
    const before = (levels[k - 1] + levels[k - 2] + levels[k - 3]) / 3;
    const t = (k * hop) / sampleRate;
    if (levels[k] - before >= rise && levels[k] > loudest - 40 && t - last >= gap && t > 0.03) {
      onsets.push(t);
      last = t;
    }
  }
  return onsets;
}

/** FL Studio's clip menu › Chop: slices the clip at the beats it detects. Returns the number of cuts. */
export function chopClip(clipId: Id, sensitivity: ChopSensitivity): number {
  const project = useStore.getState().project;
  const clip = project.clips.find((c): c is AudioClip => c.id === clipId && c.kind === 'audio');
  const buffer = clip ? audioClipBuffer(project, clip) : null;
  if (!clip || !buffer) return 0;
  const [from, to] = clipFrames(project, clip, buffer);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const spt = ticksToSeconds(1, project.bpm);
  const ticks = detectOnsets(channels, buffer.sampleRate, from, to, sensitivity)
    .map((t) => Math.round(clip.start + t / spt))
    .filter((t, i, list) => t > clip.start && t < clip.start + clip.length && list.indexOf(t) === i);
  const key = gestureKey('chop');
  let current = clip.id;
  for (const tick of ticks) {
    const [created] = sliceClips([current], tick, { coalesce: key, label: 'playlist chop clip' });
    if (!created) break;
    current = created;
  }
  endCoalesce();
  return ticks.length;
}
