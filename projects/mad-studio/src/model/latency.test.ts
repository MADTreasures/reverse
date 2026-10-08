import { describe, expect, it } from 'vitest';
import { parseLatencyReport } from '../plugins/pluginStore';
import { createEmptyProject } from './defaults';
import {
  MAX_PLUGIN_LATENCY_OFFSET,
  beatsToMs,
  clampPluginOffset,
  clampTrackOffset,
  formatLatency,
  formatMs,
  formatOffsetMs,
  msToBeats,
  msToSamples,
  samplesToMs,
  wheelStepMs,
} from './latency';
import { parseProject } from './serialization';

describe('plugin delay compensation helpers', () => {
  it('converts between samples, ms and beats', () => {
    expect(samplesToMs(1000, 48000)).toBeCloseTo(20.8333, 3);
    expect(msToSamples(10, 48000)).toBe(480);
    expect(msToSamples(samplesToMs(1, 44100), 44100)).toBe(1);
    expect(beatsToMs(1, 120)).toBe(500);
    expect(msToBeats(250, 120)).toBe(0.5);
    expect(samplesToMs(100, 0)).toBe(0);
  });

  it('formats latencies like the mixer shows them', () => {
    expect(formatMs(20.8333)).toBe('20.8 ms');
    expect(formatMs(123.4)).toBe('123 ms');
    expect(formatMs(-0.01)).toBe('0 ms');
    expect(formatOffsetMs(10)).toBe('+10 ms');
    expect(formatOffsetMs(-2.5)).toBe('−2.5 ms');
    expect(formatOffsetMs(0.01)).toBe('0 ms');
    expect(formatLatency(1000, 48000)).toBe('20.8 ms (1000 samples)');
    expect(formatLatency(1, 48000)).toBe('0 ms (1 sample)');
  });

  it('clamps offsets to what the engine accepts', () => {
    expect(clampTrackOffset(5000)).toBe(1000);
    expect(clampTrackOffset(-5000)).toBe(-1000);
    expect(clampTrackOffset(Number.NaN)).toBe(0);
    expect(clampPluginOffset(12.6)).toBe(13);
    expect(clampPluginOffset(1e9)).toBe(MAX_PLUGIN_LATENCY_OFFSET);
  });

  it('steps by 10 ms, 1 ms with Ctrl/Cmd and one sample with Ctrl/Cmd+Alt (FL Studio)', () => {
    const wheel = (deltaY: number, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) =>
      wheelStepMs({ deltaY, ctrlKey: false, metaKey: false, altKey: false, ...mods }, 48000);
    expect(wheel(-1)).toBe(10);
    expect(wheel(1)).toBe(-10);
    expect(wheel(-1, { ctrlKey: true })).toBe(1);
    expect(wheel(1, { metaKey: true })).toBe(-1);
    expect(wheel(-1, { ctrlKey: true, altKey: true })).toBeCloseTo(1000 / 48000, 9);
  });
});

describe('PDC project fields', () => {
  it('defaults: automatic PDC with compensated automation, no manual offsets', () => {
    const p = createEmptyProject();
    expect(p.pdc).toBe(true);
    expect(p.pdcAutomation).toBe(true);
    expect(p.mixer.every((t) => t.latencyOffset === 0)).toBe(true);
  });

  it('older project files load with the defaults', () => {
    const old = JSON.parse(JSON.stringify(createEmptyProject()));
    delete old.pdc;
    delete old.pdcAutomation;
    for (const t of old.mixer) delete t.latencyOffset;
    const p = parseProject(old);
    expect(p.pdc).toBe(true);
    expect(p.pdcAutomation).toBe(true);
    expect(p.mixer.every((t) => t.latencyOffset === 0)).toBe(true);
  });

  it('keeps and clamps the settings', () => {
    const raw = JSON.parse(JSON.stringify(createEmptyProject()));
    raw.pdc = false;
    raw.pdcAutomation = false;
    raw.mixer[1].latencyOffset = 12.5;
    raw.mixer[2].latencyOffset = -99999;
    raw.mixer[3].latencyOffset = 'soon';
    const plugin = { uid: 'VST3-x', name: 'Lat', vendor: 'V', format: 'VST3', fileOrIdentifier: '/x.vst3', isInstrument: false, state: null };
    raw.mixer[1].effects = [
      { id: 'fx_a', type: 'plugin', enabled: true, params: {}, plugin: { ...plugin, latencyOffset: 200.4 } },
      { id: 'fx_b', type: 'plugin', enabled: true, params: {}, plugin: { ...plugin, latencyOffset: 0 } },
    ];
    const p = parseProject(raw);
    expect(p.pdc).toBe(false);
    expect(p.pdcAutomation).toBe(false);
    expect(p.mixer.slice(1, 4).map((t) => t.latencyOffset)).toEqual([12.5, -1000, 0]);
    expect(p.mixer[1].effects[0].plugin?.latencyOffset).toBe(200);
    expect(p.mixer[1].effects[1].plugin).not.toHaveProperty('latencyOffset');
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
});

describe('engine latency report', () => {
  it('parses the latency event', () => {
    const r = parseLatencyReport({
      type: 'latency',
      automatic: true,
      automations: false,
      total: 1000,
      sampleRate: 44100,
      tracks: [{ latency: 1000, delay: 0 }, { latency: 0, delay: 1000 }, null],
      plugins: { 'fx:fx_1': { reported: 1000, offset: -5 } },
    });
    expect(r).toEqual({
      automatic: true,
      automations: false,
      total: 1000,
      sampleRate: 44100,
      tracks: [{ latency: 1000, delay: 0 }, { latency: 0, delay: 1000 }, { latency: 0, delay: 0 }],
      plugins: { 'fx:fx_1': { reported: 1000, offset: -5 } },
    });
    expect(parseLatencyReport({ type: 'latency' })).toMatchObject({ automatic: true, total: 0, sampleRate: 48000, tracks: [], plugins: {} });
  });
});
