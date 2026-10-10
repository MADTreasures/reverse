/**
 * The Command Bar's icons per workspace, like the reference's Command Bar Settings: commands,
 * tools, auto actions and drawing colours with separators; changed layouts are kept in the
 * browser's storage (none: the workspace's default), and the icon selected while Command Bar
 * Settings is open.
 */
import { create } from 'zustand';
import { addItem, hasItem, moveItem, removeItem, sanitizeQuickSets, setItemName, type QuickItem, type QuickSet } from '../paint/quickAccess';
import type { WorkspaceId } from '../paint/tools';
import { getState } from './store';

const cmd = (id: string): QuickItem => ({ kind: 'command', id });
const SEP: QuickItem = { kind: 'separator' };

/** The default icons of each workspace (as before the bar could be changed). */
export const DEFAULT_COMMAND_BARS: Record<WorkspaceId, QuickItem[]> = {
  default: [cmd('new'), cmd('open'), cmd('save'), SEP, cmd('undo'), cmd('redo'), SEP, cmd('clear'), cmd('fill'), cmd('transform'), SEP, cmd('flipViewH'), SEP, cmd('shortcuts')],
  classic: [
    cmd('new'),
    cmd('open'),
    cmd('save'),
    SEP,
    cmd('undo'),
    cmd('redo'),
    SEP,
    cmd('clear'),
    cmd('clearOutside'),
    cmd('fill'),
    cmd('transform'),
    SEP,
    cmd('deselect'),
    cmd('invertSelection'),
    cmd('selectionBorder'),
    SEP,
    cmd('snapRuler'),
    cmd('snapSpecial'),
    SEP,
    cmd('shortcuts'),
  ],
};

interface CommandBarState {
  /** Changed layouts per workspace. */
  bars: Partial<Record<WorkspaceId, QuickItem[]>>;
  /** The icon selected while Command Bar Settings is open. */
  selected: number | null;
}

const KEY = 'mad-paint:command-bar';

function load(): CommandBarState['bars'] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Record<string, unknown> | null;
    const bars: CommandBarState['bars'] = {};
    for (const ws of ['default', 'classic'] as const) {
      // The quick access sanitiser checks every item (a set of one).
      if (Array.isArray(raw?.[ws])) bars[ws] = sanitizeQuickSets([{ id: ws, name: ws, items: raw[ws] }])[0].items;
    }
    return bars;
  } catch {
    return {};
  }
}

export const useCommandBar = create<CommandBarState>(() => ({ bars: load(), selected: null }));

const ws = (): WorkspaceId => getState().workspace;

/** The icons of a workspace's Command Bar. */
export const commandBarItems = (w: WorkspaceId = ws(), s = useCommandBar.getState()): QuickItem[] => s.bars[w] ?? DEFAULT_COMMAND_BARS[w];

function change(items: QuickItem[], selected: number | null = useCommandBar.getState().selected): void {
  const w = ws();
  const bars = { ...useCommandBar.getState().bars, [w]: items };
  useCommandBar.setState({ bars, selected });
  try {
    localStorage.setItem(KEY, JSON.stringify(bars));
  } catch {
    // Not kept.
  }
}

/** As a one-set list, for the Quick Access editing functions. */
const asSets = (): QuickSet[] => [{ id: 'bar', name: 'Command Bar', items: commandBarItems() }];
const items = (sets: QuickSet[]) => sets[0].items;

export const selectCommandBarIcon = (index: number | null) => useCommandBar.setState({ selected: index });

/** Add: to the right of the selected icon, or at the end (false: the bar has it already). */
export function addCommandBarIcon(item: QuickItem, index?: number): boolean {
  const bar: QuickSet = asSets()[0];
  if (hasItem(bar, item)) return false;
  const sel = useCommandBar.getState().selected;
  const at = index ?? (sel !== null ? sel + 1 : undefined);
  change(items(addItem(asSets(), 'bar', item, at)), sel !== null && at !== undefined ? at : sel);
  return true;
}

/** Add Separator: to the right of the selected icon (or at the end). */
export function addCommandBarSeparator(): void {
  const sel = useCommandBar.getState().selected;
  const before = commandBarItems().length;
  const next = items(addItem(asSets(), 'bar', { kind: 'separator' }, sel !== null ? sel + 1 : undefined));
  change(next, sel !== null && next.length > before ? sel + 1 : sel);
}

/** Delete: the selected icon (or the given one). */
export function deleteCommandBarIcon(index = useCommandBar.getState().selected): void {
  if (index !== null) change(items(removeItem(asSets(), 'bar', index)), null);
}

/** An icon dropped before the one at `to`. */
export const moveCommandBarIcon = (from: number, to: number) => change(items(moveItem(asSets(), 'bar', from, to)), null);

export const renameCommandBarIcon = (index: number, name: string) => change(items(setItemName(asSets(), 'bar', index, name)));

/** Restore default layout (of this workspace). */
export function restoreCommandBar(): void {
  const bars = { ...useCommandBar.getState().bars };
  delete bars[ws()];
  useCommandBar.setState({ bars, selected: null });
  try {
    localStorage.setItem(KEY, JSON.stringify(bars));
  } catch {
    // Not kept.
  }
}
