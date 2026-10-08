import { describe, expect, it } from 'vitest';
import { floodFillMask } from './fill';
import { HistoryStack } from './history';
import { combine, createMask, ellipseMask, expandMask, invertMask, isMaskEmpty, maskBounds, maskOutline, polygonMask, rectMask, translateMask } from './mask';
import { circleBounds, intersect, union } from './rect';
import { dabAlpha, ellipsePoints, interpolateDabs, pressureCurve, snapAngle, Stabilizer, stabilizerWindow } from './stroke';
import { DEFAULT_SUB_TOOLS, mergeSubTools, toolForKey } from './tools';

const count = (m: { data: Uint8Array }) => m.data.reduce((n, v) => n + (v ? 1 : 0), 0);

describe('rect', () => {
  it('unions and intersects', () => {
    expect(union(null, { x: 1, y: 2, w: 3, h: 4 })).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(union({ x: 0, y: 0, w: 2, h: 2 }, { x: 5, y: 5, w: 1, h: 1 })).toEqual({ x: 0, y: 0, w: 6, h: 6 });
    expect(intersect({ x: 0, y: 0, w: 4, h: 4 }, { x: 2, y: 2, w: 4, h: 4 })).toEqual({ x: 2, y: 2, w: 2, h: 2 });
    expect(intersect({ x: 0, y: 0, w: 1, h: 1 }, { x: 2, y: 2, w: 1, h: 1 })).toBeNull();
  });

  it('covers a circle', () => {
    const r = circleBounds(10.5, 10.5, 3);
    expect(r.x).toBeLessThanOrEqual(7);
    expect(r.x + r.w).toBeGreaterThanOrEqual(14);
  });
});

describe('stroke', () => {
  it('places dabs at even spacing and carries the remainder', () => {
    const a = interpolateDabs({ x: 0, y: 0, pressure: 0 }, { x: 10, y: 0, pressure: 1 }, 3, 0);
    expect(a.dabs.map((d) => d.x)).toEqual([3, 6, 9]);
    expect(a.dabs[0].pressure).toBeCloseTo(0.3);
    expect(a.carry).toBeCloseTo(1);
    const b = interpolateDabs({ x: 10, y: 0, pressure: 1 }, { x: 14, y: 0, pressure: 1 }, 3, a.carry);
    expect(b.dabs.map((d) => d.x)).toEqual([12]);
  });

  it('maps pressure into [min, 1]', () => {
    expect(pressureCurve(0, 0.2, true)).toBeCloseTo(0.2);
    expect(pressureCurve(1, 0.2, true)).toBe(1);
    expect(pressureCurve(0, 0.2, false)).toBe(1);
  });

  it('stabilizer smooths jitter and catches up at the end', () => {
    const s = new Stabilizer(6);
    let last = { x: 0, y: 0, pressure: 1 };
    for (let i = 0; i < 20; i++) last = s.push({ x: i, y: i % 2 === 0 ? 5 : -5, pressure: 1 });
    expect(Math.abs(last.y)).toBeLessThan(2);
    const tail = s.finish(4);
    expect(tail[tail.length - 1]).toEqual({ x: 19, y: -5, pressure: 1 });
    expect(new Stabilizer(0).push({ x: 3, y: 4, pressure: 0.5 })).toEqual({ x: 3, y: 4, pressure: 0.5 });
  });

  it('snaps lines to 45°', () => {
    const p = snapAngle(0, 0, 10, 1);
    expect(p.y).toBeCloseTo(0);
    const q = snapAngle(0, 0, 10, 9);
    expect(q.x).toBeCloseTo(q.y);
  });

  it('compensates dab overlap so one pass reaches the density', () => {
    const spacing = 0.1;
    const a = dabAlpha(0.5, spacing, false);
    // About 1 / spacing dabs overlap the centre line.
    expect(1 - Math.pow(1 - a, 1 / spacing)).toBeCloseTo(0.5);
    expect(dabAlpha(1, spacing, false)).toBe(1);
    expect(dabAlpha(0.3, spacing, true)).toBe(0.3);
    expect(stabilizerWindow(0)).toBe(0);
    expect(stabilizerWindow(100)).toBe(50);
  });

  it('ellipse points are closed', () => {
    const pts = ellipsePoints(0, 0, 100, 50);
    expect(pts[0].x).toBeCloseTo(pts[pts.length - 1].x);
    expect(pts[0].y).toBeCloseTo(pts[pts.length - 1].y);
  });
});

