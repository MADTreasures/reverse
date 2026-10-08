import { describe, expect, it } from 'vitest';
import { adjustHeights, applyPaper, BUILTIN_TEXTURES, BUILTIN_TIPS, imageToMask, textureMask, tipIndex, tipMask } from './materials';

const mean = (d: Uint8ClampedArray) => d.reduce((a, b) => a + b, 0) / d.length;

describe('brush tip materials', () => {
  it('draws every built-in tip inside its square, with paint and empty parts', () => {
    for (const t of BUILTIN_TIPS) {
      const m = tipMask(t.id, 48)!;
      expect(m.data).toHaveLength(48 * 48);
      const m0 = mean(m.data);
      expect(m0, t.id).toBeGreaterThan(5);
      expect(m0, t.id).toBeLessThan(200);
      // The corners stay (almost) empty for the round-ish tips.
      if (!['bristle', 'grass'].includes(t.id)) expect(m.data[0], t.id).toBeLessThan(40);
    }
    expect(tipMask('nope')).toBeNull();
    // The same every time.
    expect(tipMask('splatter', 32)!.data).toEqual(tipMask('splatter', 32)!.data);
  });

  it('turns imported images into masks: dark or opaque is paint', () => {
    const white = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
    expect([...imageToMask(white, 2, 1).data]).toEqual([0, 255]);
    const alpha = new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255]);
    expect([...imageToMask(alpha, 2, 1).data]).toEqual([0, 255]);
  });

  it('chooses the tip of each dab by the repeat method', () => {
    const r = () => 0.99;
    const seq = (order: Parameters<typeof tipIndex>[0]) => Array.from({ length: 7 }, (_, n) => tipIndex(order, 3, n, r));
    expect(seq('repeat')).toEqual([0, 1, 2, 0, 1, 2, 0]);
    expect(seq('reverse')).toEqual([0, 1, 2, 1, 0, 1, 2]);
    expect(seq('stay')).toEqual([0, 1, 2, 2, 2, 2, 2]);
    expect(seq('once')).toEqual([0, 1, 2, -1, -1, -1, -1]);
    expect(seq('random')).toEqual([2, 2, 2, 2, 2, 2, 2]);
    expect(tipIndex('reverse', 1, 5, r)).toBe(0);
  });
});

describe('paper textures', () => {
  it('are seamless height maps with texture in them', () => {
    for (const t of BUILTIN_TEXTURES) {
      const m = textureMask(t.id, 64)!;
      const d = m.data;
      const avg = mean(d);
      expect(avg, t.id).toBeGreaterThan(40);
      expect(avg, t.id).toBeLessThan(215);
      const spread = Math.max(...d) - Math.min(...d);
      expect(spread, t.id).toBeGreaterThan(60);
      // Opposite edges match their neighbours about as well as neighbouring rows do.
      let edge = 0;
      let inner = 0;
      for (let x = 0; x < 64; x++) {
        edge += Math.abs(d[63 * 64 + x] - d[x]);
        inner += Math.abs(d[31 * 64 + x] - d[32 * 64 + x]);
      }
      expect(edge, t.id).toBeLessThan(inner * 3 + 64 * 12);
    }
  });

  it('brightness, contrast and invert change the heights', () => {
    const m = { w: 3, h: 1, data: new Uint8ClampedArray([0, 128, 255]) };
    expect([...adjustHeights(m, { brightness: 0, contrast: 0, invert: true })]).toEqual([255, 127, 0]);
    const bright = adjustHeights(m, { brightness: 100, contrast: 0, invert: false });
    expect(bright[0]).toBeGreaterThan(100);
    const flat = adjustHeights(m, { brightness: 0, contrast: -100, invert: false });
    expect(new Set(flat).size).toBe(1);
  });

  it('takes paint away where the paper is low, staying put on the canvas', () => {
    // Heights: a 2 × 2 checker of low (0) and high (255).
    const heights = new Uint8ClampedArray([0, 255, 255, 0]);
    const block = () => new Uint8ClampedArray(4 * 4 * 4).fill(255);
    const p = { density: 1, scale: 100, angle: 0, brightness: 0, contrast: 0, invert: false, mode: 'subtract' as const };
    const a = block();
    applyPaper(a, 4, 4, 0, 0, heights, 2, p);
    const alphas = (d: Uint8ClampedArray) => Array.from({ length: d.length / 4 }, (_, i) => d[i * 4 + 3]);
    expect(alphas(a).slice(0, 4)).toEqual([0, 255, 0, 255]);
    // Offset by one pixel on the canvas: the same paper.
    const b = block();
    applyPaper(b, 4, 4, 1, 0, heights, 2, p);
    expect(alphas(b).slice(0, 3)).toEqual(alphas(a).slice(1, 4));
    // Multiply at half density keeps half the paint in the low parts.
    const c = block();
    applyPaper(c, 4, 4, 0, 0, heights, 2, { ...p, mode: 'multiply', density: 0.5 });
    expect(alphas(c).slice(0, 2)).toEqual([128, 255]);
    // Subtract: a light stroke only touches the high parts.
    const light = new Uint8ClampedArray(4 * 4 * 4).fill(100);
    applyPaper(light, 4, 4, 0, 0, new Uint8ClampedArray([128, 255, 255, 128]), 2, p);
    expect(alphas(light).slice(0, 2)).toEqual([0, 100]);
  });
});
