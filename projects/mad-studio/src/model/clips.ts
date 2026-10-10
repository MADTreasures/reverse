/**
 * Audio clip instance properties (FL Studio: the playlist's fade, tension and gain handles and the
 * clip properties). Every clip of an audio clip channel is an instance with its own gain, fades,
 * pitch, reverse and stretch; the channel's sampler settings apply to all of them.
 *
 * Gain and fades are applied by both engines while the clip plays, with the same curve: the web
 * engine schedules `fadeCurve()` with setValueCurveAtTime, the native engine interpolates the same
 * points (engine/src/engine/NoteShaping.h). Pitch, stretch and reverse produce a variant of the
 * sample (audio/clipVariants.ts) that both engines play like any other sample.
 */
import type { AudioClip, Id } from './types';

export const CLIP_GAIN_MIN_DB = -96;
export const CLIP_GAIN_MAX_DB = 36;
export const CLIP_PITCH_RANGE = 24;
export const CLIP_STRETCH_MIN = 0.25;
export const CLIP_STRETCH_MAX = 4;
/** Points of a fade curve (Web Audio interpolates linearly between them; so does the native engine). */
export const FADE_CURVE_POINTS = 256;

/** Linear gain of a clip gain in dB (at or below -96 dB: silent, like FL Studio's -∞). */
export function clipGain(db: number | undefined): number {
  if (db === undefined || db === 0) return 1;
  if (db <= CLIP_GAIN_MIN_DB) return 0;
  return Math.pow(10, Math.min(CLIP_GAIN_MAX_DB, db) / 20);
}

/**
 * Fade shape: gain at position x (0 = silent end, 1 = full level) for a tension in -1..1. Tension 0 is
 * linear, positive tension starts slowly (exponential feel), negative tension rises quickly.
 */
export function fadeShape(x: number, tension: number): number {
  const p = Math.min(1, Math.max(0, x));
  const t = Math.min(1, Math.max(-1, tension));
  if (t >= 0) return Math.pow(p, 1 + 3 * t);
  return 1 - Math.pow(1 - p, 1 - 3 * t);
}

/** The fade-in curve (0 → 1) or fade-out curve (1 → 0) as FADE_CURVE_POINTS float32 values, times `gain`. */
export function fadeCurve(kind: 'in' | 'out', tension: number, gain = 1): Float32Array<ArrayBuffer> {
  const n = FADE_CURVE_POINTS;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    out[i] = gain * fadeShape(kind === 'in' ? x : 1 - x, tension);
  }
  return out;
}

/** Fade lengths in ticks, scaled down together so they never overlap within the clip. */
export function clipFades(clip: Pick<AudioClip, 'length' | 'fadeIn' | 'fadeOut'>): { fadeIn: number; fadeOut: number } {
  const fadeIn = Math.max(0, clip.fadeIn ?? 0);
  const fadeOut = Math.max(0, clip.fadeOut ?? 0);
  const sum = fadeIn + fadeOut;
  if (sum <= clip.length || sum <= 0) return { fadeIn, fadeOut };
  const k = clip.length / sum;
  return { fadeIn: fadeIn * k, fadeOut: fadeOut * k };
}

/** Pitch, stretch and reverse of a clip: what its sample variant is made of. */
export interface ClipVariant {
  /** Time factor (2 = twice as long, same pitch). */
  stretch: number;
  /** Pitch shift in cents (keeps the length). */
  cents: number;
  reverse: boolean;
}

/** The clip's variant, or null when it plays the original sample. */
export function clipVariant(clip: Pick<AudioClip, 'pitch' | 'fine' | 'reverse' | 'stretch'>): ClipVariant | null {
  const stretch = Math.min(CLIP_STRETCH_MAX, Math.max(CLIP_STRETCH_MIN, clip.stretch ?? 1));
  const cents = Math.round(100 * (clip.pitch ?? 0) + (clip.fine ?? 0));
  const reverse = clip.reverse === true;
  if (Math.abs(stretch - 1) < 1e-6 && cents === 0 && !reverse) return null;
  return { stretch: Math.round(stretch * 10000) / 10000, cents, reverse };
}

const VARIANT_SEPARATOR = '~';

/** Sample id of a variant: the source id plus the processing ("factory:kick~x1.5c-200r"). */
export function variantSampleId(sampleId: Id, v: ClipVariant): string {
  return `${sampleId}${VARIANT_SEPARATOR}x${v.stretch}c${v.cents}${v.reverse ? 'r' : ''}`;
}

export function parseVariantSampleId(id: string): { sampleId: Id; variant: ClipVariant } | null {
  const i = id.lastIndexOf(VARIANT_SEPARATOR);
  if (i <= 0) return null;
  const m = /^x(-?[\d.]+)c(-?\d+)(r?)$/.exec(id.slice(i + 1));
  if (!m) return null;
  return { sampleId: id.slice(0, i), variant: { stretch: Number(m[1]), cents: Number(m[2]), reverse: m[3] === 'r' } };
}
