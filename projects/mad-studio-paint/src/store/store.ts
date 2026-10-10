import { create } from 'zustand';
import { defaultColorSets, type ColorSets } from '../paint/colorSets';
import { createDocument } from '../model/document';
import type { Id, PaintDocument } from '../model/types';
import type { Mask, SelectionOp } from '../paint/mask';
import { LINEAR, type CurvePoint } from '../paint/curve';
import { DEFAULT_SUB_TOOLS, type SubTool, type ToolId, type WorkspaceId } from '../paint/tools';
import type { TextBox } from '../paint/text';
import { DEFAULT_ONION, type OnionSkin } from '../paint/animation';
import type { Channel, ChannelGroup, Interp } from '../paint/keyframes';
import type { LabelRef } from '../paint/labels';
import { DEFAULT_APPROX, DEFAULT_CORNERS, DEFAULT_TILE_GRID, type ApproxSettings, type Corners, type TileGrid } from '../paint/colorGrids';
import { DEFAULT_HIDDEN_PALETTES, type LayerDockTab, type PaletteId } from '../model/palettes';

export interface ViewState {
  /** Screen pixels per document pixel. */
  zoom: number;
  /** Degrees, clockwise. */
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  /** Offset of the document centre from the viewport centre, in CSS pixels. */
  panX: number;
  panY: number;
}

export interface ColorState {
  main: string;
  sub: string;
  /** Which of the two colours the brushes use. */
  active: 'main' | 'sub';
  /** Drawing with the transparent colour erases. */
  transparent: boolean;
  history: string[];
}

export interface Preferences {
  theme: 'dark' | 'light';
  /** Rotate left / right step in degrees. */
  rotationStep: number;
  /** Number of undo steps. */
  undoLevels: number;
  /** Holding a tool key longer than this (ms) switches back on release. */
  holdMs: number;
  /** File > Pen pressure settings: maps the pen's raw pressure for all tools (0..1 graph). */
  pressureCurve: CurvePoint[];
}

export const DEFAULT_PREFS: Preferences = { theme: 'dark', rotationStep: 5, undoLevels: 200, holdMs: 500, pressureCurve: LINEAR };

/** Text being typed or edited on the canvas (Text tool). */
export interface TextEdit {
  /** Layer of the text box; null: a new text layer is made when the text is confirmed. */
  layerId: Id | null;
  box: TextBox;
  /** Text typed into a balloon is centred in it when confirmed. */
  balloonId?: string;
}

