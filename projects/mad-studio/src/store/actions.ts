import { produce, type Draft } from 'immer';
import { paletteColor } from '../model/colors';
import {
  DEFAULT_VELOCITY,
  MAX_INSERTS,
  createFactoryChannel,
  createMixerTrack,
  createPattern,
  createPlaylistTrack,
  createPluginChannel,
  createSynthChannel,
} from '../model/defaults';
import { defaultEffectParams } from '../model/effects';
import { factorySampleInfo } from '../model/factory';
import { makeId } from '../model/ids';
import { findPattern, patternLength, stepKey } from '../model/patterns';
import { findPreset } from '../model/presets';
import { MAX_BPM, MIN_BPM, TICKS_PER_STEP, ticksPerBar } from '../model/timing';
import type {
  Channel,
  Clip,
  EffectType,
  Id,
  MixerTrack,
  Note,
  Pattern,
  PluginInstanceData,
  Project,
  SampleInfo,
  SamplerParams,
  SynthParams,
  TrackInput,
} from '../model/types';
import { MAX_UNDO, initialUi, useStore, type AppState, type PlayMode, type TransportState, type UiState } from './store';

// ---------------------------------------------------------------------------
// Core editing primitives

export interface EditOptions {
  /** Edits sharing a key merge into one undo step until endCoalesce() is called. */
  coalesce?: string;
}

/** Applies an undoable change to the project. */
export function edit(recipe: (draft: Draft<Project>) => void, opts: EditOptions = {}): void {
  const s = useStore.getState();
  const next = produce(s.project, recipe);
  if (next === s.project) return;
  const merge = opts.coalesce !== undefined && opts.coalesce === s.coalesceKey;
  useStore.setState({
    project: next,
    past: merge ? s.past : [...s.past.slice(-(MAX_UNDO - 1)), s.project],
    future: [],
    coalesceKey: opts.coalesce ?? null,
    dirty: true,
  });
}

export function endCoalesce(): void {
  if (useStore.getState().coalesceKey !== null) useStore.setState({ coalesceKey: null });
}

let gestureCounter = 0;
/** Unique coalesce key for one pointer gesture. */
export function gestureKey(prefix: string): string {
  gestureCounter += 1;
  return `${prefix}#${gestureCounter}`;
}

export function undo(): void {
  const s = useStore.getState();
  const prev = s.past[s.past.length - 1];
  if (!prev) return;
  useStore.setState({
    project: prev,
    past: s.past.slice(0, -1),
    future: [s.project, ...s.future],
    coalesceKey: null,
    dirty: true,
    ui: reconcileUi(s.ui, prev),
  });
}

export function redo(): void {
  const s = useStore.getState();
  const next = s.future[0];
  if (!next) return;
  useStore.setState({
    project: next,
    past: [...s.past, s.project],
    future: s.future.slice(1),
    coalesceKey: null,
    dirty: true,
    ui: reconcileUi(s.ui, next),
  });
}

export function setUi(recipe: (draft: Draft<UiState>) => void): void {
  const s = useStore.getState();
  const next = produce(s.ui, recipe);
  if (next !== s.ui) useStore.setState({ ui: next });
}

export function setTransport(patch: Partial<TransportState>): void {
  useStore.setState((s) => ({ transport: { ...s.transport, ...patch } }));
}

/** Keeps UI selections pointing at things that exist in the given project. */
function reconcileUi(ui: UiState, project: Project): UiState {
  return produce(ui, (d) => {
    if (!project.patterns.some((p) => p.id === d.selectedPatternId)) {
      d.selectedPatternId = project.patterns[0]?.id ?? '';
    }
    const hasChannel = (id: Id | null) => id !== null && project.channels.some((c) => c.id === id);
    if (!hasChannel(d.selectedChannelId)) d.selectedChannelId = project.channels[0]?.id ?? null;
    if (!hasChannel(d.pianoRollChannelId)) d.pianoRollChannelId = d.selectedChannelId;
    if (d.selectedMixerTrack >= project.mixer.length) d.selectedMixerTrack = 0;
    const pick = d.playlistPick;
    if (pick && (pick.kind === 'pattern' ? !project.patterns.some((p) => p.id === pick.id) : !hasChannel(pick.id))) d.playlistPick = null;
    for (const key of Object.keys(d.windows)) {
      if (key.startsWith('channel:') && !hasChannel(key.slice(8))) delete d.windows[key];
      if (key.startsWith('effect:')) {
        const [, idx, slotId] = key.split(':');
        const track = project.mixer[Number(idx)];
        if (!track || !track.effects.some((e) => e.id === slotId)) delete d.windows[key];
      }
    }
  });
}

