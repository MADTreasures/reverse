/**
 * Automation clip editing (FL Studio workflow): right-click any control → "Create automation clip"
 * adds an automation channel to the channel rack and places a clip covering the song in the playlist.
 */
import type { Draft } from 'immer';
import { flatAutomation } from '../model/automation';
import { describeTarget, targetValue, toNorm } from '../model/automationTargets';
import { createAutomationChannel, createPlaylistTrack } from '../model/defaults';
import { makeId } from '../model/ids';
import { songLength } from '../model/patterns';
import { ticksPerBar } from '../model/timing';
import type { AutomationData, AutomationPoint, CurveMode, Id, Project } from '../model/types';
import { edit, selectChannel, setUi, type EditOptions } from './actions';
import { useStore } from './store';

function automationOf(d: Draft<Project>, channelId: Id): Draft<AutomationData> | undefined {
  const ch = d.channels.find((c) => c.id === channelId);
  return ch && ch.kind === 'automation' ? ch.automation : undefined;
}

/** Keeps points sorted, the first point at 0 and the data length covering the last point. */
function normalize(a: Draft<AutomationData>): void {
  a.points.sort((x, y) => x.tick - y.tick);
  if (a.points.length === 0) a.points.push({ tick: 0, value: 0.5, tension: 0, mode: 'single' });
  a.points[0].tick = 0;
  for (const p of a.points) {
    p.tick = Math.max(0, Math.round(p.tick));
    p.value = Math.min(1, Math.max(0, p.value));
    p.tension = Math.min(1, Math.max(-1, p.tension));
  }
  a.length = Math.max(1, a.points[a.points.length - 1].tick);
}

/** First playlist track with nothing in [start, end); appends a track when all are busy. */
function freeTrack(d: Draft<Project>, start: number, end: number): Id {
  const busy = (trackId: Id) => d.clips.some((c) => c.trackId === trackId && c.start < end && c.start + c.length > start);
  const empty = d.tracks.find((t) => !d.clips.some((c) => c.trackId === t.id));
  const free = empty ?? d.tracks.find((t) => !busy(t.id));
  if (free) return free.id;
  const track = createPlaylistTrack(d.tracks.length);
  d.tracks.push(track);
  return track.id;
}

/**
 * Creates an automation clip for a control: a flat line at the control's current value covering the
 * whole song (at least one bar), on the first free playlist track. Returns the new channel id.
 */
export function createAutomationClip(target: string, range?: { start: number; end: number }): Id | null {
  const project = useStore.getState().project;
  const info = describeTarget(project, target);
  const current = targetValue(project, target);
  if (!info) return null;
  const start = range?.start ?? 0;
  const end = range?.end ?? Math.max(songLength(project), ticksPerBar(project.beatsPerBar));
  const length = Math.max(1, end - start);
  const channel = createAutomationChannel({
    name: info.label,
    target,
    value: current === null ? 0.5 : toNorm(info, current),
    length,
  });
  const clipId = makeId('clip');
  edit((d) => {
    d.channels.push(channel);
    d.clips.push({ id: clipId, kind: 'automation', channelId: channel.id, trackId: freeTrack(d, start, start + length), start, length, offset: 0 });
  });
  selectChannel(channel.id);
  // FL Studio switches the channel rack to the automation group and picks the new clip.
  setUi((u) => {
    u.rackFilter = 'automation';
    u.playlistPick = { kind: 'automation', id: channel.id };
  });
  return channel.id;
}

/** The automation channel that targets `target` (the first one if there are several). */
export function automationChannelFor(project: Project, target: string): Id | null {
  return project.channels.find((c) => c.kind === 'automation' && c.automation.target === target)?.id ?? null;
}

export function updateAutomation(channelId: Id, recipe: (a: Draft<AutomationData>) => void, opts?: EditOptions): void {
  edit((d) => {
    const a = automationOf(d, channelId);
    if (!a) return;
    recipe(a);
    normalize(a);
  }, opts);
}