export interface PaintState {
  doc: PaintDocument;
  activeLayerId: Id;
  /** The active layer's mask thumbnail is selected: drawing tools edit the mask. */
  maskEditing: boolean;
  /** Layer > Layer mask > Show mask area: the masked part of the active layer is tinted. */
  showMaskArea: boolean;
  selection: Mask | null;
  /** Default combine mode of the selection tools (modifier keys override it). */
  selectionOp: SelectionOp;
  tool: ToolId;
  /** Selected sub tool per tool. */
  activeSub: Partial<Record<ToolId, string>>;
  subTools: SubTool[];
  colors: ColorState;
  view: ViewState;
  viewport: { w: number; h: number };
  canUndo: boolean;
  canRedo: boolean;
  /** Bumped on every undo-history change (History palette). */
  historyVersion: number;
  dirty: boolean;
  fileName: string | null;
  /** A free transform is in progress (Enter confirms, Esc cancels). */
  transforming: boolean;
  /** Short help text for the status bar. */
  hint: string;
  /** Tab hides all palettes (canvas only). */
  palettesHidden: boolean;
  /** View > Selection launcher. */
  showSelectionLauncher: boolean;
  /** Command bar toggle "Show border of selected area". */
  showSelectionBorder: boolean;
  /** Window > Workspace: the current default layout or the classic one. */
  workspace: WorkspaceId;
  /** Shift+Tab hides the menu bar. */
  menuHidden: boolean;
  /** The Advanced Tool Settings palette is open. */
  advancedToolSettings: boolean;
  /** View > Snap: linear rulers and guides / special rulers (symmetry, perspective, …) / grid. */
  snapRuler: boolean;
  snapSpecial: boolean;
  snapGrid: boolean;
  /** View > Grid and View > Ruler bar. */
  showGrid: boolean;
  showRulerBar: boolean;
  /** Color Wheel / Color Slider palettes: HSV (square) or HLS (triangle). */
  colorSpace: 'hsv' | 'hls';
  /** The Color Set palette's sets (kept in the browser, like tool settings). */
  colorSets: ColorSets;
  /** Ruler selected with the Object tool. */
  selectedRuler: { layerId: Id; rulerId: string } | null;
  /** Objects of the active layer selected with the Object tool (vector lines, text boxes, balloons). */
  selectedObjects: string[];
  textEdit: TextEdit | null;
  prefs: Preferences;
  /** Animation: the current frame of the timeline (1 = first). */
  frame: number;
  /** The timeline is playing; Loop play starts again at the end. */
  playing: boolean;
  loop: boolean;
  /** Enable onion skin, and its settings (Animation > Show animation cels > Onion skin settings). */
  onionSkin: boolean;
  onion: OnionSkin;
  /** Window > Timeline (also opened when a canvas gets a timeline). */
  timelineShown: boolean;
  /** Height of the Timeline palette (px; dragged at its top edge). */
  timelineHeight: number;
  /** Clips selected in the Timeline palette: their track and first frame. */
  clipSelection: ClipRef[];
  /** Keyframes selected in the Timeline palette: their track and frame. */
  keySelection: KeyRef[];
  /** Assigned cels selected in the Timeline palette: their animation folder and frame. */
  celSelection: CelRef[];
  /** Track labels selected in the Timeline palette: their track and first frame. */
  labelSelection: LabelRef[];
  /** Keyframe interpolation for new keyframes (Timeline palette). */
  keyInterp: Interp;
  /** Edit layers with active keyframes: the current track is drawn as it is and can be drawn on. */
  editKeyed: boolean;
  /** Timeline palette: tracks with Details (+) open (their property rows), and those with Transform opened (>). */
  keyDetails: Id[];
  transformDetails: Id[];
  /** View > Crop marks/Inner border: the animation frame lines show on the canvas. */
  showFrameLines: boolean;
  /** The Timeline palette shows the Graph Editor: the current track's settings as curves. */
  graphEditor: boolean;
  /** Graph Editor: the selected points of curves. */
  graphSelection: CurveRef[];
  /** Graph Editor > View: the X, Y and other curves shown. */
  graphAxes: { x: boolean; y: boolean; other: boolean };
  /** Graph Editor: settings whose eye is off in the settings list, and the setting selected there. */
  graphHidden: ChannelGroup[];
  graphSetting: ChannelGroup | null;
  /** Graph Editor: Snap to X axis (frames) / Y axis (value grid); Drag to zoom. */
  graphSnapX: boolean;
  graphSnapY: boolean;
  graphDragZoom: boolean;
  /** Show camera's field of view: the display applies 2D camera effects. */
  cameraView: boolean;
  /** Animation cels palette: Enable light table, Show cel-specific / general light table. */
  lightOn: boolean;
  lightShowCel: boolean;
  lightShowGeneral: boolean;
  /** The light table layer selected in the Animation cels palette. */
  lightSelection: string | null;
  /** Light table layers selected besides it (Ctrl/⌘-click; Move canvas to center uses two). */
  lightPicked: string[];
  /** Lock current animation cel as editing target: that cel stays the target cel. */
  lockedCel: Id | null;
  /** Switch opacity target between All or Individual: on changes all light table layers. */
  lightOpacityAll: boolean;
  /** The tab shown in the dock with the Layer palette. */
  layerDockTab: LayerDockTab;
  /** Window menu: palettes switched off, and the tab in front of each palette stack. */
  hiddenPalettes: PaletteId[];
  paletteTabs: Record<string, string>;
  /** Intermediate Color palette: the four corner colours and how the tiles show. */
  intermediate: { corners: Corners; grid: TileGrid };
  /** Approximate Color palette: its two sliders and how the tiles show. */
  approximate: ApproxSettings;
}