/** Replaces the project (new/open) and resets history and selections. */
export function loadProject(project: Project, fileName: string | null = null): void {
  const s = useStore.getState();
  const fresh = initialUi(project);
  useStore.setState({
    project,
    past: [],
    future: [],
    coalesceKey: null,
    dirty: false,
    fileName,
    ui: { ...fresh, windows: s.ui.windows, topZ: s.ui.topZ, browserOpen: s.ui.browserOpen, browserWidth: s.ui.browserWidth, mainSnap: s.ui.mainSnap },
    transport: { ...s.transport, songStart: 0, patternStart: 0 },
  });
  setUi((d) => {
    for (const key of Object.keys(d.windows)) {
      if (key.startsWith('channel:') || key.startsWith('effect:')) delete d.windows[key];
    }
  });
}

export function markSaved(fileName: string | null): void {
  useStore.setState({ dirty: false, fileName });
}

// ---------------------------------------------------------------------------
// Lookup helpers usable inside recipes

function channelOf(d: Draft<Project>, id: Id): Draft<Channel> | undefined {
  return d.channels.find((c) => c.id === id);
}

function patternOf(d: Draft<Project>, id: Id): Draft<Pattern> | undefined {
  return d.patterns.find((p) => p.id === id);
}

function notesOf(d: Draft<Project>, patternId: Id, channelId: Id): Draft<Note>[] | undefined {
  const p = patternOf(d, patternId);
  if (!p) return undefined;
  if (!p.notes[channelId]) p.notes[channelId] = [];
  return p.notes[channelId];
}

/** Lowest insert track no channel is routed to yet (0 = master if all are taken). */
export function firstFreeInsert(project: Project): number {
  const used = new Set(project.channels.map((c) => c.mixerTrack));
  for (let i = 1; i < project.mixer.length; i++) if (!used.has(i)) return i;
  return 0;
}

function uniqueName(existing: string[], base: string): string {
  if (!existing.includes(base)) return base;
  for (let i = 2; ; i++) {
    const name = `${base} ${i}`;
    if (!existing.includes(name)) return name;
  }
}

// ---------------------------------------------------------------------------
// Project-level settings

export function setBpm(bpm: number, opts?: EditOptions): void {
  const v = Math.round(Math.min(MAX_BPM, Math.max(MIN_BPM, bpm)) * 1000) / 1000;
  edit((d) => {
    d.bpm = v;
  }, opts);
}

export function setSwing(swing: number, opts?: EditOptions): void {
  edit((d) => {
    d.swing = Math.min(1, Math.max(0, swing));
  }, opts);
}

export function setBeatsPerBar(beats: number): void {
  const b = Math.round(Math.min(16, Math.max(1, beats)));
  edit((d) => {
    d.beatsPerBar = b;
    for (const p of d.patterns) p.minLength = Math.max(ticksPerBar(b), Math.ceil(p.minLength / ticksPerBar(b)) * ticksPerBar(b));
  });
}

export function renameProject(name: string): void {
  edit((d) => {
    d.name = name.trim() || 'Untitled';
  });
}

// ---------------------------------------------------------------------------
// Samples

export function registerSample(info: SampleInfo): void {
  edit((d) => {
    d.samples[info.id] = info;
  });
}

// ---------------------------------------------------------------------------
// Channels

export function addChannel(channel: Channel, opts: { select?: boolean; autoMixer?: boolean; samples?: SampleInfo[] } = {}): Id {
  const project = useStore.getState().project;
  const ch = structuredClone(channel);
  if (opts.autoMixer !== false && ch.mixerTrack === 0) ch.mixerTrack = firstFreeInsert(project);
  ch.name = uniqueName(project.channels.map((c) => c.name), ch.name);
  edit((d) => {
    for (const info of opts.samples ?? []) d.samples[info.id] = info;
    d.channels.push(ch);
    const track = d.mixer[ch.mixerTrack];
    if (ch.mixerTrack > 0 && track && /^Insert \d+$/.test(track.name)) {
      track.name = ch.name;
      track.color = ch.color;
    }
  });
  if (opts.select !== false) selectChannel(ch.id);
  return ch.id;
}

