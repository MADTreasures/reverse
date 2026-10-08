import { describe, expect, it } from 'vitest';
import { DEFAULT_BRUSH } from './tools';
import { distanceToStroke, eraseAt, eraseWhere, hitStroke, intersections, keepWhere, packStroke, transformStrokes, unpackStroke, type VectorStroke } from './vector';

/** A straight line from (x0, y0) to (x1, y1) with points every 2 px. */
function line(id: string, x0: number, y0: number, x1: number, y1: number, size = 4): VectorStroke {
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 2));
  const points = Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n, s: 1, d: 1 }));
  return { id, color: '#000000', brush: { ...DEFAULT_BRUSH, size }, points };
}

const extent = (s: VectorStroke) => [Math.min(...s.points.map((p) => p.x)), Math.max(...s.points.map((p) => p.x))];

describe('vector lines', () => {
  it('measure the distance to the line outline', () => {
    const s = line('a', 0, 0, 100, 0, 4);
    expect(distanceToStroke(s, { x: 50, y: 10 }).d).toBeCloseTo(8, 5);
    expect(distanceToStroke(s, { x: 50, y: 1 }).d).toBe(0);
    expect(distanceToStroke(s, { x: 50, y: 10 }).at).toBeCloseTo(25, 5);
  });

  it('find crossings with other lines', () => {
    const h = line('h', 0, 50, 100, 50);
    const v = line('v', 30, 0, 30, 100);
    const xs = intersections(h, [h, v]);
    expect(xs).toHaveLength(1);
    expect(xs[0]).toBeCloseTo(15, 5);
  });

  it('vector eraser: touched area splits the line', () => {
    const out = eraseAt([line('a', 0, 0, 100, 0)], { x: 50, y: 0 }, 5, 'touched');
    expect(out).toHaveLength(2);
    expect(extent(out[0])[1]).toBeLessThan(47);
    expect(extent(out[1])[0]).toBeGreaterThan(53);
  });

  it('vector eraser: up to intersection removes the part between the crossings', () => {
    // A horizontal line crossed by vertical lines at x = 30 and x = 70.
    const h = line('h', 0, 50, 100, 50);
    const all = [h, line('v1', 30, 0, 30, 100), line('v2', 70, 0, 70, 100)];
    const out = eraseAt(all, { x: 50, y: 50 }, 3, 'intersection');
    const pieces = out.filter((s) => s.points.every((p) => Math.abs(p.y - 50) < 1e-9));
    expect(pieces).toHaveLength(2);
    expect(extent(pieces[0])[1]).toBeCloseTo(30, 5);
    expect(extent(pieces[1])[0]).toBeCloseTo(70, 5);
    // Without crossings on one side the line goes to its end.
    const end = eraseAt(all, { x: 90, y: 50 }, 3, 'intersection');
    expect(end.filter((s) => s.points.every((p) => Math.abs(p.y - 50) < 1e-9)).map(extent)).toEqual([[0, 70]]);
  });

  it('vector eraser: whole line', () => {
    const out = eraseAt([line('a', 0, 0, 100, 0), line('b', 0, 50, 100, 50)], { x: 10, y: 0 }, 2, 'whole');
    expect(out.map((s) => s.id)).toEqual(['b']);
  });

  it('transforms keep the line quality: points and widths scale', () => {
    const [t] = transformStrokes([line('a', 0, 0, 10, 0, 4)], [2, 0, 0, 2, 5, 5]);
    expect(t.brush.size).toBe(8);
    expect(t.points[t.points.length - 1]).toMatchObject({ x: 25, y: 5 });
  });

  it('erase inside a selection (cut at its border) and survive the file format', () => {
    const out = eraseWhere([line('a', 0, 0, 100, 0)], (p) => p.x > 40 && p.x < 60);
    expect(out).toHaveLength(2);
    expect(extent(out[0])[1]).toBeGreaterThan(39);
    expect(extent(out[0])[1]).toBeLessThanOrEqual(41);
    expect(extent(out[1])[0]).toBeGreaterThanOrEqual(59);
    const kept = keepWhere([line('b', 0, 0, 100, 0)], (p) => p.x > 40 && p.x < 60);
    expect(kept.map(extent)).toEqual([[expect.closeTo(40, 0), expect.closeTo(60, 0)]]);
    const tilted = { ...out[0], points: out[0].points.map((p, i) => ({ ...p, az: i / 10 })) };
    const back = unpackStroke(JSON.parse(JSON.stringify(packStroke(tilted))), () => DEFAULT_BRUSH)!;
    const round = (v: number, k: number) => Math.round(v * k) / k;
    expect(back.points).toEqual(tilted.points.map((p) => ({ x: round(p.x, 100), y: round(p.y, 100), s: 1, d: 1, az: round(p.az, 1000) })));
    expect(unpackStroke({ p: [1, 2] }, () => DEFAULT_BRUSH)).toBeNull();
  });

  it('pick the top-most line under the pointer', () => {
    const lines = [line('a', 0, 0, 100, 0, 4), line('b', 50, -50, 50, 50, 4)];
    expect(hitStroke(lines, { x: 50, y: 1 }, 2)).toBe(1);
    expect(hitStroke(lines, { x: 20, y: 3 }, 2)).toBe(0);
    expect(hitStroke(lines, { x: 20, y: 20 }, 2)).toBe(-1);
  });
});
