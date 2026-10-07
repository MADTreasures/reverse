import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './defaults';
import { createDemoProject } from './demo';
import { packProject, parseProject, safeFileName, unpackProject } from './serialization';
import { songTimeline } from './timeline';

describe('project files', () => {
  it('round-trips a project with user samples through the zip bundle', () => {
    const project = createDemoProject();
    project.samples['smp_user1'] = { id: 'smp_user1', name: 'Vocal', source: 'user', fileName: 'vocal.wav' };
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const packed = packProject(project, [{ id: 'smp_user1', fileName: 'vocal.wav', bytes }]);
    const { project: loaded, samples } = unpackProject(packed);
    expect(loaded).toEqual(project);
    expect(samples).toHaveLength(1);
    expect([...samples[0].bytes]).toEqual([1, 2, 3, 4, 5]);
  });

  it('accepts plain JSON', () => {
    const project = createEmptyProject();
    const json = new TextEncoder().encode(JSON.stringify(project));
    expect(unpackProject(json).project).toEqual(project);
  });

  it('repairs invalid data instead of crashing', () => {
    const p = parseProject({
      bpm: 'fast',
      channels: [{ kind: 'synth', id: 'a', volume: 5 }, { kind: 'bogus' }, null],
      patterns: [{ id: 'p', notes: { a: [{ start: 0, length: 24 }, { start: -1, length: 4 }], ghost: [{ start: 0, length: 1 }] } }],
      clips: [{ kind: 'pattern', patternId: 'missing', trackId: 'x' }],
      mixer: [],
    });
    expect(p.bpm).toBe(130);
    expect(p.channels).toHaveLength(1);
    expect(p.channels[0].volume).toBe(1);
    expect(p.patterns[0].notes.a).toHaveLength(1);
    expect(p.patterns[0].notes.ghost).toBeUndefined();
    expect(p.clips).toHaveLength(0);
    expect(p.mixer).toHaveLength(1);
    expect(p.tracks.length).toBeGreaterThan(0);
  });

  it('rejects files that are not projects', () => {
    expect(() => unpackProject(new Uint8Array([0, 1, 2, 3]))).toThrow();
    expect(() => parseProject({ format: 'other' })).toThrow();
  });

  it('sanitises sample file names', () => {
    expect(safeFileName('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(safeFileName('')).toBe('sample.wav');
  });
});

describe('demo project', () => {
  it('survives validation unchanged and produces a 16 bar song', () => {
    const demo = createDemoProject();
    expect(parseProject(JSON.parse(JSON.stringify(demo)))).toEqual(demo);
    const tl = songTimeline(demo);
    expect(tl.end).toBe(16 * 384);
    expect(tl.events.length).toBeGreaterThan(300);
    const channelsUsed = new Set(tl.events.map((e) => e.channelId));
    expect(channelsUsed.size).toBe(demo.channels.length);
  });
});