export function addFactoryChannel(key: string): Id {
  const project = useStore.getState().project;
  return addChannel(createFactoryChannel(key, { color: paletteColor(project.channels.length) }), {
    samples: [factorySampleInfo(key)],
  });
}

export function addSynthChannel(presetId?: string): Id {
  const project = useStore.getState().project;
  const preset = presetId ? findPreset(presetId) : undefined;
  return addChannel(
    createSynthChannel({
      name: preset?.name ?? 'Synth',
      params: preset?.params,
      color: paletteColor(project.channels.length + 3),
    }),
  );
}

export function selectChannel(id: Id | null): void {
  setUi((d) => {
    d.selectedChannelId = id;
    if (id) d.pianoRollChannelId = id;
  });
}

export function deleteChannel(id: Id): void {
  edit((d) => {
    d.channels = d.channels.filter((c) => c.id !== id);
    for (const p of d.patterns) delete p.notes[id];
    d.clips = d.clips.filter((c) => !((c.kind === 'audio' || c.kind === 'automation') && c.channelId === id));
  });
  const s = useStore.getState();
  useStore.setState({ ui: reconcileUi(s.ui, s.project) });
}

export function cloneChannel(id: Id): Id | null {
  const s = useStore.getState();
  const src = s.project.channels.find((c) => c.id === id);
  if (!src) return null;
  const copy: Channel = { ...structuredClone(src), id: makeId('ch'), name: `${src.name} copy` };
  if (copy.kind === 'sampler') delete copy.audioClip;
  const index = s.project.channels.findIndex((c) => c.id === id);
  edit((d) => {
    d.channels.splice(index + 1, 0, copy as Draft<Channel>);
    for (const p of d.patterns) {
      const notes = p.notes[id];
      if (notes) p.notes[copy.id] = notes.map((n) => ({ ...n, id: makeId('n') }));
    }
  });
  selectChannel(copy.id);
  return copy.id;
}

export function moveChannel(id: Id, delta: number): void {
  edit((d) => {
    const i = d.channels.findIndex((c) => c.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= d.channels.length) return;
    const [ch] = d.channels.splice(i, 1);
    d.channels.splice(j, 0, ch);
  });
}

type ChannelPatch = Partial<Pick<Channel, 'name' | 'color' | 'volume' | 'pan' | 'muted' | 'mixerTrack'>>;

export function setChannelProps(id: Id, patch: ChannelPatch, opts?: EditOptions): void {
  edit((d) => {
    const ch = channelOf(d, id);
    if (!ch) return;
    if (patch.name !== undefined) ch.name = patch.name.trim() || ch.name;
    if (patch.color !== undefined) ch.color = patch.color;
    if (patch.volume !== undefined) ch.volume = Math.min(1, Math.max(0, patch.volume));
    if (patch.pan !== undefined) ch.pan = Math.min(1, Math.max(-1, patch.pan));
    if (patch.muted !== undefined) ch.muted = patch.muted;
    if (patch.mixerTrack !== undefined) ch.mixerTrack = Math.min(d.mixer.length - 1, Math.max(0, Math.round(patch.mixerTrack)));
  }, opts);
}

export function toggleChannelMute(id: Id): void {
  const ch = useStore.getState().project.channels.find((c) => c.id === id);
  if (ch) setChannelProps(id, { muted: !ch.muted });
}

/** Solo: mute every other channel; soloing the only audible channel again unmutes all. */
export function soloChannel(id: Id): void {
  edit((d) => {
    const others = d.channels.filter((c) => c.id !== id);
    const alreadySolo = others.every((c) => c.muted) && !channelOf(d, id)?.muted;
    for (const c of d.channels) c.muted = alreadySolo ? false : c.id !== id;
  });
}

export function updateSynth(id: Id, recipe: (p: Draft<SynthParams>) => void, opts?: EditOptions): void {
  edit((d) => {
    const ch = channelOf(d, id);
    if (ch && ch.kind === 'synth') recipe(ch.synth);
  }, opts);
}

export function updateSampler(id: Id, recipe: (p: Draft<SamplerParams>) => void, opts?: EditOptions): void {
  edit((d) => {
    const ch = channelOf(d, id);
    if (ch && ch.kind === 'sampler') recipe(ch.sampler);
  }, opts);
}

