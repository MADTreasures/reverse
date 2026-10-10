import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FOCUS_LINES,
  effectLinesGeometry,
  exitDistance,
  linePolygon,
  linePositions,
  rotateEffectLines,
  hitEffectLines,
  referenceBounds,
  sanitizeEffectLines,
  scaleEffectLines,
  transformEffectLines,
  translateEffectLines,
  unevenOffset,
  type EffectLines,
} from './effectLines';

const AREA = { x: 0, y: 0, w: 400, h: 300 };
const plain = { gapDisarray: 0, grouping: 0, groupDisarray: 0, groupGap: 0 };
const focus = (patch: Partial<EffectLines> = {}): EffectLines => ({
  ...DEFAULT_FOCUS_LINES,
  cx: 200,
  cy: 150,
  rx: 50,
  ry: 50,
  gap: 3,
  ...plain,
  lengthDisarray: 0,
  widthDisarray: 0,
  refGap: 0,
  extend: false,
  length: 60,
  ...patch,
});
const speed = (patch: Partial<EffectLines> = {}): EffectLines => focus({ kind: 'speed', rx: 100, rotation: Math.PI / 2, gap: 10, refPos: 'middle', length: 80, maxLines: 500, ...patch });
const dist = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);

describe('focus and speed lines', () => {
  it('finds where a ray leaves the canvas', () => {
    expect(exitDistance({ x: 100, y: 100 }, { x: 1, y: 0 }, AREA)).toBeCloseTo(300);
    expect(exitDistance({ x: 100, y: 100 }, { x: 0, y: -1 }, AREA)).toBeCloseTo(100);
    // From outside, towards and away from it.
    expect(exitDistance({ x: -50, y: 100 }, { x: 1, y: 0 }, AREA)).toBeCloseTo(450);
    expect(exitDistance({ x: -50, y: 100 }, { x: -1, y: 0 }, AREA)).toBe(0);
  });

  it('spaces lines by the gap, in groups, at most the maximum', () => {
    const rng = () => 0.5;
    expect(linePositions(100, 10, plain, rng, false)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(linePositions(100, 10, plain, rng, false, 4)).toHaveLength(4);
    // Groups of 3 with two gaps of space between them.
    expect(linePositions(100, 10, { ...plain, grouping: 3, groupGap: 2 }, rng, false)).toEqual([0, 10, 20, 50, 60, 70, 100]);
    // Once round a closed reference.
    expect(linePositions(360, 3, plain, rng, true)).toHaveLength(120);
  });

  it('focus lines point away from the centre, starting on the reference ellipse', () => {
    const g = effectLinesGeometry(focus(), AREA);
    expect(g.lines).toHaveLength(120);
    const c = { x: 200, y: 150 };
    for (const l of g.lines) {
      expect(dist(l.a, c)).toBeCloseTo(50, 5);
      expect(dist(l.b, c)).toBeCloseTo(110, 5);
    }
    // Outer side: they end on the ellipse and run in towards the centre (never past it).
    for (const l of effectLinesGeometry(focus({ refPos: 'end', length: 80 }), AREA).lines) {
      expect(dist(l.b, c)).toBeCloseTo(50, 5);
      expect(dist(l.a, c)).toBeCloseTo(0, 5);
    }
    // Extended lines reach past the canvas edge.
    for (const l of effectLinesGeometry(focus({ extend: true }), AREA).lines) expect(l.b.x < 0 || l.b.y < 0 || l.b.x > 400 || l.b.y > 300).toBe(true);
    expect(g.fill).toBeNull();
    expect(effectLinesGeometry(focus({ fill: true }), AREA).fill!.length).toBeGreaterThan(100);
  });

  it('uneven reference positions make spikes; a gap from the reference moves lines out', () => {
    expect(unevenOffset({ unevenCount: 4, unevenHeight: 20 }, 0)).toBeCloseTo(0);
    expect(unevenOffset({ unevenCount: 4, unevenHeight: 20 }, Math.PI / 4)).toBeCloseTo(20);
    const starts = effectLinesGeometry(focus({ unevenCount: 6, unevenHeight: 30 }), AREA).lines.map((l) => dist(l.a, { x: 200, y: 150 }));
    expect(Math.min(...starts)).toBeLessThan(55);
    expect(Math.max(...starts)).toBeGreaterThan(75);
    const moved = effectLinesGeometry(focus({ refGap: 100 }), AREA).lines.map((l) => dist(l.a, { x: 200, y: 150 }));
    expect(Math.min(...moved)).toBeGreaterThanOrEqual(50 - 1e-9);
    expect(Math.max(...moved)).toBeGreaterThan(80);
  });

  it('speed lines run across the reference line, spaced along it', () => {
    // The reference line is vertical (rotation 90°): horizontal lines, 21 of them over 200 px.
    const g = effectLinesGeometry(speed(), AREA);
    expect(g.lines).toHaveLength(21);
    for (const l of g.lines) {
      expect(l.a.y).toBeCloseTo(l.b.y, 6);
      expect(dist(l.a, l.b)).toBeCloseTo(80, 6);
      expect((l.a.x + l.b.x) / 2).toBeCloseTo(200, 6);
    }
    expect(g.lines.map((l) => Math.round(l.a.y))).toEqual(Array.from({ length: 21 }, (_, i) => 50 + i * 10));
    expect(effectLinesGeometry(speed({ maxLines: 5 }), AREA).lines).toHaveLength(5);
    // Extended from the middle: across the whole canvas; turned by the angle: vertical.
    for (const l of effectLinesGeometry(speed({ extend: true }), AREA).lines) expect(Math.min(l.a.x, l.b.x) < 0 && Math.max(l.a.x, l.b.x) > 400).toBe(true);
    for (const l of effectLinesGeometry(speed({ angle: 90 }), AREA).lines) expect(l.a.x).toBeCloseTo(l.b.x, 6);
  });

  it('draws the same lines for the same seed', () => {
    const rough = { gapDisarray: 80, lengthDisarray: 60, widthDisarray: 50, refGap: 40 };
    const one = effectLinesGeometry(focus({ ...rough, seed: 7 }), AREA);
    expect(effectLinesGeometry(focus({ ...rough, seed: 7 }), AREA)).toEqual(one);
    expect(effectLinesGeometry(focus({ ...rough, seed: 8 }), AREA)).not.toEqual(one);
  });

  it('lines thin out at their ends', () => {
    const poly = linePolygon({ a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, width: 10 }, 50, 0);
    const ys = (x: number) => poly.filter((p) => Math.abs(p.x - x) < 1e-9).map((p) => p.y);
    expect(ys(0)).toEqual([0, 0]);
    expect(Math.max(...ys(50))).toBeCloseTo(5);
    expect(Math.max(...ys(100))).toBeCloseTo(5);
    expect(Math.max(...ys(25))).toBeCloseTo(2.5);
  });

  it('moves, scales and turns with the reference', () => {
    const e = focus();
    expect(translateEffectLines(e, 10, -5)).toMatchObject({ cx: 210, cy: 145 });
    const s = scaleEffectLines(e, 0, 0, 2, 2);
    expect(s).toMatchObject({ cx: 400, cy: 300, rx: 100, ry: 100, length: 120, width: 12, gap: 3 });
    expect(scaleEffectLines(speed(), 0, 0, 2, 2).gap).toBe(20);
    const r = rotateEffectLines(e, 200, 150, Math.PI / 2);
    expect(r.cx).toBeCloseTo(200);
    expect(r.rotation).toBeCloseTo(Math.PI / 2);
  });

  it('point at a centre point moved off the middle of the reference', () => {
    const e = focus({ fx: 30, fy: 0 });
    const f = { x: 230, y: 150 };
    for (const l of effectLinesGeometry(e, AREA).lines) {
      // Each line lies on the ray from the centre point through its start.
      const u = { x: l.b.x - l.a.x, y: l.b.y - l.a.y };
      const w = { x: l.a.x - f.x, y: l.a.y - f.y };
      expect(Math.abs(u.x * w.y - u.y * w.x) / Math.hypot(u.x, u.y) / Math.hypot(w.x, w.y)).toBeLessThan(1e-6);
    }
    expect(referenceBounds(e)).toMatchObject({ x: 150, y: 100, w: 100, h: 100 });
    expect(hitEffectLines(e, { x: 200, y: 150 }, 2, AREA)).toBe(true);
    expect(hitEffectLines(focus({ extend: false, length: 10, cx: 100, cy: 100, rx: 10, ry: 10 }), { x: 300, y: 250 }, 2, AREA)).toBe(false);
  });

  it('follow moves, turns and flips', () => {
    const moved = transformEffectLines(focus({ fx: 10 }), [2, 0, 0, 2, 5, 5]);
    expect(moved).toMatchObject({ cx: 405, cy: 305, fx: 20, rx: 100, ry: 100, width: 12, length: 120 });
    // Flipped horizontally, speed lines turned by +30° turn by -30°.
    const flipped = transformEffectLines(speed({ angle: 30, rotation: 0 }), [-1, 0, 0, 1, 400, 0]);
    const dir = (e: EffectLines) => {
      const l = effectLinesGeometry({ ...e, maxLines: 1 }, AREA).lines[0];
      return Math.atan2(l.b.y - l.a.y, l.b.x - l.a.x);
    };
    const before = dir(speed({ angle: 30, rotation: 0 }));
    const after = dir(flipped);
    // The mirrored direction: (cos, sin) → (-cos, sin), as a line (either way round).
    expect(Math.abs(Math.sin(after - (Math.PI - before)))).toBeLessThan(1e-6);
  });

  it('reads saved lines safely', () => {
    expect(sanitizeEffectLines(null)).toBeNull();
    expect(sanitizeEffectLines({ kind: 'spiral' })).toBeNull();
    const e = sanitizeEffectLines({ kind: 'speed', gap: -4, refPos: 'nowhere', color: '#ABCDEF', width: 'wide', extend: false })!;
    expect(e.kind).toBe('speed');
    expect(e.gap).toBe(0.05);
    expect(e.refPos).toBe(DEFAULT_FOCUS_LINES.refPos);
    expect(e.color).toBe('#abcdef');
    expect(e.width).toBe(DEFAULT_FOCUS_LINES.width);
    expect(e.extend).toBe(false);
  });
});
