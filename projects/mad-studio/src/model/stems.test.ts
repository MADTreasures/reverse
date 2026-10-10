import { beforeEach, describe, expect, it } from 'vitest';
import { routeOnly, setChannelProps, setMixerTrackProps, setRoute, sidechainTo } from '../store/actions';
import { createAutomationClip } from '../store/automationActions';
import { resetStore, useStore } from '../store/store';
import { DEFAULT_SEND, trackRoutes } from './routing';
import { stemProject, stemTracks } from './stems';

const project = () => useStore.getState().project;

describe('stems (split mixer tracks)', () => {
  beforeEach(() => resetStore());

  it('exports the inserts that channels play into, without muted ones', () => {
    // The basic kit plays into inserts 1–4.
    expect(stemTracks(project())).toEqual([1, 2, 3, 4]);
    setChannelProps(project().channels[3].id, { mixerTrack: 0 }); // straight to the master
    expect(stemTracks(project())).toEqual([1, 2, 3]);
    setMixerTrackProps(2, { muted: true });
    expect(stemTracks(project())).toEqual([1, 3]);
  });

  it('follows sends that carry audio, not sidechain keys', () => {
    routeOnly(1, 10); // kick → insert 10 → master
    setRoute(2, 11, true); // clap → master and insert 11
    sidechainTo(3, 12); // hat keys insert 12 only (level 0)
    routeOnly(10, 13); // insert 10 → insert 13
    expect(stemTracks(project())).toEqual([1, 2, 3, 4, 10, 11, 13]);
  });

  it('renders a stem from the track’s own output into an unprocessed master', () => {
    routeOnly(1, 10); // kick → bus 10
    setRoute(2, 10, true); // clap → master and bus 10
    sidechainTo(3, 10); // hat keys bus 10
    setRoute(10, 11, true); // bus 10 → master and send 11
    setChannelProps(project().channels[3].id, { mixerTrack: 0 }); // snare straight to the master
    createAutomationClip('mx:0:volume');
    createAutomationClip('mx:10:pan');
    const p = project();
    const stem = stemProject(p, 10);
    const routes = (i: number) => trackRoutes(stem.mixer, i);
    expect(routes(10)).toEqual([{ to: 0, level: DEFAULT_SEND }]); // only its own output
    expect(routes(1)).toEqual([{ to: 10, level: DEFAULT_SEND }]); // feeders keep feeding it
    expect(routes(2)).toEqual([expect.objectContaining({ to: 10 })]); // … but not the master
    expect(routes(3)).toEqual([expect.objectContaining({ to: 10, sidechain: true })]); // keys stay
    expect(routes(4)).toEqual([]); // unrelated tracks are silent
    expect(routes(11)).toEqual([]);
    expect(stem.mixer[0]).toMatchObject({ volume: DEFAULT_SEND, pan: 0, muted: false });
    expect(stem.mixer[0].effects.every((e) => !e.enabled)).toBe(true);
    expect(stem.channels.find((c) => c.id === p.channels[3].id)?.muted).toBe(true);
    const automated = stem.channels.filter((c) => c.kind === 'automation').map((c) => (c.kind === 'automation' ? c.automation.target : null));
    expect(automated).toEqual(['mx:10:pan']); // the master's automation does not apply
    expect(stem.clips.filter((c) => c.kind === 'automation')).toHaveLength(1);
    expect(p.mixer[0].effects.every((e) => e.enabled)).toBe(true); // the project itself is unchanged
    expect(trackRoutes(p.mixer, 4)).toEqual([{ to: 0, level: DEFAULT_SEND }]);
  });
});
