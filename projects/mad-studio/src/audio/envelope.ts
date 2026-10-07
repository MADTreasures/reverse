import type { Envelope } from '../model/types';

const MIN_ATTACK = 0.0015;
const MIN_RELEASE = 0.004;

/**
 * Value of a linear-attack / exponential-decay envelope `x` seconds after the
 * note started (before release), moving from `base` towards `peak`.
 */
export function envelopeValue(env: Envelope, base: number, peak: number, x: number): number {
  const a = Math.max(env.attack, MIN_ATTACK);
  if (x <= 0) return base;
  if (x < a) return base + (peak - base) * (x / a);
  const sustain = base + (peak - base) * env.sustain;
  const tau = Math.max(env.decay, 0.001) / 4;
  return sustain + (peak - sustain) * Math.exp(-(x - a) / tau);
}

/**
 * Schedules a complete envelope on an AudioParam. With a known `duration` the
 * release is scheduled too and the time at which the envelope reaches silence
 * is returned; with `duration === null` (live notes) Infinity is returned and
 * releaseEnvelope() must be called later.
 */
export function scheduleEnvelope(
  param: AudioParam,
  env: Envelope,
  t0: number,
  base: number,
  peak: number,
  duration: number | null,
): number {
  const a = Math.max(env.attack, MIN_ATTACK);
  param.cancelScheduledValues(t0);
  param.setValueAtTime(base, t0);
  if (duration !== null && duration < a) {
    const v = envelopeValue(env, base, peak, duration);
    param.linearRampToValueAtTime(v, t0 + duration);
    return scheduleRelease(param, env, v, base, t0 + duration);
  }
  param.linearRampToValueAtTime(peak, t0 + a);
  param.setTargetAtTime(base + (peak - base) * env.sustain, t0 + a, Math.max(env.decay, 0.001) / 4);
  if (duration === null) return Infinity;
  const tr = t0 + duration;
  const v = envelopeValue(env, base, peak, duration);
  param.setValueAtTime(v, tr);
  return scheduleRelease(param, env, v, base, tr);
}

function scheduleRelease(param: AudioParam, env: Envelope, from: number, base: number, tr: number): number {
  const r = Math.max(env.release, MIN_RELEASE);
  param.setValueAtTime(from, tr);
  param.setTargetAtTime(base, tr, r / 5);
  return tr + r * 1.2;
}

/** Releases a live (open-ended) envelope at time `tr`; returns when it is silent. */
export function releaseEnvelope(
  param: AudioParam,
  env: Envelope,
  t0: number,
  base: number,
  peak: number,
  tr: number,
): number {
  const v = envelopeValue(env, base, peak, tr - t0);
  if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(tr);
  else param.cancelScheduledValues(tr);
  return scheduleRelease(param, env, v, base, tr);
}

/** Fast fade to `base` used when voices are stolen, choked or stopped. */
export function fadeOut(param: AudioParam, at: number, base = 0, time = 0.012): number {
  if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(at);
  else {
    param.cancelScheduledValues(at);
    param.setValueAtTime(param.value, at);
  }
  param.setTargetAtTime(base, at, time / 4);
  return at + time * 1.5;
}
