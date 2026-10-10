/** Tools, sub tools (presets) and their settings. Sub tools are user-editable and persisted. */
import type { FillTarget, ScalingMode } from './fill';
import { LINEAR, sanitizeCurve01, type CurvePoint } from './curve';
import { DEFAULT_TEXT_STYLE, sanitizeTextStyle, type BalloonShape, type TextStyle } from './text';
import { sanitizeGradientStops, type GradientSpec } from './gradient';
import { CURVE_TYPES, type CurveType, type RulerFigure } from './curves';
import type { TipOrder } from './materials';
import { LIQUIFY_MODES, type LiquifyMode } from './liquify';
import { DEFAULT_FOCUS_LINES, sanitizeEffectLines, type EffectLinesStyle } from './effectLines';

export type ToolId =
  | 'zoom'
  | 'hand'
  | 'rotate'
  | 'move'
  | 'selectLayer'
  | 'select'
  | 'autoSelect'
  | 'eyedropper'
  | 'pen'
  | 'pencil'
  | 'brush'
  | 'airbrush'
  | 'decoration'
  | 'eraser'
  | 'blend'
  | 'liquify'
  | 'fill'
  | 'gradient'
  | 'figure'
  | 'ruler'
  | 'object'
  | 'text'
  | 'balloon'
  | 'flash'
  | 'focusLines'
  | 'speedLines'
  | 'frame'
  | 'correct'
  | 'lightTable';

export type BrushMode = 'paint' | 'erase' | 'blend';

/** Liquify: the mode, the brush size (px), strength and hardness (0..100). */
export interface LiquifySettings {
  mode: LiquifyMode;
  size: number;
  strength: number;
  hardness: number;
  antiAlias: boolean;
  /** Only refer to editing area: with a selection, colours come only from inside it. */
  onlyArea: boolean;
  /** Correction: stabilization 0..100 (smooths the stroke). */
  stabilization: number;
}
/** Focus lines, speed lines and flash: a colour from the colour icons or a user colour. */
export type LinesColor = 'main' | 'sub' | 'user';

/** Focus lines, speed lines and flash sub tools: the lines' style and where they are drawn. */
export interface EffectLinesSettings {
  style: EffectLinesStyle;
  /** Destination layer: the editing layer, always a new lines layer, or the selected lines layer (else a new one). */
  destination: 'editing' | 'new' | 'lines';
  /** Toning: a new lines layer gets the Tone effect and grey lines. */
  toning: boolean;
  /** Use radial line ruler for center / parallel line ruler for angle. */
  useRuler: boolean;
  lineColor: LinesColor;
  fillColor: LinesColor;
  /** The user colours ('#rrggbb'). */
  userLineColor: string;
  userFillColor: string;
}

export type TipFlip = 'off' | 'on' | 'random';
export type TipTexture = 'none' | 'grain';
export type SelectShape = 'rect' | 'ellipse' | 'lasso' | 'polyline' | 'pen' | 'erase' | 'shrink';
export type FigureShape = 'line' | 'curve' | 'polyline' | 'spline' | 'bezier' | 'rect' | 'ellipse' | 'polygon';

/** Figure > Line/Fill: the outline, the inside, or both (outline in the drawing colour, inside in the other one). */
export type FigureFill = 'line' | 'fill' | 'both';
export type ControlPointMode = 'move' | 'add' | 'delete' | 'corner' | 'width' | 'opacity' | 'split';
export type CorrectKind = 'controlPoint' | 'pinch' | 'simplify' | 'connect' | 'width' | 'redraw' | 'redrawWidth';
export type WidthMode = 'thicken' | 'narrow' | 'scaleUp' | 'scaleDown';

/** Correct line tools (vector layers). */
export interface CorrectSettings {
  kind: CorrectKind;
  /** Control point: what a click or drag on a control point does. */
  mode: ControlPointMode;
  /** Pinch and redraw: the ends of the line stay where they are. */
  fixEnds: boolean;
  /** Pinch: how much of the line follows the drag (% of its length). */
  pinchLevel: number;
  /** Pinch: pen pressure makes the pinch reach further. */
  pressure: boolean;
  /** Pinch: how far (screen px) from the pointer a line can be grabbed. */
  range: number;
  /** Pinch: adds a control point where the line is grabbed. */
  addPoint: boolean;
  /** Pinch, simplify and redraw: ends that end up near another line's end are joined. */
  connect: boolean;
  /** How far apart (px) two ends may be to be joined. */
  connectGap: number;
  /** Connect: lines of other colours and sizes are joined too. */
  anyProps: boolean;
  /** Simplify and redraw: how much simpler the line gets (0–100). */
  simplify: number;
  /** Simplify: corners are smoothed out too. */
  smoothCorners: boolean;
  /** Simplify and adjust line width: the whole of every touched line. */
  wholeLine: boolean;
  /** Simplify: the curve afterwards. */
  convert: 'keep' | 'polyline' | 'spline';
  /** Simplify: touched lines shorter than this (px) are deleted (0 = off). */
  deleteShort: number;
  /** Adjust line width: how, and by how much (px to thicken/narrow, % to scale). */
  widthMode: WidthMode;
  widthAmount: number;
  atLeast1: boolean;
  /** Size (px) of the tool's brush (simplify, connect, adjust width, redraw width). */
  size: number;
  /** Redraw: stabilization of the new stroke (0–30). */
  stabilization: number;
}

export const DEFAULT_CORRECT: CorrectSettings = {
  kind: 'controlPoint',
  mode: 'move',
  fixEnds: false,
  pinchLevel: 50,
  pressure: true,
  range: 20,
  addPoint: true,
  connect: false,
  connectGap: 20,
  anyProps: false,
  simplify: 30,
  smoothCorners: false,
  wholeLine: false,
  convert: 'keep',
  deleteShort: 0,
  widthMode: 'thicken',
  widthAmount: 2,
  atLeast1: true,
  size: 40,
  stabilization: 6,
};

const CONTROL_POINT_MODES: readonly ControlPointMode[] = ['move', 'add', 'delete', 'corner', 'width', 'opacity', 'split'];
const WIDTH_MODES: readonly WidthMode[] = ['thicken', 'narrow', 'scaleUp', 'scaleDown'];

/** Correct line settings from storage, validated (the kind is the sub tool's own). */
function sanitizeCorrect(def: CorrectSettings, raw: unknown): CorrectSettings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  return {
    kind: def.kind,
    mode: CONTROL_POINT_MODES.includes(r.mode as ControlPointMode) ? (r.mode as ControlPointMode) : def.mode,
    fixEnds: bool(r.fixEnds, def.fixEnds),
    pinchLevel: num(r.pinchLevel, def.pinchLevel, 1, 100),
    pressure: bool(r.pressure, def.pressure),
    range: num(r.range, def.range, 1, 500),
    addPoint: bool(r.addPoint, def.addPoint),
    connect: bool(r.connect, def.connect),
    connectGap: num(r.connectGap, def.connectGap, 1, 500),
    anyProps: bool(r.anyProps, def.anyProps),
    simplify: num(r.simplify, def.simplify, 0, 100),
    smoothCorners: bool(r.smoothCorners, def.smoothCorners),
    wholeLine: bool(r.wholeLine, def.wholeLine),
    convert: r.convert === 'polyline' || r.convert === 'spline' || r.convert === 'keep' ? r.convert : def.convert,
    deleteShort: num(r.deleteShort, def.deleteShort, 0, 1000),
    widthMode: WIDTH_MODES.includes(r.widthMode as WidthMode) ? (r.widthMode as WidthMode) : def.widthMode,
    widthAmount: num(r.widthAmount, def.widthAmount, 0.1, 500),
    atLeast1: bool(r.atLeast1, def.atLeast1),
    size: num(r.size, def.size, 1, 1000),
    stabilization: num(r.stabilization, def.stabilization, 0, 30),
  };
}
export type SpecialRuler = 'parallel' | 'parallelCurve' | 'multiCurve' | 'radial' | 'radialCurve' | 'concentric';
export const SPECIAL_RULERS: readonly SpecialRuler[] = ['parallel', 'parallelCurve', 'multiCurve', 'radial', 'radialCurve', 'concentric'];
/** Special rulers that are made of a curve (placed point by point). */
export const isSpecialCurve = (s: SpecialRuler | undefined) => s === 'parallelCurve' || s === 'multiCurve' || s === 'radialCurve';
/** Refer multiple: the editing layer only, all layers, reference layers, or the layers in the editing layer's folder. */
export type FillReference = 'layer' | 'all' | 'reference' | 'folder';

