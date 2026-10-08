import { beforeEach, describe, expect, it } from 'vitest';
import { setTrackInput, setTransport, undo } from './actions';
import { createAutomationClip, recordAutomationValue } from './automationActions';
import { resetStore, useStore } from './store';

beforeEach(() => resetStore());

describe('automation clip creation', () => {
  it('adds an automation channel and a clip on the first free track and switches the rack filter', () => {
    const p = useStore.getState().project;
    const target = `ch:${p.channels[0].id}:volume`;
    const id = createAutomationClip(target)!;
    const s = useStore.getState();
    const ch = s.project.channels.find((c) => c.id === id)!;
    expect(ch.kind).toBe('automation');
    expect(ch.name).toBe(`${p.channels[0].name} - Channel volume`);
    const clip = s.project.clips.find((c) => c.kind === 'automation')!;
    expect(clip.trackId).toBe(s.project.tracks[0].id);
    expect(clip.length).toBe(384); // empty song → one bar
    expect(s.ui.rackFilter).toBe('automation');
    expect(s.ui.playlistPick).toEqual({ kind: 'automation', id });
    undo();
    expect(useStore.getState().project.channels.some((c) => c.kind === 'automation')).toBe(false);
  });
});

describe('automation recording', () => {
  it('records control movements while recording in song mode', () => {
    const p = useStore.getState().project;
    const target = `mx:1:volume`;
    // Not recording: nothing happens.
    recordAutomationValue(target, 0.5, 10);
    expect(useStore.getState().project.channels.some((c) => c.kind === 'automation')).toBe(false);

    setTransport({ recording: true, playing: true, mode: 'song' });
    recordAutomationValue(target, 0.8, 0);
    recordAutomationValue(target, 0.4, 96);
    recordAutomationValue(target, 0.2, 192);
    const s = useStore.getState();
    const ch = s.project.channels.find((c) => c.kind === 'automation');
    expect(ch?.kind).toBe('automation');
    if (ch?.kind !== 'automation') return;
    expect(ch.automation.target).toBe(target);
    const ticks = ch.automation.points.map((x) => x.tick);
    expect(ticks).toContain(96);
    expect(ticks).toContain(192);
    const at96 = ch.automation.points.find((x) => x.tick === 96)!;
    expect(at96.value).toBeCloseTo(0.4);
    expect(p.mixer[1].name).toBeTruthy();
  });
});

describe('recording inputs', () => {
  it('choosing an input arms the track, removing it disarms', () => {
    setTrackInput(2, 'mono:1');
    expect(useStore.getState().project.mixer[2]).toMatchObject({ input: 'mono:1', armed: true });
    setTrackInput(2, null);
    expect(useStore.getState().project.mixer[2]).toMatchObject({ input: null, armed: false });
    setTrackInput(0, 'stereo:0');
    expect(useStore.getState().project.mixer[0].input).toBeNull();
  });
});
