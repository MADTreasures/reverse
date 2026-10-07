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
  | 'none'
  | '1/6 step'
  | '1/4 step'
  | '1/3 step'
  | '1/2 step'
  | 'step'
  | '1/3 beat'
  | '1/2 beat'
  | 'beat'
  | 'bar';

export const SNAP_OPTIONS: SnapId[] = [
  'none',
  '1/6 step',
  '1/4 step',
  '1/3 step',
  '1/2 step',
  'step',
  '1/3 beat',
  '1/2 beat',
  'beat',
  'bar',
];

export function snapTicks(snap: SnapId, beatsPerBar: number): number {
  switch (snap) {
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
