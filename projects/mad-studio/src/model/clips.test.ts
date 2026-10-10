import { describe, expect, it } from 'vitest';
import { processVariant, resample, timeStretch } from '../audio/clipVariants';
import { detectOnsets } from '../ui/playlist/audioClipTools';
import { FADE_CURVE_POINTS, clipFades, clipGain, clipVariant, fadeCurve, fadeShape, parseVariantSampleId, variantSampleId } from './clips';
import { createEmptyProject, createFactoryChannel } from './defaults';
import { parseProject } from './serialization';
import { songTimeline } from './timeline';
import type { AudioClip } from './types';

/** Upward zero crossings per second. */
function frequency(data: Float32Array, rate: number, from = 0, to = data.length): number {
  let n = 0;
  for (let i = from + 1; i < to; i++) if (data[i - 1] < 0 && data[i] >= 0) n++;
  return (n * rate) / (to - from);
}

const sine = (hz: number, seconds: number, rate: number) => Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / rate));

function rms(data: Float32Array, from: number, to: number): number {
  let s = 0;
  for (let i = from; i < to; i++) s += data[i] * data[i];
  return Math.sqrt(s / (to - from));
}

describe('audio clip properties', () => {
  it('maps the gain handle to a linear gain (-96 dB = silent)', () => {
    expect(clipGain(undefined)).toBe(1);
    expect(clipGain(-6.0206)).toBeCloseTo(0.5, 4);
    expect(clipGain(-96)).toBe(0);
    expect(clipGain(36)).toBeCloseTo(63.0957, 3);
  });

  it('shapes fades: linear at tension 0, slow or fast starts otherwise', () => {
    expect(fadeShape(0.5, 0)).toBe(0.5);
    expect(fadeShape(0.5, 1)).toBeCloseTo(0.0625, 6);
    expect(fadeShape(0.5, -1)).toBeCloseTo(0.9375, 6);
    expect(fadeShape(0, 0.3)).toBe(0);
    expect(fadeShape(1, -0.7)).toBe(1);
    const fin = fadeCurve('in', 0, 0.5);
    const fout = fadeCurve('out', 0);
    expect(fin).toHaveLength(FADE_CURVE_POINTS);
    expect(fin[0]).toBe(0);
    expect(fin[FADE_CURVE_POINTS - 1]).toBe(0.5);
    expect(fout[0]).toBe(1);
    expect(fout[FADE_CURVE_POINTS - 1]).toBe(0);
  });

  it('scales overlapping fades down to the clip length', () => {
    expect(clipFades({ length: 100, fadeIn: 30, fadeOut: 20 })).toEqual({ fadeIn: 30, fadeOut: 20 });
    expect(clipFades({ length: 100, fadeIn: 150, fadeOut: 50 })).toEqual({ fadeIn: 75, fadeOut: 25 });
  });

  it('names sample variants after their processing and parses them back', () => {
    expect(clipVariant({})).toBeNull();
    expect(clipVariant({ stretch: 1, pitch: 0, fine: 0, reverse: false })).toBeNull();
    const v = clipVariant({ stretch: 1.5, pitch: -2, fine: 15, reverse: true })!;
    expect(v).toEqual({ stretch: 1.5, cents: -185, reverse: true });
    const id = variantSampleId('factory:kick_punch', v);
    expect(id).toBe('factory:kick_punch~x1.5c-185r');
    expect(parseVariantSampleId(id)).toEqual({ sampleId: 'factory:kick_punch', variant: v });
    expect(parseVariantSampleId('factory:kick_punch')).toBeNull();
  });

  it('puts the instance properties into the song timeline', () => {
    const project = createEmptyProject();
    const ch = createFactoryChannel('kick_punch');
    ch.kind === 'sampler' && (ch.audioClip = true);
    project.channels = [ch];
    const clip: AudioClip = {
      id: 'c1', kind: 'audio', trackId: project.tracks[0].id, channelId: ch.id, start: 96, length: 192, offset: 24,
      gain: -6, fadeIn: 48, fadeOut: 300, fadeInTension: 0.5, pitch: 3, reverse: true,
    };
    project.clips = [clip];
    const [ev] = songTimeline(project).events;
    expect(ev.audioClip).toBe(true);
    expect(ev.sample).toBe('factory:kick_punch~x1c300r');
    expect(ev.clipGain).toBeCloseTo(0.5012, 4);
    expect(ev.fadeIn).toBeCloseTo(192 * (48 / 348), 6);
    expect(ev.fadeOut).toBeCloseTo(192 * (300 / 348), 6);
    expect(ev.fadeInTension).toBe(0.5);
    expect(ev.fadeOutTension).toBeUndefined();
  });

  it('reads and cleans clip properties from project files', () => {
    const project = createEmptyProject();
    const ch = createFactoryChannel('kick_punch');
    project.channels = [ch];
    project.clips = [{ id: 'c1', kind: 'audio', trackId: project.tracks[0].id, channelId: ch.id, start: 0, length: 96, offset: 0 }];
    const raw = JSON.parse(JSON.stringify(project));
    Object.assign(raw.clips[0], { gain: 99, fadeIn: 12.4, pitch: 40, fine: 0, stretch: 1, reverse: 'yes', fadeOutTension: -3 });
    const clip = parseProject(raw).clips[0] as AudioClip;
    expect(clip.gain).toBe(36);
    expect(clip.fadeIn).toBe(12);
    expect(clip.pitch).toBe(24);
    expect(clip.fadeOutTension).toBe(-1);
    expect('fine' in clip || 'stretch' in clip || 'reverse' in clip).toBe(false);
  });
});

