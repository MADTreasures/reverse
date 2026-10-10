/**
 * Sample variants of audio clips (clips.ts): reversed, time-stretched (WSOLA, the pitch stays) and
 * pitch-shifted (stretched, then resampled, so the length stays). They are computed once per variant,
 * kept in the sample pool and played by both engines like any other sample, so the browser and the
 * native engine play exactly the same audio.
 */
import { clipVariant, parseVariantSampleId, variantSampleId, type ClipVariant } from '../model/clips';
import type { Project } from '../model/types';
import { samplePool, type SamplePool } from './samplePool';

type Channel = Float32Array<ArrayBuffer>;

/** Reverses every channel (new arrays). */
function reversed(channels: readonly Float32Array[]): Channel[] {
  return channels.map((c) => c.slice().reverse());
}

/** Catmull-Rom interpolated read of `data` at fractional position `pos` (zero outside). */
function readCubic(data: Float32Array, pos: number): number {
  const i = Math.floor(pos);
  const f = pos - i;
  const at = (k: number) => (k >= 0 && k < data.length ? data[k] : 0);
  const p0 = at(i - 1);
  const p1 = at(i);
  const p2 = at(i + 1);
  const p3 = at(i + 2);
  return p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)));
}

/** Plays `channels` `ratio` times faster (shorter and higher for ratio > 1). */
export function resample(channels: readonly Float32Array[], ratio: number): Channel[] {
  const length = Math.max(1, Math.round(channels[0].length / ratio));
  return channels.map((c) => {
    const out = new Float32Array(length);
    for (let i = 0; i < length; i++) out[i] = readCubic(c, i * ratio);
    return out;
  });
}

/**
 * Waveform-similarity overlap-add: `factor` times longer at the same pitch. Frames of ~46 ms with 50 %
 * overlap; each frame is taken where it continues the previous one best (±12 ms search on the mono mix).
 */
export function timeStretch(channels: readonly Float32Array[], sampleRate: number, factor: number): Channel[] {
  const inLength = channels[0].length;
  const outLength = Math.max(1, Math.round(inLength * factor));
  if (Math.abs(factor - 1) < 1e-6) return channels.map((c) => c.slice());
  const frame = 2 * Math.max(64, Math.round((0.046 * sampleRate) / 2));
  const hop = frame / 2;
  const analysisHop = hop / factor;
  const tolerance = Math.max(8, Math.round(0.012 * sampleRate));
  const mono = new Float32Array(inLength);
  for (const c of channels) for (let i = 0; i < inLength; i++) mono[i] += c[i] / channels.length;
  const window = new Float32Array(frame);
  for (let i = 0; i < frame; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frame);
  const out = channels.map(() => new Float32Array(outLength + frame));
  const norm = new Float32Array(outLength + frame);
  const at = (k: number) => (k >= 0 && k < inLength ? mono[k] : 0);
  // Similarity of the overlap region (every `step`-th sample).
  const similarity = (a: number, b: number, step: number) => {
    let sum = 0;
    for (let i = 0; i < hop; i += step) sum += at(a + i) * at(b + i);
    return sum;
  };

  let previous = 0;
  for (let k = 0; k * hop < outLength; k++) {
    const ideal = Math.round(k * analysisHop);
    let best = ideal;
    if (k > 0) {
      const natural = previous + hop;
      // Coarse search on every 4th lag and sample, then refine around the best lag.
      let bestScore = -Infinity;
      for (let d = -tolerance; d <= tolerance; d += 4) {
        const score = similarity(natural, ideal + d, 4);
        if (score > bestScore) {
          bestScore = score;
          best = ideal + d;
        }
      }
      const coarse = best;
      bestScore = -Infinity;
      for (let d = -3; d <= 3; d++) {
        const score = similarity(natural, coarse + d, 2);
        if (score > bestScore) {
          bestScore = score;
          best = coarse + d;
        }
      }
    }
    const outPos = k * hop;
    for (let i = 0; i < frame; i++) {
      const src = best + i;
      if (src < 0 || src >= inLength) continue;
      const w = window[i];
      for (let c = 0; c < channels.length; c++) out[c][outPos + i] += channels[c][src] * w;
      norm[outPos + i] += w;
    }
    // Keep the window sum where the source ran out, so the tail fades instead of jumping.
    for (let i = 0; i < frame; i++) if (best + i >= inLength || best + i < 0) norm[outPos + i] += window[i];
    previous = best;
  }
  return out.map((c) => {
    const result = new Float32Array(outLength);
    for (let i = 0; i < outLength; i++) result[i] = norm[i] > 1e-3 ? c[i] / norm[i] : 0;
    return result;
  });
}

