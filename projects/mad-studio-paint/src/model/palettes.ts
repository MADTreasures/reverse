/**
 * Which palettes there are and which the Window menu shows or hides (like the reference, Sub View,
 * Intermediate Color, Approximate Color, Search Layer, Quick Access and Auto Action start hidden).
 * Where they are is the palette layout (paletteLayout.ts). Pure, unit tested.
 */

export type PaletteId =
  | 'subTool'
  | 'toolProperty'
  | 'brushSize'
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
  ['toolProperty', 'Tool Property'],
  ['subTool', 'Sub Tool'],
  ['brushSize', 'Brush Size'],
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

export const isPaletteId = (v: unknown): v is PaletteId => PALETTE_NAMES.some(([id]) => id === v);
