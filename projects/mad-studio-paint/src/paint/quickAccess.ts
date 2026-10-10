/**
 * Quick Access palette, like the reference's: sets of buttons for favourite tools (sub tools),
 * commands, drawing colours and auto actions, with separators; tiles or a list in several sizes;
 * a search through every function, with a history. Pure, unit tested.
 */

/** What a button runs; `name` is the name given in Settings (the function's own name otherwise). */
export type QuickItem = (
  | { kind: 'tool'; tool: string; sub?: string }
  | { kind: 'command'; id: string }
  | { kind: 'color'; color: string }
  | { kind: 'action'; id: string }
  | { kind: 'separator' }
) & { name?: string };

export interface QuickSet {
  id: string;
  name: string;
  items: QuickItem[];
}

/** Palette menu > View: tiles of a size or in a fixed number of columns, or a list. */
export type QuickView = 'tile-xs' | 'tile-s' | 'tile-m' | 'tile-l' | 'tile-4' | 'tile-8' | 'tile-16' | 'list-s' | 'list-m' | 'list-l' | 'list-1' | 'list-2' | 'list-3';

export const QUICK_VIEWS: { id: QuickView; label: string }[] = [
  { id: 'tile-xs', label: 'Tile (very small)' },
  { id: 'tile-s', label: 'Tile (small)' },
  { id: 'tile-m', label: 'Tile (medium)' },
  { id: 'tile-l', label: 'Tile (large)' },
  { id: 'tile-4', label: 'Tile (4 columns)' },
  { id: 'tile-8', label: 'Tile (8 columns)' },
  { id: 'tile-16', label: 'Tile (16 columns)' },
  { id: 'list-s', label: 'List (small)' },
  { id: 'list-m', label: 'List (medium)' },
  { id: 'list-l', label: 'List (large)' },
  { id: 'list-1', label: 'List (1 column)' },
  { id: 'list-2', label: 'List (2 columns)' },
  { id: 'list-3', label: 'List (3 columns)' },
];

export interface QuickLayout {
  list: boolean;
  /** Button size (px): tile width, or list row height. */
  size: number;
  /** Fixed columns (the buttons then follow the palette's width); none: as many as fit. */
  columns?: number;
  /** Names under the tiles (not on very small ones). */
  names: boolean;
}

/** How a view lays the buttons out. */
export function quickLayout(view: QuickView): QuickLayout {
  switch (view) {
    case 'tile-xs':
      return { list: false, size: 28, names: false };
    case 'tile-s':
      return { list: false, size: 44, names: true };
    case 'tile-l':
      return { list: false, size: 72, names: true };
    case 'tile-4':
    case 'tile-8':
    case 'tile-16':
      return { list: false, size: 0, columns: Number(view.slice(5)), names: view === 'tile-4' };
    case 'list-s':
      return { list: true, size: 20, names: true };
    case 'list-m':
      return { list: true, size: 26, names: true };
    case 'list-l':
      return { list: true, size: 34, names: true };
    case 'list-1':
    case 'list-2':
    case 'list-3':
      return { list: true, size: 26, columns: Number(view.slice(5)), names: true };
    default:
      return { list: false, size: 56, names: true };
  }
}

const cmd = (id: string): QuickItem => ({ kind: 'command', id });
const SEP: QuickItem = { kind: 'separator' };

/** This program's default sets (its own choice of commands, tools and colours). */
export function defaultQuickSets(): QuickSet[] {
  return [
    {
      id: 'qa-set-1',
      name: 'Set 1',
      items: [
        cmd('undo'),
        cmd('redo'),
        cmd('clear'),
        cmd('cut'),
        cmd('copy'),
        cmd('paste'),
        SEP,
        cmd('transform'),
        cmd('freeTransform'),
        cmd('transformMesh'),
        SEP,
        cmd('flipLayerH'),
        cmd('flipLayerV'),
        cmd('resetDisplay'),
        SEP,
        cmd('quickMask'),
        SEP,
        cmd('brushBigger'),
        cmd('brushSmaller'),
        SEP,
        cmd('quickAccessSettings'),
      ],
    },
    {
      id: 'qa-set-2',
      name: 'Set 2',
      items: [
        { kind: 'tool', tool: 'pen', sub: 'pen-g' },
        { kind: 'tool', tool: 'pencil', sub: 'pencil' },
        { kind: 'tool', tool: 'eraser', sub: 'eraser-hard' },
        { kind: 'tool', tool: 'fill', sub: 'fill-layer' },
        { kind: 'tool', tool: 'select', sub: 'sel-rect' },
        SEP,
        { kind: 'color', color: '#000000' },
        { kind: 'color', color: '#ffffff' },
        { kind: 'color', color: '#808080' },
        SEP,
        cmd('newRasterLayer'),
        cmd('newVectorLayer'),
        cmd('mergeDown'),
      ],
    },
  ];
}

