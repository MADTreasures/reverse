import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { paletteColor } from './colors';
import {
  DEFAULT_BEATS_PER_BAR,
  DEFAULT_BPM,
  createMixerTrack,
  createPattern,
  createTracks,
  defaultSamplerParams,
} from './defaults';
import { EFFECT_SPECS, defaultEffectParams } from './effects';
import { makeId } from './ids';
import { defaultSynthParams } from './presets';
import { MAX_BPM, MIN_BPM, ticksPerBar } from './timing';
import { CURVE_MODES } from './automation';
import type {
  AutomationData,
  AutomationPoint,
  Channel,
  Clip,
  CurveMode,
  EffectSlot,
  EffectType,
  Envelope,
  MixerTrack,
  Note,
  OscParams,
  Pattern,
  PlaylistTrack,
  PluginInstanceData,
  Project,
  SampleInfo,
  SamplerParams,
  SynthParams,
  TrackInput,
  WaveType,
} from './types';

export const PROJECT_EXTENSION = 'madstudio';

export interface SampleFile {
  id: string;
  fileName: string;
  bytes: Uint8Array;
}

/** Project bundle: a ZIP with project.json and samples/<id>/<file>. */
export function packProject(project: Project, samples: SampleFile[]): Uint8Array {
  const files: Zippable = {
    'project.json': [strToU8(JSON.stringify(project)), { level: 6 }],
  };
  for (const s of samples) {
    if (!project.samples[s.id]) continue;
    // Audio is already compressed or barely compressible.
    files[`samples/${s.id}/${safeFileName(s.fileName)}`] = [s.bytes, { level: 0 }];
  }
  return zipSync(files);
}

export function unpackProject(bytes: Uint8Array): { project: Project; samples: SampleFile[] } {
  // Plain JSON is accepted too.
  if (bytes[0] === 0x7b) return { project: parseProject(JSON.parse(strFromU8(bytes))), samples: [] };
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('This file is not a MAD Studio project.');
  }
  const json = files['project.json'];
  if (!json) throw new Error('project.json is missing – not a MAD Studio project.');
  const project = parseProject(JSON.parse(strFromU8(json)));
  const samples: SampleFile[] = [];
  for (const [path, data] of Object.entries(files)) {
    const m = /^samples\/([^/]+)\/(.+)$/.exec(path);
    if (m && project.samples[m[1]]) samples.push({ id: m[1], fileName: m[2], bytes: data });
  }
  return { project, samples };
}

export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return cleaned.slice(-120) || 'sample.wav';
}

// ---------------------------------------------------------------------------
// Defensive parsing: accepts older/partial files and drops anything invalid.

type Raw = Record<string, unknown>;

const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, fallback: string): string => (typeof v === 'string' && v.length > 0 ? v : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
function num(v: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
}
function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return options.includes(v as T) ? (v as T) : fallback;
}

const WAVES: WaveType[] = ['sine', 'triangle', 'sawtooth', 'square', 'noise'];

function parseEnvelope(v: unknown, d: Envelope): Envelope {
  const o = isObj(v) ? v : {};
  return {
    attack: num(o.attack, d.attack, 0, 20),
    decay: num(o.decay, d.decay, 0, 20),
    sustain: num(o.sustain, d.sustain, 0, 1),
    release: num(o.release, d.release, 0, 20),
  };
}

function parseOsc(v: unknown, d: OscParams): OscParams {
  const o = isObj(v) ? v : {};
  return {
    wave: oneOf(o.wave, WAVES, d.wave),
    level: num(o.level, d.level, 0, 1),
    coarse: Math.round(num(o.coarse, d.coarse, -36, 36)),
    fine: num(o.fine, d.fine, -100, 100),
    unison: Math.round(num(o.unison, d.unison, 1, 7)),
    detune: num(o.detune, d.detune, 0, 100),
    pan: num(o.pan, d.pan, -1, 1),
  };
}

