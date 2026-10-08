import type { BlendMode, FolderBlendMode } from './types';

/** Layer blending modes in the order of the layer palette's list. */
export const BLEND_MODES: { id: BlendMode; label: string }[] = [
  { id: 'normal', label: 'Normal' },
  { id: 'darken', label: 'Darken' },
  { id: 'multiply', label: 'Multiply' },
  { id: 'color-burn', label: 'Color burn' },
  { id: 'linear-burn', label: 'Linear burn' },
  { id: 'subtract', label: 'Subtract' },
  { id: 'lighten', label: 'Lighten' },
  { id: 'screen', label: 'Screen' },
  { id: 'color-dodge', label: 'Color dodge' },
  { id: 'glow-dodge', label: 'Glow dodge' },
  { id: 'add', label: 'Add' },
  { id: 'add-glow', label: 'Add (Glow)' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'soft-light', label: 'Soft light' },
  { id: 'hard-light', label: 'Hard light' },
  { id: 'difference', label: 'Difference' },
  { id: 'vivid-light', label: 'Vivid light' },
  { id: 'linear-light', label: 'Linear light' },
  { id: 'pin-light', label: 'Pin light' },
  { id: 'hard-mix', label: 'Hard mix' },
  { id: 'exclusion', label: 'Exclusion' },
  { id: 'darker-color', label: 'Darker color' },
  { id: 'lighter-color', label: 'Lighter color' },
  { id: 'divide', label: 'Divide' },
  { id: 'hue', label: 'Hue' },
  { id: 'saturation', label: 'Saturation' },
  { id: 'color', label: 'Color' },
  { id: 'luminosity', label: 'Brightness' },
];

export const FOLDER_BLEND_MODES: { id: FolderBlendMode; label: string }[] = [{ id: 'pass-through', label: 'Through' }, ...BLEND_MODES];

/** Modes Canvas 2D implements natively; the others are computed per pixel (see engine/blendPixels.ts). */
const NATIVE: Partial<Record<FolderBlendMode, GlobalCompositeOperation>> = {
  normal: 'source-over',
  'pass-through': 'source-over',
  darken: 'darken',
  multiply: 'multiply',
  'color-burn': 'color-burn',
  lighten: 'lighten',
  screen: 'screen',
  'color-dodge': 'color-dodge',
  // Add (Glow) adds the colour weighted by its alpha: exactly Canvas 2D's "lighter".
  'add-glow': 'lighter',
  overlay: 'overlay',
  'soft-light': 'soft-light',
  'hard-light': 'hard-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
};

/** Canvas 2D compositing operation for a mode, or null if the mode needs per-pixel blending. */
export function nativeOp(mode: FolderBlendMode): GlobalCompositeOperation | null {
  return NATIVE[mode] ?? null;
}

/** Compositing operation for modes known to be native (normal for anything else). */
export function compositeOp(mode: FolderBlendMode): GlobalCompositeOperation {
  return nativeOp(mode) ?? 'source-over';
}

export function isBlendMode(x: unknown): x is BlendMode {
  return BLEND_MODES.some((m) => m.id === x);
}