/** What a button runs, as one string (its name aside): equal keys run the same. */
export function itemKey(item: QuickItem): string {
  switch (item.kind) {
    case 'tool':
      return `tool:${item.tool}${item.sub ? `/${item.sub}` : ''}`;
    case 'command':
      return `command:${item.id}`;
    case 'color':
      return `color:${item.color.toLowerCase()}`;
    case 'action':
      return `action:${item.id}`;
    default:
      return 'separator';
  }
}

const mapSet = (sets: QuickSet[], id: string, f: (s: QuickSet) => QuickSet) => sets.map((s) => (s.id === id ? f(s) : s));

/** No separator first or twice in a row. */
const tidy = (items: QuickItem[]): QuickItem[] => items.filter((it, i, a) => it.kind !== 'separator' || (i > 0 && a[i - 1].kind !== 'separator'));

/** Adds a button at `index` (the end by default); a separator never comes twice in a row or first. */
export function addItem(sets: QuickSet[], setId: string, item: QuickItem, index?: number): QuickSet[] {
  return mapSet(sets, setId, (s) => {
    const items = [...s.items];
    const at = index === undefined ? items.length : Math.max(0, Math.min(items.length, index));
    if (item.kind === 'separator' && (at === 0 || items[at - 1]?.kind === 'separator' || items[at]?.kind === 'separator')) return s;
    items.splice(at, 0, item);
    return { ...s, items };
  });
}

export const removeItem = (sets: QuickSet[], setId: string, index: number): QuickSet[] => mapSet(sets, setId, (s) => ({ ...s, items: s.items.filter((_, i) => i !== index) }));

/** Moves a button to `to` (an index of the set before the move). */
export function moveItem(sets: QuickSet[], setId: string, from: number, to: number): QuickSet[] {
  return mapSet(sets, setId, (s) => {
    if (from < 0 || from >= s.items.length) return s;
    const items = [...s.items];
    const [it] = items.splice(from, 1);
    items.splice(Math.max(0, Math.min(items.length, to > from ? to - 1 : to)), 0, it);
    return { ...s, items: tidy(items) };
  });
}

/** Moves a button to another set (at its end by default). */
export function moveItemToSet(sets: QuickSet[], fromSet: string, index: number, toSet: string, to?: number): QuickSet[] {
  if (fromSet === toSet) return to === undefined ? sets : moveItem(sets, fromSet, index, to);
  const item = sets.find((s) => s.id === fromSet)?.items[index];
  if (!item || !sets.some((s) => s.id === toSet)) return sets;
  return mapSet(addItem(sets, toSet, item, to), fromSet, (s) => ({ ...s, items: tidy(s.items.filter((_, i) => i !== index)) }));
}

/** Settings: the name a button shows (empty: the function's own). */
export const setItemName = (sets: QuickSet[], setId: string, index: number, name: string): QuickSet[] =>
  mapSet(sets, setId, (s) => ({
    ...s,
    items: s.items.map((it, i) => {
      if (i !== index || it.kind === 'separator') return it;
      const { name: _old, ...rest } = it;
      const n = name.trim().slice(0, 60);
      return (n ? { ...rest, name: n } : rest) as QuickItem;
    }),
  }));

/** Whether a set already has this button (separators aside). */
export const hasItem = (set: QuickSet, item: QuickItem): boolean => item.kind !== 'separator' && set.items.some((x) => itemKey(x) === itemKey(item));