function parseSynth(v: unknown): SynthParams {
  const d = defaultSynthParams();
  const o = isObj(v) ? v : {};
  const osc = arr(o.osc);
  const f = isObj(o.filter) ? o.filter : {};
  const lfo = isObj(o.lfo) ? o.lfo : {};
  return {
    osc: [parseOsc(osc[0], d.osc[0]), parseOsc(osc[1], d.osc[1]), parseOsc(osc[2], d.osc[2])],
    filter: {
      enabled: bool(f.enabled, d.filter.enabled),
      type: oneOf(f.type, ['lowpass', 'highpass', 'bandpass', 'notch'] as const, d.filter.type),
      cutoff: num(f.cutoff, d.filter.cutoff, 20, 20000),
      resonance: num(f.resonance, d.filter.resonance, 0.1, 30),
      envAmount: num(f.envAmount, d.filter.envAmount, -1, 1),
      keyTrack: num(f.keyTrack, d.filter.keyTrack, 0, 1),
    },
    ampEnv: parseEnvelope(o.ampEnv, d.ampEnv),
    filterEnv: parseEnvelope(o.filterEnv, d.filterEnv),
    lfo: {
      target: oneOf(lfo.target, ['off', 'pitch', 'filter', 'amp'] as const, d.lfo.target),
      rate: num(lfo.rate, d.lfo.rate, 0.01, 40),
      depth: num(lfo.depth, d.lfo.depth, 0, 1),
    },
    gain: num(o.gain, d.gain, 0, 1),
  };
}

function parseSampler(v: unknown, samples: Record<string, SampleInfo>): SamplerParams {
  const d = defaultSamplerParams(null);
  const o = isObj(v) ? v : {};
  const sampleId = typeof o.sampleId === 'string' && samples[o.sampleId] ? o.sampleId : null;
  return {
    sampleId,
    rootKey: Math.round(num(o.rootKey, d.rootKey, 0, 127)),
    fine: num(o.fine, d.fine, -1200, 1200),
    keyTrack: bool(o.keyTrack, d.keyTrack),
    reverse: bool(o.reverse, d.reverse),
    oneShot: bool(o.oneShot, d.oneShot),
    loop: bool(o.loop, d.loop),
    start: num(o.start, d.start, 0, 0.999),
    ampEnv: parseEnvelope(o.ampEnv, d.ampEnv),
    chokeGroup: Math.round(num(o.chokeGroup, d.chokeGroup, 0, 16)),
    cutSelf: bool(o.cutSelf, d.cutSelf),
    gain: num(o.gain, d.gain, 0, 1),
  };
}

function parsePluginData(v: unknown): PluginInstanceData | null {
  if (!isObj(v) || typeof v.uid !== 'string' || typeof v.fileOrIdentifier !== 'string') return null;
  return {
    uid: v.uid,
    name: str(v.name, 'Plugin'),
    vendor: typeof v.vendor === 'string' ? v.vendor : '',
    format: str(v.format, 'VST3'),
    fileOrIdentifier: v.fileOrIdentifier,
    isInstrument: bool(v.isInstrument, false),
    state: typeof v.state === 'string' && v.state.length > 0 ? v.state : null,
  };
}

const CURVE_IDS = CURVE_MODES.map((m) => m.id);

function parseAutomation(v: unknown): AutomationData {
  const o = isObj(v) ? v : {};
  const points: AutomationPoint[] = arr(o.points)
    .filter(isObj)
    .map((pt) => ({
      tick: Math.max(0, Math.round(num(pt.tick, 0))),
      value: num(pt.value, 0, 0, 1),
      tension: num(pt.tension, 0, -1, 1),
      mode: oneOf(pt.mode, CURVE_IDS as readonly CurveMode[], 'single'),
    }))
    .sort((a, b) => a.tick - b.tick);
  if (points.length === 0) points.push({ tick: 0, value: 0.5, tension: 0, mode: 'single' });
  points[0].tick = 0;
  const last = points[points.length - 1].tick;
  return {
    target: typeof o.target === 'string' && o.target.length > 0 ? o.target : null,
    points,
    length: Math.max(1, last, Math.round(num(o.length, last, 1))),
  };
}

