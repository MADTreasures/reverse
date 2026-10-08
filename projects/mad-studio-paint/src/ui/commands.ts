/** Every menu command, its shortcut and handler. Menus (browser and native) and the keyboard use this table. */
import { flatten } from '../model/layers';
import { isMac } from '../platform/platform';
import { importImages, openDocument, saveDocument } from '../io/documentIO';
import * as actions from '../store/actions';
import { copy, cut, hasClip, pasteImage } from '../store/clipboard';
import { getState, setState } from '../store/store';
import { cancelTransform, confirmTransform, isTransforming, startTransform } from '../tools/transform';
import { CORRECTIONS, correctionLabel, defaultCorrection, type CorrectionType } from '../paint/tonal';
import { openDialog, openTonalDialog, promptDialog } from './overlays';
import { formatShortcut, normalizeShortcut } from './shortcuts';

export interface Command {
  id: string;
  label: string;
  /** Canonical shortcuts; the first one is shown in menus. */
  keys?: string[];
  run: () => void | Promise<void>;
  enabled?: () => boolean;
  checked?: () => boolean;
}

const hasSelection = () => getState().selection !== null;
const canEdit = () => actions.editBlocker() === null;
const notTransforming = () => !isTransforming();
const hasLayer = () => actions.activeLayer() !== null;
const hasMask = () => Boolean(actions.activeLayer()?.mask);

async function askGrow(sign: 1 | -1): Promise<void> {
  const v = await promptDialog(sign > 0 ? 'Expand selected area by (px)' : 'Shrink selected area by (px)', '4');
  const n = Math.round(Number(v));
  if (v !== null && Number.isFinite(n) && n > 0) actions.growSelection(sign * n);
}

async function renameCanvas(): Promise<void> {
  const v = await promptDialog('Canvas name', getState().doc.name);
  if (v !== null) actions.renameDocument(v);
}

/** Default shortcuts of Edit > Tonal correction (the reference has two). */
const TONAL_KEYS: Partial<Record<CorrectionType, string[]>> = { hsl: ['Mod+u'], reverse: ['Mod+i'] };

/** Edit > Tonal correction ▸ (the current layer's pixels) and Layer > New correction layer ▸. */
const tonalCommands = (): Command[] =>
  CORRECTIONS.flatMap(({ type }) => {
    const dots = type === 'reverse' ? '' : '…';
    return [
      {
        id: `tonal-${type}`,
        label: `${correctionLabel(type)}${dots}`,
        keys: TONAL_KEYS[type],
        run: () => (type === 'reverse' ? actions.applyCorrectionNow(defaultCorrection('reverse')) : openTonalDialog({ kind: 'pixels', type })),
        enabled: canEdit,
      },
      {
        id: `correction-${type}`,
        label: `${correctionLabel(type)}${dots}`,
        run: () => (type === 'reverse' ? void actions.addCorrectionLayer(defaultCorrection('reverse')) : openTonalDialog({ kind: 'newLayer', type })),
      },
    ];
  });

const layerFlag = (key: 'clip' | 'reference' | 'draft' | 'locked', label: string): Pick<Command, 'run' | 'checked' | 'enabled'> => ({
  run: () => {
    const l = actions.activeLayer();
    if (l) actions.setLayerProps(l.id, { [key]: !l[key] }, label);
  },
  checked: () => Boolean(actions.activeLayer()?.[key]),
  enabled: () => actions.activeLayer() !== null,
});