export function applySynthPreset(id: Id, presetId: string): void {
  const preset = findPreset(presetId);
  if (!preset) return;
  edit((d) => {
    const ch = channelOf(d, id);
    if (ch && ch.kind === 'synth') ch.synth = structuredClone(preset.params);
  });
}

/** Points a sampler channel at another sample (registering the sample info). */
export function setChannelSample(id: Id, info: SampleInfo, rootKey?: number): void {
  edit((d) => {
    d.samples[info.id] = info;
    const ch = channelOf(d, id);
    if (!ch || ch.kind !== 'sampler') return;
    const oldKey = ch.sampler.rootKey;
    ch.sampler.sampleId = info.id;
    if (rootKey !== undefined && rootKey !== oldKey) {
      ch.sampler.rootKey = rootKey;
      // Keep existing steps on the new step key.
      for (const p of d.patterns) for (const n of p.notes[id] ?? []) if (n.key === oldKey) n.key = rootKey;
    }
    if (/^(Sampler|Empty)/.test(ch.name)) ch.name = info.name;
  });
}

// ---------------------------------------------------------------------------
// Steps and notes

export function setStep(patternId: Id, channelId: Id, step: number, on: boolean, opts?: EditOptions): void {
  const project = useStore.getState().project;
  const channel = project.channels.find((c) => c.id === channelId);
  if (!channel) return;
  const key = stepKey(channel);
  const start = step * TICKS_PER_STEP;
  edit((d) => {
    const notes = notesOf(d, patternId, channelId);
    if (!notes) return;
    const existing = notes.findIndex((n) => n.start === start && n.key === key);
    if (on && existing < 0) {
      notes.push({ id: makeId('n'), key, start, length: TICKS_PER_STEP, velocity: DEFAULT_VELOCITY });
      notes.sort((a, b) => a.start - b.start || a.key - b.key);
    } else if (!on && existing >= 0) {
      notes.splice(existing, 1);
    }
  }, opts);
}

export function isStepOn(project: Project, patternId: Id, channelId: Id, step: number): boolean {
  const channel = project.channels.find((c) => c.id === channelId);
  const pattern = findPattern(project, patternId);
  if (!channel || !pattern) return false;
  const key = stepKey(channel);
  return (pattern.notes[channelId] ?? []).some((n) => n.start === step * TICKS_PER_STEP && n.key === key);
}

export function toggleStep(patternId: Id, channelId: Id, step: number): void {
  const on = isStepOn(useStore.getState().project, patternId, channelId, step);
  setStep(patternId, channelId, step, !on);
}

/** Replaces the channel's steps with one every `every` steps (pattern-wide). */
export function fillSteps(patternId: Id, channelId: Id, every: number, stepCount: number): void {
  const project = useStore.getState().project;
  const channel = project.channels.find((c) => c.id === channelId);
  if (!channel || every < 1) return;
  const key = stepKey(channel);
  edit((d) => {
    const notes = notesOf(d, patternId, channelId);
    if (!notes) return;
    const kept = notes.filter((n) => !(n.key === key && n.start % TICKS_PER_STEP === 0 && n.length <= TICKS_PER_STEP));
    for (let i = 0; i < stepCount; i += every) {
      kept.push({ id: makeId('n'), key, start: i * TICKS_PER_STEP, length: TICKS_PER_STEP, velocity: DEFAULT_VELOCITY });
    }
    kept.sort((a, b) => a.start - b.start || a.key - b.key);
    const p = patternOf(d, patternId);
    if (p) p.notes[channelId] = kept;
  });
}

/** Shifts all notes of a channel by whole steps, wrapping around the pattern (FL: Rotate left/right). */
export function rotateSteps(patternId: Id, channelId: Id, delta: number): void {
  const project = useStore.getState().project;
  const pattern = findPattern(project, patternId);
  if (!pattern) return;
  const len = patternLength(pattern, project.beatsPerBar);
  edit((d) => {
    const notes = notesOf(d, patternId, channelId);
    if (!notes) return;
    for (const n of notes) n.start = (((n.start + delta * TICKS_PER_STEP) % len) + len) % len;
    notes.sort((a, b) => a.start - b.start || a.key - b.key);
  });
}

