import { describe, expect, it } from 'vitest';
import { blendInto } from './blendPixels';

const px = (...v: number[]) => new Uint8ClampedArray(v);

describe('per-pixel blend modes', () => {
  it('subtract: white turns the result black, black has no effect', () => {
    const d = px(200, 120, 50, 255);
    blendInto(d, px(255, 255, 255, 255), 'subtract');
    expect([...d]).toEqual([0, 0, 0, 255]);
    const e = px(200, 120, 50, 255);
    blendInto(e, px(0, 0, 0, 255), 'subtract');
    expect([...e]).toEqual([200, 120, 50, 255]);
  });

  it('linear burn, add, divide and hard mix', () => {
    const lb = px(128, 255, 0, 255);
    blendInto(lb, px(128, 128, 255, 255), 'linear-burn');
    expect([...lb]).toEqual([1, 128, 0, 255]);
    const add = px(100, 200, 0, 255);
    blendInto(add, px(100, 100, 50, 255), 'add');
    expect([...add]).toEqual([200, 255, 50, 255]);
    const div = px(64, 64, 64, 255);
    blendInto(div, px(128, 0, 255, 255), 'divide');
    expect([...div]).toEqual([128, 255, 64, 255]);
    const hm = px(100, 200, 128, 255);
    blendInto(hm, px(100, 100, 127, 255), 'hard-mix');
    expect([...hm]).toEqual([0, 255, 255, 255]);
  });

  it('darker / lighter colour pick whole colours by luminance', () => {
    const d = px(255, 0, 0, 255);
    blendInto(d, px(0, 0, 255, 255), 'darker-color');
    expect([...d]).toEqual([0, 0, 255, 255]);
    const l = px(255, 0, 0, 255);
    blendInto(l, px(0, 0, 255, 255), 'lighter-color');
    expect([...l]).toEqual([255, 0, 0, 255]);
  });

  it('respects layer opacity and transparent backdrops', () => {
    const half = px(0, 0, 0, 255);
    blendInto(half, px(255, 255, 255, 255), 'add', 0.5);
    expect(half[0]).toBeGreaterThanOrEqual(127);
    expect(half[0]).toBeLessThanOrEqual(128);
    // On a transparent backdrop every mode shows the source as it is.
    const empty = px(0, 0, 0, 0);
    blendInto(empty, px(10, 20, 30, 255), 'subtract');
    expect([...empty]).toEqual([10, 20, 30, 255]);
    // Fully transparent source changes nothing.
    const keep = px(1, 2, 3, 4);
    blendInto(keep, px(255, 255, 255, 0), 'divide');
    expect([...keep]).toEqual([1, 2, 3, 4]);
  });

  it('glow dodge brightens more where the layer is semi-transparent than a lerped dodge would', () => {
    const glow = px(100, 100, 100, 255);
    blendInto(glow, px(200, 200, 200, 128), 'glow-dodge');
    expect(glow[0]).toBeGreaterThan(100);
    expect(glow[3]).toBe(255);
  });
});
