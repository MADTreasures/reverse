import { pitchCurve } from '../model/notes';
import { audibleTracks, sidechainSources, trackRoutes } from '../model/routing';
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

/** Removes the connection `from` → `to` if it still exists (disconnect() throws otherwise). */
function detach(from: AudioNode, to: AudioNode): void {
  try {
    from.disconnect(to);
  } catch {
    // already gone (for example with a removed track)
  }
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
  /** Sidechain bus: sidechain links arrive here, effects with a sidechain input listen to it. */
  readonly sidechain: GainNode;
  private sidechainFed = false;
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
    this.sidechain = ctx.createGain();
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

  /** Whether a sidechain link feeds this track (its effects may then listen to the sidechain bus). */
  setSidechainFed(fed: boolean): void {
    if (fed === this.sidechainFed) return;
    this.sidechainFed = fed;
    for (const fx of this.effects) fx.node.setSidechain?.(fed ? this.sidechain : null);
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
    for (const fx of next) fx.node.setSidechain?.(this.sidechainFed ? this.sidechain : null);
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
    for (const n of [this.input, this.sidechain, this.panner, this.fader, this.mute, this.output]) n.disconnect();
    this.splitter?.disconnect();
  }
}

type AnyInstrument = SynthInstrument | SamplerInstrument;

/** Channels the browser engine can play (plugins need the native engine, automation makes no sound). */
type WebChannel = Extract<AudioChannel, { kind: 'synth' | 'sampler' }>;

function isWebChannel(c: Channel): c is WebChannel {
  return c.kind === 'synth' || c.kind === 'sampler';
}

/**
 * Instrument plus channel volume, pan and mute, routed to a mixer track. Voices with a note pan arrive
 * on the instrument's always-stereo `pannedOutput` and get their own volume and pan stage, so the
 * channel pans the other voices exactly as before (mono or stereo law by their own channel count).
 */