export interface FillSettings {
  reference: FillReference;
  /** 0..100 */
  tolerance: number;
  /** Area scaling in px (negative shrinks). */
  expand: number;
  alphaOnly: boolean;
  /** "Apply to connected pixels only". */
  contiguous: boolean;
  /** Close gap: step 0 (off) … 5. */
  closeGap: number;
  /** How the area grows or shrinks with Area scaling (default: round). */
  scaling?: ScalingMode;
  /**
   * The sub tool's way of filling: click (and drag over several areas), Enclose and fill (lasso
   * around closed areas), Lasso fill (fill the lasso), Leftover pen (brush over small leftovers).
   */
  mode?: 'click' | 'enclose' | 'lasso' | 'leftover';
  /** Closed-area fills: which pixels count as the area (Target color). */
  target?: FillTarget;
  /** Leftover pen: brush diameter in px. */
  size?: number;
}

export interface BrushSettings {
  /** Diameter in document pixels. */
  size: number;
  sizePressure: boolean;
  /** Size at zero pressure, as fraction of `size`. */
  minSize: number;
  /** Stroke opacity 0..1 – does not build up within one stroke. */
  opacity: number;
  opacityPressure: boolean;
  /** Per-dab alpha 0..1 – lower values build up within a stroke (brush/airbrush feel). */
  flow: number;
  /** 0 = very soft edge, 1 = hard edge. */
  hardness: number;
  /** Dab distance as fraction of the current diameter. */
  spacing: number;
  /** Hand-shake correction, 0..30 samples. */
  stabilization: number;
  /** 0 = none (hard pixels), 1 = weak, 2 = medium, 3 = strong. */
  antiAlias: number;
  texture: TipTexture;
  /** Random dab offset as fraction of the diameter (spray). */
  scatter: number;
  mode: BrushMode;
  /** Blend tool only: 'blur' softens, 'smudge' drags colour along the stroke. */
  blendStyle: 'blur' | 'smudge';

  // Brush dynamics
  /** Pen pressure graphs (0..1 → 0..1) for size and density. */
  sizeCurve: CurvePoint[];
  densityCurve: CurvePoint[];
  /** Density at zero pressure (fraction), when density follows pressure. */
  minDensity: number;
  /** Tilting the pen widens the stroke / makes it lighter (shading with the side of a pencil). */
  sizeTilt: boolean;
  densityTilt: boolean;
  /** Velocity: faster strokes are thinner / lighter, down to the minimum value. */
  sizeVelocity?: boolean;
  densityVelocity?: boolean;
  /** Random variation per dab, 0..1. */
  sizeRandom: number;
  densityRandom: number;

  // Brush tip
  /** 1 = round … 0.05 = flat. */
  thickness: number;
  /** Degrees. */
  angle: number;
  /** What turns the tip: nothing, the direction of the line, or the direction the pen leans. */
  angleSource: 'fixed' | 'line' | 'tilt';

  // Starting and ending
  /** Taper lengths in px (0 = off). */
  taperStart: number;
  taperEnd: number;
  taperSize: boolean;
  taperDensity: boolean;

  // Ink: color mixing
  mixing: 'none' | 'blend' | 'running';
  /** 0..1: how much of the drawing colour each dab keeps. */
  paintAmount: number;
  /** 0..1: how much of the brush's opacity each dab keeps (low values pick up transparency). */
  paintDensity: number;
  /** 0..1: how long the pure drawing colour lasts from the start of a stroke. */
  colorStretch: number;

  // Brush tip materials
  /** Round tip, or image materials (Brush tip > Tip shape). */
  tipShape: 'circle' | 'material';
  /** Material ids of the tip shapes, used dab after dab in `tipOrder`. */
  tipMaterials: string[];
  tipOrder: TipOrder;
  flipH: TipFlip;
  flipV: TipFlip;
  /** Random turn of each dab, 0..1 of a full turn. */
  angleRandom: number;

  // Paper texture
  /** Texture material id ('' = none). */
  paper: string;
  /** 0..1 */
  paperDensity: number;
  /** % */
  paperScale: number;
  /** Degrees. */
  paperAngle: number;
  /** −100..100 */
  paperBrightness: number;
  paperContrast: number;
  paperInvert: boolean;
  paperMode: 'multiply' | 'subtract';
  /** "Apply by each plot": the texture on every dab instead of on the whole stroke. */
  paperPerDab: boolean;

  // Watercolor edge (applied when the stroke ends)
  watercolorEdge: boolean;
  /** px */
  edgeRange: number;
  /** 0..1 */
  edgeOpacity: number;
  edgeDarkness: number;
}

export interface SubTool {
  id: string;
  tool: ToolId;
  name: string;
  /** Sub tool group shown as a button row above the list (e.g. "Pen" / "Marker"). */
  group?: string;
  brush?: BrushSettings;
  selectShape?: SelectShape;
  figureShape?: FigureShape;
  /** Polygon: number of corners. */
  figureCorners?: number;
  /** Rectangle and polygon: Roundness of corner, 0..100 %. */
  figureRound?: number;
  /** Rectangle, ellipse and polygon: Line/Fill. */
  figureFill?: FigureFill;
  /** Gradient tool: nodes, shape, edge rule, dithering; `layer` makes an editable gradient layer. */
  gradient?: GradientSpec & { layer: boolean };
  /** Eyedropper: read the current layer instead of the displayed colour. */
  fromLayer?: boolean;
  /** Zoom tool: a click zooms out instead of in. */
  zoomOut?: boolean;
  fill?: FillSettings;
  /** Lasso, Lasso fill, Enclose and fill: Magnetic lasso strength 1 … 5 (0 or absent: off). */
  magnet?: number;
  /** Liquify tool settings. */
  liquify?: LiquifySettings;
  /** Focus lines, speed lines and flash settings. */
  effectLines?: EffectLinesSettings;

  /** Rectangle / ellipse start from the centre. */
  fromCenter?: boolean;

  /** Ruler tool: which ruler a drag (or clicks, for curves) creates; the ruler pen draws one by hand. */
  rulerKind?: 'linear' | 'curve' | 'figure' | 'pen' | 'special' | 'guide' | 'perspective' | 'symmetry';
  /** Special ruler type. */
  specialRuler?: SpecialRuler;
  /** Curve rulers (and the special curve rulers): how the clicked points make the line. */
  curveType?: CurveType;
  /** Figure ruler: its shape, and the corners of a polygon (3–32). */
  rulerFigure?: RulerFigure;
  polygonCorners?: number;
  /** Symmetrical ruler: number of lines (2–32) and line symmetry (mirroring). */
  symmetryLines?: number;
  symmetryMirror?: boolean;
  /** Erasers on vector layers: erase the touched area, up to intersections, or whole lines. */
  vectorErase?: 'touched' | 'intersection' | 'whole';
  /** "Up to intersection" also stops at lines on the other vector layers. */
  vectorReferAll?: boolean;
  /** Object tool: scaling vector lines also scales their width. */
  scaleLineWidth?: boolean;
  /** Text tool: settings for new text (size in points). */
  textStyle?: TextStyle;
  /** Balloon tools: the shape drawn, its outline width (px) and whether it is filled (with the sub colour). */
  balloon?: { shape: BalloonShape; lineWidth: number; fill: boolean };
  /** Balloon tail tools. */
  tail?: { width: number; bend: number; kind: 'pointed' | 'thought' };
  /** Frame tools: how a frame is made, and its border width (px). */
  frameShape?: 'rect' | 'polyline' | 'divide';
  frameLine?: number;
  /** Divide frame border: gutters (mm) for cuts across (top/bottom) and down (left/right), and whether the new part gets its own folder. */
  gutterTopBottom?: number;
  gutterLeftRight?: number;
  divideFolder?: boolean;
  /** Correct line tools. */
  correct?: CorrectSettings;
}

export const DEFAULT_BRUSH: BrushSettings = {
  size: 12,
  sizePressure: true,
  minSize: 0.15,
  opacity: 1,
  opacityPressure: false,
  flow: 1,
  hardness: 0.92,
  spacing: 0.08,
  stabilization: 6,
  antiAlias: 2,
  texture: 'none',
  scatter: 0,
  mode: 'paint',
  blendStyle: 'blur',
  sizeCurve: LINEAR,
  densityCurve: LINEAR,
  minDensity: 0,
  sizeTilt: false,
  densityTilt: false,
  sizeRandom: 0,
  densityRandom: 0,
  thickness: 1,
  angle: 0,
  angleSource: 'fixed',
  taperStart: 0,
  taperEnd: 0,
  taperSize: true,
  taperDensity: false,
  mixing: 'none',
  paintAmount: 0.6,
  paintDensity: 0.8,
  colorStretch: 0.2,
  tipShape: 'circle',
  tipMaterials: [],
  tipOrder: 'repeat',
  flipH: 'off',
  flipV: 'off',
  angleRandom: 0,
  paper: '',
  paperDensity: 1,
  paperScale: 100,
  paperAngle: 0,
  paperBrightness: 0,
  paperContrast: 0,
  paperInvert: false,
  paperMode: 'subtract',
  paperPerDab: false,
  watercolorEdge: false,
  edgeRange: 5,
  edgeOpacity: 0.6,
  edgeDarkness: 0.4,
};

const brush = (patch: Partial<BrushSettings>): BrushSettings => ({ ...DEFAULT_BRUSH, ...patch });

