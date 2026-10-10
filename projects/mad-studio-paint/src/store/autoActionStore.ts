/**
 * Auto Action palette state, recording and playback, like the reference's: while an auto action
 * records, every command run (menus, shortcuts, command bar) is added to it – a command whose
 * dialog was confirmed is kept with Change settings on, filters and Expand / Shrink selected area
 * keep their settings. Playing runs the enabled steps from the selected one (or the first) on;
 * a step with Change settings on opens its dialog and the playback goes on when it closes. The
 * sets are kept in the browser's storage.
 */
import { create } from 'zustand';
import {
  addAction,
  addStep,
  defaultActionSets,
  deleteAction,
  deleteStep,
  duplicateAction,
  duplicateSet,
  duplicateStep,
  exportSetFile,
  importSetFile,
  moveAction,
  moveActionToSet,
  moveStep,
  newSet,
  newStep,
  renameAction,
  sanitizeActionSets,
  stepsToRun,
  updateStep,
  type ActionOp,
  type ActionSet,
  type ActionStep,
} from '../paint/autoActions';
import type { FilterId } from '../paint/filters';
import { openFiles, saveFile } from '../platform/platform';
import { openDialog, openFilterDialog, toast, useOverlays } from '../ui/overlays';
import { applyFilterValues } from './filterActions';
import * as actions from './actions';
import { getState, setState } from './store';

interface AutoActionState {
  sets: ActionSet[];
  /** The set shown. */
  current: string;
  /** The selected auto action and command. */
  selected: string | null;
  selectedStep: string | null;
  /** Auto actions shown with their commands. */
  expanded: string[];
  /** The auto action being recorded. */
  recording: string | null;
  playing: boolean;
  /** Palette menu: Button mode (the auto actions as buttons that play them). */
  buttonMode: boolean;
  /** Palette menu: Show the action setting bar (the set above the list) / Show command bar (the buttons below). */
  settingBar: boolean;
  commandBar: boolean;
}

type Kept = Pick<AutoActionState, 'sets' | 'current' | 'buttonMode' | 'settingBar' | 'commandBar'>;

const KEY = 'mad-paint:auto-actions';

function load(): Kept {
  const view = { buttonMode: false, settingBar: true, commandBar: true };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { sets?: unknown; current?: unknown; buttonMode?: unknown; settingBar?: unknown; commandBar?: unknown } | null;
    const sets = sanitizeActionSets(raw?.sets);
    if (sets.length)
      return {
        sets,
        current: sets.some((s) => s.id === raw?.current) ? (raw!.current as string) : sets[0].id,
        buttonMode: raw?.buttonMode === true,
        settingBar: raw?.settingBar !== false,
        commandBar: raw?.commandBar !== false,
      };
  } catch {
    // Storage blocked or broken: the defaults.
  }
  const sets = defaultActionSets();
  return { sets, current: sets[0].id, ...view };
}

export const useAutoActions = create<AutoActionState>(() => ({ ...load(), selected: null, selectedStep: null, expanded: [], recording: null, playing: false }));

const get = () => useAutoActions.getState();
const set = useAutoActions.setState;

function save(): void {
  try {
    const { sets, current, buttonMode, settingBar, commandBar } = get();
    localStorage.setItem(KEY, JSON.stringify({ sets, current, buttonMode, settingBar, commandBar }));
  } catch {
    // Not kept (private window or full storage).
  }
}

/** Palette menu switches. */
export function toggleAutoActionView(key: 'buttonMode' | 'settingBar' | 'commandBar'): void {
  set((s) => ({ [key]: !s[key] }) as Partial<AutoActionState>);
  save();
}

const changeSets = (sets: ActionSet[], patch: Partial<AutoActionState> = {}) => {
  set({ sets, ...patch });
  save();
};

export const currentSet = (s = get()): ActionSet | undefined => s.sets.find((x) => x.id === s.current) ?? s.sets[0];
export const findAction = (id: string | null, s = get()) => currentSet(s)?.actions.find((a) => a.id === id) ?? null;

// ------------------------------------------------------------------ editing

export const selectSet = (id: string) => {
  set({ current: id, selected: null, selectedStep: null });
  save();
};
export const selectAction = (id: string | null, step: string | null = null) => set({ selected: id, selectedStep: step });
export const toggleActionExpanded = (id: string) => set((s) => ({ expanded: s.expanded.includes(id) ? s.expanded.filter((x) => x !== id) : [...s.expanded, id] }));

