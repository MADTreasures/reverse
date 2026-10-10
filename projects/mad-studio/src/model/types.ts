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

/** Third-party plugin (VST3/AU) as reported by the native engine's plugin scan. */
export interface PluginDescription {
  /** Stable id across scans (format, name, file and unique id). */
  uid: string;
  name: string;
  vendor: string;
  /** 'VST3', 'AudioUnit', 'LV2', … */
  format: string;
  category: string;
  version: string;
  fileOrIdentifier: string;
  isInstrument: boolean;
  numInputs: number;
  numOutputs: number;
}

/** A plugin instance stored in the project (channel instrument or mixer effect). */
export interface PluginInstanceData {
  uid: string;
  name: string;
  vendor: string;
  format: string;
  fileOrIdentifier: string;
  isInstrument: boolean;
  /** Opaque plugin state (base64), captured from the engine when the project is saved. */
  state: string | null;
  /**
   * Samples added to the latency the plugin reports, for plugins that misreport it (FL Studio: wrapper
   * settings › Latency). Absent = 0.
   */
  latencyOffset?: number;
}

export interface PluginChannel extends ChannelBase {
  kind: 'plugin';
  plugin: PluginInstanceData;
}

/**
 * Segment shapes of automation clips (named after the point that ends the segment, like FL Studio's
 * "curve type" of the right-hand point).
 */
export type CurveMode =
  | 'single'
  | 'single2'
  | 'single3'
  | 'double'
  | 'double2'
  | 'double3'
  | 'hold'
  | 'stairs'
  | 'smoothStairs'
  | 'pulse'
  | 'wave'
  | 'halfSine'
  | 'smooth';

export interface AutomationPoint {
  /** Ticks from the start of the automation data. */
  tick: number;
  /** Normalized value 0..1 (mapped onto the target's range). */
  value: number;
  /** -1..1, bends the segment that ends at this point (or sets its frequency for stairs/pulse/wave). */
  tension: number;
  /** Shape of the segment that ends at this point. */
  mode: CurveMode;
}

export interface AutomationData {
  /** Automated parameter (see automationTargets.ts), e.g. `ch:<id>:volume`; null when unlinked. */
  target: string | null;
  /** Sorted by tick; the first point sits at tick 0. */
  points: AutomationPoint[];
  /** Length of the automation data in ticks (at least the last point's tick). */
  length: number;
}

/** Automation clip "channel": like in FL Studio it lives in the channel rack and is placed in the playlist. */
export interface AutomationChannel extends ChannelBase {
  kind: 'automation';
  automation: AutomationData;
}

export type Channel = SynthChannel | SamplerChannel | PluginChannel | AutomationChannel;
export type ChannelKind = Channel['kind'];
/** Channels that produce sound. */
export type AudioChannel = SynthChannel | SamplerChannel | PluginChannel;

/**
 * A note in a pattern. The optional fields are FL Studio's note properties; an absent field has its
 * default value (see notes.ts), so files and drafts only carry what differs.
 */
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
  /** Release (note-off) velocity 0..1, default 0.5: plugins get it as MIDI note-off velocity, the built-in instruments scale their release time with it. */
  release?: number;
  /** -1..1, default 0. */
  pan?: number;
  /** Fine pitch in cents, -1200..1200, default 0. */
  fine?: number;
  /** Mod X 0..1, default 0.5 (built-in synth: filter cutoff). */
  modX?: number;
  /** Mod Y 0..1, default 0.5 (built-in synth: filter resonance). */
  modY?: number;
  /** Colour group 0..15 (plugins: MIDI channel 1..16; slide notes only move notes of their group). */
  color?: number;
  /** Slide note: plays nothing itself, glides the sounding notes of its colour group to its key over its length. */
  slide?: boolean;
  /** Portamento note: glides from the previous note's pitch to its own key (channel glide time). */
  porta?: boolean;
  /** Muted notes stay in the piano roll but do not play (FL Studio's mute tool). */
  muted?: boolean;
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
  /** Muted clips stay in the playlist but do not play (FL Studio's clip menu › Muted, mute tool). */
  muted?: boolean;
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

export interface AutomationClip extends ClipBase {
  kind: 'automation';
  /** Automation channel whose data the clip plays. */
  channelId: Id;
}

export type Clip = PatternClip | AudioClip | AutomationClip;

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
  /** Built-in effect type, or 'plugin' for a third-party plugin hosted by the native engine. */
  type: EffectType | 'plugin';
  enabled: boolean;
  params: Record<string, number>;
  /** Set when type === 'plugin'. */
  plugin?: PluginInstanceData;
}

export type SlotType = EffectSlot['type'];

/**
 * Audio input of a mixer track (FL Studio's mixer "Input" menu): `stereo:N` records device inputs N and
 * N+1 (0-based, "In 1 - In 2" is `stereo:0`), `mono:N` a single input.
 */
export type TrackInput = `stereo:${number}` | `mono:${number}`;

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
  /** Audio input recorded / monitored on this track. */
  input: TrackInput | null;
  /** Armed for audio recording (FL Studio's red record dot under each track). */
  armed: boolean;
  /**
   * Manual delay compensation in ms (FL Studio: the track's PDC panel): > 0 delays this track, < 0 delays
   * all the others.
   */
  latencyOffset: number;
}

export interface SampleInfo {
  id: Id;
  name: string;
  source: 'factory' | 'user';
  /** Set for audio recorded in MAD Studio (shown in the browser's "Recorded" folder). */
  recorded?: boolean;
  /** Key into the factory sample generator. */
  factoryKey?: string;
  /** Original file name for user samples. */
  fileName?: string;
}

export interface Project {
  format: 'mad-studio';
  /** 2 added plugins, automation clips and recording fields. Version 1 files load unchanged. */
  version: 2;
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
  /** Automatic plugin delay compensation (Mixer menu › Plugin delay compensation › Automatic). */
  pdc: boolean;
  /** Read automation of parameters behind latent plugins that much earlier (› Compensate automations). */
  pdcAutomation: boolean;
}
