import { describe, expect, it } from 'vitest';
import { contentRect, createImg, gaussianBlur, premultiply, sample, unpremultiply, type Img } from './core';
import { blur, lensBlur, motionBlur, radialBlur, sharpen, smoothing, spinBlur, unsharpMask } from './blur';
import { adjustLineWidth, distanceTransform, removeDust } from './correction';
import { effectEllipse, fisheye, pinch, polarCoordinates, twirl, wave, zigzag } from './distort';
import { artistic, chromaticAberration, crystallize, mosaic, noise, normalMap, pencilDrawing, removeJpegNoise, retroFilm } from './effect';
import { defaultValues, FILTERS, filterRegion, runFilter, sanitizeValues, type FilterId } from './index';
import { perlinNoise } from './render';

const W = 40;
const H = 40;

function img(w = W, h = H, fill?: [number, number, number, number]): Img {
  const i = createImg(w, h);
  if (fill) for (let p = 0; p < i.data.length; p += 4) i.data.set(fill, p);
  return i;
}
const px = (i: Img, x: number, y: number) => Array.from(i.data.subarray((y * i.width + x) * 4, (y * i.width + x) * 4 + 4));
const setPx = (i: Img, x: number, y: number, c: number[]) => i.data.set(c, (y * i.width + x) * 4);
const alphaAt = (i: Img, x: number, y: number) => i.data[(y * i.width + x) * 4 + 3];
const same = (a: Img, b: Img, tol = 1) => a.data.every((v, k) => Math.abs(v - b.data[k]) <= tol);

