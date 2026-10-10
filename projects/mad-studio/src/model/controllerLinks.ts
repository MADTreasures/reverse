/**
 * MIDI controller links (FL Studio: right-click a control › Link to controller…, the "Remote control
 * settings"). A link maps a control change (MIDI channel + controller number) to a control's automation
 * target key (automationTargets.ts). Links are saved with the project like FL Studio's per-project
 * links. The MIDI input (ui/midiInput.ts) applies them through the store, so both engines follow;
 * plugin parameters go to the engine directly.
 */
import { channelTarget, parseTargetKey } from './automationTargets';
import type { ControllerLink, ControllerMapping, Project } from './types';

export const CONTROLLER_MAPPINGS: { id: ControllerMapping; label: string; hint: string }[] = [
  { id: 'default', label: 'Default', hint: 'The control follows the controller 1:1' },
  { id: 'inverted', label: 'Inverted', hint: 'Turning the controller up turns the control down' },
  { id: 'switch', label: 'Switch', hint: 'Off below the controller’s middle, fully on above it' },
  { id: 'firstHalf', label: 'First half', hint: 'The controller covers 0–50% of the control' },
  { id: 'lastHalf', label: 'Last half', hint: 'The controller covers 50–100% of the control' },
];

/** Normalized control value (0..1) for a 7-bit controller value. */
export function mapControllerValue(mapping: ControllerMapping | undefined, value: number): number {
  const x = Math.min(127, Math.max(0, value)) / 127;
  switch (mapping) {
    case 'inverted':
      return 1 - x;
    case 'switch':
      return x >= 0.5 ? 1 : 0;
    case 'firstHalf':
      return x / 2;
    case 'lastHalf':
      return 0.5 + x / 2;
    default:
      return x;
  }
}

/** Links that respond to a control change on MIDI `channel` (0..15) with controller number `cc`. */
export function linksFor(project: Pick<Project, 'controllerLinks'>, channel: number, cc: number): ControllerLink[] {
  return (project.controllerLinks ?? []).filter((l) => l.cc === cc && l.channel === channel);
}

export function linkOf(project: Pick<Project, 'controllerLinks'>, target: string): ControllerLink | undefined {
  return project.controllerLinks?.find((l) => l.target === target);
}

/** True when omni makes sense for the target: channel parameters (FL Studio: Omni follows the selected channel). */
export function canBeOmni(target: string): boolean {
  return parseTargetKey(target)?.scope === 'ch';
}

/** The target a link controls now: an omni link to a channel parameter follows the selected channel. */
export function resolveLinkTarget(link: ControllerLink, selectedChannelId: string | null): string {
  if (!link.omni || !selectedChannelId) return link.target;
  const p = parseTargetKey(link.target);
  return p?.scope === 'ch' ? channelTarget(selectedChannelId, p.param) : link.target;
}

/** "CC 74 · ch 1" */
export function describeLink(link: Pick<ControllerLink, 'channel' | 'cc' | 'omni'>): string {
  return `CC ${link.cc} · ch ${link.channel + 1}${link.omni ? ' · omni' : ''}`;
}

export interface PickupState {
  caught: boolean;
  /** Last mapped controller value. */
  input?: number;
  /** Normalized control value right after the link last set it. */
  sent?: number;
}

/**
 * Pickup (takeover mode, FL Studio: MIDI settings): the control only follows once the controller
 * reaches its current value or moves across it, so a knob in another position doesn't make it jump.
 * When something else moves the control, the controller has to pick it up again. Returns true when
 * the controller value should be applied (the caller then stores the control's new value in `sent`).
 */
export function pickupAllows(state: PickupState, input: number, current: number): boolean {
  if (state.caught && state.sent !== undefined && Math.abs(current - state.sent) > 1e-6) state.caught = false;
  if (!state.caught) {
    const crossed = state.input !== undefined && (state.input - current) * (input - current) <= 0;
    if (crossed || Math.abs(input - current) <= 1 / 127 + 1e-9) state.caught = true;
  }
  state.input = input;
  return state.caught;
}