/** A keyframe in the Timeline palette: the track (layer) and its frame (on a property row: `group`). */
export interface KeyRef {
  track: Id;
  frame: number;
  group?: ChannelGroup;
}

/** A point of a curve in the Graph Editor: the track, the keyframe's frame and the channel. */
export interface CurveRef {
  track: Id;
  frame: number;
  ch: Channel;
}

/** A clip in the Timeline palette: the track (layer) and the clip's first frame. */
export interface ClipRef {
  track: Id;
  start: number;
}

export interface CelRef {
  track: Id;
  frame: number;
}

export type { LabelRef };

export const initialView: ViewState = { zoom: 1, rotation: 0, flipH: false, flipV: false, panX: 0, panY: 0 };

function initialState(): PaintState {
  const doc = createDocument('Illustration', 1600, 1200, 72);
  const activeSub: Partial<Record<ToolId, string>> = {};
  for (const s of DEFAULT_SUB_TOOLS) if (!activeSub[s.tool]) activeSub[s.tool] = s.id;
  return {
    doc,
    activeLayerId: doc.layers[0].id,
    maskEditing: false,
    showMaskArea: false,
    selection: null,
    selectionOp: 'replace',
    tool: 'pen',
    activeSub,
    subTools: structuredClone(DEFAULT_SUB_TOOLS),
    colors: { main: '#000000', sub: '#ffffff', active: 'main', transparent: false, history: [] },
    view: { ...initialView },
    viewport: { w: 1000, h: 700 },
    canUndo: false,
    canRedo: false,
    historyVersion: 0,
    dirty: false,
    fileName: null,
    transforming: false,
    hint: '',
    palettesHidden: false,
    showSelectionLauncher: true,
    showSelectionBorder: true,
    workspace: 'default',
    menuHidden: false,
    advancedToolSettings: false,
    snapRuler: true,
    snapSpecial: true,
    snapGrid: false,
    showGrid: false,
    showRulerBar: false,
    colorSpace: 'hsv',
    colorSets: defaultColorSets(),
    selectedRuler: null,
    selectedObjects: [],
    textEdit: null,
    prefs: { ...DEFAULT_PREFS },
    frame: 1,
    playing: false,
    loop: true,
    onionSkin: false,
    onion: { ...DEFAULT_ONION },
    timelineShown: false,
    timelineHeight: 190,
    clipSelection: [],
    celSelection: [],
    labelSelection: [],
    keySelection: [],
    keyInterp: 'linear',
    editKeyed: false,
    keyDetails: [],
    transformDetails: [],
    showFrameLines: true,
    graphEditor: false,
    graphSelection: [],
    graphAxes: { x: true, y: true, other: true },
    graphHidden: [],
    graphSetting: null,
    graphSnapX: true,
    graphSnapY: false,
    graphDragZoom: false,
    cameraView: false,
    lightOn: true,
    lightShowCel: true,
    lightShowGeneral: true,
    lightSelection: null,
    lightPicked: [],
    lockedCel: null,
    lightOpacityAll: false,
    layerDockTab: 'layer',
    hiddenPalettes: [...DEFAULT_HIDDEN_PALETTES],
    paletteTabs: {},
    intermediate: { corners: [...DEFAULT_CORNERS], grid: { ...DEFAULT_TILE_GRID } },
    approximate: structuredClone(DEFAULT_APPROX),
  };
}

export const useStore = create<PaintState>(initialState);

export const getState = () => useStore.getState();
export const setState = useStore.setState;

/** The sub tool currently selected for a tool. */
export function currentSubTool(s: PaintState = getState(), tool: ToolId = s.tool): SubTool {
  const id = s.activeSub[tool];
  return s.subTools.find((t) => t.id === id) ?? s.subTools.find((t) => t.tool === tool)!;
}

/** Colour the brushes paint with right now. */
export const drawingColor = (c: ColorState) => (c.active === 'main' ? c.main : c.sub);