export interface ToolInfo {
  id: ToolId;
  label: string;
  /** Default shortcut key (cycles through tools sharing a key). */
  key: string;
  hint: string;
}

/** Tool palette order. */
export const TOOLS: ToolInfo[] = [
  { id: 'zoom', label: 'Zoom', key: '/', hint: 'Click to zoom in, ⌥-click to zoom out, drag left/right to zoom continuously' },
  { id: 'hand', label: 'Hand', key: 'H', hint: 'Drag to scroll the canvas (also: hold Space)' },
  { id: 'rotate', label: 'Rotate', key: 'R', hint: 'Drag to rotate the view, double-click to reset (also: Shift+Space)' },
  { id: 'selectLayer', label: 'Select layer', key: 'D', hint: 'Click the canvas to select the layer drawn there' },
  { id: 'move', label: 'Move layer', key: 'K', hint: 'Drag to move the layer or the selected pixels · ⌥ copies · ⇧ fixes the direction' },
  { id: 'select', label: 'Selection area', key: 'M', hint: 'Drag to select · ⇧ adds · ⌥ subtracts · ⇧⌥ intersects' },
  { id: 'autoSelect', label: 'Auto select', key: 'W', hint: 'Click to select an area of similar colour · ⇧ adds · ⌥ subtracts' },
  { id: 'eyedropper', label: 'Eyedropper', key: 'I', hint: 'Click to pick a colour (also: ⌥-click with drawing tools, or right-click)' },
  { id: 'pen', label: 'Pen', key: 'P', hint: '⇧-drag draws a straight line, ⇧-click connects to the last point' },
  { id: 'pencil', label: 'Pencil', key: 'P', hint: 'Sketching pencils · ⇧-click connects to the last point' },
  { id: 'brush', label: 'Brush', key: 'B', hint: 'Painting brushes' },
  { id: 'airbrush', label: 'Airbrush', key: 'B', hint: 'Soft airbrush and spray' },
  { id: 'decoration', label: 'Decoration', key: 'B', hint: 'Draws patterns of image tips: leaves, grass, stars, sparkles …' },
  { id: 'eraser', label: 'Eraser', key: 'E', hint: 'Erase pixels on the current layer' },
  { id: 'blend', label: 'Blend', key: 'J', hint: 'Blur, blend and smudge colours on the current layer' },
  { id: 'liquify', label: 'Liquify', key: 'J', hint: 'Drag to push, expand, pinch or twirl the pixels of the current layer · ⌥ does the opposite · ⇧ along a straight line · press and hold to expand, pinch or twirl in place' },
  { id: 'fill', label: 'Fill', key: 'G', hint: 'Click to fill an area · ⇧-click toggles "refer multiple"' },
  { id: 'gradient', label: 'Gradient', key: 'G', hint: 'Drag to draw a gradient with the drawing colour' },
  { id: 'figure', label: 'Figure', key: 'U', hint: 'Drag to draw · ⇧ snaps lines to 45° and makes squares / circles' },
  { id: 'frame', label: 'Frame border', key: 'U', hint: 'Drag to make a comic frame (it snaps to the canvas and other frames) · divide: drag across a frame' },
  { id: 'ruler', label: 'Ruler', key: 'U', hint: 'Drag to create a ruler (curves: click points, double-click to finish) · drag a handle to edit it · strokes snap to rulers (⌘1 / ⌘2)' },
  { id: 'object', label: 'Object', key: 'O', hint: 'Click a vector line, text, balloon or ruler to select it · drag to move, handles to scale and rotate · Delete removes it' },
  { id: 'text', label: 'Text', key: 'T', hint: 'Click to type, drag to type in a frame (the text wraps at it) · click text to edit it · ⌘Enter or a click outside confirms' },
  { id: 'balloon', label: 'Balloon', key: 'T', hint: 'Drag to draw a speech balloon · balloon tail: drag from inside a balloon' },
  { id: 'flash', label: 'Flash', key: '', hint: 'Drag from the centre to draw a flash round it (⇧: a circle) · a focus lines layer keeps it editable with the Object tool' },
  { id: 'focusLines', label: 'Focus lines', key: '', hint: 'Drag from the centre to set where the lines start (⇧: a circle) · a focus lines layer keeps them editable with the Object tool' },
  { id: 'speedLines', label: 'Speed lines', key: '', hint: 'Drag a line across the area for the speed lines (they run across it) · a speed lines layer keeps them editable with the Object tool' },
  { id: 'correct', label: 'Correct line', key: 'Y', hint: 'Correct the lines of a vector layer: control points, pinch, simplify, connect, line width, redraw' },
  { id: 'lightTable', label: 'Light table', key: '', hint: 'Moves the selected light table layer (Animation cels palette): drag inside to move, a corner to scale, the round handle to rotate' },
];

export const toolInfo = (id: ToolId): ToolInfo => TOOLS.find((t) => t.id === id)!;

/** Tools that paint with a brush tip. */
export const BRUSH_TOOLS: ToolId[] = ['pen', 'pencil', 'brush', 'airbrush', 'decoration', 'eraser', 'blend', 'figure'];

const FILL_LAYER: FillSettings = { reference: 'layer', tolerance: 10, expand: 0, alphaOnly: false, contiguous: true, closeGap: 1 };
const FILL_OTHERS: FillSettings = { reference: 'all', tolerance: 10, expand: 1, alphaOnly: false, contiguous: true, closeGap: 2 };

/**
 * Default tools of each group, named after the real-world tools they imitate (the usual names in
 * comic and illustration software). Values are our own; only the few documented defaults
 * (G-pen 10 px / stabilization 6, pencil 90 % opacity, straight line 3 px) follow the reference.
 */
/** A focus lines, speed lines or flash sub tool. */
function linesTool(id: string, tool: ToolId, name: string, style: Partial<EffectLinesStyle>, patch: Partial<EffectLinesSettings> = {}): SubTool {
  const { id: _id, cx: _cx, cy: _cy, fx: _fx, fy: _fy, rx: _rx, ry: _ry, rotation: _r, seed: _seed, color: _c, fillColor: _f, ...base } = DEFAULT_FOCUS_LINES;
  return {
    id,
    tool,
    name,
    effectLines: {
      style: { ...base, kind: tool === 'speedLines' ? 'speed' : 'focus', ...style },
      destination: 'new',
      toning: false,
      useRuler: true,
      lineColor: 'main',
      fillColor: 'sub',
      userLineColor: '#000000',
      userFillColor: '#ffffff',
      ...patch,
    },
  };
}

const SPEED: Partial<EffectLinesStyle> = { gapMode: 'distance', refPos: 'middle', extend: true, refGap: 0, lengthDisarray: 0, maxLines: 200 };
const FLASH: Partial<EffectLinesStyle> = { extend: false, refPos: 'start', taperStart: 0, taperEnd: 100, fill: true, fillOpacity: 100 };

export const EFFECT_LINE_TOOLS: SubTool[] = [
  linesTool('flash-pattern', 'flash', 'Flash pattern', { ...FLASH, gap: 0.6, gapDisarray: 50, length: 70, lengthDisarray: 60, refGap: 10, unevenCount: 30, unevenHeight: 18, width: 4, widthDisarray: 40 }),
  linesTool('flash-flash', 'flash', 'Flash', { ...FLASH, gap: 1.5, gapDisarray: 60, length: 55, lengthDisarray: 50, refGap: 10, width: 3, widthDisarray: 40 }),
  linesTool('flash-dense', 'flash', 'Dense flash', { ...FLASH, gap: 0.4, gapDisarray: 60, length: 40, lengthDisarray: 70, refGap: 15, width: 2, widthDisarray: 40 }),
  linesTool('flash-urchin', 'flash', 'Sea urchin flash', { ...FLASH, gap: 5, gapDisarray: 40, length: 90, lengthDisarray: 30, refGap: 0, width: 14, widthDisarray: 30 }),
  linesTool('flash-firework', 'flash', 'Firework', { ...FLASH, fill: false, gap: 6, gapDisarray: 50, length: 120, lengthDisarray: 40, refGap: 30, width: 6, widthDisarray: 30, taperEnd: 80, dotted: true }),
  linesTool('focus-scattered', 'focusLines', 'Scattered focus lines', { gap: 2.5, gapDisarray: 70, refGap: 40, width: 8, widthDisarray: 60, taperStart: 85 }),
  linesTool('focus-dense', 'focusLines', 'Dense focus lines', { gap: 0.8, gapDisarray: 50, refGap: 25, width: 3, widthDisarray: 40, taperStart: 90 }),
  linesTool('focus-brightness', 'focusLines', 'Brightness', { gap: 4, gapDisarray: 80, extend: false, length: 250, lengthDisarray: 50, refGap: 20, width: 6, widthDisarray: 50, taperStart: 50, taperEnd: 50 }),
  linesTool('focus-burst', 'focusLines', 'Burst', { gap: 7, gapDisarray: 40, refGap: 10, width: 40, widthDisarray: 50, taperStart: 100 }),
  linesTool('speed-scattered', 'speedLines', 'Scattered speed lines', { ...SPEED, gap: 12, gapDisarray: 80, width: 3, widthDisarray: 60, taperStart: 30, taperEnd: 30 }),
  linesTool('speed-dark', 'speedLines', 'Dark speed lines', { ...SPEED, gap: 5, gapDisarray: 60, grouping: 5, groupDisarray: 50, groupGap: 3, width: 3, widthDisarray: 50, taperStart: 20, taperEnd: 20 }),
  linesTool('speed-gloom', 'speedLines', 'Gloom', { ...SPEED, refPos: 'start', extend: false, gap: 6, gapDisarray: 60, length: 300, lengthDisarray: 70, width: 3, widthDisarray: 40, taperStart: 0, taperEnd: 100 }),
  linesTool('speed-rain', 'speedLines', 'Rain', { ...SPEED, extend: false, angle: 15, gap: 4, gapDisarray: 90, length: 50, lengthDisarray: 50, refGap: 600, width: 1.5, widthDisarray: 30, taperStart: 30, taperEnd: 30, maxLines: 400 }),
];