export const COMMANDS: Command[] = [
  // File
  { id: 'new', label: 'New…', keys: ['Mod+n'], run: () => openDialog('newCanvas') },
  { id: 'open', label: 'Open…', keys: ['Mod+o'], run: () => openDocument() },
  { id: 'save', label: 'Save', keys: ['Mod+s'], run: () => void saveDocument(false) },
  { id: 'saveAs', label: 'Save as…', keys: ['Mod+Shift+s', 'Mod+Alt+s'], run: () => void saveDocument(true) },
  { id: 'importImage', label: 'Import image as layer…', run: () => importImages() },
  { id: 'export', label: 'Export (single layer)…', run: () => openDialog('export') },
  { id: 'preferences', label: 'Preferences…', keys: ['Mod+k'], run: () => openDialog('preferences') },
  { id: 'pressureSettings', label: 'Pen pressure settings…', run: () => openDialog('pressure') },
  { id: 'renameCanvas', label: 'Canvas name…', run: () => renameCanvas() },
  // Edit
  { id: 'undo', label: 'Undo', keys: ['Mod+z'], run: () => actions.undo(), enabled: () => getState().canUndo && notTransforming() },
  { id: 'redo', label: 'Redo', keys: ['Mod+y', 'Mod+Shift+z'], run: () => actions.redo(), enabled: () => getState().canRedo && notTransforming() },
  { id: 'cut', label: 'Cut', keys: ['Mod+x', 'F2'], run: () => void cut(), enabled: canEdit },
  { id: 'copy', label: 'Copy', keys: ['Mod+c', 'F3'], run: () => void copy(), enabled: () => actions.editTarget() !== null },
  { id: 'paste', label: 'Paste', keys: ['Mod+v', 'F4', 'Mod+Shift+v'], run: () => void pasteImage(), enabled: () => hasClip() },
  { id: 'clear', label: 'Delete', keys: ['backspace', 'delete', 'Mod+backspace'], run: () => actions.clearLayer(), enabled: canEdit },
  { id: 'clearOutside', label: 'Delete outside selected area', keys: ['Shift+backspace', 'Shift+delete'], run: () => actions.clearOutsideSelection(), enabled: () => canEdit() && hasSelection() },
  { id: 'fill', label: 'Fill', keys: ['Alt+backspace', 'Alt+delete'], run: () => actions.fillWithColor(), enabled: canEdit },
  { id: 'transform', label: 'Transform: Scale up/Scale down/Rotate', keys: ['Mod+t'], run: () => void startTransform('scaleRotate'), enabled: () => canEdit() && notTransforming() },
  { id: 'freeTransform', label: 'Transform: Free transform', keys: ['Mod+Shift+t'], run: () => void startTransform('free'), enabled: () => canEdit() && notTransforming() },
  { id: 'confirmTransform', label: 'Confirm transform', keys: ['enter'], run: () => confirmTransform(), enabled: () => isTransforming() },
  { id: 'cancelTransform', label: 'Cancel transform', keys: ['escape'], run: () => cancelTransform(), enabled: () => isTransforming() },
  { id: 'canvasSize', label: 'Change canvas size…', run: () => openDialog('canvasSize'), enabled: notTransforming },
  { id: 'imageResolution', label: 'Change image resolution…', run: () => openDialog('imageResolution'), enabled: notTransforming },
  { id: 'flipLayerH', label: 'Flip layer horizontal', run: () => actions.flipLayer(true), enabled: canEdit },
  { id: 'flipLayerV', label: 'Flip layer vertical', run: () => actions.flipLayer(false), enabled: canEdit },
  // Layer
  { id: 'newRasterLayer', label: 'New raster layer', keys: ['Mod+Shift+n'], run: () => void actions.addRasterLayer() },
  { id: 'newFolder', label: 'New layer folder', run: () => void actions.addFolder() },
  { id: 'groupLayer', label: 'Create folder and insert layer', keys: ['Mod+g'], run: () => actions.groupLayer() },
  {
    id: 'ungroupLayer',
    label: 'Ungroup layer folder',
    keys: ['Mod+Shift+g'],
    run: () => actions.ungroupFolder(),
    enabled: () => actions.activeLayer()?.kind === 'folder',
  },
  { id: 'duplicateLayer', label: 'Duplicate layer', run: () => actions.duplicateLayer() },
  ...tonalCommands(),
  {
    id: 'correctionSettings',
    label: 'Correction layer settings…',
    run: () => {
      const l = actions.activeLayer();
      if (l?.kind === 'correction' && l.correction.type !== 'reverse') openTonalDialog({ kind: 'layer', layerId: l.id });
    },
    enabled: () => {
      const l = actions.activeLayer();
      return l?.kind === 'correction' && l.correction.type !== 'reverse';
    },
  },
  // Layer > Layer mask
  { id: 'maskOutside', label: 'Mask outside selection', run: () => actions.maskLayer(true), enabled: hasLayer },
  { id: 'maskSelection', label: 'Mask selection', run: () => actions.maskLayer(false), enabled: hasLayer },
  { id: 'applyMask', label: 'Apply mask to layer', run: () => actions.applyMaskToLayer(), enabled: hasMask },
  { id: 'deleteMask', label: 'Delete mask', run: () => actions.deleteMask(), enabled: hasMask },
  { id: 'enableMask', label: 'Enable mask', run: () => actions.toggleMaskEnabled(), enabled: hasMask, checked: () => Boolean(actions.activeLayer()?.mask?.enabled) },
  { id: 'linkMask', label: 'Link mask to layer', run: () => actions.toggleMaskLink(), enabled: hasMask, checked: () => Boolean(actions.activeLayer()?.mask?.linked) },
  { id: 'showMaskArea', label: 'Show mask area', run: () => actions.toggleShowMaskArea(), checked: () => getState().showMaskArea },
  { id: 'deleteLayer', label: 'Delete layer', run: () => actions.deleteLayer(), enabled: () => flatten(getState().doc.layers).length > 1 },
  { id: 'mergeDown', label: 'Merge with layer below', keys: ['Mod+e'], run: () => actions.mergeDown(), enabled: () => actions.canMergeDown() },
  { id: 'mergeVisible', label: 'Merge visible layers', keys: ['Mod+Shift+e'], run: () => actions.mergeVisible() },
  { id: 'flatten', label: 'Flatten image', run: () => actions.flattenImage() },
  { id: 'clip', label: 'Clip to layer below', keys: ['Mod+Alt+g'], ...layerFlag('clip', 'Clip to layer below') },
  { id: 'reference', label: 'Set as reference layer', ...layerFlag('reference', 'Reference layer') },
  { id: 'draft', label: 'Set as draft layer', ...layerFlag('draft', 'Draft layer') },
  { id: 'lockLayer', label: 'Lock layer', keys: ['Mod+l'], ...layerFlag('locked', 'Lock layer') },
  {
    id: 'lockAlpha',
    label: 'Lock transparent pixels',
    run: () => {
      const l = actions.activeRaster();
      if (l) actions.setLayerProps(l.id, { lockAlpha: !l.lockAlpha }, 'Lock transparent pixels');
    },
    checked: () => Boolean(actions.activeRaster()?.lockAlpha),
    enabled: () => actions.activeRaster() !== null,
  },
  { id: 'layerUp', label: 'Move layer up', run: () => actions.shiftLayer(-1) },
  { id: 'layerDown', label: 'Move layer down', run: () => actions.shiftLayer(1) },
  { id: 'selectLayerAbove', label: 'Select layer above', keys: ['Alt+]'], run: () => actions.selectAdjacentLayer(-1) },
  { id: 'selectLayerBelow', label: 'Select layer below', keys: ['Alt+['], run: () => actions.selectAdjacentLayer(1) },
  // Selection
  { id: 'selectAll', label: 'Select all', keys: ['Mod+a'], run: () => actions.selectAll() },
  { id: 'deselect', label: 'Deselect', keys: ['Mod+d'], run: () => actions.deselect(), enabled: hasSelection },
  { id: 'reselect', label: 'Reselect', keys: ['Mod+Shift+d'], run: () => actions.reselect() },
  { id: 'invertSelection', label: 'Invert selected area', keys: ['Mod+Shift+i'], run: () => actions.invertSelection() },
  { id: 'expandSelection', label: 'Expand selected area…', run: () => askGrow(1), enabled: hasSelection },
  { id: 'shrinkSelection', label: 'Shrink selected area…', run: () => askGrow(-1), enabled: hasSelection },
  // View
  { id: 'zoomIn', label: 'Zoom in', keys: ['Mod+=', 'Mod++', 'Mod+Shift+=', 'Mod+;'], run: () => actions.zoomStep(1) },
  { id: 'zoomOut', label: 'Zoom out', keys: ['Mod+-'], run: () => actions.zoomStep(-1) },
  { id: 'actualPixels', label: '100%', keys: ['Mod+Alt+0'], run: () => actions.actualPixels() },
  { id: 'fit', label: 'Fit to window', keys: ['Mod+0'], run: () => actions.fitToWindow() },
  { id: 'rotateLeft', label: 'Rotate left', keys: ['-'], run: () => actions.rotateView(-actions.rotationStep()) },
  { id: 'rotateRight', label: 'Rotate right', keys: ['^', '='], run: () => actions.rotateView(actions.rotationStep()) },
  { id: 'resetRotation', label: 'Reset rotation', run: () => actions.resetRotation() },
  { id: 'rotate90', label: 'Rotate 90°', run: () => actions.setRotation(90) },
  { id: 'rotate180', label: 'Rotate 180°', run: () => actions.setRotation(180) },
  { id: 'rotate270', label: 'Rotate 270°', run: () => actions.setRotation(-90) },
  { id: 'resetDisplay', label: 'Reset display', keys: ['Mod+@'], run: () => actions.resetDisplay() },
  { id: 'flipViewH', label: 'Flip horizontal (view)', run: () => actions.flipView(true), checked: () => getState().view.flipH },
  { id: 'flipViewV', label: 'Flip vertical (view)', run: () => actions.flipView(false), checked: () => getState().view.flipV },
  // Window
  { id: 'togglePalettes', label: 'Hide all palettes', keys: ['tab'], run: () => setState((s) => ({ palettesHidden: !s.palettesHidden })), checked: () => getState().palettesHidden },
  { id: 'toggleMenuBar', label: 'Hide title bar and menu bar', keys: ['Shift+tab'], run: () => setState((s) => ({ menuHidden: !s.menuHidden })), checked: () => getState().menuHidden },
  { id: 'workspaceDefault', label: 'Workspace: Default', run: () => setState({ workspace: 'default' }), checked: () => getState().workspace === 'default' },
  { id: 'workspaceClassic', label: 'Workspace: Classic layout', run: () => setState({ workspace: 'classic' }), checked: () => getState().workspace === 'classic' },
  {
    id: 'selectionLauncher',
    label: 'Selection launcher',
    run: () => setState((s) => ({ showSelectionLauncher: !s.showSelectionLauncher })),
    checked: () => getState().showSelectionLauncher,
  },
  {
    id: 'selectionBorder',
    label: 'Show border of selected area',
    run: () => setState((s) => ({ showSelectionBorder: !s.showSelectionBorder })),
    checked: () => getState().showSelectionBorder,
  },
  // Colour & brush
  { id: 'swapColors', label: 'Switch main/sub color', keys: ['x'], run: () => actions.swapColors() },
  { id: 'transparentColor', label: 'Switch drawing color/transparent color', keys: ['c'], run: () => actions.toggleTransparentColor() },
  { id: 'brushSmaller', label: 'Decrease brush size', keys: ['['], run: () => actions.stepBrushSize(-1) },
  { id: 'brushBigger', label: 'Increase brush size', keys: [']'], run: () => actions.stepBrushSize(1) },
  { id: 'opacityDown', label: 'Decrease opacity', keys: ['Mod+['], run: () => actions.stepBrushValue('opacity', -0.1) },
  { id: 'opacityUp', label: 'Increase opacity', keys: ['Mod+]'], run: () => actions.stepBrushValue('opacity', 0.1) },
  { id: 'densityDown', label: 'Decrease brush density', keys: ['Mod+Shift+o'], run: () => actions.stepBrushValue('flow', -0.1) },
  { id: 'densityUp', label: 'Increase brush density', keys: ['Mod+Shift+p'], run: () => actions.stepBrushValue('flow', 0.1) },
  { id: 'referMultiple', label: 'Switch "Refer multiple"', keys: ['0'], run: () => actions.toggleReferMultiple() },
  { id: 'prevTool', label: 'Previous tool in the group', keys: [','], run: () => actions.cycleSubTool(-1) },
  { id: 'nextTool', label: 'Next tool in the group', keys: ['.'], run: () => actions.cycleSubTool(1) },
  // Filter
  { id: 'gaussianBlur', label: 'Blur: Gaussian blur…', run: () => openDialog('gaussianBlur'), enabled: canEdit },
  // Help
  { id: 'shortcuts', label: 'Keyboard shortcuts', keys: ['F1'], run: () => openDialog('shortcuts') },
  { id: 'about', label: 'About MAD Studio Paint', run: () => openDialog('about') },
];

const byId = new Map(COMMANDS.map((c) => [c.id, c]));
const byKey = new Map<string, Command>();
for (const c of COMMANDS) for (const k of c.keys ?? []) byKey.set(normalizeShortcut(k), c);

export const commandById = (id: string) => byId.get(id);
export const commandForShortcut = (s: string) => byKey.get(normalizeShortcut(s));

export function shortcutLabel(id: string): string | undefined {
  const k = byId.get(id)?.keys?.[0];
  return k ? formatShortcut(k, isMac) : undefined;
}

export function isEnabled(c: Command): boolean {
  return c.enabled ? c.enabled() : true;
}

export async function runCommand(id: string): Promise<void> {
  if (id.startsWith('tool:')) {
    actions.setTool(id.slice(5) as never);
    return;
  }
  const c = byId.get(id);
  if (!c || !isEnabled(c)) return;
  await c.run();
}
