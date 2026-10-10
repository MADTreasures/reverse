/**
 * Note properties (FL Studio: Note properties window, piano roll event lanes, graph editor) and the
 * maths both audio engines share for them. The native engine implements the same formulas
 * (engine/src/engine/Instruments.cpp, NoteShaping); keep the two in sync.
 */
import { DEFAULT_VELOCITY } from './defaults';
import type { Note } from './types';

/** Note values shown in the event lanes and the note properties window. */
export type NotePropKey = 'velocity' | 'release' | 'pan' | 'fine' | 'modX' | 'modY';
/** Optional note values (velocity is always stored). */
export type OptionalNotePropKey = Exclude<NotePropKey, 'velocity'>;

export interface NotePropSpec {
  key: NotePropKey;
  /** Short name (knobs, menus). */
  label: string;
  /** Event lane title (FL Studio: "Note fine pitch" etc.). */
  lane: string;
  min: number;
  max: number;
  def: number;
  /** Drawn from the centre line instead of the bottom. */
  bipolar: boolean;
  /** Mouse wheel / arrow step. */
  step: number;
  format: (v: number) => string;
}

export const NOTE_DEFAULTS: Record<OptionalNotePropKey, number> = { release: 0.5, pan: 0, fine: 0, modX: 0.5, modY: 0.5 };

const percentAround = (v: number) => {
  const p = Math.round((v - 0.5) * 200);
  return p === 0 ? 'Centred' : `${p > 0 ? '+' : ''}${p}%`;
};

export function formatPan(v: number): string {
  const p = Math.round(Math.abs(v) * 100);
  if (p === 0) return 'Centred';
  return `${p}% ${v < 0 ? 'left' : 'right'}`;
}

export function formatCents(v: number): string {
  const c = Math.round(v);
  return c === 0 ? '0 cents' : `${c > 0 ? '+' : ''}${c} cents`;
}

export const NOTE_PROPS: readonly NotePropSpec[] = [
  { key: 'velocity', label: 'Velocity', lane: 'Note velocity', min: 0, max: 1, def: DEFAULT_VELOCITY, bipolar: false, step: 4 / 128, format: (v) => String(Math.round(v * 127)) },
  { key: 'release', label: 'Release', lane: 'Note release velocity', min: 0, max: 1, def: 0.5, bipolar: false, step: 4 / 128, format: (v) => String(Math.round(v * 127)) },
  { key: 'pan', label: 'Pan', lane: 'Note panning', min: -1, max: 1, def: 0, bipolar: true, step: 0.04, format: formatPan },
  { key: 'fine', label: 'Fine pitch', lane: 'Note fine pitch', min: -1200, max: 1200, def: 0, bipolar: true, step: 5, format: formatCents },
  { key: 'modX', label: 'Mod X', lane: 'Note mod X (filter cutoff)', min: 0, max: 1, def: 0.5, bipolar: true, step: 0.02, format: percentAround },
  { key: 'modY', label: 'Mod Y', lane: 'Note mod Y (filter resonance)', min: 0, max: 1, def: 0.5, bipolar: true, step: 0.02, format: percentAround },
];

export function notePropSpec(key: NotePropKey): NotePropSpec {
  return NOTE_PROPS.find((s) => s.key === key) ?? NOTE_PROPS[0];
}

export function noteValue(n: Note, key: NotePropKey): number {
  if (key === 'velocity') return n.velocity;
  return n[key] ?? NOTE_DEFAULTS[key];
}

/** Sets a note value (clamped); optional values equal to their default are removed. */
export function setNoteValue(n: Note, key: NotePropKey, value: number): void {
  const spec = notePropSpec(key);
  const v = Math.min(spec.max, Math.max(spec.min, Number.isFinite(value) ? value : spec.def));
  if (key === 'velocity') {
    n.velocity = v;
    return;
  }
  const rounded = key === 'fine' ? Math.round(v) : v;
  if (Math.abs(rounded - NOTE_DEFAULTS[key]) < 1e-9) delete n[key];
  else n[key] = rounded;
}

/** Number of note colour groups (FL Studio: 16, appearing to plugins as MIDI channels 1..16). */
export const NOTE_COLOR_COUNT = 16;

/** Display colour of a note: group 0 uses the channel colour, the others a fixed hue each. */
export function noteColor(group: number | undefined, channelColor: string): string {
  if (!group) return channelColor;
  const hue = (196 + (group - 1) * 24) % 360;
  return `hsl(${hue}, 62%, 62%)`;
}

