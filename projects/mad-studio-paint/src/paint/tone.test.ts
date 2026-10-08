import { describe, expect, it } from 'vitest';
import { applyTone, defaultTone, sanitizeTone, threshold, type DotShape } from './tone';

/** A w × h region of one grey value (straight RGBA). */
const grey = (w: number, h: number, v: number, a = 255) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < d.length; p += 4) d.set([v, v, v, a], p);
  return d;
};

/** Share of ink in a region after the tone (dark pixels for "color", alpha otherwise). */
const ink = (d: Uint8ClampedArray, byAlpha: boolean) => {
  let sum = 0;
  for (let p = 0; p < d.length; p += 4) sum += byAlpha ? d[p + 3] / 255 : 1 - d[p] / 255;
  return sum / (d.length / 4);
};

describe('screentones', () => {
  it('thresholds grow from the middle of a dot cell to its corners', () => {
    for (const shape of ['circle', 'square', 'lozenge', 'cross', 'ellipse'] as DotShape[]) {
      expect(threshold(shape, 0, 0)).toBeCloseTo(0, 6);
      expect(threshold(shape, 0.5, 0.5)).toBeCloseTo(1, 1);
      expect(threshold(shape, 0.2, 0.1)).toBeLessThan(threshold(shape, 0.4, 0.3));
    }
  });

  it('dots cover about as much as the density asks for', () => {
    for (const shape of ['circle', 'square', 'line'] as DotShape[]) {
      const t = defaultTone(80, { frequency: 10, shape, angle: 30 });
      // 25 % grey → ~25 % ink; 70 % → ~70 %.
      for (const v of [0.25, 0.7]) {
        const d = grey(160, 160, Math.round(255 * (1 - v)));
        applyTone(d, 160, 160, 0, 0, t, 80);
        expect(ink(d, false)).toBeCloseTo(v, 1);
      }
    }
  });

  it('a set density fills drawn pixels only; layer opacity can change the dot size', () => {
    const t = defaultTone(80, { frequency: 10, density: 'fixed', value: 40 });
    const d = grey(80, 80, 0);
    applyTone(d, 80, 80, 0, 0, t, 80);
    expect(ink(d, true)).toBeCloseTo(0.4, 1);
    const empty = grey(10, 10, 0, 0);
    applyTone(empty, 10, 10, 0, 0, t, 80);
    expect(ink(empty, true)).toBe(0);
    const half = grey(80, 80, 0);
    applyTone(half, 80, 80, 0, 0, { ...t, reflectOpacity: true }, 80, 0.5);
    expect(ink(half, true)).toBeCloseTo(0.2, 1);
  });

  it('the pattern follows document positions (regions line up) and survives files', () => {
    const t = defaultTone(80, { frequency: 10, density: 'fixed', value: 50 });
    const whole = grey(40, 40, 0);
    applyTone(whole, 40, 40, 0, 0, t, 80);
    const part = grey(20, 20, 0);
    applyTone(part, 20, 20, 20, 20, t, 80);
    for (let j = 0; j < 20; j++) for (let i = 0; i < 20; i++) expect(part[(j * 20 + i) * 4 + 3]).toBe(whole[((j + 20) * 40 + i + 20) * 4 + 3]);
    expect(sanitizeTone({ shape: 'star', frequency: -5, density: 'x' })).toMatchObject({ shape: 'circle', frequency: 1, density: 'color' });
  });
});
