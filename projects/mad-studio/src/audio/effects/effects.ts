import { DELAY_DIVISION_BEATS, effectParam } from '../../model/effects';
import type { SlotType } from '../../model/types';
import { workletsReady } from '../worklets';

export interface EffectEnv {
  bpm: number;
}

/** A mixer insert effect: audio flows input → … → output. */
export interface EffectNode {
  readonly type: SlotType;
  readonly input: AudioNode;
  readonly output: AudioNode;
  setParams(params: Record<string, number>, env: EffectEnv): void;
  /** The track's sidechain bus while a sidechain link feeds it, else null (effects with a sidechain input). */
  setSidechain?(source: AudioNode | null): void;
  dispose(): void;
}

const dbToGain = (db: number) => Math.pow(10, db / 20);

function smooth(param: AudioParam, value: number, ctx: BaseAudioContext): void {
  if (!Number.isFinite(value)) return;
  param.setTargetAtTime(value, ctx.currentTime, 0.015);
}

/** Removes the connection `from` → `to` if it still exists (disconnect() throws otherwise). */
function detach(from: AudioNode | null, to: AudioNode): void {
  try {
    from?.disconnect(to);
  } catch {
    // already disconnected
  }
}

/** Dry/wet helper: input feeds both paths, output sums them. */
class DryWet {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly dry: GainNode;
  readonly wet: GainNode;
  constructor(private readonly ctx: BaseAudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.input.connect(this.dry);
    this.dry.connect(this.output);
    this.wet.connect(this.output);
  }
  setMix(mix: number): void {
    const m = Math.max(0, Math.min(1, mix));
    // Equal-power crossfade.
    smooth(this.dry.gain, Math.cos((m * Math.PI) / 2), this.ctx);
    smooth(this.wet.gain, Math.sin((m * Math.PI) / 2), this.ctx);
  }
  dispose(): void {
    this.input.disconnect();
    this.dry.disconnect();
    this.wet.disconnect();
    this.output.disconnect();
  }
}

class EqEffect implements EffectNode {
  readonly type = 'eq' as const;
  private readonly low: BiquadFilterNode;
  private readonly mid: BiquadFilterNode;
  private readonly high: BiquadFilterNode;
  constructor(private readonly ctx: BaseAudioContext) {
    this.low = ctx.createBiquadFilter();
    this.low.type = 'lowshelf';
    this.mid = ctx.createBiquadFilter();
    this.mid.type = 'peaking';
    this.high = ctx.createBiquadFilter();
    this.high.type = 'highshelf';
    this.low.connect(this.mid);
    this.mid.connect(this.high);
  }
  get input() {
    return this.low;
  }
  get output() {
    return this.high;
  }
  setParams(p: Record<string, number>): void {
    const v = (k: string) => effectParam('eq', p, k);
    smooth(this.low.gain, v('lowGain'), this.ctx);
    smooth(this.low.frequency, v('lowFreq'), this.ctx);
    smooth(this.mid.gain, v('midGain'), this.ctx);
    smooth(this.mid.frequency, v('midFreq'), this.ctx);
    smooth(this.mid.Q, v('midQ'), this.ctx);
    smooth(this.high.gain, v('highGain'), this.ctx);
    smooth(this.high.frequency, v('highFreq'), this.ctx);
  }
  dispose(): void {
    this.low.disconnect();
    this.mid.disconnect();
    this.high.disconnect();
  }
}

const FILTER_MODES: BiquadFilterType[] = ['lowpass', 'highpass', 'bandpass', 'notch'];

class FilterEffect implements EffectNode {
  readonly type = 'filter' as const;
  readonly input: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly lfo: OscillatorNode;
  private readonly lfoGain: GainNode;
  constructor(private readonly ctx: BaseAudioContext) {
    this.input = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.input.connect(this.filter);
    this.lfo = ctx.createOscillator();
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = 0;
    this.lfo.connect(this.lfoGain);
    this.lfoGain.connect(this.filter.detune);
    this.lfo.start();
  }
  get output() {
    return this.filter;
  }
  setParams(p: Record<string, number>): void {
    const v = (k: string) => effectParam('filter', p, k);
    this.filter.type = FILTER_MODES[Math.round(v('mode'))] ?? 'lowpass';
    smooth(this.filter.frequency, v('cutoff'), this.ctx);
    smooth(this.filter.Q, v('resonance'), this.ctx);
    smooth(this.lfo.frequency, v('lfoRate'), this.ctx);
    smooth(this.lfoGain.gain, v('lfoDepth') * 2400, this.ctx);
  }
  dispose(): void {
    this.lfo.stop();
    this.lfo.disconnect();
    this.lfoGain.disconnect();
    this.input.disconnect();
    this.filter.disconnect();
  }
}

