/** Every menu command, its shortcut and handler. Menus (browser and native) and the keyboard use this table. */
import { flatten } from '../model/layers';
import { isMac } from '../platform/platform';
import { exportExposureSheet, importImages, openDocument, saveDocument, saveDuplicate } from '../io/documentIO';
import * as actions from '../store/actions';
import { activeFrameFolder } from '../store/frameActions';
import * as anim from '../store/animationActions';
import * as light from '../store/lightTableActions';
import * as sound from '../store/soundActions';
import { copy, cut, hasClip, pasteImage } from '../store/clipboard';
import { drawingColor, getState, setState } from '../store/store';
import { cancelTransform, confirmTransform, flipTransform, isTransforming, startTransform } from '../tools/transform';
import { CORRECTIONS, correctionLabel, defaultCorrection, type CorrectionType } from '../paint/tonal';
import { FILTERS } from '../paint/filters';
import { applyFilterNow } from '../store/filterActions';
import { openDialog, openFilterDialog, openTonalDialog, promptDialog } from './overlays';
import { openAssignMenu } from './palettes/TimelinePalette';
import { openImageExport, openPsdDuplicate } from './dialogs/ExportDialog';
import { openColorSettings } from './dialogs/ColorSettingsDialog';
import { IMAGE_FORMAT_ORDER, IMAGE_FORMATS } from '../io/imageExport';
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
/** Text layers cannot be drawn on, but can be moved, flipped and transformed. */
const canTransform = () => actions.transformBlocker() === null;
const notTransforming = () => !isTransforming();
/** Edit > Transform starts a transform, or switches the mode of the one in progress. */
const canStartTransform = () => isTransforming() || canTransform();
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

const hasTimeline = () => Boolean(getState().doc.timeline?.enabled);

/** File > Import > Audio: picks a sound file. */
function pickAudioFile(): Promise<void> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*,.wav,.mp3,.ogg,.m4a,.aac,.flac,.opus';
    input.onchange = () => {
      const f = input.files?.[0];
      if (f) void sound.importAudio(f, f.name).then(() => resolve());
      else resolve();
    };
    input.click();
  });
}

/** File > Import > Movie: picks a movie file. */
function pickMovieFile(): Promise<void> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*,.mp4,.mov,.m4v,.webm';
    input.onchange = () => {
      const f = input.files?.[0];
      if (f) void sound.importMovie(f, f.name).then(() => resolve());
      else resolve();
    };
    input.click();
  });
}

/** Animation > Light table > Select and register file: picks an image file. */
function pickLightFile(): Promise<void> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const f = input.files?.[0];
      if (f) void light.registerFile(f, f.name).then(resolve);
      else resolve();
    };
    input.click();
  });
}

