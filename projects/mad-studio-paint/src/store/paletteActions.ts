/** Window menu: palettes shown or hidden, and brought to the front of their stack. */
import { isLayerDockTab, stackOf, type PaletteId } from '../model/palettes';
import { getState, setState } from './store';

export const isPaletteShown = (id: PaletteId, hidden = getState().hiddenPalettes) => !hidden.includes(id);

/** Shows a palette and brings its tab to the front of its stack. */
export function showPalette(id: PaletteId): void {
  const s = getState();
  setState({
    hiddenPalettes: s.hiddenPalettes.filter((x) => x !== id),
    ...(isLayerDockTab(id) ? { layerDockTab: id } : { paletteTabs: { ...s.paletteTabs, [stackOf(id, s.workspace)]: id } }),
    palettesHidden: false,
  });
}

/** Window > (palette name): a shown palette is hidden, a hidden one shown in front. */
export function togglePalette(id: PaletteId): void {
  if (isPaletteShown(id)) setState((s) => ({ hiddenPalettes: [...s.hiddenPalettes, id] }));
  else showPalette(id);
}

/** A palette stack's tab chosen by clicking it. */
export const setPaletteTab = (stack: string, id: string) => setState((s) => ({ paletteTabs: { ...s.paletteTabs, [stack]: id } }));
