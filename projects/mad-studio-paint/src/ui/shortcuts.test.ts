import { describe, expect, it } from 'vitest';
import { eventToShortcut, formatShortcut, normalizeShortcut, toAccelerator } from './shortcuts';

const ev = (key: string, code: string, mods: Partial<{ shift: boolean; alt: boolean; mod: boolean }> = {}) => ({
  key,
  code,
  shift: false,
  alt: false,
  mod: false,
  ...mods,
});

describe('shortcuts', () => {
  it('builds canonical strings from key events', () => {
    expect(eventToShortcut(ev('n', 'KeyN', { mod: true, shift: true }))).toBe('Mod+Shift+n');
    expect(eventToShortcut(ev('N', 'KeyN', { shift: true }))).toBe('Shift+n');
    // Option changes the character on macOS (⌥Z = Ω): the physical key wins.
    expect(eventToShortcut(ev('Ω', 'KeyZ', { alt: true, mod: true }))).toBe('Mod+Alt+z');
    expect(eventToShortcut(ev('[', 'BracketLeft'))).toBe('[');
    expect(eventToShortcut(ev(' ', 'Space'))).toBe('space');
    expect(eventToShortcut(ev('Delete', 'Delete'))).toBe('delete');
    // Shift+digit gives a symbol; keep the digit.
    expect(eventToShortcut(ev('=', 'Digit0', { mod: true, shift: true }))).toBe('Mod+Shift+0');
  });

  it('respects the typed character for letters on other layouts (QWERTZ: Z and Y swapped)', () => {
    expect(eventToShortcut(ev('z', 'KeyY', { mod: true }))).toBe('Mod+z');
  });

  it('normalises and formats', () => {
    expect(normalizeShortcut('Shift+Mod+N')).toBe('Mod+Shift+n');
    expect(formatShortcut('Mod+Shift+n', true)).toBe('⇧⌘N');
    expect(formatShortcut('Mod+Alt+0', true)).toBe('⌥⌘0');
    expect(formatShortcut('Mod+Shift+n', false)).toBe('Shift+Ctrl+N');
    expect(formatShortcut('delete', true)).toBe('Delete');
  });

  it('converts shortcuts to Electron menu accelerators', () => {
    expect(toAccelerator('Mod+Shift+n')).toBe('Shift+CmdOrCtrl+N');
    expect(toAccelerator('Alt+backspace')).toBe('Alt+Backspace');
    expect(toAccelerator('Mod+Alt+0')).toBe('Alt+CmdOrCtrl+0');
    expect(toAccelerator('Mod++')).toBe('CmdOrCtrl+Plus');
    expect(toAccelerator('Alt+]')).toBe('Alt+]');
    expect(toAccelerator('F1')).toBe('F1');
    expect(toAccelerator('-')).toBe('-');
    expect(toAccelerator('Shift+tab')).toBe('Shift+Tab');
  });
});
