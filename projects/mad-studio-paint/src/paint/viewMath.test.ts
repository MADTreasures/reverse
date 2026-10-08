import { describe, expect, it } from 'vitest';
import { apply, invert, normalizeAngle, rotatePan, viewMatrix } from './viewMath';

const viewport = { w: 800, h: 600 };
const doc = { w: 400, h: 200 };
const base = { zoom: 1, rotation: 0, flipH: false, flipV: false, panX: 0, panY: 0 };

describe('view transform', () => {
  it('centres the document', () => {
    const m = viewMatrix(base, viewport, doc);
    expect(apply(m, 200, 100)).toEqual({ x: 400, y: 300 });
    expect(apply(m, 0, 0)).toEqual({ x: 200, y: 200 });
  });

  it('zooms, pans, rotates and flips around the document centre', () => {
    const m = viewMatrix({ ...base, zoom: 2, panX: 10, panY: -5 }, viewport, doc);
    expect(apply(m, 0, 0)).toEqual({ x: 10, y: 95 });
    const r = viewMatrix({ ...base, rotation: 90 }, viewport, doc);
    const p = apply(r, 400, 100);
    expect(p.x).toBeCloseTo(400);
    expect(p.y).toBeCloseTo(500);
    const f = viewMatrix({ ...base, flipH: true }, viewport, doc);
    expect(apply(f, 0, 0).x).toBeCloseTo(600);
  });

  it('inverts exactly', () => {
    const m = viewMatrix({ zoom: 3.5, rotation: 33, flipH: true, flipV: false, panX: 40, panY: 12 }, viewport, doc);
    const inv = invert(m);
    const p = apply(inv, ...(Object.values(apply(m, 123, 45)) as [number, number]));
    expect(p.x).toBeCloseTo(123);
    expect(p.y).toBeCloseTo(45);
  });

  it('rotates the pan vector and normalises angles', () => {
    const r = rotatePan(10, 0, 90);
    expect(r.panX).toBeCloseTo(0);
    expect(r.panY).toBeCloseTo(10);
    expect(normalizeAngle(190)).toBe(-170);
    expect(normalizeAngle(-180)).toBe(180);
    expect(normalizeAngle(360)).toBe(0);
  });
});
