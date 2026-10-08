import type { SequencedEvent } from '../model/timeline';
import { volumeToGain } from '../model/timing';
import type { AudioChannel, Channel, EffectSlot, MixerTrack, Project, SlotType } from '../model/types';
import { createEffect, type EffectEnv, type EffectNode } from './effects/effects';
import { SamplerInstrument } from './instruments/sampler';
import { SynthInstrument } from './instruments/synth';
import { ChokeManager, type TriggerOptions, type Voice } from './instruments/voice';
import type { SamplePool } from './samplePool';

function smooth(param: AudioParam, value: number, ctx: BaseAudioContext): void {
  param.setTargetAtTime(value, ctx.currentTime, 0.01);
}

interface ActiveEffect {
  slotId: string;
  type: SlotType;
  node: EffectNode;
  slot: EffectSlot | null;
}

/** One mixer track: input → insert effects → pan → fader → mute → output (+ meters). */
export class MixerTrackNode {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly panner: StereoPannerNode;
  private readonly fader: GainNode;
  private readonly mute: GainNode;
  private readonly analysers: [AnalyserNode, AnalyserNode] | null = null;
  private readonly splitter: ChannelSplitterNode | null = null;
  private readonly scratch: Float32Array<ArrayBuffer> | null = null;
  private effects: ActiveEffect[] = [];
  private chainKey = '';
  private track: MixerTrack | null = null;
  private audible = true;

  constructor(private readonly ctx: BaseAudioContext, meters: boolean) {
    this.input = ctx.createGain();
    this.panner = ctx.createStereoPanner();
    this.fader = ctx.createGain();
    this.mute = ctx.createGain();
    this.output = ctx.createGain();
    this.input.connect(this.panner);
    this.panner.connect(this.fader);
    this.fader.connect(this.mute);
    this.mute.connect(this.output);
    if (meters) {
      this.splitter = ctx.createChannelSplitter(2);
      const make = () => {
        const a = ctx.createAnalyser();
        a.fftSize = 1024;
        return a;
      };
      this.analysers = [make(), make()];
      this.output.connect(this.splitter);
      this.splitter.connect(this.analysers[0], 0);
      this.splitter.connect(this.analysers[1], 1);
      this.scratch = new Float32Array(1024);
    }
  }

  update(track: MixerTrack, audible: boolean, env: EffectEnv, force: boolean): void {
    if (!force && track === this.track && audible === this.audible) return;
    this.track = track;
    this.audible = audible;
    smooth(this.panner.pan, track.pan, this.ctx);
    smooth(this.fader.gain, volumeToGain(track.volume), this.ctx);
    smooth(this.mute.gain, track.muted || !audible ? 0 : 1, this.ctx);

    const key = track.effects.map((e) => `${e.id}:${e.type}:${e.enabled ? 1 : 0}`).join('|');
    if (key !== this.chainKey) {
      this.rebuild(track.effects);
      this.chainKey = key;
    }
    for (const fx of this.effects) {
      const slot = track.effects.find((e) => e.id === fx.slotId) ?? null;
      if (slot && (force || slot !== fx.slot)) fx.node.setParams(slot.params, env);
      fx.slot = slot;
    }
  }

  private rebuild(slots: EffectSlot[]): void {
    this.input.disconnect();
    for (const fx of this.effects) fx.node.output.disconnect();
    const next: ActiveEffect[] = [];
    for (const slot of slots) {
      const existing = this.effects.find((e) => e.slotId === slot.id && e.type === slot.type);
      next.push(existing ?? { slotId: slot.id, type: slot.type, node: createEffect(this.ctx, slot.type), slot: null });
    }
    for (const fx of this.effects) if (!next.includes(fx)) fx.node.dispose();
    this.effects = next;
    let prev: AudioNode = this.input;
    for (const fx of next) {
      const slot = slots.find((s) => s.id === fx.slotId);
      if (!slot?.enabled) continue;
      prev.connect(fx.node.input);
      prev = fx.node.output;
    }
    prev.connect(this.panner);
  }