/** A smooth colourful test picture. */
function picture(w = W, h = H): Img {
  const i = img(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setPx(i, x, y, [(x * 255) / (w - 1), (y * 255) / (h - 1), 128 + 100 * Math.sin(x / 5), 255]);
  return i;
}

describe('filter core', () => {
  it('premultiplies and back without changing colours', () => {
    const p = picture();
    setPx(p, 3, 3, [200, 100, 50, 128]);
    const back = unpremultiply(premultiply(p));
    expect(same(back, p, 1)).toBe(true);
  });

  it('samples pixel centres exactly and blends between them', () => {
    const p = img(2, 1);
    setPx(p, 0, 0, [0, 0, 0, 255]);
    setPx(p, 1, 0, [200, 200, 200, 255]);
    const out = new Float32Array(4);
    sample(premultiply(p), 0.5, 0.5, 'clamp', out);
    expect(out[0]).toBe(0);
    sample(premultiply(p), 1, 0.5, 'clamp', out);
    expect(out[0]).toBeCloseTo(100);
    sample(premultiply(p), 5, 0.5, 'transparent', out);
    expect(out[3]).toBe(0);
    sample(premultiply(p), 2.5, 0.5, 'wrap', out);
    expect(out[0]).toBe(0);
  });

  it('keeps a flat image flat under the Gaussian blur', () => {
    const flat = img(20, 20, [90, 120, 150, 255]);
    for (const sigma of [0.7, 2.5, 9]) expect(same(unpremultiply(gaussianBlur(premultiply(flat), sigma)), flat)).toBe(true);
  });

  it('finds the bounds of the content', () => {
    const p = img();
    expect(contentRect(p)).toBeNull();
    setPx(p, 5, 7, [1, 2, 3, 4]);
    setPx(p, 9, 8, [1, 2, 3, 4]);
    expect(contentRect(p)).toEqual({ x: 5, y: 7, w: 5, h: 2 });
  });
});

describe('blur filters', () => {
  const dot = () => {
    const p = img();
    setPx(p, 20, 20, [255, 0, 0, 255]);
    return p;
  };

  it('Blur spreads a dot without darkening its colour into the transparency', () => {
    const out = blur(dot());
    expect(alphaAt(out, 21, 20)).toBeGreaterThan(0);
    expect(alphaAt(out, 20, 20)).toBeLessThan(255);
    // Premultiplied averaging: the spread pixels are still pure red.
    expect(px(out, 21, 20).slice(0, 3)).toEqual([255, 0, 0]);
  });

  it('Motion blur streaks along the angle only', () => {
    const both = motionBlur(dot(), 0, 0, 10, 0, 'both', 'box');
    expect(alphaAt(both, 24, 20)).toBeGreaterThan(0);
    expect(alphaAt(both, 16, 20)).toBeGreaterThan(0);
    expect(alphaAt(both, 20, 24)).toBe(0);
    // Forward trails along the angle (to the right at 0°).
    const fwd = motionBlur(dot(), 0, 0, 10, 0, 'forward', 'box');
    expect(alphaAt(fwd, 26, 20)).toBeGreaterThan(0);
    expect(alphaAt(fwd, 16, 20)).toBe(0);
    // 90° is upwards.
    const up = motionBlur(dot(), 0, 0, 10, 90, 'forward', 'smooth');
    expect(alphaAt(up, 20, 15)).toBeGreaterThan(0);
    expect(alphaAt(up, 20, 25)).toBe(0);
    expect(alphaAt(up, 20, 19)).toBeGreaterThan(alphaAt(up, 20, 13));
  });

  it('Radial blur streaks away from the centre, Spin blur around it', () => {
    const p = img();
    setPx(p, 30, 20, [0, 0, 255, 255]);
    const radial = radialBlur(p, 0, 0, 10, 20, 100, 'outward', 'box');
    expect(alphaAt(radial, 33, 20)).toBeGreaterThan(0);
    expect(alphaAt(radial, 30, 23)).toBe(0);
    expect(alphaAt(radial, 27, 20)).toBe(0);
    const spin = spinBlur(p, 0, 0, 10, 20, 30, 'both', 1, 0);
    expect(alphaAt(spin, 30, 23)).toBeGreaterThan(0);
    expect(alphaAt(spin, 30, 17)).toBeGreaterThan(0);
    expect(alphaAt(spin, 34, 20)).toBe(0);
  });

  it('Lens blur spreads a highlight into the aperture shape', () => {
    const p = img(41, 41, [0, 0, 0, 255]);
    setPx(p, 20, 20, [255, 255, 255, 255]);
    const out = lensBlur(p, 8, 'square', 100, 0, 0);
    // Inside the aperture the highlight shows, outside it does not.
    expect(px(out, 24, 20)[0]).toBeGreaterThan(0);
    expect(px(out, 20, 31)[0]).toBe(0);
    // A square (rotated so a corner points up): its diagonal reaches less far than straight up.
    expect(px(out, 20, 13)[0]).toBeGreaterThan(0);
    expect(px(out, 26, 14)[0]).toBe(0);
  });

  it('Smoothing softens hard edges and leaves flat areas', () => {
    const p = img(20, 20, [255, 255, 255, 255]);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 10; x++) setPx(p, x, y, [0, 0, 0, 255]);
    const out = smoothing(p);
    expect(px(out, 2, 10)).toEqual([0, 0, 0, 255]);
    expect(px(out, 17, 10)).toEqual([255, 255, 255, 255]);
    expect(px(out, 9, 10)[0]).toBeGreaterThan(0);
    expect(px(out, 10, 10)[0]).toBeLessThan(255);
  });

  it('Unsharp mask and Sharpen raise the contrast at edges only', () => {
    const p = img(20, 20, [200, 200, 200, 255]);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 10; x++) setPx(p, x, y, [60, 60, 60, 255]);
    const usm = unsharpMask(p, 4, 100, 0);
    expect(px(usm, 9, 10)[0]).toBeLessThan(60);
    expect(px(usm, 10, 10)[0]).toBeGreaterThan(200);
    expect(px(usm, 0, 10)[0]).toBe(60);
    expect(same(unsharpMask(p, 4, 100, 255), p)).toBe(true);
    const sh = sharpen(p, true);
    expect(px(sh, 9, 10)[0]).toBeLessThan(60);
    expect(px(sh, 2, 2)).toEqual([60, 60, 60, 255]);
  });
});

