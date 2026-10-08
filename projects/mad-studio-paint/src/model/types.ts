/** Document model of MAD Studio Paint. Pixel data lives in surfaces (see engine/surfaces.ts), keyed by layer id. */
import type { LayerEffects } from '../paint/effects';
import type { Ruler } from '../paint/rulers';
import type { Correction } from '../paint/tonal';
import type { FrameBorder } from '../paint/frames';
import type { Balloon, TextBox } from '../paint/text';
import type { VectorStroke } from '../paint/vector';

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

/** Hides parts of a layer without erasing them. Its pixels live in a surface of their own. */
export interface LayerMask {
  /** Surface id. Alpha is the visibility: 255 shows the layer, 0 hides it. */
  id: Id;
  enabled: boolean;
  /** Moves and transforms together with the layer. */
  linked: boolean;
}

/** Where a layer's rulers apply: on every layer, on layers in the same folder, or only on this layer. */
export type RulerRange = 'all' | 'folder' | 'editing';

export interface LayerRulers {
  items: Ruler[];
  range: RulerRange;
  visible: boolean;
}

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
  mask?: LayerMask;
  /** Layer Property palette: border effect, layer colour. */
  effects?: LayerEffects;
  rulers?: LayerRulers;
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
  /** Frame border folder: the content shows only inside the panels, whose border is drawn on top. */
  frame?: FrameBorder;
}

/** Layer > New correction layer: corrects everything below it (in its folder) without changing pixels. */
export interface CorrectionLayer extends LayerBase {
  kind: 'correction';
  blend: BlendMode;
  correction: Correction;
}

/** Vector layer: lines stored as paths; the pixels are rendered from them (see engine). */
export interface VectorLayer extends LayerBase {
  kind: 'vector';
  blend: BlendMode;
  strokes: VectorStroke[];
  /** Changes with every edit of `strokes` (never reused), so rendered pixels can be cached. */
  rev: number;
}

/**
 * Text layer: text boxes, and speech balloons (with balloons it is shown as a balloon layer). The
 * pixels are rendered from them; balloons lie under the text.
 */
export interface TextLayer extends LayerBase {
  kind: 'text';
  blend: BlendMode;
  texts: TextBox[];
  balloons: Balloon[];
  /** Changes with every edit (never reused), so rendered pixels can be cached. */
  rev: number;
}

export type Layer = RasterLayer | FolderLayer | CorrectionLayer | VectorLayer | TextLayer;

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
