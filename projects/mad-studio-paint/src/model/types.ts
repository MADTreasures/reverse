/** Document model of MAD Studio Paint. Pixel data lives in surfaces (see engine/surfaces.ts), keyed by layer id. */

export type Id = string;

export type BlendMode =
  | 'normal'
  | 'darken'
  | 'multiply'
  | 'color-burn'
  | 'linear-burn'
  | 'subtract'
  | 'lighten'
  | 'screen'
  | 'color-dodge'
  | 'glow-dodge'
  | 'add'
  | 'add-glow'
  | 'overlay'
  | 'soft-light'
  | 'hard-light'
  | 'difference'
  | 'vivid-light'
  | 'linear-light'
  | 'pin-light'
  | 'hard-mix'
  | 'exclusion'
  | 'darker-color'
  | 'lighter-color'
  | 'divide'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

/** Folders only: 'pass-through' composites children directly onto what is below. */
export type FolderBlendMode = BlendMode | 'pass-through';

interface LayerBase {
  id: Id;
  name: string;
  visible: boolean;
  /** 0..1 */
  opacity: number;
  /** Clip to the layer below ("clip at layer below"). */
  clip: boolean;
  /** Prevents any edit. */
  locked: boolean;
  /** Fill / auto-select read this layer when "reference layer" is chosen. */
  reference: boolean;
  /** Draft layers are hidden in exports. */
  draft: boolean;
}

export interface RasterLayer extends LayerBase {
  kind: 'raster';
  blend: BlendMode;
  /** Lock transparent pixels: painting only changes existing pixels. */
  lockAlpha: boolean;
}

export interface FolderLayer extends LayerBase {
  kind: 'folder';
  blend: FolderBlendMode;
  expanded: boolean;
  /** Top-most child first, like the layer panel. */
  children: Layer[];
}

export type Layer = RasterLayer | FolderLayer;

export interface PaperSettings {
  visible: boolean;
  color: string;
}

export interface PaintDocument {
  id: Id;
  name: string;
  width: number;
  height: number;
  /** Pixels per inch, stored for print exports. */
  dpi: number;
  paper: PaperSettings;
  /** Top-most layer first, like the layer panel. */
  layers: Layer[];
}
