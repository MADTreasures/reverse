/**
 * Colour sets of the Color Set palette: several named lists of colours, one shown at a time, and
 * the edits of the reference's Edit color sets dialog. Pure, unit tested.
 */

export interface ColorSetData {
  name: string;
  colors: string[];
}

export interface ColorSets {
  sets: ColorSetData[];
  /** Index of the set shown in the palette. */
  current: number;
}

const greys = Array.from({ length: 16 }, (_, i) => {
  const v = Math.round((i * 255) / 15)
    .toString(16)
    .padStart(2, '0');
  return `#${v}${v}${v}`;
});

/** Own standard sets (not the reference's materials). */
export const STANDARD_SETS: ColorSetData[] = [
  {
    name: 'Standard color set',
    colors: [
      '#000000', '#ffffff', '#262626', '#4d4d4d', '#737373', '#999999', '#bfbfbf', '#e6e6e6',
      '#e53935', '#fb8c00', '#fdd835', '#43a047', '#00acc1', '#1e88e5', '#5e35b1', '#d81b60',
      '#ef9a9a', '#ffcc80', '#fff59d', '#a5d6a7', '#80deea', '#90caf9', '#b39ddb', '#f48fb1',
      '#8e2b2b', '#8a4b12', '#7d6b12', '#245c27', '#0d5c66', '#163e7a', '#3b2373', '#7a1a45',
      '#fde3d0', '#f6c9a8', '#e8a87c', '#c98a5f', '#a0663f', '#7a4a2a', '#53321d', '#2e1c11',
    ],
  },
  { name: 'Grays', colors: greys },
  {
    name: 'Skin tones',
    colors: ['#fff1e6', '#fde3d0', '#f9d4bb', '#f6c9a8', '#efb894', '#e8a87c', '#d9966b', '#c98a5f', '#b8774f', '#a0663f', '#8d5634', '#7a4a2a', '#663c22', '#53321d', '#3f2617', '#2e1c11'],
  },
  {
    name: 'Pastel',
    colors: ['#ffd6d6', '#ffe4c7', '#fff4c2', '#e2f5c8', '#cdeedd', '#c9eef2', '#cfe3fb', '#d9d6f8', '#ecd5f5', '#f8d3e6', '#f2e8df', '#e3e3e3'],
  },
];

export const defaultColorSets = (): ColorSets => ({ sets: STANDARD_SETS.map((s) => ({ name: s.name, colors: [...s.colors] })), current: 0 });

const HEX = /^#[0-9a-f]{6}$/i;

/** Colour sets from storage, kept sensible; a bare list (earlier versions) becomes the first set. */
export function sanitizeColorSets(raw: unknown): ColorSets {
  if (Array.isArray(raw)) {
    const colors = raw.filter((c): c is string => typeof c === 'string' && HEX.test(c)).map((c) => c.toLowerCase());
    const d = defaultColorSets();
    d.sets[0] = { name: d.sets[0].name, colors };
    return d;
  }
  if (!raw || typeof raw !== 'object') return defaultColorSets();
  const r = raw as Record<string, unknown>;
  const sets = (Array.isArray(r.sets) ? r.sets : [])
    .slice(0, 200)
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => ({
      name: typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 64) : 'Color set',
      colors: (Array.isArray(s.colors) ? s.colors : []).filter((c): c is string => typeof c === 'string' && HEX.test(c)).slice(0, 1000).map((c) => c.toLowerCase()),
    }));
  if (sets.length === 0) return defaultColorSets();
  const current = typeof r.current === 'number' && Number.isInteger(r.current) ? Math.min(sets.length - 1, Math.max(0, r.current)) : 0;
  return { sets, current };
}

/** A name not used yet: "Base", "Base 2", "Base 3" … */
export function uniqueSetName(sets: ColorSetData[], base: string): string {
  const names = new Set(sets.map((s) => s.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}

/** Create new set: an empty set after the current one, which becomes current. */
export function createSet(cs: ColorSets, name: string): ColorSets {
  const sets = [...cs.sets];
  sets.splice(cs.current + 1, 0, { name: uniqueSetName(sets, name.trim() || 'New color set'), colors: [] });
  return { sets, current: cs.current + 1 };
}

/** Add standard set: a fresh copy of the standard set. */
export function addStandardSet(cs: ColorSets): ColorSets {
  const std = STANDARD_SETS[0];
  return { sets: [...cs.sets, { name: uniqueSetName(cs.sets, std.name), colors: [...std.colors] }], current: cs.sets.length };
}

export function duplicateSet(cs: ColorSets, index = cs.current): ColorSets {
  const src = cs.sets[index];
  if (!src) return cs;
  const sets = [...cs.sets];
  sets.splice(index + 1, 0, { name: uniqueSetName(sets, `${src.name} copy`), colors: [...src.colors] });
  return { sets, current: index + 1 };
}

/** Deletes a set (the last one cannot go). */
export function deleteSet(cs: ColorSets, index = cs.current): ColorSets {
  if (cs.sets.length <= 1 || !cs.sets[index]) return cs;
  const sets = cs.sets.filter((_, i) => i !== index);
  return { sets, current: Math.min(sets.length - 1, index > cs.current ? cs.current : Math.max(0, cs.current - (index < cs.current ? 1 : 0))) };
}

export function renameSet(cs: ColorSets, index: number, name: string): ColorSets {
  const n = name.trim().slice(0, 64);
  if (!n || !cs.sets[index]) return cs;
  return { ...cs, sets: cs.sets.map((s, i) => (i === index ? { ...s, name: n } : s)) };
}

/** Moves a set in the list (drag in the dialog); the shown set stays shown. */
export function moveSet(cs: ColorSets, from: number, to: number): ColorSets {
  if (!cs.sets[from] || to < 0 || to >= cs.sets.length || from === to) return cs;
  const sets = [...cs.sets];
  const [moved] = sets.splice(from, 1);
  sets.splice(to, 0, moved);
  const shown = cs.sets[cs.current];
  return { sets, current: sets.indexOf(shown) };
}

/** Changes the colours of the current set. */
export function editColors(cs: ColorSets, fn: (colors: string[]) => string[]): ColorSets {
  return { ...cs, sets: cs.sets.map((s, i) => (i === cs.current ? { ...s, colors: fn(s.colors) } : s)) };
}