describe('masks', () => {
  it('rasterizes shapes', () => {
    expect(count(rectMask(10, 10, { x: 2, y: 2, w: 3, h: 4 }))).toBe(12);
    expect(count(rectMask(10, 10, { x: -5, y: -5, w: 7, h: 7 }))).toBe(4);
    const e = ellipseMask(100, 100, { x: 0, y: 0, w: 100, h: 100 });
    expect(count(e) / (Math.PI * 50 * 50)).toBeGreaterThan(0.97);
    expect(count(e) / (Math.PI * 50 * 50)).toBeLessThan(1.03);
    const tri = polygonMask(10, 10, [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ]);
    expect(count(tri)).toBeGreaterThan(40);
    expect(count(tri)).toBeLessThan(60);
  });

  it('combines selections', () => {
    const a = rectMask(10, 10, { x: 0, y: 0, w: 5, h: 10 });
    const b = rectMask(10, 10, { x: 3, y: 0, w: 5, h: 10 });
    expect(count(combine(a, b, 'add'))).toBe(80);
    expect(count(combine(a, b, 'subtract'))).toBe(30);
    expect(count(combine(a, b, 'intersect'))).toBe(20);
    expect(count(combine(a, b, 'replace'))).toBe(50);
    expect(count(combine(null, b, 'intersect'))).toBe(0);
    expect(count(invertMask(a))).toBe(50);
  });

  it('finds bounds, outline and emptiness', () => {
    const m = rectMask(10, 10, { x: 2, y: 3, w: 4, h: 2 });
    expect(maskBounds(m)).toEqual({ x: 2, y: 3, w: 4, h: 2 });
    expect(maskBounds(createMask(5, 5))).toBeNull();
    expect(isMaskEmpty(createMask(5, 5))).toBe(true);
    // A rectangle outline is 4 straight runs.
    expect(maskOutline(m)).toEqual([2, 3, 6, 3, 2, 5, 6, 5, 2, 3, 2, 5, 6, 3, 6, 5]);
  });

  it('translates and clips at the canvas edge', () => {
    const m = rectMask(10, 10, { x: 2, y: 2, w: 3, h: 3 });
    expect(maskBounds(translateMask(m, 4, -1))).toEqual({ x: 6, y: 1, w: 3, h: 3 });
    expect(maskBounds(translateMask(m, 6, 0))).toEqual({ x: 8, y: 2, w: 2, h: 3 });
    expect(maskBounds(translateMask(m, -20, 0))).toBeNull();
  });

  it('grows and shrinks', () => {
    const m = rectMask(20, 20, { x: 5, y: 5, w: 4, h: 4 });
    expect(maskBounds(expandMask(m, 2))).toEqual({ x: 3, y: 3, w: 8, h: 8 });
    expect(maskBounds(expandMask(m, -1))).toEqual({ x: 6, y: 6, w: 2, h: 2 });
  });
});

