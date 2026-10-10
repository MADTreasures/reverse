import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const engineMock = vi.hoisted(() => ({
  setPluginParam: vi.fn(),
  playheadTick: () => null,
  noteOn: vi.fn(() => 1),
  noteOff: vi.fn(),
  playing: false,
}));
vi.mock('../audio/engine', () => ({ engine: engineMock }));

import { channelTarget } from '../model/automationTargets';
import { selectChannel, setControllerLink, undo } from '../store/actions';
import { resetStore, useStore } from '../store/store';
import { handleMidiMessage, listenForControllers } from './midiInput';

const state = () => useStore.getState();
const cc = (number: number, value: number, channel = 0) => handleMidiMessage([0xb0 | channel, number, value]);

describe('MIDI controller input', () => {
  beforeEach(() => {
    resetStore();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('moves the linked control, one undo step per movement', () => {
    const kick = state().project.channels[0];
    const before = kick.volume;
    setControllerLink({ target: channelTarget(kick.id, 'volume'), channel: 0, cc: 7 });
    const steps = state().past.length;
    for (const v of [10, 40, 80, 127]) cc(7, v);
    expect(state().project.channels[0].volume).toBe(1);
    cc(7, 64, 1); // another MIDI channel
    cc(8, 0); // another controller
    expect(state().project.channels[0].volume).toBe(1);
    expect(state().past.length).toBe(steps + 1);
    expect(state().pastLabels.at(-1)).toBe('MIDI controller');
    expect(state().ui.lastTweaked).toBe(channelTarget(kick.id, 'volume'));
    vi.advanceTimersByTime(1000);
    cc(7, 0);
    expect(state().project.channels[0].volume).toBe(0);
    expect(state().past.length).toBe(steps + 2); // a new movement after a pause
    undo();
    undo();
    expect(state().project.channels[0].volume).toBe(before);
  });

  it('applies mapping formulas, units and pickup', () => {
    setControllerLink({ target: 'proj:bpm', channel: 0, cc: 20, mapping: 'inverted' });
    cc(20, 127);
    expect(state().project.bpm).toBe(60);
    cc(20, 0);
    expect(state().project.bpm).toBe(200);

    const kick = state().project.channels[0];
    const pan = channelTarget(kick.id, 'pan'); // 0 = centre → 0.5 normalized
    setControllerLink({ target: pan, channel: 0, cc: 10, pickup: true });
    cc(10, 0);
    cc(10, 30);
    expect(state().project.channels[0].pan).toBe(0); // not picked up yet
    cc(10, 70); // crosses the centre
    expect(state().project.channels[0].pan).toBeCloseTo((70 / 127) * 2 - 1);
    cc(10, 127);
    expect(state().project.channels[0].pan).toBe(1);
  });

  it('controls the selected channel with an omni link', () => {
    const [kick, clap] = state().project.channels;
    setControllerLink({ target: channelTarget(kick.id, 'volume'), channel: 0, cc: 7, omni: true });
    selectChannel(clap.id);
    cc(7, 0);
    expect(state().project.channels[1].volume).toBe(0);
    expect(state().project.channels[0].volume).toBe(kick.volume);
  });

  it('sends linked plugin parameters to the engine', () => {
    const kick = state().project.channels[0];
    setControllerLink({ target: `plug:ch:${kick.id}:3`, channel: 0, cc: 30 });
    cc(30, 127);
    // The kick is no plugin channel, so the target does not resolve and nothing is sent.
    expect(engineMock.setPluginParam).not.toHaveBeenCalled();
  });

  it('gives control changes to auto detect instead while it listens', () => {
    const kick = state().project.channels[0];
    setControllerLink({ target: channelTarget(kick.id, 'volume'), channel: 0, cc: 7 });
    const heard: number[][] = [];
    const stop = listenForControllers((channel, number, value) => heard.push([channel, number, value]));
    cc(7, 0, 2);
    expect(heard).toEqual([[2, 7, 0]]);
    expect(state().project.channels[0].volume).toBe(kick.volume);
    stop();
    cc(7, 0);
    expect(state().project.channels[0].volume).toBe(0);
  });

  it('still plays notes on the selected channel', () => {
    handleMidiMessage([0x90, 60, 100]);
    expect(engineMock.noteOn).toHaveBeenCalledWith(state().ui.selectedChannelId, 60, 100 / 127, expect.anything());
    handleMidiMessage([0x80, 60, 0]);
    expect(engineMock.noteOff).toHaveBeenCalled();
  });
});