let counter = 0;
export function newQuickSet(sets: QuickSet[], name: string): { sets: QuickSet[]; id: string } {
  const id = `qa-${Date.now().toString(36)}${(counter++).toString(36)}`;
  return { sets: [...sets, { id, name: name.trim().slice(0, 40) || `Set ${sets.length + 1}`, items: [] }], id };
}

export const renameQuickSet = (sets: QuickSet[], id: string, name: string): QuickSet[] => mapSet(sets, id, (s) => ({ ...s, name: name.trim().slice(0, 40) || s.name }));

/** Deletes a set (the last one stays). */
export const deleteQuickSet = (sets: QuickSet[], id: string): QuickSet[] => (sets.length > 1 ? sets.filter((s) => s.id !== id) : sets);

/** Moves a set tab to `index` (Ctrl + drag). */
export function moveQuickSet(sets: QuickSet[], id: string, index: number): QuickSet[] {
  const from = sets.findIndex((s) => s.id === id);
  if (from < 0) return sets;
  const out = [...sets];
  const [s] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, index > from ? index - 1 : index)), 0, s);
  return out;
}

/** A function the search finds: what to run, its name, and where it is found. */
export interface QuickFunction {
  item: QuickItem;
  name: string;
  where: string;
}

/** Functions whose name or place contains every word of the query (any case); names first. */
export function searchFunctions(all: QuickFunction[], query: string, max = 40): QuickFunction[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits = all.filter((f) => {
    const text = `${f.name} ${f.where}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
  const inName = (f: QuickFunction) => (words.every((w) => f.name.toLowerCase().includes(w)) ? 0 : 1);
  return hits.sort((a, b) => inName(a) - inName(b)).slice(0, max);
}

/** The search history: the newest first, each once, at most `max`. */
export function addToHistory(history: string[], query: string, max = 20): string[] {
  const q = query.trim().slice(0, 80);
  if (!q) return history;
  return [q, ...history.filter((h) => h.toLowerCase() !== q.toLowerCase())].slice(0, max);
}

const HEX = /^#[0-9a-f]{6}$/i;

function sanitizeItem(raw: unknown): QuickItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const word = (v: unknown) => typeof v === 'string' && /^[\w:-]{1,80}$/.test(v);
  const named = (it: QuickItem): QuickItem => (typeof r.name === 'string' && r.name.trim() ? { ...it, name: r.name.trim().slice(0, 60) } : it);
  if (r.kind === 'separator') return { kind: 'separator' };
  if (r.kind === 'command' && word(r.id)) return named({ kind: 'command', id: r.id as string });
  if (r.kind === 'action' && word(r.id)) return named({ kind: 'action', id: r.id as string });
  if (r.kind === 'color' && typeof r.color === 'string' && HEX.test(r.color)) return named({ kind: 'color', color: r.color.toLowerCase() });
  if (r.kind === 'tool' && word(r.tool)) return named({ kind: 'tool', tool: r.tool as string, ...(word(r.sub) ? { sub: r.sub as string } : {}) });
  return null;
}

/** One button from a drag (or storage): checked like the saved ones. */
export const parseQuickItem = (raw: unknown): QuickItem | null => {
  const it = sanitizeItem(raw);
  return it && it.kind !== 'separator' ? it : null;
};

export const isQuickView = (v: unknown): v is QuickView => QUICK_VIEWS.some((x) => x.id === v);

/** Quick Access sets from storage, every value checked (none valid: the defaults). */
export function sanitizeQuickSets(raw: unknown): QuickSet[] {
  if (!Array.isArray(raw)) return defaultQuickSets();
  const seen = new Set<string>();
  const sets = raw.slice(0, 50).flatMap((s): QuickSet[] => {
    if (!s || typeof s !== 'object') return [];
    const r = s as Record<string, unknown>;
    if (typeof r.id !== 'string' || !/^[\w-]{1,60}$/.test(r.id) || seen.has(r.id)) return [];
    seen.add(r.id);
    const items = (Array.isArray(r.items) ? r.items : []).slice(0, 300).map(sanitizeItem).filter((x): x is QuickItem => x !== null);
    return [{ id: r.id, name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 40) : 'Set', items }];
  });
  return sets.length ? sets : defaultQuickSets();
}
