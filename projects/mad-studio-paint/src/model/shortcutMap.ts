/**
 * Shortcut Settings, like the reference's: menu commands, options, tools and auto actions can have
 * shortcuts. Changed shortcuts are kept as overrides of the defaults. A shortcut runs one command
 * or auto action: set on another function it moves there; tools may share one (pressing it again
 * switches between them, like P for Pen and Pencil). Pure, unit tested.
 */
import { normalizeShortcut } from '../ui/shortcuts';

/** A function with shortcuts: `command:<id>`, `tool:<id>` or `action:<id>`. */
export type ShortcutTarget = string;

/** Shortcuts by function. */
export type ShortcutMap = Record<ShortcutTarget, string[]>;

export const isToolTarget = (t: ShortcutTarget) => t.startsWith('tool:');

const MODIFIER_KEYS = new Set(['shift', 'alt', 'control', 'meta', 'mod', 'capslock', 'fn', 'os']);

/** The key of a shortcut without its modifiers ("Mod++" → "+"). */
export function keyOfShortcut(s: string): string {
  const n = normalizeShortcut(s);
  return n === '+' || n.endsWith('++') ? '+' : (n.split('+').pop() ?? '');
}

/** Whether a shortcut has a key besides modifiers (Escape stays for cancelling). */
export function isValidShortcut(s: string): boolean {
  const key = keyOfShortcut(s);
  return key !== '' && !MODIFIER_KEYS.has(key) && key !== 'escape' && key !== 'unidentified' && key !== 'dead';
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** The shortcuts of every function: the defaults with the overrides. */
export function effectiveShortcuts(defaults: ShortcutMap, overrides: ShortcutMap): ShortcutMap {
  const out: ShortcutMap = {};
  for (const [t, keys] of Object.entries(defaults)) out[t] = keys.map(normalizeShortcut);
  for (const [t, keys] of Object.entries(overrides)) out[t] = keys.map(normalizeShortcut);
  return out;
}

/** The functions a shortcut belongs to (tools may share one). */
export function targetsOf(map: ShortcutMap, shortcut: string): ShortcutTarget[] {
  const s = normalizeShortcut(shortcut);
  return Object.entries(map)
    .filter(([, keys]) => keys.includes(s))
    .map(([t]) => t);
}

/**
 * Sets the shortcuts of a function. Each shortcut leaves the functions it belonged to – except
 * tools, which can share one with other tools. Overrides equal to the defaults are dropped.
 * Returns the new overrides and the functions that lost a shortcut.
 */
export function setShortcuts(defaults: ShortcutMap, overrides: ShortcutMap, target: ShortcutTarget, keys: string[]): { overrides: ShortcutMap; moved: ShortcutTarget[] } {
  const wanted = [...new Set(keys.filter(isValidShortcut).map(normalizeShortcut))];
  const current = effectiveShortcuts(defaults, overrides);
  const next: ShortcutMap = { ...current, [target]: wanted };
  const moved: ShortcutTarget[] = [];
  for (const [t, ks] of Object.entries(current)) {
    if (t === target || (isToolTarget(t) && isToolTarget(target))) continue;
    const kept = ks.filter((k) => !wanted.includes(k));
    if (kept.length !== ks.length) {
      next[t] = kept;
      moved.push(t);
    }
  }
  const out: ShortcutMap = {};
  for (const [t, ks] of Object.entries(next)) {
    const def = (defaults[t] ?? []).map(normalizeShortcut);
    if (!same(ks, def)) out[t] = ks;
  }
  return { overrides: out, moved };
}

/** Adds one shortcut to a function (Add shortcut). */
export const addShortcut = (defaults: ShortcutMap, overrides: ShortcutMap, target: ShortcutTarget, key: string) =>
  setShortcuts(defaults, overrides, target, [...(effectiveShortcuts(defaults, overrides)[target] ?? []), key]);

/** Replaces one shortcut of a function (Edit shortcut); `old` null: the first, or a new one. */
export function replaceShortcut(defaults: ShortcutMap, overrides: ShortcutMap, target: ShortcutTarget, old: string | null, key: string) {
  const keys = [...(effectiveShortcuts(defaults, overrides)[target] ?? [])];
  const i = old === null ? 0 : keys.indexOf(normalizeShortcut(old));
  if (i >= 0 && i < keys.length) keys[i] = key;
  else keys.push(key);
  return setShortcuts(defaults, overrides, target, keys);
}

/** Deletes one shortcut of a function (Delete shortcut). */
export const deleteShortcut = (defaults: ShortcutMap, overrides: ShortcutMap, target: ShortcutTarget, key: string) =>
  setShortcuts(
    defaults,
    overrides,
    target,
    (effectiveShortcuts(defaults, overrides)[target] ?? []).filter((k) => k !== normalizeShortcut(key)),
  ).overrides;

/** Overrides from storage, every value checked. */
export function sanitizeShortcutOverrides(raw: unknown): ShortcutMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: ShortcutMap = {};
  for (const [t, keys] of Object.entries(raw as Record<string, unknown>).slice(0, 2000)) {
    if (!/^(command|tool|action):[\w:-]{1,80}$/.test(t) || !Array.isArray(keys)) continue;
    out[t] = [...new Set(keys.filter((k): k is string => typeof k === 'string' && k.length <= 40 && isValidShortcut(k)).map(normalizeShortcut))].slice(0, 8);
  }
  return out;
}
