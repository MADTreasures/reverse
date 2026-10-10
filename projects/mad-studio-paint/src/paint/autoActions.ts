/**
 * Auto actions, like the reference's: sets of auto actions, each a list of recorded commands that
 * can be played back. A command is a menu command, a filter with its settings, or Expand / Shrink
 * selected area with its width; each has a run switch (off: skipped) and a change settings switch
 * (on: its dialog opens when played). Pure, unit tested.
 */
import { FILTERS } from './filters';

export type ActionOp =
  /** A command of the menus, shortcuts or command bar (one with a dialog opens it when played). */
  | { kind: 'command'; id: string }
  /** A filter with its settings. */
  | { kind: 'filter'; filter: string; values: Record<string, number | string | boolean> }
  /** Expand (px > 0) or shrink (px < 0) the selected area. */
  | { kind: 'grow'; px: number; rounded: boolean };

export interface ActionStep {
  id: string;
  /** What it is, as the menu says. */
  label: string;
  op: ActionOp;
  /** Run switch: off, the step is skipped. */
  enabled: boolean;
  /** Change settings switch: the step's dialog opens when it is played. */
  showDialog: boolean;
}

export interface AutoAction {
  id: string;
  name: string;
  steps: ActionStep[];
}

export interface ActionSet {
  id: string;
  name: string;
  actions: AutoAction[];
}

