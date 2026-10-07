import { describe, expect, it } from 'vitest';
import { factorySampleKeys, generateFactorySample } from './factorySamples';
import { envelopeValue } from './envelope';
import { makeImpulseResponse } from './effects/effects';
import { Scheduler, swingOffsetTicks, type SchedulerHost } from './scheduler';
import { encodeWav, signalStats } from './wav';
import type { SequencedEvent, Timeline } from '../model/timeline';
import { PPQ, TICKS_PER_STEP } from '../model/timing';

function ev(tick: number): SequencedEvent {
  return { tick, length: TICKS_PER_STEP, channelId: 'c', key: 60, velocity: 1 };
}

function fakeHost(timeline: Timeline, bpm = 120) {
  const state = { now: 0, bpm, swing: 0 };
  const fired: { tick: number; time: number }[] = [];
  const beats: { beat: number; bar: boolean; time: number }[] = [];
  const host: SchedulerHost = {
    now: () => state.now,
    timeline: () => timeline,
    bpm: () => state.bpm,
    swing: () => state.swing,
    beatsPerBar: () => 4,
    onEvent: (e, time) => fired.push({ tick: e.tick, time }),
    onBeat: (beat, bar, time) => beats.push({ beat, bar, time }),
  };
  return { host, state, fired, beats };
}

describe('scheduler', () => {
  const bar = PPQ * 4; // 2 s at 120 BPM
  const timeline: Timeline = { events: [ev(0), ev(PPQ), ev(PPQ * 2), ev(PPQ * 3)], start: 0, end: bar };

  it('schedules events inside the look-ahead window at exact times', () => {
    const { host, state, fired } = fakeHost(timeline);
    const s = new Scheduler(host);
    s.start(0, 0.1);
    expect(fired.map((f) => f.time)).toEqual([0.1]);
    state.now = 0.5;
    s.pump();
    expect(fired.map((f) => f.time)).toEqual([0.1, 0.6]);
    state.now = 1.0;
    s.pump();
    expect(fired.map((f) => f.time)).toEqual([0.1, 0.6, 1.1]);
  });

  it('never schedules an event twice and wraps around the loop', () => {
    const { host, state, fired } = fakeHost(timeline);
    const s = new Scheduler(host);
    s.start(0, 0);
    for (let t = 0; t <= 4.2; t += 0.02) {
      state.now = t;
      s.pump();
    }
    const times = fired.map((f) => Number(f.time.toFixed(6)));
    expect(times).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]);
  });

  it('reports the playhead position across loop wraps', () => {
    const { host, state } = fakeHost(timeline);
    const s = new Scheduler(host);
    s.start(0, 0);
    for (let t = 0; t <= 2.3; t += 0.02) {
      state.now = t;
      s.pump();
    }
    expect(s.positionAt(1)).toBeCloseTo(PPQ * 2);
    expect(s.positionAt(2.25)).toBeCloseTo(PPQ * 0.5);
  });

  it('keeps continuity when the tempo changes', () => {
    const { host, state, fired } = fakeHost(timeline);
    const s = new Scheduler(host);
    s.start(0, 0);
    state.now = 0.3;
    s.pump(); // scheduled up to 0.42 s (= tick ~80) at 120 BPM
    state.bpm = 60;
    state.now = 0.5;
    s.pump();
    state.now = 1.5;
    s.pump();
    // The frontier was 0.42 s = tick 80.64 at 120 BPM; the rest of beat 2 runs at 60 BPM (1/96 s per tick).
    const frontierTick = 0.42 * ((120 * PPQ) / 60);
    const second = fired.find((f) => f.tick === PPQ)!;
    expect(second.time).toBeCloseTo(0.42 + (PPQ - frontierTick) / PPQ, 5);
  });

  it('emits metronome beats with bar accents', () => {
    const { host, state, beats } = fakeHost(timeline);
    const s = new Scheduler(host);
    s.start(0, 0);
    for (let t = 0; t <= 2.1; t += 0.02) {
      state.now = t;
      s.pump();
    }
    expect(beats.slice(0, 5).map((b) => b.bar)).toEqual([true, false, false, false, true]);
  });

  it('delays every second 16th by the swing amount', () => {
    expect(swingOffsetTicks(0, 1)).toBe(0);
    expect(swingOffsetTicks(TICKS_PER_STEP, 1)).toBe(TICKS_PER_STEP / 2);
    expect(swingOffsetTicks(TICKS_PER_STEP * 3, 0.5)).toBe(TICKS_PER_STEP / 4);
    expect(swingOffsetTicks(TICKS_PER_STEP * 2, 1)).toBe(0);
  });
});