export function addNotes(patternId: Id, channelId: Id, notes: Omit<Note, 'id'>[], opts?: EditOptions): Id[] {
  const ids = notes.map(() => makeId('n'));
  edit((d) => {
    const list = notesOf(d, patternId, channelId);
    if (!list) return;
    notes.forEach((n, i) => list.push({ ...n, id: ids[i] }));
    list.sort((a, b) => a.start - b.start || a.key - b.key);
  }, opts);
  return ids;
}

export function updateNotes(
  patternId: Id,
  channelId: Id,
  recipe: (notes: Draft<Note>[]) => void,
  opts?: EditOptions,
): void {
  edit((d) => {
    const list = notesOf(d, patternId, channelId);
    if (!list) return;
    recipe(list);
    for (const n of list) {
      n.key = Math.min(127, Math.max(0, Math.round(n.key)));
      n.start = Math.max(0, Math.round(n.start));
      n.length = Math.max(1, Math.round(n.length));
      n.velocity = Math.min(1, Math.max(0, n.velocity));
    }
    list.sort((a, b) => a.start - b.start || a.key - b.key);
  }, opts);
}

export function deleteNotes(patternId: Id, channelId: Id, ids: Id[], opts?: EditOptions): void {
  if (ids.length === 0) return;
  const set = new Set(ids);
  edit((d) => {
    const p = patternOf(d, patternId);
    if (!p || !p.notes[channelId]) return;
    p.notes[channelId] = p.notes[channelId].filter((n) => !set.has(n.id));
  }, opts);
}

/** FL Studio's quick legato (Ctrl+L): each note (of the selection, or all) lasts until the next note starts. */
export function legatoNotes(patternId: Id, channelId: Id, selected: ReadonlySet<Id>): void {
  updateNotes(patternId, channelId, (list) => {
    const chosen = list.filter((n) => selected.size === 0 || selected.has(n.id));
    const starts = [...new Set(chosen.map((n) => n.start))].sort((a, b) => a - b);
    for (const n of chosen) {
      const next = starts.find((t) => t > n.start);
      if (next !== undefined) n.length = next - n.start;
    }
  });
}

export function clearChannelNotes(patternId: Id, channelId: Id): void {
  edit((d) => {
    const p = patternOf(d, patternId);
    if (p) delete p.notes[channelId];
  });
}

// ---------------------------------------------------------------------------
// Patterns

export function selectPattern(id: Id): void {
  setUi((d) => {
    d.selectedPatternId = id;
  });
}

export function addPattern(): Id {
  const project = useStore.getState().project;
  const name = uniqueName(project.patterns.map((p) => p.name), `Pattern ${project.patterns.length + 1}`);
  const pattern = createPattern(name, paletteColor(project.patterns.length + 5), project.beatsPerBar);
  edit((d) => {
    d.patterns.push(pattern);
  });
  selectPattern(pattern.id);
  return pattern.id;
}

export function clonePattern(id: Id): Id | null {
  const project = useStore.getState().project;
  const src = findPattern(project, id);
  if (!src) return null;
  const copy: Pattern = {
    ...structuredClone(src),
    id: makeId('pat'),
    name: uniqueName(project.patterns.map((p) => p.name), `${src.name} copy`),
  };
  for (const list of Object.values(copy.notes)) for (const n of list) n.id = makeId('n');
  const index = project.patterns.findIndex((p) => p.id === id);
  edit((d) => {
    d.patterns.splice(index + 1, 0, copy);
  });
  selectPattern(copy.id);
  return copy.id;
}

export function deletePattern(id: Id): void {
  const before = useStore.getState().project;
  const index = before.patterns.findIndex((p) => p.id === id);
  if (index < 0) return;
  edit((d) => {
    d.patterns.splice(index, 1);
    d.clips = d.clips.filter((c) => !(c.kind === 'pattern' && c.patternId === id));
    if (d.patterns.length === 0) d.patterns.push(createPattern('Pattern 1', paletteColor(5), d.beatsPerBar));
  });
  const after = useStore.getState().project;
  selectPattern(after.patterns[Math.min(index, after.patterns.length - 1)].id);
}

export function renamePattern(id: Id, name: string): void {
  edit((d) => {
    const p = patternOf(d, id);
    if (p && name.trim()) p.name = name.trim();
  });
}

export function setPatternColor(id: Id, color: string): void {
  edit((d) => {
    const p = patternOf(d, id);
    if (p) p.color = color;
  });
}

