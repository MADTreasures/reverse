import { describe, expect, it } from 'vitest';
import { createImg, type Img } from './filters/core';
import { applyH, boxQuad, invertH, isConvexQuad, isParallelogram, meshFrom, meshOutline, meshPoint, mulH, pointsBounds, quadAffine, quadHomography, warpMesh, warpProjective, type Quad } from './warp';

const close = (a: { x: number; y: number }, b: { x: number; y: number }, eps = 1e-6) => {
  expect(a.x).toBeCloseTo(b.x, 5);
  expect(a.y).toBeCloseTo(b.y, 5);
  void eps;
};

function picture(w: number, h: number): Img {
  const i = createImg(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) i.data.set([(x * 255) / w, (y * 255) / h, 100, 255], (y * w + x) * 4);
  return i;
}
const px = (i: Img, x: number, y: number) => Array.from(i.data.subarray((y * i.width + x) * 4, (y * i.width + x) * 4 + 4));

describe('transform geometry', () => {
  const quad: Quad = [
    { x: 10, y: 20 },
    { x: 110, y: 0 },
    { x: 140, y: 90 },
    { x: 0, y: 70 },
  ];

  it('maps the box corners onto the quad and back', () => {
    const H = quadHomography(50, 30, quad);
    close(applyH(H, 0, 0), quad[0]);
    close(applyH(H, 50, 0), quad[1]);
    close(applyH(H, 50, 30), quad[2]);
    close(applyH(H, 0, 30), quad[3]);
    const id = mulH(invertH(H), H);
    [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, k) => expect(id[k] / id[8]).toBeCloseTo(v, 9));
    // Straight lines stay straight: the box centre lands where the diagonals cross.
    const c = applyH(H, 25, 15);
    const cross = (a: number[], b: number[], p: number[], q: number[]) => (b[0] - a[0]) * (q[1] - p[1]) - (b[1] - a[1]) * (q[0] - p[0]);
    expect(Math.abs(cross([quad[0].x, quad[0].y], [quad[2].x, quad[2].y], [quad[0].x, quad[0].y], [c.x, c.y]))).toBeLessThan(1e-6);
  });

  it('tells parallelograms (affine) and folded quads apart', () => {
    const para: Quad = [
      { x: 0, y: 0 },
      { x: 10, y: 2 },
      { x: 13, y: 12 },
      { x: 3, y: 10 },
    ];
    expect(isParallelogram(para)).toBe(true);
    expect(isParallelogram(quad)).toBe(false);
    expect(quadAffine(5, 5, para)).toEqual([2, 0.4, 0.6, 2, 0, 0]);
    expect(quadHomography(5, 5, para).slice(6)).toEqual([0, 0, 1]);
    expect(isConvexQuad(quad)).toBe(true);
    expect(isConvexQuad([quad[0], quad[2], quad[1], quad[3]])).toBe(false);
    expect(boxQuad({ x: 1, y: 2, w: 3, h: 4 })[2]).toEqual({ x: 4, y: 6 });
  });

  it('passes the mesh surface through the lattice points and keeps affine maps exact', () => {
    const map = (x: number, y: number) => ({ x: 5 + 2 * x + 0.5 * y, y: -3 + 0.25 * x + 1.5 * y });
    const m = meshFrom(90, 60, 4, 3, map);
    expect(m.pts).toHaveLength(12);
    close(meshPoint(m, 90, 60, 30, 30), map(30, 30));
    for (const [x, y] of [
      [0, 0],
      [13, 47],
      [90, 60],
      [61.5, 2.25],
    ])
      close(meshPoint(m, 90, 60, x, y), map(x, y));
    // Moving one lattice point bends the surface smoothly around it.
    m.pts[5] = { x: m.pts[5].x + 10, y: m.pts[5].y };
    const at = meshPoint(m, 90, 60, 30, 30);
    expect(at.x).toBeCloseTo(map(30, 30).x + 10, 6);
    const near = meshPoint(m, 90, 60, 40, 30);
    expect(near.x - map(40, 30).x).toBeGreaterThan(0);
    expect(near.x - map(40, 30).x).toBeLessThan(10);
    expect(meshOutline(m)).toHaveLength(10);
  });

  it('bounds points in whole pixels inside the canvas', () => {
    expect(pointsBounds([{ x: 2.5, y: 3.2 }, { x: 10.1, y: 7 }], 100, 100)).toEqual({ x: 1, y: 2, w: 11, h: 6 });
    expect(pointsBounds([{ x: -50, y: -50 }, { x: -10, y: -10 }], 100, 100)).toBeNull();
  });
});

describe('transform resampling', () => {
  it('moves pixels exactly by whole pixels in every method', () => {
    const src = picture(20, 10);
    const H = quadHomography(20, 10, boxQuad({ x: 7, y: 3, w: 20, h: 10 }));
    for (const interp of ['nearest', 'bilinear', 'bicubic', 'average'] as const) {
      const out = warpProjective(src, H, { x: 0, y: 0, w: 40, h: 20 }, interp);
      expect(px(out, 7 + 5, 3 + 4), interp).toEqual(px(src, 5, 4));
      expect(px(out, 2, 2)[3], interp).toBe(0);
    }
  });

  it('draws a perspective quad: inside filled, outside empty', () => {
    const src = createImg(10, 10);
    src.data.fill(255);
    const q: Quad = [
      { x: 20, y: 10 },
      { x: 40, y: 10 },
      { x: 50, y: 40 },
      { x: 10, y: 40 },
    ];
    const out = warpProjective(src, quadHomography(10, 10, q), { x: 0, y: 0, w: 60, h: 50 }, 'bilinear');
    expect(px(out, 30, 25)).toEqual([255, 255, 255, 255]);
    expect(px(out, 12, 12)[3]).toBe(0);
    expect(px(out, 44, 34)[3]).toBe(255);
    // The edges fade over a fraction of a source pixel.
    expect(px(out, 48, 38)[3]).toBeGreaterThan(0);
  });

  it('covers every pixel once with an unchanged mesh and follows a moved lattice point', () => {
    const src = picture(24, 24);
    const m = meshFrom(24, 24, 4, 4, (x, y) => ({ x, y }));
    const out = warpMesh(src, m, 24, 24, { x: 0, y: 0, w: 24, h: 24 }, 'bilinear');
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) expect(px(out, x, y)).toEqual(px(src, x, y));
    // Drag the lattice point at (8, 8) right: what was there moves right.
    m.pts[5] = { x: 14, y: 8 };
    const bent = warpMesh(src, m, 24, 24, { x: 0, y: 0, w: 24, h: 24 }, 'bilinear');
    expect(px(bent, 13, 8)[0]).toBeLessThan(px(src, 13, 8)[0]);
    expect(px(bent, 23, 23)).toEqual(px(src, 23, 23));
  });
});
