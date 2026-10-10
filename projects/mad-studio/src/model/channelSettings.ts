/** Channel settings (FL Studio: channel settings › Misc): polyphony, portamento, arpeggiator. */
import { TICKS_PER_STEP } from './timing';
import type { ArpDirection, ArpSettings, Channel, ChannelSettings } from './types';

export const DEFAULT_GLIDE = 0.1;

export const DEFAULT_ARP: ArpSettings = { direction: 'off', range: 1, time: TICKS_PER_STEP, gate: 0.9, repeat: 1, chord: 'none' };

export const DEFAULT_CHANNEL_SETTINGS: ChannelSettings = { polyphony: 0, mono: false, porta: false, glide: DEFAULT_GLIDE, arp: DEFAULT_ARP };

export const ARP_DIRECTIONS: readonly { value: ArpDirection; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'up', label: 'Up' },
  { value: 'down', label: 'Down' },
  { value: 'upDown', label: 'Up and down' },
  { value: 'downUp', label: 'Down and up' },
  { value: 'random', label: 'Random' },
];

/** Arpeggio step lengths (ticks). */
export const ARP_TIMES: readonly { value: number; label: string }[] = [
  { value: TICKS_PER_STEP / 4, label: '1/4 step' },
  { value: TICKS_PER_STEP / 3, label: '1/3 step' },
  { value: TICKS_PER_STEP / 2, label: '1/2 step' },
  { value: (TICKS_PER_STEP * 2) / 3, label: '1/6 beat' },
  { value: TICKS_PER_STEP, label: '1 step' },
  { value: (TICKS_PER_STEP * 4) / 3, label: '1/3 beat' },
  { value: TICKS_PER_STEP * 2, label: '1/2 beat' },
  { value: TICKS_PER_STEP * 4, label: '1 beat' },
];

export const MAX_POLYPHONY = 64;

/** A channel's settings with every value filled in. */
export function channelSettings(channel: Channel | undefined): ChannelSettings {
  const s = channel?.settings;
  if (!s) return DEFAULT_CHANNEL_SETTINGS;
  return { ...DEFAULT_CHANNEL_SETTINGS, ...s, arp: { ...DEFAULT_ARP, ...s.arp } };
}

const num = (v: unknown, def: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def);

/** Reads saved settings (project files); null when everything is at its default. */
export function parseChannelSettings(v: unknown): ChannelSettings | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const a = (typeof o.arp === 'object' && o.arp !== null ? o.arp : {}) as Record<string, unknown>;
  const settings: ChannelSettings = {
    polyphony: Math.round(num(o.polyphony, 0, 0, MAX_POLYPHONY)),
    mono: o.mono === true,
    porta: o.porta === true,
    glide: num(o.glide, DEFAULT_GLIDE, 0, 5),
    arp: {
      direction: ARP_DIRECTIONS.some((d) => d.value === a.direction) ? (a.direction as ArpDirection) : 'off',
      range: Math.round(num(a.range, 1, 1, 4)),
      time: num(a.time, DEFAULT_ARP.time, 1, TICKS_PER_STEP * 16),
      gate: num(a.gate, DEFAULT_ARP.gate, 0.05, 1),
      repeat: Math.round(num(a.repeat, 1, 1, 8)),
      chord: typeof a.chord === 'string' ? a.chord : 'none',
    },
  };
  return isDefault(settings) ? null : settings;
}

export function isDefault(s: ChannelSettings): boolean {
  return JSON.stringify(s) === JSON.stringify(DEFAULT_CHANNEL_SETTINGS);
}
