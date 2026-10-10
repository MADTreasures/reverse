/**
 * Which palettes there are, where each workspace stacks them, and which the Window menu shows or
 * hides (like the reference, Sub View, Intermediate Color, Approximate Color and Search Layer start
 * hidden). Showing a palette brings its tab to the front of its stack. Pure, unit tested.
 */
import type { WorkspaceId } from '../paint/tools';

export type PaletteId =
  | 'navigator'
  | 'subView'
  | 'colorWheel'
  | 'colorSlider'
  | 'colorSet'
  | 'intermediateColor'
  | 'approximateColor'
  | 'colorHistory'
  | 'layerProperty'
  | 'layer'
  | 'searchLayer'
  | 'history'
  | 'animationCels'
  | 'quickAccess'
  | 'autoAction';

/** The names in the Window menu, in its order. */
export const PALETTE_NAMES: [PaletteId, string][] = [
  ['colorWheel', 'Color Wheel'],
  ['colorSlider', 'Color Slider'],
  ['colorSet', 'Color Set'],
  ['intermediateColor', 'Intermediate Color'],
  ['approximateColor', 'Approximate Color'],
  ['colorHistory', 'Color History'],
  ['layerProperty', 'Layer Property'],
  ['layer', 'Layer'],
  ['searchLayer', 'Search Layer'],
  ['animationCels', 'Animation cels'],
  ['navigator', 'Navigator'],
  ['subView', 'Sub View'],
  ['history', 'History'],
  ['quickAccess', 'Quick Access'],
  ['autoAction', 'Auto Action'],
];

export const DEFAULT_HIDDEN_PALETTES: PaletteId[] = ['subView', 'intermediateColor', 'approximateColor', 'searchLayer', 'quickAccess', 'autoAction'];

/** The palette stack a palette is a tab of, in a workspace. */
export function stackOf(id: PaletteId, workspace: WorkspaceId): string {
  switch (id) {
    case 'navigator':
    case 'subView':
      return 'navigator';
    case 'layerProperty':
    case 'autoAction':
      return 'layerProperty';
    case 'layer':
    case 'searchLayer':
    case 'history':
    case 'animationCels':
      return 'layer';
    case 'colorWheel':
    case 'colorSlider':
      return workspace === 'classic' ? 'classicColor' : 'color';
    default:
      return workspace === 'classic' ? 'classicColor' : 'colorSet';
  }
}

/** The palettes stacked with the Layer palette: the front one is kept in `layerDockTab` (other commands open Animation cels there). */
export type LayerDockTab = 'layer' | 'history' | 'animationCels' | 'searchLayer';
export const isLayerDockTab = (id: PaletteId): id is LayerDockTab => id === 'layer' || id === 'history' || id === 'animationCels' || id === 'searchLayer';

export const isPaletteId = (v: unknown): v is PaletteId => PALETTE_NAMES.some(([id]) => id === v);
