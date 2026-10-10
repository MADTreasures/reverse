/**
 * MIDI input (Web MIDI: Chrome and the desktop app). Notes play the selected channel; control changes
 * drive the controls linked to them (controller links, FL Studio: Link to controller…) or go to the
 * Remote control settings while they wait for a controller (Auto detect).
 */
import { create } from 'zustand';
import { useAutomationOverlay } from '../audio/automationRuntime';
import { engine } from '../audio/engine';
import { applyTargetValue, describeTarget, fromNorm, parseTargetKey, targetValue, toNorm, type TargetInfo } from '../model/automationTargets';
import { linksFor, mapControllerValue, pickupAllows, resolveLinkTarget, type PickupState } from '../model/controllerLinks';
import type { ControllerLink, Project } from '../model/types';
import { usePlugins } from '../plugins/pluginStore';
import { edit, endCoalesce, gestureKey } from '../store/actions';
import { noteTweaked, recordAutomationValue } from '../store/automationActions';
import { useStore } from '../store/store';
import { liveNoteOff, liveNoteOn } from './liveInput';

/** Whether Web MIDI input is on and how many inputs it found (the Remote control settings show it). */
export const useMidi = create<{ enabled: boolean; inputs: number }>(() => ({ enabled: false, inputs: 0 }));

type ControllerListener = (channel: number, cc: number, value: number) => void;
const listeners = new Set<ControllerListener>();

/**
 * Calls `fn` for every control change until the returned function is called. While anything listens
 * (Auto detect in the Remote control settings), control changes don't move linked controls.
 */
export function listenForControllers(fn: ControllerListener): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

const notes = new Map<number, number>(); // key → live note handle
const pickups = new Map<string, PickupState>(); // link id + resolved target → pickup state
let burst: string | null = null; // undo step of the current controller movement
let burstTimer: ReturnType<typeof setTimeout> | null = null;

/** Handles one MIDI message (status byte first). */
export function handleMidiMessage(data: ArrayLike<number>): void {
  if (data.length < 3) return;
  const status = data[0] & 0xf0;
  const channel = data[0] & 0x0f;
  const key = data[1] & 0x7f;
  const value = data[2] & 0x7f;
  if (status === 0xb0) {
    controlChange(channel, key, value);
    return;
  }
  const channelId = useStore.getState().ui.selectedChannelId;
  if (status === 0x90 && value > 0 && channelId) {
    const prev = notes.get(key);
    if (prev !== undefined) liveNoteOff(prev);
    notes.set(key, liveNoteOn(channelId, key, value / 127));
  } else if (status === 0x80 || (status === 0x90 && value === 0)) {
    const h = notes.get(key);
    if (h !== undefined) {
      liveNoteOff(h);
      notes.delete(key);
    }
  }
}

function controlChange(channel: number, cc: number, value: number): void {
  if (listeners.size > 0) {
    for (const fn of [...listeners]) fn(channel, cc, value);
    return;
  }
  for (const link of linksFor(useStore.getState().project, channel, cc)) applyLink(link, value);
}

function pluginParam(target: string): { key: string; index: number } | null {
  const p = parseTargetKey(target);
  return p?.scope === 'plug' ? { key: p.owner, index: Number(p.param) } : null;
}

/** The control's current value, normalized (the automated value while automation drives it). */
function currentNorm(project: Project, target: string, info: TargetInfo): number | null {
  const plug = pluginParam(target);
  if (plug) return usePlugins.getState().params[plug.key]?.find((p) => p.index === plug.index)?.value ?? null;
  const v = useAutomationOverlay.getState().values[target] ?? targetValue(project, target);
  return v === null ? null : toNorm(info, v);
}

function applyLink(link: ControllerLink, value: number): void {
  const s = useStore.getState();
  const target = resolveLinkTarget(link, s.ui.selectedChannelId);
  const info = describeTarget(s.project, target);
  if (!info) return;
  const input = mapControllerValue(link.mapping, value);
  let pickup: PickupState | undefined;
  if (link.pickup) {
    const current = currentNorm(s.project, target, info);
    if (current !== null) {
      const id = `${link.id}|${target}`;
      pickup = pickups.get(id) ?? { caught: false };
      pickups.set(id, pickup);
      if (!pickupAllows(pickup, input, current)) return;
    }
  }

  const plug = pluginParam(target);
  if (plug) {
    engine.setPluginParam(plug.key, plug.index, input);
  } else {
    const v = fromNorm(info, input);
    if (!burst) burst = gestureKey('midi');
    edit((d) => applyTargetValue(d, target, v), { label: 'MIDI controller', coalesce: burst });
    if (burstTimer) clearTimeout(burstTimer);
    burstTimer = setTimeout(() => {
      if (useStore.getState().coalesceKey === burst) endCoalesce();
      burst = null;
    }, 700);
    noteTweaked(target);
    recordAutomationValue(target, v, engine.playheadTick());
  }
  if (pickup) pickup.sent = currentNorm(useStore.getState().project, target, info) ?? input;
}

let access: MIDIAccess | null = null;

/** Turns on Web MIDI input; resolves to the number of inputs (-1 when it was on already). */
export async function enableMidi(): Promise<number> {
  if (access) return -1;
  if (!navigator.requestMIDIAccess) throw new Error('Web MIDI is not available in this browser.');
  const a = await navigator.requestMIDIAccess();
  if (access) return -1;
  access = a;
  const attach = (input: MIDIInput) => {
    input.onmidimessage = (msg) => {
      if (msg.data) handleMidiMessage(msg.data);
    };
  };
  a.inputs.forEach(attach);
  a.onstatechange = (ev) => {
    const port = (ev as MIDIConnectionEvent).port;
    if (port && port.type === 'input' && port.state === 'connected') attach(port as MIDIInput);
    useMidi.setState({ inputs: a.inputs.size });
  };
  useMidi.setState({ enabled: true, inputs: a.inputs.size });
  return a.inputs.size;
}
