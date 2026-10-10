import { describe, expect, it } from 'vitest';
import { createEmptyProject, createMixerTrack } from './defaults';
import { DEFAULT_SEND, audibleTracks, processingOrder, routedNeighbours, sanitizeRoutes, sidechainSources, trackRoutes, wouldCycle } from './routing';
import { parseProject } from './serialization';
import type { MixerRoute, MixerTrack } from './types';

/** Master plus `inserts` tracks; `routes[i]` sets the routes of insert i. */
function mixer(inserts: number, routes: Record<number, MixerRoute[]> = {}): MixerTrack[] {
  const m = Array.from({ length: inserts + 1 }, (_, i) => createMixerTrack(i));
  for (const [i, r] of Object.entries(routes)) m[Number(i)].routes = r;
  return m;
}

describe('mixer routing', () => {
  it('sends every insert to the master at unity unless it has routes', () => {
    const m = mixer(2, { 2: [{ to: 1, level: 0.5 }] });
    expect(trackRoutes(m, 0)).toEqual([]);
    expect(trackRoutes(m, 1)).toEqual([{ to: 0, level: DEFAULT_SEND }]);
    expect(trackRoutes(m, 2)).toEqual([{ to: 1, level: 0.5 }]);
  });

  it('detects feedback loops, sidechain links included', () => {
    const m = mixer(3, { 1: [{ to: 2, level: 0.8 }], 2: [{ to: 3, level: 0, sidechain: true }] });
    expect(wouldCycle(m, 1, 1)).toBe(true);
    expect(wouldCycle(m, 2, 1)).toBe(true);
    expect(wouldCycle(m, 3, 1)).toBe(true);
    expect(wouldCycle(m, 1, 3)).toBe(false);
    expect(wouldCycle(m, 3, 0)).toBe(false);
  });

  it('processes senders before their targets and the master last', () => {
    expect(processingOrder(mixer(3))).toEqual([1, 2, 3, 0]);
    expect(processingOrder(mixer(3, { 3: [{ to: 1, level: 0.8 }] }))).toEqual([2, 3, 1, 0]);
    expect(processingOrder(mixer(3, { 1: [{ to: 2, level: 0.8 }], 3: [{ to: 1, level: 0.8 }] }))).toEqual([3, 1, 2, 0]);
  });

  it('sanitizes routes: valid, unique, loop-free, clamped; the default is not stored', () => {
    const m = mixer(3, {
      1: [
        { to: 2, level: 3 },
        { to: 2, level: 0.1 },
        { to: 1, level: 0.8 },
        { to: 9, level: 0.8 },
      ],
      2: [{ to: 1, level: 0.8 }, { to: 0, level: 0.8 }],
      3: [{ to: 0, level: DEFAULT_SEND }],
    });
    m[0].routes = [{ to: 1, level: 0.8 }];
    sanitizeRoutes(m);
    expect(m[0].routes).toBeUndefined();
    expect(m[1].routes).toEqual([{ to: 2, level: 1 }]);
    expect(m[2].routes).toBeUndefined(); // 2 -> 1 would close a loop; only the default master send is left
    expect(m[3].routes).toBeUndefined();
  });

  it('round-trips routes through the project file', () => {
    const project = createEmptyProject();
    while (project.mixer.length < 4) project.mixer.push(createMixerTrack(project.mixer.length));
    project.mixer[1].routes = [{ to: 2, level: 0, sidechain: true }, { to: 0, level: 0.8 }];
    project.mixer[2].routes = [{ to: 1, level: 0.8 }];
    const loaded = parseProject(JSON.parse(JSON.stringify(project)));
    expect(loaded.mixer[1].routes).toEqual([{ to: 2, level: 0, sidechain: true }, { to: 0, level: 0.8 }]);
    expect(loaded.mixer[2].routes).toEqual([]); // the loop back to insert 1 was dropped
    expect(sidechainSources(loaded.mixer, 2)).toEqual([1]);
  });

  it('keeps the tracks a soloed track plays through audible', () => {
    expect(audibleTracks(mixer(3))).toEqual([true, true, true, true]);
    const m = mixer(4, { 1: [{ to: 2, level: 0.8 }], 3: [{ to: 2, level: 0, sidechain: true }] });
    m[1].solo = true;
    expect(audibleTracks(m)).toEqual([true, true, true, false, false]);
    m[1].solo = false;
    m[3].solo = true;
    expect(audibleTracks(m)).toEqual([true, false, false, true, false]); // a level-0 sidechain link carries no audio
  });

  it('finds the tracks routed to and from a track', () => {
    const m = mixer(4, { 1: [{ to: 2, level: 0.8 }], 2: [{ to: 4, level: 0.8 }, { to: 0, level: 0.8 }], 3: [{ to: 2, level: 0, sidechain: true }] });
    expect(routedNeighbours(m, 2)).toEqual([1, 3, 4]);
    expect(routedNeighbours(m, 4)).toEqual([2]);
  });
});
