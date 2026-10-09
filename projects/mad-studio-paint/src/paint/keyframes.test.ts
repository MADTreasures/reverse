import { describe, expect, it } from 'vitest';
import {
  applyAffine,
  cameraMatrix,
  changedChannels,
  channelAt,
  ease,
  invert,
  isRest,
  moveCurvePoint,
  moveKeys,
  movePivot,
  placedCorners,
  placementAt,
  placementMatrix,
  recordKey,
  records,
  removeChannels,
  restPlacement,
  sanitizeKeyTrack,
  segmentHandles,
  setHandle,
  setInterp,
  toggleUnpaired,
  touches,
  type Keyframe,
} from './keyframes';

const rest = restPlacement(200, 100);
const key = (frame: number, values: Keyframe['values'], interp: Keyframe['interp'] = 'linear'): Keyframe => ({ frame, interp, values });

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
    const keys = [key(1, { x: 0, opacity: 1 }), key(5, { x: 100 }, 'hold'), key(9, { x: 0, opacity: 0 })];
    expect(placementAt([], 3, rest)).toBeNull();
    expect(placementAt(keys, 0, rest)!.x).toBe(0);
    expect(placementAt(keys, 3, rest)!.x).toBe(50);
    // Hold: the value stays until the next keyframe.
    expect(placementAt(keys, 8, rest)!.x).toBe(100);
    expect(placementAt(keys, 9, rest)!.x).toBe(0);
    expect(placementAt(keys, 20, rest)!.opacity).toBe(0);
    expect(placementAt(keys, 3, rest)).not.toHaveProperty('frame');
  });

  it('each property changes between the keyframes that record it', () => {
    // Opacity is recorded at 1 and 9 only: frame 5's keyframe (position only) does not stop it.
    const keys = [key(1, { x: 0, opacity: 1 }), key(5, { x: 100 }), key(9, { opacity: 0 })];
    expect(placementAt(keys, 5, rest)!.opacity).toBeCloseTo(0.5);
    expect(placementAt(keys, 7, rest)!.x).toBe(100);
    // What no keyframe records rests: the centre of rotation stays in the middle of the canvas.
    expect(placementAt(keys, 3, rest)!.pivotX).toBe(100);
    expect(placementAt(keys, 3, rest)!.scaleY).toBe(1);
    expect(channelAt(keys, 'rotation', 3)).toBeUndefined();
    expect(records(keys[0], ['x', 'y'])).toBe(false);
    expect(touches(keys[0], ['x', 'y'])).toBe(true);
  });

  it('records, removes and moves single properties', () => {
    let keys = recordKey([], 5, { x: 10, y: 20 }, 'smooth');
    keys = recordKey(keys, 1, { opacity: 0.5 }, 'linear');
    expect(keys.map((k) => k.frame)).toEqual([1, 5]);
    // Recording into a keyframe adds the values; its interpolation stays.
    keys = recordKey(keys, 5, { rotation: 45 }, 'hold');
    expect(keys[1]).toEqual({ frame: 5, interp: 'smooth', values: { x: 10, y: 20, rotation: 45 } });
    // Removing position leaves rotation; removing the last value removes the keyframe.
    expect(removeChannels(keys, 5, ['x', 'y'])[1].values).toEqual({ rotation: 45 });
    expect(removeChannels(keys, 1, ['opacity']).map((k) => k.frame)).toEqual([5]);
    expect(removeChannels(keys, 5).map((k) => k.frame)).toEqual([1]);
    // Moving the position of frame 5 to frame 1: it joins that keyframe, rotation stays behind.
    const moved = moveKeys(keys, [5], -4, false, ['x', 'y']);
    expect(moved).toEqual([
      { frame: 1, interp: 'linear', values: { opacity: 0.5, x: 10, y: 20 } },
      { frame: 5, interp: 'smooth', values: { rotation: 45 } },
    ]);
    // Whole keyframes replace those where they land; copies leave the originals.
    expect(moveKeys(keys, [1], 2).map((k) => k.frame)).toEqual([3, 5]);
    expect(moveKeys(keys, [1], 4).map((k) => k.frame)).toEqual([5]);
    expect(moveKeys(keys, [5], 1, true).map((k) => k.frame)).toEqual([1, 5, 6]);
    expect(moveKeys(keys, [5], 0)).toBe(keys);
  });

  it('sets the interpolation of keyframes or single curves', () => {
    const keys = [key(1, { x: 0, y: 0 }), key(11, { x: 100, y: 100 })];
    const hold = setInterp(keys, [1], 'hold', ['x']);
    expect(placementAt(hold, 6, rest)!.x).toBe(0);
    expect(placementAt(hold, 6, rest)!.y).toBe(50);
    // The whole keyframe: per-curve choices give way.
    const all = setInterp(hold, [1], 'smooth');
    expect(all[0].interp).toBe('smooth');
    expect(all[0].curves!.x!.interp).toBeUndefined();
    expect(placementAt(all, 6, rest)!.x).toBeCloseTo(50);
    expect(placementAt(all, 3, rest)!.x).toBeLessThan(20);
  });

  it('slope handles bend a stretch (Graph Editor)', () => {
    const keys = [key(1, { x: 0 }), key(11, { x: 100 })];
    // Linear without handles: a straight line, the handles a third of the way along it.
    expect(segmentHandles(keys[0], keys[1], 'x').out).toEqual([10 / 3, 100 / 3]);
    // A flat out handle with a long reach: slow start, linear turns into a curve.
    const bent = setHandle(keys, 1, 'x', 'out', [8, 0]);
    expect(bent[0].curves!.x!.interp).toBe('smooth');
    expect(bent[0].curves!.x!.in![0]).toBeLessThan(0);
    expect(channelAt(bent, 'x', 3)!).toBeLessThan(10);
    expect(channelAt(bent, 'x', 11)).toBe(100);
    // The curve stays a function of time: handles never reach past the other keyframe.
    const far = setHandle(keys, 1, 'x', 'out', [50, 10]);
    expect(segmentHandles(far[0], far[1], 'x').out[0]).toBe(10);
    // Paired handles mirror; unpaired, each side keeps its own direction.
    const paired = setHandle(keys, 11, 'x', 'in', [-3, -4]);
    expect(paired[1].curves!.x!.out![0]).toBeCloseTo(3);
    expect(paired[1].curves!.x!.out![1]).toBeCloseTo(4);
    const broken = setHandle(toggleUnpaired(paired, 11, 'x'), 11, 'x', 'in', [-1, 5]);
    expect(broken[1].curves!.x!.broken).toBe(true);
    expect(broken[1].curves!.x!.out![0]).toBeCloseTo(3);
    // Pairing again resets the handles.
    expect(toggleUnpaired(broken, 11, 'x')[1].curves!.x).toEqual({ interp: 'smooth' });
  });

  it('moves a curve point to another frame and value (Graph Editor)', () => {
    const keys = [key(1, { x: 0, y: 5 }), key(11, { x: 100 })];
    const moved = moveCurvePoint(keys, 1, 'x', 3, 20);
    expect(moved).toEqual([
      { frame: 1, interp: 'linear', values: { y: 5 } },
      { frame: 3, interp: 'linear', values: { x: 20 } },
      { frame: 11, interp: 'linear', values: { x: 100 } },
    ]);
    expect(moveCurvePoint(keys, 1, 'rotation', 3, 20)).toBe(keys);
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
    expect(changedChannels(rest, big)).toEqual(['x', 'y', 'scaleX', 'scaleY']);
    // A setting is recorded whole: moving sideways records the position (X and Y).
    expect(changedChannels(rest, { ...rest, x: 5, rotation: 3 })).toEqual(['x', 'y', 'rotation']);
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

  it('reads keyframes from files safely', () => {
    expect(sanitizeKeyTrack(null)).toBeUndefined();
    const t = sanitizeKeyTrack({
      enabled: false,
      frames: [{ frame: 3, interp: 'smooth', values: { x: 5, scaleX: 0, opacity: 3, bogus: 1 } }, { frame: 'x' }, { frame: 1, values: {} }, { frame: 3, interp: 'zigzag', values: { x: 9 } }],
    })!;
    expect(t.enabled).toBe(false);
    expect(t.frames).toEqual([{ frame: 3, interp: 'linear', values: { x: 9 } }]);
    const s = sanitizeKeyTrack({ frames: [{ frame: 2, interp: 'hold', values: { scaleX: 0, opacity: 3 }, curves: { scaleX: { in: [-1, 2], out: 'x', broken: true }, rotation: { in: [1, 1] } } }] })!;
    expect(s.frames[0]).toEqual({ frame: 2, interp: 'hold', values: { scaleX: 0.001, opacity: 1 }, curves: { scaleX: { in: [-1, 2], broken: true } } });
    // The earlier format kept the values beside the frame.
    const old = sanitizeKeyTrack({ frames: [{ frame: 4, interp: 'smooth', x: 7, y: 0, scaleX: 1, scaleY: 1, rotation: 0, pivotX: 100, pivotY: 50, opacity: 0.5 }] })!;
    expect(old.frames[0]).toEqual({ frame: 4, interp: 'smooth', values: { x: 7, y: 0, scaleX: 1, scaleY: 1, rotation: 0, pivotX: 100, pivotY: 50, opacity: 0.5 } });
  });
});