/**
 * The browser's DynamicsCompressorNode, or, while its Sidechain switch is on and a sidechain link feeds
 * the track, the same algorithm as an AudioWorklet whose detector listens to the sidechain bus
 * (worklets/compressor-worklet.js, a port of the native engine's compressor).
 */
class CompressorEffect implements EffectNode {
  readonly type = 'compressor' as const;
  readonly input: GainNode;
  private readonly comp: DynamicsCompressorNode;
  private readonly makeup: GainNode;
  private keyed: AudioWorkletNode | null = null;
  private keyedSource: AudioNode | null = null;
  private source: AudioNode | null = null;
  private sidechainOn = false;
  private params: Record<string, number> = {};
  constructor(private readonly ctx: BaseAudioContext) {
    this.input = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.makeup = ctx.createGain();
    this.input.connect(this.comp);
    this.comp.connect(this.makeup);
  }
  get output() {
    return this.makeup;
  }
  setParams(p: Record<string, number>): void {
    this.params = p;
    const v = (k: string) => effectParam('compressor', p, k);
    smooth(this.comp.threshold, v('threshold'), this.ctx);
    smooth(this.comp.ratio, v('ratio'), this.ctx);
    smooth(this.comp.attack, v('attack'), this.ctx);
    smooth(this.comp.release, v('release'), this.ctx);
    smooth(this.comp.knee, v('knee'), this.ctx);
    smooth(this.makeup.gain, dbToGain(v('makeup')), this.ctx);
    this.sidechainOn = v('sidechain') >= 0.5;
    if (!this.updateMode() && this.keyed) this.applyKeyed(this.keyed, false);
  }
  setSidechain(source: AudioNode | null): void {
    this.source = source;
    this.updateMode();
  }
  private applyKeyed(node: AudioWorkletNode, jump: boolean): void {
    for (const key of ['threshold', 'ratio', 'attack', 'release', 'knee']) {
      const param = node.parameters.get(key);
      const value = effectParam('compressor', this.params, key);
      if (!param || !Number.isFinite(value)) continue;
      if (jump) param.value = value;
      else smooth(param, value, this.ctx);
    }
  }
  /** Switches between the built-in and the keyed compressor; true when it switched. */
  private updateMode(): boolean {
    const source = this.sidechainOn && workletsReady(this.ctx) ? this.source : null;
    if (source === this.keyedSource) return false;
    this.input.disconnect();
    if (this.keyed) {
      detach(this.keyedSource, this.keyed);
      this.keyed.disconnect();
      this.keyed.port.postMessage('dispose');
      this.keyed = null;
    }
    this.keyedSource = source;
    if (source) {
      const node = new AudioWorkletNode(this.ctx, 'mad-compressor', {
        numberOfInputs: 2,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      });
      this.applyKeyed(node, true);
      this.input.connect(node, 0, 0);
      source.connect(node, 0, 1);
      node.connect(this.makeup);
      this.keyed = node;
    } else {
      this.input.connect(this.comp);
    }
    return true;
  }
  dispose(): void {
    this.input.disconnect();
    this.comp.disconnect();
    this.makeup.disconnect();
    if (this.keyed) {
      detach(this.keyedSource, this.keyed);
      this.keyed.disconnect();
      this.keyed.port.postMessage('dispose');
      this.keyed = null;
    }
  }
}

function driveCurve(drive: number): Float32Array<ArrayBuffer> {
  const k = 1 + drive * 40;
  const n = 2048;
  const curve = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / norm;
  }
  return curve;
}

class DistortionEffect implements EffectNode {
  readonly type = 'distortion' as const;
  private readonly dw: DryWet;
  private readonly shaper: WaveShaperNode;
  private readonly tone: BiquadFilterNode;
  private readonly level: GainNode;
  private lastDrive = -1;
  constructor(private readonly ctx: BaseAudioContext) {
    this.dw = new DryWet(ctx);
    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = '4x';
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.level = ctx.createGain();
    this.dw.input.connect(this.shaper);
    this.shaper.connect(this.tone);
    this.tone.connect(this.dw.wet);
    this.dw.output.connect(this.level);
  }
  get input() {
    return this.dw.input;
  }
  get output() {
    return this.level;
  }
  setParams(p: Record<string, number>): void {
    const v = (k: string) => effectParam('distortion', p, k);
    const drive = Math.round(v('drive') * 100) / 100;
    if (drive !== this.lastDrive) {
      this.shaper.curve = driveCurve(drive);
      this.lastDrive = drive;
    }
    smooth(this.tone.frequency, v('tone'), this.ctx);
    smooth(this.level.gain, dbToGain(v('output')), this.ctx);
    this.dw.setMix(v('mix'));
  }
  dispose(): void {
    this.dw.dispose();
    this.shaper.disconnect();
    this.tone.disconnect();
    this.level.disconnect();
  }
}