describe('effect filters', () => {
  it('Mosaic fills tiles anchored at the canvas origin with their average', () => {
    const p = picture();
    const out = mosaic(p, 3, 0, 10);
    // Layer x 3 is canvas x 3 → tile 0 spans local x 0..6, tile 1 local 7..16.
    expect(px(out, 0, 0)).toEqual(px(out, 6, 9));
    expect(px(out, 7, 0)).toEqual(px(out, 16, 9));
    expect(px(out, 6, 0)).not.toEqual(px(out, 7, 0));
  });

  it('Crystallize without randomness gives square cells of one colour', () => {
    const out = crystallize(picture(), 0, 0, W, H, 10, 0, false, 1);
    expect(px(out, 1, 1)).toEqual(px(out, 8, 8));
    expect(px(out, 1, 1)).not.toEqual(px(out, 11, 1));
    const tiled = crystallize(picture(), 0, 0, W, H, 10, 100, true, 3);
    expect(tiled.data.length).toBe(W * H * 4);
  });

  it('Noise keeps the transparency and repeats with the same seed', () => {
    const p = img(20, 20, [128, 128, 128, 255]);
    setPx(p, 0, 0, [0, 0, 0, 0]);
    const a = noise(p, 0, 0, 50, false, 7);
    expect(same(a, noise(p, 0, 0, 50, false, 7), 0)).toBe(true);
    expect(alphaAt(a, 0, 0)).toBe(0);
    expect(alphaAt(a, 5, 5)).toBe(255);
    expect(a.data.some((v, k) => k % 4 !== 3 && v !== 128)).toBe(true);
    const g = noise(p, 0, 0, 50, true, 7);
    for (let k = 4; k < g.data.length; k += 4) expect(g.data[k]).toBe(g.data[k + 2]);
  });

  it('Chromatic aberration shifts red and blue apart', () => {
    const p = img(30, 10);
    for (let y = 0; y < 10; y++) setPx(p, 15, y, [255, 255, 255, 255]);
    const out = chromaticAberration(p, 0, 0, 15, 5, false, 50, 0);
    // Lateral at 0°: red moves right, blue left.
    const right = px(out, 21, 5);
    const left = px(out, 9, 5);
    expect(right[0]).toBeGreaterThan(200);
    expect(right[2]).toBeLessThan(50);
    expect(left[2]).toBeGreaterThan(200);
    expect(left[0]).toBeLessThan(50);
  });

  it('Normal map: flat is straight up, slopes tilt the normal', () => {
    const flat = normalMap(img(10, 10, [128, 128, 128, 255]), 50, true);
    expect(px(flat, 5, 5)).toEqual([128, 128, 255, 255]);
    const ramp = img(10, 10);
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) setPx(ramp, x, y, [x * 25, x * 25, x * 25, 255]);
    const n = normalMap(ramp, 50, true);
    // Rising to the right: the normal leans left.
    expect(px(n, 5, 5)[0]).toBeLessThan(128);
    expect(px(n, 5, 5)[1]).toBe(128);
  });

  it('Pencil drawing leaves white paper white and hatches dark areas', () => {
    const white = pencilDrawing(img(20, 20, [255, 255, 255, 255]), 0, 0, { outline: true, hatching: true, size: 3, roughness: 40, angle: 45, grayscale: true }, 1);
    expect(white.data.every((v) => v === 255)).toBe(true);
    const dark = pencilDrawing(img(20, 20, [40, 40, 40, 255]), 0, 0, { outline: false, hatching: true, size: 3, roughness: 0, angle: 0, grayscale: true }, 1);
    expect(dark.data.some((v, k) => k % 4 === 0 && v < 150)).toBe(true);
    expect(dark.data.some((v, k) => k % 4 === 0 && v > 200)).toBe(true);
  });

  it('Remove jpeg noise evens out speckles but keeps flat areas', () => {
    const p = img(12, 12, [120, 120, 120, 255]);
    expect(same(removeJpegNoise(p), p)).toBe(true);
    setPx(p, 6, 6, [135, 120, 120, 255]);
    expect(px(removeJpegNoise(p), 6, 6)[0]).toBeLessThan(135);
  });

  it('Retro film tints grey sepia', () => {
    const out = retroFilm(img(10, 10, [128, 128, 128, 255]), 0, 0, 10, 10, 5, 5, 'sepia', 0, 0, 1);
    const [r, g, b] = px(out, 5, 5);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it('Artistic flattens colours and extracts lines', () => {
    const colour = artistic(picture(), { process: 'colorOnly', lineWidth: 1, lineSimplicity: 0, lineDensity: 50, lineOpacity: 100, lineAntialias: 0, colorBlending: 0, colorBlur: 0, colors: 3 });
    expect(colour.data.every((v, k) => k % 4 === 3 || [0, 128, 255].includes(v))).toBe(true);
    const edge = img(20, 20, [255, 255, 255, 255]);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 10; x++) setPx(edge, x, y, [0, 0, 0, 255]);
    const lines = artistic(edge, { process: 'linesOnly', lineWidth: 1, lineSimplicity: 0, lineDensity: 50, lineOpacity: 100, lineAntialias: 0, colorBlending: 0, colorBlur: 0, colors: 8 });
    expect(alphaAt(lines, 2, 10)).toBe(0);
    expect(alphaAt(lines, 9, 10) + alphaAt(lines, 10, 10)).toBeGreaterThan(200);
  });
});

