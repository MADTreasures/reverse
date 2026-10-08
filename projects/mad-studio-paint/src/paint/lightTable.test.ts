import { describe, expect, it } from 'vitest';
import { applyAffine } from './keyframes';
import { fromPlacement, lightImages, lightMatrix, lightPlacement, newLightLayer, resetLight, sanitizeLightLayer, sanitizeLightLayers, sourceRect } from './lightTable';

describe('light table', () => {
  it('a layer covers the canvas, an image is centred on it', () => {
    const layer = newLightLayer({ kind: 'layer', layer: 'a' });
    const image = newLightLayer({ kind: 'image', image: 'img1', name: 'Ref', w: 100, h: 50 });
    expect(sourceRect(layer, 400, 300)).toEqual({ x: 0, y: 0, w: 400, h: 300 });
    expect(sourceRect(image, 400, 300)).toEqual({ x: 150, y: 125, w: 100, h: 50 });
    // Image pixel (0, 0) lands at the image's top left on the canvas.
    expect(applyAffine(lightMatrix(image, 400, 300), 0, 0)).toEqual({ x: 150, y: 125 });
    expect(layer.opacity).toBe(0.5);
    expect(layer.id).not.toBe(image.id);
  });

  it('moves, scales, turns and flips about the middle of the canvas', () => {
    const l = { ...newLightLayer({ kind: 'layer', layer: 'a' }), x: 10, scale: 2, flipH: true };
    const m = lightMatrix(l, 400, 300);
    // The middle moves by the movement only; the left edge goes to the right (flipped, doubled).
    expect(applyAffine(m, 200, 150)).toEqual({ x: 210, y: 150 });
    expect(applyAffine(m, 100, 150).x).toBeCloseTo(410);
    const p = lightPlacement(l, 400, 300);
    expect(p.scaleX).toBe(-2);
    // Back from a placement: even scale, flips kept.
    const back = fromPlacement(l, { ...p, scaleX: -3, scaleY: 3, rotation: 30, x: 5 });
    expect(back).toMatchObject({ scale: 3, rotation: 30, x: 5, flipH: true });
    expect(resetLight(back)).toMatchObject({ x: 0, y: 0, scale: 1, rotation: 0, flipH: false, flipV: false });
  });

  it('lists the images to save and reads files safely', () => {
    const a = newLightLayer({ kind: 'image', image: 'img1', name: 'A', w: 1, h: 1 });
    const b = newLightLayer({ kind: 'layer', layer: 'x' });
    expect(lightImages([a], [[b, a], []])).toEqual(['img1']);
    expect(sanitizeLightLayer({ source: { kind: 'layer', layer: '../x' } })).toBeNull();
    expect(sanitizeLightLayer({ source: { kind: 'image', image: 'i', w: 0, h: 9e9 }, mode: 'mono', color: '#FF0000', opacity: 4, scale: 0 })).toMatchObject({
      source: { kind: 'image', image: 'i', name: 'Image', w: 1, h: 16384 },
      mode: 'mono',
      color: '#ff0000',
      opacity: 1,
      scale: 0.01,
    });
    expect(sanitizeLightLayers([null, { source: { kind: 'layer', layer: 'c' } }])).toHaveLength(1);
    expect(sanitizeLightLayers([])).toBeUndefined();
  });
});