  /** Peak levels [left, right] of the post-fader signal. */
  readPeaks(): [number, number] {
    if (!this.analysers || !this.scratch) return [0, 0];
    const out: [number, number] = [0, 0];
    for (let c = 0; c < 2; c++) {
      this.analysers[c].getFloatTimeDomainData(this.scratch);
      let peak = 0;
      for (let i = 0; i < this.scratch.length; i++) {
        const v = Math.abs(this.scratch[i]);
        if (v > peak) peak = v;
      }
      out[c] = peak;
    }
    return out;
  }

  /** Raw waveform of the left channel (for the transport oscilloscope). */
  readWaveform(target: Float32Array<ArrayBuffer>): boolean {
    if (!this.analysers) return false;
    this.analysers[0].getFloatTimeDomainData(target);
    return true;
  }

  dispose(): void {
    for (const fx of this.effects) fx.node.dispose();
    this.effects = [];
    for (const n of [this.input, this.panner, this.fader, this.mute, this.output]) n.disconnect();
    this.splitter?.disconnect();
  }
}

type AnyInstrument = SynthInstrument | SamplerInstrument;

/** Channels the browser engine can play (plugins need the native engine, automation makes no sound). */
type WebChannel = Extract<AudioChannel, { kind: 'synth' | 'sampler' }>;

function isWebChannel(c: Channel): c is WebChannel {
  return c.kind === 'synth' || c.kind === 'sampler';
}

/** Instrument plus channel volume, pan and mute, routed to a mixer track. */
class ChannelStrip {
  private instrument: AnyInstrument;
  private readonly volume: GainNode;
  private readonly panner: StereoPannerNode;
  private readonly mute: GainNode;
  private target: AudioNode | null = null;
  channel: WebChannel;

  constructor(
    private readonly ctx: BaseAudioContext,
    channel: WebChannel,
    private readonly pool: SamplePool,
    private readonly chokes: ChokeManager,
  ) {
    this.channel = channel;
    this.volume = ctx.createGain();
    this.panner = ctx.createStereoPanner();
    this.mute = ctx.createGain();
    this.volume.connect(this.panner);
    this.panner.connect(this.mute);
    this.instrument = this.createInstrument(channel);
    this.instrument.output.connect(this.volume);
    this.applyStrip(channel);
  }

  private createInstrument(channel: WebChannel): AnyInstrument {
    return channel.kind === 'synth'
      ? new SynthInstrument(this.ctx, channel)
      : new SamplerInstrument(this.ctx, channel.id, channel, this.pool, this.chokes);
  }

  private applyStrip(channel: WebChannel): void {
    smooth(this.volume.gain, volumeToGain(channel.volume), this.ctx);
    smooth(this.panner.pan, channel.pan, this.ctx);
    smooth(this.mute.gain, channel.muted ? 0 : 1, this.ctx);
  }

  update(channel: WebChannel): void {
    if (channel === this.channel) return;
    const prev = this.channel;
    this.channel = channel;
    if (prev.kind !== channel.kind) {
      this.instrument.dispose();
      this.instrument = this.createInstrument(channel);
      this.instrument.output.connect(this.volume);
    } else if (channel.kind === 'synth' && this.instrument instanceof SynthInstrument) {
      if (prev.kind !== 'synth' || prev.synth !== channel.synth) this.instrument.update(channel);
    } else if (channel.kind === 'sampler' && this.instrument instanceof SamplerInstrument) {
      if (prev.kind !== 'sampler' || prev.sampler !== channel.sampler) this.instrument.update(channel);
    }
    this.applyStrip(channel);
  }

  route(dest: AudioNode): void {
    if (dest === this.target) return;
    if (this.target) this.mute.disconnect();
    this.mute.connect(dest);
    this.target = dest;
  }

  trigger(key: number, velocity: number, time: number, duration: number | null, opts?: TriggerOptions): Voice | null {
    return this.instrument.trigger(key, velocity, time, duration, opts);
  }

  stopAll(at: number): void {
    this.instrument.stopAll(at);
  }

  dispose(): void {
    this.instrument.dispose();
    this.volume.disconnect();
    this.panner.disconnect();
    this.mute.disconnect();
  }
}

/**
 * Mirrors a Project as a Web Audio graph on any BaseAudioContext, so the same
 * code drives live playback and offline WAV rendering.
 */
