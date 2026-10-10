/**
 * Piano roll tools (FL Studio: piano roll menu › Tools). Every tool is a pure function from the
 * channel's notes, the selection (empty = all notes) and its parameters to the new note list, so the
 * tool dialogs can preview the result live and tests can check it.
 */
import { makeId } from './ids';
import { NOTE_PROPS, notePropSpec, noteValue, setNoteValue, type NotePropKey } from './notes';
import { CHORDS, scaleDegreeKey, scaleSteps, type ScaleSpec, type ScaleType } from './scales';
import { PPQ, TICKS_PER_STEP, noteName, ticksPerBar } from './timing';
import type { Id, Note } from './types';

export type ToolValue = number | string | boolean;
export type ToolValues = Record<string, ToolValue>;

export interface ToolContext {
  /** Current snap in ticks. */
  grid: number;
  beatsPerBar: number;
  patternLength: number;
  /** Scale of the project (scale highlighting), if any. */
  scale: ScaleSpec | null;
  /** Where generated notes start (the last click in the piano roll). */
  position: number;
}

interface ParamBase {
  key: string;
  label: string;
}
export interface NumberParam extends ParamBase {
  kind: 'number';
  min: number;
  max: number;
  def: number;
  integer?: boolean;
  bipolar?: boolean;
  format: (v: number) => string;
}
export interface ChoiceParam extends ParamBase {
  kind: 'choice';
  options: readonly { value: string; label: string }[];
  def: string;
}
export interface BoolParam extends ParamBase {
  kind: 'bool';
  def: boolean;
}
export type ToolParam = NumberParam | ChoiceParam | BoolParam;

export interface NoteTool {
  id: string;
  label: string;
  /** Shortcut as shown in the menu (FL Studio's defaults). */
  shortcut: string;
  description: string;
  /** No parameters: the tool runs directly from the menu. */
  params: readonly ToolParam[];
  apply(notes: readonly Note[], selected: ReadonlySet<Id>, v: ToolValues, ctx: ToolContext): Note[];
}

// ---------------------------------------------------------------------------------------------
// Helpers

const pct = (v: number) => `${Math.round(v)}%`;
const ticks = (v: number) => `${Math.round(v)} ticks`;
const int = (v: number) => String(Math.round(v));

/** Note lengths offered by the tools ("Snap" follows the piano roll). */
export const TIME_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'snap', label: 'Snap' },
  { value: String(TICKS_PER_STEP / 4), label: '1/4 step' },
  { value: String(TICKS_PER_STEP / 3), label: '1/3 step' },
  { value: String(TICKS_PER_STEP / 2), label: '1/2 step' },
  { value: String(TICKS_PER_STEP), label: 'Step' },
  { value: String(PPQ / 3), label: '1/3 beat' },
  { value: String(PPQ / 2), label: '1/2 beat' },
  { value: String(PPQ), label: 'Beat' },
  { value: 'bar', label: 'Bar' },
  { value: '2bars', label: '2 bars' },
];

export function timeTicks(value: ToolValue, ctx: ToolContext): number {
  if (value === 'snap') return Math.max(1, ctx.grid);
  if (value === 'bar') return ticksPerBar(ctx.beatsPerBar);
  if (value === '2bars') return 2 * ticksPerBar(ctx.beatsPerBar);
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? n : Math.max(1, ctx.grid);
}

const num = (v: ToolValues, key: string, def = 0) => (typeof v[key] === 'number' ? (v[key] as number) : def);
const str = (v: ToolValues, key: string, def = '') => (typeof v[key] === 'string' ? (v[key] as string) : def);
const bool = (v: ToolValues, key: string) => v[key] === true;

/** The notes a tool works on: the selection, or every note when nothing (still existing) is selected. */
function chosen(notes: readonly Note[], selected: ReadonlySet<Id>): (n: Note) => boolean {
  if (selected.size === 0 || !notes.some((n) => selected.has(n.id))) return () => true;
  return (n) => selected.has(n.id);
}

const clone = (n: Note): Note => ({ ...n });
const sorted = (notes: Note[]) => notes.sort((a, b) => a.start - b.start || a.key - b.key);
const clampKey = (k: number) => Math.min(127, Math.max(0, Math.round(k)));