function parseChannel(v: unknown, i: number, mixerCount: number, samples: Record<string, SampleInfo>): Channel | null {
  if (!isObj(v)) return null;
  const base = {
    id: str(v.id, makeId('ch')),
    name: str(v.name, `Channel ${i + 1}`),
    color: str(v.color, paletteColor(i)),
    volume: num(v.volume, 0.8, 0, 1),
    pan: num(v.pan, 0, -1, 1),
    muted: bool(v.muted, false),
    mixerTrack: Math.round(num(v.mixerTrack, 0, 0, mixerCount - 1)),
  };
  if (v.kind === 'synth') return { ...base, kind: 'synth', synth: parseSynth(v.synth) };
  if (v.kind === 'sampler') {
    const ch: Channel = { ...base, kind: 'sampler', sampler: parseSampler(v.sampler, samples) };
    if (v.audioClip === true) ch.audioClip = true;
    return ch;
  }
  if (v.kind === 'plugin') {
    const plugin = parsePluginData(v.plugin);
    return plugin ? { ...base, kind: 'plugin', plugin } : null;
  }
  if (v.kind === 'automation') return { ...base, mixerTrack: 0, kind: 'automation', automation: parseAutomation(v.automation) };
  return null;
}

function parseNote(v: unknown): Note | null {
  if (!isObj(v)) return null;
  const start = num(v.start, -1);
  const length = num(v.length, 0);
  if (start < 0 || length <= 0) return null;
  return {
    id: str(v.id, makeId('n')),
    key: Math.round(num(v.key, 60, 0, 127)),
    start: Math.round(start),
    length: Math.max(1, Math.round(length)),
    velocity: num(v.velocity, 0.78, 0, 1),
  };
}

function parsePattern(v: unknown, i: number, channelIds: Set<string>, beatsPerBar: number): Pattern | null {
  if (!isObj(v)) return null;
  const notes: Record<string, Note[]> = {};
  if (isObj(v.notes)) {
    for (const [chId, list] of Object.entries(v.notes)) {
      if (!channelIds.has(chId)) continue;
      const parsed = arr(list).map(parseNote).filter((n): n is Note => n !== null);
      if (parsed.length) notes[chId] = parsed.sort((a, b) => a.start - b.start || a.key - b.key);
    }
  }
  const bar = ticksPerBar(beatsPerBar);
  return {
    id: str(v.id, makeId('pat')),
    name: str(v.name, `Pattern ${i + 1}`),
    color: str(v.color, paletteColor(i + 5)),
    notes,
    minLength: Math.max(bar, Math.ceil(num(v.minLength, bar, bar, bar * 1024) / bar) * bar),
  };
}

function parseEffect(v: unknown): EffectSlot | null {
  if (isObj(v) && v.type === 'plugin') {
    const plugin = parsePluginData(v.plugin);
    return plugin ? { id: str(v.id, makeId('fx')), type: 'plugin', enabled: bool(v.enabled, true), params: {}, plugin } : null;
  }
  if (!isObj(v) || typeof v.type !== 'string' || !(v.type in EFFECT_SPECS)) return null;
  const type = v.type as EffectType;
  const params = defaultEffectParams(type);
  if (isObj(v.params)) {
    for (const spec of EFFECT_SPECS[type].params) params[spec.key] = num(v.params[spec.key], spec.default, spec.min, spec.max);
  }
  return { id: str(v.id, makeId('fx')), type, enabled: bool(v.enabled, true), params };
}

function parseMixerTrack(v: unknown, i: number): MixerTrack {
  const d = createMixerTrack(i);
  if (!isObj(v)) return d;
  return {
    id: str(v.id, d.id),
    name: str(v.name, d.name),
    color: str(v.color, d.color),
    volume: num(v.volume, d.volume, 0, 1),
    pan: num(v.pan, 0, -1, 1),
    muted: bool(v.muted, false),
    solo: i > 0 && bool(v.solo, false),
    effects: arr(v.effects).map(parseEffect).filter((e): e is EffectSlot => e !== null).slice(0, 10),
    input: parseTrackInput(v.input),
    armed: i > 0 && bool(v.armed, false),
  };
}

