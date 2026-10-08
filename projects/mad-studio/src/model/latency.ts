/**
 * Plugin delay compensation (FL Studio: Mixer menu › Plugin delay compensation). The native engine
 * compensates and reports what it does (`latency` events, engine/PROTOCOL.md); these helpers convert
 * and format its values for the mixer and the plugin wrapper.
 */

/** Manual track offsets are limited to ±1 s (the engine clamps the same way). */
export const MAX_TRACK_LATENCY_OFFSET_MS = 1000;
/** Plugin latency offsets in samples (the engine compensates at most 2^19 samples per path). */
export const MAX_PLUGIN_LATENCY_OFFSET = 1 << 19;

export const samplesToMs = (samples: number, sampleRate: number): number => (sampleRate > 0 ? (samples * 1000) / sampleRate : 0);
export const msToSamples = (ms: number, sampleRate: number): number => Math.round((ms * sampleRate) / 1000);
export const beatsToMs = (beats: number, bpm: number): number => (beats * 60000) / bpm;
export const msToBeats = (ms: number, bpm: number): number => (ms * bpm) / 60000;

export const clampTrackOffset = (ms: number): number =>
  Number.isFinite(ms) ? Math.min(MAX_TRACK_LATENCY_OFFSET_MS, Math.max(-MAX_TRACK_LATENCY_OFFSET_MS, ms)) : 0;
export const clampPluginOffset = (samples: number): number =>
  Number.isFinite(samples) ? Math.round(Math.min(MAX_PLUGIN_LATENCY_OFFSET, Math.max(-MAX_PLUGIN_LATENCY_OFFSET, samples))) : 0;

/** "20.8 ms" (one decimal below 100 ms). */
export function formatMs(ms: number): string {
  const rounded = Math.abs(ms) >= 100 ? Math.round(ms) : Math.round(ms * 10) / 10;
  return `${Object.is(rounded, -0) ? 0 : rounded} ms`;
}

/** Signed offset: "+10 ms", "−2.5 ms", "0 ms". */
export function formatOffsetMs(ms: number): string {
  const text = formatMs(Math.abs(ms));
  if (text === '0 ms') return text;
  return `${ms > 0 ? '+' : '−'}${text}`;
}

/** "20.8 ms (1000 samples)". */
export function formatLatency(samples: number, sampleRate: number): string {
  return `${formatMs(samplesToMs(samples, sampleRate))} (${samples} sample${samples === 1 ? '' : 's'})`;
}

/** Mouse-wheel step of a track's latency offset in ms: 10 ms, Ctrl/Cmd 1 ms, Ctrl/Cmd+Alt one sample (FL Studio). */
export function wheelStepMs(e: { deltaY: number; ctrlKey: boolean; metaKey: boolean; altKey: boolean }, sampleRate: number): number {
  const dir = e.deltaY < 0 ? 1 : -1;
  if ((e.ctrlKey || e.metaKey) && e.altKey) return dir * samplesToMs(1, sampleRate);
  return dir * (e.ctrlKey || e.metaKey ? 1 : 10);
}
