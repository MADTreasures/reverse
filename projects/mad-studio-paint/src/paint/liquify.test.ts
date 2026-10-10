import { describe, expect, it } from 'vitest';
import { dabRect, dabStrength, falloff, invertMode, warpDab, WarpField, warpPixels, type LiquifyDab, type LiquifyOptions, type PixelArea } from './liquify';
import { createMask } from './mask';

const N = 40;

/** Transparent pixels with an opaque red disc of radius `r` round (cx, cy). */
function disc(cx: number, cy: number, r: number): PixelArea {
  const data = new Uint8ClampedArray(N * N * 4);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) data.set([255, 0, 0, 255], (y * N + x) * 4);
  return { x: 0, y: 0, width: N, height: N, data };
}

/** Applies one stroke's dabs to the whole image; the pixels afterwards. */
function applied(src: PixelArea, dabs: LiquifyDab | LiquifyDab[], o: LiquifyOptions = { antiAlias: true }): Uint8ClampedArray {
  const field = new WarpField(N, N);
  const data = src.data.slice();
  for (const d of [dabs].flat()) {
    const rect = dabRect(d, N, N);
    warpDab(field, d, rect, o.selection);
    const out = warpPixels(src, field, rect, o);
    for (let y = 0; y < rect.h; y++) data.set(out.subarray(y * rect.w * 4, (y + 1) * rect.w * 4), ((rect.y + y) * N + rect.x) * 4);
  }
  return data;
}

/** Applies a dab to the whole image and returns the alpha at (x, y) afterwards. */
function apply(src: PixelArea, d: LiquifyDab, o?: LiquifyOptions) {
  const data = applied(src, d, o);
  return (x: number, y: number) => data[(y * N + x) * 4 + 3];
}

/** A selection of the columns from `x0` up to (not including) `x1`. */
function columns(x0: number, x1: number) {
  const m = createMask(N, N);
  for (let y = 0; y < N; y++) for (let x = x0; x < x1; x++) m.data[y * N + x] = 255;
  return m;
}

const dab = (patch: Partial<LiquifyDab>): LiquifyDab => ({ x: 20, y: 20, radius: 12, mode: 'push', strength: 1, hardness: 1, dx: 0, dy: 0, ...patch });

