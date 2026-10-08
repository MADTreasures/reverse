/** Musical time helpers. One beat (quarter note) has PPQ ticks, one step is a 16th. */

export const PPQ = 96;
export const STEPS_PER_BEAT = 4;
export const TICKS_PER_STEP = PPQ / STEPS_PER_BEAT;

export const MIN_BPM = 10;
export const MAX_BPM = 522;

export function ticksPerBar(beatsPerBar: number): number {
  return PPQ * beatsPerBar;
}

export function stepsPerBar(beatsPerBar: number): number {
  return STEPS_PER_BEAT * beatsPerBar;
}

export function secondsPerTick(bpm: number): number {
  return 60 / (bpm * PPQ);
}

export function ticksToSeconds(ticks: number, bpm: number): number {
  return ticks * secondsPerTick(bpm);
}

export function secondsToTicks(seconds: number, bpm: number): number {
  return seconds / secondsPerTick(bpm);
}

/** Rounds a tick count up to a whole number of bars (at least one bar). */
export function ceilToBar(ticks: number, beatsPerBar: number): number {
  const bar = ticksPerBar(beatsPerBar);
  return Math.max(bar, Math.ceil(ticks / bar) * bar);
}

export type SnapId =
  | 'main'
  | 'line'
  | 'cell'
  | 'none'
  | '1/6 step'
  | '1/4 step'
  | '1/3 step'
  | '1/2 step'
  | 'step'
  | '1/6 beat'
  | '1/4 beat'
  | '1/3 beat'
  | '1/2 beat'
  | 'beat'
  | 'bar';

/**
 * FL Studio's snap menu. "Main" follows the main snap in the toolbar; "Line" and "Cell" follow the
 * grid lines the editor currently draws, so they get finer as you zoom in.
 */
export const SNAP_OPTIONS: SnapId[] = [
  'main',
  'line',
  'cell',
  'none',
  '1/6 step',
  '1/4 step',
  '1/3 step',
  '1/2 step',
  'step',
  '1/6 beat',
  '1/4 beat',
  '1/3 beat',
  '1/2 beat',
  'beat',
  'bar',
];

/** The toolbar's main snap cannot follow itself. */
export const MAIN_SNAP_OPTIONS: SnapId[] = SNAP_OPTIONS.filter((s) => s !== 'main');

export function snapLabel(snap: SnapId): string {
  if (snap === 'none') return '(none)';
  return snap.charAt(0).toUpperCase() + snap.slice(1);
}

/** Minimum distance in pixels between the finest grid lines an editor draws. */
export const GRID_MIN_PX = 16;

/** Spacing (ticks) of the finest grid lines an editor draws at this zoom – what "Line" snaps to. */
export function gridLineTicks(pxPerTick: number, beatsPerBar: number, minPx = GRID_MIN_PX): number {
  for (const t of [3, 6, 12, TICKS_PER_STEP, PPQ / 2, PPQ]) if (t * pxPerTick >= minPx) return t;
  const bar = ticksPerBar(beatsPerBar);
  let t = bar;
  while (t * pxPerTick < minPx && t < bar * 1024) t *= 2;
  return t;
}

/**
 * Snap size in ticks. `lineTicks` is the editor's current grid spacing (for "Line"/"Cell"),
 * `mainSnap` the toolbar's main snap (for "Main").
 */
export function snapTicks(snap: SnapId, beatsPerBar: number, lineTicks = TICKS_PER_STEP, mainSnap: SnapId = 'line'): number {
  switch (snap) {
    case 'main':
      return snapTicks(mainSnap === 'main' ? 'line' : mainSnap, beatsPerBar, lineTicks);
    case 'line':
    case 'cell':
      return lineTicks;
    case 'none':
      return 1;
    case '1/6 step':
      return TICKS_PER_STEP / 6;
    case '1/4 step':
      return TICKS_PER_STEP / 4;
    case '1/3 step':
      return TICKS_PER_STEP / 3;
    case '1/2 step':
      return TICKS_PER_STEP / 2;
    case 'step':
      return TICKS_PER_STEP;
    case '1/6 beat':
      return PPQ / 6;
    case '1/4 beat':
      return PPQ / 4;
    case '1/3 beat':
      return PPQ / 3;
    case '1/2 beat':
      return PPQ / 2;
    case 'beat':
      return PPQ;
    case 'bar':
      return ticksPerBar(beatsPerBar);
  }
}

export function snapRound(tick: number, grid: number): number {
  return Math.round(tick / grid) * grid;
}

export function snapFloor(tick: number, grid: number): number {
  return Math.floor(tick / grid) * grid;
}

/** Formats a tick position as BAR:STEP:TICK (1-based bar and step). */
export function formatPosition(tick: number, beatsPerBar: number): string {
  const t = Math.max(0, Math.floor(tick));
  const bar = Math.floor(t / ticksPerBar(beatsPerBar)) + 1;
  const inBar = t % ticksPerBar(beatsPerBar);
  const step = Math.floor(inBar / TICKS_PER_STEP) + 1;
  const sub = inBar % TICKS_PER_STEP;
  return `${bar}:${String(step).padStart(2, '0')}:${String(sub).padStart(2, '0')}`;
}

/** Formats a length as BARS:STEPS:TICKS, counted from zero (FL Studio's "for 0:06:00"). */
export function formatDuration(ticks: number, beatsPerBar: number): string {
  const t = Math.max(0, Math.round(ticks));
  const bar = ticksPerBar(beatsPerBar);
  const inBar = t % bar;
  return `${Math.floor(t / bar)}:${String(Math.floor(inBar / TICKS_PER_STEP)).padStart(2, '0')}:${String(inBar % TICKS_PER_STEP).padStart(2, '0')}`;
}

/** Formats seconds as M:SS.CS (centiseconds). */
export function formatClock(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s * 100) % 100);
  return `${m}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Note name with the classic tracker octave convention where MIDI 60 is C5. */
export function noteName(key: number): string {
  return `${NOTE_NAMES[((key % 12) + 12) % 12]}${Math.floor(key / 12)}`;
}

export function isBlackKey(key: number): boolean {
  return [1, 3, 6, 8, 10].includes(((key % 12) + 12) % 12);
}

export function midiToHz(key: number): number {
  return 440 * Math.pow(2, (key - 69) / 12);
}

/** Fader/knob position (0..1) to linear gain: 0.8 is unity (0 dB), 1.0 is about +3.9 dB. */
export function volumeToGain(position: number): number {
  const p = Math.max(0, position);
  return Math.pow(p / 0.8, 2);
}

export function gainToDb(gain: number): number {
  return gain <= 0 ? -Infinity : 20 * Math.log10(gain);
}

export function formatDb(gain: number): string {
  const db = gainToDb(gain);
  if (!Number.isFinite(db)) return '-inf dB';
  return `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`;
}

export function formatPan(pan: number): string {
  if (Math.abs(pan) < 0.005) return 'Centered';
  const pct = Math.round(Math.abs(pan) * 100);
  return pan < 0 ? `${pct}% left` : `${pct}% right`;
}
