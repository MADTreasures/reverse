/**
 * What the Quick Access buttons and its search show and run, like the reference's: menu commands
 * (with their menu path), other commands (Options), tools and sub tools, drawing colours and auto
 * actions – each with its name, icon and where it is found in Quick Access Settings.
 */
import { MENUS, type MenuItem as MenuEntry } from './menus';
import { COMMANDS, commandById, isEnabled, runCommand } from './commands';
import { TOOLS, type ToolId } from '../paint/tools';
import type { QuickFunction, QuickItem } from '../paint/quickAccess';
import * as actions from '../store/actions';
import { drawingColor, getState } from '../store/store';
import { allAutoActions, playAction, useAutoActions } from '../store/autoActionStore';
import { hexToRgb } from '../model/color';

/** Drag data: a function to add (tools, sub tools, auto actions, Quick Access Settings and search results). */
export const QUICK_ITEM_MIME = 'application/x-mad-quick-item';
/** Drag data: a Quick Access button being moved ({ set, index }). */
export const QUICK_BUTTON_MIME = 'application/x-mad-quick-button';
/** Drag data: a Quick Access set tab being moved (its id). */
export const QUICK_SET_MIME = 'application/x-mad-quick-set';

/** Icons of this program's own icon set for commands (others show their initials). */
const COMMAND_ICONS: Record<string, string> = {
  new: 'new',
  open: 'open',
  save: 'save',
  saveAs: 'save',
  undo: 'undo',
  redo: 'redo',
  clear: 'clear',
  clearOutside: 'clearOutside',
  cut: 'cutPaste',
  copy: 'copyPaste',
  paste: 'pasteMaterial',
  fill: 'fillCommand',
  transform: 'transform',
  transformScale: 'transform',
  transformRotate: 'rotateRight',
  freeTransform: 'freeTransform',
  transformDistort: 'freeTransform',
  transformSkew: 'freeTransform',
  transformPerspective: 'freeTransform',
  transformMesh: 'meshTransform',
  flipLayerH: 'flipH',
  flipLayerV: 'flipV',
  flipViewH: 'flipH',
  flipViewV: 'flipV',
  newRasterLayer: 'newLayer',
  newVectorLayer: 'newVector',
  newFolder: 'newFolder',
  groupLayer: 'folder',
  duplicateLayer: 'duplicate',
  deleteLayer: 'trash',
  mergeDown: 'mergeDown',
  clip: 'clip',
  reference: 'reference',
  draft: 'draft',
  lockLayer: 'lock',
  newTone: 'tone',
  newFrameFolder: 'frame',
  snapRuler: 'snapRuler',
  snapSpecial: 'snapSpecial',
  selectAll: 'select',
  deselect: 'deselect',
  invertSelection: 'invertSelection',
  expandSelection: 'expand',
  shrinkSelection: 'shrink',
  selectionBorder: 'border',
  quickMask: 'mask',
  maskSelection: 'mask',
  maskOutside: 'mask',
  zoomIn: 'zoomIn',
  zoomOut: 'zoomOut',
  actualPixels: 'actual',
  fit: 'fit',
  rotateLeft: 'rotateLeft',
  rotateRight: 'rotateRight',
  resetRotation: 'resetRotation',
  resetDisplay: 'resetRotation',
  brushBigger: 'zoomIn',
  brushSmaller: 'zoomOut',
  swapColors: 'swap',
  canvasSize: 'crop',
  playStop: 'play',
  newAnimationFolder: 'newAnimFolder',
  newAnimationCel: 'newCel',
  addKeyframe: 'keyAdd',
  deleteKeyframe: 'keyDelete',
  graphEditor: 'graph',
  newCameraFolder: 'camera',
  newTimeline: 'newTimeline',
  registerMaterial: 'material',
  'win-material': 'material',
  preferences: 'wrench',
  pressureSettings: 'pressure',
  quickAccessSettings: 'wrench',
  shortcutSettings: 'wrench',
  commandBarSettings: 'wrench',
  shortcuts: 'help',
};

/** A command's icon, or null (its initials are shown). */
export const commandIcon = (id: string): string | null => COMMAND_ICONS[id] ?? null;

/** A menu label without its "…". */
export const plainLabel = (label: string) => label.replace(/…$/, '');

/** Every menu command with its menu path, in menu order (as in Quick Access Settings > Menu commands). */
export function menuCommands(): { id: string; path: string[] }[] {
  const out: { id: string; path: string[] }[] = [];
  const seen = new Set<string>();
  const walk = (items: MenuEntry[], path: string[]) => {
    for (const i of items) {
      if (typeof i !== 'string') walk(i.items, [...path, i.label]);
      else if (i !== '-' && !seen.has(i) && commandById(i)) {
        seen.add(i);
        out.push({ id: i, path });
      }
    }
  };
  for (const m of MENUS) walk(m.items, [m.label]);
  return out;
}

