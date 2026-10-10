import { minPitch, releaseScale } from '../../model/notes';
import type { SamplerChannel, SamplerParams } from '../../model/types';
import { releaseEnvelope, scheduleEnvelope } from '../envelope';
import type { SamplePool } from '../samplePool';
import { ChokeManager, NOTE_PAN_EPSILON, Voice, createPannedOutput, enforcePolyphony, schedulePitch, type Instrument, type TriggerOptions } from './voice';

const MAX_VOICES = 32;

/** Pitch-shifting sample player with one-shot, loop, reverse and choke groups. */
export class SamplerInstrument implements Instrument {
  readonly output: GainNode;
  readonly pannedOutput: GainNode;
  private params: SamplerParams;
  private readonly voices = new Set<Voice>();

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly channelId: string,
    channel: SamplerChannel,
    private readonly pool: SamplePool,
    private readonly chokes: ChokeManager,
  ) {
    this.params = channel.sampler;
    this.output = ctx.createGain();
    this.pannedOutput = createPannedOutput(ctx);
    this.update(channel);
  }

  update(channel: SamplerChannel): void {
    this.params = channel.sampler;
    this.output.gain.setTargetAtTime(this.params.gain, this.ctx.currentTime, 0.01);
    this.pannedOutput.gain.setTargetAtTime(this.params.gain, this.ctx.currentTime, 0.01);
  }

  trigger(key: number, velocity: number, t: number, duration: number | null, opts: TriggerOptions = {}): Voice | null {
    const p = this.params;
    const buffer = this.pool.buffer(p.sampleId, p.reverse);
    if (!buffer) return null;

    const rate = (p.keyTrack ? Math.pow(2, (key - p.rootKey) / 12) : 1) * Math.pow(2, p.fine / 1200);
    const startSec = Math.max(0, Math.min(0.999, p.start)) * buffer.duration;
    const offset = startSec + Math.max(0, opts.sampleOffset ?? 0);
    if (offset >= buffer.duration) return null;
    // Note fine pitch and the pitch curve (portamento, slides) detune the playback; the sample's end is
    // estimated at the lowest pitch reached so a bent note is never cut short.
    const fine = opts.fine ?? 0;
    const slowest = rate * Math.pow(2, (fine + 100 * minPitch(opts.pitch)) / 1200);

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    if (opts.pitch) schedulePitch(src.detune, t, fine, opts.pitch);
    else if (fine !== 0) src.detune.value = fine;
    const amp = this.ctx.createGain();
    amp.gain.value = 0;
    src.connect(amp);
    const nodes: AudioNode[] = [src, amp];
    const pan = Math.max(-1, Math.min(1, opts.pan ?? 0));
    if (Math.abs(pan) > NOTE_PAN_EPSILON) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = pan;
      amp.connect(panner);
      panner.connect(this.pannedOutput);
      nodes.push(panner);
    } else {
      amp.connect(this.output);
    }

    if (p.loop) {
      src.loop = true;
      src.loopStart = startSec;
      src.loopEnd = buffer.duration;
    }

    const peak = Math.max(0, Math.min(1, velocity));
    const env = { ...p.ampEnv, release: p.ampEnv.release * releaseScale(opts.release) };
    const gated = !p.oneShot || p.loop || opts.gate === true;
    const natural = p.loop ? Infinity : t + (buffer.duration - offset) / slowest;
    let end: number;
    if (gated) {
      end = Math.min(natural, scheduleEnvelope(amp.gain, env, t, 0, peak, duration));
    } else {
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(peak, t + Math.max(env.attack, 0.001));
      end = natural;
    }

    if (p.chokeGroup > 0) this.chokes.choke(`group:${p.chokeGroup}`, t);
    if (p.cutSelf) this.chokes.choke(`self:${this.channelId}`, t);

    src.start(t, offset);
    if (Number.isFinite(end)) src.stop(end + 0.01);

    const voice = new Voice(key, t, end, amp, [src], nodes, (at) =>
      gated ? Math.min(natural, releaseEnvelope(amp.gain, env, t, 0, peak, at)) : natural,
    );
    if (p.chokeGroup > 0) this.chokes.add(`group:${p.chokeGroup}`, voice);
    if (p.cutSelf) this.chokes.add(`self:${this.channelId}`, voice);
    this.voices.add(voice);
    voice.onEnd(() => this.voices.delete(voice));
    enforcePolyphony(this.voices, MAX_VOICES, t);
    return voice;
  }

  stopAll(at: number): void {
    for (const v of this.voices) v.kill(at);
  }

  dispose(): void {
    this.stopAll(this.ctx.currentTime);
    this.output.disconnect();
    this.pannedOutput.disconnect();
  }
}
