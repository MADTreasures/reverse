/** Document model of MAD Studio Paint. Pixel data lives in surfaces (see engine/surfaces.ts), keyed by layer id. */
import type { AnimationTrack, Timeline } from '../paint/animation';
import type { Clip } from '../paint/clips';
import type { Keyframe, KeyTrack } from '../paint/keyframes';
import type { LightLayer, LightTable } from '../paint/lightTable';
import type { DocSound } from '../paint/sound';
import type { OutputFrame } from '../paint/outputFrame';
import type { TimelineSet } from './timelines';
import type { LayerEffects } from '../paint/effects';
import type { Ruler } from '../paint/rulers';
import type { Correction } from '../paint/tonal';
import type { FrameBorder } from '../paint/frames';
import type { GradientFill } from '../paint/gradient';
import type { EffectLines } from '../paint/effectLines';
import type { ImagePlacement } from '../paint/imageMaterial';
import type { GridSettings } from '../paint/grid';
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
  /**
   * Beyond its pixels (where keyframes move the mask away from part of the canvas) the mask hides
   * the layer ('hide': made by Mask outside selection); else it shows it.
   */
  outside?: 'hide';
  /**
   * Keyframes of the mask (Timeline palette: Details > Mask): its position, scale ratio, rotation
   * and centre of rotation over time, within the layer; they apply while the layer's keyframes are on.
   */
  keys?: Keyframe[];
  /** Mask expression > Show gradients: No (the mask fully shows or hides, at `threshold`). */
  gradients?: false;
  /** Mask expression > Threshold (1..255) without gradients. */
  threshold?: number;
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
  /**
   * Timeline: the clips of the layer's track, where it shows (none set: the whole timeline). Cels
   * of animation folders are not tracks: the folder's track shows them.
   */
  clips?: Clip[];
  /**
   * Keyframes of the layer's track ("Enable keyframes on this layer"): position, scale, rotation and
   * opacity over time. For a 2D camera folder they place its camera frame (always on).
   */
  keys?: KeyTrack;
  /** A cel's light table (Animation cels palette): reference layers and images shown under it. */
  lightTable?: LightLayer[];
}

export interface RasterLayer extends LayerBase {
  kind: 'raster';
  blend: BlendMode;
  /** Lock transparent pixels: painting only changes existing pixels. */
  lockAlpha: boolean;
  /** A selection layer (Select > Convert to selection layer): its opacity is a stored selection; shown in its layer colour, never exported. */
  selectionLayer?: boolean;
  /** Select > Quick Mask: the selection being painted (red); not saved, it turns back into the selection. */
  quickMask?: boolean;
}

export interface FolderLayer extends LayerBase {
  kind: 'folder';
  blend: FolderBlendMode;
  expanded: boolean;
  /** Top-most child first, like the layer panel. */
  children: Layer[];
  /** Frame border folder: the content shows only inside the panels, whose border is drawn on top. */
  frame?: FrameBorder;
  /**
   * Animation folder: its layers and layer folders are cels, shown frame by frame as the track
   * assigns them (while the timeline is enabled).
   */
  animation?: AnimationTrack;
  /** 2D camera folder: its keyframes move the camera frame through which its layers are seen (exports, camera view). */
  camera?: boolean;
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

/** Gradient layer: a gradient that stays editable (direction, colours, shape); rendered by the engine. */
export interface GradientLayer extends LayerBase {
  kind: 'gradient';
  blend: BlendMode;
  gradient: GradientFill;
  /** Changes with every edit (never reused), so rendered pixels can be cached. */
  rev: number;
}

/**
 * Fill layer (Layer > New Layer > Fill): one colour over the whole canvas; its layer mask sets
 * where it shows. The colour stays editable; rendered by the engine.
 */
export interface FillLayer extends LayerBase {
  kind: 'fill';
  blend: BlendMode;
  /** '#rrggbb'. */
  color: string;
  /** Changes with every edit (never reused), so rendered pixels can be cached. */
  rev: number;
}

/**
 * Focus lines / speed lines layer (Comic tool > Focus lines, Speed lines, Flash): lines drawn from
 * their settings, which stay editable with the Object tool; rendered by the engine.
 */
export interface LinesLayer extends LayerBase {
  kind: 'lines';
  blend: BlendMode;
  /** The focus or speed lines on the layer, drawn in order. */
  items: EffectLines[];
  /** Changes with every edit (never reused), so rendered pixels can be cached. */
  rev: number;
}

/**
 * Image material layer (Material palette, Edit > Register material): an image placed on the canvas
 * whose position, scale and turn stay editable with the Object tool, optionally tiled; rendered by
 * the engine from the image, which is kept with the document.
 */
export interface ImageLayer extends LayerBase {
  kind: 'image';
  blend: BlendMode;
  placement: ImagePlacement;
  /** Changes with every edit (never reused), so rendered pixels can be cached. */
  rev: number;
}

/**
 * Audio layer (Animation > New animation layer > Audio, File > Import > Audio): a track of the
 * timeline whose clips play sound files; hidden, it is muted. It has no pixels.
 */
export interface AudioLayer extends LayerBase {
  kind: 'audio';
  /** 0..1, when there are no volume keyframes. */
  volume: number;
  /** Each clip plays its `sound` from its `offset` on (no clips: silence). */
  clips: Clip[];
  /** Volume keyframes (always on). */
  keys: KeyTrack;
}

/**
 * Movie layer (File > Import > Movie): a movie file shown frame by frame where its clips are
 * (fitted into the output frame); its sound plays with it. It cannot be drawn on.
 */
export interface MovieLayer extends LayerBase {
  kind: 'movie';
  blend: BlendMode;
  /** The movie file (`PaintDocument.movies`). */
  movie: Id;
  /** Volume of the movie's sound (0..1). */
  volume: number;
  /** Each clip shows the movie from its `offset` (seconds) on (no clips: nothing). */
  clips: Clip[];
}

/** A movie file kept with the document. */
export interface MovieFile {
  id: Id;
  name: string;
  /** MIME type of the stored bytes. */
  type: string;
  /** Seconds. */
  duration: number;
  /** Picture size (px). */
  width: number;
  height: number;
}

export type Layer = RasterLayer | FolderLayer | CorrectionLayer | VectorLayer | TextLayer | GradientLayer | FillLayer | LinesLayer | ImageLayer | AudioLayer | MovieLayer;

/** Layers that take part in the picture (all but audio layers). */
export type DrawnLayer = Exclude<Layer, AudioLayer>;

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
  /** Animation: frame rate and length; animation folders hold the tracks. */
  timeline?: Timeline;
  /** The general light table (shown for every cel). */
  lightTable?: LightTable;
  /** The sound files the audio layers play. */
  sound?: DocSound;
  /** Animation frame lines: the output frame (what exports show), title-safe area and overflow frame. */
  outputFrame?: OutputFrame;
  /** The other timelines (Animation > Timeline > Manage timeline); `timeline` is the one being edited. */
  timelines?: TimelineSet;
  /** The movie files the movie layers show. */
  movies?: MovieFile[];
  /** View > Grid/Ruler bar settings (absent: the saved default). */
  grid?: GridSettings;
}