/** The audio of a variant: reverse, then stretch by stretch × pitch ratio, then resample by the pitch ratio. */
export function processVariant(channels: readonly Float32Array[], sampleRate: number, v: ClipVariant): Channel[] {
  let data: Channel[] = v.reverse ? reversed(channels) : channels.map((c) => c.slice());
  const ratio = Math.pow(2, v.cents / 1200);
  const factor = v.stretch * ratio;
  if (Math.abs(factor - 1) > 1e-6) data = timeStretch(data, sampleRate, factor);
  if (Math.abs(ratio - 1) > 1e-6) data = resample(data, ratio);
  return data;
}

/** Sample ids of every variant the project's audio clips need. */
export function neededVariants(project: Project): Set<string> {
  const ids = new Set<string>();
  const samplers = new Map(project.channels.flatMap((c) => (c.kind === 'sampler' && c.sampler.sampleId ? [[c.id, c.sampler.sampleId] as const] : [])));
  for (const clip of project.clips) {
    if (clip.kind !== 'audio') continue;
    const sampleId = samplers.get(clip.channelId);
    const variant = sampleId ? clipVariant(clip) : null;
    if (sampleId && variant) ids.add(variantSampleId(sampleId, variant));
  }
  return ids;
}

let suspended = false;
/** Variants an offline render is using (never pruned until released). */
const held = new Map<string, number>();

/** Keeps the variants `project` needs while a render schedules its notes; call the result to release. */
export function holdClipVariants(project: Project): () => void {
  const ids = [...neededVariants(project)];
  for (const id of ids) held.set(id, (held.get(id) ?? 0) + 1);
  return () => {
    for (const id of ids) {
      const n = (held.get(id) ?? 1) - 1;
      if (n <= 0) held.delete(id);
      else held.set(id, n);
    }
  };
}

/** While a clip is being stretched by dragging, variants are computed once the drag ends. */
export function suspendClipVariants(on: boolean): void {
  suspended = on;
}

/**
 * Makes sure the pool holds every variant the project needs (computed from the current source
 * buffers) and drops the ones nothing uses any more. Cheap when nothing changed.
 */
export function ensureClipVariants(project: Project, pool: SamplePool = samplePool): void {
  if (suspended && pool === samplePool) return;
  const needed = neededVariants(project);
  for (const entry of pool.derivedEntries()) if (!needed.has(entry.id) && !held.has(entry.id)) pool.remove(entry.id);
  for (const id of needed) {
    const parsed = parseVariantSampleId(id);
    const source = parsed ? pool.get(parsed.sampleId) : undefined;
    if (!parsed || !source || source.source === 'derived') continue;
    const existing = pool.get(id);
    if (existing && existing.derivedFrom === source.buffer) continue;
    const src = source.buffer;
    const channels = Array.from({ length: src.numberOfChannels }, (_, c) => src.getChannelData(c));
    const data = processVariant(channels, src.sampleRate, parsed.variant);
    const buffer = new AudioBuffer({ length: data[0].length, numberOfChannels: data.length, sampleRate: src.sampleRate });
    data.forEach((c, i) => buffer.copyToChannel(c, i));
    pool.add({ id, name: source.name, buffer, source: 'derived', derivedFrom: src });
  }
}
