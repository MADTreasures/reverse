import { describe, expect, it } from 'vitest';
import { hitPlacement, placeImage, placementBounds, placementCorners, placementMatrix, sanitizePlacement, tileBlock, toImage, transformPlacement, type ImagePlacement } from './imageMaterial';

const base: ImagePlacement = { image: 'img1', w: 100, h: 50, cx: 200, cy: 150, sx: 1, sy: 1, rotation: 0, tiling: null, tilingDirection: 'both', hardEdges: false };
const close = (p: { x: number; y: number }, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x, 6);
  expect(p.y).toBeCloseTo(y, 6);
};

describe('image material layers', () => {
  it('place the image round its middle, scaled and turned', () => {
    expect(placementBounds(base)).toEqual({ x: 150, y: 125, w: 100, h: 50 });
    const turned = placementCorners({ ...base, sx: 2, sy: 2, rotation: Math.PI / 2 });
    // Turned a quarter clockwise (y down): the top-left corner goes to the top right.
    close(turned[0], 250, 50);
    close(turned[2], 150, 250);
    // Mapping a point there and back.
    const m = placementMatrix({ ...base, rotation: 0.3, sx: 1.5, sy: -0.5 });
    const q = { x: m[0] * 20 + m[2] * 10 + m[4], y: m[1] * 20 + m[3] * 10 + m[5] };
    close(toImage({ ...base, rotation: 0.3, sx: 1.5, sy: -0.5 }, q)!, 20, 10);
  });

  it('follow moves, scaling, turns and flips (the same map before and after)', () => {
    const p = { ...base, rotation: 0.4, sx: 1.2, sy: 0.8 };
    const maps: [number, number, number, number, number, number][] = [
      [1, 0, 0, 1, 30, -20],
      [2, 0, 0, 2, 0, 0],
      [Math.cos(1), Math.sin(1), -Math.sin(1), Math.cos(1), 5, 5],
      [-1, 0, 0, 1, 400, 0],
      [1, 0, 0, -1, 0, 300],
    ];
    for (const m of maps) {
      const t = transformPlacement(p, m);
      const before = placementMatrix(p);
      const after = placementMatrix(t);
      // after = m ∘ before
      const want = [
        m[0] * before[0] + m[2] * before[1],
        m[1] * before[0] + m[3] * before[1],
        m[0] * before[2] + m[2] * before[3],
        m[1] * before[2] + m[3] * before[3],
        m[0] * before[4] + m[2] * before[5] + m[4],
        m[1] * before[4] + m[3] * before[5] + m[5],
      ];
      after.forEach((v, i) => expect(v).toBeCloseTo(want[i], 6));
    }
  });

  it('is hit inside the image, or along its tiling', () => {
    expect(hitPlacement(base, { x: 160, y: 140 })).toBe(true);
    expect(hitPlacement(base, { x: 100, y: 140 })).toBe(false);
    expect(hitPlacement({ ...base, tiling: 'repeat' }, { x: 10, y: 10 })).toBe(true);
    // Tiled across: the band of its height.
    expect(hitPlacement({ ...base, tiling: 'repeat', tilingDirection: 'horizontal' }, { x: 10, y: 140 })).toBe(true);
    expect(hitPlacement({ ...base, tiling: 'repeat', tilingDirection: 'horizontal' }, { x: 10, y: 10 })).toBe(false);
  });

  it('mirrors or turns every other copy when tiling with Flip or Reverse', () => {
    expect(tileBlock('repeat', 'both')).toMatchObject({ cols: 1, rows: 1 });
    const flip = tileBlock('flip', 'both');
    expect([flip.cols, flip.rows]).toEqual([2, 2]);
    expect(flip.flip(1, 0)).toEqual([true, false]);
    expect(flip.flip(1, 1)).toEqual([true, true]);
    const across = tileBlock('flip', 'horizontal');
    expect([across.cols, across.rows]).toEqual([2, 1]);
    const reverse = tileBlock('reverse', 'both');
    expect(reverse.flip(1, 0)).toEqual([true, true]);
    expect(reverse.flip(1, 1)).toEqual([false, false]);
    expect(tileBlock('reverse', 'vertical').flip(0, 1)).toEqual([true, true]);
  });

  it('fits a large image into the canvas, keeps tiles as they are', () => {
    const big = placeImage('a', 1000, 500, 200, 150, 1, { w: 400, h: 300 });
    expect(big.sx).toBeCloseTo(0.4);
    expect(placeImage('a', 100, 50, 0, 0, 2, { w: 400, h: 300 }).sx).toBe(2);
    expect(placeImage('a', 1000, 500, 0, 0, 1, { w: 400, h: 300 }, 'repeat').sx).toBe(1);
  });

  it('reads saved placements safely', () => {
    expect(sanitizePlacement({ image: '../x' })).toBeNull();
    const p = sanitizePlacement({ image: 'img1', w: 100, h: 50, sx: 0, tiling: 'sideways', tilingDirection: 'vertical', hardEdges: true })!;
    expect(p.sx).toBe(1e-4);
    expect(p.tiling).toBeNull();
    expect(p.tilingDirection).toBe('vertical');
    expect(p.hardEdges).toBe(true);
  });
});