export function createActionSet(name: string): void {
  const r = newSet(get().sets, name);
  changeSets(r.sets, { current: r.id, selected: r.sets.at(-1)?.actions[0]?.id ?? null, selectedStep: null });
}

export function duplicateActionSet(): void {
  const r = duplicateSet(get().sets, get().current);
  if (r.id) changeSets(r.sets, { current: r.id });
}

export function renameActionSet(name: string): void {
  const n = name.trim().slice(0, 60);
  if (n) changeSets(get().sets.map((s) => (s.id === get().current ? { ...s, name: n } : s)));
}

export function deleteActionSet(): void {
  const s = get();
  if (s.sets.length <= 1) return;
  const sets = s.sets.filter((x) => x.id !== s.current);
  changeSets(sets, { current: sets[0].id, selected: null, selectedStep: null });
}

/** Add auto action: a new one after the selected one, selected. */
export function newAutoAction(name = 'Auto action'): string {
  const s = get();
  const r = addAction(s.sets, s.current, name, s.selected ?? undefined);
  changeSets(r.sets, { selected: r.id, selectedStep: null });
  return r.id;
}

export function renameAutoAction(id: string, name: string): void {
  changeSets(renameAction(get().sets, get().current, id, name));
}

export function duplicateAutoAction(id = get().selected): void {
  if (!id) return;
  const r = duplicateAction(get().sets, get().current, id);
  if (r.id) changeSets(r.sets, { selected: r.id });
}

/** An auto action dropped before the one at `index` of the set. */
export function moveAutoAction(id: string, index: number): void {
  changeSets(moveAction(get().sets, get().current, id, index));
}

/** A command dropped before the one at `index` of an auto action (its own or another). */
export function moveCommand(fromAction: string, stepId: string, toAction: string, index: number): void {
  changeSets(moveStep(get().sets, get().current, fromAction, stepId, toAction, index), { selected: toAction, selectedStep: stepId });
}

/** Duplicate command: the selected command. */
export function duplicateCommand(): void {
  const s = get();
  if (!s.selected || !s.selectedStep) return;
  const r = duplicateStep(s.sets, s.current, s.selected, s.selectedStep);
  if (r.id) changeSets(r.sets, { selectedStep: r.id });
}

/** Move / Copy auto action to a different set. */
export function sendAutoActionToSet(toSet: string, copy: boolean): void {
  const s = get();
  if (!s.selected) return;
  changeSets(moveActionToSet(s.sets, s.current, s.selected, toSet, copy), copy ? {} : { selected: null, selectedStep: null });
}

/** Export set: the shown set to an auto action set file. */
export async function exportActionSet(): Promise<void> {
  const set = currentSet();
  if (!set) return;
  await saveFile(new TextEncoder().encode(exportSetFile(set)), `${set.name}.madactions`, [{ name: 'Auto action set', extensions: ['madactions'] }], null, 'application/json');
}

/** Import set: an auto action set file, added and shown. */
export async function importActionSet(file?: { name: string; data: Uint8Array }): Promise<void> {
  const f = file ?? (await openFiles([{ name: 'Auto action set', extensions: ['madactions', 'json'] }]))?.[0];
  if (!f) return;
  const r = importSetFile(get().sets, new TextDecoder().decode(f.data));
  if (!r) {
    toast(`"${f.name}" is not an auto action set file`, 'error');
    return;
  }
  changeSets(r.sets, { current: r.id, selected: null, selectedStep: null });
  toast(`Imported "${r.sets.at(-1)!.name}"`);
}

/** Delete auto action: the selected command, or else the selected auto action. */
export function deleteSelected(): void {
  const s = get();
  if (!s.selected) return;
  if (s.selectedStep) changeSets(deleteStep(s.sets, s.current, s.selected, s.selectedStep), { selectedStep: null });
  else changeSets(deleteAction(s.sets, s.current, s.selected), { selected: null });
}

export function setStepSwitch(actionId: string, stepId: string, patch: Partial<Pick<ActionStep, 'enabled' | 'showDialog'>>): void {
  changeSets(updateStep(get().sets, get().current, actionId, stepId, patch));
}

/** The run switch of a whole auto action: all its commands on or off. */
export function setActionEnabled(actionId: string, enabled: boolean): void {
  const a = findAction(actionId);
  if (!a) return;
  let sets = get().sets;
  for (const st of a.steps) sets = updateStep(sets, get().current, actionId, st.id, { enabled });
  changeSets(sets);
}

// ------------------------------------------------------------------ recording

