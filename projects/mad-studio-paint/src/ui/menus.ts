/** Menu structure shared by the in-window menu bar (browser) and the native menu (Electron). */
export interface MenuSpec {
  label: string;
  /** Command ids, '-' for a separator, or a submenu. */
  items: MenuItem[];
}

export type MenuItem = string | MenuSpec;

/** Tonal corrections in the reference's menu order (see paint/tonal.ts). */
const TONAL = ['brightnessContrast', 'levels', 'toneCurve', 'hsl', 'colorBalance', 'reverse', 'posterize', 'binarize', 'gradientMap'];

export const MENUS: MenuSpec[] = [
  { label: 'File', items: ['new', 'open', '-', 'save', 'saveAs', '-', 'importImage', 'export', '-', 'renameCanvas', '-', 'pressureSettings', 'preferences'] },
  {
    label: 'Edit',
    items: [
      'undo',
      'redo',
      '-',
      'cut',
      'copy',
      'paste',
      'clear',
      'clearOutside',
      '-',
      'fill',
      { label: 'Tonal correction', items: TONAL.map((t) => `tonal-${t}`) },
      '-',
      'transform',
      'freeTransform',
      'flipLayerH',
      'flipLayerV',
      '-',
      'imageResolution',
      'canvasSize',
    ],
  },
  {
    label: 'Layer',
    items: [
      'newRasterLayer',
      'newVectorLayer',
      'newFolder',
      'newFrameFolder',
      'newTone',
      { label: 'New correction layer', items: TONAL.map((t) => `correction-${t}`) },
      'correctionSettings',
      'groupLayer',
      'ungroupLayer',
      '-',
      'duplicateLayer',
      'deleteLayer',
      'rasterize',
      '-',
      { label: 'Layer mask', items: ['maskOutside', 'maskSelection', '-', 'applyMask', 'deleteMask', '-', 'enableMask', 'linkMask', 'showMaskArea'] },
      { label: 'Ruler/Frame', items: ['perspective1', 'perspective2', 'perspective3', '-', 'showRuler', 'deleteRulers', '-', 'divideFrame'] },
      '-',
      'clip',
      'reference',
      'draft',
      'lockLayer',
      'lockAlpha',
      '-',
      'mergeDown',
      'mergeVisible',
      'flatten',
      '-',
      'selectLayerAbove',
      'selectLayerBelow',
      'layerUp',
      'layerDown',
    ],
  },
  {
    label: 'Select',
    items: ['selectAll', 'deselect', 'reselect', 'invertSelection', '-', 'expandSelection', 'shrinkSelection', '-', 'selectOverlappingVectors', 'selectVectorsWithin'],
  },
  {
    label: 'View',
    items: [
      'zoomIn',
      'zoomOut',
      'actualPixels',
      'fit',
      'resetDisplay',
      '-',
      'rotateLeft',
      'rotateRight',
      'rotate90',
      'rotate180',
      'rotate270',
      'resetRotation',
      'flipViewH',
      'flipViewV',
      '-',
      { label: 'Snap', items: ['snapRuler', 'snapSpecial'] },
      '-',
      'selectionLauncher',
      'selectionBorder',
    ],
  },
  { label: 'Filter', items: ['gaussianBlur'] },
  { label: 'Window', items: ['workspaceDefault', 'workspaceClassic', '-', 'togglePalettes', 'toggleMenuBar'] },
  { label: 'Help', items: ['shortcuts', 'about'] },
];

/** Every command id in a menu tree, depth first. */
export function menuCommandIds(items: MenuItem[] = MENUS.flatMap((m) => m.items)): string[] {
  return items.flatMap((i) => (typeof i === 'string' ? (i === '-' ? [] : [i]) : menuCommandIds(i.items)));
}