describe('wav encoder', () => {
  it('writes a valid 16-bit stereo header and samples', () => {
    const left = new Float32Array([0, 0.5, -0.5, 1]);
    const right = new Float32Array([0, -1, 0.25, 0]);
    const bytes = encodeWav([left, right], 44100, 16);
    const view = new DataView(bytes.buffer);
    const str = (o: number) => String.fromCharCode(...bytes.slice(o, o + 4));
    expect(str(0)).toBe('RIFF');
    expect(str(8)).toBe('WAVE');
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(40, true)).toBe(4 * 2 * 2);
    expect(bytes.length).toBe(44 + 16);
    expect(view.getInt16(44 + 4 * 1 + 2, true)).toBeLessThanOrEqual(-32766); // right[1] = -1
    expect(Math.abs(view.getInt16(44 + 4 * 1, true) - 16384)).toBeLessThanOrEqual(2);
  });

  it('writes 32-bit float samples exactly', () => {
    const bytes = encodeWav([new Float32Array([0.123, -0.75])], 48000, 32);
    const view = new DataView(bytes.buffer);
    expect(view.getUint16(20, true)).toBe(3);
    expect(view.getFloat32(44, true)).toBeCloseTo(0.123, 6);
    expect(view.getFloat32(48, true)).toBeCloseTo(-0.75, 6);
  });

  it('computes signal statistics', () => {
    const stats = signalStats([new Float32Array([0.5, -1, NaN])]);
    expect(stats.peak).toBe(1);
    expect(stats.nonFinite).toBe(1);
  });
});

describe('factory sounds', () => {
  it('generates every built-in sound deterministically and within range', () => {
    for (const key of factorySampleKeys()) {
      const a = generateFactorySample(key, 44100);
      const b = generateFactorySample(key, 44100);
      const stats = signalStats([a]);
      expect(stats.nonFinite, key).toBe(0);
      expect(stats.peak, key).toBeGreaterThan(0.3);
      expect(stats.peak, key).toBeLessThanOrEqual(0.951);
      expect(a.length).toBe(b.length);
      expect(a[1000]).toBe(b[1000]);
      expect(Math.abs(a[a.length - 1]), `${key} ends silently`).toBeLessThan(0.01);
    }
  });
});

describe('envelopes and reverb', () => {
  it('follows attack, decay and sustain', () => {
    const env = { attack: 0.1, decay: 0.4, sustain: 0.5, release: 0.2 };
    expect(envelopeValue(env, 0, 1, 0.05)).toBeCloseTo(0.5);
    expect(envelopeValue(env, 0, 1, 0.1)).toBeCloseTo(1);
    expect(envelopeValue(env, 0, 1, 2)).toBeCloseTo(0.5, 3);
  });

  it('builds a decaying stereo impulse response', () => {
    const [l, r] = makeImpulseResponse(8000, 1, 0.5);
    expect(l.length).toBe(r.length);
    const early = signalStats([l.slice(0, 800)]).rms;
    const late = signalStats([l.slice(l.length - 800)]).rms;
    expect(late).toBeLessThan(early * 0.05);
  });
});