describe('liquify', () => {
  it('falls off from the hard core to nothing at the rim', () => {
    expect(falloff(0, 10, 0.5)).toBe(1);
    expect(falloff(5, 10, 0.5)).toBe(1);
    expect(falloff(10, 10, 0.5)).toBe(0);
    expect(falloff(7, 10, 0.5)).toBeGreaterThan(falloff(9, 10, 0.5));
    expect(invertMode('expand')).toBe('pinch');
    expect(invertMode('twirlCW')).toBe('twirlCCW');
    // Pushed pixels fall behind the pen; holding does less per dab than a stroke.
    expect(dabStrength('push', 100, false)).toBeLessThan(0.5);
    expect(dabStrength('expand', 70, true)).toBeLessThan(dabStrength('expand', 70, false));
    expect(dabStrength('twirlCW', 0, false)).toBe(0);
  });

  it('Push moves the pixels along the stroke (Alt: against it)', () => {
    const a = apply(disc(20, 20, 2), dab({ dx: 4 }));
    expect(a(24, 19)).toBe(255);
    expect(a(17, 19)).toBe(0);
    const back = apply(disc(20, 20, 2), dab({ dx: 4, reverse: true }));
    expect(back(15, 19)).toBe(255);
    expect(back(22, 19)).toBe(0);
  });

  it('Push left / right move the pixels across the stroke', () => {
    // Moving right (dx > 0), left of the stroke is up (y down).
    const left = apply(disc(20, 20, 2), dab({ mode: 'pushLeft', dx: 4 }));
    expect(left(19, 15)).toBe(255);
    const right = apply(disc(20, 20, 2), dab({ mode: 'pushRight', dx: 4 }));
    expect(right(19, 23)).toBe(255);
    expect(right(19, 16)).toBe(0);
  });

  it('Expand grows and Pinch shrinks what is under the middle', () => {
    expect(disc(20, 20, 4).data[(20 * N + 24) * 4 + 3]).toBe(0);
    expect(apply(disc(20, 20, 4), dab({ mode: 'expand' }))(24, 20)).toBe(255);
    expect(disc(20, 20, 4).data[(21 * N + 23) * 4 + 3]).toBe(255);
    expect(apply(disc(20, 20, 4), dab({ mode: 'pinch' }))(23, 21)).toBeLessThan(64);
  });

  it('Twirl turns the pixels round the middle', () => {
    // A small dot right of the middle: clockwise (y down) it moves down, anticlockwise up.
    const dot = disc(28, 20, 1.5);
    const cw = apply(dot, dab({ mode: 'twirlCW' }));
    const ccw = apply(dot, dab({ mode: 'twirlCCW' }));
    let cwBelow = 0;
    let ccwAbove = 0;
    for (let x = 22; x < 31; x++) {
      for (let y = 21; y < 26; y++) cwBelow += cw(x, y);
      for (let y = 14; y < 19; y++) ccwAbove += ccw(x, y);
    }
    expect(cwBelow).toBeGreaterThan(255);
    expect(ccwAbove).toBeGreaterThan(255);
  });

  it('keeps colours at soft edges (no dark fringe) and says which part of the image it needs', () => {
    const out = applied(disc(20, 20, 6), dab({ mode: 'expand', hardness: 0.2 }));
    for (let i = 0; i < out.length; i += 4) if (out[i + 3] > 0) expect([out[i], out[i + 1], out[i + 2]]).toEqual([255, 0, 0]);
    expect(dabRect(dab({ x: 2, y: 2 }), N, N)).toEqual({ x: 0, y: 0, w: 14, h: 14 });
    // Pushing right takes colours from left of the dab.
    const push = dab({ dx: 10 });
    const rect = dabRect(push, N, N);
    expect(warpDab(new WarpField(N, N), push, rect).x).toBeLessThan(rect.x - 5);
  });

  it('keeps lines sharp however many dabs pass over them', () => {
    // A 1 px line at x = 15, pushed right by 20 small dabs of one stroke.
    const line: PixelArea = { x: 0, y: 0, width: N, height: N, data: new Uint8ClampedArray(N * N * 4) };
    for (let y = 0; y < N; y++) line.data.set([0, 0, 0, 255], (y * N + 15) * 4);
    const out = applied(
      line,
      Array.from({ length: 20 }, (_, i) => dab({ x: 10 + i, radius: 15, dx: 1, strength: 0.3 })),
    );
    const row = Array.from({ length: N }, (_, x) => out[(20 * N + x) * 4 + 3]);
    const top = Math.max(...row);
    // Resampling after every dab would have spread it to a faint smear.
    expect(top).toBeGreaterThan(120);
    expect(row.indexOf(top)).toBeGreaterThan(16);
  });

  it('changes only the selection; Only refer to editing area keeps the colours outside it out', () => {
    // The left half selected: the right half of the disc stays, the left half is pushed away.
    const half = apply(disc(20, 20, 2), dab({ dx: 4 }), { antiAlias: true, selection: columns(0, 20) });
    expect(half(21, 19)).toBe(255);
    expect(half(19, 19)).toBe(0);
    // Opaque red outside the selection (x < 10), pushed right into it.
    const red: PixelArea = { x: 0, y: 0, width: N, height: N, data: new Uint8ClampedArray(N * N * 4) };
    for (let y = 0; y < N; y++) for (let x = 0; x < 10; x++) red.data.set([255, 0, 0, 255], (y * N + x) * 4);
    const push = dab({ x: 14, y: 20, radius: 8, dx: 6 });
    expect(apply(red, push, { antiAlias: true, selection: columns(10, N) })(12, 20)).toBe(255);
    expect(apply(red, push, { antiAlias: true, selection: columns(10, N), onlyArea: true })(12, 20)).toBe(0);
  });

  it('keeps the shape with Lock transparent pixels and hard edges without anti-aliasing', () => {
    // Red left of x = 20, blue right of it, both opaque; pushing right brings red over blue.
    const two: PixelArea = { x: 0, y: 0, width: N, height: N, data: new Uint8ClampedArray(N * N * 4) };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) two.data.set(x < 20 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * N + x) * 4);
    const locked = applied(two, dab({ dx: 4 }), { antiAlias: true, lockAlpha: true });
    expect(Array.from(locked.subarray((20 * N + 21) * 4, (20 * N + 21) * 4 + 4))).toEqual([255, 0, 0, 255]);
    const shape = applied(disc(20, 20, 5), dab({ mode: 'expand' }), { antiAlias: true, lockAlpha: true });
    const before = disc(20, 20, 5).data;
    for (let i = 3; i < shape.length; i += 4) expect(shape[i]).toBe(before[i]);
    // Without anti-aliasing every pixel is one of the old ones: no half transparent edge.
    const partial = (data: Uint8ClampedArray) => data.filter((v, i) => i % 4 === 3 && v > 0 && v < 255).length;
    expect(partial(applied(disc(20, 20, 5), dab({ mode: 'expand' }), { antiAlias: false }))).toBe(0);
    expect(partial(applied(disc(20, 20, 5), dab({ mode: 'expand' }), { antiAlias: true }))).toBeGreaterThan(0);
  });
});
