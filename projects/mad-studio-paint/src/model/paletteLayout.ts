/**
 * Where the palettes are, like the reference's palette docks: dock columns on the left and right
 * of the canvas, each a column of palette stacks (palettes stacked as tabs), and floating palettes.
 * Palettes are moved between stacks, above or below others, into new dock columns or out as
 * floating palettes; heights and widths change, docks can be hidden. Pure, unit tested.
 */
import type { WorkspaceId } from '../paint/tools';
import { isPaletteId, type PaletteId } from './palettes';

export type DockSide = 'left' | 'right';

export interface DockStack {
  id: string;
  tabs: PaletteId[];
  /** Fixed height (px); none: as high as its content. */
  height?: number;
  /** Takes the height left in its column (one stack per column). */
  grow?: boolean;
}

export interface DockColumn {
  id: string;
  side: DockSide;
  width: number;
  stacks: DockStack[];
  /** Hidden with its double arrow (only the arrow shows). */
  hidden?: boolean;
}

export interface FloatingPalette {
  id: PaletteId;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Only the title bar shows. */
  minimized?: boolean;
}

export interface PaletteLayout {
  /** Left columns from the window edge in, right columns from the canvas out. */
  columns: DockColumn[];
  floating: FloatingPalette[];
  /** Window > Palette dock: Lock palette height, Fix the width of palette dock, Lock palette position. */
  lockHeight: boolean;
  fixWidth: boolean;
  lockPosition: boolean;
}

/** Where a palette can be put. */
export type DropTarget =
  /** Stacked with the palettes of a stack, before tab `index`. */
  | { kind: 'tab'; stack: string; index: number }
  /** A stack of its own in a column, before stack `index`. */
  | { kind: 'stack'; column: string; index: number }
  /** A new dock column next to `column` (before or after it). */
  | { kind: 'column'; column: string; after: boolean }
  /** A floating palette. */
  | { kind: 'float'; x: number; y: number; w: number; h: number };

export const MIN_STACK_HEIGHT = 48;
export const COLUMN_WIDTH = { min: 180, max: 520 };

const RIGHT: DockColumn = {
  id: 'right',
  side: 'right',
  width: 262,
  stacks: [
    { id: 'navigator', tabs: ['navigator', 'subView'] },
    { id: 'layerProperty', tabs: ['layerProperty', 'autoAction'] },
    { id: 'layer', tabs: ['layer', 'searchLayer', 'history', 'animationCels'], grow: true },
  ],
};

/** The palette docks of each workspace (as the reference lays them out). */
export function defaultLayout(ws: WorkspaceId): PaletteLayout {
  const left: DockColumn =
    ws === 'classic'
      ? {
          id: 'left',
          side: 'left',
          width: 250,
          stacks: [
            { id: 'subtool', tabs: ['subTool'] },
            { id: 'property', tabs: ['toolProperty'], grow: true },
            { id: 'brushsize', tabs: ['brushSize'] },
            { id: 'classicColor', tabs: ['colorWheel', 'colorSlider', 'colorSet', 'colorHistory', 'intermediateColor', 'approximateColor', 'quickAccess'] },
          ],
        }
      : {
          id: 'left',
          side: 'left',
          width: 250,
          stacks: [
            { id: 'subtool', tabs: ['subTool', 'toolProperty'], grow: true },
            { id: 'color', tabs: ['colorWheel', 'colorSlider'] },
            { id: 'colorSet', tabs: ['colorSet', 'colorHistory', 'intermediateColor', 'approximateColor', 'quickAccess'] },
          ],
        };
  return structuredClone({ columns: [left, RIGHT], floating: [], lockHeight: false, fixWidth: false, lockPosition: false });
}

/** Where a palette is: its column, stack and tab index, or its floating window. */
export function locate(layout: PaletteLayout, id: PaletteId): { column: DockColumn; stack: DockStack; index: number } | { floating: FloatingPalette } | null {
  for (const column of layout.columns)
    for (const stack of column.stacks) {
      const index = stack.tabs.indexOf(id);
      if (index >= 0) return { column, stack, index };
    }
  const floating = layout.floating.find((f) => f.id === id);
  return floating ? { floating } : null;
}

export const hasPalette = (layout: PaletteLayout, id: PaletteId) => locate(layout, id) !== null;

/** One growing stack per column: the marked one, else the last without a fixed height, else the last. */
function normalize(layout: PaletteLayout): PaletteLayout {
  const columns = layout.columns
    .map((c) => ({ ...c, stacks: c.stacks.filter((s) => s.tabs.length > 0) }))
    .filter((c) => c.stacks.length > 0)
    .map((c) => {
      let g = c.stacks.findIndex((s) => s.grow);
      if (g < 0) {
        const free = c.stacks.map((s, i) => (s.height === undefined ? i : -1)).filter((i) => i >= 0);
        g = free.length ? free[free.length - 1] : c.stacks.length - 1;
      }
      return { ...c, stacks: c.stacks.map((s, i) => ({ ...s, grow: i === g ? true : undefined })) };
    });
  return { ...layout, columns };
}