/** Commands that are not recorded (files, the interface, undo and the auto actions themselves). */
const NOT_RECORDED = new Set(['undo', 'redo', 'new', 'open', 'save', 'saveAs', 'saveDuplicate', 'saveDuplicatePsd', 'saveDuplicatePsb', 'preferences', 'shortcuts', 'about', 'togglePalettes', 'toggleMenuBar', 'workspaceDefault', 'workspaceClassic', 'toggleTimeline', 'win-material', 'quickAccessSettings']);

/** Start / Stop recording auto action (the selected one; none selected: a new one). */
export function toggleRecording(): void {
  const s = get();
  if (s.recording) {
    set({ recording: null });
    return;
  }
  if (s.playing) return;
  const id = s.selected ?? newAutoAction();
  set((x) => ({ recording: id, selected: id, selectedStep: null, expanded: x.expanded.includes(id) ? x.expanded : [...x.expanded, id] }));
}

/** A command a dialog of was opened while recording: kept if its dialog changes the document. */
let pending: { id: string; label: string; version: number; recorded: boolean } | null = null;

/** Records an operation with its settings (filters, Expand / Shrink selected area). */
export function recordOp(label: string, op: ActionOp): void {
  const s = get();
  if (!s.recording) return;
  if (pending) pending.recorded = true;
  changeSets(addStep(s.sets, s.current, s.recording, newStep(label, op)));
}

/**
 * Called after every command run: records it while an auto action records. `dialogBefore` is the
 * dialog open before the command ran: a command that opened a dialog is recorded when it closes.
 */
export function noteCommand(id: string, label: string, dialogBefore: unknown = null): void {
  if (!get().recording || NOT_RECORDED.has(id) || id.startsWith('win-')) return;
  const dialog = useOverlays.getState().dialog;
  if (dialog && dialog !== dialogBefore) {
    pending = { id, label, version: getState().historyVersion, recorded: false };
    return;
  }
  recordOp(label, { kind: 'command', id });
}

// The dialog of a recorded command closed: confirmed (the document changed) and not recorded with its settings → recorded, showing its dialog when played.
useOverlays.subscribe((o, prev) => {
  if (!pending || o.dialog || !prev.dialog) return;
  const p = pending;
  pending = null;
  if (p.recorded || getState().historyVersion === p.version || !get().recording) return;
  const s = get();
  const step = { ...newStep(p.label, { kind: 'command', id: p.id }), showDialog: true };
  changeSets(addStep(s.sets, s.current, s.recording!, step));
});

// ------------------------------------------------------------------ playback

let runCommand: (id: string) => Promise<void> = async () => {};
/** The command runner (set by the commands module, which records through this one). */
export const setCommandRunner = (fn: (id: string) => Promise<void>) => {
  runCommand = fn;
};

/** Settings a filter dialog opens with (set by the dialog module). */
let presetFilter: (id: FilterId, values: Record<string, number | string | boolean>) => void = () => {};
export const setFilterPreset = (fn: typeof presetFilter) => {
  presetFilter = fn;
};

/** Resolves when no dialog is open. */
function dialogClosed(): Promise<void> {
  if (!useOverlays.getState().dialog) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = useOverlays.subscribe((o) => {
      if (o.dialog) return;
      stop();
      resolve();
    });
  });
}

async function runStep(step: ActionStep): Promise<void> {
  const op = step.op;
  if (op.kind === 'command') {
    await runCommand(op.id);
  } else if (op.kind === 'filter') {
    if (step.showDialog) {
      presetFilter(op.filter as FilterId, op.values);
      openFilterDialog(op.filter as FilterId);
    } else applyFilterValues(op.filter as FilterId, op.values);
  } else if (step.showDialog) openDialog(op.px >= 0 ? 'expandSelection' : 'shrinkSelection');
  else actions.growSelection(op.px, op.rounded ? 'rounded' : 'sharp');
  await dialogClosed();
}

/**
 * Plays an auto action: its enabled commands from the selected command (of this action) on. Not
 * while recording.
 */
export async function playAction(id = get().selected, from: string | null = get().selected === id ? get().selectedStep : null): Promise<void> {
  const s = get();
  const action = findAction(id) ?? s.sets.flatMap((x) => x.actions).find((a) => a.id === id) ?? null;
  if (!action || s.recording || s.playing) return;
  set({ playing: true });
  try {
    for (const step of stepsToRun(action, from)) await runStep(step);
  } finally {
    set({ playing: false });
  }
  if (!getState().hint) setState({ hint: `Played "${action.name}"` });
}

/** All auto actions of all sets (for Quick Access). */
export const allAutoActions = () => get().sets.flatMap((s) => s.actions.map((a) => ({ set: s, action: a })));
