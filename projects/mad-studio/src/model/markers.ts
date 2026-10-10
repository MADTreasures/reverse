/**
 * Playlist time markers and time signature changes (FL Studio: Playlist menu › Time markers, Alt+T,
 * Shift+Alt+T). A time signature marker starts a new bar at its position; bar numbers, the playlist's
 * bar lines, the position display and the metronome of both engines follow the signature map.
 */
import { makeId } from './ids';
import { PPQ, TICKS_PER_STEP } from './timing';
import type { Id, Project, TimeMarker } from './types';

export const MARKER_ACTIONS = [
  { value: 'none', label: 'None' },
  { value: 'start', label: 'Start' },
  { value: 'timeSignature', label: 'Time signature' },
] as const;

export type MarkerAction = (typeof MARKER_ACTIONS)[number]['value'];

/** Time signature numerators and denominators FL Studio offers. */
export const SIGNATURE_NUMERATORS = Array.from({ length: 16 }, (_, i) => i + 1);
export const SIGNATURE_DENOMINATORS = [2, 4, 8, 16] as const;

export interface Signature {
  tick: number;
  numerator: number;
  denominator: number;
}

export function markerAction(m: TimeMarker): MarkerAction {
  return m.action ?? 'none';
}

export function sortedMarkers(project: Pick<Project, 'markers'>): TimeMarker[] {
  return [...(project.markers ?? [])].sort((a, b) => a.tick - b.tick);
}

export function createMarker(tick: number, name: string, action: MarkerAction = 'none', signature?: { numerator: number; denominator: number }): TimeMarker {
  const m: TimeMarker = { id: makeId('mk'), tick: Math.max(0, Math.round(tick)), name };
  if (action !== 'none') m.action = action;
  if (action === 'timeSignature' && signature) {
    m.numerator = signature.numerator;
    m.denominator = signature.denominator;
  }
  return m;
}

/** "6/8" → { numerator: 6, denominator: 8 } (null when invalid). */
export function parseSignature(text: string): { numerator: number; denominator: number } | null {
  const m = /^\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*$/.exec(text);
  if (!m) return null;
  const numerator = Number(m[1]);
  const denominator = Number(m[2]);
  if (numerator < 1 || numerator > 16 || !(SIGNATURE_DENOMINATORS as readonly number[]).includes(denominator)) return null;
  return { numerator, denominator };
}

export const beatTicks = (s: Pick<Signature, 'denominator'>) => (PPQ * 4) / s.denominator;
export const barTicks = (s: Pick<Signature, 'numerator' | 'denominator'>) => s.numerator * beatTicks(s);

/** The project's signature from tick 0 on, then every time signature marker (one per tick, sorted). */
export function signatureMap(project: Pick<Project, 'markers' | 'beatsPerBar'>): Signature[] {
  const map: Signature[] = [{ tick: 0, numerator: project.beatsPerBar, denominator: 4 }];
  for (const m of sortedMarkers(project)) {
    if (m.action !== 'timeSignature' || !m.numerator || !m.denominator) continue;
    const sig = { tick: m.tick, numerator: m.numerator, denominator: m.denominator };
    if (map[map.length - 1].tick === sig.tick) map[map.length - 1] = sig;
    else map.push(sig);
  }
  return map;
}

/** True when the map has a change (else the plain project signature applies). */
export function hasSignatureChanges(map: readonly Signature[]): boolean {
  return map.length > 1;
}

/** Index of the signature segment containing `tick`. */
function segmentAt(map: readonly Signature[], tick: number): number {
  let i = 0;
  while (i + 1 < map.length && map[i + 1].tick <= tick) i++;
  return i;
}

/** First bar index (0-based) of every segment: a change mid-bar starts a new bar. */
function firstBars(map: readonly Signature[]): number[] {
  const bars = [0];
  for (let i = 1; i < map.length; i++) bars.push(bars[i - 1] + Math.ceil((map[i].tick - map[i - 1].tick) / barTicks(map[i - 1]) - 1e-9));
  return bars;
}

