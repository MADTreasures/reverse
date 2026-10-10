/** Window menu: palettes shown or hidden, and brought to the front of their stack. */
import { hasPalette, locate } from '../model/paletteLayout';
import type { PaletteId } from '../model/palettes';
import { currentLayout, ensureInLayout, raiseFloatingPalette } from './paletteLayoutStore';
import { getState, setState } from './store';

/** Shown: in the layout and not hidden. */
export const isPaletteShown = (id: PaletteId, hidden = getState().hiddenPalettes) => !hidden.includes(id) && hasPalette(currentLayout(), id);

/** The tab in front of a stack: the one chosen last, else the first shown. */
export function frontTab(stackId: string, tabs: PaletteId[], s = getState()): PaletteId | undefined {
  const shown = tabs.filter((t) => !s.hiddenPalettes.includes(t));
  const chosen = s.paletteTabs[stackId] as PaletteId | undefined;
  return chosen && shown.includes(chosen) ? chosen : shown[0];
}

/** Shown and in front of its stack (or floating). */
export function isPaletteFront(id: PaletteId): boolean {
  if (!isPaletteShown(id)) return false;
  const at = locate(currentLayout(), id);
  return at !== null && ('floating' in at || frontTab(at.stack.id, at.stack.tabs) === id);
}

/** Shows a palette and brings its tab to the front of its stack (a floating one to the front). */
export function showPalette(id: PaletteId): void {
  ensureInLayout(id);
  const at = locate(currentLayout(), id);
  setState((s) => ({
    hiddenPalettes: s.hiddenPalettes.filter((x) => x !== id),
    ...(at && 'stack' in at ? { paletteTabs: { ...s.paletteTabs, [at.stack.id]: id } } : {}),
    palettesHidden: false,
  }));
  if (at && 'floating' in at) raiseFloatingPalette(id);
}

export const hidePalette = (id: PaletteId) => setState((s) => ({ hiddenPalettes: s.hiddenPalettes.includes(id) ? s.hiddenPalettes : [...s.hiddenPalettes, id] }));

/** Window > (palette name): a shown palette is hidden, a hidden one shown in front. */
export function togglePalette(id: PaletteId): void {
  if (isPaletteShown(id)) hidePalette(id);
  else showPalette(id);
}

/** A palette stack's tab chosen by clicking it. */
export const setPaletteTab = (stack: string, id: string) => setState((s) => ({ paletteTabs: { ...s.paletteTabs, [stack]: id } }));