/** Sets the minimum pattern length in bars. */
export function setPatternBars(id: Id, bars: number): void {
  edit((d) => {
    const p = patternOf(d, id);
    if (p) p.minLength = Math.max(1, Math.round(bars)) * ticksPerBar(d.beatsPerBar);
  });
}

export function stepPattern(delta: number): void {
  const s = useStore.getState();
  const list = s.project.patterns;
  const i = list.findIndex((p) => p.id === s.ui.selectedPatternId);
  const next = list[Math.min(list.length - 1, Math.max(0, i + delta))];
  if (next) selectPattern(next.id);
}

// ---------------------------------------------------------------------------
// Playlist

/** Clip without id; distributes over the clip union. */
export type NewClip = Clip extends infer C ? (C extends Clip ? Omit<C, 'id'> : never) : never;

export function addClip(clip: NewClip, opts?: EditOptions): Id {
  const id = makeId('clip');
  edit((d) => {
    d.clips.push({ ...clip, id } as Draft<Clip>);
  }, opts);
  return id;
}

/** Places the given pattern as a clip at `start` on `trackId`, sized to the pattern. */
export function placePatternClip(patternId: Id, trackId: Id, start: number, opts?: EditOptions): Id | null {
  const project = useStore.getState().project;
  const pattern = findPattern(project, patternId);
  if (!pattern) return null;
  return addClip({ kind: 'pattern', patternId, trackId, start, length: patternLength(pattern, project.beatsPerBar), offset: 0 }, opts);
}

export function updateClips(recipe: (clips: Draft<Clip>[]) => void, opts?: EditOptions): void {
  edit((d) => {
    recipe(d.clips);
    for (const c of d.clips) {
      c.start = Math.max(0, Math.round(c.start));
      c.length = Math.max(1, Math.round(c.length));
      c.offset = Math.max(0, Math.round(c.offset));
    }
  }, opts);
}

export function deleteClips(ids: Id[], opts?: EditOptions): void {
  if (ids.length === 0) return;
  const set = new Set(ids);
  edit((d) => {
    d.clips = d.clips.filter((c) => !set.has(c.id));
  }, opts);
}

/** Mutes or unmutes clips; without `muted` each clip toggles. */
export function setClipsMuted(ids: Id[], muted?: boolean, opts?: EditOptions): void {
  if (ids.length === 0) return;
  const set = new Set(ids);
  edit((d) => {
    for (const c of d.clips) {
      if (!set.has(c.id)) continue;
      const next = muted ?? !c.muted;
      if (next) c.muted = true;
      else delete c.muted;
    }
  }, opts);
}

/** Points a pattern clip at another pattern (FL Studio: clip menu › Select source pattern). */
export function setClipPattern(clipId: Id, patternId: Id): void {
  const project = useStore.getState().project;
  const pattern = findPattern(project, patternId);
  if (!pattern) return;
  edit((d) => {
    const c = d.clips.find((x) => x.id === clipId);
    if (c?.kind === 'pattern') c.patternId = patternId;
  });
}

/** Gives a pattern clip its own copy of the pattern (FL Studio: clip menu › Make unique). */
export function makeClipUnique(clipId: Id): Id | null {
  const project = useStore.getState().project;
  const clip = project.clips.find((c) => c.id === clipId);
  if (clip?.kind !== 'pattern') return null;
  const src = findPattern(project, clip.patternId);
  if (!src) return null;
  const copy: Pattern = {
    ...structuredClone(src),
    id: makeId('pat'),
    name: uniqueName(project.patterns.map((p) => p.name), `${src.name} #2`),
  };
  for (const list of Object.values(copy.notes)) for (const n of list) n.id = makeId('n');
  const index = project.patterns.findIndex((p) => p.id === src.id);
  edit((d) => {
    d.patterns.splice(index + 1, 0, copy);
    const c = d.clips.find((x) => x.id === clipId);
    if (c?.kind === 'pattern') c.patternId = copy.id;
  });
  selectPattern(copy.id);
  return copy.id;
}

export function toggleTrackMute(trackId: Id): void {
  edit((d) => {
    const t = d.tracks.find((x) => x.id === trackId);
    if (t) t.muted = !t.muted;
  });
}

export function renameTrack(trackId: Id, name: string): void {
  edit((d) => {
    const t = d.tracks.find((x) => x.id === trackId);
    if (t && name.trim()) t.name = name.trim();
  });
}

