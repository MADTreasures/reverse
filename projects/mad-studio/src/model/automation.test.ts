import { describe, expect, it } from 'vitest';
import { AutomationRuntime } from '../audio/automationRuntime';
import {
  CURVE_MODES,
  compileAutomationLanes,
  curveShape,
  evaluateAutomation,
  flatAutomation,
  laneValueAt,
  linearizeAutomation,
  tensionForMid,
} from './automation';
import { applyTargetValue, describeTarget, fromNorm, targetValue, toNorm } from './automationTargets';
import { createAutomationChannel, createEmptyProject, createSynthChannel } from './defaults';
import { parseProject } from './serialization';
import type { AutomationPoint, Project } from './types';
import { produce } from 'immer';

const pt = (tick: number, value: number, mode: AutomationPoint['mode'] = 'single', tension = 0): AutomationPoint => ({ tick, value, mode, tension });

function withAutomation(project: Project, target: string, points: AutomationPoint[], clips: { start: number; length: number; offset?: number; track?: number }[]) {
  const ch = createAutomationChannel({ name: 'auto', target, value: 0, length: points[points.length - 1].tick });
  ch.automation.points = points;
  ch.automation.length = points[points.length - 1].tick;
  return produce(project, (d) => {
    d.channels.push(ch);
    clips.forEach((c, i) =>
      d.clips.push({ id: `ac${i}`, kind: 'automation', channelId: ch.id, trackId: d.tracks[c.track ?? 0].id, start: c.start, length: c.length, offset: c.offset ?? 0 }),
    );
  });
}

describe('curve shapes', () => {
  it('start at 0 and end at 1 for every mode and tension', () => {
    for (const { id } of CURVE_MODES) {
      for (const t of [-1, -0.4, 0, 0.6, 1]) {
        expect(curveShape(id, t, 0)).toBeCloseTo(0, 6);
        expect(curveShape(id, t, 1)).toBeCloseTo(1, 6);
      }
    }
  });

  it('single curve is linear at tension 0 and passes through the handle', () => {
    expect(curveShape('single', 0, 0.25)).toBeCloseTo(0.25);
    for (const mid of [0.1, 0.3, 0.5, 0.8]) expect(curveShape('single', tensionForMid(mid), 0.5)).toBeCloseTo(mid, 3);
    // Positive tension starts slowly.
    expect(curveShape('single', 0.8, 0.5)).toBeLessThan(0.2);
  });

  it('hold jumps at the end, stairs step evenly', () => {
    expect(curveShape('hold', 0, 0.99)).toBe(0);
    const n = 4;
    const t = ((n - 1) / 31) * 2 - 1; // tension that gives 4 steps
    expect(curveShape('stairs', t, 0.3)).toBeCloseTo(0.25);
    expect(curveShape('stairs', t, 0.6)).toBeCloseTo(0.5);
  });
});

describe('automation evaluation', () => {
  const data = { points: [pt(0, 0.2), pt(96, 1), pt(192, 0, 'hold')] };

  it('interpolates and holds outside the points', () => {
    expect(evaluateAutomation(data, -10)).toBeCloseTo(0.2);
    expect(evaluateAutomation(data, 48)).toBeCloseTo(0.6);
    expect(evaluateAutomation(data, 150)).toBeCloseTo(1); // hold segment keeps the previous value
    expect(evaluateAutomation(data, 192)).toBeCloseTo(0);
    expect(evaluateAutomation(data, 500)).toBeCloseTo(0);
  });

  it('linearizes curves so linear interpolation stays close to the curve', () => {
    const curved = { points: [pt(0, 0), pt(384, 1, 'single', 0.7)] };
    const lin = linearizeAutomation(curved, 0, 384);
    const lane = { target: 'x', points: lin };
    for (let t = 0; t <= 384; t += 7) expect(laneValueAt(lane, t)).toBeCloseTo(evaluateAutomation(curved, t), 2);
  });
});

describe('lanes from playlist clips', () => {
  const base = createEmptyProject();
  const target = `ch:${base.channels[0].id}:volume`;

  it('places clip data at the clip position and honours the offset', () => {
    const p = withAutomation(base, target, [pt(0, 0), pt(384, 1)], [{ start: 768, length: 192, offset: 192 }]);
    const [lane] = compileAutomationLanes(p);
    expect(lane.target).toBe(target);
    expect(laneValueAt(lane, 700)).toBeNull();
    expect(laneValueAt(lane, 768)).toBeCloseTo(0.5);
    expect(laneValueAt(lane, 768 + 96)).toBeCloseTo(0.75);
    expect(laneValueAt(lane, 5000)).toBeCloseTo(1);
  });

  it('holds the last value between clips and lets the later clip win', () => {
    const p = withAutomation(base, target, [pt(0, 0), pt(96, 1)], [
      { start: 0, length: 96 },
      { start: 384, length: 96 },
    ]);
    const [lane] = compileAutomationLanes(p);
    expect(laneValueAt(lane, 200)).toBeCloseTo(1);
    expect(laneValueAt(lane, 383)).toBeCloseTo(1);
    expect(laneValueAt(lane, 384)).toBeCloseTo(0);
  });

  it('ignores clips on muted tracks', () => {
    const p = produce(withAutomation(base, target, [pt(0, 0), pt(96, 1)], [{ start: 0, length: 96 }]), (d) => {
      d.tracks[0].muted = true;
    });
    expect(compileAutomationLanes(p)).toHaveLength(0);
  });
});

