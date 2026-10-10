import { describe, expect, it } from 'vitest';
import {
  addItem,
  addToHistory,
  defaultQuickSets,
  deleteQuickSet,
  hasItem,
  itemKey,
  moveItem,
  moveItemToSet,
  moveQuickSet,
  newQuickSet,
  parseQuickItem,
  quickLayout,
  QUICK_VIEWS,
  removeItem,
  renameQuickSet,
  sanitizeQuickSets,
  searchFunctions,
  setItemName,
  type QuickFunction,
  type QuickSet,
} from './quickAccess';

describe('quick access', () => {
  it('adds, moves and removes buttons; separators never come first or twice', () => {
    let sets = defaultQuickSets();
    const id = sets[0].id;
    const n = sets[0].items.length;
    sets = addItem(sets, id, { kind: 'color', color: '#ff0000' });
    expect(sets[0].items).toHaveLength(n + 1);
    expect(hasItem(sets[0], { kind: 'color', color: '#ff0000' })).toBe(true);
    sets = addItem(sets, id, { kind: 'separator' });
    sets = addItem(sets, id, { kind: 'separator' });
    expect(sets[0].items.filter((x, i, a) => x.kind === 'separator' && a[i - 1]?.kind === 'separator')).toHaveLength(0);
    expect(addItem(sets, id, { kind: 'separator' }, 0)[0].items[0].kind).not.toBe('separator');
    sets = moveItem(sets, id, n, 0);
    expect(sets[0].items[0]).toEqual({ kind: 'color', color: '#ff0000' });
    sets = removeItem(sets, id, 0);
    expect(hasItem(sets[0], { kind: 'color', color: '#ff0000' })).toBe(false);
  });

  it('moves a button before the one it is dropped on, and to another set', () => {
    const start: QuickSet[] = [
      { id: 'a', name: 'A', items: [{ kind: 'command', id: 'undo' }, { kind: 'command', id: 'redo' }, { kind: 'command', id: 'cut' }] },
      { id: 'b', name: 'B', items: [{ kind: 'color', color: '#000000' }] },
    ];
    // undo dropped before cut (index 2 before the move) → redo, undo, cut
    expect(moveItem(start, 'a', 0, 2)[0].items.map(itemKey)).toEqual(['command:redo', 'command:undo', 'command:cut']);
    expect(moveItem(start, 'a', 2, 0)[0].items.map(itemKey)).toEqual(['command:cut', 'command:undo', 'command:redo']);
    const moved = moveItemToSet(start, 'a', 1, 'b', 0);
    expect(moved[0].items.map(itemKey)).toEqual(['command:undo', 'command:cut']);
    expect(moved[1].items.map(itemKey)).toEqual(['command:redo', 'color:#000000']);
    // A separator left first by the move goes.
    const withSep = addItem(addItem(start, 'a', { kind: 'separator' }, 1), 'a', { kind: 'tool', tool: 'pen' }, 0);
    expect(moveItemToSet(withSep, 'a', 0, 'b')[0].items.map(itemKey)).toEqual(['command:undo', 'separator', 'command:redo', 'command:cut']);
    expect(moveItemToSet(moveItemToSet(withSep, 'a', 0, 'b'), 'a', 0, 'b')[0].items.map(itemKey)).toEqual(['command:redo', 'command:cut']);
  });

  it('names buttons in Settings; the name does not change what they run', () => {
    let sets = defaultQuickSets();
    const id = sets[1].id;
    sets = setItemName(sets, id, 6, ' Ink black ');
    expect(sets[1].items[6]).toEqual({ kind: 'color', color: '#000000', name: 'Ink black' });
    expect(hasItem(sets[1], { kind: 'color', color: '#000000' })).toBe(true);
    expect(setItemName(sets, id, 6, '')[1].items[6]).toEqual({ kind: 'color', color: '#000000' });
    expect(setItemName(sets, id, 5, 'x')[1].items[5]).toEqual({ kind: 'separator' });
  });

  it('makes, renames, moves and deletes sets (one always stays)', () => {
    const made = newQuickSet(defaultQuickSets(), ' Inking ');
    expect(made.sets.at(-1)).toMatchObject({ id: made.id, name: 'Inking', items: [] });
    expect(renameQuickSet(made.sets, made.id, 'Ink')!.at(-1)!.name).toBe('Ink');
    expect(moveQuickSet(made.sets, made.id, 0).map((s) => s.name)).toEqual(['Inking', 'Set 1', 'Set 2']);
    expect(moveQuickSet(made.sets, 'qa-set-1', 2).map((s) => s.name)).toEqual(['Set 2', 'Set 1', 'Inking']);
    const one = [defaultQuickSets()[0]];
    expect(deleteQuickSet(one, one[0].id)).toHaveLength(1);
    expect(deleteQuickSet(made.sets, made.id).some((s) => s.id === made.id)).toBe(false);
  });

  it('searches every function by name and place, names first, and keeps a history', () => {
    const all: QuickFunction[] = [
      { item: { kind: 'command', id: 'transform' }, name: 'Scale up/Scale down/Rotate', where: 'Edit > Transform' },
      { item: { kind: 'command', id: 'freeTransform' }, name: 'Free transform', where: 'Edit > Transform' },
      { item: { kind: 'tool', tool: 'brush', sub: 'brush-oil' }, name: 'Oil paint', where: 'Tools > Brush' },
    ];
    expect(searchFunctions(all, 'TRANSFORM').map((f) => f.name)).toEqual(['Free transform', 'Scale up/Scale down/Rotate']);
    expect(searchFunctions(all, 'oil brush').map((f) => f.name)).toEqual(['Oil paint']);
    expect(searchFunctions(all, '  ')).toEqual([]);
    let h = addToHistory([], 'blur');
    h = addToHistory(h, 'pen');
    h = addToHistory(h, 'BLUR');
    expect(h).toEqual(['BLUR', 'pen']);
    expect(addToHistory(h, '   ')).toBe(h);
    expect(Array.from({ length: 30 }, (_, i) => `q${i}`).reduce((a, q) => addToHistory(a, q), [] as string[])).toHaveLength(20);
  });

  it('lays out tiles and lists like the views of the reference', () => {
    expect(QUICK_VIEWS).toHaveLength(13);
    expect(quickLayout('tile-xs')).toEqual({ list: false, size: 28, names: false });
    expect(quickLayout('tile-8')).toMatchObject({ list: false, columns: 8 });
    expect(quickLayout('list-2')).toMatchObject({ list: true, columns: 2 });
    expect(quickLayout('list-l').size).toBeGreaterThan(quickLayout('list-s').size);
  });

  it('reads saved sets and dropped buttons safely', () => {
    const sets = sanitizeQuickSets([
      { id: 'a', name: 'Mine', items: [{ kind: 'command', id: 'undo', name: ' Back ' }, { kind: 'color', color: 'red' }, { kind: 'tool', tool: 'pen', sub: 'pen-g' }, { kind: 'script', code: 'x' }] },
      { id: 'a', name: 'Twice', items: [] },
    ]);
    expect(sets).toEqual([{ id: 'a', name: 'Mine', items: [{ kind: 'command', id: 'undo', name: 'Back' }, { kind: 'tool', tool: 'pen', sub: 'pen-g' }] }]);
    expect(sanitizeQuickSets('junk')).toEqual(defaultQuickSets());
    expect(parseQuickItem({ kind: 'action', id: 'act-1' })).toEqual({ kind: 'action', id: 'act-1' });
    expect(parseQuickItem({ kind: 'separator' })).toBeNull();
    expect(parseQuickItem({ kind: 'command', id: 'x y' })).toBeNull();
  });
});