/** Notes starting together form a chord (FL Studio's tools treat them as one). */
function chords(notes: readonly Note[]): Note[][] {
  const groups = new Map<number, Note[]>();
  for (const n of notes) {
    const g = groups.get(n.start);
    if (g) g.push(n);
    else groups.set(n.start, [n]);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g.sort((a, b) => a.key - b.key));
}

/** Deterministic pseudo random numbers (mulberry32), so a dialog's preview does not flicker. */
export function random(seed: number): () => number {
  let a = Math.floor(seed * 2654435761) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Applies `fn` to the chosen notes (copies), keeping the others. */
function mapChosen(notes: readonly Note[], selected: ReadonlySet<Id>, fn: (n: Note, i: number) => void): Note[] {
  const pick = chosen(notes, selected);
  let i = 0;
  return sorted(
    notes.map((n) => {
      if (!pick(n)) return n;
      const c = clone(n);
      fn(c, i++);
      c.start = Math.max(0, Math.round(c.start));
      c.length = Math.max(1, Math.round(c.length));
      c.key = clampKey(c.key);
      return c;
    }),
  );
}

const propOptions = NOTE_PROPS.map((p) => ({ value: p.key, label: p.label }));

// ---------------------------------------------------------------------------------------------
// Tools

const quantize: NoteTool = {
  id: 'quantize',
  label: 'Quantize…',
  shortcut: 'Alt+Q',
  description: 'Moves note starts (and optionally ends) towards the grid.',
  params: [
    { kind: 'choice', key: 'time', label: 'Grid', options: TIME_OPTIONS, def: 'snap' },
    { kind: 'number', key: 'strength', label: 'Strength', min: 0, max: 100, def: 100, format: pct },
    { kind: 'bool', key: 'ends', label: 'Quantize ends', def: false },
  ],
  apply(notes, selected, v, ctx) {
    const grid = timeTicks(v.time, ctx);
    const s = num(v, 'strength', 100) / 100;
    return mapChosen(notes, selected, (n) => {
      const end = n.start + n.length;
      n.start += (Math.round(n.start / grid) * grid - n.start) * s;
      if (bool(v, 'ends')) {
        const e = end + (Math.round(end / grid) * grid - end) * s;
        n.length = Math.max(1, e - n.start);
      }
    });
  },
};

/** Quick quantize (Ctrl+Q): starts and ends to the snap; start times only (Shift+Q). */
export function quickQuantize(notes: readonly Note[], selected: ReadonlySet<Id>, grid: number, ends: boolean): Note[] {
  return quantize.apply(notes, selected, { time: String(Math.max(1, grid)), strength: 100, ends }, { grid, beatsPerBar: 4, patternLength: 0, scale: null, position: 0 });
}

const chop: NoteTool = {
  id: 'chop',
  label: 'Chop…',
  shortcut: 'Alt+U',
  description: 'Slices long notes into shorter ones.',
  params: [
    { kind: 'choice', key: 'time', label: 'Time', options: TIME_OPTIONS, def: 'snap' },
    { kind: 'number', key: 'gate', label: 'Gate', min: 5, max: 100, def: 100, format: pct },
  ],
  apply(notes, selected, v, ctx) {
    const step = timeTicks(v.time, ctx);
    const gate = num(v, 'gate', 100) / 100;
    const pick = chosen(notes, selected);
    const out: Note[] = [];
    for (const n of notes) {
      if (!pick(n) || n.length <= step) {
        out.push(n);
        continue;
      }
      for (let t = 0, first = true; t < n.length; t += step, first = false) {
        const len = Math.min(step, n.length - t);
        out.push({ ...n, id: first ? n.id : makeId('n'), start: n.start + t, length: Math.max(1, Math.round(len * gate)) });
      }
    }
    return sorted(out);
  },
};

/** Quick chop (Ctrl+U): slices long notes by the snap. */
export function quickChop(notes: readonly Note[], selected: ReadonlySet<Id>, grid: number): Note[] {
  return chop.apply(notes, selected, { time: String(Math.max(1, grid)), gate: 100 }, { grid, beatsPerBar: 4, patternLength: 0, scale: null, position: 0 });
}

/** Glue (Ctrl+G): joins touching or overlapping notes of the same key (and colour group). */
export function glue(notes: readonly Note[], selected: ReadonlySet<Id>): Note[] {
  const pick = chosen(notes, selected);
  const rest = notes.filter((n) => !pick(n));
  const byKey = new Map<string, Note[]>();
  for (const n of notes) {
    if (!pick(n)) continue;
    const k = `${n.key}:${n.color ?? 0}`;
    const list = byKey.get(k);
    if (list) list.push(n);
    else byKey.set(k, [n]);
  }
  const out = [...rest];
  for (const list of byKey.values()) {
    list.sort((a, b) => a.start - b.start);
    let cur: Note | null = null;
    for (const n of list) {
      if (cur && n.start <= cur.start + cur.length) {
        cur.length = Math.max(cur.length, n.start + n.length - cur.start);
      } else {
        cur = clone(n);
        out.push(cur);
      }
    }
  }
  return sorted(out);
}

const ARP_PATTERNS = [
  { value: 'up', label: 'Up' },
  { value: 'down', label: 'Down' },
  { value: 'upDown', label: 'Up and down' },
  { value: 'downUp', label: 'Down and up' },
  { value: 'random', label: 'Random' },
] as const;

/** One cycle of arpeggio keys for a chord (also used by the channel arpeggiator). */
export function arpSequence(keys: readonly number[], pattern: string, range: number): number[] {
  const base = [...keys].sort((a, b) => a - b);
  const up: number[] = [];
  for (let o = 0; o < Math.max(1, range); o++) for (const k of base) if (k + 12 * o <= 127) up.push(k + 12 * o);
  if (up.length <= 1) return up;
  const down = [...up].reverse();
  switch (pattern) {
    case 'down':
      return down;
    case 'upDown':
      return [...up, ...down.slice(1, -1)];
    case 'downUp':
      return [...down, ...up.slice(1, -1)];
    default:
      return up;
  }
}

const arpeggiate: NoteTool = {
  id: 'arpeggiate',
  label: 'Arpeggiate…',
  shortcut: 'Alt+A',
  description: 'Turns chords into arpeggios.',
  params: [
    { kind: 'choice', key: 'pattern', label: 'Pattern', options: ARP_PATTERNS, def: 'up' },
    { kind: 'choice', key: 'time', label: 'Time', options: TIME_OPTIONS, def: String(TICKS_PER_STEP) },
    { kind: 'number', key: 'gate', label: 'Gate', min: 5, max: 100, def: 80, format: pct },
    { kind: 'number', key: 'range', label: 'Range (octaves)', min: 1, max: 4, def: 1, integer: true, format: int },
  ],
  apply(notes, selected, v, ctx) {
    const step = timeTicks(v.time, ctx);
    const gate = num(v, 'gate', 80) / 100;
    const pattern = str(v, 'pattern', 'up');
    const pick = chosen(notes, selected);
    const out = notes.filter((n) => !pick(n));
    for (const chord of chords(notes.filter(pick))) {
      const start = chord[0].start;
      const end = Math.max(...chord.map((n) => n.start + n.length));
      const seq = arpSequence(chord.map((n) => n.key), pattern, Math.round(num(v, 'range', 1)));
      const rnd = random(start + 1);
      const style = chord[0];
      for (let t = start, i = 0; t < end; t += step, i++) {
        const key = pattern === 'random' ? seq[Math.floor(rnd() * seq.length)] : seq[i % seq.length];
        const source = chord.find((n) => n.key % 12 === key % 12) ?? style;
        out.push({ ...source, id: i === 0 ? style.id : makeId('n'), key, start: t, length: Math.max(1, Math.round(Math.min(step, end - t) * gate)) });
      }
    }
    return sorted(out);
  },
};

/** Exponential curve 0..1 → 0..1 bent by `tension` (-1..1), 0 = linear. */
export function tensionCurve(x: number, tension: number): number {
  if (Math.abs(tension) < 1e-6) return x;
  const k = tension * 5;
  return (Math.exp(k * x) - 1) / (Math.exp(k) - 1);
}

const strum: NoteTool = {
  id: 'strum',
  label: 'Strum…',
  shortcut: 'Alt+S',
  description: 'Staggers the notes of chords like a strummed guitar.',
  params: [
    { kind: 'number', key: 'time', label: 'Time', min: 0, max: 96, def: 12, integer: true, format: ticks },
    { kind: 'number', key: 'tension', label: 'Tension', min: -1, max: 1, def: 0, bipolar: true, format: (x) => x.toFixed(2) },
    {
      kind: 'choice',
      key: 'direction',
      label: 'Direction',
      options: [
        { value: 'up', label: 'Up (low to high)' },
        { value: 'down', label: 'Down (high to low)' },
        { value: 'alternate', label: 'Alternate' },
      ],
      def: 'up',
    },
    { kind: 'number', key: 'velocity', label: 'Velocity fade', min: 0, max: 100, def: 0, format: pct },
    { kind: 'bool', key: 'keepEnds', label: 'Keep note ends', def: true },
  ],
  apply(notes, selected, v) {
    const time = num(v, 'time', 12);
    const tension = num(v, 'tension');
    const fade = num(v, 'velocity') / 100;
    const direction = str(v, 'direction', 'up');
    const pick = chosen(notes, selected);
    const out = notes.filter((n) => !pick(n));
    chords(notes.filter(pick)).forEach((chord, ci) => {
      const down = direction === 'down' || (direction === 'alternate' && ci % 2 === 1);
      const order = down ? [...chord].reverse() : chord;
      order.forEach((n, i) => {
        const x = order.length > 1 ? i / (order.length - 1) : 0;
        const c = clone(n);
        const end = n.start + n.length;
        c.start = n.start + Math.round(time * tensionCurve(x, tension));
        c.length = bool(v, 'keepEnds') ? Math.max(1, end - c.start) : n.length;
        c.velocity = Math.max(0, n.velocity * (1 - fade * x));
        out.push(c);
      });
    });
    return sorted(out);
  },
};

const flam: NoteTool = {
  id: 'flam',
  label: 'Flam…',
  shortcut: 'Alt+F',
  description: 'Adds a quieter grace note just before each note.',
  params: [
    { kind: 'number', key: 'time', label: 'Time', min: 1, max: 48, def: 6, integer: true, format: ticks },
    { kind: 'number', key: 'velocity', label: 'Velocity', min: 0, max: 100, def: 60, format: pct },
    { kind: 'number', key: 'pitch', label: 'Pitch', min: -12, max: 12, def: 0, integer: true, bipolar: true, format: (x) => `${x > 0 ? '+' : ''}${Math.round(x)} st` },
  ],
  apply(notes, selected, v) {
    const time = Math.round(num(v, 'time', 6));
    const pick = chosen(notes, selected);
    const out = [...notes];
    for (const n of notes) {
      if (!pick(n) || n.start - time < 0) continue;
      out.push({ ...n, id: makeId('n'), key: clampKey(n.key + num(v, 'pitch')), start: n.start - time, length: Math.min(time, n.length), velocity: n.velocity * (num(v, 'velocity', 60) / 100) });
    }
    return sorted(out);
  },
};

const clawMachine: NoteTool = {
  id: 'claw',
  label: 'Claw machine…',
  shortcut: 'Alt+W',
  description: 'Removes notes (or chords) in a repeating keep/remove pattern, optionally closing the gaps.',
  params: [
    { kind: 'number', key: 'keep', label: 'Keep', min: 1, max: 16, def: 1, integer: true, format: int },
    { kind: 'number', key: 'remove', label: 'Remove', min: 0, max: 16, def: 1, integer: true, format: int },
    { kind: 'number', key: 'offset', label: 'Offset', min: 0, max: 15, def: 0, integer: true, format: int },
    { kind: 'bool', key: 'close', label: 'Close the gaps', def: false },
  ],
  apply(notes, selected, v) {
    const keep = Math.max(1, Math.round(num(v, 'keep', 1)));
    const cycle = keep + Math.max(0, Math.round(num(v, 'remove', 1)));
    const offset = Math.round(num(v, 'offset'));
    const pick = chosen(notes, selected);
    const out = notes.filter((n) => !pick(n));
    const groups = chords(notes.filter(pick));
    let shift = 0;
    groups.forEach((g, i) => {
      const next = groups[i + 1];
      const slot = next ? next[0].start - g[0].start : Math.max(...g.map((n) => n.length));
      if ((i + offset) % cycle < keep) {
        for (const n of g) out.push({ ...n, start: n.start - shift });
      } else if (bool(v, 'close')) {
        shift += slot;
      }
    });
    return sorted(out);
  },
};

const limit: NoteTool = {
  id: 'limit',
  label: 'Limit…',
  shortcut: 'Alt+K',
  description: 'Keeps notes inside a key range, moving them by octaves (or clamping them).',
  params: [
    { kind: 'number', key: 'low', label: 'Lowest key', min: 0, max: 127, def: 48, integer: true, format: (k) => noteName(Math.round(k)) },
    { kind: 'number', key: 'high', label: 'Highest key', min: 0, max: 127, def: 84, integer: true, format: (k) => noteName(Math.round(k)) },
    {
      kind: 'choice',
      key: 'mode',
      label: 'Mode',
      options: [
        { value: 'octave', label: 'Transpose by octaves' },
        { value: 'clamp', label: 'Clamp to the range' },
      ],
      def: 'octave',
    },
  ],
  apply(notes, selected, v) {
    const low = Math.round(Math.min(num(v, 'low', 48), num(v, 'high', 84)));
    const high = Math.round(Math.max(num(v, 'low', 48), num(v, 'high', 84)));
    const clamp = str(v, 'mode') === 'clamp';
    return mapChosen(notes, selected, (n) => {
      if (!clamp) {
        while (n.key < low && n.key + 12 <= 127) n.key += 12;
        while (n.key > high && n.key - 12 >= 0) n.key -= 12;
      }
      n.key = Math.min(high, Math.max(low, n.key));
    });
  },
};

const flip: NoteTool = {
  id: 'flip',
  label: 'Flip…',
  shortcut: 'Alt+Y',
  description: 'Mirrors the notes in time (horizontally) or in pitch (vertically).',
  params: [
    {
      kind: 'choice',
      key: 'direction',
      label: 'Flip',
      options: [
        { value: 'horizontal', label: 'Horizontally (reverse)' },
        { value: 'vertical', label: 'Vertically (invert pitch)' },
        { value: 'both', label: 'Both' },
      ],
      def: 'horizontal',
    },
  ],
  apply(notes, selected, v) {
    const pick = chosen(notes, selected);
    const set = notes.filter(pick);
    if (set.length === 0) return [...notes];
    const t0 = Math.min(...set.map((n) => n.start));
    const t1 = Math.max(...set.map((n) => n.start + n.length));
    const k0 = Math.min(...set.map((n) => n.key));
    const k1 = Math.max(...set.map((n) => n.key));
    const dir = str(v, 'direction', 'horizontal');
    return mapChosen(notes, selected, (n) => {
      if (dir !== 'vertical') n.start = t0 + t1 - (n.start + n.length);
      if (dir !== 'horizontal') n.key = k0 + k1 - n.key;
    });
  },
};

const randomize: NoteTool = {
  id: 'randomize',
  label: 'Randomize…',
  shortcut: 'Alt+R',
  description: 'Humanizes timing, length and levels.',
  params: [
    { kind: 'number', key: 'time', label: 'Start time ±', min: 0, max: 48, def: 0, integer: true, format: ticks },
    { kind: 'number', key: 'length', label: 'Length ±', min: 0, max: 100, def: 0, format: pct },
    { kind: 'number', key: 'velocity', label: 'Velocity ±', min: 0, max: 100, def: 20, format: pct },
    { kind: 'number', key: 'pan', label: 'Pan ±', min: 0, max: 100, def: 0, format: pct },
    { kind: 'number', key: 'fine', label: 'Fine pitch ±', min: 0, max: 100, def: 0, integer: true, format: (x) => `${Math.round(x)} cents` },
    { kind: 'number', key: 'seed', label: 'Seed', min: 1, max: 999, def: 1, integer: true, format: int },
  ],
  apply(notes, selected, v) {
    const rnd = random(num(v, 'seed', 1));
    const r = () => rnd() * 2 - 1;
    return mapChosen(notes, selected, (n) => {
      const dt = r() * num(v, 'time');
      const dl = r() * (num(v, 'length') / 100);
      const dv = r() * (num(v, 'velocity', 20) / 100);
      const dp = r() * (num(v, 'pan') / 100);
      const df = r() * num(v, 'fine');
      n.start += dt;
      n.length *= 1 + dl;
      setNoteValue(n, 'velocity', n.velocity + dv);
      if (dp !== 0) setNoteValue(n, 'pan', noteValue(n, 'pan') + dp);
      if (df !== 0) setNoteValue(n, 'fine', noteValue(n, 'fine') + df);
    });
  },
};

const scaleLevels: NoteTool = {
  id: 'scaleLevels',
  label: 'Scale levels…',
  shortcut: 'Alt+X',
  description: 'Multiplies, offsets or inverts a note property.',
  params: [
    { kind: 'choice', key: 'property', label: 'Property', options: propOptions, def: 'velocity' },
    { kind: 'number', key: 'scale', label: 'Scale', min: 0, max: 200, def: 100, format: pct },
    { kind: 'number', key: 'offset', label: 'Offset', min: -100, max: 100, def: 0, bipolar: true, format: pct },
    {
      kind: 'choice',
      key: 'center',
      label: 'Centre',
      options: [
        { value: 'default', label: 'Default value' },
        { value: 'average', label: 'Average' },
        { value: 'zero', label: 'Minimum of the range' },
      ],
      def: 'default',
    },
    { kind: 'bool', key: 'invert', label: 'Invert', def: false },
  ],
  apply(notes, selected, v) {
    const key = str(v, 'property', 'velocity') as NotePropKey;
    const spec = notePropSpec(key);
    const pick = chosen(notes, selected);
    const set = notes.filter(pick);
    const average = set.length ? set.reduce((s, n) => s + noteValue(n, key), 0) / set.length : spec.def;
    const centerMode = str(v, 'center', 'default');
    const center = centerMode === 'average' ? average : centerMode === 'zero' ? spec.min : spec.def;
    const range = spec.max - spec.min;
    return mapChosen(notes, selected, (n) => {
      let x = center + (noteValue(n, key) - center) * (num(v, 'scale', 100) / 100) + (num(v, 'offset') / 100) * range;
      if (bool(v, 'invert')) x = spec.min + spec.max - x;
      setNoteValue(n, key, x);
    });
  },
};

const articulate: NoteTool = {
  id: 'articulate',
  label: 'Articulate…',
  shortcut: 'Alt+L',
  description: 'Changes note lengths: staccato, portato, legato.',
  params: [
    {
      kind: 'choice',
      key: 'mode',
      label: 'Mode',
      options: [
        { value: 'relative', label: 'Relative to the length' },
        { value: 'legato', label: 'Legato (until the next note)' },
        { value: 'fixed', label: 'Fixed length' },
      ],
      def: 'relative',
    },
    { kind: 'number', key: 'amount', label: 'Length', min: 5, max: 200, def: 50, format: pct },
    { kind: 'choice', key: 'time', label: 'Fixed length', options: TIME_OPTIONS, def: 'snap' },
  ],
  apply(notes, selected, v, ctx) {
    // Relative: a share of each note's length; legato: of the gap to the next note; fixed: of a fixed length.
    const mode = str(v, 'mode', 'relative');
    const amount = num(v, 'amount', 50) / 100;
    const pick = chosen(notes, selected);
    const starts = [...new Set(notes.filter(pick).map((n) => n.start))].sort((a, b) => a - b);
    return mapChosen(notes, selected, (n) => {
      if (mode === 'legato') {
        const next = starts.find((t) => t > n.start);
        n.length = ((next ?? n.start + n.length) - n.start) * amount;
      } else if (mode === 'fixed') {
        n.length = timeTicks(v.time, ctx) * amount;
      } else {
        n.length *= amount;
      }
    });
  },
};

const LFO_SHAPES = [
  { value: 'sine', label: 'Sine' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'square', label: 'Square' },
  { value: 'saw', label: 'Saw' },
] as const;

export function lfoShape(shape: string, phase: number): number {
  const p = phase - Math.floor(phase);
  switch (shape) {
    case 'triangle':
      return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
    case 'square':
      return p < 0.5 ? 1 : -1;
    case 'saw':
      return 2 * p - 1;
    default:
      return Math.sin(2 * Math.PI * p);
  }
}

const lfo: NoteTool = {
  id: 'lfo',
  label: 'LFO…',
  shortcut: 'Alt+O',
  description: 'Shapes a note property with an LFO over time.',
  params: [
    { kind: 'choice', key: 'property', label: 'Property', options: propOptions, def: 'velocity' },
    { kind: 'choice', key: 'shape', label: 'Shape', options: LFO_SHAPES, def: 'sine' },
    { kind: 'choice', key: 'time', label: 'Period', options: TIME_OPTIONS, def: 'bar' },
    { kind: 'number', key: 'amount', label: 'Amount', min: 0, max: 100, def: 50, format: pct },
    { kind: 'number', key: 'phase', label: 'Phase', min: 0, max: 100, def: 0, format: pct },
    {
      kind: 'choice',
      key: 'center',
      label: 'Centre',
      options: [
        { value: 'middle', label: 'Middle of the range' },
        { value: 'current', label: 'Each note’s value' },
      ],
      def: 'middle',
    },
  ],
  apply(notes, selected, v, ctx) {
    const key = str(v, 'property', 'velocity') as NotePropKey;
    const spec = notePropSpec(key);
    const period = timeTicks(v.time, ctx);
    const amount = (num(v, 'amount', 50) / 100) * ((spec.max - spec.min) / 2);
    const phase = num(v, 'phase') / 100;
    const shape = str(v, 'shape', 'sine');
    const current = str(v, 'center') === 'current';
    return mapChosen(notes, selected, (n) => {
      const center = current ? noteValue(n, key) : (spec.min + spec.max) / 2;
      setNoteValue(n, key, center + amount * lfoShape(shape, n.start / period + phase));
    });
  },
};

const PROGRESSIONS = [
  { value: '0,4,5,3', label: 'I – V – vi – IV' },
  { value: '0,5,3,4', label: 'I – vi – IV – V' },
  { value: '5,3,0,4', label: 'vi – IV – I – V' },
  { value: '1,4,0,0', label: 'ii – V – I' },
  { value: '0,3,4,0', label: 'I – IV – V – I' },
  { value: '0,6,5,4', label: 'i – VII – VI – V (minor)' },
  { value: '0,3,0,4', label: 'I – IV – I – V' },
] as const;

const chordProgression: NoteTool = {
  id: 'chords',
  label: 'Generate chord progression…',
  shortcut: 'Alt+P',
  description: 'Writes a chord progression in a key from the last clicked position.',
  params: [
    { kind: 'choice', key: 'root', label: 'Key', options: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map((n, i) => ({ value: String(i), label: n })), def: '0' },
    {
      kind: 'choice',
      key: 'scale',
      label: 'Scale',
      options: [
        { value: 'major', label: 'Major' },
        { value: 'minor', label: 'Minor' },
        { value: 'dorian', label: 'Dorian' },
        { value: 'mixolydian', label: 'Mixolydian' },
        { value: 'harmonicMinor', label: 'Harmonic minor' },
      ],
      def: 'major',
    },
    { kind: 'choice', key: 'progression', label: 'Progression', options: PROGRESSIONS, def: '0,4,5,3' },
    { kind: 'choice', key: 'time', label: 'Chord length', options: TIME_OPTIONS, def: 'bar' },
    { kind: 'number', key: 'octave', label: 'Octave', min: 2, max: 7, def: 5, integer: true, format: (o) => `C${Math.round(o)}` },
    {
      kind: 'choice',
      key: 'voicing',
      label: 'Chords',
      options: [
        { value: '3', label: 'Triads' },
        { value: '4', label: 'Sevenths' },
      ],
      def: '3',
    },
    { kind: 'number', key: 'velocity', label: 'Velocity', min: 1, max: 127, def: 100, integer: true, format: int },
  ],
  apply(notes, _selected, v, ctx) {
    const scale: ScaleSpec = { root: Number(str(v, 'root', '0')) || 0, type: str(v, 'scale', 'major') as ScaleType };
    const tonic = 12 * Math.round(num(v, 'octave', 5)) + scale.root;
    const len = timeTicks(v.time, ctx);
    const size = Number(str(v, 'voicing', '3'));
    const out = [...notes];
    str(v, 'progression', '0,4,5,3')
      .split(',')
      .map(Number)
      .forEach((degree, i) => {
        for (let k = 0; k < size; k++) {
          const key = scaleDegreeKey(scale, tonic, degree + 2 * k);
          if (key > 127) continue;
          out.push({ id: makeId('n'), key, start: ctx.position + i * len, length: len, velocity: num(v, 'velocity', 100) / 127 });
        }
      });
    return sorted(out);
  },
};

const riffMachine: NoteTool = {
  id: 'riff',
  label: 'Riff machine…',
  shortcut: 'Alt+E',
  description: 'Generates a riff from the chosen chords (or the scale).',
  params: [
    { kind: 'choice', key: 'time', label: 'Note grid', options: TIME_OPTIONS, def: String(TICKS_PER_STEP) },
    { kind: 'number', key: 'bars', label: 'Bars', min: 1, max: 8, def: 2, integer: true, format: int },
    { kind: 'number', key: 'density', label: 'Density', min: 10, max: 100, def: 60, format: pct },
    { kind: 'number', key: 'range', label: 'Range (octaves)', min: 1, max: 3, def: 1, integer: true, format: int },
    { kind: 'number', key: 'octave', label: 'Octave', min: 2, max: 7, def: 5, integer: true, format: (o) => `C${Math.round(o)}` },
    { kind: 'number', key: 'seed', label: 'Seed', min: 1, max: 999, def: 1, integer: true, format: int },
    { kind: 'bool', key: 'replace', label: 'Replace the chosen notes', def: true },
  ],
  apply(notes, selected, v, ctx) {
    const rnd = random(num(v, 'seed', 1) * 7.31);
    const grid = timeTicks(v.time, ctx);
    const pick = chosen(notes, selected);
    const source = notes.filter(pick);
    const start = source.length ? Math.min(...source.map((n) => n.start)) : ctx.position;
    const end = start + Math.round(num(v, 'bars', 2)) * ticksPerBar(ctx.beatsPerBar);
    const scale = ctx.scale ?? { root: 0, type: 'minorPentatonic' as ScaleType };
    const tonic = 12 * Math.round(num(v, 'octave', 5)) + scale.root;
    const range = Math.round(num(v, 'range', 1));
    const scaleKeys: number[] = [];
    for (let d = 0; d < scaleSteps(scale.type).length * range; d++) scaleKeys.push(scaleDegreeKey(scale, tonic, d));
    const out = bool(v, 'replace') && source.length ? notes.filter((n) => !pick(n)) : [...notes];
    let prev = -1;
    for (let t = start; t < end; t += grid) {
      if (rnd() > num(v, 'density', 60) / 100) continue;
      // Pitches of the chord sounding at this time (from the chosen notes), else the scale.
      const sounding = source.filter((n) => n.start <= t && t < n.start + n.length).map((n) => n.key);
      const pool = sounding.length ? arpSequence(sounding, 'up', range) : scaleKeys;
      // Prefer small steps from the previous note, like a played line.
      let key = pool[Math.floor(rnd() * pool.length)];
      if (prev >= 0 && rnd() < 0.6) key = pool.reduce((best, k) => (Math.abs(k - prev) < Math.abs(best - prev) && k !== prev ? k : best), key);
      prev = key;
      const steps = rnd() < 0.7 ? 1 : 2;
      out.push({ id: makeId('n'), key, start: t, length: Math.max(1, Math.min(steps * grid, end - t) - 1), velocity: 0.6 + rnd() * 0.3 });
    }
    return sorted(out);
  },
};

/** The tools of the piano roll's Tools menu (FL Studio order). */
export const NOTE_TOOLS: readonly NoteTool[] = [
  riffMachine,
  chordProgression,
  articulate,
  quantize,
  chop,
  arpeggiate,
  strum,
  flam,
  clawMachine,
  limit,
  flip,
  randomize,
  scaleLevels,
  lfo,
];

export function findTool(id: string): NoteTool | undefined {
  return NOTE_TOOLS.find((t) => t.id === id);
}

/** Parameter defaults; the chord progression starts in the project's scale when it has one. */
export function defaultToolValues(tool: NoteTool, ctx: ToolContext): ToolValues {
  const v: ToolValues = {};
  for (const p of tool.params) v[p.key] = p.def;
  if (tool.id === 'chords' && ctx.scale) {
    v.root = String(ctx.scale.root);
    const scaleParam = tool.params.find((p) => p.key === 'scale');
    if (scaleParam?.kind === 'choice' && scaleParam.options.some((o) => o.value === ctx.scale!.type)) v.scale = ctx.scale.type;
    else if (ctx.scale.type === 'minorPentatonic' || ctx.scale.type === 'blues') v.scale = 'minor';
  }
  return v;
}

/** Notes of a stamp (chord or scale) with its lowest note at `key`. */
export function stampNotes(intervals: readonly number[], key: number, start: number, length: number, template: Omit<Note, 'id' | 'key' | 'start' | 'length'>): Omit<Note, 'id'>[] {
  return intervals.filter((i) => key + i <= 127).map((i) => ({ ...template, key: key + i, start, length }));
}

export { CHORDS };
