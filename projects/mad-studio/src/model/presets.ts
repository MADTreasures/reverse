import type { Envelope, OscParams, SynthParams } from './types';

export interface SynthPreset {
  id: string;
  name: string;
  category: 'Bass' | 'Lead' | 'Pad' | 'Keys' | 'Pluck' | 'FX';
  params: SynthParams;
}

function osc(partial: Partial<OscParams> = {}): OscParams {
  return { wave: 'sawtooth', level: 0, coarse: 0, fine: 0, unison: 1, detune: 0, pan: 0, ...partial };
}

function env(attack: number, decay: number, sustain: number, release: number): Envelope {
  return { attack, decay, sustain, release };
}

interface PresetInput {
  osc: [Partial<OscParams>, Partial<OscParams>?, Partial<OscParams>?];
  filter?: Partial<SynthParams['filter']>;
  ampEnv: Envelope;
  filterEnv?: Envelope;
  lfo?: Partial<SynthParams['lfo']>;
  gain?: number;
}

export function makeSynthParams(input: PresetInput): SynthParams {
  return {
    osc: [osc(input.osc[0]), osc(input.osc[1] ?? { wave: 'square' }), osc(input.osc[2] ?? { wave: 'sine' })],
    filter: {
      enabled: true,
      type: 'lowpass',
      cutoff: 3200,
      resonance: 1,
      envAmount: 0.25,
      keyTrack: 0.3,
      ...input.filter,
    },
    ampEnv: input.ampEnv,
    filterEnv: input.filterEnv ?? env(0.005, 0.5, 0.35, 0.3),
    lfo: { target: 'off', rate: 5, depth: 0.2, ...input.lfo },
    gain: input.gain ?? 0.5,
  };
}

export function defaultSynthParams(): SynthParams {
  return makeSynthParams({
    osc: [
      { wave: 'sawtooth', level: 0.7 },
      { wave: 'square', level: 0.35, coarse: -12 },
      { wave: 'sine', level: 0 },
    ],
    ampEnv: env(0.005, 0.3, 0.75, 0.25),
  });
}