describe('distort filters', () => {
  const full = { x: 0, y: 0, w: W, h: H };
  const e = effectEllipse(20, 20, full, 'specify', 15, 0);

  it('does nothing at zero strength', () => {
    const p = picture();
    expect(same(pinch(p, full, e, 0), p)).toBe(true);
    expect(same(twirl(p, full, e, 0, 50), p)).toBe(true);
    expect(same(zigzag(p, full, full, 0, 0, 10), p)).toBe(true);
    expect(same(wave(p, full, { shape: 'sine', generators: 3, wavelengthMin: 5, wavelengthMax: 20, amplitudeMin: 0, amplitudeMax: 0, horizontal: 100, vertical: 100, wrap: true, seed: 1 }), p)).toBe(true);
  });

  it('works inside the area only', () => {
    const p = picture();
    const out = twirl(p, full, e, 180, 25);
    expect(px(out, 1, 1)).toEqual(px(p, 1, 1));
    expect(px(out, 24, 20)).not.toEqual(px(p, 24, 20));
    // Shape narrows the ellipse.
    const narrow = effectEllipse(0, 0, full, 'specify', 100, 100);
    expect(narrow.rx).toBeCloseTo(10);
    expect(narrow.ry).toBe(100);
    expect(effectEllipse(5, 5, { x: 0, y: 0, w: 30, h: 10 }, 'selection', 0, 0)).toEqual({ cx: 5, cy: 5, rx: 15, ry: 5 });
  });

  it('Pinch pulls the image towards the centre', () => {
    const p = img();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) setPx(p, x, y, Math.hypot(x - 20, y - 20) < 6 ? [255, 0, 0, 255] : [0, 0, 255, 255]);
    const out = pinch(p, full, e, 100);
    // The red disc shrinks: a pixel 5 px out is now blue.
    expect(px(out, 25, 20)[2]).toBeGreaterThan(200);
    expect(px(out, 20, 20)[0]).toBeGreaterThan(200);
  });

  it('Fish-eye leaves the outside of the lens transparent', () => {
    const out = fisheye(picture(), full, e, 50);
    expect(alphaAt(out, 1, 1)).toBe(0);
    expect(alphaAt(out, 20, 20)).toBe(255);
  });

  it('Polar coordinates there and back roughly restore the picture', () => {
    const p = picture(64, 64);
    const r = { x: 0, y: 0, w: 64, h: 64 };
    const round = polarCoordinates(polarCoordinates(p, r, r, 'rectToPolar'), r, r, 'polarToRect');
    // Away from the seam and the centre the picture comes back.
    const a = px(round, 20, 40);
    const b = px(p, 20, 40);
    for (let c = 0; c < 3; c++) expect(Math.abs(a[c] - b[c])).toBeLessThan(40);
    const sphere = polarCoordinates(p, r, r, 'spherize');
    expect(alphaAt(sphere, 1, 1)).toBe(0);
  });
});

