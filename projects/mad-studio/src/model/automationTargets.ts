/**
 * Automation targets: every automatable control has a string key. The key format is shared with the
 * native engine (see engine/PROTOCOL.md):
 *
 *   ch:<channelId>:volume | pan | synth.<path> | sampler.<path>
 *   mx:<trackIndex>:volume | pan
 *   fx:<slotId>:<paramKey>
 *   proj:bpm | proj:swing
 *   plug:<instanceKey>:<paramIndex>      (instanceKey = ch:<channelId> or fx:<slotId>)
 */
import type { Draft } from 'immer';
import { EFFECT_SPECS, formatParamValue } from './effects';
import { formatDb, formatPan, volumeToGain } from './timing';
import type { Channel, EffectSlot, EffectType, Project } from './types';

export interface TargetRange {
  min: number;
  max: number;
  curve?: 'linear' | 'log';
  integer?: boolean;
}

export interface TargetInfo extends TargetRange {
  key: string;
  /** "Kick - Channel volume" (FL Studio naming: owner - parameter). */
  label: string;
  format: (value: number) => string;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const signedPct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
const seconds = (v: number) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`);
const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz` : `${Math.round(v)} Hz`);

interface ParamDef extends TargetRange {
  label: string;
  format: (v: number) => string;
}

const ENV_DEFS = (prefix: string, name: string): Record<string, ParamDef> => ({
  [`${prefix}.attack`]: { label: `${name} attack`, min: 0.001, max: 5, curve: 'log', format: seconds },
  [`${prefix}.decay`]: { label: `${name} decay`, min: 0.005, max: 8, curve: 'log', format: seconds },
  [`${prefix}.sustain`]: { label: `${name} sustain`, min: 0, max: 1, format: pct },
  [`${prefix}.release`]: { label: `${name} release`, min: 0.005, max: 8, curve: 'log', format: seconds },
});

const OSC_DEFS = (i: number): Record<string, ParamDef> => ({
  [`osc.${i}.level`]: { label: `Osc ${i + 1} level`, min: 0, max: 1, format: pct },
  [`osc.${i}.coarse`]: { label: `Osc ${i + 1} coarse`, min: -36, max: 36, integer: true, format: (v) => `${v > 0 ? '+' : ''}${Math.round(v)} st` },
  [`osc.${i}.fine`]: { label: `Osc ${i + 1} fine`, min: -100, max: 100, format: (v) => `${Math.round(v)} ct` },
  [`osc.${i}.unison`]: { label: `Osc ${i + 1} unison`, min: 1, max: 7, integer: true, format: (v) => `${Math.round(v)}×` },
  [`osc.${i}.detune`]: { label: `Osc ${i + 1} detune`, min: 0, max: 100, format: (v) => `${Math.round(v)} ct` },
  [`osc.${i}.pan`]: { label: `Osc ${i + 1} pan`, min: -1, max: 1, format: signedPct },
});

export const SYNTH_PARAMS: Record<string, ParamDef> = {
  gain: { label: 'Synth gain', min: 0, max: 1, format: pct },
  'filter.cutoff': { label: 'Filter cutoff', min: 20, max: 20000, curve: 'log', format: hz },
  'filter.resonance': { label: 'Filter resonance', min: 0.1, max: 20, curve: 'log', format: (v) => v.toFixed(1) },
  'filter.envAmount': { label: 'Filter env amount', min: -1, max: 1, format: signedPct },
  'filter.keyTrack': { label: 'Filter key tracking', min: 0, max: 1, format: pct },
  'lfo.rate': { label: 'LFO rate', min: 0.05, max: 20, curve: 'log', format: (v) => `${v.toFixed(2)} Hz` },
  'lfo.depth': { label: 'LFO depth', min: 0, max: 1, format: pct },
  ...OSC_DEFS(0),
  ...OSC_DEFS(1),
  ...OSC_DEFS(2),
  ...ENV_DEFS('ampEnv', 'Volume'),
  ...ENV_DEFS('filterEnv', 'Filter env'),
};

export const SAMPLER_PARAMS: Record<string, ParamDef> = {
  gain: { label: 'Sampler gain', min: 0, max: 1, format: pct },
  fine: { label: 'Fine pitch', min: -100, max: 100, format: (v) => `${Math.round(v)} ct` },
  start: { label: 'Sample start', min: 0, max: 0.99, format: pct },
  ...ENV_DEFS('ampEnv', 'Volume'),
};

const BPM_RANGE: TargetRange = { min: 60, max: 200 };

/** Plugin parameter names reported by the engine, keyed `plug:<instanceKey>:<index>`. */
const pluginParamNames = new Map<string, string>();
export function registerPluginParamName(key: string, name: string): void {
  pluginParamNames.set(key, name);
}