class ChorusEffect implements EffectNode {
  readonly type = 'chorus' as const;
  private readonly dw: DryWet;
  private readonly split: ChannelSplitterNode;
  private readonly merge: ChannelMergerNode;
  private readonly delays: DelayNode[];
  private readonly lfo: OscillatorNode;
  private readonly depthL: GainNode;
  private readonly depthR: GainNode;
  constructor(private readonly ctx: BaseAudioContext) {
    this.dw = new DryWet(ctx);
    this.split = ctx.createChannelSplitter(2);
    this.merge = ctx.createChannelMerger(2);
    this.delays = [ctx.createDelay(0.1), ctx.createDelay(0.1)];
    this.lfo = ctx.createOscillator();
    this.depthL = ctx.createGain();
    this.depthR = ctx.createGain();
    this.dw.input.connect(this.split);
    this.split.connect(this.delays[0], 0);
    this.split.connect(this.delays[1], 1);
    this.delays[0].connect(this.merge, 0, 0);
    this.delays[1].connect(this.merge, 0, 1);
    this.merge.connect(this.dw.wet);
    this.lfo.connect(this.depthL);
    this.lfo.connect(this.depthR);
    this.depthL.connect(this.delays[0].delayTime);
    this.depthR.connect(this.delays[1].delayTime);
    this.lfo.start();
  }
  get input() {
    return this.dw.input;
  }
  get output() {
    return this.dw.output;
  }
  setParams(p: Record<string, number>): void {
    const v = (k: string) => effectParam('chorus', p, k);
    const base = v('delay') / 1000;
    const depth = v('depth') * Math.min(base * 0.9, 0.006);
    for (const d of this.delays) smooth(d.delayTime, base, this.ctx);
    smooth(this.lfo.frequency, v('rate'), this.ctx);
    smooth(this.depthL.gain, depth, this.ctx);
    smooth(this.depthR.gain, -depth, this.ctx);
    this.dw.setMix(v('mix'));
  }
  dispose(): void {
    this.lfo.stop();
    for (const n of [this.lfo, this.depthL, this.depthR, this.split, this.merge, ...this.delays]) n.disconnect();
    this.dw.dispose();
  }
}

class DelayEffect implements EffectNode {
  readonly type = 'delay' as const;
  private readonly dw: DryWet;
  private readonly split: ChannelSplitterNode;
  private readonly merge: ChannelMergerNode;
  private readonly delayL: DelayNode;
  private readonly delayR: DelayNode;
  private readonly toneL: BiquadFilterNode;
  private readonly toneR: BiquadFilterNode;
  // Routing gains that switch between stereo and ping-pong topologies.
  private readonly inLL: GainNode;
  private readonly inRR: GainNode;
  private readonly inRL: GainNode;
  private readonly fbLL: GainNode;
  private readonly fbRR: GainNode;
  private readonly fbLR: GainNode;
  private readonly fbRL: GainNode;

