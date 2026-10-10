import { channelSettings } from '../../model/channelSettings';
import { modXFactor, noteResonance, releaseScale } from '../../model/notes';
import { midiToHz } from '../../model/timing';
import type { SynthChannel, SynthParams } from '../../model/types';
import { releaseEnvelope, scheduleEnvelope } from '../envelope';
import { NOTE_PAN_EPSILON, Voice, createPannedOutput, enforcePolyphony, schedulePitch, type Instrument, type TriggerOptions } from './voice';

const MAX_VOICES = 24;
/** LFO depth 1.0 equals ±2 semitones of vibrato. */
const LFO_PITCH_CENTS = 200;
/** LFO depth 1.0 equals ±3 octaves of filter movement. */
const LFO_FILTER_CENTS = 3600;
/** Envelope amount 1.0 sweeps the filter up by 6 octaves. */
const FILTER_ENV_CENTS = 7200;

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseBuffers.get(ctx);
  if (!buf) {
    const length = ctx.sampleRate * 2;
    buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let seed = 1234567;
    for (let i = 0; i < length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 4294967296) * 2 - 1;
    }
    noiseBuffers.set(ctx, buf);
  }
  return buf;
}

/** Three-oscillator subtractive synth built from native Web Audio nodes. */
export class SynthInstrument implements Instrument {
  readonly output: GainNode;
  readonly pannedOutput: GainNode;
  private params: SynthParams;
  /** Voice limit (channel settings: polyphony, Mono = 1). */
  private maxVoices = MAX_VOICES;
  private readonly voices = new Set<Voice>();
  /** Filters of sounding voices, so cutoff/resonance changes (automation!) reach held notes too. */
  private readonly voiceFilters = new Map<Voice, { filter: BiquadFilterNode; key: number; modX: number; modY: number | undefined }>();
  private readonly lfo: OscillatorNode;
  private readonly lfoPitch: GainNode;
  private readonly lfoFilter: GainNode;
  private readonly lfoAmp: GainNode;

  constructor(private readonly ctx: BaseAudioContext, channel: SynthChannel) {
    this.params = channel.synth;
    this.output = ctx.createGain();
    this.pannedOutput = createPannedOutput(ctx);
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfoPitch = ctx.createGain();
    this.lfoFilter = ctx.createGain();
    this.lfoAmp = ctx.createGain();
    for (const g of [this.lfoPitch, this.lfoFilter, this.lfoAmp]) this.lfo.connect(g);
    this.lfo.start();
    this.update(channel);
  }

  update(channel: SynthChannel): void {
    const p = channel.synth;
    this.params = p;
    this.setVoiceLimit(channel);
    const now = this.ctx.currentTime;
    this.output.gain.setTargetAtTime(p.gain, now, 0.01);
    this.pannedOutput.gain.setTargetAtTime(p.gain, now, 0.01);
    this.lfo.frequency.setTargetAtTime(Math.max(0.01, p.lfo.rate), now, 0.01);
    const d = Math.max(0, Math.min(1, p.lfo.depth));
    this.lfoPitch.gain.setTargetAtTime(p.lfo.target === 'pitch' ? d * LFO_PITCH_CENTS : 0, now, 0.01);
    this.lfoFilter.gain.setTargetAtTime(p.lfo.target === 'filter' ? d * LFO_FILTER_CENTS : 0, now, 0.01);
    this.lfoAmp.gain.setTargetAtTime(p.lfo.target === 'amp' ? d * 0.5 : 0, now, 0.01);
    if (p.filter.enabled) {
      for (const { filter, key, modX, modY } of this.voiceFilters.values()) {
        const keyTrack = Math.pow(2, ((key - 60) / 12) * p.filter.keyTrack);
        filter.frequency.setTargetAtTime(Math.min(20000, Math.max(20, p.filter.cutoff * keyTrack * modX)), now, 0.01);
        filter.Q.setTargetAtTime(noteResonance(p.filter.resonance, modY), now, 0.01);
      }
    }
  }

  setVoiceLimit(channel: SynthChannel): void {
    const st = channelSettings(channel);
    this.maxVoices = st.mono ? 1 : st.polyphony > 0 ? Math.min(MAX_VOICES, st.polyphony) : MAX_VOICES;
  }

