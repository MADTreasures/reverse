import { describe, expect, it } from 'vitest';
import { area, divideEqually, distanceToEdge, polygonBounds, rectPoints, sanitizeFrame, splitPanel } from './frames';

describe('comic frames', () => {
  it('splits a panel along a cut with a gutter', () => {
    const page = rectPoints(0, 0, 100, 200);
    // A horizontal cut at y = 80 with a 10 px gutter: top 0…75, bottom 85…200.
    const [top, bottom] = splitPanel(page, { x: -10, y: 80 }, { x: 110, y: 80 }, 10)!;
    expect(polygonBounds(top)).toEqual({ x: 0, y: 0, w: 100, h: 75 });
    expect(polygonBounds(bottom)).toEqual({ x: 0, y: 85, w: 100, h: 115 });
    // A vertical cut: left first. A slanted cut keeps both parts' area.
    const [left] = splitPanel(page, { x: 40, y: 250 }, { x: 40, y: -50 }, 0)!;
    expect(polygonBounds(left).w).toBe(40);
    const [a, b] = splitPanel(page, { x: 0, y: 50 }, { x: 100, y: 150 }, 0)!;
    expect(Math.abs(area(a)) + Math.abs(area(b))).toBeCloseTo(20000, 6);
    // A line beside the panel divides nothing.
    expect(splitPanel(page, { x: 150, y: 0 }, { x: 150, y: 200 }, 0)).toBeNull();
  });

  it('divides a panel equally with gutters, row by row', () => {
    const parts = divideEqually(rectPoints(0, 0, 110, 70), 2, 3, 10, 5);
    expect(parts).toHaveLength(6);
    expect(polygonBounds(parts[0])).toEqual({ x: 0, y: 0, w: 50, h: 20 });
    expect(polygonBounds(parts[5])).toEqual({ x: 60, y: 50, w: 50, h: 20 });
  });

  it('measures the distance to a frame edge and reads frames from files', () => {
    expect(distanceToEdge(rectPoints(0, 0, 100, 100), { x: 50, y: 3 })).toBe(3);
    expect(sanitizeFrame({ panels: [{ points: [{ x: 1 }, {}, { y: 2 }] }], lineWidth: -1 })).toMatchObject({ lineWidth: 0, draw: true, panels: [{ points: [{ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 2 }] }] });
    expect(sanitizeFrame({ panels: [{ points: [{ x: 1 }] }] })).toBeUndefined();
  });
});
