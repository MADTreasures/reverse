import type { EffectType } from './types';

/** Describes one automatable effect parameter; the UI renders knobs from these. */
export interface ParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  default: number;
  /** Logarithmic knob travel for frequencies and times. */
  curve?: 'linear' | 'log';
  unit?: 'Hz' | 'dB' | 's' | 'ms' | '%' | ':1' | '';
  /** Discrete choices; the stored value is the option index. */
  options?: string[];
}

export interface EffectSpec {
  type: EffectType;
  name: string;
  /** Short label for mixer slots. */
  short: string;
  params: ParamSpec[];
}

const DELAY_DIVISIONS = [
  '1/32',
  '1/16',
  '1/16 dotted',
  '1/8 triplet',
  '1/8',
  '1/8 dotted',
  '1/4 triplet',
  '1/4',
  '1/4 dotted',
  '1/2',
  '1 bar',
];

/** Length of each delay division in beats (quarter notes). */
export const DELAY_DIVISION_BEATS = [
  0.125,
  0.25,
  0.375,
  1 / 3,
  0.5,
  0.75,
  2 / 3,
  1,
  1.5,
  2,
  4,
];

export const EFFECT_SPECS: Record<EffectType, EffectSpec> = {
  eq: {
    type: 'eq',
    name: 'Parametric EQ',
    short: 'EQ',
    params: [
      { key: 'lowGain', label: 'Low', min: -18, max: 18, default: 0, unit: 'dB' },
      { key: 'lowFreq', label: 'Low freq', min: 30, max: 1000, default: 120, curve: 'log', unit: 'Hz' },
      { key: 'midGain', label: 'Mid', min: -18, max: 18, default: 0, unit: 'dB' },
      { key: 'midFreq', label: 'Mid freq', min: 150, max: 8000, default: 1000, curve: 'log', unit: 'Hz' },
      { key: 'midQ', label: 'Mid Q', min: 0.2, max: 8, default: 0.9, curve: 'log', unit: '' },
      { key: 'highGain', label: 'High', min: -18, max: 18, default: 0, unit: 'dB' },
      { key: 'highFreq', label: 'High freq', min: 1500, max: 16000, default: 6000, curve: 'log', unit: 'Hz' },
    ],
  },
  filter: {
    type: 'filter',
    name: 'Auto Filter',
    short: 'Filter',
    params: [
      { key: 'mode', label: 'Mode', min: 0, max: 3, default: 0, options: ['Low pass', 'High pass', 'Band pass', 'Notch'] },
      { key: 'cutoff', label: 'Cutoff', min: 20, max: 20000, default: 4000, curve: 'log', unit: 'Hz' },
      { key: 'resonance', label: 'Reso', min: 0.1, max: 18, default: 1, curve: 'log', unit: '' },
      { key: 'lfoRate', label: 'LFO rate', min: 0.05, max: 20, default: 1, curve: 'log', unit: 'Hz' },
      { key: 'lfoDepth', label: 'LFO depth', min: 0, max: 1, default: 0, unit: '%' },
    ],
  },
  compressor: {
    type: 'compressor',
    name: 'Compressor',
    short: 'Comp',
    params: [
      { key: 'threshold', label: 'Threshold', min: -60, max: 0, default: -18, unit: 'dB' },
      { key: 'ratio', label: 'Ratio', min: 1, max: 20, default: 4, curve: 'log', unit: ':1' },
      { key: 'attack', label: 'Attack', min: 0.0005, max: 0.3, default: 0.01, curve: 'log', unit: 's' },
      { key: 'release', label: 'Release', min: 0.02, max: 1.5, default: 0.2, curve: 'log', unit: 's' },
      { key: 'knee', label: 'Knee', min: 0, max: 30, default: 6, unit: 'dB' },
      { key: 'makeup', label: 'Makeup', min: 0, max: 24, default: 0, unit: 'dB' },
    ],
  },
  distortion: {
    type: 'distortion',
    name: 'Distortion',
    short: 'Dist',
    params: [
      { key: 'drive', label: 'Drive', min: 0, max: 1, default: 0.4, unit: '%' },
      { key: 'tone', label: 'Tone', min: 500, max: 16000, default: 8000, curve: 'log', unit: 'Hz' },
      { key: 'output', label: 'Output', min: -24, max: 6, default: -3, unit: 'dB' },
      { key: 'mix', label: 'Mix', min: 0, max: 1, default: 1, unit: '%' },
    ],
  },
  chorus: {
    type: 'chorus',
    name: 'Chorus',
    short: 'Chorus',
    params: [
      { key: 'rate', label: 'Rate', min: 0.05, max: 8, default: 0.8, curve: 'log', unit: 'Hz' },
      { key: 'depth', label: 'Depth', min: 0, max: 1, default: 0.5, unit: '%' },
      { key: 'delay', label: 'Delay', min: 2, max: 30, default: 12, unit: 'ms' },
      { key: 'mix', label: 'Mix', min: 0, max: 1, default: 0.5, unit: '%' },
    ],
  },
  delay: {
    type: 'delay',
    name: 'Tempo Delay',
    short: 'Delay',
    params: [
      { key: 'time', label: 'Time', min: 0, max: DELAY_DIVISIONS.length - 1, default: 5, options: DELAY_DIVISIONS },
      { key: 'feedback', label: 'Feedback', min: 0, max: 0.95, default: 0.4, unit: '%' },
      { key: 'tone', label: 'Tone', min: 500, max: 16000, default: 5000, curve: 'log', unit: 'Hz' },
      { key: 'pingPong', label: 'Ping-pong', min: 0, max: 1, default: 1, options: ['Off', 'On'] },
      { key: 'mix', label: 'Mix', min: 0, max: 1, default: 0.3, unit: '%' },
    ],
  },
  reverb: {
    type: 'reverb',
    name: 'Reverb',
    short: 'Reverb',
    params: [
      { key: 'decay', label: 'Decay', min: 0.3, max: 10, default: 2.2, curve: 'log', unit: 's' },
      { key: 'predelay', label: 'Pre-delay', min: 0, max: 0.2, default: 0.02, unit: 's' },
      { key: 'damping', label: 'Damping', min: 0, max: 1, default: 0.5, unit: '%' },
      { key: 'lowCut', label: 'Low cut', min: 20, max: 1000, default: 150, curve: 'log', unit: 'Hz' },
      { key: 'mix', label: 'Mix', min: 0, max: 1, default: 0.25, unit: '%' },
    ],
  },
  limiter: {
    type: 'limiter',
    name: 'Limiter',
    short: 'Limit',
    params: [
      { key: 'gain', label: 'Gain', min: 0, max: 18, default: 0, unit: 'dB' },
      { key: 'ceiling', label: 'Ceiling', min: -12, max: 0, default: -0.5, unit: 'dB' },
      { key: 'release', label: 'Release', min: 0.01, max: 1, default: 0.1, curve: 'log', unit: 's' },
    ],
  },
};

export const EFFECT_TYPES = Object.keys(EFFECT_SPECS) as EffectType[];

export function defaultEffectParams(type: EffectType): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of EFFECT_SPECS[type].params) out[p.key] = p.default;
  return out;
}

/** Reads a parameter with a fallback to the spec default (older projects may lack keys). */
export function effectParam(type: EffectType, params: Record<string, number>, key: string): number {
  const v = params[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const spec = EFFECT_SPECS[type].params.find((p) => p.key === key);
  return spec ? spec.default : 0;
}

export function formatParamValue(spec: ParamSpec, value: number): string {
  if (spec.options) return spec.options[Math.round(value)] ?? String(value);
  switch (spec.unit) {
    case 'Hz':
      return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} kHz` : `${Math.round(value)} Hz`;
    case 'dB':
      return `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;
    case 's':
      return value < 1 ? `${Math.round(value * 1000)} ms` : `${value.toFixed(2)} s`;
    case 'ms':
      return `${value.toFixed(1)} ms`;
    case '%':
      return `${Math.round(value * 100)}%`;
    case ':1':
      return `${value.toFixed(1)}:1`;
    default:
      return value.toFixed(2);
  }
}
