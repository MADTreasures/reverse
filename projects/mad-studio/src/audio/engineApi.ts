import type { Id } from '../model/types';
import type { PlayMode } from '../store/store';
import type { AutomationRuntime } from './automationRuntime';
import type { RenderOptions } from './render';
import type { WavBitDepth } from './wav';

/**
 * What the UI needs from an audio engine. Two implementations exist: the Web Audio engine (browser,
 * fallback) and the native engine (desktop app: separate process with VST3/AU hosting).
 */
export interface EngineApi {
  readonly isNative: boolean;
  readonly automation: AutomationRuntime;
  readonly playing: boolean;
  readonly sampleRate: number;
  init(): Promise<void>;
  /** Must be called from a user gesture in browsers (autoplay policy). */
  resume(): Promise<void>;
  play(): Promise<void>;
  stop(): void;
  togglePlay(): void;
  panic(): void;
  /** Moves the song position, or with mode 'pattern' the position inside the current pattern. */
  seek(tick: number, mode?: PlayMode): void;
  /** Position (ticks) currently heard, or null when stopped. */
  playheadTick(): number | null;
  /** Position inside the selected pattern (recording, step highlight). */
  patternTick(): number | null;
  noteOn(channelId: Id, key: number, velocity?: number): number;
  noteOff(handle: number): void;
  previewSample(sampleId: string): void;
  previewPreset(presetId: string): void;
  peaks(trackIndex: number): [number, number];
  masterWaveform(target: Float32Array<ArrayBuffer>): boolean;
  /** Seconds since the channel last triggered a note (Infinity if never). */
  channelActivityAge(channelId: Id): number;
  renderWav(opts: RenderOptions & { bitDepth: WavBitDepth }): Promise<{ wav: Uint8Array; buffer: AudioBuffer }>;
  /** Plugins (native engine only). */
  capturePluginStates(): Promise<void>;
  openPluginEditor(key: string, title: string): void;
  setPluginParam(key: string, index: number, value: number): void;
  requestPluginParams(key: string): void;
  scanPlugins(opts?: { rescanAll?: boolean; paths?: Record<string, string[]> }): void;
  /** Audio device selection (native engine only). */
  getAudioDevices(): void;
  setAudioDevice(opts: { type?: string; output?: string; input?: string; sampleRate?: number; bufferSize?: number }): void;
  /** Opens the audio driver's own settings panel (ASIO). */
  showAudioControlPanel(): void;
}