export function addTracks(count: number): void {
  edit((d) => {
    const start = d.tracks.length;
    for (let i = 0; i < count; i++) d.tracks.push(createPlaylistTrack(start + i));
  });
}

/** Inserts an empty playlist track at `index` (FL Studio: track menu › Insert one). */
export function insertTrack(index: number): void {
  edit((d) => {
    const at = Math.max(0, Math.min(d.tracks.length, index));
    const names = d.tracks.map((t) => t.name);
    const track = createPlaylistTrack(d.tracks.length);
    track.name = uniqueName(names, `Track ${at + 1}`);
    d.tracks.splice(at, 0, track);
  });
}

/** Removes a playlist track and its clips; at least one track stays. */
export function deleteTrack(trackId: Id): void {
  edit((d) => {
    const i = d.tracks.findIndex((t) => t.id === trackId);
    if (i < 0) return;
    d.tracks.splice(i, 1);
    d.clips = d.clips.filter((c) => c.trackId !== trackId);
    if (d.tracks.length === 0) d.tracks.push(createPlaylistTrack(0));
  });
}

/** Copies a playlist track with its clips below the original (FL Studio: track menu › Clone). */
export function cloneTrack(trackId: Id): void {
  edit((d) => {
    const i = d.tracks.findIndex((t) => t.id === trackId);
    if (i < 0) return;
    const src = d.tracks[i];
    const copy = { ...createPlaylistTrack(d.tracks.length), name: uniqueName(d.tracks.map((t) => t.name), src.name), muted: src.muted };
    d.tracks.splice(i + 1, 0, copy);
    for (const c of d.clips.filter((x) => x.trackId === trackId)) d.clips.push({ ...c, id: makeId('clip'), trackId: copy.id });
  });
}

export function moveTrack(trackId: Id, delta: number): void {
  edit((d) => {
    const i = d.tracks.findIndex((t) => t.id === trackId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= d.tracks.length) return;
    const [t] = d.tracks.splice(i, 1);
    d.tracks.splice(j, 0, t);
  });
}

/** Mutes or unmutes every clip on a track (FL Studio: Mute all clips / Unmute all clips). */
export function setTrackClipsMuted(trackId: Id, muted: boolean): void {
  const ids = useStore.getState().project.clips.filter((c) => c.trackId === trackId).map((c) => c.id);
  setClipsMuted(ids, muted);
}

// ---------------------------------------------------------------------------
// Mixer

type MixerPatch = Partial<Pick<MixerTrack, 'name' | 'color' | 'volume' | 'pan' | 'muted' | 'solo'>>;

export function setMixerTrackProps(index: number, patch: MixerPatch, opts?: EditOptions): void {
  edit((d) => {
    const t = d.mixer[index];
    if (!t) return;
    if (patch.name !== undefined && patch.name.trim()) t.name = patch.name.trim();
    if (patch.color !== undefined) t.color = patch.color;
    if (patch.volume !== undefined) t.volume = Math.min(1, Math.max(0, patch.volume));
    if (patch.pan !== undefined) t.pan = Math.min(1, Math.max(-1, patch.pan));
    if (patch.muted !== undefined) t.muted = patch.muted;
    if (patch.solo !== undefined && index > 0) t.solo = patch.solo;
  }, opts);
}

export function selectMixerTrack(index: number): void {
  setUi((d) => {
    d.selectedMixerTrack = index;
  });
}

export function addMixerTrack(): number {
  const project = useStore.getState().project;
  if (project.mixer.length - 1 >= MAX_INSERTS) return -1;
  const index = project.mixer.length;
  edit((d) => {
    d.mixer.push(createMixerTrack(index));
  });
  return index;
}

/** FL Studio has ten effect slots per mixer track. */
export const MAX_EFFECT_SLOTS = 10;

export function addEffect(trackIndex: number, type: EffectType): Id | null {
  const track = useStore.getState().project.mixer[trackIndex];
  if (!track || track.effects.length >= MAX_EFFECT_SLOTS) return null;
  const id = makeId('fx');
  edit((d) => {
    d.mixer[trackIndex].effects.push({ id, type, enabled: true, params: defaultEffectParams(type) });
  });
  return id;
}

export function replaceEffect(trackIndex: number, slotId: Id, type: EffectType): void {
  edit((d) => {
    const slot = d.mixer[trackIndex]?.effects.find((e) => e.id === slotId);
    if (slot && slot.type !== type) {
      slot.type = type;
      slot.params = defaultEffectParams(type);
      delete slot.plugin;
    }
  });
}