/** Commands that are in no menu (Quick Access Settings > Options): shortcuts-only and palette commands. */
export function optionCommands(): string[] {
  const inMenus = new Set(menuCommands().map((c) => c.id));
  return COMMANDS.filter((c) => !inMenus.has(c.id)).map((c) => c.id);
}

/** The tools and their sub tools (Quick Access Settings > Tool). */
export function toolEntries(): { tool: ToolId; label: string; subs: { id: string; name: string; group?: string }[] }[] {
  const subs = getState().subTools;
  return TOOLS.map((t) => ({ tool: t.id, label: t.label, subs: subs.filter((s) => s.tool === t.id).map((s) => ({ id: s.id, name: s.name, group: s.group })) }));
}

/** Every function the Quick Access search finds, with where Quick Access Settings lists it. */
export function allFunctions(): QuickFunction[] {
  const commands = menuCommands().map(({ id, path }) => ({ item: { kind: 'command', id } as QuickItem, name: plainLabel(commandById(id)!.label), where: `Menu commands > ${path.join(' > ')}` }));
  const options = optionCommands().map((id) => ({ item: { kind: 'command', id } as QuickItem, name: plainLabel(commandById(id)!.label), where: 'Options' }));
  const tools = toolEntries().flatMap((t) => [
    { item: { kind: 'tool', tool: t.tool } as QuickItem, name: t.label, where: 'Tool' },
    ...t.subs.map((s) => ({ item: { kind: 'tool', tool: t.tool, sub: s.id } as QuickItem, name: s.name, where: `Tool > ${t.label}${s.group ? ` > ${s.group}` : ''}` })),
  ]);
  const autos = allAutoActions().map(({ set, action }) => ({ item: { kind: 'action', id: action.id } as QuickItem, name: action.name, where: `Auto Action > ${set.name}` }));
  return [...tools, ...commands, ...options, ...autos];
}

export interface ItemInfo {
  label: string;
  /** Icon name; null: initials. */
  icon: string | null;
  /** A drawing colour's swatch. */
  swatch?: string;
  enabled: boolean;
  /** The current tool, the drawing colour, a command that is on. */
  active: boolean;
  /** Its tool, sub tool, command or auto action no longer exists. */
  missing: boolean;
}

/** The default name of a drawing colour: its RGB values (as in the reference). */
export function colorName(hex: string): string {
  const c = hexToRgb(hex) ?? { r: 0, g: 0, b: 0 };
  return `R:${c.r} G:${c.g} B:${c.b}`;
}

/** What a button shows. */
export function itemInfo(item: QuickItem): ItemInfo {
  const s = getState();
  switch (item.kind) {
    case 'command': {
      const c = commandById(item.id);
      return { label: item.name ?? (c ? plainLabel(c.label) : item.id), icon: commandIcon(item.id), enabled: c ? isEnabled(c) : false, active: Boolean(c?.checked?.()), missing: !c };
    }
    case 'tool': {
      const info = TOOLS.find((t) => t.id === item.tool);
      const sub = item.sub ? s.subTools.find((t) => t.id === item.sub && t.tool === item.tool) : undefined;
      const missing = !info || (item.sub !== undefined && !sub);
      const active = s.tool === item.tool && (!item.sub || s.activeSub[item.tool as ToolId] === item.sub);
      return { label: item.name ?? sub?.name ?? info?.label ?? item.tool, icon: item.tool === 'object' ? 'operation' : item.tool, enabled: !missing && !s.transforming, active, missing };
    }
    case 'color':
      return { label: item.name ?? colorName(item.color), icon: null, swatch: item.color, enabled: true, active: !s.colors.transparent && drawingColor(s.colors) === item.color, missing: false };
    case 'action': {
      const a = allAutoActions().find((x) => x.action.id === item.id);
      const busy = useAutoActions.getState();
      return { label: item.name ?? a?.action.name ?? 'Auto action', icon: 'autoAction', enabled: Boolean(a) && !busy.recording && !busy.playing, active: false, missing: !a };
    }
    default:
      return { label: '', icon: null, enabled: false, active: false, missing: false };
  }
}

/** Runs a button: picks the tool / sub tool or drawing colour, runs the command, plays the auto action. */
export function runQuickItem(item: QuickItem): void {
  if (!itemInfo(item).enabled) return;
  switch (item.kind) {
    case 'command':
      void runCommand(item.id);
      return;
    case 'tool':
      if (item.sub) actions.setSubTool(item.tool as ToolId, item.sub);
      else actions.setTool(item.tool as ToolId);
      return;
    case 'color':
      actions.setDrawingColor(item.color);
      return;
    case 'action':
      void playAction(item.id, null);
      return;
  }
}

/** Initials for a button without an icon ("Gaussian blur" → "Gb"). */
export function initials(label: string): string {
  const words = label.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return '•';
  return words.length === 1 ? words[0].slice(0, 2) : `${words[0][0].toUpperCase()}${words[1][0]}`;
}