export class ProjectGraph {
  readonly tracks: MixerTrackNode[] = [];
  readonly previewBus: GainNode;
  readonly metronomeBus: GainNode;
  /** Audio time of the most recent trigger per channel (channel rack activity LEDs). */
  readonly activity = new Map<string, number>();
  private readonly strips = new Map<string, ChannelStrip>();
  private readonly chokes = new ChokeManager();
  private project: Project | null = null;

  constructor(
    readonly ctx: BaseAudioContext,
    private readonly pool: SamplePool,
    private readonly opts: { meters: boolean },
  ) {
    this.previewBus = ctx.createGain();
    this.metronomeBus = ctx.createGain();
    this.metronomeBus.gain.value = 0.5;
    this.metronomeBus.connect(ctx.destination);
  }

  get master(): MixerTrackNode {
    return this.tracks[0];
  }

  sync(project: Project): void {
    const prev = this.project;
    this.project = project;
    const env: EffectEnv = { bpm: project.bpm };
    const force = !prev || prev.bpm !== project.bpm;

    while (this.tracks.length < project.mixer.length) {
      const node = new MixerTrackNode(this.ctx, this.opts.meters);
      if (this.tracks.length === 0) {
        node.output.connect(this.ctx.destination);
        this.previewBus.connect(node.input);
      } else {
        node.output.connect(this.tracks[0].input);
      }
      this.tracks.push(node);
    }
    while (this.tracks.length > project.mixer.length) this.tracks.pop()?.dispose();

    const anySolo = project.mixer.some((t, i) => i > 0 && t.solo);
    project.mixer.forEach((t, i) => this.tracks[i].update(t, i === 0 || !anySolo || t.solo, env, force));

    const playable = project.channels.filter(isWebChannel);
    const ids = new Set(playable.map((c) => c.id));
    for (const [id, strip] of this.strips) {
      if (!ids.has(id)) {
        strip.dispose();
        this.strips.delete(id);
      }
    }
    for (const ch of playable) {
      let strip = this.strips.get(ch.id);
      if (!strip) {
        strip = new ChannelStrip(this.ctx, ch, this.pool, this.chokes);
        this.strips.set(ch.id, strip);
      } else {
        strip.update(ch);
      }
      const track = this.tracks[Math.min(Math.max(0, ch.mixerTrack), this.tracks.length - 1)];
      strip.route(track.input);
    }
  }

  /** Schedules a sequenced note at audio time `time`; `spt` is seconds per tick. */
  trigger(ev: SequencedEvent, time: number, spt: number): void {
    const strip = this.strips.get(ev.channelId);
    if (!strip || strip.channel.muted) return;
    const opts: TriggerOptions | undefined = ev.audioClip ? { gate: true, sampleOffset: (ev.sampleOffset ?? 0) * spt } : undefined;
    strip.trigger(ev.key, ev.velocity, time, ev.length * spt, opts);
    this.activity.set(ev.channelId, time);
  }

  /** Starts a held note (keyboard, piano roll preview); release it with voice.release(). */
  noteOn(channelId: string, key: number, velocity: number, time = this.ctx.currentTime): Voice | null {
    const strip = this.strips.get(channelId);
    if (!strip) return null;
    this.activity.set(channelId, time);
    return strip.trigger(key, velocity, time, null);
  }

  stopAll(at = this.ctx.currentTime): void {
    for (const strip of this.strips.values()) strip.stopAll(at);
  }

  metronomeClick(time: number, accent: boolean): void {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.value = accent ? 1760 : 1175;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(accent ? 0.6 : 0.4, time + 0.001);
    gain.gain.setTargetAtTime(0, time + 0.002, 0.012);
    osc.connect(gain);
    gain.connect(this.metronomeBus);
    osc.start(time);
    osc.stop(time + 0.08);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  peaks(trackIndex: number): [number, number] {
    return this.tracks[trackIndex]?.readPeaks() ?? [0, 0];
  }

  dispose(): void {
    for (const strip of this.strips.values()) strip.dispose();
    this.strips.clear();
    for (const t of this.tracks) t.dispose();
    this.tracks.length = 0;
    this.previewBus.disconnect();
    this.metronomeBus.disconnect();
  }
}