export function parseTrackInput(v: unknown): TrackInput | null {
  if (typeof v !== 'string') return null;
  const m = /^(stereo|mono):(\d{1,2})$/.exec(v);
  return m ? (`${m[1]}:${Number(m[2])}` as TrackInput) : null;
}

function parseSamples(v: unknown): Record<string, SampleInfo> {
  const out: Record<string, SampleInfo> = {};
  if (!isObj(v)) return out;
  for (const [id, info] of Object.entries(v)) {
    if (!isObj(info)) continue;
    const source = info.source === 'factory' ? 'factory' : 'user';
    out[id] = {
      id,
      name: str(info.name, id),
      source,
      ...(info.recorded === true ? { recorded: true } : {}),
      ...(typeof info.factoryKey === 'string' ? { factoryKey: info.factoryKey } : {}),
      ...(typeof info.fileName === 'string' ? { fileName: info.fileName } : {}),
    };
  }
  return out;
}

/** Validates arbitrary JSON into a well-formed Project. */
export function parseProject(raw: unknown): Project {
  if (!isObj(raw)) throw new Error('Invalid project file.');
  if (raw.format !== undefined && raw.format !== 'mad-studio') throw new Error('Unknown project format.');
  const beatsPerBar = Math.round(num(raw.beatsPerBar, DEFAULT_BEATS_PER_BAR, 1, 16));
  const samples = parseSamples(raw.samples);

  const mixerRaw = arr(raw.mixer).slice(0, 65);
  const mixer = (mixerRaw.length ? mixerRaw : [null]).map((m, i) => parseMixerTrack(m, i));

  const channels = arr(raw.channels)
    .map((c, i) => parseChannel(c, i, mixer.length, samples))
    .filter((c): c is Channel => c !== null);
  const channelIds = new Set(channels.map((c) => c.id));
  const automationIds = new Set(channels.filter((c) => c.kind === 'automation').map((c) => c.id));

  let patterns = arr(raw.patterns)
    .map((p, i) => parsePattern(p, i, channelIds, beatsPerBar))
    .filter((p): p is Pattern => p !== null);
  if (patterns.length === 0) patterns = [createPattern('Pattern 1', paletteColor(5), beatsPerBar)];
  const patternIds = new Set(patterns.map((p) => p.id));

  let tracks: PlaylistTrack[] = arr(raw.tracks)
    .filter(isObj)
    .map((t, i) => ({ id: str(t.id, makeId('trk')), name: str(t.name, `Track ${i + 1}`), muted: bool(t.muted, false) }));
  if (tracks.length === 0) tracks = createTracks();
  const trackIds = new Set(tracks.map((t) => t.id));

  const clips: Clip[] = [];
  for (const c of arr(raw.clips)) {
    if (!isObj(c) || typeof c.trackId !== 'string' || !trackIds.has(c.trackId)) continue;
    const base = {
      id: str(c.id, makeId('clip')),
      trackId: c.trackId,
      start: Math.round(num(c.start, 0, 0)),
      length: Math.max(1, Math.round(num(c.length, ticksPerBar(beatsPerBar), 1))),
      offset: Math.round(num(c.offset, 0, 0)),
      ...(bool(c.muted, false) ? { muted: true } : {}),
    };
    if (c.kind === 'pattern' && typeof c.patternId === 'string' && patternIds.has(c.patternId)) {
      clips.push({ ...base, kind: 'pattern', patternId: c.patternId });
    } else if (c.kind === 'audio' && typeof c.channelId === 'string' && channelIds.has(c.channelId)) {
      clips.push({ ...base, kind: 'audio', channelId: c.channelId });
    } else if (c.kind === 'automation' && typeof c.channelId === 'string' && automationIds.has(c.channelId)) {
      clips.push({ ...base, kind: 'automation', channelId: c.channelId });
    }
  }

  return {
    format: 'mad-studio',
    version: 2,
    name: str(raw.name, 'Untitled'),
    bpm: num(raw.bpm, DEFAULT_BPM, MIN_BPM, MAX_BPM),
    beatsPerBar,
    swing: num(raw.swing, 0, 0, 1),
    channels,
    patterns,
    tracks,
    clips,
    mixer,
    samples,
  };
}