describe('flood fill', () => {
  // 6×3 image: a black vertical line at x = 2 splits white from white.
  const w = 6;
  const h = 3;
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = x === 2 ? 0 : 255;
      px.set([v, v, v, 255], i);
    }

  it('fills the connected area only', () => {
    expect(count(floodFillMask(px, w, h, 0, 0, { tolerance: 0 }))).toBe(6);
    expect(count(floodFillMask(px, w, h, 5, 1, { tolerance: 0 }))).toBe(9);
  });

  it('fills everything within tolerance or non-contiguously', () => {
    expect(count(floodFillMask(px, w, h, 0, 0, { tolerance: 100 }))).toBe(18);
    expect(count(floodFillMask(px, w, h, 0, 0, { tolerance: 0, contiguous: false }))).toBe(15);
  });

  it('treats all transparent pixels as equal and ignores outside seeds', () => {
    const t = new Uint8ClampedArray(4 * 4 * 4);
    t.set([255, 0, 0, 0], 0);
    expect(count(floodFillMask(t, 4, 4, 1, 1, { tolerance: 0 }))).toBe(16);
    expect(count(floodFillMask(t, 4, 4, -1, 0, { tolerance: 0 }))).toBe(0);
  });

  it('closes small gaps in an outline when asked to', () => {
    // A 40×40 ring (outline 2 px) with a 3 px gap on the right side, on a transparent background.
    const w = 60;
    const h = 60;
    const img = new Uint8ClampedArray(w * h * 4);
    const set = (x: number, y: number) => img.set([0, 0, 0, 255], (y * w + x) * 4);
    for (let i = 10; i < 50; i++)
      for (let t = 0; t < 2; t++) {
        set(i, 10 + t);
        set(i, 48 + t);
        set(10 + t, i);
        if (i < 28 || i > 30) set(48 + t, i);
      }
    const leak = floodFillMask(img, w, h, 30, 30, { tolerance: 0 });
    expect(leak.data[2 * w + 2]).toBe(255);
    const closed = floodFillMask(img, w, h, 30, 30, { tolerance: 0, closeGap: 2 });
    expect(closed.data[2 * w + 2]).toBe(0);
    // The inside is filled right up to the outline.
    expect(closed.data[30 * w + 12]).toBe(255);
    expect(closed.data[12 * w + 30]).toBe(255);
    expect(closed.data[30 * w + 47]).toBe(255);
    // Outline pixels themselves stay unfilled.
    expect(closed.data[30 * w + 10]).toBe(0);
  });

  it('handles large areas without recursion', () => {
    const big = new Uint8ClampedArray(1500 * 1500 * 4);
    expect(count(floodFillMask(big, 1500, 1500, 700, 700, { tolerance: 0 }))).toBe(1500 * 1500);
  });
});

describe('history', () => {
  it('undoes, redoes and drops redo on push', () => {
    const dropped: number[] = [];
    const h = new HistoryStack<number>({ maxEntries: 3, maxBytes: 1e9, sizeOf: () => 1, onDrop: (e) => dropped.push(e) });
    [1, 2, 3, 4].forEach((n) => h.push(n));
    expect(dropped).toEqual([1]);
    expect(h.undo()).toBe(4);
    expect(h.undo()).toBe(3);
    expect(h.redo()).toBe(3);
    h.push(5);
    expect(dropped).toEqual([1, 4]);
    expect(h.canRedo).toBe(false);
    expect(h.entries()).toEqual([2, 3, 5]);
  });

  it('caps memory but keeps the newest entry', () => {
    const h = new HistoryStack<number>({ maxEntries: 100, maxBytes: 10, sizeOf: (n) => n });
    h.push(4);
    h.push(4);
    h.push(4);
    expect(h.entries()).toEqual([4, 4]);
    h.push(50);
    expect(h.entries()).toEqual([50]);
    expect(h.totalBytes).toBe(50);
  });
});

describe('tools', () => {
  it('cycles tools that share a shortcut', () => {
    expect(toolForKey('p', 'brush')).toBe('pen');
    expect(toolForKey('p', 'pen')).toBe('pencil');
    expect(toolForKey('P', 'pencil')).toBe('pen');
    expect(toolForKey('q', 'pen')).toBeNull();
  });

  it('merges saved sub tools with the defaults', () => {
    const saved = [{ id: 'pen-g', tool: 'pen', name: 'x', brush: { size: 77, antiAlias: false } }, { id: 'gone', tool: 'pen', name: 'old' }];
    const merged = mergeSubTools(saved);
    expect(merged).toHaveLength(DEFAULT_SUB_TOOLS.length);
    const pen = merged.find((s) => s.id === 'pen-g')!;
    expect(pen.brush!.size).toBe(77);
    // Old on/off anti-aliasing is migrated to levels.
    expect(pen.brush!.antiAlias).toBe(0);
    expect(pen.brush!.hardness).toBe(DEFAULT_SUB_TOOLS.find((s) => s.id === 'pen-g')!.brush!.hardness);
    expect(mergeSubTools('junk')).toHaveLength(DEFAULT_SUB_TOOLS.length);
  });
});
