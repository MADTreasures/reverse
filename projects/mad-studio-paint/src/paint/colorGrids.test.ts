import { describe, expect, it } from 'vitest';
import { hexToRgb, rgbToHex, rgbToHls, rgbToHsv } from '../model/color';
import { approximateColor, DEFAULT_CORNERS, intermediateColor, middleTile, sanitizeApprox, sanitizeCorners, sanitizeTileGrid, shiftColor, tilesAcross } from './colorGrids';

const rgb = (hex: string) => hexToRgb(hex)!;

describe('Intermediate Color', () => {
  const corners = ['#ffffff', '#ff0000', '#0000ff', '#000000'].map(rgb);
  it('has the corner colours in the corner tiles and mixes between them', () => {
    expect(rgbToHex(intermediateColor(corners, 0, 0, 5, 5))).toBe('#ffffff');
    expect(rgbToHex(intermediateColor(corners, 4, 0, 5, 5))).toBe('#ff0000');
    expect(rgbToHex(intermediateColor(corners, 0, 4, 5, 5))).toBe('#0000ff');
    expect(rgbToHex(intermediateColor(corners, 4, 4, 5, 5))).toBe('#000000');
    // Half way along the top edge: white and red.
    expect(intermediateColor(corners, 2, 0, 5, 5)).toEqual({ r: 255, g: 128, b: 128 });
    // The middle: the average of all four.
    expect(intermediateColor(corners, 2, 2, 5, 5)).toEqual({ r: 128, g: 64, b: 128 });
  });
});

describe('Approximate Color', () => {
  const base = rgb('#3a9a40');
  const s = { x: { axis: 'value' as const, range: 0.4 }, y: { axis: 'saturation' as const, range: 0.4 } };

  it('has the drawing colour in the middle tile', () => {
    const m = middleTile(21, 15);
    expect(m).toEqual({ col: 10, row: 7 });
    expect(approximateColor(base, s, m.col, m.row, 21, 15)).toEqual(base);
    // An even count: left of and above the middle.
    expect(middleTile(20, 14)).toEqual({ col: 9, row: 6 });
  });

  it('changes the x property to the right and the y property upwards, by half the range at the edges', () => {
    const v0 = rgbToHsv(base);
    const right = rgbToHsv(approximateColor(base, s, 20, 7, 21, 15));
    expect(right.v).toBeCloseTo(Math.min(1, v0.v + 0.2), 2);
    const left = rgbToHsv(approximateColor(base, s, 0, 7, 21, 15));
    expect(left.v).toBeCloseTo(v0.v - 0.2, 2);
    const top = rgbToHsv(approximateColor(base, s, 10, 0, 21, 15));
    expect(top.s).toBeCloseTo(Math.min(1, v0.s + 0.2), 1);
    const bottom = rgbToHsv(approximateColor(base, s, 10, 14, 21, 15));
    expect(bottom.s).toBeCloseTo(v0.s - 0.2, 1);
  });

  it('shifts hue round, luminance, and the RGB channels within their range', () => {
    expect(rgbToHex(shiftColor(rgb('#ff0000'), 'hue', 1 / 3))).toBe('#00ff00');
    expect(rgbToHex(shiftColor(rgb('#ff0000'), 'hue', -1 / 3))).toBe('#0000ff');
    expect(rgbToHls(shiftColor(rgb('#808080'), 'luminance', 0.25)).l).toBeCloseTo(0.75, 1);
    expect(shiftColor(rgb('#f0f0f0'), 'red', 0.5)).toEqual({ r: 255, g: 240, b: 240 });
    expect(shiftColor(rgb('#101010'), 'blue', -0.5)).toEqual({ r: 16, g: 16, b: 0 });
  });
});

describe('colour grid settings', () => {
  it('count tiles per row by divisions or by tile width', () => {
    expect(tilesAcross({ mode: 'divisions', divisions: 30, tileWidth: 10, showGrid: true }, 50)).toBe(30);
    // 10 pt tiles are 13.3 px wide: 15 of them in 200 px.
    expect(tilesAcross({ mode: 'width', divisions: 30, tileWidth: 10, showGrid: true }, 200)).toBe(15);
    expect(tilesAcross({ mode: 'width', divisions: 30, tileWidth: 15, showGrid: true }, 5)).toBe(1);
  });

  it('are checked when read back', () => {
    expect(sanitizeTileGrid({ mode: 'width', divisions: 12, tileWidth: 7, showGrid: false })).toEqual({ mode: 'width', divisions: 20, tileWidth: 7, showGrid: false });
    expect(sanitizeCorners(['#FFF', 3, '#123456'])).toEqual(['#ffffff', DEFAULT_CORNERS[1], '#123456', DEFAULT_CORNERS[3]]);
    expect(sanitizeApprox({ x: { axis: 'hue', range: 2 }, y: { axis: 'nope' } })).toMatchObject({ x: { axis: 'hue', range: 1 }, y: { axis: 'saturation', range: 0.4 } });
  });
});