export const DEFAULT_SUB_TOOLS: SubTool[] = [
  // Pen
  { id: 'pen-g', tool: 'pen', group: 'Pen', name: 'G-pen', brush: brush({ size: 10, minSize: 0.1, hardness: 1, stabilization: 6 }) },
  { id: 'pen-real-g', tool: 'pen', group: 'Pen', name: 'Real G-pen', brush: brush({ size: 10, minSize: 0.05, hardness: 0.95, texture: 'grain', flow: 0.95, stabilization: 6 }) },
  { id: 'pen-mapping', tool: 'pen', group: 'Pen', name: 'Mapping pen', brush: brush({ size: 5, minSize: 0.05, hardness: 1, stabilization: 8 }) },
  { id: 'pen-turnip', tool: 'pen', group: 'Pen', name: 'Turnip pen', brush: brush({ size: 15, minSize: 0.35, hardness: 1, stabilization: 6 }) },
  {
    id: 'pen-calligraphy',
    tool: 'pen',
    group: 'Pen',
    name: 'Calligraphy',
    brush: brush({ size: 16, minSize: 0.6, hardness: 1, thickness: 0.25, angle: 45, stabilization: 6, spacing: 0.04 }),
  },
  { id: 'pen-milli', tool: 'pen', group: 'Marker', name: 'Milli pen', brush: brush({ size: 6, sizePressure: false, hardness: 1, stabilization: 4 }) },
  { id: 'pen-felt', tool: 'pen', group: 'Marker', name: 'Felt pen', brush: brush({ size: 20, sizePressure: false, opacity: 0.85, hardness: 0.85, stabilization: 3 }) },
  { id: 'pen-dot', tool: 'pen', group: 'Marker', name: 'Dot pen', brush: brush({ size: 1, sizePressure: false, hardness: 1, antiAlias: 0, stabilization: 0, spacing: 0.3 }) },
  // Pencil
  {
    id: 'pencil',
    tool: 'pencil',
    name: 'Pencil',
    // Leaning the pen shades wider and lighter, like the side of a pencil lead.
    brush: brush({ size: 10, minSize: 0.5, opacity: 0.9, opacityPressure: true, flow: 0.85, hardness: 0.6, texture: 'grain', stabilization: 5, spacing: 0.12, sizeTilt: true, densityTilt: true }),
  },
  {
    id: 'pencil-mech',
    tool: 'pencil',
    name: 'Mechanical pencil',
    brush: brush({ size: 4, minSize: 0.7, opacityPressure: true, flow: 0.9, hardness: 0.8, texture: 'grain', stabilization: 5, spacing: 0.12 }),
  },
  {
    id: 'pencil-charcoal',
    tool: 'pencil',
    name: 'Charcoal',
    brush: brush({ size: 24, minSize: 0.4, opacityPressure: true, flow: 0.55, hardness: 0.35, texture: 'grain', stabilization: 2, spacing: 0.1 }),
  },
  {
    id: 'pencil-crayon',
    tool: 'pencil',
    name: 'Crayon',
    brush: brush({ size: 18, minSize: 0.6, opacityPressure: true, flow: 0.7, hardness: 0.7, texture: 'grain', stabilization: 2, spacing: 0.08 }),
  },
  {
    // Light pressure only touches the high grain of the paper.
    id: 'pencil-paper',
    tool: 'pencil',
    name: 'Pencil on paper',
    brush: brush({ size: 12, minSize: 0.5, opacityPressure: true, minDensity: 0.25, flow: 0.9, hardness: 0.75, stabilization: 5, spacing: 0.1, paper: 'paper', paperDensity: 0.9, paperScale: 60 }),
  },
  {
    id: 'pencil-pastel',
    tool: 'pencil',
    name: 'Pastel',
    brush: brush({ size: 36, minSize: 0.6, opacityPressure: true, flow: 0.8, tipShape: 'material', tipMaterials: ['chalk'], angleRandom: 1, stabilization: 2, spacing: 0.12, paper: 'rough', paperDensity: 0.7, paperScale: 100 }),
  },
  // Brush
  {
    id: 'brush-watercolor',
    tool: 'brush',
    group: 'Watercolor',
    name: 'Round watercolor brush',
    brush: brush({ size: 40, minSize: 0.3, opacity: 0.8, opacityPressure: true, flow: 0.35, hardness: 0.3, stabilization: 3, spacing: 0.05 }),
  },
  {
    id: 'brush-transparent-wc',
    tool: 'brush',
    group: 'Watercolor',
    name: 'Transparent watercolor',
    brush: brush({
      size: 50,
      minSize: 0.4,
      opacity: 0.9,
      opacityPressure: true,
      flow: 0.45,
      hardness: 0.45,
      stabilization: 3,
      spacing: 0.05,
      mixing: 'running',
      paintAmount: 0.85,
      paintDensity: 0.7,
      colorStretch: 0.3,
      watercolorEdge: true,
      edgeRange: 6,
    }),
  },
  {
    id: 'brush-opaque-wc',
    tool: 'brush',
    group: 'Watercolor',
    name: 'Opaque watercolor',
    brush: brush({ size: 40, minSize: 0.4, opacityPressure: true, flow: 0.8, hardness: 0.6, stabilization: 3, spacing: 0.05, mixing: 'running', paintAmount: 0.75, paintDensity: 0.95, colorStretch: 0.3 }),
  },
  // Starting and ending taper the stroke even without pen pressure.
  { id: 'brush-pen', tool: 'brush', group: 'Watercolor', name: 'Brush pen', brush: brush({ size: 20, minSize: 0.05, hardness: 1, stabilization: 8, taperStart: 25, taperEnd: 45 }) },
  {
    id: 'brush-dry-ink',
    tool: 'brush',
    group: 'Watercolor',
    name: 'Dry ink',
    brush: brush({ size: 30, minSize: 0.3, flow: 0.8, hardness: 0.8, texture: 'grain', stabilization: 4, spacing: 0.07 }),
  },
  {
    id: 'brush-gouache',
    tool: 'brush',
    group: 'Thick paint',
    name: 'Gouache',
    brush: brush({ size: 40, minSize: 0.4, opacityPressure: true, flow: 0.7, hardness: 0.8, stabilization: 3, spacing: 0.06 }),
  },
  {
    id: 'brush-oil',
    tool: 'brush',
    group: 'Thick paint',
    name: 'Oil paint',
    brush: brush({
      size: 40,
      minSize: 0.5,
      flow: 0.9,
      hardness: 0.85,
      texture: 'grain',
      stabilization: 3,
      spacing: 0.06,
      mixing: 'blend',
      paintAmount: 0.55,
      paintDensity: 1,
      colorStretch: 0.5,
    }),
  },
  {
    id: 'brush-flat',
    tool: 'brush',
    group: 'Thick paint',
    name: 'Flat brush',
    brush: brush({ size: 40, minSize: 0.6, flow: 0.9, hardness: 0.9, thickness: 0.3, angle: 90, angleSource: 'line', stabilization: 3, spacing: 0.04, mixing: 'running', paintAmount: 0.7, paintDensity: 1, colorStretch: 0.4 }),
  },
  {
    id: 'brush-soft',
    tool: 'brush',
    group: 'Thick paint',
    name: 'Soft brush',
    brush: brush({ size: 60, minSize: 0.4, opacity: 0.9, opacityPressure: true, flow: 0.35, hardness: 0.2, stabilization: 2, spacing: 0.05 }),
  },
  {
    id: 'brush-dry',
    tool: 'brush',
    group: 'Thick paint',
    name: 'Dry brush',
    brush: brush({ size: 50, minSize: 0.6, flow: 0.85, tipShape: 'material', tipMaterials: ['bristle'], angleSource: 'line', stabilization: 3, spacing: 0.04 }),
  },
  {
    id: 'brush-canvas',
    tool: 'brush',
    group: 'Thick paint',
    name: 'Paint on canvas',
    brush: brush({ size: 40, minSize: 0.5, opacityPressure: true, flow: 0.8, hardness: 0.7, stabilization: 3, spacing: 0.06, paper: 'canvas', paperDensity: 0.6, paperMode: 'multiply', paperScale: 60 }),
  },
  // Airbrush
  {
    id: 'air-soft',
    tool: 'airbrush',
    name: 'Soft',
    brush: brush({ size: 120, sizePressure: false, opacityPressure: true, flow: 0.2, hardness: 0, stabilization: 0, spacing: 0.04 }),
  },
  { id: 'air-spray', tool: 'airbrush', name: 'Spray', brush: brush({ size: 3, sizePressure: false, flow: 0.8, hardness: 0.9, scatter: 12, spacing: 0.15, stabilization: 0, sizeRandom: 0.6 }) },
  { id: 'air-droplet', tool: 'airbrush', name: 'Droplet', brush: brush({ size: 8, sizePressure: false, flow: 0.9, hardness: 0.95, scatter: 6, spacing: 0.5, stabilization: 0 }) },
  {
    id: 'air-splatter',
    tool: 'airbrush',
    name: 'Splatter',
    brush: brush({ size: 60, sizePressure: false, flow: 1, tipShape: 'material', tipMaterials: ['splatter'], angleRandom: 1, flipH: 'random', scatter: 0.6, sizeRandom: 0.5, spacing: 0.8, stabilization: 0 }),
  },
  // Decoration (patterns of image tips)
  {
    id: 'deco-leaves',
    tool: 'decoration',
    name: 'Leaves',
    brush: brush({ size: 40, sizePressure: false, tipShape: 'material', tipMaterials: ['leaf'], angleSource: 'line', angleRandom: 0.35, flipV: 'random', scatter: 0.6, sizeRandom: 0.4, spacing: 0.9, stabilization: 4 }),
  },
  {
    id: 'deco-grass',
    tool: 'decoration',
    name: 'Grass',
    brush: brush({ size: 60, sizePressure: false, tipShape: 'material', tipMaterials: ['grass'], flipH: 'random', sizeRandom: 0.35, scatter: 0.15, spacing: 0.3, stabilization: 4 }),
  },
  {
    id: 'deco-stars',
    tool: 'decoration',
    name: 'Stars',
    brush: brush({ size: 26, sizePressure: false, tipShape: 'material', tipMaterials: ['star'], angleRandom: 1, scatter: 1.2, sizeRandom: 0.6, spacing: 1.6, stabilization: 0 }),
  },
  {
    id: 'deco-sparkle',
    tool: 'decoration',
    name: 'Sparkle',
    brush: brush({ size: 34, sizePressure: false, tipShape: 'material', tipMaterials: ['sparkle'], scatter: 1.5, sizeRandom: 0.7, densityRandom: 0.4, spacing: 1.8, stabilization: 0 }),
  },
  {
    id: 'deco-hearts',
    tool: 'decoration',
    name: 'Hearts',
    brush: brush({ size: 28, sizePressure: false, tipShape: 'material', tipMaterials: ['heart'], angleRandom: 0.15, scatter: 0.8, sizeRandom: 0.4, spacing: 1.6, stabilization: 2 }),
  },
  {
    id: 'deco-flowers',
    tool: 'decoration',
    name: 'Flowers',
    brush: brush({ size: 32, sizePressure: false, tipShape: 'material', tipMaterials: ['flower', 'star'], tipOrder: 'random', angleRandom: 1, scatter: 0.8, sizeRandom: 0.4, spacing: 1.4, stabilization: 2 }),
  },
  // Eraser
  { id: 'eraser-hard', tool: 'eraser', name: 'Hard', brush: brush({ size: 30, sizePressure: false, hardness: 1, mode: 'erase', stabilization: 0 }) },
  {
    id: 'eraser-soft',
    tool: 'eraser',
    name: 'Soft',
    brush: brush({ size: 80, sizePressure: false, flow: 0.3, opacityPressure: true, hardness: 0.1, mode: 'erase', stabilization: 0, spacing: 0.05 }),
  },
  {
    id: 'eraser-kneaded',
    tool: 'eraser',
    name: 'Kneaded eraser',
    brush: brush({ size: 50, sizePressure: false, flow: 0.15, opacityPressure: true, hardness: 0.3, mode: 'erase', stabilization: 0, spacing: 0.05 }),
  },
  // On vector layers this eraser removes lines up to where they cross other lines.
  { id: 'eraser-vector', tool: 'eraser', name: 'Vector', vectorErase: 'intersection', brush: brush({ size: 20, sizePressure: false, hardness: 1, mode: 'erase', stabilization: 0 }) },
  {
    id: 'eraser-rough',
    tool: 'eraser',
    name: 'Rough',
    brush: brush({ size: 30, sizePressure: false, flow: 0.8, hardness: 0.6, texture: 'grain', mode: 'erase', stabilization: 0, spacing: 0.08 }),
  },
  // Blend
  {
    id: 'blend-blend',
    tool: 'blend',
    name: 'Blend',
    brush: brush({ size: 40, sizePressure: false, flow: 0.5, opacityPressure: true, hardness: 0.4, mode: 'blend', blendStyle: 'smudge', stabilization: 0, spacing: 0.1 }),
  },
  { id: 'blend-blur', tool: 'blend', name: 'Blur', brush: brush({ size: 40, sizePressure: false, flow: 0.5, opacityPressure: true, hardness: 0.3, mode: 'blend', stabilization: 0, spacing: 0.12 }) },
  {
    id: 'blend-finger',
    tool: 'blend',
    name: 'Finger tip',
    brush: brush({ size: 30, sizePressure: false, flow: 0.85, hardness: 0.5, mode: 'blend', blendStyle: 'smudge', stabilization: 0, spacing: 0.08 }),
  },
  // Liquify
  { id: 'liquify', tool: 'liquify', name: 'Liquify', liquify: { mode: 'push', size: 100, strength: 70, hardness: 50, antiAlias: true, onlyArea: false, stabilization: 0 } },
  // Selection area & auto select
  { id: 'sel-rect', tool: 'select', name: 'Rectangle', selectShape: 'rect' },
  { id: 'sel-ellipse', tool: 'select', name: 'Ellipse', selectShape: 'ellipse' },
  { id: 'sel-lasso', tool: 'select', name: 'Lasso', selectShape: 'lasso' },
  { id: 'sel-polyline', tool: 'select', name: 'Polyline', selectShape: 'polyline' },
  { id: 'sel-shrink', tool: 'select', name: 'Shrink selection', selectShape: 'shrink', fill: { ...FILL_OTHERS, mode: 'enclose', target: 'transparent', expand: 0, closeGap: 1 } },
  { id: 'sel-magnetic', tool: 'select', name: 'Magnetic lasso', selectShape: 'lasso', magnet: 3 },
  { id: 'sel-pen', tool: 'select', name: 'Selection pen', selectShape: 'pen', brush: brush({ size: 30, sizePressure: false, hardness: 1, antiAlias: 1, stabilization: 0 }) },
  { id: 'sel-erase', tool: 'select', name: 'Erase selection', selectShape: 'erase', brush: brush({ size: 30, sizePressure: false, hardness: 1, antiAlias: 1, stabilization: 0, mode: 'erase' }) },
  { id: 'auto-layer', tool: 'autoSelect', name: 'Refer to editing layer only', fill: { ...FILL_LAYER, closeGap: 0 } },
  { id: 'auto-all', tool: 'autoSelect', name: 'Refer to all layers', fill: { ...FILL_OTHERS, expand: 0, closeGap: 0 } },
  { id: 'auto-reference', tool: 'autoSelect', name: 'Selection for referred layers', fill: { ...FILL_OTHERS, reference: 'reference', expand: 0, closeGap: 0 } },
  // Fill & gradient
  { id: 'fill-layer', tool: 'fill', name: 'Refer only to editing layer', fill: { ...FILL_LAYER } },
  { id: 'fill-others', tool: 'fill', name: 'Refer other layers', fill: { ...FILL_OTHERS } },
  { id: 'fill-enclose', tool: 'fill', name: 'Enclose and fill', fill: { ...FILL_OTHERS, mode: 'enclose', target: 'transparent', expand: 2, scaling: 'darkest' } },
  { id: 'fill-lasso', tool: 'fill', name: 'Lasso fill', fill: { ...FILL_LAYER, mode: 'lasso', closeGap: 0 } },
  { id: 'fill-leftover', tool: 'fill', name: 'Leftover pen', fill: { ...FILL_OTHERS, mode: 'leftover', target: 'transparent', expand: 2, scaling: 'darkest', size: 30 } },
  {
    id: 'grad-transparent',
    tool: 'gradient',
    name: 'Foreground to transparent',
    gradient: { stops: [{ pos: 0, color: 'main', opacity: 1 }, { pos: 1, color: 'main', opacity: 0 }], shape: 'line', edge: 'none', dither: false, layer: false },
  },
  {
    id: 'grad-background',
    tool: 'gradient',
    name: 'Foreground to background',
    gradient: { stops: [{ pos: 0, color: 'main', opacity: 1 }, { pos: 1, color: 'sub', opacity: 1 }], shape: 'line', edge: 'none', dither: false, layer: false },
  },
  {
    id: 'grad-circle',
    tool: 'gradient',
    name: 'Circle: foreground to background',
    gradient: { stops: [{ pos: 0, color: 'main', opacity: 1 }, { pos: 1, color: 'sub', opacity: 1 }], shape: 'circle', edge: 'none', dither: false, layer: false },
  },
  {
    id: 'grad-layer',
    tool: 'gradient',
    name: 'Gradient layer',
    gradient: { stops: [{ pos: 0, color: 'main', opacity: 1 }, { pos: 1, color: 'sub', opacity: 1 }], shape: 'line', edge: 'none', dither: true, layer: true },
  },
  // Figure
  { id: 'fig-line', tool: 'figure', name: 'Straight line', figureShape: 'line', brush: brush({ size: 3, sizePressure: false, stabilization: 0 }) },
  { id: 'fig-curve', tool: 'figure', name: 'Curve', figureShape: 'curve', brush: brush({ size: 3, sizePressure: false, stabilization: 0 }) },
  { id: 'fig-polyline', tool: 'figure', name: 'Polyline', figureShape: 'polyline', brush: brush({ size: 3, sizePressure: false, stabilization: 0 }) },
  { id: 'fig-spline', tool: 'figure', name: 'Continuous curve', figureShape: 'spline', brush: brush({ size: 3, sizePressure: false, stabilization: 0 }) },
  { id: 'fig-bezier', tool: 'figure', name: 'Bezier curve', figureShape: 'bezier', brush: brush({ size: 3, sizePressure: false, stabilization: 0 }) },
  { id: 'fig-rect', tool: 'figure', name: 'Rectangle', figureShape: 'rect', figureRound: 0, figureFill: 'line', brush: brush({ size: 3, sizePressure: false, stabilization: 0 }) },
  { id: 'fig-ellipse', tool: 'figure', name: 'Ellipse', figureShape: 'ellipse', figureFill: 'line', brush: brush({ size: 3, sizePressure: false, stabilization: 0 }) },
  { id: 'fig-polygon', tool: 'figure', name: 'Polygon', figureShape: 'polygon', figureCorners: 5, figureRound: 0, figureFill: 'line', brush: brush({ size: 3, sizePressure: false, stabilization: 0 }) },
  // Frame border
  { id: 'frame-rect', tool: 'frame', name: 'Rectangle frame', frameShape: 'rect', frameLine: 5 },
  { id: 'frame-polyline', tool: 'frame', name: 'Polyline frame', frameShape: 'polyline', frameLine: 5 },
  { id: 'frame-divide', tool: 'frame', name: 'Divide frame border', frameShape: 'divide', gutterTopBottom: 4, gutterLeftRight: 2, divideFolder: true },
  // Ruler
  { id: 'ruler-linear', tool: 'ruler', name: 'Linear ruler', rulerKind: 'linear' },
  { id: 'ruler-curve', tool: 'ruler', name: 'Curve ruler', rulerKind: 'curve', curveType: 'spline' },
  { id: 'ruler-figure', tool: 'ruler', name: 'Figure ruler', rulerKind: 'figure', rulerFigure: 'ellipse', polygonCorners: 6 },
  { id: 'ruler-pen', tool: 'ruler', name: 'Ruler pen', rulerKind: 'pen' },
  { id: 'ruler-special', tool: 'ruler', name: 'Special ruler', rulerKind: 'special', specialRuler: 'parallel', curveType: 'spline' },
  { id: 'ruler-guide', tool: 'ruler', name: 'Guide', rulerKind: 'guide' },
  { id: 'ruler-perspective', tool: 'ruler', name: 'Perspective ruler', rulerKind: 'perspective' },
  { id: 'ruler-symmetry', tool: 'ruler', name: 'Symmetrical ruler', rulerKind: 'symmetry', symmetryLines: 2, symmetryMirror: true },
  // Correct line
  { id: 'correct-point', tool: 'correct', name: 'Control point', correct: { ...DEFAULT_CORRECT } },
  { id: 'correct-pinch', tool: 'correct', name: 'Pinch vector line', correct: { ...DEFAULT_CORRECT, kind: 'pinch' } },
  { id: 'correct-simplify', tool: 'correct', name: 'Simplify vector line', correct: { ...DEFAULT_CORRECT, kind: 'simplify' } },
  { id: 'correct-connect', tool: 'correct', name: 'Connect vector line', correct: { ...DEFAULT_CORRECT, kind: 'connect' } },
  { id: 'correct-width', tool: 'correct', name: 'Adjust line width', correct: { ...DEFAULT_CORRECT, kind: 'width' } },
  { id: 'correct-redraw', tool: 'correct', name: 'Redraw vector line', correct: { ...DEFAULT_CORRECT, kind: 'redraw', simplify: 10 } },
  { id: 'correct-redraw-width', tool: 'correct', name: 'Redraw vector line width', correct: { ...DEFAULT_CORRECT, kind: 'redrawWidth', size: 20 } },
  // Text & balloons
  { id: 'text', tool: 'text', name: 'Text', textStyle: { ...DEFAULT_TEXT_STYLE, size: 24 } },
  { id: 'text-vertical', tool: 'text', name: 'Vertical text', textStyle: { ...DEFAULT_TEXT_STYLE, size: 24, vertical: true } },
  { id: 'balloon-ellipse', tool: 'balloon', name: 'Ellipse balloon', balloon: { shape: 'ellipse', lineWidth: 3, fill: true } },
  { id: 'balloon-rounded', tool: 'balloon', name: 'Rounded balloon', balloon: { shape: 'rounded', lineWidth: 3, fill: true } },
  { id: 'balloon-rect', tool: 'balloon', name: 'Rectangle balloon', balloon: { shape: 'rect', lineWidth: 3, fill: true } },
  { id: 'balloon-cloud', tool: 'balloon', name: 'Thought balloon', balloon: { shape: 'cloud', lineWidth: 3, fill: true } },
  { id: 'balloon-tail', tool: 'balloon', name: 'Balloon tail', tail: { width: 24, bend: 0.3, kind: 'pointed' } },
  { id: 'balloon-tail-thought', tool: 'balloon', name: 'Thought balloon tail', tail: { width: 30, bend: 0, kind: 'thought' } },
  // Comic: flash, focus lines, speed lines (own values; the reference documents none)
  ...EFFECT_LINE_TOOLS,
  // Operation, view & eyedropper
  { id: 'object', tool: 'object', name: 'Object', scaleLineWidth: true },
  { id: 'select-layer', tool: 'selectLayer', name: 'Select layer' },
  { id: 'move', tool: 'move', name: 'Move layer' },
  { id: 'light-table', tool: 'lightTable', name: 'Light table' },
  { id: 'hand', tool: 'hand', name: 'Hand' },
  { id: 'rotate', tool: 'rotate', name: 'Rotate' },
  { id: 'zoom', tool: 'zoom', name: 'Zoom in' },
  { id: 'zoom-out', tool: 'zoom', name: 'Zoom out', zoomOut: true },
  { id: 'eyedropper', tool: 'eyedropper', name: 'Pick displayed color' },
  { id: 'eyedropper-layer', tool: 'eyedropper', name: 'Pick color from layer', fromLayer: true },
];

