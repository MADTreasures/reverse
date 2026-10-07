/**
 * Project data model. Everything in here is plain, serialisable data: the
 * store keeps it immutable (via immer) and the audio engine reads it.
 * Times are expressed in ticks (see timing.ts, PPQ = 96).
 */

export type Id = string;

export type WaveType = 'sine' | 'triangle' | 'sawtooth' | 'square' | 'noise';
export type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'notch';
export type LfoTarget = 'off' | 'pitch' | 'filter' | 'amp';

/** ADSR envelope; times in seconds, sustain as a 0..1 level. */
export interface Envelope {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export interface OscParams {
  wave: WaveType;
  /** 0..1 */
  level: number;
  /** Semitones, -36..36. */
  coarse: number;
  /** Cents, -100..100. */
  fine: number;
  /** Unison voices, 1..7. */
  unison: number;
  /** Unison detune spread in cents, 0..100. */
  detune: number;
  /** -1..1 */
  pan: number;
}

export interface SynthParams {
  osc: [OscParams, OscParams, OscParams];
  filter: {
    enabled: boolean;
    type: FilterType;
    /** Hz */
    cutoff: number;
    /** Q */
    resonance: number;
    /** -1..1, scaled to ±6 octaves of envelope sweep. */
    envAmount: number;
    /** 0..1, how much the cutoff follows the played key. */
    keyTrack: number;
  };
  ampEnv: Envelope;
  filterEnv: Envelope;
  lfo: {
    target: LfoTarget;
    /** Hz */
    rate: number;
    /** 0..1 */
    depth: number;
  };
  /** Output level 0..1. */
  gain: number;
}

export interface SamplerParams {
  sampleId: Id | null;
  /** MIDI key at which the sample plays at its original pitch. */
  rootKey: number;
  /** Cents. */
  fine: number;
  keyTrack: boolean;
  reverse: boolean;
  /** Play the whole sample regardless of note length (drums). */
  oneShot: boolean;
  loop: boolean;
  /** Start offset as a fraction of the sample, 0..1. */
  start: number;
  ampEnv: Envelope;
  /** Channels sharing a non-zero choke group cut each other off. */
  chokeGroup: number;
  /** A new note cuts the previous one on the same channel. */
  cutSelf: boolean;
  /** Output level 0..1. */
  gain: number;
}

interface ChannelBase {
  id: Id;
  name: string;
  color: string;
  /** Knob position 0..1 (see volumeToGain). */
  volume: number;
  /** -1..1 */
  pan: number;
  muted: boolean;
  /** Index into Project.mixer, 0 = master. */
  mixerTrack: number;
}

export interface SynthChannel extends ChannelBase {
  kind: 'synth';
  synth: SynthParams;
}

export interface SamplerChannel extends ChannelBase {
  kind: 'sampler';
  sampler: SamplerParams;
  /** Channel created for an audio clip in the playlist. */
  audioClip?: boolean;
}

export type Channel = SynthChannel | SamplerChannel;
export type ChannelKind = Channel['kind'];

export interface Note {
  id: Id;
  /** MIDI key 0..127 (60 is shown as C5). */
  key: number;
  /** Ticks from the pattern start. */
  start: number;
  /** Ticks. */
  length: number;
  /** 0..1 */
  velocity: number;
}

export interface Pattern {
  id: Id;
  name: string;
  color: string;
  /** Notes per channel id. */
  notes: Record<Id, Note[]>;
  /** Minimum length in ticks; the pattern grows with its content. */
  minLength: number;
}

export interface PlaylistTrack {
  id: Id;
  name: string;
  muted: boolean;
}

interface ClipBase {
  id: Id;
  trackId: Id;
  /** Ticks. */
  start: number;
  /** Ticks. */
  length: number;
  /** Ticks into the source material where the clip begins. */
  offset: number;
}

export interface PatternClip extends ClipBase {
  kind: 'pattern';
  patternId: Id;
}

export interface AudioClip extends ClipBase {
  kind: 'audio';
  /** Sampler channel that plays the clip. */
  channelId: Id;
}

export type Clip = PatternClip | AudioClip;

export type EffectType =
  | 'eq'
  | 'filter'
  | 'compressor'
  | 'distortion'
  | 'chorus'
  | 'delay'
  | 'reverb'
  | 'limiter';

export interface EffectSlot {
  id: Id;
  type: EffectType;
  enabled: boolean;
  params: Record<string, number>;
}

export interface MixerTrack {
  id: Id;
  name: string;
  color: string;
  /** Fader position 0..1 (see volumeToGain). */
  volume: number;
  /** -1..1 */
  pan: number;
  muted: boolean;
  solo: boolean;
  effects: EffectSlot[];
}

export interface SampleInfo {
  id: Id;
  name: string;
  source: 'factory' | 'user';
  /** Key into the factory sample generator. */
  factoryKey?: string;
  /** Original file name for user samples. */
  fileName?: string;
}

export interface Project {
  format: 'mad-studio';
  version: 1;
  name: string;
  bpm: number;
  beatsPerBar: number;
  /** 0..1, delays every second 16th step. */
  swing: number;
  channels: Channel[];
  patterns: Pattern[];
  tracks: PlaylistTrack[];
  clips: Clip[];
  /** Index 0 is the master track. */
  mixer: MixerTrack[];
  samples: Record<Id, SampleInfo>;
}