  constructor(private readonly ctx: BaseAudioContext) {
    const g = () => ctx.createGain();
    this.dw = new DryWet(ctx);
    this.split = ctx.createChannelSplitter(2);
    this.merge = ctx.createChannelMerger(2);
    this.delayL = ctx.createDelay(5);
    this.delayR = ctx.createDelay(5);
    this.toneL = ctx.createBiquadFilter();
    this.toneR = ctx.createBiquadFilter();
    this.toneL.type = 'lowpass';
    this.toneR.type = 'lowpass';
    this.inLL = g();
    this.inRR = g();
    this.inRL = g();
    this.fbLL = g();
    this.fbRR = g();
    this.fbLR = g();
    this.fbRL = g();

    this.dw.input.connect(this.split);
    this.split.connect(this.inLL, 0);
    this.split.connect(this.inRR, 1);
    this.split.connect(this.inRL, 1);
    this.inLL.connect(this.delayL);
    this.inRL.connect(this.delayL);
    this.inRR.connect(this.delayR);
    this.delayL.connect(this.toneL);
    this.delayR.connect(this.toneR);
    this.toneL.connect(this.fbLL);
    this.toneL.connect(this.fbLR);
    this.toneR.connect(this.fbRR);
    this.toneR.connect(this.fbRL);
    this.fbLL.connect(this.delayL);
    this.fbLR.connect(this.delayR);
    this.fbRR.connect(this.delayR);
    this.fbRL.connect(this.delayL);
    this.toneL.connect(this.merge, 0, 0);
    this.toneR.connect(this.merge, 0, 1);
    this.merge.connect(this.dw.wet);
  }
  get input() {
    return this.dw.input;
  }
  get output() {
    return this.dw.output;
  }
  setParams(p: Record<string, number>, env: EffectEnv): void {
    const v = (k: string) => effectParam('delay', p, k);
    const beats = DELAY_DIVISION_BEATS[Math.round(v('time'))] ?? 0.75;
    const time = Math.min(4.9, (beats * 60) / Math.max(env.bpm, 1));
    const fb = Math.max(0, Math.min(0.95, v('feedback')));
    const ping = v('pingPong') >= 0.5;
    smooth(this.delayL.delayTime, time, this.ctx);
    smooth(this.delayR.delayTime, time, this.ctx);
    smooth(this.toneL.frequency, v('tone'), this.ctx);
    smooth(this.toneR.frequency, v('tone'), this.ctx);
    // Ping-pong: mono input enters on the left, echoes alternate sides.
    smooth(this.inLL.gain, ping ? 0.5 : 1, this.ctx);
    smooth(this.inRL.gain, ping ? 0.5 : 0, this.ctx);
    smooth(this.inRR.gain, ping ? 0 : 1, this.ctx);
    smooth(this.fbLL.gain, ping ? 0 : fb, this.ctx);
    smooth(this.fbRR.gain, ping ? 0 : fb, this.ctx);
    smooth(this.fbLR.gain, ping ? fb : 0, this.ctx);
    smooth(this.fbRL.gain, ping ? fb : 0, this.ctx);
    this.dw.setMix(v('mix'));
  }
  dispose(): void {
    for (const n of [
      this.split,
      this.merge,
      this.delayL,
      this.delayR,
      this.toneL,
      this.toneR,
      this.inLL,
      this.inRR,
      this.inRL,
      this.fbLL,
      this.fbRR,
      this.fbLR,
      this.fbRL,
    ]) {
      n.disconnect();
    }
    this.dw.dispose();
  }
}

/** Builds a stereo impulse response: decaying noise that darkens over time. */
export function makeImpulseResponse(sampleRate: number, decay: number, damping: number, seed = 1): Float32Array[] {
  const length = Math.max(1, Math.floor(sampleRate * Math.min(12, decay * 1.15)));
  const channels = [new Float32Array(length), new Float32Array(length)];
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 4294967296) * 2 - 1;
  };
  const startCut = 18000;
  const endCut = startCut * (1 - damping) + 700 * damping;
  for (const data of channels) {
    let y = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const progress = i / length;
      const fc = startCut * Math.pow(endCut / startCut, progress);
      const a = 1 - Math.exp((-2 * Math.PI * fc) / sampleRate);
      y += a * (rand() - y);
      // -60 dB at `decay` seconds.
      data[i] = y * Math.exp((-6.9 * t) / decay);
    }
  }
  return channels;
}

class ReverbEffect implements EffectNode {
  readonly type = 'reverb' as const;
  private readonly dw: DryWet;
  private readonly predelay: DelayNode;
  private readonly lowCut: BiquadFilterNode;
  private convolver: ConvolverNode | null = null;
  private irKey = '';
  private pendingIr: ReturnType<typeof setTimeout> | null = null;
  private first = true;