export const subToolsOf = (subTools: SubTool[], tool: ToolId) => subTools.filter((s) => s.tool === tool);

/** Liquify settings from storage. */
function sanitizeLiquify(raw: unknown, d: LiquifySettings): LiquifySettings {
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
  return {
    mode: LIQUIFY_MODES.some(([m]) => m === r.mode) ? (r.mode as LiquifyMode) : d.mode,
    size: num(r.size, d.size, 1, 2000),
    strength: num(r.strength, d.strength, 1, 100),
    hardness: num(r.hardness, d.hardness, 0, 100),
    antiAlias: typeof r.antiAlias === 'boolean' ? r.antiAlias : d.antiAlias,
    onlyArea: typeof r.onlyArea === 'boolean' ? r.onlyArea : d.onlyArea,
    stabilization: num(r.stabilization, d.stabilization, 0, 100),
  };
}

/** Sub tools drawn with a lasso (they can use the Magnetic lasso). */
export const usesLasso = (t: SubTool): boolean => t.selectShape === 'lasso' || t.fill?.mode === 'lasso' || t.fill?.mode === 'enclose';

/** Focus lines, speed lines and flash settings from storage. */
function sanitizeEffectLinesSettings(raw: unknown, d: EffectLinesSettings): EffectLinesSettings {
  const r = raw as Record<string, unknown>;
  const { id: _id, cx: _cx, cy: _cy, fx: _fx, fy: _fy, rx: _rx, ry: _ry, rotation: _rotation, seed: _seed, color: _color, fillColor: _fill, ...style } = sanitizeEffectLines(r.style, {
    ...DEFAULT_FOCUS_LINES,
    ...d.style,
  })!;
  const choice = (v: unknown, fallback: LinesColor): LinesColor => (v === 'main' || v === 'sub' || v === 'user' ? v : fallback);
  const hex = (v: unknown, fallback: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback);
  return {
    // The kind belongs to the sub tool.
    style: { ...style, kind: d.style.kind },
    destination: r.destination === 'editing' || r.destination === 'new' || r.destination === 'lines' ? r.destination : d.destination,
    toning: typeof r.toning === 'boolean' ? r.toning : d.toning,
    useRuler: typeof r.useRuler === 'boolean' ? r.useRuler : d.useRuler,
    lineColor: choice(r.lineColor, d.lineColor),
    fillColor: choice(r.fillColor, d.fillColor),
    userLineColor: hex(r.userLineColor, d.userLineColor),
    userFillColor: hex(r.userFillColor, d.userFillColor),
  };
}

