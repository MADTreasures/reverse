import { describe, expect, it } from 'vitest';
import { distanceToInside } from './distance';
import { anyEffect, applyEdge, applyExpression, applyLayerColor, applyWatercolorEdge, DEFAULT_BORDER, DEFAULT_EXPRESSION, effectReach, hardenMask, opacityInExpression, sanitizeEffects } from './effects';

/** RGBA image of w × h with the given pixels opaque black. */
function image(w: number, h: number, opaque: [number, number][]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (const [x, y] of opaque) d[(y * w + x) * 4 + 3] = 255;
  return d;
}

describe('distance transform', () => {
  it('measures the exact Euclidean distance to the nearest inside pixel', () => {
    const d = distanceToInside((i) => i === 12, 5, 5);
    expect(d[12]).toBe(0);
    expect(d[13]).toBe(1);
    expect(d[0]).toBeCloseTo(Math.SQRT2 * 2, 5);
    expect(d[2]).toBe(2);
  });
});

describe('layer effects', () => {
  it('edge draws a line of the given width behind the pixels', () => {
    const src = image(9, 9, [[4, 4]]);
    const out = applyEdge(src, 9, 9, { ...DEFAULT_BORDER, width: 2, color: '#ff0000' });
    const at = (x: number, y: number) => [...out.slice((y * 9 + x) * 4, (y * 9 + x) * 4 + 4)];
    expect(at(4, 4)).toEqual([0, 0, 0, 255]);
    expect(at(5, 4)).toEqual([255, 0, 0, 255]);
    expect(at(4, 6)[3]).toBe(128);
    expect(at(4, 8)[3]).toBe(0);
    expect(effectReach({ border: { ...DEFAULT_BORDER, width: 2 } })).toBe(3);
    expect(effectReach({ border: { ...DEFAULT_BORDER, enabled: false } })).toBe(0);
  });

  it('layer colour replaces black and keeps white (or uses the sub colour)', () => {
    const d = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0]);
    applyLayerColor(d, { enabled: true, color: '#3366cc', sub: null });
    expect([...d.slice(0, 8)]).toEqual([0x33, 0x66, 0xcc, 255, 255, 255, 255, 255]);
    expect(d[11]).toBe(0);
    const w = new Uint8ClampedArray([255, 255, 255, 255]);
    applyLayerColor(w, { enabled: true, color: '#000000', sub: '#ffcc00' });
    expect([...w]).toEqual([255, 204, 0, 255]);
  });

  it('watercolor edge darkens and thickens the paint at the border of a shape', () => {
    const w = 21;
    const pts: [number, number][] = [];
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) if (Math.hypot(x - 10, y - 10) < 9) pts.push([x, y]);
    const d = image(w, w, pts);
    for (let p = 0; p < d.length; p += 4) if (d[p + 3]) d.set([200, 200, 200, 128], p);
    applyWatercolorEdge(d, w, w, { ...DEFAULT_BORDER, kind: 'watercolor', range: 3, blur: 0, opacity: 100, darkness: 100 });
    const at = (x: number, y: number) => d.slice((y * w + x) * 4, (y * w + x) * 4 + 4);
    expect(at(2, 10)[0]).toBeLessThan(at(10, 10)[0]);
    expect(at(2, 10)[3]).toBeGreaterThan(at(10, 10)[3]);
    expect([...at(10, 10)]).toEqual([200, 200, 200, 128]);
  });

  it('sanitizes effects from files', () => {
    expect(sanitizeEffects(null)).toBeUndefined();
    expect(sanitizeEffects({ border: { kind: 'evil', width: 1e9, color: 'red' } })).toEqual({
      border: { ...DEFAULT_BORDER, width: 100 },
    });
    expect(sanitizeEffects({ layerColor: { color: '#ABCDEF', sub: null } })?.layerColor).toEqual({ enabled: true, color: '#abcdef', sub: null });
  });
});

describe('expression color and mask expression', () => {
  const px = (...p: number[][]) => new Uint8ClampedArray(p.flat());

  it('shows a layer in grey levels', () => {
    const d = px([255, 0, 0, 255], [0, 0, 255, 100], [9, 9, 9, 0]);
    applyExpression(d, DEFAULT_EXPRESSION, 1);
    expect([...d]).toEqual([76, 76, 76, 255, 29, 29, 29, 100, 9, 9, 9, 0]);
  });

  it('shows a layer in black and white at the thresholds', () => {
    const mono = { ...DEFAULT_EXPRESSION, mode: 'mono' as const };
    const d = px([200, 200, 200, 255], [50, 50, 50, 255], [50, 50, 50, 100], [255, 255, 255, 200]);
    applyExpression(d, mono, 1);
    expect([...d]).toEqual([255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255]);
    // Reflect layer opacity: at 50 % layer opacity the 200 alpha falls under the threshold.
    const half = px([255, 255, 255, 200]);
    applyExpression(half, mono, 0.5);
    expect([...half]).toEqual([0, 0, 0, 0]);
    const kept = px([255, 255, 255, 200]);
    applyExpression(kept, { ...mono, reflectOpacity: false }, 0.5);
    expect([...kept]).toEqual([255, 255, 255, 255]);
    // Only black shows.
    const black = px([255, 255, 255, 255], [0, 0, 0, 255]);
    applyExpression(black, { ...mono, white: false }, 1);
    expect([...black]).toEqual([0, 0, 0, 0, 0, 0, 0, 255]);
    expect(opacityInExpression({ expression: mono })).toBe(true);
    expect(opacityInExpression({ expression: DEFAULT_EXPRESSION })).toBe(false);
    expect(anyEffect({ expression: DEFAULT_EXPRESSION })).toBe(true);
  });

  it('makes a mask show fully or not at all without gradients', () => {
    const d = px([0, 0, 0, 127], [0, 0, 0, 128], [0, 0, 0, 255]);
    hardenMask(d, 128);
    expect([d[3], d[7], d[11]]).toEqual([0, 255, 255]);
  });

  it('reads expression color settings safely', () => {
    expect(sanitizeEffects({ expression: { mode: 'mono', colorThreshold: 999, alphaThreshold: -4, black: false } })?.expression).toEqual({
      mode: 'mono',
      colorThreshold: 255,
      alphaThreshold: 1,
      reflectOpacity: true,
      black: false,
      white: true,
    });
    expect(sanitizeEffects({ expression: { mode: 'sepia' } })?.expression?.mode).toBe('gray');
  });
});
