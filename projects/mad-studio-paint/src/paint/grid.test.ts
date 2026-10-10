import { describe, expect, it } from 'vitest';
import { defaultGrid, gridLines, gridOrigin, nearestLine, rulerTicks, sanitizeGrid } from './grid';

describe('grid and ruler bar', () => {
  it('defaults to 10 mm with 4 divisions from the top left', () => {
    expect(defaultGrid(350)).toEqual({ origin: 'topLeft', x: 0, y: 0, gap: 138, divisions: 4 });
    expect(defaultGrid(72).gap).toBe(28);
  });

  it('starts at the chosen point', () => {
    const g = defaultGrid(72);
    expect(gridOrigin(g, 400, 300)).toEqual({ x: 0, y: 0 });
    expect(gridOrigin({ ...g, origin: 'center' }, 400, 300)).toEqual({ x: 200, y: 150 });
    expect(gridOrigin({ ...g, origin: 'bottomRight' }, 400, 300)).toEqual({ x: 400, y: 300 });
    expect(gridOrigin({ ...g, origin: 'custom', x: 7, y: -3 }, 400, 300)).toEqual({ x: 7, y: -3 });
  });

  it('lists main lines and subdivisions in a range', () => {
    const lines = gridLines(0, 40, 4, 0, 85);
    expect(lines.map((l) => l.pos)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80]);
    expect(lines.filter((l) => l.major).map((l) => l.pos)).toEqual([0, 40, 80]);
    // From the centre the lines go both ways.
    expect(gridLines(200, 100, 1, 0, 400).map((l) => l.pos)).toEqual([0, 100, 200, 300, 400]);
    expect(gridLines(5, 10, 2, 0, 20).map((l) => [l.pos, l.major])).toEqual([
      [0, false],
      [5, true],
      [10, false],
      [15, true],
      [20, false],
    ]);
  });

  it('finds the nearest line for snapping', () => {
    expect(nearestLine(0, 40, 4, 23)).toBe(20);
    expect(nearestLine(0, 40, 4, 26)).toBe(30);
    expect(nearestLine(200, 100, 1, 140)).toBe(100);
  });

  it('keeps file settings sensible', () => {
    expect(sanitizeGrid(null, 72)).toBeUndefined();
    expect(sanitizeGrid({ origin: 'nowhere', gap: -5, divisions: 1000 }, 72)).toEqual({ origin: 'topLeft', x: 0, y: 0, gap: 1, divisions: 100 });
  });

  it('labels the ruler at readable distances', () => {
    // At 100 % labels every 100 px with tenths in between.
    const t = rulerTicks(0, 0, 250, 1);
    expect(t.filter((x) => x.label).map((x) => [x.pos, x.label])).toEqual([
      [0, '0'],
      [100, '100'],
      [200, '200'],
    ]);
    expect(t.find((x) => x.pos === 50)?.size).toBe('mid');
    expect(t.find((x) => x.pos === 10)?.size).toBe('short');
    // Zoomed out to 12.5 %: labels every 500 px.
    expect(rulerTicks(0, 0, 1200, 0.125).filter((x) => x.label).map((x) => x.label)).toEqual(['0', '500', '1000']);
    // Counted from the start point.
    expect(rulerTicks(150, 0, 300, 1).filter((x) => x.label).map((x) => [x.pos, x.label])).toEqual([
      [50, '-100'],
      [150, '0'],
      [250, '100'],
    ]);
  });
});
