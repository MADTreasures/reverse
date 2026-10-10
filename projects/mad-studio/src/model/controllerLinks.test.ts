import { beforeEach, describe, expect, it } from 'vitest';
import { addEffect, deleteChannel, removeAllControllerLinks, removeControllerLink, removeEffect, setControllerLink, undo } from '../store/actions';
import { resetStore, useStore } from '../store/store';
import { channelTarget, effectTarget, mixerTarget } from './automationTargets';
import { canBeOmni, describeLink, linkOf, linksFor, mapControllerValue, pickupAllows, resolveLinkTarget, type PickupState } from './controllerLinks';
import { parseProject } from './serialization';

const state = () => useStore.getState();

describe('controller links', () => {
  it('maps controller values with the mapping formulas', () => {
    expect([0, 64, 127].map((v) => mapControllerValue(undefined, v))).toEqual([0, 64 / 127, 1]);
    expect(mapControllerValue('inverted', 127)).toBe(0);
    expect(mapControllerValue('inverted', 0)).toBe(1);
    expect([63, 64].map((v) => mapControllerValue('switch', v))).toEqual([0, 1]);
    expect(mapControllerValue('firstHalf', 127)).toBe(0.5);
    expect(mapControllerValue('lastHalf', 0)).toBe(0.5);
    expect(mapControllerValue('lastHalf', 127)).toBe(1);
    expect(mapControllerValue(undefined, 300)).toBe(1);
  });

  it('finds the links of a control change and resolves omni links to the selected channel', () => {
    const links = [
      { id: 'a', target: 'ch:kick:volume', channel: 0, cc: 7 },
      { id: 'b', target: 'mx:1:pan', channel: 1, cc: 7 },
      { id: 'c', target: 'ch:kick:pan', channel: 0, cc: 10, omni: true },
    ];
    expect(linksFor({ controllerLinks: links }, 0, 7).map((l) => l.id)).toEqual(['a']);
    expect(linksFor({ controllerLinks: links }, 1, 7).map((l) => l.id)).toEqual(['b']);
    expect(linksFor({}, 0, 7)).toEqual([]);
    expect(resolveLinkTarget(links[2], 'snare')).toBe('ch:snare:pan');
    expect(resolveLinkTarget(links[2], null)).toBe('ch:kick:pan');
    expect(resolveLinkTarget({ ...links[1], omni: true }, 'snare')).toBe('mx:1:pan');
    expect(canBeOmni('ch:kick:synth.filter.cutoff')).toBe(true);
    expect(canBeOmni('fx:slot:mix')).toBe(false);
    expect(describeLink(links[2])).toBe('CC 10 · ch 1 · omni');
  });

  it('picks up the control only when the controller reaches or crosses its value', () => {
    const s: PickupState = { caught: false };
    expect(pickupAllows(s, 0.1, 0.6)).toBe(false);
    expect(pickupAllows(s, 0.3, 0.6)).toBe(false);
    expect(pickupAllows(s, 0.7, 0.6)).toBe(true); // crossed 0.6
    s.sent = 0.7;
    expect(pickupAllows(s, 0.2, 0.7)).toBe(true); // follows from now on
    s.sent = 0.2;
    expect(pickupAllows(s, 0.25, 0.9)).toBe(false); // moved elsewhere: pick up again
    expect(pickupAllows(s, 0.9, 0.9)).toBe(true);
    const near: PickupState = { caught: false };
    expect(pickupAllows(near, 0.5 + 0.5 / 127, 0.5)).toBe(true); // within a step
  });
});

describe('controller link actions', () => {
  beforeEach(() => resetStore());

  it('links one controller per control, removes conflicts and undoes', () => {
    const [kick, clap] = state().project.channels;
    const vol = channelTarget(kick.id, 'volume');
    setControllerLink({ target: vol, channel: 0, cc: 7 });
    setControllerLink({ target: channelTarget(clap.id, 'volume'), channel: 0, cc: 8, mapping: 'default', pickup: false });
    expect(state().project.controllerLinks).toHaveLength(2);
    expect(state().project.controllerLinks![1]).toEqual({ id: expect.any(String), target: channelTarget(clap.id, 'volume'), channel: 0, cc: 8 });

    // Re-linking a control replaces its link.
    setControllerLink({ target: vol, channel: 2, cc: 20.4, mapping: 'inverted', pickup: true, omni: true });
    expect(linkOf(state().project, vol)).toMatchObject({ channel: 2, cc: 20, mapping: 'inverted', pickup: true, omni: true });
    expect(state().project.controllerLinks).toHaveLength(2);

    // The same controller on another control: kept without, replaced with "Remove conflicts".
    setControllerLink({ target: mixerTarget(1, 'pan'), channel: 0, cc: 8 });
    expect(state().project.controllerLinks).toHaveLength(3);
    setControllerLink({ target: mixerTarget(2, 'pan'), channel: 0, cc: 8 }, { removeConflicts: true });
    expect(state().project.controllerLinks!.map((l) => l.target)).toEqual([vol, mixerTarget(2, 'pan')]);

    undo();
    expect(state().project.controllerLinks).toHaveLength(3);
    removeControllerLink(vol);
    expect(linkOf(state().project, vol)).toBeUndefined();
    removeAllControllerLinks();
    expect(state().project.controllerLinks).toBeUndefined();
  });

  it('drops the links of deleted channels and effects', () => {
    const kick = state().project.channels[0];
    addEffect(1, 'delay');
    const slot = state().project.mixer[1].effects.at(-1)!;
    setControllerLink({ target: channelTarget(kick.id, 'pan'), channel: 0, cc: 10 });
    setControllerLink({ target: effectTarget(slot.id, 'mix'), channel: 0, cc: 11 });
    setControllerLink({ target: 'proj:bpm', channel: 0, cc: 12 });
    deleteChannel(kick.id);
    removeEffect(1, slot.id);
    expect(state().project.controllerLinks!.map((l) => l.target)).toEqual(['proj:bpm']);
  });

  it('saves links with the project and drops broken ones on load', () => {
    const kick = state().project.channels[0];
    setControllerLink({ target: channelTarget(kick.id, 'volume'), channel: 3, cc: 74, mapping: 'lastHalf' });
    const raw = JSON.parse(JSON.stringify(state().project));
    raw.controllerLinks.push(
      { target: channelTarget(kick.id, 'volume'), channel: 0, cc: 1 }, // duplicate target
      { target: 42, channel: 0, cc: 1 },
      { target: 'proj:swing', channel: 99, cc: -5, mapping: 'wobble', pickup: true },
    );
    const loaded = parseProject(raw);
    expect(loaded.controllerLinks).toEqual([
      { id: expect.any(String), target: channelTarget(kick.id, 'volume'), channel: 3, cc: 74, mapping: 'lastHalf' },
      { id: expect.any(String), target: 'proj:swing', channel: 15, cc: 0, pickup: true },
    ]);
    raw.controllerLinks = [];
    expect(parseProject(raw).controllerLinks).toBeUndefined();
  });
});