export const SYNTH_PRESETS: SynthPreset[] = [
  {
    id: 'saw-bass',
    name: 'Saw Bass',
    category: 'Bass',
    params: makeSynthParams({
      osc: [
        { wave: 'sawtooth', level: 0.75 },
        { wave: 'square', level: 0.45, coarse: -12 },
        { wave: 'sine', level: 0.35, coarse: -12 },
      ],
      filter: { cutoff: 420, resonance: 3, envAmount: 0.45, keyTrack: 0.2 },
      ampEnv: env(0.003, 0.25, 0.65, 0.12),
      filterEnv: env(0.002, 0.22, 0.1, 0.15),
      gain: 0.36,
    }),
  },
  {
    id: 'sub-bass',
    name: 'Sub Bass',
    category: 'Bass',
    params: makeSynthParams({
      osc: [
        { wave: 'sine', level: 0.9 },
        { wave: 'triangle', level: 0.2, coarse: 12 },
      ],
      filter: { enabled: false },
      ampEnv: env(0.005, 0.2, 0.9, 0.15),
      gain: 0.6,
    }),
  },
  {
    id: 'reese-bass',
    name: 'Reese Bass',
    category: 'Bass',
    params: makeSynthParams({
      osc: [
        { wave: 'sawtooth', level: 0.6, unison: 3, detune: 28 },
        { wave: 'sawtooth', level: 0.45, coarse: -12, unison: 2, detune: 14 },
        { wave: 'sine', level: 0.4, coarse: -12 },
      ],
      filter: { cutoff: 900, resonance: 1.5, envAmount: 0.15 },
      ampEnv: env(0.01, 0.3, 0.85, 0.2),
      lfo: { target: 'filter', rate: 0.3, depth: 0.25 },
      gain: 0.38,
    }),
  },
  {
    id: 'wobble-bass',
    name: 'Wobble Bass',
    category: 'Bass',
    params: makeSynthParams({
      osc: [
        { wave: 'sawtooth', level: 0.7, unison: 2, detune: 10 },
        { wave: 'square', level: 0.5, coarse: -12 },
      ],
      filter: { cutoff: 380, resonance: 6, envAmount: 0.1, keyTrack: 0.1 },
      ampEnv: env(0.005, 0.2, 0.9, 0.15),
      lfo: { target: 'filter', rate: 2.2, depth: 0.7 },
      gain: 0.38,
    }),
  },
  {
    id: 'supersaw',
    name: 'Supersaw Lead',
    category: 'Lead',
    params: makeSynthParams({
      osc: [
        { wave: 'sawtooth', level: 0.7, unison: 7, detune: 35 },
        { wave: 'sawtooth', level: 0.35, coarse: 12, unison: 5, detune: 20 },
      ],
      filter: { cutoff: 5200, resonance: 0.8, envAmount: 0.15 },
      ampEnv: env(0.01, 0.3, 0.8, 0.3),
      gain: 0.35,
    }),
  },
  {
    id: 'square-lead',
    name: 'Square Lead',
    category: 'Lead',
    params: makeSynthParams({
      osc: [
        { wave: 'square', level: 0.55 },
        { wave: 'square', level: 0.35, fine: 8 },
      ],
      filter: { cutoff: 3000, resonance: 1.5, envAmount: 0.2 },
      ampEnv: env(0.01, 0.2, 0.85, 0.2),
      lfo: { target: 'pitch', rate: 5.5, depth: 0.08 },
      gain: 0.4,
    }),
  },
  {
    id: 'brass-stab',
    name: 'Brass Stab',
    category: 'Lead',
    params: makeSynthParams({
      osc: [
        { wave: 'sawtooth', level: 0.6, fine: -6 },
        { wave: 'sawtooth', level: 0.6, fine: 6 },
      ],
      filter: { cutoff: 800, resonance: 1.2, envAmount: 0.55 },
      ampEnv: env(0.02, 0.2, 0.8, 0.2),
      filterEnv: env(0.04, 0.3, 0.4, 0.2),
      gain: 0.4,
    }),
  },
  {
    id: 'pluck',
    name: 'Bright Pluck',
    category: 'Pluck',
    params: makeSynthParams({
      osc: [
        { wave: 'sawtooth', level: 0.7 },
        { wave: 'square', level: 0.25, coarse: 12, fine: 7 },
      ],
      filter: { cutoff: 600, resonance: 2, envAmount: 0.65, keyTrack: 0.4 },
      ampEnv: env(0.002, 0.35, 0, 0.25),
      filterEnv: env(0.001, 0.18, 0, 0.2),
      gain: 0.45,
    }),
  },
  {
    id: 'chip-arp',
    name: 'Chip Arp',
    category: 'Pluck',
    params: makeSynthParams({
      osc: [{ wave: 'square', level: 0.55 }],
      filter: { enabled: false },
      ampEnv: env(0.001, 0.12, 0.5, 0.05),
      gain: 0.4,
    }),
  },
  {
    id: 'warm-pad',
    name: 'Warm Pad',
    category: 'Pad',
    params: makeSynthParams({
      osc: [
        { wave: 'sawtooth', level: 0.5, unison: 3, detune: 18, pan: -0.2 },
        { wave: 'triangle', level: 0.4, coarse: 12, pan: 0.2 },
        { wave: 'sawtooth', level: 0.25, coarse: -12 },
      ],
      filter: { cutoff: 1400, resonance: 0.7, envAmount: 0.2 },
      ampEnv: env(0.6, 1.0, 0.8, 1.2),
      filterEnv: env(0.8, 1.5, 0.5, 1.0),
      lfo: { target: 'filter', rate: 0.2, depth: 0.2 },
      gain: 0.32,
    }),
  },
  {
    id: 'strings',
    name: 'Soft Strings',
    category: 'Pad',
    params: makeSynthParams({
      osc: [
        { wave: 'sawtooth', level: 0.55, unison: 5, detune: 15 },
        { wave: 'sawtooth', level: 0.25, coarse: 12, unison: 3, detune: 10 },
      ],
      filter: { cutoff: 3500, resonance: 0.5, envAmount: 0.1 },
      ampEnv: env(0.35, 0.5, 0.85, 0.6),
      lfo: { target: 'pitch', rate: 5, depth: 0.03 },
      gain: 0.3,
    }),
  },
  {
    id: 'glass-keys',
    name: 'Glass Keys',
    category: 'Keys',
    params: makeSynthParams({
      osc: [
        { wave: 'sine', level: 0.7 },
        { wave: 'triangle', level: 0.3, coarse: 12 },
        { wave: 'sine', level: 0.12, coarse: 19 },
      ],
      filter: { cutoff: 6000, resonance: 0.7, envAmount: 0 },
      ampEnv: env(0.003, 1.2, 0.25, 0.6),
      gain: 0.5,
    }),
  },
  {
    id: 'e-piano',
    name: 'Tine Piano',
    category: 'Keys',
    params: makeSynthParams({
      osc: [
        { wave: 'sine', level: 0.8 },
        { wave: 'sine', level: 0.3, coarse: 12, fine: 4 },
        { wave: 'triangle', level: 0.08, coarse: 24 },
      ],
      filter: { enabled: false },
      ampEnv: env(0.002, 1.8, 0.15, 0.4),
      lfo: { target: 'amp', rate: 4, depth: 0.15 },
      gain: 0.42,
    }),
  },
  {
    id: 'noise-sweep',
    name: 'Noise Sweep',
    category: 'FX',
    params: makeSynthParams({
      osc: [{ wave: 'noise', level: 0.6 }],
      filter: { type: 'bandpass', cutoff: 400, resonance: 4, envAmount: 0.8, keyTrack: 0 },
      ampEnv: env(1.5, 0.5, 0.8, 1.0),
      filterEnv: env(2.0, 1.0, 0.6, 1.0),
      gain: 0.9,
    }),
  },
];

export function findPreset(id: string): SynthPreset | undefined {
  return SYNTH_PRESETS.find((p) => p.id === id);
}
