/**
 * Quick Access palette state, like the reference's: its sets of buttons, the set shown, the view
 * (tiles or a list), how the set list shows (tabs or a pop-up), the search bar and its history,
 * and the button selected while Quick Access Settings is open. Kept in the browser's storage.
 */
import { create } from 'zustand';
import {
  addItem,
  addToHistory,
  defaultQuickSets,
  deleteQuickSet,
  hasItem,
  isQuickView,
  moveItem,
  moveItemToSet,
  moveQuickSet,
  newQuickSet,
  removeItem,
  renameQuickSet,
  sanitizeQuickSets,
  setItemName,
  type QuickItem,
  type QuickSet,
  type QuickView,
} from '../paint/quickAccess';

export type SetListMode = 'buttons' | 'popup';

interface QuickAccessState {
  sets: QuickSet[];
  current: string;
  view: QuickView;
  /** Palette menu > How to display set lists: Button (tabs) or Pop-up. */
  setList: SetListMode;
  /** Palette menu > Show search bar. */
  searchShown: boolean;
  history: string[];
  /** The selected button of the shown set (Quick Access Settings acts on it). */
  selected: number | null;
}

const KEY = 'mad-paint:quick-access';

type Kept = Omit<QuickAccessState, 'selected'>;

function load(): Kept {
  const defaults: Kept = { sets: defaultQuickSets(), current: 'qa-set-1', view: 'tile-m', setList: 'buttons', searchShown: true, history: [] };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Record<keyof Kept, unknown>> | null;
    if (!raw) return defaults;
    const sets = sanitizeQuickSets(raw.sets);
    return {
      sets,
      current: sets.some((s) => s.id === raw.current) ? (raw.current as string) : sets[0].id,
      view: isQuickView(raw.view) ? raw.view : defaults.view,
      setList: raw.setList === 'popup' ? 'popup' : 'buttons',
      searchShown: raw.searchShown !== false,
      history: Array.isArray(raw.history) ? raw.history.filter((h): h is string => typeof h === 'string').slice(0, 20) : [],
    };
  } catch {
    return defaults;
  }
}

export const useQuickAccess = create<QuickAccessState>(() => ({ ...load(), selected: null }));

const get = () => useQuickAccess.getState();

function save(): void {
  try {
    const { selected: _sel, ...kept } = get();
    localStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    // Not kept (private window or full storage).
  }
}

const change = (patch: Partial<QuickAccessState>) => {
  useQuickAccess.setState(patch);
  save();
};

export const shownQuickSet = (s = get()): QuickSet => s.sets.find((x) => x.id === s.current) ?? s.sets[0];

// ------------------------------------------------------------------ sets

export const selectQuickSet = (id: string) => change({ current: id, selected: null });

export function createQuickSet(name: string): void {
  const r = newQuickSet(get().sets, name);
  change({ sets: r.sets, current: r.id, selected: null });
}

export function deleteShownQuickSet(id = get().current): void {
  const sets = deleteQuickSet(get().sets, id);
  if (sets.length !== get().sets.length) change({ sets, current: get().current === id ? sets[0].id : get().current, selected: null });
}

export const renameShownQuickSet = (name: string, id = get().current) => change({ sets: renameQuickSet(get().sets, id, name) });

/** Ctrl + drag of a set tab: dropped before the tab at `index`. */
export const moveQuickSetTab = (id: string, index: number) => change({ sets: moveQuickSet(get().sets, id, index) });

// ------------------------------------------------------------------ buttons

export const selectQuickButton = (index: number | null) => useQuickAccess.setState({ selected: index });

/**
 * Adds a button to a set (the shown one by default): at `index`, or else under the selected
 * button, or at the end. A function a set has already is not added twice (false).
 */
export function addQuickButton(item: QuickItem, setId = get().current, index?: number): boolean {
  const s = get();
  const set = s.sets.find((x) => x.id === setId);
  if (!set || hasItem(set, item)) return false;
  const at = index ?? (setId === s.current && s.selected !== null ? s.selected + 1 : undefined);
  // A button selected (in Quick Access Settings): the new one is selected, the next goes under it.
  change({ sets: addItem(s.sets, setId, item, at), selected: setId === s.current && s.selected !== null && at !== undefined ? at : s.selected });
  return true;
}

/** Add Separator: under the selected button (or at the end); buttons added next go under it. */
export function addQuickSeparator(): void {
  const s = get();
  const at = s.selected !== null ? s.selected + 1 : shownQuickSet(s).items.length;
  const sets = addItem(s.sets, s.current, { kind: 'separator' }, at);
  const added = shownQuickSet({ ...s, sets }).items.length > shownQuickSet(s).items.length;
  change({ sets, selected: added && s.selected !== null ? at : s.selected });
}

/** Delete: the selected button (or the given one). */
export function deleteQuickButton(index = get().selected): void {
  if (index === null) return;
  const s = get();
  change({ sets: removeItem(s.sets, s.current, index), selected: null });
}

export const renameQuickButton = (index: number, name: string) => change({ sets: setItemName(get().sets, get().current, index, name) });

/** A button dropped before the one at `to` (of the shown set), or onto another set's tab. */
export function moveQuickButton(from: number, to: number, toSet = get().current): void {
  const s = get();
  const sets = toSet === s.current ? moveItem(s.sets, s.current, from, to) : moveItemToSet(s.sets, s.current, from, toSet);
  change({ sets, selected: null });
}

/** A button dropped past the last set tab: a new set with it. */
export function moveQuickButtonToNewSet(from: number): void {
  const s = get();
  const r = newQuickSet(s.sets, `Set ${s.sets.length + 1}`);
  change({ sets: moveItemToSet(r.sets, s.current, from, r.id), selected: null });
}

/** Restore default layout. */
export const restoreQuickDefaults = () => {
  const sets = defaultQuickSets();
  change({ sets, current: sets[0].id, selected: null });
};

// ------------------------------------------------------------------ view and search

export const setQuickView = (view: QuickView) => change({ view });
export const setQuickSetList = (setList: SetListMode) => change({ setList });
export const toggleQuickSearchBar = () => change({ searchShown: !get().searchShown });
export const rememberSearch = (q: string) => change({ history: addToHistory(get().history, q) });
export const clearSearchHistory = () => change({ history: [] });