/** Takes a palette out of the layout (its stack or floating window goes when empty). */
export function removePalette(layout: PaletteLayout, id: PaletteId): PaletteLayout {
  return normalize({
    ...layout,
    columns: layout.columns.map((c) => ({ ...c, stacks: c.stacks.map((s) => ({ ...s, tabs: s.tabs.filter((t) => t !== id) })) })),
    floating: layout.floating.filter((f) => f.id !== id),
  });
}

let counter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(counter++).toString(36)}`;

/**
 * Moves a palette to a drop target. Dropped on its own stack it changes its place among the tabs;
 * a palette alone in its stack dropped next to itself stays.
 */
export function movePalette(layout: PaletteLayout, id: PaletteId, target: DropTarget): PaletteLayout {
  const from = locate(layout, id);
  if (target.kind === 'tab') {
    const stack = layout.columns.flatMap((c) => c.stacks).find((s) => s.id === target.stack);
    if (!stack) return layout;
    let index = target.index;
    if (from && 'stack' in from && from.stack.id === stack.id && from.index < index) index--;
    const out = removePalette(layout, id);
    return normalize({
      ...out,
      columns: out.columns.map((c) => ({
        ...c,
        stacks: c.stacks.map((s) => {
          if (s.id !== stack.id) return s;
          const tabs = [...s.tabs];
          tabs.splice(Math.max(0, Math.min(tabs.length, index)), 0, id);
          return { ...s, tabs };
        }),
      })),
      // The stack may have gone with the palette (it was alone in it): put it back.
      ...(out.columns.some((c) => c.stacks.some((s) => s.id === stack.id)) ? {} : { columns: layout.columns }),
    });
  }
  if (target.kind === 'stack') {
    const column = layout.columns.find((c) => c.id === target.column);
    if (!column) return layout;
    // Alone in its stack, dropped just above or below itself: nothing changes.
    if (from && 'stack' in from && from.stack.tabs.length === 1 && from.column.id === column.id) {
      const at = column.stacks.indexOf(from.stack);
      if (target.index === at || target.index === at + 1) return layout;
    }
    const before = column.stacks[target.index]?.id;
    const out = removePalette(layout, id);
    const stack: DockStack = { id: newId('stack'), tabs: [id], ...(from && 'floating' in from ? { height: Math.max(MIN_STACK_HEIGHT, from.floating.h) } : {}) };
    return normalize({
      ...out,
      columns: out.columns.map((c) => {
        if (c.id !== column.id) return c;
        const stacks = [...c.stacks];
        const i = before ? stacks.findIndex((s) => s.id === before) : -1;
        stacks.splice(i < 0 ? stacks.length : i, 0, stack);
        return { ...c, stacks };
      }),
      // The column may have gone with the palette: make it again.
      ...(out.columns.some((c) => c.id === column.id) ? {} : { columns: [...out.columns.filter((c) => c.id !== column.id), { ...column, stacks: [stack] }] }),
    });
  }
  if (target.kind === 'column') {
    const next = layout.columns.find((c) => c.id === target.column);
    if (!next) return layout;
    const out = removePalette(layout, id);
    const column: DockColumn = { id: newId('dock'), side: next.side, width: next.width, stacks: [{ id: newId('stack'), tabs: [id], grow: true }] };
    const columns = [...out.columns];
    const i = columns.findIndex((c) => c.id === next.id);
    columns.splice(i < 0 ? columns.length : target.after ? i + 1 : i, 0, column);
    return normalize({ ...out, columns });
  }
  const out = removePalette(layout, id);
  return { ...out, floating: [...out.floating, { id, x: Math.round(target.x), y: Math.round(target.y), w: Math.max(160, Math.round(target.w)), h: Math.max(80, Math.round(target.h)) }] };
}

/** Puts a palette that is in no dock back where the workspace has it by default (or floating). */
export function ensurePalette(layout: PaletteLayout, id: PaletteId, ws: WorkspaceId, float = { x: 320, y: 140 }): PaletteLayout {
  if (hasPalette(layout, id)) return layout;
  const def = defaultLayout(ws);
  const home = locate(def, id);
  if (home && 'stack' in home) {
    const stack = layout.columns.flatMap((c) => c.stacks).find((s) => s.id === home.stack.id);
    if (stack) return movePalette(layout, id, { kind: 'tab', stack: stack.id, index: stack.tabs.length });
  }
  return movePalette(layout, id, { kind: 'float', x: float.x, y: float.y, w: 250, h: 300 });
}

/** The height of a stack (Lock palette height keeps them). */
export const setStackHeight = (layout: PaletteLayout, stackId: string, height: number): PaletteLayout =>
  layout.lockHeight
    ? layout
    : { ...layout, columns: layout.columns.map((c) => ({ ...c, stacks: c.stacks.map((s) => (s.id === stackId ? { ...s, height: Math.max(MIN_STACK_HEIGHT, Math.round(height)) } : s)) })) };

/** The width of a dock column (Fix the width of palette dock keeps them). */
export const setColumnWidth = (layout: PaletteLayout, columnId: string, width: number): PaletteLayout =>
  layout.fixWidth ? layout : { ...layout, columns: layout.columns.map((c) => (c.id === columnId ? { ...c, width: Math.max(COLUMN_WIDTH.min, Math.min(COLUMN_WIDTH.max, Math.round(width))) } : c)) };

export const toggleColumnHidden = (layout: PaletteLayout, columnId: string): PaletteLayout => ({ ...layout, columns: layout.columns.map((c) => (c.id === columnId ? { ...c, hidden: !c.hidden } : c)) });

/** Moves, resizes or minimises a floating palette. */
export const updateFloating = (layout: PaletteLayout, id: PaletteId, patch: Partial<Omit<FloatingPalette, 'id'>>): PaletteLayout => ({
  ...layout,
  floating: layout.floating.map((f) => (f.id === id ? { ...f, ...patch } : f)),
});

/** A floating palette brought in front of the others. */
export const raiseFloating = (layout: PaletteLayout, id: PaletteId): PaletteLayout => {
  const f = layout.floating.find((x) => x.id === id);
  return f && layout.floating[layout.floating.length - 1] !== f ? { ...layout, floating: [...layout.floating.filter((x) => x !== f), f] } : layout;
};

const num = (v: unknown, min: number, max: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : fallback);
const word = (v: unknown, fallback: string) => (typeof v === 'string' && /^[\w-]{1,60}$/.test(v) ? v : fallback);

/**
 * A layout from storage, every value checked; palettes missing from it (newer than the saved
 * layout) go where the workspace has them by default.
 */
export function sanitizeLayout(raw: unknown, ws: WorkspaceId): PaletteLayout {
  const def = defaultLayout(ws);
  if (!raw || typeof raw !== 'object') return def;
  const r = raw as Record<string, unknown>;
  const seen = new Set<PaletteId>();
  const ids = new Set<string>();
  const unique = (v: unknown, prefix: string) => {
    let id = word(v, newId(prefix));
    if (ids.has(id)) id = newId(prefix);
    ids.add(id);
    return id;
  };
  const tabsOf = (v: unknown): PaletteId[] => {
    const tabs: PaletteId[] = [];
    for (const t of Array.isArray(v) ? v : [])
      if (isPaletteId(t) && !seen.has(t)) {
        seen.add(t);
        tabs.push(t);
      }
    return tabs;
  };
  const columns: DockColumn[] = (Array.isArray(r.columns) ? r.columns : []).slice(0, 8).flatMap((c): DockColumn[] => {
    if (!c || typeof c !== 'object') return [];
    const cr = c as Record<string, unknown>;
    const stacks = (Array.isArray(cr.stacks) ? cr.stacks : []).slice(0, 20).flatMap((s): DockStack[] => {
      if (!s || typeof s !== 'object') return [];
      const sr = s as Record<string, unknown>;
      const tabs = tabsOf(sr.tabs);
      return tabs.length ? [{ id: unique(sr.id, 'stack'), tabs, ...(sr.height !== undefined ? { height: num(sr.height, MIN_STACK_HEIGHT, 4000, 200) } : {}), ...(sr.grow === true ? { grow: true } : {}) }] : [];
    });
    return stacks.length ? [{ id: unique(cr.id, 'dock'), side: cr.side === 'right' ? 'right' : 'left', width: num(cr.width, COLUMN_WIDTH.min, COLUMN_WIDTH.max, 250), stacks, ...(cr.hidden === true ? { hidden: true } : {}) }] : [];
  });
  const floating: FloatingPalette[] = (Array.isArray(r.floating) ? r.floating : []).slice(0, 40).flatMap((f): FloatingPalette[] => {
    if (!f || typeof f !== 'object') return [];
    const fr = f as Record<string, unknown>;
    if (!isPaletteId(fr.id) || seen.has(fr.id)) return [];
    seen.add(fr.id);
    return [{ id: fr.id, x: num(fr.x, -2000, 8000, 300), y: num(fr.y, 0, 8000, 120), w: num(fr.w, 160, 3000, 250), h: num(fr.h, 80, 3000, 300), ...(fr.minimized === true ? { minimized: true } : {}) }];
  });
  let layout = normalize({ columns, floating, lockHeight: r.lockHeight === true, fixWidth: r.fixWidth === true, lockPosition: r.lockPosition === true });
  for (const column of def.columns) for (const stack of column.stacks) for (const id of stack.tabs) layout = ensurePalette(layout, id, ws);
  return layout;
}