describe('render and correction filters', () => {
  it('Perlin noise is grey, opaque, repeatable and moves with its offset', () => {
    const o = { scale: 20, amplitude: 60, attenuation: 50, repetition: 4, offsetX: 0, offsetY: 0 };
    const a = perlinNoise({ x: 0, y: 0, w: 30, h: 30 }, o);
    expect(a.data.every((v, k) => (k % 4 === 3 ? v === 255 : true))).toBe(true);
    expect(px(a, 3, 4)[0]).toBe(px(a, 3, 4)[2]);
    const values = new Set(Array.from(a.data.filter((_, k) => k % 4 === 0)));
    expect(values.size).toBeGreaterThan(20);
    const shifted = perlinNoise({ x: 0, y: 0, w: 30, h: 30 }, { ...o, offsetX: 10 });
    const moved = perlinNoise({ x: 10, y: 0, w: 30, h: 30 }, o);
    expect(same(shifted, moved, 0)).toBe(true);
  });

  it('computes exact distances', () => {
    const w = 23;
    const h = 17;
    const sites = new Uint8Array(w * h);
    const pts = [
      [3, 4],
      [20, 2],
      [11, 15],
    ];
    for (const [x, y] of pts) sites[y * w + x] = 1;
    const { d2, nearest } = distanceTransform(sites, w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const best = Math.min(...pts.map(([sx, sy]) => (sx - x) ** 2 + (sy - y) ** 2));
        expect(d2[y * w + x]).toBe(best);
        const n = nearest[y * w + x];
        expect((n % w - x) ** 2 + (Math.floor(n / w) - y) ** 2).toBe(best);
      }
  });

  it('Remove dust erases small specks and keeps lines', () => {
    const p = img();
    setPx(p, 5, 5, [0, 0, 0, 255]);
    setPx(p, 6, 5, [0, 0, 0, 255]);
    for (let x = 10; x < 35; x++) setPx(p, x, 20, [0, 0, 0, 255]);
    const out = removeDust(p, 3, 'transparent', [0, 0, 0]);
    expect(alphaAt(out, 5, 5)).toBe(0);
    expect(alphaAt(out, 20, 20)).toBe(255);
    // On white paper: dark specks turn white.
    const paper = img(20, 20, [255, 255, 255, 255]);
    setPx(paper, 4, 4, [30, 30, 30, 255]);
    expect(px(removeDust(paper, 3, 'white', [0, 0, 0]), 4, 4)).toEqual([255, 255, 255, 255]);
    // Holes in an opaque area are filled with the colour around them (or the drawing colour).
    const solid = img(20, 20, [200, 50, 50, 255]);
    setPx(solid, 8, 8, [0, 0, 0, 0]);
    expect(px(removeDust(solid, 3, 'fillSurrounding', [0, 0, 0]), 8, 8)).toEqual([200, 50, 50, 255]);
    expect(px(removeDust(solid, 3, 'fillColor', [1, 2, 3]), 8, 8)).toEqual([1, 2, 3, 255]);
  });

  it('Adjust line width thickens and narrows lines', () => {
    const p = img();
    for (let y = 5; y < 35; y++) setPx(p, 20, y, [10, 20, 30, 255]);
    const thick = adjustLineWidth(p, true, 1, false);
    expect(px(thick, 21, 20)).toEqual([10, 20, 30, 255]);
    expect(px(thick, 19, 20)).toEqual([10, 20, 30, 255]);
    expect(alphaAt(thick, 23, 20)).toBe(0);
    const wide = img();
    for (let y = 5; y < 35; y++) for (let x = 15; x < 22; x++) setPx(wide, x, y, [0, 0, 0, 255]);
    const narrow = adjustLineWidth(wide, false, 2, false);
    expect(alphaAt(narrow, 15, 20)).toBe(0);
    expect(alphaAt(narrow, 18, 20)).toBe(255);
    // A one-pixel line survives narrowing with "At least 1 pixel".
    expect(alphaAt(adjustLineWidth(p, false, 3, true), 20, 20)).toBe(255);
    expect(alphaAt(adjustLineWidth(p, false, 3, false), 20, 20)).toBe(0);
  });
});