describe('targets', () => {
  const synth = createSynthChannel({ name: 'Lead' });
  const project = produce(createEmptyProject(), (d) => {
    d.channels.push(synth);
  });

  it('describes, reads and writes channel, synth, effect and project targets', () => {
    const vol = describeTarget(project, `ch:${synth.id}:volume`);
    expect(vol?.label).toBe('Lead - Channel volume');
    const cutoff = describeTarget(project, `ch:${synth.id}:synth.filter.cutoff`)!;
    expect(cutoff.curve).toBe('log');
    expect(fromNorm(cutoff, toNorm(cutoff, 1000))).toBeCloseTo(1000, 3);
    const limiter = project.mixer[0].effects[0];
    expect(describeTarget(project, `fx:${limiter.id}:ceiling`)?.label).toBe('Master - Limiter - Ceiling');
    expect(describeTarget(project, 'proj:bpm')?.label).toBe('Main tempo');
    expect(describeTarget(project, 'ch:missing:volume')).toBeNull();

    const next = produce(project, (d) => {
      applyTargetValue(d, `ch:${synth.id}:synth.filter.cutoff`, 1234);
      applyTargetValue(d, `fx:${limiter.id}:ceiling`, -3);
      applyTargetValue(d, 'proj:bpm', 99);
    });
    expect(targetValue(next, `ch:${synth.id}:synth.filter.cutoff`)).toBe(1234);
    expect(targetValue(next, `fx:${limiter.id}:ceiling`)).toBe(-3);
    expect(next.bpm).toBe(99);
  });
});

describe('automation runtime', () => {
  it('overrides while playing and keeps the value until the control changes', () => {
    const base = createEmptyProject();
    const id = base.channels[1].id;
    const target = `ch:${id}:volume`;
    const p = withAutomation(base, target, [pt(0, 0), pt(384, 1)], [{ start: 0, length: 384 }]);
    const rt = new AutomationRuntime();
    expect(rt.update(p, 192)).toBe(true);
    expect(rt.value(target)).toBeCloseTo(0.5);
    expect(rt.apply(p).channels[1].volume).toBeCloseTo(0.5);
    // Unrelated edit: override stays.
    const renamed = produce(p, (d) => {
      d.name = 'x';
    });
    expect(rt.reconcile(renamed)).toBe(false);
    // The user moves the knob: override goes away.
    const moved = produce(p, (d) => {
      d.channels[1].volume = 0.3;
    });
    expect(rt.reconcile(moved)).toBe(true);
    expect(rt.value(target)).toBeUndefined();
  });

  it('converts lanes to target units for the native engine', () => {
    const p = withAutomation(createEmptyProject(), 'proj:bpm', [pt(0, 0), pt(96, 1)], [{ start: 0, length: 96 }]);
    const [lane] = new AutomationRuntime().unitLanes(p);
    expect(lane.points[0]).toEqual([0, 60]);
    expect(lane.points[lane.points.length - 1][1]).toBeCloseTo(200);
  });
});

describe('serialization of v2 data', () => {
  it('round-trips automation, plugins and recording fields and still reads v1 files', () => {
    const base = createEmptyProject();
    const target = `ch:${base.channels[0].id}:pan`;
    const p = produce(withAutomation(base, target, [pt(0, 0.5), pt(96, 1, 'wave', 0.3)], [{ start: 0, length: 96 }]), (d) => {
      d.mixer[1].input = 'stereo:0';
      d.mixer[1].armed = true;
      d.mixer[2].effects.push({
        id: 'fx_p',
        type: 'plugin',
        enabled: true,
        params: {},
        plugin: { uid: 'VST3-x', name: 'Valhalla', vendor: 'V', format: 'VST3', fileOrIdentifier: '/a.vst3', isInstrument: false, state: 'AAAA' },
      });
      d.channels.push({
        id: 'ch_plug',
        kind: 'plugin',
        name: 'Synth',
        color: '#fff',
        volume: 0.8,
        pan: 0,
        muted: false,
        mixerTrack: 3,
        plugin: { uid: 'VST3-y', name: 'Synth', vendor: 'S', format: 'VST3', fileOrIdentifier: '/b.vst3', isInstrument: true, state: null },
      });
    });
    const back = parseProject(JSON.parse(JSON.stringify(p)));
    expect(back).toEqual(p);

    const v1 = JSON.parse(JSON.stringify(createEmptyProject()));
    v1.version = 1;
    for (const t of v1.mixer) {
      delete t.input;
      delete t.armed;
    }
    const upgraded = parseProject(v1);
    expect(upgraded.version).toBe(2);
    expect(upgraded.mixer[1].input).toBeNull();
    expect(upgraded.mixer[1].armed).toBe(false);
  });

  it('starts new clips as a flat line', () => {
    expect(flatAutomation(0.7, 384)).toEqual([pt(0, 0.7), pt(384, 0.7)]);
  });
});
