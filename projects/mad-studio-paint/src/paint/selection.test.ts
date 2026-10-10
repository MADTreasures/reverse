import { describe, expect, it } from 'vitest';
import { floodFillMask, growSelectionMask, scaleArea } from './fill';
import { blurMask, createMask, maskFromAlpha, pixelsFromMask, rectMask } from './mask';

const W = 40;
const H = 30;
const count = (m: { data: Uint8Array }) => m.data.reduce((n, v) => n + (v ? 1 : 0), 0);

describe('selection functions', () => {
  it('Expand / Shrink selected area: sharp corners grow square, rounded ones grow round', () => {
    const box = rectMask(W, H, { x: 10, y: 10, w: 10, h: 10 });
    const sharp = scaleArea(box, 3, 'rectangle');
    const round = scaleArea(box, 3, 'round');
    expect(count(sharp)).toBe(16 * 16);
    // The corner pixel 3 px out diagonally is in the sharp one only.
    expect(sharp.data[7 * W + 7]).toBe(255);
    expect(round.data[7 * W + 7]).toBe(0);
    expect(count(scaleArea(box, -2, 'rectangle'))).toBe(6 * 6);
    // Shrinking a selection that touches the canvas edge shrinks from the edge too.
    const all = rectMask(W, H, { x: 0, y: 0, w: W, h: H });
    expect(count(growSelectionMask(all, -2, 'sharp'))).toBe((W - 4) * (H - 4));
    expect(count(growSelectionMask(all, -2, 'rounded'))).toBe((W - 4) * (H - 4));
    expect(count(growSelectionMask(box, 3, 'sharp'))).toBe(16 * 16);
  });

  it('Blur border softens the edge and keeps the middle and the far outside', () => {
    const box = rectMask(W, H, { x: 10, y: 5, w: 20, h: 20 });
    const soft = blurMask(box, 6);
    expect(soft.data[15 * W + 20]).toBe(255);
    expect(soft.data[15 * W + 2]).toBe(0);
    // At the edge: about half.
    expect(soft.data[15 * W + 10]).toBeGreaterThan(90);
    expect(soft.data[15 * W + 10]).toBeLessThan(170);
    // A soft ramp: growing towards the inside.
    expect(soft.data[15 * W + 8]).toBeLessThan(soft.data[15 * W + 12]);
  });

  it('Select color gamut: every pixel of a similar colour, connected or not', () => {
    const px = new Uint8ClampedArray(W * H * 4);
    const paint = (x0: number, x1: number, rgb: number[]) => {
      for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) px.set([...rgb, 255], (y * W + x) * 4);
    };
    paint(0, 10, [200, 0, 0]);
    paint(10, 20, [0, 0, 200]);
    paint(20, 30, [210, 5, 0]);
    paint(30, 40, [0, 0, 200]);
    const m = floodFillMask(px, W, H, 2, 2, { tolerance: 10, contiguous: false });
    expect(count(m)).toBe(20 * H);
    expect(m.data[5 * W + 25]).toBe(255);
    expect(m.data[5 * W + 15]).toBe(0);
    // With no margin only the exact colour.
    expect(count(floodFillMask(px, W, H, 2, 2, { tolerance: 0, contiguous: false }))).toBe(10 * H);
  });

  it('Quick Mask and selection layers: a selection into pixels and back', () => {
    const sel = createMask(4, 2);
    sel.data.set([0, 255, 128, 0, 255, 0, 0, 64]);
    const px = pixelsFromMask(sel, { r: 255, g: 0, b: 0 });
    expect(Array.from(px.subarray(4, 8))).toEqual([255, 0, 0, 255]);
    expect(Array.from(px.subarray(0, 4))).toEqual([0, 0, 0, 0]);
    expect(Array.from(maskFromAlpha(px, 4, 2).data)).toEqual([0, 255, 128, 0, 255, 0, 0, 64]);
  });
});