/** Adds a third-party effect plugin (hosted by the native engine) to a mixer track. */
export function addPluginEffect(trackIndex: number, plugin: PluginInstanceData): Id | null {
  const track = useStore.getState().project.mixer[trackIndex];
  if (!track || track.effects.length >= MAX_EFFECT_SLOTS) return null;
  const id = makeId('fx');
  edit((d) => {
    d.mixer[trackIndex].effects.push({ id, type: 'plugin', enabled: true, params: {}, plugin: structuredClone(plugin) });
  });
  return id;
}

export function replaceEffectWithPlugin(trackIndex: number, slotId: Id, plugin: PluginInstanceData): void {
  edit((d) => {
    const slot = d.mixer[trackIndex]?.effects.find((e) => e.id === slotId);
    if (!slot) return;
    slot.type = 'plugin';
    slot.params = {};
    slot.plugin = structuredClone(plugin);
  });
}

/** Adds a plugin instrument as a new channel (routed to a free mixer track). */
export function addPluginChannel(plugin: PluginInstanceData): Id {
  const project = useStore.getState().project;
  return addChannel(createPluginChannel(plugin, { color: paletteColor(project.channels.length + 4) }));
}

/**
 * Stores plugin states captured from the engine. Not an undoable edit: it only refreshes opaque
 * data right before saving.
 */
export function storePluginStates(states: Record<string, string>): void {
  const s = useStore.getState();
  const next = produce(s.project, (d) => {
    for (const ch of d.channels) {
      const st = states[`ch:${ch.id}`];
      if (ch.kind === 'plugin' && st !== undefined) ch.plugin.state = st;
    }
    for (const t of d.mixer) {
      for (const slot of t.effects) {
        const st = states[`fx:${slot.id}`];
        if (slot.plugin && st !== undefined) slot.plugin.state = st;
      }
    }
  });
  if (next !== s.project) useStore.setState({ project: next });
}

// ---------------------------------------------------------------------------
// Recording inputs (FL Studio: mixer track "Input" menu and the record-arm dot)

/** Sets a track's audio input; choosing an input arms the track, like in FL Studio. */
export function setTrackInput(index: number, input: TrackInput | null): void {
  edit((d) => {
    const t = d.mixer[index];
    if (!t || index === 0) return;
    t.input = input;
    t.armed = input !== null;
  });
}

export function setTrackArmed(index: number, armed: boolean): void {
  edit((d) => {
    const t = d.mixer[index];
    if (t && index > 0) t.armed = armed;
  });
}

export function disarmAllTracks(): void {
  edit((d) => {
    for (const t of d.mixer) t.armed = false;
  });
}

export function removeEffect(trackIndex: number, slotId: Id): void {
  edit((d) => {
    const t = d.mixer[trackIndex];
    if (t) t.effects = t.effects.filter((e) => e.id !== slotId);
  });
  const s = useStore.getState();
  useStore.setState({ ui: reconcileUi(s.ui, s.project) });
}

export function toggleEffect(trackIndex: number, slotId: Id): void {
  edit((d) => {
    const slot = d.mixer[trackIndex]?.effects.find((e) => e.id === slotId);
    if (slot) slot.enabled = !slot.enabled;
  });
}

export function moveEffect(trackIndex: number, slotId: Id, delta: number): void {
  edit((d) => {
    const list = d.mixer[trackIndex]?.effects;
    if (!list) return;
    const i = list.findIndex((e) => e.id === slotId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return;
    const [slot] = list.splice(i, 1);
    list.splice(j, 0, slot);
  });
}

export function setEffectParam(trackIndex: number, slotId: Id, key: string, value: number, opts?: EditOptions): void {
  edit((d) => {
    const slot = d.mixer[trackIndex]?.effects.find((e) => e.id === slotId);
    if (slot) slot.params[key] = value;
  }, opts);
}

// ---------------------------------------------------------------------------
// Transport helpers (state only; the audio engine reacts to these)

export function setPlayMode(mode: PlayMode): void {
  setTransport({ mode });
}

export function togglePlayMode(): void {
  const s: AppState = useStore.getState();
  setTransport({ mode: s.transport.mode === 'pattern' ? 'song' : 'pattern' });
}