/** Keeps user edits but adds sub tools introduced by newer versions and drops unknown ones. */
export function mergeSubTools(saved: unknown): SubTool[] {
  if (!Array.isArray(saved)) return structuredClone(DEFAULT_SUB_TOOLS);
  const byId = new Map<string, SubTool>();
  for (const s of saved) if (s && typeof s === 'object' && typeof (s as SubTool).id === 'string') byId.set((s as SubTool).id, s as SubTool);
  return DEFAULT_SUB_TOOLS.map((def) => {
    const s = byId.get(def.id);
    if (!s) return structuredClone(def);
    return {
      ...structuredClone(def),
      brush: def.brush ? migrateBrush({ ...def.brush, ...(s.brush ?? {}) }) : undefined,
      fill: def.fill ? { ...def.fill, ...(s.fill ?? {}) } : undefined,
      ...(def.symmetryLines !== undefined && typeof s.symmetryLines === 'number' ? { symmetryLines: Math.max(2, Math.min(32, Math.round(s.symmetryLines))) } : {}),
      ...(def.symmetryMirror !== undefined && typeof s.symmetryMirror === 'boolean' ? { symmetryMirror: s.symmetryMirror } : {}),
      ...(def.specialRuler && SPECIAL_RULERS.includes(s.specialRuler as SpecialRuler) ? { specialRuler: s.specialRuler } : {}),
      ...(def.curveType && CURVE_TYPES.includes(s.curveType as CurveType) ? { curveType: s.curveType } : {}),
      ...(def.rulerFigure && (s.rulerFigure === 'rect' || s.rulerFigure === 'ellipse' || s.rulerFigure === 'polygon') ? { rulerFigure: s.rulerFigure } : {}),
      ...(def.polygonCorners !== undefined && typeof s.polygonCorners === 'number' && Number.isFinite(s.polygonCorners) ? { polygonCorners: Math.max(3, Math.min(32, Math.round(s.polygonCorners))) } : {}),
      ...(def.figureCorners !== undefined && typeof s.figureCorners === 'number' && Number.isFinite(s.figureCorners) ? { figureCorners: Math.max(3, Math.min(100, Math.round(s.figureCorners))) } : {}),
      ...(def.figureRound !== undefined && typeof s.figureRound === 'number' && Number.isFinite(s.figureRound) ? { figureRound: Math.max(0, Math.min(100, s.figureRound)) } : {}),
      ...(def.figureFill !== undefined && (s.figureFill === 'line' || s.figureFill === 'fill' || s.figureFill === 'both') ? { figureFill: s.figureFill } : {}),
      ...(usesLasso(def) && typeof s.magnet === 'number' && Number.isFinite(s.magnet) ? { magnet: Math.max(0, Math.min(5, Math.round(s.magnet))) } : {}),
      ...(def.liquify && s.liquify && typeof s.liquify === 'object' ? { liquify: sanitizeLiquify(s.liquify, def.liquify) } : {}),
      ...(def.effectLines && s.effectLines && typeof s.effectLines === 'object' ? { effectLines: sanitizeEffectLinesSettings(s.effectLines, def.effectLines) } : {}),
      ...(def.tool === 'eraser' && (s.vectorErase === 'touched' || s.vectorErase === 'intersection' || s.vectorErase === 'whole') ? { vectorErase: s.vectorErase } : {}),
      ...(def.tool === 'eraser' && typeof s.vectorReferAll === 'boolean' ? { vectorReferAll: s.vectorReferAll } : {}),
      ...(def.scaleLineWidth !== undefined && typeof s.scaleLineWidth === 'boolean' ? { scaleLineWidth: s.scaleLineWidth } : {}),
      ...(def.textStyle && s.textStyle ? { textStyle: { ...sanitizeTextStyle({ ...def.textStyle, ...s.textStyle }), size: Math.min(500, sanitizeTextStyle(s.textStyle).size) } } : {}),
      ...(def.balloon && s.balloon && typeof s.balloon === 'object'
        ? {
            balloon: {
              shape: def.balloon.shape,
              lineWidth: typeof s.balloon.lineWidth === 'number' && Number.isFinite(s.balloon.lineWidth) ? Math.max(0, Math.min(100, s.balloon.lineWidth)) : def.balloon.lineWidth,
              fill: typeof s.balloon.fill === 'boolean' ? s.balloon.fill : def.balloon.fill,
            },
          }
        : {}),
      ...(def.gradient && s.gradient && typeof s.gradient === 'object'
        ? {
            gradient: {
              stops: sanitizeGradientStops(s.gradient.stops) ?? def.gradient.stops,
              shape: s.gradient.shape === 'circle' || s.gradient.shape === 'ellipse' || s.gradient.shape === 'line' ? s.gradient.shape : def.gradient.shape,
              edge: s.gradient.edge === 'repeat' || s.gradient.edge === 'reverse' || s.gradient.edge === 'clear' || s.gradient.edge === 'none' ? s.gradient.edge : def.gradient.edge,
              dither: typeof s.gradient.dither === 'boolean' ? s.gradient.dither : def.gradient.dither,
              layer: typeof s.gradient.layer === 'boolean' ? s.gradient.layer : def.gradient.layer,
            },
          }
        : {}),
      ...(def.frameLine !== undefined && typeof s.frameLine === 'number' && Number.isFinite(s.frameLine) ? { frameLine: Math.max(0, Math.min(100, s.frameLine)) } : {}),
      ...(def.gutterTopBottom !== undefined && typeof s.gutterTopBottom === 'number' && Number.isFinite(s.gutterTopBottom) ? { gutterTopBottom: Math.max(0, Math.min(100, s.gutterTopBottom)) } : {}),
      ...(def.gutterLeftRight !== undefined && typeof s.gutterLeftRight === 'number' && Number.isFinite(s.gutterLeftRight) ? { gutterLeftRight: Math.max(0, Math.min(100, s.gutterLeftRight)) } : {}),
      ...(def.divideFolder !== undefined && typeof s.divideFolder === 'boolean' ? { divideFolder: s.divideFolder } : {}),
      ...(def.correct ? { correct: sanitizeCorrect(def.correct, s.correct) } : {}),
      ...(def.tail && s.tail && typeof s.tail === 'object'
        ? {
            tail: {
              kind: def.tail.kind,
              width: typeof s.tail.width === 'number' && Number.isFinite(s.tail.width) ? Math.max(1, Math.min(1000, s.tail.width)) : def.tail.width,
              bend: typeof s.tail.bend === 'number' && Number.isFinite(s.tail.bend) ? Math.max(-1, Math.min(1, s.tail.bend)) : def.tail.bend,
            },
          }
        : {}),
    };
  });
}