  constructor(private readonly ctx: BaseAudioContext) {
    this.dw = new DryWet(ctx);
    this.predelay = ctx.createDelay(1);
    this.lowCut = ctx.createBiquadFilter();
    this.lowCut.type = 'highpass';
    this.dw.input.connect(this.predelay);
    this.lowCut.connect(this.dw.wet);
  }
  get input() {
    return this.dw.input;
  }
  get output() {
    return this.dw.output;
  }
  /** Swaps in a new convolver whose buffer is set before it is connected (avoids glitches). */
  private install(decay: number, damping: number): void {
    const [l, r] = makeImpulseResponse(this.ctx.sampleRate, decay, damping);
    const buffer = this.ctx.createBuffer(2, l.length, this.ctx.sampleRate);
    buffer.copyToChannel(l as Float32Array<ArrayBuffer>, 0);
    buffer.copyToChannel(r as Float32Array<ArrayBuffer>, 1);
    const next = this.ctx.createConvolver();
    next.buffer = buffer;
    this.predelay.connect(next);
    next.connect(this.lowCut);
    const old = this.convolver;
    this.convolver = next;
    if (old) {
      this.predelay.disconnect(old);
      old.disconnect();
    }
  }
  setParams(p: Record<string, number>): void {
    const v = (k: string) => effectParam('reverb', p, k);
    smooth(this.predelay.delayTime, v('predelay'), this.ctx);
    smooth(this.lowCut.frequency, v('lowCut'), this.ctx);
    this.dw.setMix(v('mix'));
    const decay = Math.round(v('decay') * 100) / 100;
    const damping = Math.round(v('damping') * 100) / 100;
    const key = `${decay}:${damping}`;
    if (key === this.irKey) return;
    this.irKey = key;
    if (this.pendingIr) clearTimeout(this.pendingIr);
    // Build immediately the first time (offline renders), debounce knob drags afterwards.
    if (this.first) {
      this.first = false;
      this.install(decay, damping);
    } else {
      this.pendingIr = setTimeout(() => {
        this.pendingIr = null;
        this.install(decay, damping);
      }, 120);
    }
  }
  dispose(): void {
    if (this.pendingIr) clearTimeout(this.pendingIr);
    this.predelay.disconnect();
    this.convolver?.disconnect();
    this.lowCut.disconnect();
    this.dw.dispose();
  }
}

/** Soft-knee clipper curve: linear below the knee, saturating to the ceiling. */
function clipperCurve(ceiling: number): Float32Array<ArrayBuffer> {
  const n = 4096;
  const curve = new Float32Array(n);
  const knee = ceiling * 0.85;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 4 - 2; // input range ±2
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + (ceiling - knee) * Math.tanh((a - knee) / (ceiling - knee));
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

class LimiterEffect implements EffectNode {
  readonly type = 'limiter' as const;
  readonly input: GainNode;
  private readonly comp: DynamicsCompressorNode;
  private readonly pre: GainNode;
  private readonly clipper: WaveShaperNode;
  private readonly post: GainNode;
  private lastCeiling = NaN;
  constructor(private readonly ctx: BaseAudioContext) {
    this.input = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.knee.value = 0;
    this.comp.ratio.value = 20;
    this.comp.attack.value = 0.001;
    this.clipper = ctx.createWaveShaper();
    this.clipper.oversample = '2x';
    this.post = ctx.createGain();
    this.pre = ctx.createGain();
    this.pre.gain.value = 0.5;
    this.input.connect(this.comp);
    this.comp.connect(this.pre);
    this.pre.connect(this.clipper);
    this.clipper.connect(this.post);
  }
  get output() {
    return this.post;
  }
  setParams(p: Record<string, number>): void {
    const v = (k: string) => effectParam('limiter', p, k);
    const ceiling = dbToGain(v('ceiling'));
    smooth(this.input.gain, dbToGain(v('gain')), this.ctx);
    smooth(this.comp.threshold, v('ceiling') - 3, this.ctx);
    smooth(this.comp.release, v('release'), this.ctx);
    if (ceiling !== this.lastCeiling) {
      // The 0.5 pre-gain maps signals of ±2 onto the shaper's ±1 domain; the curve covers ±2.
      this.clipper.curve = clipperCurve(ceiling);
      this.lastCeiling = ceiling;
    }
  }
  dispose(): void {
    this.input.disconnect();
    this.comp.disconnect();
    this.pre.disconnect();
    this.clipper.disconnect();
    this.post.disconnect();
  }
}

/**
 * Placeholder for third-party plugins: they only run in the native engine (desktop app), the browser
 * engine passes the audio through unchanged.
 */
class PassthroughEffect implements EffectNode {
  readonly type = 'plugin' as const;
  readonly input: GainNode;
  constructor(ctx: BaseAudioContext) {
    this.input = ctx.createGain();
  }
  get output() {
    return this.input;
  }
  setParams(): void {}
  dispose(): void {
    this.input.disconnect();
  }
}

export function createEffect(ctx: BaseAudioContext, type: SlotType): EffectNode {
  switch (type) {
    case 'plugin':
      return new PassthroughEffect(ctx);
    case 'eq':
      return new EqEffect(ctx);
    case 'filter':
      return new FilterEffect(ctx);
    case 'compressor':
      return new CompressorEffect(ctx);
    case 'distortion':
      return new DistortionEffect(ctx);
    case 'chorus':
      return new ChorusEffect(ctx);
    case 'delay':
      return new DelayEffect(ctx);
    case 'reverb':
      return new ReverbEffect(ctx);
    case 'limiter':
      return new LimiterEffect(ctx);
  }
}