// ---------------------------------------------------------------------------
// Key helpers

export const channelTarget = (channelId: string, param: string) => `ch:${channelId}:${param}`;
export const mixerTarget = (index: number, param: 'volume' | 'pan') => `mx:${index}:${param}`;
export const effectTarget = (slotId: string, param: string) => `fx:${slotId}:${param}`;
export const pluginTarget = (instanceKey: string, index: number) => `plug:${instanceKey}:${index}`;

interface ParsedKey {
  scope: 'ch' | 'mx' | 'fx' | 'proj' | 'plug';
  owner: string;
  param: string;
}

export function parseTargetKey(key: string): ParsedKey | null {
  if (key.startsWith('plug:')) {
    // plug:<ch|fx>:<id>:<index>
    const m = /^plug:((?:ch|fx):[^:]+):(\d+)$/.exec(key);
    return m ? { scope: 'plug', owner: m[1], param: m[2] } : null;
  }
  const m = /^(ch|mx|fx|proj):([^:]*):?(.*)$/.exec(key);
  if (!m) return null;
  if (m[1] === 'proj') return { scope: 'proj', owner: '', param: m[2] };
  return { scope: m[1] as ParsedKey['scope'], owner: m[2], param: m[3] };
}

function findSlot(project: Project, slotId: string): { slot: EffectSlot; trackIndex: number } | null {
  for (let i = 0; i < project.mixer.length; i++) {
    const slot = project.mixer[i].effects.find((e) => e.id === slotId);
    if (slot) return { slot, trackIndex: i };
  }
  return null;
}

function getPath(obj: unknown, path: string): number | undefined {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'number' ? cur : undefined;
}

function setPath(obj: unknown, path: string, value: number): void {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur === null || typeof cur !== 'object') return;
    cur = (cur as Record<string, unknown>)[parts[i]];
  }
  if (cur !== null && typeof cur === 'object') {
    const last = parts[parts.length - 1];
    if (typeof (cur as Record<string, unknown>)[last] === 'number') (cur as Record<string, unknown>)[last] = value;
  }
}

function channelParamDef(ch: Channel, param: string): ParamDef | null {
  if (param === 'volume') return { label: 'Channel volume', min: 0, max: 1, format: (v) => `${pct(v)} (${formatDb(volumeToGain(v))})` };
  if (param === 'pan') return { label: 'Channel panning', min: -1, max: 1, format: formatPan };
  if (param.startsWith('synth.') && ch.kind === 'synth') return SYNTH_PARAMS[param.slice(6)] ?? null;
  if (param.startsWith('sampler.') && ch.kind === 'sampler') return SAMPLER_PARAMS[param.slice(8)] ?? null;
  return null;
}

/** Describes a target, or returns null when it no longer exists in the project. */
export function describeTarget(project: Project, key: string): TargetInfo | null {
  const p = parseTargetKey(key);
  if (!p) return null;
  switch (p.scope) {
    case 'ch': {
      const ch = project.channels.find((c) => c.id === p.owner);
      const def = ch ? channelParamDef(ch, p.param) : null;
      return ch && def ? { key, ...def, label: `${ch.name} - ${def.label}` } : null;
    }
    case 'mx': {
      const index = Number(p.owner);
      const track = project.mixer[index];
      if (!track) return null;
      if (p.param === 'volume') return { key, label: `${track.name} - Volume`, min: 0, max: 1, format: (v) => formatDb(volumeToGain(v)) };
      if (p.param === 'pan') return { key, label: `${track.name} - Panning`, min: -1, max: 1, format: formatPan };
      return null;
    }
    case 'fx': {
      const found = findSlot(project, p.owner);
      if (!found || found.slot.type === 'plugin') return null;
      const spec = EFFECT_SPECS[found.slot.type as EffectType].params.find((s) => s.key === p.param);
      if (!spec) return null;
      const track = project.mixer[found.trackIndex];
      return {
        key,
        label: `${track.name} - ${EFFECT_SPECS[found.slot.type as EffectType].name} - ${spec.label}`,
        min: spec.min,
        max: spec.max,
        curve: spec.curve,
        integer: !!spec.options,
        format: (v) => formatParamValue(spec, v),
      };
    }
    case 'proj':
      if (p.param === 'bpm') return { key, label: 'Main tempo', ...BPM_RANGE, format: (v) => `${v.toFixed(2)} BPM` };
      if (p.param === 'swing') return { key, label: 'Main swing', min: 0, max: 1, format: pct };
      return null;
    case 'plug': {
      const owner = pluginOwnerName(project, p.owner);
      if (!owner) return null;
      const name = pluginParamNames.get(key) ?? `Param ${Number(p.param) + 1}`;
      return { key, label: `${owner} - ${name}`, min: 0, max: 1, format: pct };
    }
  }
}

