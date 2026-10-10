/** Scales and chords for the piano roll's scale highlighting, snap to scale, stamps and generators. */

export type ScaleType =
  | 'major'
  | 'minor'
  | 'harmonicMinor'
  | 'melodicMinor'
  | 'dorian'
  | 'phrygian'
  | 'lydian'
  | 'mixolydian'
  | 'locrian'
  | 'majorPentatonic'
  | 'minorPentatonic'
  | 'blues'
  | 'wholeTone'
  | 'chromatic';

export interface ScaleSpec {
  /** Pitch class of the tonic, 0 = C. */
  root: number;
  type: ScaleType;
}

export const SCALES: readonly { type: ScaleType; label: string; steps: readonly number[] }[] = [
  { type: 'major', label: 'Major (Ionian)', steps: [0, 2, 4, 5, 7, 9, 11] },
  { type: 'minor', label: 'Minor (Aeolian)', steps: [0, 2, 3, 5, 7, 8, 10] },
  { type: 'harmonicMinor', label: 'Harmonic minor', steps: [0, 2, 3, 5, 7, 8, 11] },
  { type: 'melodicMinor', label: 'Melodic minor', steps: [0, 2, 3, 5, 7, 9, 11] },
  { type: 'dorian', label: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  { type: 'phrygian', label: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
  { type: 'lydian', label: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
  { type: 'mixolydian', label: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  { type: 'locrian', label: 'Locrian', steps: [0, 1, 3, 5, 6, 8, 10] },
  { type: 'majorPentatonic', label: 'Major pentatonic', steps: [0, 2, 4, 7, 9] },
  { type: 'minorPentatonic', label: 'Minor pentatonic', steps: [0, 3, 5, 7, 10] },
  { type: 'blues', label: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
  { type: 'wholeTone', label: 'Whole tone', steps: [0, 2, 4, 6, 8, 10] },
  { type: 'chromatic', label: 'Chromatic', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
];

export const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export function scaleSteps(type: ScaleType): readonly number[] {
  return SCALES.find((s) => s.type === type)?.steps ?? SCALES[0].steps;
}

export function scaleLabel(scale: ScaleSpec): string {
  return `${PITCH_CLASSES[scale.root]} ${SCALES.find((s) => s.type === scale.type)?.label ?? scale.type}`;
}

export function inScale(key: number, scale: ScaleSpec): boolean {
  const pc = (((key - scale.root) % 12) + 12) % 12;
  return scaleSteps(scale.type).includes(pc);
}

/** The nearest key of the scale (ties go up, or down when `direction` < 0). */
export function snapToScale(key: number, scale: ScaleSpec, direction = 0): number {
  if (inScale(key, scale)) return key;
  for (let d = 1; d < 12; d++) {
    const order = direction < 0 ? [key - d, key + d] : [key + d, key - d];
    for (const k of order) if (k >= 0 && k <= 127 && inScale(k, scale)) return k;
  }
  return key;
}

/** Keys of the scale degree `degree` (0-based, may exceed the scale length) above `base` (the tonic at or below). */
export function scaleDegreeKey(scale: ScaleSpec, tonic: number, degree: number): number {
  const steps = scaleSteps(scale.type);
  const octave = Math.floor(degree / steps.length);
  const i = ((degree % steps.length) + steps.length) % steps.length;
  return tonic + octave * 12 + steps[i];
}

export interface ChordShape {
  id: string;
  label: string;
  intervals: readonly number[];
}

/** Chord stamps (FL Studio: Stamp › chords). */
export const CHORDS: readonly ChordShape[] = [
  { id: 'major', label: 'Major', intervals: [0, 4, 7] },
  { id: 'minor', label: 'Minor', intervals: [0, 3, 7] },
  { id: 'dim', label: 'Diminished', intervals: [0, 3, 6] },
  { id: 'aug', label: 'Augmented', intervals: [0, 4, 8] },
  { id: 'sus2', label: 'Sus2', intervals: [0, 2, 7] },
  { id: 'sus4', label: 'Sus4', intervals: [0, 5, 7] },
  { id: '6', label: '6', intervals: [0, 4, 7, 9] },
  { id: 'm6', label: 'Minor 6', intervals: [0, 3, 7, 9] },
  { id: '7', label: '7', intervals: [0, 4, 7, 10] },
  { id: 'maj7', label: 'Major 7', intervals: [0, 4, 7, 11] },
  { id: 'm7', label: 'Minor 7', intervals: [0, 3, 7, 10] },
  { id: 'm7b5', label: 'Half-diminished 7', intervals: [0, 3, 6, 10] },
  { id: 'dim7', label: 'Diminished 7', intervals: [0, 3, 6, 9] },
  { id: 'add9', label: 'Add 9', intervals: [0, 4, 7, 14] },
  { id: '9', label: '9', intervals: [0, 4, 7, 10, 14] },
  { id: 'maj9', label: 'Major 9', intervals: [0, 4, 7, 11, 14] },
  { id: 'm9', label: 'Minor 9', intervals: [0, 3, 7, 10, 14] },
  { id: 'power', label: 'Power (5)', intervals: [0, 7, 12] },
  { id: 'octave', label: 'Octave', intervals: [0, 12] },
];

/** A stamp: a chord, or a whole scale stacked in one octave. */
export type StampId = `chord:${string}` | `scale:${ScaleType}`;

export function stampIntervals(stamp: StampId): readonly number[] {
  if (stamp.startsWith('scale:')) return scaleSteps(stamp.slice(6) as ScaleType);
  return CHORDS.find((c) => `chord:${c.id}` === stamp)?.intervals ?? [0];
}

export function stampLabel(stamp: StampId): string {
  if (stamp.startsWith('scale:')) return SCALES.find((s) => `scale:${s.type}` === stamp)?.label ?? stamp;
  return CHORDS.find((c) => `chord:${c.id}` === stamp)?.label ?? stamp;
}