describe('the Filter menu', () => {
  it('lists the reference groups in order with unique ids', () => {
    expect(new Set(FILTERS.map((f) => f.id)).size).toBe(FILTERS.length);
    const groups = [...new Set(FILTERS.map((f) => f.group))];
    expect(groups).toEqual(['blur', 'sharpen', 'effect', 'distort', 'render', 'correction']);
    expect(FILTERS.filter((f) => f.group === 'blur').map((f) => f.label)).toEqual(['Blur', 'Blur (strong)', 'Gaussian blur', 'Lens blur', 'Smoothing', 'Radial blur', 'Motion blur', 'Spin blur']);
  });

  it('keeps settings in range', () => {
    const v = sanitizeValues('gaussianBlur', { strength: 1e9 });
    expect(v.strength).toBe(200);
    expect(sanitizeValues('noise', { colorMode: 'x' }).colorMode).toBe('color');
    expect(defaultValues('motionBlur')).toEqual({ strength: 10, angle: 0, direction: 'both', mode: 'box' });
  });

  it('only touches the content and its reach for local filters', () => {
    const p = img();
    setPx(p, 20, 20, [255, 0, 0, 255]);
    const area = { x: 0, y: 0, w: W, h: H };
    expect(filterRegion('blur', {}, p, area, contentRect(p))).toEqual({ x: 18, y: 18, w: 5, h: 5 });
    expect(filterRegion('blur', {}, p, area, null)).toBeNull();
    expect(filterRegion('perlinNoise', {}, p, { x: 1, y: 2, w: 3, h: 4 }, null)).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });

  it('runs every filter with its defaults on a rectangle', () => {
    const p = picture();
    const rect = { x: 5, y: 6, w: 20, h: 10 };
    for (const f of FILTERS) {
      const out = runFilter(f.id as FilterId, p, { ...defaultValues(f.id), cx: 20, cy: 20 }, rect, { bounds: { x: 0, y: 0, w: W, h: H }, color: [0, 0, 0], seed: 1 });
      expect(out.width, f.id).toBe(20);
      expect(out.height, f.id).toBe(10);
      expect(out.data.length, f.id).toBe(20 * 10 * 4);
    }
  });

  it('gives local filters the same pixels as on the whole layer', () => {
    const p = picture();
    const rect = { x: 10, y: 10, w: 12, h: 9 };
    const ctx = { bounds: { x: 0, y: 0, w: W, h: H }, color: [0, 0, 0] as [number, number, number], seed: 1 };
    for (const id of ['gaussianBlur', 'motionBlur', 'unsharpMask'] as FilterId[]) {
      const part = runFilter(id, p, defaultValues(id), rect, ctx);
      const whole = runFilter(id, p, defaultValues(id), { x: 0, y: 0, w: W, h: H }, ctx);
      for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) expect(px(part, x, y), id).toEqual(px(whole, rect.x + x, rect.y + y));
    }
  });
});
