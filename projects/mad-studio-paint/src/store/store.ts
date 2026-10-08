import { create } from 'zustand';
import { createDocument } from '../model/document';
import type { Id, PaintDocument } from '../model/types';
import type { Mask, SelectionOp } from '../paint/mask';
import { LINEAR, type CurvePoint } from '../paint/curve';
import { DEFAULT_SUB_TOOLS, type SubTool, type ToolId, type WorkspaceId } from '../paint/tools';

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
  /** View > Snap: linear rulers and guides / special rulers (symmetry, perspective, …). */
  snapRuler: boolean;
  snapSpecial: boolean;
  /** Ruler selected with the Object tool. */
  selectedRuler: { layerId: Id; rulerId: string } | null;
  /** Vector lines of the active layer selected with the Object tool (line ids). */
  selectedLines: string[];
  prefs: Preferences;
}

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
    selectedRuler: null,
    selectedLines: [],
    prefs: { ...DEFAULT_PREFS },
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