export const COMMANDS: Command[] = [
  // File
  { id: 'new', label: 'New…', keys: ['Mod+n'], run: () => openDialog('newCanvas') },
  { id: 'open', label: 'Open…', keys: ['Mod+o'], run: () => openDocument() },
  { id: 'save', label: 'Save', keys: ['Mod+s'], run: () => void saveDocument(false) },
  { id: 'saveAs', label: 'Save as…', keys: ['Mod+Shift+s', 'Mod+Alt+s'], run: () => void saveDocument(true) },
  { id: 'saveDuplicate', label: '.madpaint (MAD Studio Paint)…', run: () => void saveDuplicate() },
  { id: 'saveDuplicatePsd', label: '.psd (Photoshop Document)…', run: () => openPsdDuplicate(false) },
  { id: 'saveDuplicatePsb', label: '.psb (Photoshop Big Document)…', run: () => openPsdDuplicate(true) },
  { id: 'importImage', label: 'Import image as layer…', run: () => importImages() },
  ...IMAGE_FORMAT_ORDER.map((f): Command => ({ id: `export-${f}`, label: `${IMAGE_FORMATS[f].menu}…`, run: () => openImageExport(f) })),
  { id: 'preferences', label: 'Preferences…', keys: ['Mod+k'], run: () => openDialog('preferences') },
  { id: 'pressureSettings', label: 'Pen pressure settings…', run: () => openDialog('pressure') },
  { id: 'renameCanvas', label: 'Canvas name…', run: () => renameCanvas() },
  // Edit
  { id: 'undo', label: 'Undo', keys: ['Mod+z'], run: () => actions.undo(), enabled: () => getState().canUndo && notTransforming() },
  { id: 'redo', label: 'Redo', keys: ['Mod+y', 'Mod+Shift+z'], run: () => actions.redo(), enabled: () => getState().canRedo && notTransforming() },
  { id: 'cut', label: 'Cut', keys: ['Mod+x', 'F2'], run: () => void cut(), enabled: canEdit },
  { id: 'copy', label: 'Copy', keys: ['Mod+c', 'F3'], run: () => void copy(), enabled: () => actions.editTarget() !== null },
  { id: 'paste', label: 'Paste', keys: ['Mod+v', 'F4', 'Mod+Shift+v'], run: () => void pasteImage(), enabled: () => hasClip() },
  {
    id: 'clear',
    label: 'Delete',
    keys: ['backspace', 'delete', 'Mod+backspace'],
    // With the Object tool, Delete removes the selected vector lines or ruler.
    run: () => {
      const { tool, selectedRuler } = getState();
      if (tool === 'object' && actions.selectedVectorLines()) actions.deleteSelectedObjects();
      else if (tool === 'object' && selectedRuler) actions.deleteRuler(selectedRuler.layerId, selectedRuler.rulerId);
      else actions.clearLayer();
    },
    enabled: () => canEdit() || actions.activeLayer()?.kind === 'text' || (getState().tool === 'object' && getState().selectedRuler !== null),
  },
  { id: 'clearOutside', label: 'Delete outside selected area', keys: ['Shift+backspace', 'Shift+delete'], run: () => actions.clearOutsideSelection(), enabled: () => canEdit() && hasSelection() },
  { id: 'fill', label: 'Fill', keys: ['Alt+backspace', 'Alt+delete'], run: () => actions.fillWithColor(), enabled: canEdit },
  { id: 'transform', label: 'Scale up/Scale down/Rotate', keys: ['Mod+t'], run: () => void startTransform('scaleRotate'), enabled: canStartTransform },
  { id: 'transformScale', label: 'Scale up/Scale down', run: () => void startTransform('scale'), enabled: canStartTransform },
  { id: 'transformRotate', label: 'Rotate', run: () => void startTransform('rotate'), enabled: canStartTransform },
  { id: 'freeTransform', label: 'Free transform', keys: ['Mod+Shift+t'], run: () => void startTransform('free'), enabled: canStartTransform },
  { id: 'transformDistort', label: 'Distort', run: () => void startTransform('distort'), enabled: canStartTransform },
  { id: 'transformSkew', label: 'Skew', run: () => void startTransform('skew'), enabled: canStartTransform },
  { id: 'transformPerspective', label: 'Perspective', run: () => void startTransform('perspective'), enabled: canStartTransform },
  { id: 'transformMesh', label: 'Mesh transformation', run: () => void startTransform('mesh'), enabled: canStartTransform },
  { id: 'confirmTransform', label: 'Confirm transform', keys: ['enter'], run: () => confirmTransform(), enabled: () => isTransforming() },
  { id: 'cancelTransform', label: 'Cancel transform', keys: ['escape'], run: () => cancelTransform(), enabled: () => isTransforming() },
  { id: 'canvasSize', label: 'Change canvas size…', run: () => openDialog('canvasSize'), enabled: notTransforming },
  { id: 'imageResolution', label: 'Change image resolution…', run: () => openDialog('imageResolution'), enabled: notTransforming },
  // While transforming they flip the box at its reference point.
  { id: 'flipLayerH', label: 'Flip horizontal', run: () => (isTransforming() ? flipTransform(true) : actions.flipLayer(true)), enabled: canStartTransform },
  { id: 'flipLayerV', label: 'Flip vertical', run: () => (isTransforming() ? flipTransform(false) : actions.flipLayer(false)), enabled: canStartTransform },
  // Layer
  { id: 'newRasterLayer', label: 'New raster layer', keys: ['Mod+Shift+n'], run: () => void actions.addRasterLayer() },
  { id: 'newVectorLayer', label: 'New vector layer', run: () => void actions.addVectorLayer() },
  { id: 'newFolder', label: 'New layer folder', run: () => void actions.addFolder() },
  { id: 'newFrameFolder', label: 'New frame border folder…', run: () => openDialog('newFrameFolder') },
  { id: 'newTone', label: 'Tone…', run: () => openDialog('newTone') },
  { id: 'newFillLayer', label: 'Fill…', run: () => openColorSettings(drawingColor(getState().colors), (c) => void actions.addFillLayer(c)) },
  {
    id: 'newGradientLayer',
    label: 'Gradient…',
    run: () => {
      actions.newGradientLayer();
      openDialog('gradient');
    },
  },
  {
    id: 'divideFrame',
    label: 'Divide frame border equally…',
    run: () => openDialog('divideFrame'),
    enabled: () => activeFrameFolder() !== null,
  },
  { id: 'frameTemplates', label: 'Frame templates…', run: () => openDialog('frameTemplates') },
  {
    id: 'rasterize',
    label: 'Rasterize',
    run: () => actions.rasterizeLayer(),
    enabled: () => actions.isRenderedLayer(actions.activeLayer()) && !actions.activeLayer()?.locked,
  },
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
  // View > Snap, Layer > Ruler/Frame
  { id: 'snapRuler', label: 'Snap to ruler', keys: ['Mod+1'], run: () => actions.toggleSnap('ruler'), checked: () => getState().snapRuler },
  { id: 'snapSpecial', label: 'Snap to special ruler', keys: ['Mod+2'], run: () => actions.toggleSnap('special'), checked: () => getState().snapSpecial },
  { id: 'perspective1', label: 'Create perspective ruler: 1-point', run: () => actions.createPerspectiveRuler(1), enabled: hasLayer },
  { id: 'perspective2', label: 'Create perspective ruler: 2-point', run: () => actions.createPerspectiveRuler(2), enabled: hasLayer },
  { id: 'perspective3', label: 'Create perspective ruler: 3-point', run: () => actions.createPerspectiveRuler(3), enabled: hasLayer },
  {
    id: 'showRuler',
    label: 'Show ruler',
    run: () => actions.toggleRulersVisible(),
    enabled: () => Boolean(actions.activeLayer()?.rulers),
    checked: () => Boolean(actions.activeLayer()?.rulers?.visible),
  },
  { id: 'deleteRulers', label: 'Delete ruler', run: () => actions.deleteLayerRulers(), enabled: () => Boolean(actions.activeLayer()?.rulers) },
  { id: 'drawAlongRuler', label: 'Draw along ruler…', run: () => openDialog('drawAlongRuler'), enabled: () => actions.rulerToDrawAlong() !== null },
  { id: 'rulerFromVector', label: 'Ruler from vector', run: () => actions.rulerFromVector(), enabled: () => actions.selectedVectorLines() !== null },
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
  {
    id: 'selectOverlappingVectors',
    label: 'Select overlapping vectors',
    run: () => actions.selectVectorsInSelection(false),
    enabled: () => hasSelection() && actions.activeLayer()?.kind === 'vector',
  },
  {
    id: 'selectVectorsWithin',
    label: 'Select vectors within area',
    run: () => actions.selectVectorsInSelection(true),
    enabled: () => hasSelection() && actions.activeLayer()?.kind === 'vector',
  },
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
  // Animation
  { id: 'newAnimationFolder', label: 'Animation folder', run: () => void anim.newAnimationFolder() },
  { id: 'newAnimationCel', label: 'New animation cel', run: () => void anim.newAnimationCel() },
  { id: 'assignCel', label: 'Assign cel to frame…', run: () => openAssignMenu(), enabled: () => anim.activeTrack() !== null && hasTimeline() },
  { id: 'assignMultiple', label: 'Assign multiple cels…', run: () => openDialog('assignMultiple'), enabled: () => anim.activeTrack() !== null && hasTimeline() },
  { id: 'removeAssignedCel', label: 'Delete assigned cel', run: () => anim.removeAssignedCel(), enabled: () => anim.activeTrack() !== null },
  { id: 'setFirstDisplayed', label: 'Set as first displayed frame', run: () => anim.setFirstDisplayedFrame(), enabled: hasTimeline },
  { id: 'setLastDisplayed', label: 'Set as last displayed frame', run: () => anim.setLastDisplayedFrame(), enabled: hasTimeline },
  { id: 'splitClip', label: 'Split clip', run: () => anim.splitClipAtFrame(), enabled: hasTimeline },
  { id: 'mergeClips', label: 'Merge clips', run: () => anim.mergeSelectedClips(), enabled: hasTimeline },
  { id: 'deleteClip', label: 'Delete clip', run: () => anim.deleteSelectedClips(), enabled: hasTimeline },
  { id: 'copyClip', label: 'Copy clip', run: () => anim.copySelectedClip(), enabled: hasTimeline },
  { id: 'pasteClip', label: 'Paste clip', run: () => anim.pasteCopiedClip(), enabled: () => hasTimeline() && anim.hasCopiedClip() },
  // Edit track > Cut / Copy / Paste / Delete: the selected keyframes, assigned cels or clips.
  { id: 'trackCut', label: 'Cut', run: () => anim.timelineCut(), enabled: hasTimeline },
  { id: 'trackCopy', label: 'Copy', run: () => anim.timelineCopy(), enabled: hasTimeline },
  { id: 'trackPaste', label: 'Paste', run: () => anim.timelinePaste(), enabled: () => hasTimeline() && anim.hasTimelineCopy() },
  { id: 'trackDelete', label: 'Delete', run: () => anim.timelineDelete(), enabled: hasTimeline },
  { id: 'enableKeyframes', label: 'Enable keyframes on this layer', run: () => anim.toggleKeyframes(), enabled: hasTimeline, checked: () => Boolean(anim.currentTrack()?.keys?.enabled) },
  { id: 'addKeyframe', label: 'Add keyframe', run: () => anim.addKeyframe(), enabled: hasTimeline },
  { id: 'deleteKeyframe', label: 'Delete keyframe', run: () => anim.deleteKeyframes(), enabled: hasTimeline },
  { id: 'deleteAllKeyframes', label: 'Delete all keyframes', run: () => anim.deleteAllKeyframes(), enabled: hasTimeline },
  { id: 'keyHold', label: 'Switch keyframe to hold interpolation', run: () => anim.setKeyInterp('hold'), enabled: hasTimeline },
  { id: 'keyLinear', label: 'Switch keyframe to linear interpolation', run: () => anim.setKeyInterp('linear'), enabled: hasTimeline },
  { id: 'keySmooth', label: 'Switch keyframe to smooth interpolation', run: () => anim.setKeyInterp('smooth'), enabled: hasTimeline },
  { id: 'editKeyed', label: 'Edit layers with active keyframes', run: () => anim.toggleEditKeyed(), enabled: hasTimeline, checked: () => getState().editKeyed },
  { id: 'frameLines', label: 'Crop marks/Inner border', run: () => setState((s) => ({ showFrameLines: !s.showFrameLines })), enabled: () => Boolean(getState().doc.outputFrame), checked: () => getState().showFrameLines },
  { id: 'graphEditor', label: 'Graph Editor', run: () => anim.toggleGraphEditor(), enabled: () => Boolean(getState().doc.timeline), checked: () => getState().graphEditor },
  { id: 'unpairHandles', label: 'Unpair handles', run: () => anim.toggleUnpairHandles(), enabled: () => getState().graphEditor && getState().graphSelection.length > 0 },
  { id: 'newCameraFolder', label: '2D camera folder…', run: () => openDialog('cameraFolder') },
  { id: 'cameraView', label: "Show camera's field of view", run: () => anim.toggleCameraView(), enabled: hasTimeline, checked: () => getState().cameraView },
  { id: 'enableLightTable', label: 'Enable light table', run: () => light.toggleLightTable(), checked: () => getState().lightOn },
  { id: 'registerLayer', label: 'Register selected layer', run: () => light.registerSelectedLayer() },
  { id: 'registerFile', label: 'Select and register file…', run: () => void pickLightFile() },
  { id: 'registerOnion', label: 'Register onion skin images', run: () => light.registerOnionSkins(), enabled: hasTimeline },
  { id: 'deregisterLight', label: 'Deregister selected image from light table', run: () => light.deregisterSelected(), enabled: () => getState().lightSelection !== null },
  { id: 'deregisterAllLight', label: 'Deregister all images from light table', run: () => light.deregisterAll() },
  { id: 'centerCanvas', label: 'Move canvas to center…', run: () => openDialog('centerCanvas'), enabled: () => light.centerPair() !== null },
  { id: 'lockCel', label: 'Lock current animation cel as editing target', run: () => light.toggleCelLock(), checked: () => getState().lockedCel !== null },
  { id: 'animationCels', label: 'Animation cels', run: () => light.showCelsPalette(), checked: () => getState().layerDockTab === 'cels' },
  { id: 'selectPrevCel', label: 'Select previous cel', run: () => anim.selectNeighbourCel(-1), enabled: () => anim.activeTrack() !== null },
  { id: 'selectNextCel', label: 'Select next cel', run: () => anim.selectNeighbourCel(1), enabled: () => anim.activeTrack() !== null },
  { id: 'newTimeline', label: 'New timeline…', run: () => openDialog('newTimeline') },
  { id: 'timelineSettings', label: 'Change settings…', run: () => openDialog('timelineSettings'), enabled: () => Boolean(getState().doc.timeline) },
  { id: 'frameRate', label: 'Change frame rate…', run: () => openDialog('frameRate'), enabled: () => Boolean(getState().doc.timeline) },
  { id: 'manageTimelines', label: 'Manage timeline…', run: () => openDialog('manageTimelines'), enabled: () => Boolean(getState().doc.timeline) },
  { id: 'enableTimeline', label: 'Enable timeline', run: () => anim.toggleTimeline(), checked: () => Boolean(getState().doc.timeline?.enabled), enabled: () => Boolean(getState().doc.timeline) },
  { id: 'insertFrame', label: 'Insert frame', run: () => anim.insertFrame(), enabled: hasTimeline },
  { id: 'deleteFrame', label: 'Delete frame', run: () => anim.deleteFrame(), enabled: () => (getState().doc.timeline?.frames ?? 0) > 1 },
  { id: 'firstFrame', label: 'Go to start', run: () => anim.firstFrame(), enabled: hasTimeline },
  { id: 'prevFrame', label: 'Go to previous frame', run: () => anim.previousFrame(), enabled: hasTimeline },
  { id: 'nextFrame', label: 'Go to next frame', run: () => anim.nextFrame(), enabled: hasTimeline },
  { id: 'lastFrame', label: 'Go to end', run: () => anim.lastFrame(), enabled: hasTimeline },
  { id: 'playStop', label: 'Play/Stop', run: () => anim.togglePlay(), enabled: hasTimeline, checked: () => getState().playing },
  { id: 'loopPlay', label: 'Loop play', run: () => anim.toggleLoop(), checked: () => getState().loop },
  { id: 'onionSkin', label: 'Enable onion skin', run: () => anim.toggleOnionSkin(), checked: () => getState().onionSkin, enabled: hasTimeline },
  { id: 'onionSkinSettings', label: 'Onion skin settings…', run: () => openDialog('onionSkin') },
  { id: 'exportSequence', label: 'Image sequence…', run: () => openDialog('exportSequence'), enabled: hasTimeline },
  { id: 'exportGif', label: 'Animated GIF…', run: () => openDialog('exportGif'), enabled: hasTimeline },
  { id: 'exportApng', label: 'Animated sticker (APNG)…', run: () => openDialog('exportApng'), enabled: hasTimeline },
  { id: 'exportWebp', label: 'Animated WebP…', run: () => openDialog('exportWebp'), enabled: hasTimeline },
  { id: 'exportCels', label: 'Export animation cels…', run: () => openDialog('exportCels'), enabled: () => flatten(getState().doc.layers).some((l) => l.kind === 'folder' && Boolean(l.animation)) },
  { id: 'exportSheet', label: 'Exposure sheet…', run: () => void exportExposureSheet(), enabled: hasTimeline },
  { id: 'exportAudio', label: 'Audio…', run: () => openDialog('exportAudio'), enabled: hasTimeline },
  { id: 'exportMovie', label: 'Movie…', run: () => openDialog('exportMovie'), enabled: hasTimeline },
  { id: 'importAudio', label: 'Audio…', run: () => void pickAudioFile(), enabled: hasTimeline },
  { id: 'importMovie', label: 'Movie…', run: () => void pickMovieFile(), enabled: hasTimeline },
  { id: 'newAudioTrack', label: 'Audio', run: () => void sound.newAudioTrack(), enabled: () => Boolean(getState().doc.timeline) },
  { id: 'deleteAudioTrack', label: 'Delete audio layer', run: () => sound.deleteSoundTrack(), enabled: () => sound.activeSoundTrack() !== null },
  { id: 'toggleTimeline', label: 'Timeline', run: () => anim.toggleTimelinePalette(), checked: () => getState().timelineShown },
  // Filter
  ...FILTERS.map((f) => ({
    id: `filter-${f.id}`,
    label: f.params.length ? `${f.label}…` : f.label,
    run: () => (f.params.length ? openFilterDialog(f.id) : applyFilterNow(f.id)),
    enabled: canEdit,
  })),
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