describe('sample variants', () => {
  const rate = 44100;

  it('time-stretches without changing the pitch', () => {
    const src = sine(440, 1, rate);
    for (const factor of [0.5, 1.5, 2]) {
      const [out] = timeStretch([src], rate, factor);
      expect(out.length).toBe(Math.round(src.length * factor));
      expect(frequency(out, rate, 4410, out.length - 4410)).toBeCloseTo(440, -1);
      expect(rms(out, 4410, out.length - 4410)).toBeGreaterThan(0.3);
    }
  });

  it('resamples: shorter and higher', () => {
    const [out] = resample([sine(440, 1, rate)], 2);
    expect(out.length).toBe(rate / 2);
    expect(frequency(out, rate)).toBeCloseTo(880, -1);
  });

  it('pitch-shifts at the same length, stretches and reverses', () => {
    const src = sine(440, 1, rate);
    const [up] = processVariant([src], rate, { stretch: 1, cents: 1200, reverse: false });
    expect(Math.abs(up.length - src.length)).toBeLessThanOrEqual(1);
    expect(frequency(up, rate, 4410, up.length - 4410)).toBeCloseTo(880, -1);
    const [long] = processVariant([src], rate, { stretch: 2, cents: -1200, reverse: false });
    expect(Math.abs(long.length - 2 * src.length)).toBeLessThanOrEqual(2);
    expect(frequency(long, rate, 8820, long.length - 8820)).toBeCloseTo(220, -1);
    const ramp = Float32Array.from({ length: 100 }, (_, i) => i / 100);
    const [rev] = processVariant([ramp], rate, { stretch: 1, cents: 0, reverse: true });
    expect(rev[0]).toBeCloseTo(0.99, 6);
    expect(rev[99]).toBe(0);
    expect(ramp[0]).toBe(0); // the source stays untouched
  });

  it('finds beats for Chop', () => {
    const data = new Float32Array(rate * 2);
    for (const at of [0.25, 0.75, 1.25, 1.5]) for (let i = 0; i < 2000; i++) data[Math.round(at * rate) + i] = 0.8 * Math.exp(-i / 400) * Math.sin(i * 0.3);
    const onsets = detectOnsets([data], rate, 0, data.length, 'medium');
    expect(onsets.map((t) => Math.round(t * 100) / 100)).toEqual([0.25, 0.75, 1.25, 1.5]);
    expect(detectOnsets([data], rate, Math.round(0.5 * rate), data.length, 'medium')).toHaveLength(3);
  });
});
