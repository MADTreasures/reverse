import { create } from 'zustand';
import type { PluginDescription } from '../model/types';

export interface PluginParam {
  index: number;
  name: string;
  label: string;
  /** Normalized 0..1. */
  value: number;
  text: string;
  steps: number;
  automatable: boolean;
}

export interface PluginInstanceStatus {
  state: 'loading' | 'ready' | 'error';
  message?: string;
  hasEditor?: boolean;
  editorOpen?: boolean;
  latency?: number;
}

export interface ScanProgress {
  format: string;
  name: string;
  index: number;
  total: number;
}

export interface AudioDeviceInfo {
  type: string;
  output: string;
  input: string;
  sampleRate: number;
  bufferSize: number;
  inputChannels: string[];
  outputChannels: string[];
  inputLatency: number;
  outputLatency: number;
  null: boolean;
}

/** What the native engine's plugin delay compensation does (its `latency` event). */
export interface LatencyReport {
  /** Automatic PDC is on (project.pdc). */
  automatic: boolean;
  /** Automation is compensated too (project.pdcAutomation). */
  automations: boolean;
  /** How far the output lags behind the transport (samples). */
  total: number;
  sampleRate: number;
  /** Per mixer track: latency it has detected (inputs + inserts) and its compensation delay (samples). */
  tracks: { latency: number; delay: number }[];
  /** Per plugin instance key: the latency it reports and the manual offset (samples). */
  plugins: Record<string, { reported: number; offset: number }>;
}

interface PluginState {
  /** True when the native engine runs (desktop app); plugins and native recording need it. */
  nativeEngine: boolean;
  engineError: string | null;
  formats: string[];
  plugins: PluginDescription[];
  failed: { format: string; fileOrIdentifier: string; reason: string }[];
  scanning: ScanProgress | null;
  /** Parameters per plugin instance key (`ch:<id>` or `fx:<slotId>`). */
  params: Record<string, PluginParam[]>;
  instances: Record<string, PluginInstanceStatus>;
  device: AudioDeviceInfo | null;
  deviceTypes: { name: string; outputs: string[]; inputs: string[] }[];
  sampleRates: number[];
  bufferSizes: number[];
  /** Default plugin search paths per format (from the engine). */
  paths: Record<string, string[]>;
  /** Extra folders the user added (kept in localStorage). */
  extraPaths: Record<string, string[]>;
  /** Plugin delay compensation of the running engine (null without the native engine). */
  latency: LatencyReport | null;
}

export const usePlugins = create<PluginState>(() => ({
  nativeEngine: false,
  engineError: null,
  formats: [],
  plugins: [],
  failed: [],
  scanning: null,
  params: {},
  instances: {},
  device: null,
  deviceTypes: [],
  sampleRates: [],
  bufferSizes: [],
  paths: {},
  extraPaths: loadExtraPaths(),
  latency: null,
}));

const EXTRA_KEY = 'mad-studio:plugin-paths';

function loadExtraPaths(): Record<string, string[]> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(EXTRA_KEY) : null;
    return raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

export function setExtraPaths(paths: Record<string, string[]>): void {
  usePlugins.setState({ extraPaths: paths });
  try {
    localStorage.setItem(EXTRA_KEY, JSON.stringify(paths));
  } catch {
    // Storage may be unavailable.
  }
}

/** Default + user search paths, as sent with plugins.scan. */
export function scanPaths(): Record<string, string[]> {
  const { paths, extraPaths } = usePlugins.getState();
  const out: Record<string, string[]> = {};
  for (const fmt of new Set([...Object.keys(paths), ...Object.keys(extraPaths)])) out[fmt] = [...new Set([...(paths[fmt] ?? []), ...(extraPaths[fmt] ?? [])])];
  return out;
}

/** Input channel names of the current audio device (two generic inputs without the native engine). */
export function inputChannelNames(): string[] {
  const dev = usePlugins.getState().device;
  return dev && dev.inputChannels.length ? dev.inputChannels : ['In 1', 'In 2'];
}

/** Parses the engine's `latency` event (engine/PROTOCOL.md). */
export function parseLatencyReport(m: Record<string, unknown>): LatencyReport {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const plugins: LatencyReport['plugins'] = {};
  if (m.plugins && typeof m.plugins === 'object') {
    for (const [key, v] of Object.entries(m.plugins as Record<string, Record<string, unknown>>)) plugins[key] = { reported: n(v?.reported), offset: n(v?.offset) };
  }
  return {
    automatic: m.automatic !== false,
    automations: m.automations !== false,
    total: n(m.total),
    sampleRate: n(m.sampleRate) || 48000,
    tracks: Array.isArray(m.tracks) ? (m.tracks as Record<string, unknown>[]).map((t) => ({ latency: n(t?.latency), delay: n(t?.delay) })) : [],
    plugins,
  };
}

export const instanceKeyForChannel = (channelId: string) => `ch:${channelId}`;
export const instanceKeyForSlot = (slotId: string) => `fx:${slotId}`;