class ChannelStrip {
  private instrument: AnyInstrument;
  private readonly volume: GainNode;
  private readonly panner: StereoPannerNode;
  private readonly pannedVolume: GainNode;
  private readonly pannedPanner: StereoPannerNode;
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
    this.pannedVolume = ctx.createGain();
    this.pannedPanner = ctx.createStereoPanner();
    this.mute = ctx.createGain();
    this.volume.connect(this.panner);
    this.panner.connect(this.mute);
    this.pannedVolume.connect(this.pannedPanner);
    this.pannedPanner.connect(this.mute);
    this.instrument = this.createInstrument(channel);
    this.connectInstrument();
    this.applyStrip(channel);
  }

  private createInstrument(channel: WebChannel): AnyInstrument {
    return channel.kind === 'synth'
      ? new SynthInstrument(this.ctx, channel)
      : new SamplerInstrument(this.ctx, channel.id, channel, this.pool, this.chokes);
  }

  private connectInstrument(): void {
    this.instrument.output.connect(this.volume);
    this.instrument.pannedOutput.connect(this.pannedVolume);
  }

  private applyStrip(channel: WebChannel): void {
    smooth(this.volume.gain, volumeToGain(channel.volume), this.ctx);
    smooth(this.panner.pan, channel.pan, this.ctx);
    smooth(this.pannedVolume.gain, volumeToGain(channel.volume), this.ctx);
    smooth(this.pannedPanner.pan, channel.pan, this.ctx);
    smooth(this.mute.gain, channel.muted ? 0 : 1, this.ctx);
  }

  update(channel: WebChannel): void {
    if (channel === this.channel) return;
    const prev = this.channel;
    this.channel = channel;
    if (prev.kind !== channel.kind) {
      this.instrument.dispose();
      this.instrument = this.createInstrument(channel);
      this.connectInstrument();
    } else if (channel.kind === 'synth' && this.instrument instanceof SynthInstrument) {
      if (prev.kind !== 'synth' || prev.synth !== channel.synth) this.instrument.update(channel);
      else if (prev.settings !== channel.settings) this.instrument.setVoiceLimit(channel);
    } else if (channel.kind === 'sampler' && this.instrument instanceof SamplerInstrument) {
      if (prev.kind !== 'sampler' || prev.sampler !== channel.sampler || prev.settings !== channel.settings) this.instrument.update(channel);
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
    this.pannedVolume.disconnect();
    this.pannedPanner.disconnect();
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
  /** Mixer sends by "from>to": a gain node into the target's input, plus the sidechain bus for links. */
  private readonly sends = new Map<string, { from: number; to: number; gain: GainNode; key: GainNode | null }>();
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
      }
      this.tracks.push(node);
    }
    while (this.tracks.length > project.mixer.length) this.tracks.pop()?.dispose();

    const audible = audibleTracks(project.mixer);
    project.mixer.forEach((t, i) => this.tracks[i].update(t, audible[i], env, force));
    this.syncSends(project);

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

  /** Mixer routing: every insert reaches its targets through a send (post fader), links also the sidechain bus. */
  private syncSends(project: Project): void {
    const n = this.tracks.length;
    const live = new Set<string>();
    for (let i = 1; i < n; i++) {
      const from = this.tracks[i];
      for (const r of trackRoutes(project.mixer, i)) {
        if (r.to < 0 || r.to >= n || r.to === i) continue;
        const id = `${i}>${r.to}`;
        live.add(id);
        const target = this.tracks[r.to];
        const level = volumeToGain(r.level);
        let send = this.sends.get(id);
        if (!send) {
          const gain = this.ctx.createGain();
          gain.gain.value = level;
          from.output.connect(gain);
          gain.connect(target.input);
          send = { from: i, to: r.to, gain, key: null };
          this.sends.set(id, send);
        } else {
          smooth(send.gain.gain, level, this.ctx);
        }
        const key = r.sidechain ? target.sidechain : null;
        if (key !== send.key) {
          if (send.key) detach(from.output, send.key);
          if (key) from.output.connect(key);
          send.key = key;
        }
      }
    }
    for (const [id, send] of this.sends) {
      if (live.has(id)) continue;
      const from = this.tracks[send.from];
      if (from) {
        detach(from.output, send.gain);
        if (send.key) detach(from.output, send.key);
      }
      send.gain.disconnect();
      this.sends.delete(id);
    }
    for (let i = 0; i < n; i++) this.tracks[i].setSidechainFed(sidechainSources(project.mixer, i).length > 0);
  }

  /** Schedules a sequenced note at audio time `time`; `spt` is seconds per tick. */
  trigger(ev: SequencedEvent, time: number, spt: number): void {
    const strip = this.strips.get(ev.channelId);
    if (!strip || strip.channel.muted) return;
    const opts: TriggerOptions = ev.audioClip ? { gate: true, sampleOffset: (ev.sampleOffset ?? 0) * spt } : {};
    if (ev.pan !== undefined) opts.pan = ev.pan;
    if (ev.fine !== undefined) opts.fine = ev.fine;
    if (ev.modX !== undefined) opts.modX = ev.modX;
    if (ev.modY !== undefined) opts.modY = ev.modY;
    if (ev.release !== undefined) opts.release = ev.release;
    opts.pitch = pitchCurve(ev.glideFrom, ev.glideTime, ev.bends, spt);
    strip.trigger(ev.key, ev.velocity, time, ev.length * spt, opts);
    this.activity.set(ev.channelId, time);
  }

  /** Starts a held note (keyboard, piano roll preview); release it with voice.release(). */
  noteOn(channelId: string, key: number, velocity: number, time = this.ctx.currentTime, opts: { glideFrom?: number; glideTime?: number } = {}): Voice | null {
    const strip = this.strips.get(channelId);
    if (!strip) return null;
    this.activity.set(channelId, time);
    const pitch = pitchCurve(opts.glideFrom, opts.glideTime, undefined, 0);
    return strip.trigger(key, velocity, time, null, pitch ? { pitch } : undefined);
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
    for (const send of this.sends.values()) send.gain.disconnect();
    this.sends.clear();
    for (const t of this.tracks) t.dispose();
    this.tracks.length = 0;
    this.previewBus.disconnect();
    this.metronomeBus.disconnect();
  }
}
