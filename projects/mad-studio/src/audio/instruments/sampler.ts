import type { SamplerChannel, SamplerParams } from '../../model/types';
import { releaseEnvelope, scheduleEnvelope } from '../envelope';
import type { SamplePool } from '../samplePool';
import { ChokeManager, Voice, enforcePolyphony, type Instrument, type TriggerOptions } from './voice';

const MAX_VOICES = 32;

/** Pitch-shifting sample player with one-shot, loop, reverse and choke groups. */
export class SamplerInstrument implements Instrument {
  readonly output: GainNode;
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
    this.update(channel);
  }

  update(channel: SamplerChannel): void {
    this.params = channel.sampler;
    this.output.gain.setTargetAtTime(this.params.gain, this.ctx.currentTime, 0.01);
  }

  trigger(key: number, velocity: number, t: number, duration: number | null, opts: TriggerOptions = {}): Voice | null {
    const p = this.params;
    const buffer = this.pool.buffer(p.sampleId, p.reverse);
    if (!buffer) return null;

    const rate = (p.keyTrack ? Math.pow(2, (key - p.rootKey) / 12) : 1) * Math.pow(2, p.fine / 1200);
    const startSec = Math.max(0, Math.min(0.999, p.start)) * buffer.duration;
    const offset = startSec + Math.max(0, opts.sampleOffset ?? 0);
    if (offset >= buffer.duration) return null;

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const amp = this.ctx.createGain();
    amp.gain.value = 0;
    src.connect(amp);
    amp.connect(this.output);

    if (p.loop) {
      src.loop = true;
      src.loopStart = startSec;
      src.loopEnd = buffer.duration;
    }

    const peak = Math.max(0, Math.min(1, velocity));
    const env = { ...p.ampEnv };
    const gated = !p.oneShot || p.loop || opts.gate === true;
    const natural = p.loop ? Infinity : t + (buffer.duration - offset) / rate;
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

    const voice = new Voice(key, t, end, amp, [src], [src, amp], (at) =>
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
  }
}
