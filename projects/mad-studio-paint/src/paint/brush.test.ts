import { describe, expect, it } from 'vitest';
import { bendCurve, curveFromSamples, evalPressureCurve, LINEAR, monotoneCurve, sanitizeCurve01 } from './curve';
import { amountAt, densityFactor, mixInto, nextDab } from './mixing';
import { penTilt, seededRandom, taperFactor } from './stroke';

describe('pressure graphs', () => {
  it('pass through their points smoothly and stay inside 0..1', () => {
    const soft: [number, number][] = [
      [0, 0],
      [0.5, 0.25],
      [1, 1],
    ];
    expect(evalPressureCurve(soft, 0.5)).toBeCloseTo(0.25, 6);
    expect(evalPressureCurve(soft, 0.25)).toBeLessThan(0.25);
    expect(evalPressureCurve(LINEAR, 0.37)).toBe(0.37);
    expect(evalPressureCurve(soft, 2)).toBe(1);
    const f = monotoneCurve(soft);
    for (let x = 0.01; x <= 1; x += 0.01) expect(f(x)).toBeGreaterThanOrEqual(f(x - 0.01));
  });

  it('"Stronger" gives more output for the same pressure, "Lighter" less', () => {
    expect(evalPressureCurve(bendCurve(LINEAR, 0.25), 0.5)).toBeGreaterThan(0.6);
    expect(evalPressureCurve(bendCurve(LINEAR, -0.25), 0.5)).toBeLessThan(0.4);
  });

  it('fit the pressure range a user draws with', () => {
    const light = Array.from({ length: 100 }, (_, i) => 0.1 + (i / 100) * 0.3);
    const c = curveFromSamples(light)!;
    expect(evalPressureCurve(c, 0.4)).toBeGreaterThan(0.85);
    expect(curveFromSamples([0.5])).toBeNull();
  });

  it('are validated when read back', () => {
    expect(sanitizeCurve01('x')).toBeNull();
    expect(sanitizeCurve01([[0, 0], [2, -1], 'junk'])).toEqual([
      [0, 0],
      [1, 0],
    ]);
  });
});

describe('brush dynamics', () => {
  it('starting and ending taper the size at both ends', () => {
    expect(taperFactor(0, 100, 10, 20)).toBe(0);
    expect(taperFactor(50, 100, 10, 20)).toBe(1);
    expect(taperFactor(5, 100, 10, 20)).toBeCloseTo(Math.SQRT1_2, 5);
    expect(taperFactor(100, 100, 10, 20)).toBe(0);
    // While drawing the length is unknown: only the start tapers.
    expect(taperFactor(50, Infinity, 10, 20)).toBe(1);
  });

  it('reads pen tilt from tiltX/tiltY or altitude/azimuth', () => {
    expect(penTilt({ tiltX: 0, tiltY: 0 }).tilt).toBe(0);
    expect(penTilt({ tiltX: 60, tiltY: 0 }).tilt).toBeCloseTo(1, 5);
    expect(penTilt({ tiltX: 0, tiltY: 30 }).azimuth).toBeCloseTo(Math.PI / 2, 5);
    const t = penTilt({ altitudeAngle: Math.PI / 4, azimuthAngle: 1 });
    expect(t.tilt).toBeCloseTo(0.75, 6);
    expect(t.azimuth).toBe(1);
  });

  it('seeded randomness repeats exactly (strokes are redrawn at pen-up)', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});

describe('color mixing', () => {
  const red = { r: 255, g: 0, b: 0, a: 1 };
  const blue = { r: 0, g: 0, b: 255, a: 1 };
  const clear = { r: 0, g: 0, b: 0, a: 0 };

  it('keeps the pure colour at the start of a stroke, then settles to the amount of paint', () => {
    expect(amountAt(0, 20, 0.5, 0.4)).toBe(1);
    expect(amountAt(10000, 20, 0.5, 0.4)).toBeCloseTo(0.4, 5);
    expect(amountAt(0, 20, 0, 0.4)).toBe(0.4);
  });

  it('mixes in the colour under the brush, ignoring transparent pixels', () => {
    expect(mixInto(red, blue, 0.5)).toEqual({ r: 127.5, g: 0, b: 127.5, a: 1 });
    expect(mixInto(red, clear, 0.2)).toEqual(red);
    expect(densityFactor(0, 1)).toBe(1);
    expect(densityFactor(0, 0.3)).toBe(0.3);
  });

  it('running color does not carry paint along, blend does', () => {
    const running = nextDab('running', red, red, blue, 0.5);
    expect(running.carried).toEqual(red);
    const blend = nextDab('blend', red, red, blue, 0.5);
    expect(blend.carried).toEqual(blend.color);
    const again = nextDab('blend', red, blend.carried, blue, 0.5);
    expect(again.color.b).toBeGreaterThan(blend.color.b);
  });
});
