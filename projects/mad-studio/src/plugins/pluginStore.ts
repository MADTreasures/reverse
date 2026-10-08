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

export const instanceKeyForChannel = (channelId: string) => `ch:${channelId}`;
export const instanceKeyForSlot = (slotId: string) => `fx:${slotId}`;
