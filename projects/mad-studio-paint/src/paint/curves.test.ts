import { describe, expect, it } from 'vitest';
import {
  extendPath,
  figureOutline,
  followPath,
  makePath,
  nearestOnPath,
  offsetPath,
  pointAt,
  rotatePoints,
  sampleCurve,
  selfCrossings,
  shiftThrough,
  sideOffset,
  simplifyPolyline,
  smoothPolyline,
  turnThrough,
} from './curves';
import type { Pt } from './rulers';

const near = (p: Pt, x: number, y: number, eps = 1e-6) => {
  expect(Math.abs(p.x - x), `x ${p.x} vs ${x}`).toBeLessThanOrEqual(eps);
  expect(Math.abs(p.y - y), `y ${p.y} vs ${y}`).toBeLessThanOrEqual(eps);
};
/** Largest distance from the points to the path. */
const deviation = (pts: Pt[], path: Pt[]) => Math.max(...pts.map((p) => nearestOnPath(makePath(path), p).dist));

describe('curve sampling', () => {
  it('passes through every point of a polyline and a spline', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 40 },
      { x: 200, y: -20 },
      { x: 260, y: 90 },
    ];
    expect(sampleCurve({ curve: 'polyline', points: pts })).toEqual(pts);
    const spline = sampleCurve({ curve: 'spline', points: pts });
    expect(spline.length).toBeGreaterThan(40);
    expect(deviation(pts, spline)).toBeLessThan(1e-9);
    near(spline[0], 0, 0);
    near(spline[spline.length - 1], 260, 90);
    // Smooth: no sharp turns between samples.
    for (let i = 1; i < spline.length - 1; i++) {
      const a = Math.atan2(spline[i].y - spline[i - 1].y, spline[i].x - spline[i - 1].x);
      const b = Math.atan2(spline[i + 1].y - spline[i].y, spline[i + 1].x - spline[i].x);
      expect(Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)))).toBeLessThan(0.5);
    }
  });

  it('makes corners where asked', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    const cornered = sampleCurve({ curve: 'spline', points: pts, corners: [1] });
    // Both runs are straight (two points each): the corner is exact.
    expect(deviation([{ x: 50, y: 0 }, { x: 100, y: 50 }], cornered)).toBeLessThan(1e-9);
    const smooth = sampleCurve({ curve: 'spline', points: pts });
    expect(deviation([{ x: 100, y: 0 }], smooth)).toBeLessThan(1e-9);
    expect(nearestOnPath(makePath(smooth), { x: 50, y: 0 }).dist).toBeGreaterThan(0.5);
  });

  it('quadratic Bezier passes halfway between direction points; cubic through its anchors', () => {
    const q = sampleCurve({
      curve: 'quadratic',
      points: [
        { x: 0, y: 0 },
        { x: 50, y: 100 },
        { x: 150, y: 100 },
        { x: 200, y: 0 },
      ],
    });
    near(q[0], 0, 0);
    near(q[q.length - 1], 200, 0);
    // The implied anchor halfway between the two direction points.
    expect(deviation([{ x: 100, y: 100 }], q)).toBeLessThan(1e-9);
    const c = sampleCurve({
      curve: 'cubic',
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 50 },
        { x: 100, y: 50 },
        { x: 100, y: 0 },
      ],
    });
    // The middle of this symmetric cubic is at y = 37.5.
    expect(deviation([{ x: 50, y: 37.5 }], c)).toBeLessThan(0.05);
  });

  it('outlines rectangles, ellipses and regular polygons', () => {
    const rect = figureOutline({ shape: 'rect', center: { x: 100, y: 100 }, rx: 50, ry: 20, angle: 0, corners: 4 });
    expect(rect).toHaveLength(5);
    near(rect[0], 50, 80);
    near(rect[4], 50, 80);
    const tri = figureOutline({ shape: 'polygon', center: { x: 0, y: 0 }, rx: 10, ry: 10, angle: 0, corners: 3 });
    expect(tri).toHaveLength(4);
    near(tri[0], 0, -10);
    const ell = figureOutline({ shape: 'ellipse', center: { x: 0, y: 0 }, rx: 100, ry: 50, angle: Math.PI / 2, corners: 0 });
    // Turned upright.
    near(ell[0], 0, 100);
    expect(Math.max(...ell.map((p) => Math.abs(p.x)))).toBeCloseTo(50, 1);
  });
});

