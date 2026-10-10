import { describe, expect, it } from 'vitest';
import { edgeMap, hasAny, inkMap, magnetRadius, snapToEdge } from './magnet';

const W = 20;
const H = 10;

/** A vertical black line at x = 10 on a transparent layer (or on white with `paper`). */
function line(paper = false): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) if (paper) px.set([255, 255, 255, 255], i * 4);
  for (let y = 0; y < H; y++) px.set([0, 0, 0, 255], (y * W + 10) * 4);
  return px;
}

describe('magnetic lasso', () => {
  it('finds ink on transparent layers and dark lines on white', () => {
    for (const paper of [false, true]) {
      const ink = inkMap(line(paper), W, H);
      expect(ink[5 * W + 10]).toBe(1);
      expect(ink[5 * W + 3]).toBe(0);
    }
    expect(hasAny(inkMap(new Uint8ClampedArray(W * H * 4), W, H))).toBe(false);
  });

  it('snaps to the empty side of the nearest line, only within the radius', () => {
    const edges = edgeMap(inkMap(line(), W, H), W, H);
    // The outline: the columns either side of the line.
    expect(edges[5 * W + 9]).toBe(1);
    expect(edges[5 * W + 11]).toBe(1);
    expect(edges[5 * W + 10]).toBe(0);
    expect(snapToEdge(edges, W, H, 6.2, 5.5, 4)).toEqual({ x: 9.5, y: 5.5 });
    expect(snapToEdge(edges, W, H, 14.6, 2.5, 4)).toEqual({ x: 11.5, y: 2.5 });
    // Too far: the point stays.
    expect(snapToEdge(edges, W, H, 2, 5, 4)).toEqual({ x: 2, y: 5 });
    expect(magnetRadius(5)).toBeGreaterThan(magnetRadius(1));
  });
});