/** Brush settings read from a file or storage, completed with defaults and validated. */
export function sanitizeBrush(raw: unknown): BrushSettings {
  const r = raw && typeof raw === 'object' ? (raw as Partial<BrushSettings>) : {};
  const n = (v: unknown, fallback: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
  const b = migrateBrush({ ...DEFAULT_BRUSH, ...r });
  return {
    ...b,
    size: n(b.size, DEFAULT_BRUSH.size, 0.1, 5000),
    minSize: n(b.minSize, DEFAULT_BRUSH.minSize, 0, 1),
    opacity: n(b.opacity, 1, 0, 1),
    flow: n(b.flow, 1, 0, 1),
    hardness: n(b.hardness, DEFAULT_BRUSH.hardness, 0, 1),
    spacing: n(b.spacing, DEFAULT_BRUSH.spacing, 0.01, 5),
    stabilization: n(b.stabilization, 0, 0, 100),
    scatter: n(b.scatter, 0, 0, 50),
    sizePressure: b.sizePressure === true,
    opacityPressure: b.opacityPressure === true,
    sizeTilt: b.sizeTilt === true,
    densityTilt: b.densityTilt === true,
    sizeVelocity: b.sizeVelocity === true,
    densityVelocity: b.densityVelocity === true,
    taperSize: b.taperSize !== false,
    taperDensity: b.taperDensity === true,
    watercolorEdge: b.watercolorEdge === true,
    texture: b.texture === 'grain' ? 'grain' : 'none',
    mode: b.mode === 'erase' || b.mode === 'blend' ? b.mode : 'paint',
    blendStyle: b.blendStyle === 'smudge' ? 'smudge' : 'blur',
  };
}

/** Older settings stored anti-aliasing as on/off; newer settings are validated (they come from storage). */
function migrateBrush(b: BrushSettings): BrushSettings {
  const aa = b.antiAlias as unknown;
  const antiAlias = typeof aa === 'boolean' ? (aa ? 2 : 0) : typeof aa === 'number' && Number.isFinite(aa) ? Math.max(0, Math.min(3, Math.round(aa))) : 2;
  const n = (v: unknown, fallback: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
  const d = DEFAULT_BRUSH;
  return {
    ...b,
    antiAlias,
    sizeCurve: sanitizeCurve01(b.sizeCurve) ?? LINEAR,
    densityCurve: sanitizeCurve01(b.densityCurve) ?? LINEAR,
    minDensity: n(b.minDensity, d.minDensity, 0, 1),
    sizeRandom: n(b.sizeRandom, 0, 0, 1),
    densityRandom: n(b.densityRandom, 0, 0, 1),
    thickness: n(b.thickness, 1, 0.05, 1),
    angle: n(b.angle, 0, -360, 360),
    angleSource: b.angleSource === 'line' || b.angleSource === 'tilt' ? b.angleSource : 'fixed',
    taperStart: n(b.taperStart, 0, 0, 2000),
    taperEnd: n(b.taperEnd, 0, 0, 2000),
    mixing: b.mixing === 'blend' || b.mixing === 'running' ? b.mixing : 'none',
    paintAmount: n(b.paintAmount, d.paintAmount, 0, 1),
    paintDensity: n(b.paintDensity, d.paintDensity, 0, 1),
    colorStretch: n(b.colorStretch, d.colorStretch, 0, 1),
    edgeRange: n(b.edgeRange, d.edgeRange, 0.5, 100),
    edgeOpacity: n(b.edgeOpacity, d.edgeOpacity, 0, 1),
    edgeDarkness: n(b.edgeDarkness, d.edgeDarkness, 0, 1),
    tipShape: b.tipShape === 'material' ? 'material' : 'circle',
    tipMaterials: Array.isArray(b.tipMaterials) ? b.tipMaterials.filter((id): id is string => typeof id === 'string' && MATERIAL_ID.test(id)).slice(0, 16) : [],
    tipOrder: TIP_ORDERS.includes(b.tipOrder) ? b.tipOrder : 'repeat',
    flipH: b.flipH === 'on' || b.flipH === 'random' ? b.flipH : 'off',
    flipV: b.flipV === 'on' || b.flipV === 'random' ? b.flipV : 'off',
    angleRandom: n(b.angleRandom, 0, 0, 1),
    paper: typeof b.paper === 'string' && MATERIAL_ID.test(b.paper) ? b.paper : '',
    paperDensity: n(b.paperDensity, 1, 0, 1),
    paperScale: n(b.paperScale, 100, 5, 1000),
    paperAngle: n(b.paperAngle, 0, -360, 360),
    paperBrightness: n(b.paperBrightness, 0, -100, 100),
    paperContrast: n(b.paperContrast, 0, -100, 100),
    paperInvert: b.paperInvert === true,
    paperMode: b.paperMode === 'multiply' ? 'multiply' : 'subtract',
    paperPerDab: b.paperPerDab === true,
  };
}

/** Ids of materials: the built-in names, or imported ones ("img-…"). */
const MATERIAL_ID = /^[a-z0-9-]{1,40}$/;
const TIP_ORDERS: readonly TipOrder[] = ['repeat', 'reverse', 'stay', 'random', 'once'];

/** Next tool for a shortcut key: cycles through the tools sharing that key. */
export function toolForKey(key: string, current: ToolId): ToolId | null {
  const group = TOOLS.filter((t) => t.key.toLowerCase() === key.toLowerCase());
  if (group.length === 0) return null;
  const i = group.findIndex((t) => t.id === current);
  return group[(i + 1) % group.length].id;
}

/** A button in the tool palette; some buttons hold several tools (switched in the sub tool palette). */
export interface PaletteEntry {
  id: string;
  label: string;
  icon: string;
  tools: ToolId[];
}

export const PALETTE_ENTRIES: PaletteEntry[] = [
  { id: 'zoom', label: 'Zoom', icon: 'zoom', tools: ['zoom'] },
  { id: 'navigate', label: 'Move (Hand, Rotate)', icon: 'hand', tools: ['hand', 'rotate'] },
  { id: 'operation', label: 'Operation (Object, Select layer, Move layer, Light table)', icon: 'operation', tools: ['object', 'selectLayer', 'move', 'lightTable'] },
  { id: 'select', label: 'Selection area', icon: 'select', tools: ['select'] },
  { id: 'autoSelect', label: 'Auto select', icon: 'autoSelect', tools: ['autoSelect'] },
  { id: 'eyedropper', label: 'Eyedropper', icon: 'eyedropper', tools: ['eyedropper'] },
  { id: 'pen', label: 'Pen', icon: 'pen', tools: ['pen'] },
  { id: 'pencil', label: 'Pencil', icon: 'pencil', tools: ['pencil'] },
  { id: 'brush', label: 'Brush', icon: 'brush', tools: ['brush'] },
  { id: 'airbrush', label: 'Airbrush', icon: 'airbrush', tools: ['airbrush'] },
  { id: 'decoration', label: 'Decoration', icon: 'decoration', tools: ['decoration'] },
  { id: 'eraser', label: 'Eraser', icon: 'eraser', tools: ['eraser'] },
  { id: 'blend', label: 'Blend', icon: 'blend', tools: ['blend'] },
  { id: 'liquify', label: 'Liquify', icon: 'liquify', tools: ['liquify'] },
  { id: 'fill', label: 'Fill', icon: 'fill', tools: ['fill'] },
  { id: 'gradient', label: 'Gradient', icon: 'gradient', tools: ['gradient'] },
  { id: 'figure', label: 'Figure', icon: 'figure', tools: ['figure'] },
  { id: 'ruler', label: 'Ruler', icon: 'ruler', tools: ['ruler'] },
  { id: 'text', label: 'Text', icon: 'text', tools: ['text'] },
  // Ver. 5: the Comic tool holds balloons, frame borders, flashes, focus lines and speed lines.
  { id: 'comic', label: 'Comic (Balloon, Frame border, Flash, Focus lines, Speed lines)', icon: 'balloon', tools: ['balloon', 'frame', 'flash', 'focusLines', 'speedLines'] },
  { id: 'correct', label: 'Correct line', icon: 'correct', tools: ['correct'] },
  // The classic layout: speed and focus lines with the figures, flashes with the balloons.
  { id: 'figureClassic', label: 'Figure (Figure, Speed lines, Focus lines)', icon: 'figure', tools: ['figure', 'speedLines', 'focusLines'] },
  { id: 'frame', label: 'Frame border', icon: 'frame', tools: ['frame'] },
  { id: 'textClassic', label: 'Text (Text, Balloon, Flash)', icon: 'text', tools: ['text', 'balloon', 'flash'] },
];

export type WorkspaceId = 'default' | 'classic';

/**
 * Tool palette sections per workspace: the current default layout (drawing tools first) and the
 * classic layout (view and selection tools first). In the default layout the Zoom tool has no
 * button; it is reached with "/" or ⌘+Space.
 */
export const PALETTE_LAYOUT: Record<WorkspaceId, string[][]> = {
  default: [
    ['pen', 'pencil', 'brush', 'eraser', 'airbrush', 'decoration', 'blend', 'liquify'],
    ['select', 'autoSelect', 'fill', 'gradient'],
    ['operation', 'figure', 'text', 'comic', 'ruler', 'correct', 'navigate', 'eyedropper'],
  ],
  classic: [
    ['zoom', 'navigate', 'operation', 'select', 'autoSelect', 'eyedropper'],
    ['pen', 'pencil', 'brush', 'airbrush', 'decoration', 'eraser', 'blend', 'liquify'],
    ['fill', 'gradient', 'figureClassic', 'frame', 'ruler', 'textClassic', 'correct'],
  ],
};

/** The tool palette button that holds `tool` in a workspace's layout. */
export function entryForTool(tool: ToolId, workspace: WorkspaceId = 'default'): PaletteEntry {
  const ids = PALETTE_LAYOUT[workspace].flat();
  return PALETTE_ENTRIES.find((e) => ids.includes(e.id) && e.tools.includes(tool)) ?? PALETTE_ENTRIES.find((e) => e.tools.includes(tool))!;
}