  trigger(key: number, velocity: number, t: number, duration: number | null, opts: TriggerOptions = {}): Voice | null {
    const ctx = this.ctx;
    const p = this.params;
    const noteFine = opts.fine ?? 0;
    const modX = modXFactor(opts.modX);
    const relScale = releaseScale(opts.release);
    const env = { ...p.ampEnv, release: p.ampEnv.release * relScale };
    const filterEnv = { ...p.filterEnv, release: p.filterEnv.release * relScale };
    const nodes: AudioNode[] = [];
    const sources: AudioScheduledSourceNode[] = [];
    // LFO connections into this voice; removed when the voice ends so they do not accumulate.
    const lfoLinks: [GainNode, AudioParam][] = [];
    const linkLfo = (lfo: GainNode, param: AudioParam) => {
      lfo.connect(param);
      lfoLinks.push([lfo, param]);
    };

    const amp = ctx.createGain();
    amp.gain.value = 0;
    nodes.push(amp);
    let head: AudioNode = amp;
    let out: AudioNode = amp;

    let filter: BiquadFilterNode | null = null;
    const envCents = p.filter.envAmount * FILTER_ENV_CENTS;
    if (p.filter.enabled) {
      filter = ctx.createBiquadFilter();
      filter.type = p.filter.type;
      const keyTrack = Math.pow(2, ((key - 60) / 12) * p.filter.keyTrack);
      filter.frequency.value = Math.min(20000, Math.max(20, p.filter.cutoff * keyTrack * modX));
      filter.Q.value = noteResonance(p.filter.resonance, opts.modY);
      filter.connect(amp);
      head = filter;
      nodes.push(filter);
      if (envCents !== 0) scheduleEnvelope(filter.detune, filterEnv, t, 0, envCents, duration);
      if (p.lfo.target === 'filter') linkLfo(this.lfoFilter, filter.detune);
    }

    if (p.lfo.target === 'amp' && p.lfo.depth > 0) {
      const trem = ctx.createGain();
      trem.gain.value = 1 - Math.min(1, p.lfo.depth) * 0.5;
      linkLfo(this.lfoAmp, trem.gain);
      amp.connect(trem);
      out = trem;
      nodes.push(trem);
    }
    const pan = Math.max(-1, Math.min(1, opts.pan ?? 0));
    if (Math.abs(pan) > NOTE_PAN_EPSILON) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      out.connect(panner);
      panner.connect(this.pannedOutput);
      nodes.push(panner);
    } else {
      out.connect(this.output);
    }

    // Portamento and slide notes move the pitch of every oscillator through one modulation source.
    let pitchMod: ConstantSourceNode | null = null;
    if (opts.pitch) {
      pitchMod = ctx.createConstantSource();
      schedulePitch(pitchMod.offset, t, noteFine, opts.pitch);
    }

    for (const osc of p.osc) {
      if (osc.level <= 0.0001) continue;
      const count = Math.max(1, Math.min(7, Math.round(osc.unison)));
      const level = ctx.createGain();
      level.gain.value = osc.level / Math.sqrt(count);
      level.connect(head);
      nodes.push(level);
      for (let u = 0; u < count; u++) {
        const spread = count > 1 ? (u / (count - 1)) * 2 - 1 : 0;
        let src: AudioScheduledSourceNode;
        if (osc.wave === 'noise') {
          const b = ctx.createBufferSource();
          b.buffer = noiseBuffer(ctx);
          b.loop = true;
          src = b;
        } else {
          const o = ctx.createOscillator();
          o.type = osc.wave;
          o.frequency.value = midiToHz(key + osc.coarse);
          o.detune.value = osc.fine + spread * osc.detune + (pitchMod ? 0 : noteFine);
          if (pitchMod) pitchMod.connect(o.detune);
          if (p.lfo.target === 'pitch') linkLfo(this.lfoPitch, o.detune);
          src = o;
        }
        const pan = Math.max(-1, Math.min(1, osc.pan + spread * 0.6));
        if (Math.abs(pan) > 0.001) {
          const panner = ctx.createStereoPanner();
          panner.pan.value = pan;
          src.connect(panner);
          panner.connect(level);
          nodes.push(panner);
        } else {
          src.connect(level);
        }
        // Slightly staggered starts decorrelate unison phases.
        const start = t + u * 0.0007;
        if (src instanceof AudioBufferSourceNode) src.start(start, (u * 0.37 + key * 0.013) % 1.9);
        else src.start(start);
        sources.push(src);
        nodes.push(src);
      }
    }

    const unlinkLfo = () => {
      for (const [lfo, param] of lfoLinks) {
        try {
          lfo.disconnect(param);
        } catch {
          // Already disconnected.
        }
      }
    };
    if (sources.length === 0) {
      unlinkLfo();
      for (const n of nodes) n.disconnect();
      pitchMod?.disconnect();
      return null;
    }
    if (pitchMod) {
      // After the oscillators: the voice cleans up when its first source ends.
      pitchMod.start(t);
      sources.push(pitchMod);
      nodes.push(pitchMod);
    }

    const peak = Math.max(0, Math.min(1, velocity));
    const end = scheduleEnvelope(amp.gain, env, t, 0, peak, duration);
    if (Number.isFinite(end)) for (const s of sources) s.stop(end + 0.01);

    const voice = new Voice(key, t, end, amp, sources, nodes, (at) => {
      if (filter && envCents !== 0) releaseEnvelope(filter.detune, filterEnv, t, 0, envCents, at);
      return releaseEnvelope(amp.gain, env, t, 0, peak, at);
    });
    this.voices.add(voice);
    if (filter) this.voiceFilters.set(voice, { filter, key, modX, modY: opts.modY });
    voice.onEnd(() => {
      this.voices.delete(voice);
      this.voiceFilters.delete(voice);
      unlinkLfo();
    });
    enforcePolyphony(this.voices, this.maxVoices, t);
    return voice;
  }

  stopAll(at: number): void {
    for (const v of this.voices) v.kill(at);
  }

  dispose(): void {
    this.stopAll(this.ctx.currentTime);
    this.lfo.stop();
    this.lfo.disconnect();
    this.output.disconnect();
    this.pannedOutput.disconnect();
  }
}
