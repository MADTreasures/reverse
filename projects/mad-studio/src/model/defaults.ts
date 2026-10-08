import { paletteColor } from './colors';
import { defaultEffectParams } from './effects';
import { factorySampleId, factorySampleInfo, findFactorySample } from './factory';
import { makeId } from './ids';
import { defaultSynthParams } from './presets';
import { ticksPerBar } from './timing';
import { flatAutomation } from './automation';
import type {
  AutomationChannel,
  MixerTrack,
  Pattern,
  PlaylistTrack,
  PluginChannel,
  PluginInstanceData,
  Project,
  SamplerChannel,
  SamplerParams,
  SynthChannel,
  SynthParams,
} from './types';

export const DEFAULT_BPM = 130;
export const DEFAULT_BEATS_PER_BAR = 4;
export const DEFAULT_VELOCITY = 100 / 127;
export const DEFAULT_INSERTS = 16;
export const DEFAULT_TRACKS = 24;
export const MAX_INSERTS = 64;
/** Colour of automation clip channels (a muted red, as automation is shown in FL Studio). */
export const AUTOMATION_COLOR = '#c46a6a';

export function defaultSamplerParams(sampleId: string | null, rootKey = 60): SamplerParams {
  return {
    sampleId,
    rootKey,
    fine: 0,
    keyTrack: true,
    reverse: false,
    oneShot: true,
    loop: false,
    start: 0,
    ampEnv: { attack: 0.001, decay: 0.3, sustain: 1, release: 0.08 },
    chokeGroup: 0,
    cutSelf: false,
    gain: 0.8,
  };
}

export function createSynthChannel(opts: {
  name?: string;
  color?: string;
  params?: SynthParams;
  mixerTrack?: number;
} = {}): SynthChannel {
  return {
    id: makeId('ch'),
    kind: 'synth',
    name: opts.name ?? 'Synth',
    color: opts.color ?? paletteColor(3),
    volume: 0.8,
    pan: 0,
    muted: false,
    mixerTrack: opts.mixerTrack ?? 0,
    synth: structuredClone(opts.params ?? defaultSynthParams()),
  };
}

export function createSamplerChannel(opts: {
  name: string;
  sampleId: string | null;
  color?: string;
  params?: Partial<SamplerParams>;
  mixerTrack?: number;
  audioClip?: boolean;
}): SamplerChannel {
  const channel: SamplerChannel = {
    id: makeId('ch'),
    kind: 'sampler',
    name: opts.name,
    color: opts.color ?? paletteColor(0),
    volume: 0.8,
    pan: 0,
    muted: false,
    mixerTrack: opts.mixerTrack ?? 0,
    sampler: { ...defaultSamplerParams(opts.sampleId), ...opts.params },
  };
  if (opts.audioClip) channel.audioClip = true;
  return channel;
}

export function createPluginChannel(plugin: PluginInstanceData, opts: { color?: string; mixerTrack?: number } = {}): PluginChannel {
  return {
    id: makeId('ch'),
    kind: 'plugin',
    name: plugin.name,
    color: opts.color ?? paletteColor(4),
    volume: 0.8,
    pan: 0,
    muted: false,
    mixerTrack: opts.mixerTrack ?? 0,
    plugin: structuredClone(plugin),
  };
}

export function createAutomationChannel(opts: { name: string; target: string | null; value: number; length: number; color?: string }): AutomationChannel {
  return {
    id: makeId('ch'),
    kind: 'automation',
    name: opts.name,
    color: opts.color ?? AUTOMATION_COLOR,
    volume: 0.8,
    pan: 0,
    muted: false,
    mixerTrack: 0,
    automation: { target: opts.target, points: flatAutomation(opts.value, opts.length), length: Math.max(1, Math.round(opts.length)) },
  };
}

/** Sampler channel preconfigured for one of the built-in sounds. */
export function createFactoryChannel(key: string, opts: { color?: string; mixerTrack?: number } = {}): SamplerChannel {
  const def = findFactorySample(key);
  return createSamplerChannel({
    name: def?.name ?? key,
    sampleId: factorySampleId(key),
    color: opts.color,
    mixerTrack: opts.mixerTrack,
    params: {
      rootKey: def?.rootKey ?? 60,
      chokeGroup: def?.chokeGroup ?? 0,
      // Tonal one-shots like the 808 sub should follow note length.
      oneShot: def?.category !== 'Bass',
      ampEnv: def?.category === 'Bass'
        ? { attack: 0.002, decay: 0.3, sustain: 1, release: 0.15 }
        : defaultSamplerParams(null).ampEnv,
    },
  });
}

export function createPattern(name: string, color: string, beatsPerBar = DEFAULT_BEATS_PER_BAR): Pattern {
  return { id: makeId('pat'), name, color, notes: {}, minLength: ticksPerBar(beatsPerBar) };
}

export function createMixerTrack(index: number): MixerTrack {
  return {
    id: makeId('mx'),
    name: index === 0 ? 'Master' : `Insert ${index}`,
    color: index === 0 ? '#9aa7b3' : paletteColor(index - 1),
    volume: 0.8,
    pan: 0,
    muted: false,
    solo: false,
    effects: [],
    input: null,
    armed: false,
    latencyOffset: 0,
  };
}

export function createMixer(inserts = DEFAULT_INSERTS): MixerTrack[] {
  return Array.from({ length: inserts + 1 }, (_, i) => createMixerTrack(i));
}

export function createPlaylistTrack(index: number): PlaylistTrack {
  return { id: makeId('trk'), name: `Track ${index + 1}`, muted: false };
}

export function createTracks(count = DEFAULT_TRACKS): PlaylistTrack[] {
  return Array.from({ length: count }, (_, i) => createPlaylistTrack(i));
}

/** Blank project in the spirit of a basic beat template: four drum channels and one empty pattern. */
export function createEmptyProject(): Project {
  const kit = ['kick_punch', 'clap', 'hat_closed', 'snare_tight'];
  const channels = kit.map((key, i) => createFactoryChannel(key, { color: paletteColor(i), mixerTrack: i + 1 }));
  const samples = Object.fromEntries(kit.map((key) => [factorySampleId(key), factorySampleInfo(key)]));
  const mixer = createMixer();
  channels.forEach((ch, i) => {
    mixer[i + 1].name = ch.name;
  });
  // A limiter on the master keeps chords and stacked sounds from clipping the output.
  mixer[0].effects.push({ id: makeId('fx'), type: 'limiter', enabled: true, params: defaultEffectParams('limiter') });
  return {
    format: 'mad-studio',
    version: 2,
    name: 'Untitled',
    bpm: DEFAULT_BPM,
    beatsPerBar: DEFAULT_BEATS_PER_BAR,
    swing: 0,
    channels,
    patterns: [createPattern('Pattern 1', paletteColor(5))],
    tracks: createTracks(),
    clips: [],
    mixer,
    samples,
    pdc: true,
    pdcAutomation: true,
  };
}
