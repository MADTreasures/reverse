import { describe, expect, it } from 'vitest';
import { gradientLut, sampleGradient } from './gradient';
import { applyCorrection, CORRECTIONS, curveTable, defaultCorrection, histogram, levelsTable, posterizeTable, type Correction } from './tonal';

const px = (...rgba: number[]) => new Uint8ClampedArray(rgba);
const run = (c: Correction, ...rgba: number[]) => {
  const d = px(...rgba);
  applyCorrection(d, c);
  return [...d];
};

describe('tonal corrections', () => {
  it('leave pixels unchanged with default settings (alpha always kept)', () => {
    const sample = [12, 130, 250, 77, 200, 40, 90, 255];
    for (const { type } of CORRECTIONS) {
      if (type === 'reverse' || type === 'posterize' || type === 'binarize' || type === 'gradientMap') continue;
      const out = run(defaultCorrection(type), ...sample);
      out.forEach((v, i) => expect(Math.abs(v - sample[i]), `${type}[${i}]`).toBeLessThanOrEqual(1));
    }
  });

  it('reverse gradient inverts RGB like the manual example', () => {
    expect(run({ type: 'reverse' }, 100, 255, 0, 128)).toEqual([155, 0, 255, 128]);
  });

  it('posterizes to the given number of levels', () => {
    const t = posterizeTable(2);
    expect([t[0], t[100], t[200], t[255]]).toEqual([0, 0, 255, 255]);
    expect(new Set(posterizeTable(4)).size).toBe(4);
  });

  it('binarizes by brightness', () => {
    expect(run({ type: 'binarize', threshold: 128 }, 100, 100, 100, 255, 200, 200, 200, 9)).toEqual([0, 0, 0, 255, 255, 255, 255, 9]);
  });

  it('level correction maps input shadows/highlights to the output range', () => {
    const t = levelsTable({ inBlack: 50, inWhite: 200, gamma: 1, outBlack: 10, outWhite: 240 });
    expect([t[0], t[50], t[125], t[200], t[255]]).toEqual([10, 10, 125, 240, 240]);
    // Gamma above 1 brightens the midtones.
    expect(levelsTable({ inBlack: 0, inWhite: 255, gamma: 2, outBlack: 0, outWhite: 255 })[128]).toBeGreaterThan(170);
  });

  it('tone curves pass through their points without overshooting', () => {
    const id = curveTable([
      [0, 0],
      [255, 255],
    ]);
    expect([...id]).toEqual([...Array(256).keys()]);
    const s = curveTable([
      [0, 0],
      [64, 30],
      [192, 225],
      [255, 255],
    ]);
    expect(s[64]).toBe(30);
    expect(s[192]).toBe(225);
    for (let i = 1; i < 256; i++) expect(s[i]).toBeGreaterThanOrEqual(s[i - 1]);
  });

  it('saturation −100 gives greys, hue +120 turns red into green', () => {
    const [r, g, b] = run({ type: 'hsl', hue: 0, saturation: -100, luminosity: 0 }, 200, 50, 50, 255);
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(run({ type: 'hsl', hue: 120, saturation: 0, luminosity: 0 }, 255, 0, 0, 255)).toEqual([0, 255, 0, 255]);
    expect(run({ type: 'hsl', hue: 0, saturation: 0, luminosity: 100 }, 10, 20, 30, 255)).toEqual([255, 255, 255, 255]);
  });

  it('color balance shifts towards red in the midtones and can keep the brightness', () => {
    const plain = run({ type: 'colorBalance', shadows: [0, 0, 0], midtones: [100, 0, 0], highlights: [0, 0, 0], preserveLuminosity: false }, 128, 128, 128, 255);
    expect(plain[0]).toBeGreaterThan(180);
    expect(plain[1]).toBe(128);
    const kept = run({ type: 'colorBalance', shadows: [0, 0, 0], midtones: [100, 0, 0], highlights: [0, 0, 0], preserveLuminosity: true }, 128, 128, 128, 255);
    expect(kept[0]).toBeGreaterThan(kept[1]);
    expect(Math.abs((Math.max(...kept.slice(0, 3)) + Math.min(...kept.slice(0, 3))) / 2 - 128)).toBeLessThanOrEqual(1);
  });

  it('gradient maps replace brightness by the gradient colour', () => {
    const stops = [
      { pos: 0, color: '#ff0000', opacity: 1 },
      { pos: 1, color: '#0000ff', opacity: 1 },
    ];
    expect(run({ type: 'gradientMap', stops }, 0, 0, 0, 255)).toEqual([255, 0, 0, 255]);
    expect(run({ type: 'gradientMap', stops }, 255, 255, 255, 255)).toEqual([0, 0, 255, 255]);
    // A transparent node leaves the original colour.
    expect(run({ type: 'gradientMap', stops: [{ pos: 0, color: '#ff0000', opacity: 0 }] }, 10, 20, 30, 255)).toEqual([10, 20, 30, 255]);
  });

  it('samples gradients between nodes', () => {
    const stops = [
      { pos: 0, color: '#000000', opacity: 1 },
      { pos: 1, color: '#ffffff', opacity: 0 },
    ];
    expect(sampleGradient(stops, 0.5)).toEqual([127.5, 127.5, 127.5, 0.5]);
    expect([...gradientLut(stops).slice(255 * 4)]).toEqual([255, 255, 255, 0]);
  });

  it('counts brightness for histograms, skipping transparent pixels', () => {
    const h = histogram(px(0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 0));
    expect(h[0]).toBe(1);
    expect(h[255]).toBe(1);
  });
});