/** Adds a point (keeping the shape of the segment it splits); returns its index. */
export function addAutomationPoint(channelId: Id, tick: number, value: number, opts?: EditOptions): number {
  let index = -1;
  updateAutomation(
    channelId,
    (a) => {
      const t = Math.max(0, Math.round(tick));
      const next = a.points.find((p) => p.tick > t);
      const pt: AutomationPoint = { tick: t, value, tension: 0, mode: next?.mode ?? 'single' };
      a.points.push(pt);
      a.points.sort((x, y) => x.tick - y.tick);
      index = a.points.findIndex((p) => p === pt || (p.tick === t && p.value === value));
    },
    opts,
  );
  return index;
}

/**
 * Moves point `index`. Points cannot pass their neighbours; the first point stays at tick 0 and only
 * moves vertically. Moving the last point beyond the data length stretches the data (FL behaviour).
 */
export function moveAutomationPoint(channelId: Id, index: number, tick: number, value: number, opts?: EditOptions): void {
  updateAutomation(
    channelId,
    (a) => {
      const p = a.points[index];
      if (!p) return;
      const prev = a.points[index - 1];
      const next = a.points[index + 1];
      p.value = Math.min(1, Math.max(0, value));
      if (index === 0) return;
      const lo = prev ? prev.tick : 0;
      const hi = next ? next.tick : Infinity;
      p.tick = Math.min(hi, Math.max(lo, Math.round(tick)));
    },
    opts,
  );
}

/** Deletes a point; the first point (the clip start) always stays. */
export function deleteAutomationPoint(channelId: Id, index: number): void {
  updateAutomation(channelId, (a) => {
    if (index <= 0 || index >= a.points.length) return;
    a.points.splice(index, 1);
  });
}

export function setPointTension(channelId: Id, index: number, tension: number, opts?: EditOptions): void {
  updateAutomation(
    channelId,
    (a) => {
      const p = a.points[index];
      if (p && index > 0) p.tension = tension;
    },
    opts,
  );
}

export function setPointMode(channelId: Id, index: number, mode: CurveMode): void {
  updateAutomation(channelId, (a) => {
    const p = a.points[index];
    if (p) {
      p.mode = mode;
      if (mode === 'hold' || mode === 'smooth') p.tension = 0;
    }
  });
}

export function setPointValue(channelId: Id, index: number, value: number): void {
  updateAutomation(channelId, (a) => {
    const p = a.points[index];
    if (p) p.value = value;
  });
}

export function setAutomationTarget(channelId: Id, target: string | null): void {
  edit((d) => {
    const ch = d.channels.find((c) => c.id === channelId);
    if (!ch || ch.kind !== 'automation') return;
    ch.automation.target = target;
    const info = target ? describeTarget(d as Project, target) : null;
    if (info && /^Automation( \d+)?$|^\(unlinked\)$/.test(ch.name)) ch.name = info.label;
  });
}

/** Replaces the curve with a flat line at the target's current value. */
export function resetAutomation(channelId: Id): void {
  const project = useStore.getState().project;
  const ch = project.channels.find((c) => c.id === channelId);
  if (!ch || ch.kind !== 'automation') return;
  const info = ch.automation.target ? describeTarget(project, ch.automation.target) : null;
  const v = info && ch.automation.target ? targetValue(project, ch.automation.target) : null;
  updateAutomation(channelId, (a) => {
    a.points = flatAutomation(info && v !== null ? toNorm(info, v) : 0.5, a.length);
  });
}

export function flipAutomation(channelId: Id): void {
  updateAutomation(channelId, (a) => {
    for (const p of a.points) p.value = 1 - p.value;
  });
}

/** Places a clip of an automation channel at `start` on `trackId`, sized to its data. */
export function placeAutomationClip(channelId: Id, trackId: Id, start: number, opts?: EditOptions): Id | null {
  const ch = useStore.getState().project.channels.find((c) => c.id === channelId);
  if (!ch || ch.kind !== 'automation') return null;
  const id = makeId('clip');
  edit((d) => {
    d.clips.push({ id, kind: 'automation', channelId, trackId, start: Math.max(0, Math.round(start)), length: ch.automation.length, offset: 0 });
  }, opts);
  return id;
}

/** Remembers the last automatable control the user moved (FL: Tools › Last tweaked). */
export function noteTweaked(target: string): void {
  if (useStore.getState().ui.lastTweaked !== target) {
    setUi((u) => {
      u.lastTweaked = target;
    });
  }
}