function pluginOwnerName(project: Project, instanceKey: string): string | null {
  if (instanceKey.startsWith('ch:')) {
    const ch = project.channels.find((c) => c.id === instanceKey.slice(3));
    return ch && ch.kind === 'plugin' ? ch.name : null;
  }
  const found = findSlot(project, instanceKey.slice(3));
  return found?.slot.plugin ? `${project.mixer[found.trackIndex].name} - ${found.slot.plugin.name}` : null;
}

/** Current (un-automated) value of a target in its own units, or null when it does not exist. */
export function targetValue(project: Project, key: string): number | null {
  const p = parseTargetKey(key);
  if (!p) return null;
  switch (p.scope) {
    case 'ch': {
      const ch = project.channels.find((c) => c.id === p.owner);
      if (!ch) return null;
      if (p.param === 'volume') return ch.volume;
      if (p.param === 'pan') return ch.pan;
      if (p.param.startsWith('synth.') && ch.kind === 'synth') return getPath(ch.synth, p.param.slice(6)) ?? null;
      if (p.param.startsWith('sampler.') && ch.kind === 'sampler') return getPath(ch.sampler, p.param.slice(8)) ?? null;
      return null;
    }
    case 'mx': {
      const t = project.mixer[Number(p.owner)];
      if (!t) return null;
      return p.param === 'volume' ? t.volume : p.param === 'pan' ? t.pan : null;
    }
    case 'fx': {
      const found = findSlot(project, p.owner);
      if (!found || found.slot.type === 'plugin') return null;
      const v = found.slot.params[p.param];
      if (typeof v === 'number') return v;
      return EFFECT_SPECS[found.slot.type as EffectType].params.find((s) => s.key === p.param)?.default ?? null;
    }
    case 'proj':
      return p.param === 'bpm' ? project.bpm : p.param === 'swing' ? project.swing : null;
    case 'plug':
      return null;
  }
}

/** Writes a target value (own units) into a project draft. Plugin targets are handled by the engine. */
export function applyTargetValue(d: Draft<Project>, key: string, value: number): void {
  const p = parseTargetKey(key);
  if (!p || !Number.isFinite(value)) return;
  switch (p.scope) {
    case 'ch': {
      const ch = d.channels.find((c) => c.id === p.owner);
      if (!ch) return;
      if (p.param === 'volume') ch.volume = value;
      else if (p.param === 'pan') ch.pan = value;
      else if (p.param.startsWith('synth.') && ch.kind === 'synth') setPath(ch.synth, p.param.slice(6), value);
      else if (p.param.startsWith('sampler.') && ch.kind === 'sampler') setPath(ch.sampler, p.param.slice(8), value);
      return;
    }
    case 'mx': {
      const t = d.mixer[Number(p.owner)];
      if (!t) return;
      if (p.param === 'volume') t.volume = value;
      else if (p.param === 'pan') t.pan = value;
      return;
    }
    case 'fx': {
      for (const t of d.mixer) {
        const slot = t.effects.find((e) => e.id === p.owner);
        if (slot && slot.type !== 'plugin') slot.params[p.param] = value;
      }
      return;
    }
    case 'proj':
      if (p.param === 'bpm') d.bpm = value;
      else if (p.param === 'swing') d.swing = value;
      return;
    case 'plug':
      return;
  }
}

/** Normalized 0..1 automation value → target units. */
export function fromNorm(range: TargetRange, n: number): number {
  const c = Math.min(1, Math.max(0, n));
  let v = range.curve === 'log' && range.min > 0 ? range.min * Math.pow(range.max / range.min, c) : range.min + c * (range.max - range.min);
  if (range.integer) v = Math.round(v);
  return v;
}

/** Target units → normalized 0..1 automation value. */
export function toNorm(range: TargetRange, v: number): number {
  const n = range.curve === 'log' && range.min > 0 ? Math.log(Math.max(range.min, v) / range.min) / Math.log(range.max / range.min) : (v - range.min) / (range.max - range.min);
  return Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
}

/** True for targets that belong to (or are owned by) the given channel / slot – used for cleanup. */
export function targetBelongsTo(key: string, ids: { channelId?: string; slotId?: string }): boolean {
  const p = parseTargetKey(key);
  if (!p) return false;
  if (ids.channelId && ((p.scope === 'ch' && p.owner === ids.channelId) || (p.scope === 'plug' && p.owner === `ch:${ids.channelId}`))) return true;
  if (ids.slotId && ((p.scope === 'fx' && p.owner === ids.slotId) || (p.scope === 'plug' && p.owner === `fx:${ids.slotId}`))) return true;
  return false;
}
