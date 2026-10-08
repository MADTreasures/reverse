import { describe, expect, it } from 'vitest';
import {
  applyAffine,
  cameraMatrix,
  ease,
  invert,
  isRest,
  moveKeys,
  movePivot,
  placedCorners,
  placementAt,
  placementMatrix,
  restPlacement,
  sanitizeKeyTrack,
  setKey,
  type Keyframe,
} from './keyframes';

const rest = restPlacement(200, 100);
const key = (frame: number, patch: Partial<Keyframe> = {}): Keyframe => ({ ...rest, frame, interp: 'linear', ...patch });

describe('keyframes', () => {
  it('eases: hold jumps, linear is steady, smooth speeds up and slows down', () => {
    expect(ease(0.5, 'hold')).toBe(0);
    expect(ease(0.25, 'linear')).toBe(0.25);
    expect(ease(0.5, 'smooth')).toBe(0.5);
    expect(ease(0.1, 'smooth')).toBeLessThan(0.1);
    expect(ease(0.9, 'smooth')).toBeGreaterThan(0.9);
    expect(ease(2, 'linear')).toBe(1);
  });

  it('interpolates between keyframes as the earlier one says', () => {
    const keys = [key(1, { x: 0 }), key(5, { x: 100, interp: 'hold' }), key(9, { x: 0, opacity: 0 })];
    expect(placementAt([], 3)).toBeNull();
    expect(placementAt(keys, 0)!.x).toBe(0);
    expect(placementAt(keys, 3)!.x).toBe(50);
    // Hold: the value stays until the next keyframe.
    expect(placementAt(keys, 8)!.x).toBe(100);
    expect(placementAt(keys, 9)!.x).toBe(0);
    expect(placementAt(keys, 20)!.opacity).toBe(0);
    expect(placementAt(keys, 3)).not.toHaveProperty('frame');
  });

  it('places about the centre of rotation', () => {
    expect(isRest(rest)).toBe(true);
    // Rotated by 90° about the centre (100, 50): the top left corner goes to the top right of the turned box.
    const turned = { ...rest, rotation: 90 };
    const c = applyAffine(placementMatrix(turned), 0, 0);
    expect(c.x).toBeCloseTo(150);
    expect(c.y).toBeCloseTo(-50);
    expect(applyAffine(placementMatrix(turned), 100, 50).x).toBeCloseTo(100);
    // Scaled ×2 and moved by (10, 20): the centre moves by exactly that.
    const big = { ...rest, scaleX: 2, scaleY: 2, x: 10, y: 20 };
    expect(applyAffine(placementMatrix(big), 100, 50)).toEqual({ x: 110, y: 70 });
    expect(placedCorners(big, 200, 100)[0]).toEqual({ x: -90, y: -30 });
    expect(isRest(big)).toBe(false);
  });

  it('a camera frame zoomed in shows its part of the canvas over the whole output', () => {
    // Camera frame half the size, centred on (50, 25): that quarter fills the output.
    const cam = { ...rest, scaleX: 0.5, scaleY: 0.5, x: -50, y: -25 };
    const m = cameraMatrix(cam);
    const tl = applyAffine(m, 0, 0);
    const br = applyAffine(m, 100, 50);
    expect(tl.x).toBeCloseTo(0);
    expect(tl.y).toBeCloseTo(0);
    expect(br.x).toBeCloseTo(200);
    expect(br.y).toBeCloseTo(100);
    const back = invert(m);
    expect(applyAffine(back, 200, 100).x).toBeCloseTo(100);
  });

  it('moving the centre of rotation keeps the layer where it is', () => {
    const p = { ...rest, rotation: 30, scaleX: 1.5, scaleY: 0.5, x: 12, y: -7 };
    const q = movePivot(p, 20, 80);
    const a = placementMatrix(p);
    const b = placementMatrix(q);
    for (let i = 0; i < 6; i++) expect(b[i]).toBeCloseTo(a[i]);
    expect(q.pivotX).toBe(20);
  });

  it('sets and moves keyframes', () => {
    const keys = setKey(setKey([], key(5)), key(1));
    expect(keys.map((k) => k.frame)).toEqual([1, 5]);
    expect(setKey(keys, key(5, { x: 3 })).find((k) => k.frame === 5)!.x).toBe(3);
    expect(moveKeys(keys, [1], 2).map((k) => k.frame)).toEqual([3, 5]);
    expect(moveKeys(keys, [1], 4).map((k) => k.frame)).toEqual([5]);
    expect(moveKeys(keys, [5], 1, true).map((k) => k.frame)).toEqual([1, 5, 6]);
  });

  it('reads keyframes from files safely', () => {
    expect(sanitizeKeyTrack(null)).toBeUndefined();
    const t = sanitizeKeyTrack({ enabled: false, frames: [{ frame: 3, interp: 'smooth', x: 5, scaleX: 0, opacity: 3 }, { frame: 'x' }, { frame: 1 }, { frame: 3, x: 9 }] })!;
    expect(t.enabled).toBe(false);
    expect(t.frames.map((k) => [k.frame, k.x, k.interp])).toEqual([
      [1, 0, 'linear'],
      [3, 9, 'linear'],
    ]);
    const s = sanitizeKeyTrack({ frames: [{ frame: 2, scaleX: 0, opacity: 3, interp: 'hold' }] })!;
    expect(s.frames[0].scaleX).toBe(0.001);
    expect(s.frames[0].opacity).toBe(1);
    expect(s.frames[0].interp).toBe('hold');
  });
});