/** Optional properties new notes get (the piano roll's note template). */
export type NoteStyle = Partial<Record<OptionalNotePropKey, number>>;

/** The optional note values of a note (pan, release, fine pitch, Mod X/Y) that differ from their default. */
export function noteStyleOf(n: Note): NoteStyle {
  const style: NoteStyle = {};
  for (const key of Object.keys(NOTE_DEFAULTS) as OptionalNotePropKey[]) if (n[key] !== undefined) style[key] = n[key];
  return style;
}

/** Copies the note properties of `from` (everything except id, key, start and length). */
export function noteStyle(from: Note): Omit<Note, 'id' | 'key' | 'start' | 'length'> {
  const { id: _id, key: _key, start: _start, length: _length, ...style } = from;
  return style;
}

// ---------------------------------------------------------------------------------------------
// Sound shaping shared by both engines

/** Mod X 1.0 raises the synth filter cutoff by this many octaves (0.0 lowers it as much). */
export const MOD_X_OCTAVES = 4;
/** Mod Y 1.0 multiplies the synth filter resonance by this (0.0 divides it). */
export const MOD_Y_RANGE = 4;
/** Resonance after Mod Y never exceeds this (keeps extreme settings from blowing up). */
export const MAX_NOTE_RESONANCE = 24;
/** Default glide time of portamento notes in seconds (until channels get their own setting). */
export const DEFAULT_GLIDE_TIME = 0.1;

export function modXFactor(modX: number | undefined): number {
  return modX === undefined ? 1 : Math.pow(2, (modX - 0.5) * 2 * MOD_X_OCTAVES);
}

export function noteResonance(resonance: number, modY: number | undefined): number {
  if (modY === undefined || modY === 0.5) return resonance;
  return Math.min(MAX_NOTE_RESONANCE, resonance * Math.pow(MOD_Y_RANGE, (modY - 0.5) * 2));
}

/** Release velocity scales the envelope release: 0.5 keeps it, 1.0 doubles it, 0.0 halves it. */
export function releaseScale(release: number | undefined): number {
  return release === undefined ? 1 : Math.pow(2, (release - 0.5) * 2);
}

/** Slide bends a note can carry (the native engine's fixed limit). */
export const MAX_NOTE_BENDS = 8;

/** Pitch movement of a sounding note caused by slide notes, relative to the note's start. */
export interface PitchBend {
  /** Ticks after the note start. */
  at: number;
  /** Ticks the glide takes. */
  length: number;
  /** Target pitch in semitones relative to the note's key. */
  to: number;
}

/** A breakpoint of a note's pitch curve: `t` seconds after the note start, `v` semitones from its key. */
export interface PitchPoint {
  t: number;
  v: number;
}

/**
 * The pitch curve of a note: a portamento glide from `glideFrom` semitones to 0 over `glideTime`
 * seconds, then the slide bends (ticks converted with `spt` seconds per tick). Piecewise linear in
 * semitones, holding the last value. Returns null when the pitch never moves.
 */
export function pitchCurve(glideFrom: number | undefined, glideTime: number | undefined, bends: readonly PitchBend[] | undefined, spt: number): PitchPoint[] | null {
  const from = glideFrom ?? 0;
  const time = glideTime ?? DEFAULT_GLIDE_TIME;
  const glide = from !== 0 && time > 0;
  if (!glide && (!bends || bends.length === 0)) return null;
  let points: PitchPoint[] = [{ t: 0, v: glide ? from : 0 }];
  if (glide) points.push({ t: time, v: 0 });
  for (const b of bends ?? []) {
    const ts = Math.max(0, b.at * spt);
    const te = ts + Math.max(0, b.length * spt);
    const from = pitchAt(points, ts);
    // A new bend takes over from wherever the pitch is at its start.
    points = points.filter((p) => p.t < ts);
    points.push({ t: ts, v: from }, { t: te, v: b.to });
  }
  return points;
}

/** Value of a pitch curve at `t` seconds (before the first point: its value; after the last: held). */
export function pitchAt(points: readonly PitchPoint[], t: number): number {
  if (points.length === 0) return 0;
  if (t <= points[0].t) return points[0].v;
  for (let i = 1; i < points.length; i++) {
    const b = points[i];
    if (t < b.t) {
      const a = points[i - 1];
      return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
    }
  }
  return points[points.length - 1].v;
}

/** Lowest pitch (semitones) a curve reaches. */
export function minPitch(points: readonly PitchPoint[] | null | undefined): number {
  if (!points || points.length === 0) return 0;
  return Math.min(...points.map((p) => p.v));
}
