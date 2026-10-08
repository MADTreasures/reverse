import { describe, expect, it } from 'vitest';
import { applyDropShadow, applyInnerGlow, applyInnerShadow, applyOuterGlow, blurField, sanitizeGlow, sanitizeKeptStyles, sanitizeShadow, shadowOffset } from './styles';

const W = 40;
const H = 40;
/** A black square from 15 to 25 on a transparent region. */
function square(): Uint8ClampedArray {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 15; y < 25; y++) for (let x = 15; x < 25; x++) d.set([0, 0, 0, 255], (y * W + x) * 4);
  return d;
}
const alpha = (d: Uint8ClampedArray, x: number, y: number) => d[(y * W + x) * 4 + 3];
const red = (d: Uint8ClampedArray, x: number, y: number) => d[(y * W + x) * 4];

describe('layer styles', () => {
  it('drop shadows fall away from the light', () => {
    // Light from above (90°): the shadow falls down.
    const o = shadowOffset({ angle: 90, distance: 5 });
    expect(o.dx).toBeCloseTo(0, 6);
    expect(o.dy).toBeCloseTo(5, 6);
    const d = square();
    applyDropShadow(d, W, H, { enabled: true, color: '#ff0000', opacity: 100, angle: 90, distance: 5, size: 0, spread: 0 });
    // Below the square: red shadow; above it: nothing; the square itself stays black.
    expect(alpha(d, 20, 27)).toBe(255);
    expect(red(d, 20, 27)).toBe(255);
    expect(alpha(d, 20, 12)).toBe(0);
    expect(red(d, 20, 20)).toBe(0);
  });

  it('glows spread around the shape and fade out', () => {
    const d = square();
    applyOuterGlow(d, W, H, { enabled: true, color: '#00ff00', opacity: 100, size: 9, spread: 0 });
    expect(alpha(d, 20, 26)).toBeGreaterThan(alpha(d, 20, 30));
    expect(alpha(d, 20, 30)).toBeGreaterThan(0);
    expect(alpha(d, 20, 38)).toBe(0);
    // Spread keeps more of it solid.
    const s = square();
    applyOuterGlow(s, W, H, { enabled: true, color: '#00ff00', opacity: 100, size: 9, spread: 80 });
    expect(alpha(s, 20, 27)).toBeGreaterThan(alpha(square().map((v) => v), 20, 27));
  });

  it('inner shadows and glows stay inside the shape', () => {
    const d = square();
    applyInnerShadow(d, W, H, { enabled: true, color: '#ffffff', opacity: 100, angle: 90, distance: 3, size: 0, spread: 0 });
    // The top rows of the square catch the shadow (white), the bottom stays black; outside stays empty.
    expect(red(d, 20, 15)).toBe(255);
    expect(red(d, 20, 23)).toBe(0);
    expect(alpha(d, 20, 12)).toBe(0);
    const g = square();
    applyInnerGlow(g, W, H, { enabled: true, color: '#ffffff', opacity: 100, size: 6, spread: 0 });
    expect(red(g, 15, 20)).toBeGreaterThan(red(g, 20, 20));
    expect(alpha(g, 10, 20)).toBe(0);
  });

  it('blurs like a soft box filter and sanitizes stored styles', () => {
    const f = new Float32Array(41 * 41);
    f[20 * 41 + 20] = 1;
    const b = blurField(f, 41, 41, 6);
    const c = 20 * 41 + 20;
    expect(b[c]).toBeLessThan(1);
    expect(b[c]).toBeGreaterThan(b[c + 3]);
    // Nothing is lost away from the edges, and the input stays as it was.
    expect(b.reduce((a, v) => a + v, 0)).toBeCloseTo(1, 3);
    expect(f[c]).toBe(1);
    expect(sanitizeShadow({ opacity: 300, color: 'red', distance: -4 })).toMatchObject({ opacity: 100, color: '#000000', distance: 0 });
    expect(sanitizeGlow(null)).toBeUndefined();
    expect(sanitizeKeptStyles({ bevel: { size: { units: 'Pixels', value: 5 }, f: () => 1 }, evil: 1 })).toEqual({ bevel: { size: { units: 'Pixels', value: 5 }, f: undefined } });
    expect(sanitizeKeptStyles({ nothing: true })).toBeUndefined();
  });
});
