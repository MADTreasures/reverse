import { describe, expect, it } from 'vitest';
import { addStandardSet, createSet, type ColorSets, defaultColorSets, deleteSet, duplicateSet, editColors, moveSet, renameSet, sanitizeColorSets, STANDARD_SETS, uniqueSetName } from './colorSets';

describe('colour sets', () => {
  it('starts with own standard sets and reads older single lists', () => {
    const d = defaultColorSets();
    expect(d.sets.map((s) => s.name)).toEqual(['Standard color set', 'Grays', 'Skin tones', 'Pastel']);
    expect(d.sets[1].colors[0]).toBe('#000000');
    expect(d.sets[1].colors[15]).toBe('#ffffff');
    const old = sanitizeColorSets(['#FF0000', 'nope', '#00ff00']);
    expect(old.sets[0]).toEqual({ name: 'Standard color set', colors: ['#ff0000', '#00ff00'] });
    expect(sanitizeColorSets({ sets: [], current: 3 })).toEqual(defaultColorSets());
    expect(sanitizeColorSets({ sets: [{ name: ' A ', colors: ['#123456'] }], current: 9 })).toEqual({ sets: [{ name: 'A', colors: ['#123456'] }], current: 0 });
  });

  it('creates, duplicates, renames, moves and deletes sets like the Edit color sets dialog', () => {
    let cs = defaultColorSets();
    cs = createSet(cs, 'Mine');
    expect(cs.current).toBe(1);
    expect(cs.sets[1]).toEqual({ name: 'Mine', colors: [] });
    cs = editColors(cs, (c) => [...c, '#abcdef']);
    cs = duplicateSet(cs);
    expect(cs.sets[2]).toEqual({ name: 'Mine copy', colors: ['#abcdef'] });
    cs = renameSet(cs, 2, 'Other');
    expect(cs.sets[2].name).toBe('Other');
    cs = moveSet(cs, 2, 0);
    expect(cs.sets[0].name).toBe('Other');
    expect(cs.sets[cs.current].name).toBe('Other');
    cs = addStandardSet(cs);
    expect(cs.sets[cs.current].name).toBe('Standard color set 2');
    expect(cs.sets[cs.current].colors).toEqual(STANDARD_SETS[0].colors);
    const before = cs.sets.length;
    cs = deleteSet(cs);
    expect(cs.sets).toHaveLength(before - 1);
    expect(cs.current).toBe(before - 2);
    // The last set stays.
    let one: ColorSets = { sets: [{ name: 'Only', colors: [] }], current: 0 };
    one = deleteSet(one);
    expect(one.sets).toHaveLength(1);
    expect(uniqueSetName([{ name: 'A', colors: [] }, { name: 'A 2', colors: [] }], 'A')).toBe('A 3');
  });
});
