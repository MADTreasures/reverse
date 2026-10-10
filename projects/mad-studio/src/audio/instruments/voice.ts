import { fadeCurve } from '../../model/clips';
import type { PitchPoint } from '../../model/notes';
import { fadeOut } from '../envelope';

/** One sounding (or scheduled) note of an instrument. */
export class Voice {
  ended = false;
  private endListeners: (() => void)[] = [];

  constructor(
    readonly key: number,
    readonly startTime: number,
    /** Time at which the voice is silent; Infinity while a live note is held. */
    public endTime: number,
    private readonly amp: GainNode,
    private readonly sources: AudioScheduledSourceNode[],
    private readonly nodes: AudioNode[],
    private readonly releaser: (at: number) => number,
  ) {
    if (sources.length > 0) sources[0].onended = () => this.cleanup();
  }

  /** Note-off for live (open-ended) voices. */
  release(at: number): void {
    if (this.ended || Number.isFinite(this.endTime)) return;
    const end = Math.max(at, this.releaser(at));
    this.endTime = end;
    this.stopSources(end);
  }

  /** Quick fade, used for choke groups, voice stealing and transport stop. */
  kill(at: number): void {
    if (this.ended || at >= this.endTime) return;
    const end = fadeOut(this.amp.gain, Math.max(at, this.startTime));
    this.endTime = end;
    this.stopSources(end);
  }

  onEnd(listener: () => void): void {
    if (this.ended) listener();
    else this.endListeners.push(listener);
  }

  private stopSources(at: number): void {
    for (const s of this.sources) {
      try {
        s.stop(at + 0.005);
      } catch {
        // Already stopped.
      }
    }
  }

  private cleanup(): void {
    if (this.ended) return;
    this.ended = true;
    for (const n of this.nodes) n.disconnect();
    for (const l of this.endListeners) l();
    this.endListeners = [];
  }
}

/** Voices registered under a group key cut each other off (open/closed hi-hat etc.). */
export class ChokeManager {
  private groups = new Map<string, Set<Voice>>();

  choke(group: string, at: number): void {
    const set = this.groups.get(group);
    if (!set) return;
    for (const v of set) if (v.startTime < at) v.kill(at);
  }

  add(group: string, voice: Voice): void {
    let set = this.groups.get(group);
    if (!set) {
      set = new Set();
      this.groups.set(group, set);
    }
    set.add(voice);
    voice.onEnd(() => set.delete(voice));
  }
}

export interface TriggerOptions {
  /** Seconds into the sample (audio clips). */
  sampleOffset?: number;
  /** Force note-length gating even for one-shot samplers. */
  gate?: boolean;
  /** Note properties (notes.ts); absent values are the defaults. */
  pan?: number;
  fine?: number;
  modX?: number;
  modY?: number;
  release?: number;
  /** Pitch curve (portamento, slide notes) in semitones relative to the key, times relative to the note start. */
  pitch?: PitchPoint[] | null;
  /** Audio clips: sample variant to play instead of the channel's sample (clipVariants.ts). */
  sample?: string;
  /** Audio clips: clip gain (linear) and fades in seconds (clips.ts). */
  clip?: ClipEnvelope;
}

export interface ClipEnvelope {
  gain: number;
  fadeIn: number;
  fadeOut: number;
  fadeInTension: number;
  fadeOutTension: number;
}

/**
 * Schedules an audio clip's gain and fades on `param` for a clip at `t` lasting `duration` seconds:
 * fadeCurve() points with setValueCurveAtTime (the native engine interpolates the same points).
 */
export function scheduleClipEnvelope(param: AudioParam, clip: ClipEnvelope, t: number, duration: number): void {
  param.value = clip.fadeIn > 0 ? 0 : clip.gain;
  try {
    if (clip.fadeIn > 0) param.setValueCurveAtTime(fadeCurve('in', clip.fadeInTension, clip.gain), t, clip.fadeIn);
    if (clip.fadeOut > 0) {
      const start = Math.max(t + clip.fadeIn, t + duration - clip.fadeOut);
      const length = t + duration - start;
      if (length > 0) param.setValueCurveAtTime(fadeCurve('out', clip.fadeOutTension, clip.gain), start, length);
    }
  } catch {
    param.cancelScheduledValues(0);
    param.value = clip.gain;
  }
}

/** Thresholds shared with the native engine (Instruments.cpp). */
export const NOTE_PAN_EPSILON = 0.001;

/** The always-stereo bus for panned voices. */
export function createPannedOutput(ctx: BaseAudioContext): GainNode {
  const g = ctx.createGain();
  g.channelCount = 2;
  g.channelCountMode = 'explicit';
  g.channelInterpretation = 'speakers';
  return g;
}

/** Schedules a pitch curve (semitones, relative times) plus a constant offset (cents) on a detune param. */
export function schedulePitch(param: AudioParam, t: number, cents: number, pitch: readonly PitchPoint[]): void {
  param.setValueAtTime(cents + pitch[0].v * 100, t);
  for (let i = 1; i < pitch.length; i++) param.linearRampToValueAtTime(cents + pitch[i].v * 100, t + pitch[i].t);
}

export interface Instrument {
  readonly output: GainNode;
  /**
   * Voices with a note pan. They are stereo, and kept apart from `output` so that they never change
   * how the channel pans the other voices (a StereoPannerNode treats mono and stereo input differently,
   * and Web Audio counts a voice's channels from the moment it is scheduled).
   */
  readonly pannedOutput: GainNode;
  trigger(key: number, velocity: number, time: number, duration: number | null, opts?: TriggerOptions): Voice | null;
  stopAll(at: number): void;
  dispose(): void;
}

/** Keeps at most `max` voices, fading out the oldest ones. */
export function enforcePolyphony(voices: Set<Voice>, max: number, at: number): void {
  if (voices.size <= max) return;
  const alive = [...voices].filter((v) => !v.ended && v.endTime > at).sort((a, b) => a.startTime - b.startTime);
  for (let i = 0; i < alive.length - max; i++) alive[i].kill(at);
}
