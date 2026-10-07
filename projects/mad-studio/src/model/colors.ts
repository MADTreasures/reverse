/** Palette used for channels, patterns and mixer tracks. */
export const PALETTE = [
  '#e8a33d',
  '#e0705a',
  '#d65f8f',
  '#a874e0',
  '#6d82e3',
  '#4ea9d9',
  '#43b8a0',
  '#7cc35b',
  '#c4c24b',
  '#d98b52',
  '#8f9ba6',
  '#e3c07a',
];

export const PALETTE_NAMES = ['Amber', 'Coral', 'Rose', 'Violet', 'Indigo', 'Sky', 'Teal', 'Green', 'Olive', 'Copper', 'Slate', 'Sand'];

export function paletteColor(index: number): string {
  return PALETTE[((index % PALETTE.length) + PALETTE.length) % PALETTE.length];
}
