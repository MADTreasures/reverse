import { describe, expect, it } from 'vitest';
import { gradientT, renderGradient, sanitizeGradientFill, type GradientSpec } from './gradient';

const spec = (patch: Partial<GradientSpec> = {}): GradientSpec => ({
  stops: [
    { pos: 0, color: 'main', opacity: 1 },
    { pos: 1, color: 'sub', opacity: 1 },
  ],
  shape: 'line',
  edge: 'none',
  dither: false,
  ...patch,
});

describe('gradient tool', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 0 };

  it('measures the position along lines, circles and ellipses', () => {
    expect(gradientT(spec(), a, b, 25, 40)).toBeCloseTo(0.25, 6);
    expect(gradientT(spec({ shape: 'circle' }), a, b, 0, 50)).toBeCloseTo(0.5, 6);
    // Ellipses are half as high: 25 px across is as far as 50 px along.
    expect(gradientT(spec({ shape: 'ellipse' }), a, b, 0, 25)).toBeCloseTo(0.5, 6);
  });

  it('applies the edge rule outside the dragged length', () => {
    expect(gradientT(spec(), a, b, 150, 0)).toBe(1);
    expect(gradientT(spec({ edge: 'repeat' }), a, b, 125, 0)).toBeCloseTo(0.25, 6);
    expect(gradientT(spec({ edge: 'reverse' }), a, b, 125, 0)).toBeCloseTo(0.75, 6);
    expect(gradientT(spec({ edge: 'clear' }), a, b, 125, 0)).toBeNull();
    expect(gradientT(spec({ edge: 'clear' }), a, b, -1, 0)).toBeNull();
  });

  it('renders the drawing colours along the drag and leaves "do not draw" areas empty', () => {
    const data = new Uint8ClampedArray(200 * 1 * 4);
    renderGradient(data, 200, 1, 0, 0, spec({ edge: 'clear' }), a, b, '#000000', '#ff0000');
    expect([...data.slice(0, 4)]).toEqual([1, 0, 0, 255]);
    expect(data[99 * 4]).toBeGreaterThan(250);
    expect(data[150 * 4 + 3]).toBe(0);
    expect(sanitizeGradientFill({ shape: 'x', stops: [{ color: 'nope' }] })).toMatchObject({ shape: 'line', edge: 'none', stops: [{ pos: 0, color: '#000000' }, { pos: 1 }] });
  });
});
