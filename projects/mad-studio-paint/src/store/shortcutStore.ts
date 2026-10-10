/**
 * Shortcut Settings state: the shortcuts changed from the defaults (kept in the browser's
 * storage). The keyboard, the menus and the palettes read the shortcuts through the commands
 * module, which knows the defaults.
 */
import { create } from 'zustand';
import { sanitizeShortcutOverrides, type ShortcutMap } from '../model/shortcutMap';

const KEY = 'mad-paint:shortcuts';

function load(): ShortcutMap {
  try {
    return sanitizeShortcutOverrides(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return {};
  }
}

export const useShortcuts = create<{ overrides: ShortcutMap }>(() => ({ overrides: load() }));

/** Shortcut Settings > OK. */
export function setShortcutOverrides(overrides: ShortcutMap): void {
  useShortcuts.setState({ overrides });
  try {
    localStorage.setItem(KEY, JSON.stringify(overrides));
  } catch {
    // Not kept (private window or full storage).
  }
}