let counter = 0;
/** A new id for sets, actions and steps. */
export const newActionId = (prefix: 'set' | 'act' | 'stp'): string => `${prefix}-${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The settings lines shown under a recorded command (as its dialog names them). */
export function stepDetails(op: ActionOp): string[] {
  if (op.kind === 'grow') return [`${op.px >= 0 ? 'Expanding' : 'Shrinking'} width : ${Math.abs(op.px)} px`, `${op.px >= 0 ? 'Expansion' : 'Shrinking'} type : ${op.rounded ? 'Rounded corner' : 'Square corner'}`];
  if (op.kind === 'filter') {
    const params = FILTERS.find((f) => f.id === op.filter)?.params ?? [];
    return Object.entries(op.values).map(([k, v]) => {
      const p = params.find((x) => x.key === k);
      const shown = typeof v === 'boolean' ? (v ? 'Yes' : 'No') : p?.kind === 'select' ? (p.options.find(([id]) => id === v)?.[1] ?? v) : v;
      return `${p?.label ?? k} : ${shown}`;
    });
  }
  return [];
}

export const newStep = (label: string, op: ActionOp): ActionStep => ({ id: newActionId('stp'), label, op, enabled: true, showDialog: false });

const mapAction = (sets: ActionSet[], setId: string, actionId: string, f: (a: AutoAction) => AutoAction): ActionSet[] =>
  sets.map((s) => (s.id === setId ? { ...s, actions: s.actions.map((a) => (a.id === actionId ? f(a) : a)) } : s));

/** Adds a recorded step at the end of an action. */
export const addStep = (sets: ActionSet[], setId: string, actionId: string, step: ActionStep): ActionSet[] => mapAction(sets, setId, actionId, (a) => ({ ...a, steps: [...a.steps, step] }));

/** Changes a step (switches). */
export const updateStep = (sets: ActionSet[], setId: string, actionId: string, stepId: string, patch: Partial<Pick<ActionStep, 'enabled' | 'showDialog'>>): ActionSet[] =>
  mapAction(sets, setId, actionId, (a) => ({ ...a, steps: a.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)) }));

export const deleteStep = (sets: ActionSet[], setId: string, actionId: string, stepId: string): ActionSet[] => mapAction(sets, setId, actionId, (a) => ({ ...a, steps: a.steps.filter((s) => s.id !== stepId) }));

/** Duplicate command: a copy right after it. */
export function duplicateStep(sets: ActionSet[], setId: string, actionId: string, stepId: string): { sets: ActionSet[]; id: string | null } {
  let id: string | null = null;
  const out = mapAction(sets, setId, actionId, (a) => {
    const i = a.steps.findIndex((s) => s.id === stepId);
    if (i < 0) return a;
    const copy = { ...a.steps[i], id: newActionId('stp') };
    id = copy.id;
    const steps = [...a.steps];
    steps.splice(i + 1, 0, copy);
    return { ...a, steps };
  });
  return { sets: out, id };
}

/** Moves a command (by drag and drop) to `index` of an auto action of the set, its own or another. */
export function moveStep(sets: ActionSet[], setId: string, fromAction: string, stepId: string, toAction: string, index: number): ActionSet[] {
  const set = sets.find((s) => s.id === setId);
  const from = set?.actions.find((a) => a.id === fromAction);
  const i = from?.steps.findIndex((s) => s.id === stepId) ?? -1;
  if (!from || i < 0 || !set!.actions.some((a) => a.id === toAction)) return sets;
  const step = from.steps[i];
  const at = fromAction === toAction && index > i ? index - 1 : index;
  return mapAction(deleteStep(sets, setId, fromAction, stepId), setId, toAction, (a) => {
    const steps = [...a.steps];
    steps.splice(Math.max(0, Math.min(steps.length, at)), 0, step);
    return { ...a, steps };
  });
}

export const renameAction = (sets: ActionSet[], setId: string, actionId: string, name: string): ActionSet[] => mapAction(sets, setId, actionId, (a) => ({ ...a, name: name.trim().slice(0, 80) || a.name }));

/** A new empty action at the end of a set (or after `after`). */
export function addAction(sets: ActionSet[], setId: string, name: string, after?: string): { sets: ActionSet[]; id: string } {
  const action: AutoAction = { id: newActionId('act'), name: name.trim().slice(0, 80) || 'Auto action', steps: [] };
  return {
    id: action.id,
    sets: sets.map((s) => {
      if (s.id !== setId) return s;
      const i = after ? s.actions.findIndex((a) => a.id === after) : -1;
      const actions = [...s.actions];
      actions.splice(i < 0 ? actions.length : i + 1, 0, action);
      return { ...s, actions };
    }),
  };
}

export const deleteAction = (sets: ActionSet[], setId: string, actionId: string): ActionSet[] => sets.map((s) => (s.id === setId ? { ...s, actions: s.actions.filter((a) => a.id !== actionId) } : s));

/** A copy of an action (new ids) right after it. */
export function duplicateAction(sets: ActionSet[], setId: string, actionId: string): { sets: ActionSet[]; id: string | null } {
  let id: string | null = null;
  const out = sets.map((s) => {
    if (s.id !== setId) return s;
    const i = s.actions.findIndex((a) => a.id === actionId);
    if (i < 0) return s;
    const a = s.actions[i];
    const copy: AutoAction = { id: newActionId('act'), name: `${a.name} copy`, steps: a.steps.map((st) => ({ ...st, id: newActionId('stp') })) };
    id = copy.id;
    const actions = [...s.actions];
    actions.splice(i + 1, 0, copy);
    return { ...s, actions };
  });
  return { sets: out, id };
}

/** Moves an action to `index` in its set (an index before the move: it lands before that action). */
export function moveAction(sets: ActionSet[], setId: string, actionId: string, index: number): ActionSet[] {
  return sets.map((s) => {
    if (s.id !== setId) return s;
    const i = s.actions.findIndex((a) => a.id === actionId);
    if (i < 0) return s;
    const actions = [...s.actions];
    const [a] = actions.splice(i, 1);
    actions.splice(Math.max(0, Math.min(actions.length, index > i ? index - 1 : index)), 0, a);
    return { ...s, actions };
  });
}

/** Move (or Copy) auto action to a different set: at the end of that set; a copy gets new ids. */
export function moveActionToSet(sets: ActionSet[], fromSet: string, actionId: string, toSet: string, copy: boolean): ActionSet[] {
  const action = sets.find((s) => s.id === fromSet)?.actions.find((a) => a.id === actionId);
  if (!action || fromSet === toSet || !sets.some((s) => s.id === toSet)) return sets;
  const moved: AutoAction = copy ? { ...action, id: newActionId('act'), steps: action.steps.map((st) => ({ ...st, id: newActionId('stp') })) } : action;
  return sets.map((s) => {
    if (s.id === toSet) return { ...s, actions: [...s.actions, moved] };
    if (s.id === fromSet && !copy) return { ...s, actions: s.actions.filter((a) => a.id !== actionId) };
    return s;
  });
}

/** The steps a playback runs: the enabled ones, from `fromStep` on (all when it is not one of them). */
export function stepsToRun(action: AutoAction, fromStep?: string | null): ActionStep[] {
  const i = fromStep ? action.steps.findIndex((s) => s.id === fromStep) : -1;
  return action.steps.slice(Math.max(0, i)).filter((s) => s.enabled);
}

/** Create new set: it starts with one empty auto action (like the reference). */
export function newSet(sets: ActionSet[], name: string): { sets: ActionSet[]; id: string } {
  const set: ActionSet = { id: newActionId('set'), name: name.trim().slice(0, 60) || 'Set', actions: [{ id: newActionId('act'), name: 'Auto action', steps: [] }] };
  return { sets: [...sets, set], id: set.id };
}

export function duplicateSet(sets: ActionSet[], setId: string): { sets: ActionSet[]; id: string | null } {
  const s = sets.find((x) => x.id === setId);
  if (!s) return { sets, id: null };
  const copy: ActionSet = { id: newActionId('set'), name: `${s.name} copy`, actions: s.actions.map((a) => ({ ...a, id: newActionId('act'), steps: a.steps.map((st) => ({ ...st, id: newActionId('stp') })) })) };
  return { sets: [...sets, copy], id: copy.id };
}

const text = (v: unknown, max: number, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback);
const ID = /^[A-Za-z0-9_-]{1,64}$/;

function sanitizeOp(raw: unknown): ActionOp | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === 'command' && typeof r.id === 'string' && /^[\w:-]{1,80}$/.test(r.id)) return { kind: 'command', id: r.id };
  if (r.kind === 'filter' && typeof r.filter === 'string' && /^[\w-]{1,60}$/.test(r.filter)) {
    const values: Record<string, number | string | boolean> = {};
    if (r.values && typeof r.values === 'object')
      for (const [k, v] of Object.entries(r.values as Record<string, unknown>).slice(0, 40))
        if (/^\w{1,40}$/.test(k) && (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 200))) values[k] = v;
    return { kind: 'filter', filter: r.filter, values };
  }
  if (r.kind === 'grow' && typeof r.px === 'number' && Number.isFinite(r.px)) return { kind: 'grow', px: Math.max(-1000, Math.min(1000, Math.round(r.px))), rounded: r.rounded !== false };
  return null;
}

/** Auto action sets from storage, every value checked. */
export function sanitizeActionSets(raw: unknown): ActionSet[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const fresh = (id: unknown, prefix: 'set' | 'act' | 'stp') => {
    const ok = typeof id === 'string' && ID.test(id) && !seen.has(id) ? id : newActionId(prefix);
    seen.add(ok);
    return ok;
  };
  return raw.slice(0, 100).flatMap((s): ActionSet[] => {
    if (!s || typeof s !== 'object') return [];
    const r = s as Record<string, unknown>;
    const actions = (Array.isArray(r.actions) ? r.actions : []).slice(0, 500).flatMap((a): AutoAction[] => {
      if (!a || typeof a !== 'object') return [];
      const ar = a as Record<string, unknown>;
      const steps = (Array.isArray(ar.steps) ? ar.steps : []).slice(0, 500).flatMap((st): ActionStep[] => {
        if (!st || typeof st !== 'object') return [];
        const sr = st as Record<string, unknown>;
        const op = sanitizeOp(sr.op);
        return op ? [{ id: fresh(sr.id, 'stp'), label: text(sr.label, 120, 'Command'), op, enabled: sr.enabled !== false, showDialog: sr.showDialog === true }] : [];
      });
      return [{ id: fresh(ar.id, 'act'), name: text(ar.name, 80, 'Auto action'), steps }];
    });
    return [{ id: fresh(r.id, 'set'), name: text(r.name, 60, 'Set'), actions }];
  });
}

/** Export set: an auto action set file (this program's own JSON format). */
export const AUTO_ACTION_FILE = 'mad-paint-auto-actions';

export function exportSetFile(set: ActionSet): string {
  return JSON.stringify({ format: AUTO_ACTION_FILE, version: 1, set }, null, 1);
}

/** Import set: a set read from a file, added with new ids (null: not such a file). */
export function importSetFile(sets: ActionSet[], text: string): { sets: ActionSet[]; id: string } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const r = raw as { format?: unknown; set?: unknown } | null;
  if (!r || r.format !== AUTO_ACTION_FILE) return null;
  const [read] = sanitizeActionSets([r.set]);
  if (!read) return null;
  const set: ActionSet = { ...read, id: newActionId('set'), actions: read.actions.map((a) => ({ ...a, id: newActionId('act'), steps: a.steps.map((st) => ({ ...st, id: newActionId('stp') })) })) };
  return { sets: [...sets, set], id: set.id };
}

const cmd = (id: string, label: string): ActionStep => ({ id: `stp-default-${id}-${label.length}`, label, op: { kind: 'command', id }, enabled: true, showDialog: false });

/** This program's own default set (made of its commands). */
export function defaultActionSets(): ActionSet[] {
  const action = (id: string, name: string, steps: ActionStep[]): AutoAction => ({ id, name, steps: steps.map((s, i) => ({ ...s, id: `${id}-${i}` })) });
  return [
    {
      id: 'set-default',
      name: 'Default',
      actions: [
        action('act-default-clipped', 'New clipped raster layer', [cmd('newRasterLayer', 'New raster layer'), cmd('clip', 'Clip to layer below')]),
        action('act-default-draft', 'New draft layer', [cmd('newRasterLayer', 'New raster layer'), cmd('draft', 'Set as draft layer')]),
        action('act-default-folder', 'Folder with the current layer', [cmd('groupLayer', 'Create folder and insert layer')]),
        action('act-default-cutmove', 'Cut and paste the selection on a new layer', [cmd('cut', 'Cut'), cmd('paste', 'Paste')]),
        action('act-default-grow1', 'Expand the selection by 1 px and fill', [
          { id: 'g1', label: 'Expand selected area', op: { kind: 'grow', px: 1, rounded: true }, enabled: true, showDialog: false },
          cmd('fill', 'Fill'),
        ]),
        action('act-default-grow5', 'Expand the selection by 5 px and fill', [
          { id: 'g5', label: 'Expand selected area', op: { kind: 'grow', px: 5, rounded: true }, enabled: true, showDialog: false },
          cmd('fill', 'Fill'),
        ]),
        action('act-default-soft', 'Soft glow copy', [
          cmd('duplicateLayer', 'Duplicate layer'),
          { id: 'f', label: 'Gaussian blur', op: { kind: 'filter', filter: 'gaussianBlur', values: { strength: 24 } }, enabled: true, showDialog: false },
        ]),
      ],
    },
  ];
}
