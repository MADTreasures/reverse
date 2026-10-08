/**
 * The app's audio engine. The desktop app uses the native engine (separate process, VST3/AU hosting,
 * device I/O) when it is bundled; the browser – and the desktop app if the native engine fails to
 * start – uses the Web Audio engine. Both implement EngineApi.
 */
import { native } from '../platform/platform';
import { toast } from '../ui/overlays';
import type { EngineApi } from './engineApi';
import { NativeEngine } from './nativeEngine';
import type { RenderOptions } from './render';
import type { WavBitDepth } from './wav';
import { WebAudioEngine } from './webEngine';

class EngineFacade implements EngineApi {
  private impl: EngineApi;

  constructor() {
    const bridge = native?.engine;
    this.impl = bridge?.available ? new NativeEngine(bridge, (reason) => this.fallBack(reason)) : new WebAudioEngine();
  }

  /** Switches to the browser engine when the native one cannot run. */
  private fallBack(reason: string): void {
    if (!this.impl.isNative) return;
    this.impl = new WebAudioEngine();
    void this.impl.init();
    toast(`${reason} Using the browser audio engine instead (no VST/AU plugins).`, 'error');
  }

  get isNative() {
    return this.impl.isNative;
  }
  get automation() {
    return this.impl.automation;
  }
  get playing() {
    return this.impl.playing;
  }
  get sampleRate() {
    return this.impl.sampleRate;
  }
  init() {
    return this.impl.init();
  }
  resume() {
    return this.impl.resume();
  }
  play() {
    return this.impl.play();
  }
  stop() {
    this.impl.stop();
  }
  togglePlay() {
    this.impl.togglePlay();
  }
  panic() {
    this.impl.panic();
  }
  seek(tick: number) {
    this.impl.seek(tick);
  }
  playheadTick() {
    return this.impl.playheadTick();
  }
  patternTick() {
    return this.impl.patternTick();
  }
  noteOn(channelId: string, key: number, velocity?: number) {
    return this.impl.noteOn(channelId, key, velocity);
  }
  noteOff(handle: number) {
    this.impl.noteOff(handle);
  }
  previewSample(sampleId: string) {
    this.impl.previewSample(sampleId);
  }
  previewPreset(presetId: string) {
    this.impl.previewPreset(presetId);
  }
  peaks(trackIndex: number) {
    return this.impl.peaks(trackIndex);
  }
  masterWaveform(target: Float32Array<ArrayBuffer>) {
    return this.impl.masterWaveform(target);
  }
  channelActivityAge(channelId: string) {
    return this.impl.channelActivityAge(channelId);
  }
  renderWav(opts: RenderOptions & { bitDepth: WavBitDepth }) {
    return this.impl.renderWav(opts);
  }
  capturePluginStates() {
    return this.impl.capturePluginStates();
  }
  openPluginEditor(key: string, title: string) {
    this.impl.openPluginEditor(key, title);
  }
  setPluginParam(key: string, index: number, value: number) {
    this.impl.setPluginParam(key, index, value);
  }
  requestPluginParams(key: string) {
    this.impl.requestPluginParams(key);
  }
  scanPlugins(opts?: { rescanAll?: boolean; paths?: Record<string, string[]> }) {
    this.impl.scanPlugins(opts);
  }
  getAudioDevices() {
    this.impl.getAudioDevices();
  }
  setAudioDevice(opts: { type?: string; output?: string; input?: string; sampleRate?: number; bufferSize?: number }) {
    this.impl.setAudioDevice(opts);
  }
}

export const engine = new EngineFacade();
