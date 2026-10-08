/** Keyboard shortcut strings ("Mod+Shift+N") – parsing, matching and display. Pure, unit tested. */

export interface KeyInput {
  key: string;
  code: string;
  shift: boolean;
  alt: boolean;
  /** ⌘ on macOS, Ctrl elsewhere. */
  mod: boolean;
}

const CODE_KEYS: Record<string, string> = {
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Slash: '/',
  Backslash: '\\',
  Comma: ',',
  Period: '.',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
};

/** Normalised key name: letters/digits by character, punctuation by physical key when modifiers change the character. */
export function keyName(e: Pick<KeyInput, 'key' | 'code' | 'alt' | 'shift'>): string {
  const letter = /^Key([A-Z])$/.exec(e.code);
  const digit = /^Digit([0-9])$/.exec(e.code);
  // Option (and Shift on digits) changes the produced character; use the physical key then.
  if (letter && (e.alt || e.key.length !== 1 || !/[a-z]/i.test(e.key))) return letter[1].toLowerCase();
  if (digit && (e.alt || e.shift)) return digit[1];
  if (e.code in CODE_KEYS && (e.alt || e.shift || e.key.length !== 1)) return CODE_KEYS[e.code];
  if (e.key === ' ') return 'space';
  if (e.key.length === 1) return e.key.toLowerCase();
  return e.key.toLowerCase();
}

export function eventToShortcut(e: KeyInput): string {
  const parts: string[] = [];
  if (e.mod) parts.push('Mod');
  if (e.alt) parts.push('Alt');
  if (e.shift) parts.push('Shift');
  parts.push(keyName(e));
  return parts.join('+');
}

/** Canonical form of a shortcut definition ("Shift+Mod+N" → "Mod+Shift+n"). */
export function normalizeShortcut(s: string): string {
  const parts = s.split('+');
  const key = parts.pop()!.toLowerCase();
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  const out: string[] = [];
  if (mods.has('mod')) out.push('Mod');
  if (mods.has('alt')) out.push('Alt');
  if (mods.has('shift')) out.push('Shift');
  out.push(key === '' ? '+' : key);
  return out.join('+');
}

const MAC_SYMBOLS: Record<string, string> = { Mod: '⌘', Alt: '⌥', Shift: '⇧' };
const KEY_LABELS: Record<string, string> = {
  delete: 'Delete',
  backspace: '⌫',
  enter: '↩',
  escape: 'Esc',
  space: 'Space',
  tab: 'Tab',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
};

/** Human readable shortcut, e.g. "⇧⌘N" on macOS or "Shift+Ctrl+N" elsewhere. */
export function formatShortcut(s: string, mac: boolean): string {
  const parts = normalizeShortcut(s).split('+');
  const key = parts.pop()!;
  const label = KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1));
  if (mac) {
    // macOS order: ⌃⌥⇧⌘
    const order = ['Alt', 'Shift', 'Mod'];
    return order.filter((m) => parts.includes(m)).map((m) => MAC_SYMBOLS[m]).join('') + label;
  }
  const names: Record<string, string> = { Mod: 'Ctrl', Alt: 'Alt', Shift: 'Shift' };
  return [...['Shift', 'Mod', 'Alt'].filter((m) => parts.includes(m)).map((m) => names[m]), label].join('+');
}
