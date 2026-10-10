import { describe, expect, it } from 'vitest';
import { addShortcut, deleteShortcut, effectiveShortcuts, isValidShortcut, keyOfShortcut, replaceShortcut, sanitizeShortcutOverrides, setShortcuts, targetsOf, type ShortcutMap } from './shortcutMap';

const DEFAULTS: ShortcutMap = {
  'command:new': ['Mod+n'],
  'command:save': ['Mod+s'],
  'command:zoomIn': ['Mod+=', 'Mod++'],
  'command:selectAll': ['Mod+a'],
  'tool:pen': ['p'],
  'tool:pencil': ['p'],
  'tool:eraser': ['e'],
};

describe('shortcut settings', () => {
  it('applies overrides to the defaults and finds what a shortcut runs', () => {
    const map = effectiveShortcuts(DEFAULTS, { 'command:new': ['Shift+Mod+N'], 'action:act-1': ['F5'] });
    expect(map['command:new']).toEqual(['Mod+Shift+n']);
    expect(map['action:act-1']).toEqual(['f5']);
    expect(targetsOf(map, 'mod+SHIFT+n')).toEqual(['command:new']);
    // Tools share P.
    expect(targetsOf(map, 'p')).toEqual(['tool:pen', 'tool:pencil']);
  });

  it('moves a shortcut from the command that had it; tools can share one', () => {
    // ⌘S set on New: Save loses it.
    const r = setShortcuts(DEFAULTS, {}, 'command:new', ['Mod+s']);
    expect(r.moved).toEqual(['command:save']);
    const map = effectiveShortcuts(DEFAULTS, r.overrides);
    expect(map['command:new']).toEqual(['Mod+s']);
    expect(map['command:save']).toEqual([]);
    // E set on Pen: the eraser keeps it too (tools switch between each other).
    const t = setShortcuts(DEFAULTS, {}, 'tool:pen', ['e']);
    expect(t.moved).toEqual([]);
    expect(targetsOf(effectiveShortcuts(DEFAULTS, t.overrides), 'e')).toEqual(['tool:pen', 'tool:eraser']);
    // A tool taking a command's shortcut: the command loses it.
    const c = setShortcuts(DEFAULTS, {}, 'tool:eraser', ['Mod+a']);
    expect(c.moved).toEqual(['command:selectAll']);
  });

  it('edits, adds and deletes single shortcuts; back to the default leaves no override', () => {
    let o = replaceShortcut(DEFAULTS, {}, 'command:zoomIn', 'Mod++', 'Mod+Alt+=').overrides;
    expect(effectiveShortcuts(DEFAULTS, o)['command:zoomIn']).toEqual(['Mod+=', 'Mod+Alt+=']);
    o = addShortcut(DEFAULTS, o, 'command:new', 'F2').overrides;
    expect(effectiveShortcuts(DEFAULTS, o)['command:new']).toEqual(['Mod+n', 'f2']);
    o = deleteShortcut(DEFAULTS, o, 'command:new', 'f2');
    expect(o['command:new']).toBeUndefined();
    o = replaceShortcut(DEFAULTS, o, 'command:zoomIn', 'Mod+Alt+=', 'Mod++').overrides;
    expect(o).toEqual({});
    // A function without shortcuts gets its first one.
    expect(replaceShortcut(DEFAULTS, {}, 'action:a', null, 'F6').overrides).toEqual({ 'action:a': ['f6'] });
  });

  it('accepts real keys only and reads saved overrides safely', () => {
    expect(isValidShortcut('Mod+Shift+n')).toBe(true);
    expect(isValidShortcut('Mod++')).toBe(true);
    expect(keyOfShortcut('Mod++')).toBe('+');
    expect(isValidShortcut('Shift+shift')).toBe(false);
    expect(isValidShortcut('escape')).toBe(false);
    expect(isValidShortcut('Mod+meta')).toBe(false);
    expect(
      sanitizeShortcutOverrides({ 'command:new': ['Mod+N', 'Mod+N', 7, 'Shift+shift'], 'evil:x': ['a'], 'tool:pen': 'p', 'action:act-1': [] }),
    ).toEqual({ 'command:new': ['Mod+n'], 'action:act-1': [] });
    expect(sanitizeShortcutOverrides([1, 2])).toEqual({});
  });
});