/** Bar (0-based), beat (0-based) and ticks into the beat at `tick`. */
export function positionAt(map: readonly Signature[], tick: number): { bar: number; beat: number; ticks: number; signature: Signature } {
  const i = segmentAt(map, tick);
  const sig = map[i];
  const into = Math.max(0, tick - sig.tick);
  const bar = firstBars(map)[i] + Math.floor(into / barTicks(sig) + 1e-9);
  const inBar = into - Math.floor(into / barTicks(sig) + 1e-9) * barTicks(sig);
  const beat = Math.floor(inBar / beatTicks(sig) + 1e-9);
  return { bar, beat, ticks: inBar - beat * beatTicks(sig), signature: sig };
}

/** Bar lines with their (0-based) bar numbers in [from, to). */
export function barLines(map: readonly Signature[], from: number, to: number): { tick: number; bar: number }[] {
  const out: { tick: number; bar: number }[] = [];
  const bars = firstBars(map);
  for (let i = segmentAt(map, from); i < map.length; i++) {
    const sig = map[i];
    if (sig.tick >= to) break;
    const end = i + 1 < map.length ? map[i + 1].tick : Infinity;
    const len = barTicks(sig);
    for (let k = Math.max(0, Math.ceil((from - sig.tick) / len - 1e-9)); ; k++) {
      const tick = sig.tick + k * len;
      if (tick >= Math.min(end, to) - 1e-9) break;
      out.push({ tick, bar: bars[i] + k });
    }
  }
  return out;
}

/** Metronome beats in [from, to): every beat of the signature, the first of a bar accented. */
export function beatsIn(map: readonly Signature[], from: number, to: number): { tick: number; accent: boolean }[] {
  const out: { tick: number; accent: boolean }[] = [];
  for (let i = segmentAt(map, from); i < map.length; i++) {
    const sig = map[i];
    if (sig.tick >= to) break;
    const end = i + 1 < map.length ? map[i + 1].tick : Infinity;
    const len = beatTicks(sig);
    for (let k = Math.max(0, Math.ceil((from - sig.tick) / len - 1e-9)); ; k++) {
      const tick = sig.tick + k * len;
      if (tick >= Math.min(end, to) - 1e-9) break;
      out.push({ tick, accent: k % sig.numerator === 0 });
    }
  }
  return out;
}

/** BAR:STEP:TICK (1-based bar and step) following the signature map. */
export function formatSongPosition(map: readonly Signature[], tick: number): string {
  const p = positionAt(map, tick);
  const inBar = p.beat * beatTicks(p.signature) + p.ticks;
  const step = Math.floor(inBar / TICKS_PER_STEP);
  const ticks = Math.round(inBar - step * TICKS_PER_STEP);
  return `${p.bar + 1}:${String(step + 1).padStart(2, '0')}:${String(ticks).padStart(2, '0')}`;
}

/** The marker after / before `tick` (FL Studio: Alt+* / Alt+/). */
export function adjacentMarker(project: Pick<Project, 'markers'>, tick: number, direction: 1 | -1): TimeMarker | null {
  const list = sortedMarkers(project);
  if (direction > 0) return list.find((m) => m.tick > tick + 0.5) ?? null;
  return [...list].reverse().find((m) => m.tick < tick - 0.5) ?? null;
}

/** Where song playback starts: the first Start marker, else tick 0. */
export function songStartTick(project: Pick<Project, 'markers'>): number {
  return sortedMarkers(project).find((m) => m.action === 'start')?.tick ?? 0;
}

/** A new name "Marker N" that is not taken yet. */
export function nextMarkerName(project: Pick<Project, 'markers'>, base = 'Marker'): string {
  const names = new Set((project.markers ?? []).map((m) => m.name));
  for (let i = 1; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}

export function findMarker(project: Pick<Project, 'markers'>, id: Id): TimeMarker | undefined {
  return project.markers?.find((m) => m.id === id);
}
