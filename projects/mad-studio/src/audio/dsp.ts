/** Small offline DSP toolkit used to synthesise the built-in sounds (runs without Web Audio). */

/** Deterministic PRNG so factory sounds are identical on every start. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type BiquadKind = 'lowpass' | 'highpass' | 'bandpass' | 'peaking';

/** RBJ cookbook biquad, direct form I. */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(
    private readonly kind: BiquadKind,
    freq: number,
    q: number,
    private readonly sampleRate: number,
    gainDb = 0,
  ) {
    this.set(freq, q, gainDb);
  }

  set(freq: number, q: number, gainDb = 0): void {
    const f = Math.min(Math.max(freq, 10), this.sampleRate * 0.49);
    const w0 = (2 * Math.PI * f) / this.sampleRate;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * Math.max(q, 0.01));
    let b0: number;
    let b1: number;
    let b2: number;
    let a0: number;
    let a1: number;
    let a2: number;
    switch (this.kind) {
      case 'lowpass':
        b0 = (1 - cos) / 2;
        b1 = 1 - cos;
        b2 = (1 - cos) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cos;
        a2 = 1 - alpha;
        break;
      case 'highpass':
        b0 = (1 + cos) / 2;
        b1 = -(1 + cos);
        b2 = (1 + cos) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cos;
        a2 = 1 - alpha;
        break;
      case 'bandpass':
        b0 = alpha;
        b1 = 0;
        b2 = -alpha;
        a0 = 1 + alpha;
        a1 = -2 * cos;
        a2 = 1 - alpha;
        break;
      case 'peaking': {
        const A = Math.pow(10, gainDb / 40);
        b0 = 1 + alpha * A;
        b1 = -2 * cos;
        b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;
        a1 = -2 * cos;
        a2 = 1 - alpha / A;
        break;
      }
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Scales a signal so its absolute peak equals `peak`. */
export function normalize<T extends Float32Array>(data: T, peak: number): T {
  let max = 0;
  for (let i = 0; i < data.length; i++) max = Math.max(max, Math.abs(data[i]));
  if (max > 0) {
    const k = peak / max;
    for (let i = 0; i < data.length; i++) data[i] *= k;
  }
  return data;
}

/** Short linear fades at both ends to avoid clicks. */
export function applyEdgeFades<T extends Float32Array>(data: T, sampleRate: number, fadeIn = 0.0005, fadeOut = 0.008): T {
  const nIn = Math.min(data.length, Math.floor(fadeIn * sampleRate));
  const nOut = Math.min(data.length, Math.floor(fadeOut * sampleRate));
  for (let i = 0; i < nIn; i++) data[i] *= i / nIn;
  for (let i = 0; i < nOut; i++) data[data.length - 1 - i] *= i / nOut;
  return data;
}

export function softClip(x: number, drive: number): number {
  return Math.tanh(x * drive) / Math.tanh(drive);
}
