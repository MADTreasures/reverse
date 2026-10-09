import { describe, expect, it } from 'vitest';
import { applyAffine, placementMatrix } from './keyframes';
import { betweenLights, fromPlacement, insertLight, lightImages, lightMatrix, lightPlacement, movedView, newLightLayer, rebaseLight, resetLight, sanitizeLightLayer, sanitizeLightLayers, sourceRect, type CanvasMove } from './lightTable';
import { multiply, viewMatrix } from './viewMath';

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

describe('light table: order and Move canvas to center', () => {
  const W = 400;
  const H = 300;
  const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));
  const moveMatrix = (c: CanvasMove) => placementMatrix({ x: c.x, y: c.y, scaleX: c.scale, scaleY: c.scale, rotation: c.rotation, pivotX: W / 2, pivotY: H / 2, opacity: 1 });

  it('moves a light table layer to a place in a list', () => {
    const [a, b, c] = ['a', 'b', 'c'].map((id) => ({ ...newLightLayer({ kind: 'layer', layer: id }), id }));
    expect(insertLight([a, b, c], c, 0).map((l) => l.id)).toEqual(['c', 'a', 'b']);
    expect(insertLight([a, b, c], a, 2).map((l) => l.id)).toEqual(['b', 'c', 'a']);
    expect(insertLight([a, b], c, 1).map((l) => l.id)).toEqual(['a', 'c', 'b']);
    expect(insertLight([a], b, 9).map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('places the canvas between two light table layers', () => {
    const a = { ...newLightLayer({ kind: 'layer', layer: 'a' }), x: -40, y: 10, rotation: 170, scale: 1 };
    const b = { ...newLightLayer({ kind: 'layer', layer: 'b' }), x: 60, y: 30, rotation: -170, scale: 2 };
    expect(betweenLights(a, b, 0)).toEqual({ x: -40, y: 10, scale: 1, rotation: 170 });
    const mid = betweenLights(a, b, 0.5);
    expect([mid.x, mid.y, mid.scale]).toEqual([10, 20, 1.5]);
    // 170° → -170° turns 20° through 180°, not 340° back.
    expect(mid.rotation).toBeCloseTo(180, 6);
    expect(betweenLights(a, b, 1).rotation).toBeCloseTo(190, 6);
  });

  it('keeps every light table layer where it is on screen while the canvas moves', () => {
    const c: CanvasMove = { x: 25, y: -15, scale: 1.25, rotation: 30 };
    const view = { zoom: 0.8, rotation: 20, flipH: false, flipV: false, panX: 12, panY: -7 };
    const viewport = { w: 1000, h: 700 };
    const doc = { w: W, h: H };
    for (const v of [view, { ...view, flipH: true }, { ...view, flipH: true, flipV: true }]) {
      // The moved view shows the canvas through the move.
      close(viewMatrix(movedView(v, c), viewport, doc), multiply(viewMatrix(v, viewport, doc), moveMatrix(c)));
      for (const l of [
        { ...newLightLayer({ kind: 'layer', layer: 'a' }), x: 30, y: 40, rotation: -50, scale: 0.7 },
        { ...newLightLayer({ kind: 'image', image: 'i', name: 'i', w: 120, h: 80 }), x: -10, y: 5, rotation: 95, scale: 1.5, flipH: true },
      ]) {
        const before = multiply(viewMatrix(v, viewport, doc), lightMatrix(l, W, H));
        const after = multiply(viewMatrix(movedView(v, c), viewport, doc), lightMatrix(rebaseLight(l, c), W, H));
        close(after, before);
      }
    }
  });

  it('puts the light table layer the canvas moved to on the canvas itself', () => {
    const a = { ...newLightLayer({ kind: 'layer', layer: 'a' }), x: 30, y: 40, rotation: -50, scale: 0.7 };
    const r = rebaseLight(a, betweenLights(a, a, 0.5));
    close([r.x, r.y, r.rotation, r.scale], [0, 0, 0, 1]);
  });
});
