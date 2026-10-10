/**
 * The palette layout of each workspace (palette docks and floating palettes), kept in the browser's
 * storage; changing it from the docks, the floating palettes and the Window menu.
 */
import { create } from 'zustand';
import {
  defaultLayout,
  ensurePalette,
  locate,
  movePalette,
  raiseFloating,
  sanitizeLayout,
  setColumnWidth,
  setStackHeight,
  toggleColumnHidden,
  updateFloating,
  type DropTarget,
  type FloatingPalette,
  type PaletteLayout,
} from '../model/paletteLayout';
import type { PaletteId } from '../model/palettes';
import type { WorkspaceId } from '../paint/tools';
import { getState, setState } from './store';

const KEY = 'mad-paint:palette-layout';

function load(): Record<WorkspaceId, PaletteLayout> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Record<string, unknown> | null;
    return { default: sanitizeLayout(raw?.default, 'default'), classic: sanitizeLayout(raw?.classic, 'classic') };
  } catch {
    return { default: defaultLayout('default'), classic: defaultLayout('classic') };
  }
}

export const usePaletteLayout = create<{ layouts: Record<WorkspaceId, PaletteLayout> }>(() => ({ layouts: load() }));

/** The layout of the current workspace. */
export const currentLayout = (ws: WorkspaceId = getState().workspace, s = usePaletteLayout.getState()): PaletteLayout => s.layouts[ws];

function change(f: (l: PaletteLayout) => PaletteLayout): void {
  const ws = getState().workspace;
  const before = currentLayout(ws);
  const after = f(before);
  if (after === before) return;
  usePaletteLayout.setState((s) => ({ layouts: { ...s.layouts, [ws]: after } }));
  try {
    localStorage.setItem(KEY, JSON.stringify(usePaletteLayout.getState().layouts));
  } catch {
    // Not kept.
  }
}

/** A palette dropped on a dock, a stack's title bar or outside the docks; it comes to the front. */
export function dropPalette(id: PaletteId, target: DropTarget): void {
  if (currentLayout().lockPosition && target.kind !== 'float') return;
  change((l) => movePalette(l, id, target));
  const at = locate(currentLayout(), id);
  if (at && 'stack' in at) setState((s) => ({ paletteTabs: { ...s.paletteTabs, [at.stack.id]: id } }));
}

/** A palette the Window menu shows that is in no dock: back where the workspace has it, or floating. */
export const ensureInLayout = (id: PaletteId) => change((l) => ensurePalette(l, id, getState().workspace, { x: Math.round(window.innerWidth / 2 - 125), y: 140 }));

export const resizeStack = (stackId: string, height: number) => change((l) => setStackHeight(l, stackId, height));
export const resizeColumn = (columnId: string, width: number) => change((l) => setColumnWidth(l, columnId, width));
export const toggleDock = (columnId: string) => change((l) => toggleColumnHidden(l, columnId));
export const changeFloating = (id: PaletteId, patch: Partial<Omit<FloatingPalette, 'id'>>) => change((l) => updateFloating(l, id, patch));
export const raiseFloatingPalette = (id: PaletteId) => change((l) => raiseFloating(l, id));

/** Window > Palette dock: Lock palette height, Fix the width of palette dock, Lock palette position. */
export const toggleDockLock = (key: 'lockHeight' | 'fixWidth' | 'lockPosition') => change((l) => ({ ...l, [key]: !l[key] }));

/** Window > Workspace > Restore default palette layout. */
export const restoreDefaultLayout = () => change(() => defaultLayout(getState().workspace));