describe('following a path', () => {
  it('finds the nearest point, also near a given place only', () => {
    const path = makePath([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);
    const hit = nearestOnPath(path, { x: 40, y: 10 });
    near(hit.point, 40, 0);
    expect(hit.s).toBeCloseTo(40);
    // Near the end, the first segment is out of the window.
    expect(nearestOnPath(path, { x: 40, y: 10 }, { s: 190, w: 20 }).point.x).toBe(100);
    near(pointAt(path, 150), 100, 50);
  });

  it('keeps a stroke on its part of the path where the path comes near itself', () => {
    // A hairpin: the two legs are 10 px apart.
    const path = makePath([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 10 },
      { x: 0, y: 10 },
    ]);
    const follow = followPath(path, { x: 10, y: 2 });
    for (let x = 10; x <= 150; x += 5) expect(follow({ x, y: 6 }).y).toBe(0);
    // Closed paths go round.
    const square = makePath(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
        { x: 0, y: 0 },
      ],
      true,
    );
    const round = followPath(square, { x: 1, y: -1 });
    near(round({ x: -1, y: 1 }), 0, 1);
  });

  it('extends a path straight beyond its ends', () => {
    const ext = extendPath(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      100,
    );
    near(ext[0], -100, 0);
    near(ext[ext.length - 1], 110, 0);
  });
});

describe('parallel, multiple and radial curves', () => {
  const arc = Array.from({ length: 61 }, (_, i) => {
    const t = Math.PI + (i / 60) * Math.PI;
    return { x: 100 + Math.cos(t) * 100, y: 100 + Math.sin(t) * 100 };
  });

  it('offsets keep their distance; the inner side of tight bends loses its loop', () => {
    // Outside of the arc (away from its centre).
    const d = sideOffset(makePath(arc), { x: 100, y: -20 });
    expect(Math.abs(d)).toBeCloseTo(20, 1);
    const out = offsetPath(arc, d);
    for (const p of out.filter((_, i) => i % 7 === 0)) expect(Math.hypot(p.x - 100, p.y - 100)).toBeCloseTo(120, 0);
    // A sharp V offset to its inside: the two arms meet in one corner, no loop.
    const v = [
      { x: 0, y: 0 },
      { x: 50, y: 100 },
      { x: 100, y: 0 },
    ];
    const inner = offsetPath(v, sideOffset(makePath(v), { x: 50, y: 60 }));
    expect(selfCrossings(inner)).toHaveLength(0);
    const tip = inner.reduce((a, b) => (b.y > a.y ? b : a));
    expect(tip.x).toBeCloseTo(50, 6);
    // Outer side: rounded, every point keeps the distance from the tip.
    const outer = offsetPath(v, sideOffset(makePath(v), { x: 50, y: 120 }));
    const tipDist = Math.min(...outer.map((p) => Math.hypot(p.x - 50, p.y - 100)));
    expect(tipDist).toBeCloseTo(20, 0);
  });

  it('a genuine loop of the ruler stays a loop in its parallels', () => {
    const loop = sampleCurve({
      curve: 'spline',
      points: [
        { x: 0, y: 100 },
        { x: 150, y: 100 },
        { x: 150, y: 0 },
        { x: 80, y: 0 },
        { x: 80, y: 150 },
        { x: 300, y: 150 },
      ],
    });
    expect(selfCrossings(loop).length).toBeGreaterThan(0);
    expect(selfCrossings(offsetPath(loop, 5)).length).toBeGreaterThan(0);
  });

  it('multiple curves move the curve along their direction; radial curves turn it around the centre', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ];
    expect(shiftThrough(line, { x: 0, y: 1 }, { x: 50, y: 65 })).toBeCloseTo(40);
    const curve = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const angle = turnThrough(curve, { x: 0, y: 0 }, { x: 0, y: 50 })!;
    expect(angle).toBeCloseTo(Math.PI / 2);
    near(rotatePoints(curve, { x: 0, y: 0 }, angle)[1], 0, 100, 1e-9);
  });
});

describe('the ruler pen', () => {
  it('keeps the shape of a hand-drawn line with few points', () => {
    const wobbly = Array.from({ length: 200 }, (_, i) => ({ x: i, y: Math.sin(i / 30) * 40 + (i % 2 ? 0.3 : -0.3) }));
    const smooth = smoothPolyline(wobbly);
    const few = simplifyPolyline(smooth, 1);
    expect(few.length).toBeLessThan(40);
    expect(few[0]).toEqual(smooth[0]);
    expect(few[few.length - 1]).toEqual(smooth[smooth.length - 1]);
    expect(deviation(smooth, few)).toBeLessThanOrEqual(1 + 1e-9);
    const spline = sampleCurve({ curve: 'spline', points: few });
    expect(deviation(smooth.filter((_, i) => i % 10 === 0), spline)).toBeLessThan(2);
  });
});
