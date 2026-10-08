import { describe, expect, it } from 'vitest';
import { DEFAULT_BRUSH } from './tools';
import { controlPositions, eraseAt, fitLine, linePath, packStroke, sliceStroke, splineLine, unpackStroke, type VectorPoint, type VectorStroke } from './vector';
import {
  adjustedWidth,
  applyPinch,
  connectLines,
  deleteControlPoint,
  editable,
  findJoin,
  hitControlPoint,
  hitLinePath,
  insertControlPoint,
  joinInList,
  moveControlPoint,
  nearestOnLine,
  redrawLine,
  rewidth,
  setPointProps,
  simplifyLine,
  splitLine,
  startPinch,
  toggleCorner,
} from './vectorEdit';

const brush = { ...DEFAULT_BRUSH, size: 10 };
/** A dense drawn path: an arc of a circle with the given radius, widths rising along it. */
const arc = (r = 100, n = 200): VectorPoint[] => Array.from({ length: n + 1 }, (_, i) => ({ x: 150 + Math.cos(Math.PI + (i / n) * Math.PI) * r, y: 150 + Math.sin(Math.PI + (i / n) * Math.PI) * r, s: 0.5 + (i / n) * 0.5, d: 1 }));
const drawn = (path: VectorPoint[], id = 'a'): VectorStroke => splineLine({ id, color: '#000000', brush }, path);
const straight = (id: string, x0: number, y0: number, x1: number, y1: number): VectorStroke => ({
  id,
  color: '#000000',
  brush,
  curve: 'spline',
  points: [
    { x: x0, y: y0, s: 1, d: 1 },
    { x: x1, y: y1, s: 1, d: 1 },
  ],
});
/** Largest distance from the points to the line's path. */
const off = (line: VectorStroke, pts: { x: number; y: number }[]) => Math.max(...pts.map((p) => nearestOnLine(line, p).d));

describe('vector lines with control points', () => {
  it('keep few control points of a drawn line and stay on it', () => {
    const path = arc();
    const line = drawn(path);
    expect(line.curve).toBe('spline');
    expect(line.points.length).toBeLessThan(40);
    expect(line.points.length).toBeGreaterThan(4);
    expect(off(line, path)).toBeLessThan(0.6);
    // Widths too.
    const mid = linePath(line)[Math.floor(linePath(line).length / 2)];
    expect(mid.s).toBeGreaterThan(0.7);
    expect(mid.s).toBeLessThan(0.8);
    // The control points are on the path, in order.
    const pos = controlPositions(line);
    expect(pos).toHaveLength(line.points.length);
    expect(pos.every((x, i) => i === 0 || x > pos[i - 1])).toBe(true);
  });

  it('keep sharp bends as corners', () => {
    const zig: VectorPoint[] = [];
    for (let i = 0; i <= 40; i++) zig.push({ x: i * 2, y: 0, s: 1, d: 1 });
    for (let i = 1; i <= 40; i++) zig.push({ x: 80, y: i * 2, s: 1, d: 1 });
    const fit = fitLine(zig, 10);
    expect(fit.points).toHaveLength(3);
    expect(fit.corners).toEqual([1]);
  });

  it('are saved with their curve type and corners; older lines still load', () => {
    const line = { ...drawn(arc()), corners: [2] };
    const back = unpackStroke(JSON.parse(JSON.stringify(packStroke(line))), () => brush)!;
    expect(back.curve).toBe('spline');
    expect(back.corners).toEqual([2]);
    expect(back.points).toHaveLength(line.points.length);
    const old = unpackStroke({ id: 'o', color: '#000000', brush, p: [0, 0, 1, 1, 10, 0, 1, 1] }, () => brush)!;
    expect(old.curve).toBeUndefined();
    expect(linePath(old)).toBe(old.points);
  });

  it('pieces cut by the vector eraser get control points of their own', () => {
    const line = drawn(arc());
    const pieces = eraseAt([line], { x: 150, y: 50 }, 10, 'touched');
    expect(pieces).toHaveLength(2);
    for (const p of pieces) {
      expect(p.curve).toBe('spline');
      expect(p.points.length).toBeLessThan(line.points.length);
    }
    expect(sliceStroke(line, 0, linePath(line).length - 1)).toBe(line);
  });
});

describe('the Control point tool', () => {
  const line = drawn(arc());

  it('finds control points and the line under the pointer', () => {
    const p = line.points[3];
    expect(hitControlPoint([straight('x', 0, 0, 1, 1), line], { x: p.x + 2, y: p.y }, 4)).toMatchObject({ line: 1, point: 3 });
    expect(hitControlPoint([line], { x: 150, y: 150 }, 4)).toBeNull();
    expect(hitLinePath([line], { x: 150, y: 52 }, 4)?.line).toBe(0);
  });

  it('moves, adds and deletes control points', () => {
    const moved = moveControlPoint(line, 2, { x: 10, y: 10 });
    expect(moved.points[2]).toMatchObject({ x: 10, y: 10 });
    expect(moved.id).toBe(line.id);
    const at = (controlPositions(line)[3] + controlPositions(line)[4]) / 2;
    const added = insertControlPoint(line, at);
    expect(added.index).toBe(4);
    expect(added.line.points).toHaveLength(line.points.length + 1);
    // The new point is on the line, and the line hardly changes.
    expect(off(line, [added.line.points[4]])).toBeLessThan(1e-6);
    expect(off(added.line, arc())).toBeLessThan(0.8);
    expect(deleteControlPoint(added.line, 4)!.points).toHaveLength(line.points.length);
    expect(deleteControlPoint(straight('s', 0, 0, 10, 0), 0)).toBeNull();
  });

  it('switches corners, sets width and opacity, splits the line', () => {
    const corner = toggleCorner(line, 2);
    expect(corner.corners).toEqual([2]);
    expect(toggleCorner(corner, 2).corners).toBeUndefined();
    expect(toggleCorner(line, 0)).toBe(line);
    const w = setPointProps(line, 1, { s: 3, d: 0.25 });
    expect(w.points[1]).toMatchObject({ s: 3, d: 0.25 });
    const [a, b] = splitLine(corner, 4)!;
    expect(a.points).toHaveLength(5);
    expect(b.points[0]).toEqual(a.points[4]);
    expect(a.corners).toEqual([2]);
    expect(b.id).not.toBe(a.id);
    expect(splitLine(line, 0)).toBeNull();
  });

  it('edits lines of older files (dense paths) through few control points', () => {
    const old: VectorStroke = { id: 'o', color: '#000000', brush, points: arc() };
    expect(editable(old).points.length).toBeLessThan(40);
    expect(moveControlPoint(old, 0, { x: 0, y: 0 }).curve).toBe('spline');
  });
});

describe('pinch, simplify, connect, width and redraw', () => {
  it('pinching drags the grabbed part, less and less further along the line', () => {
    const l = straight('s', 0, 0, 200, 0);
    const pinch = startPinch(l, controlPositions(l)[1] / 2, 50, true, true);
    expect(pinch.line.points).toHaveLength(3);
    expect(pinch.weights).toEqual([0, 1, 0]);
    const out = applyPinch(pinch, 0, 30);
    expect(out.points[1]).toMatchObject({ x: 100, y: 30 });
    // Without fixed ends and with a long reach, the ends move a little too.
    const loose = startPinch(l, controlPositions(l)[1] / 2, 400, false, true);
    expect(loose.weights[0]).toBeGreaterThan(0);
    expect(loose.weights[0]).toBeLessThan(1);
  });

  it('simplifies the touched part, keeping corners unless asked', () => {
    const line = { ...drawn(arc()), corners: [3] };
    const all = simplifyLine(line, 6, () => true, false);
    expect(all.points.length).toBeLessThan(line.points.length);
    expect(all.corners?.length).toBe(1);
    expect(off(all, arc().filter((_, i) => i % 10 === 0))).toBeLessThan(8);
    const smooth = simplifyLine(line, 6, () => true, true);
    expect(smooth.corners).toBeUndefined();
    const part = simplifyLine(line, 6, (i) => i > line.points.length / 2, false);
    expect(part.points.slice(0, 4)).toEqual(line.points.slice(0, 4));
    expect(simplifyLine(line, 6, () => true, true, 'polyline').curve).toBe('polyline');
  });

  it('connects line ends that are close, the ends meeting halfway', () => {
    const a = straight('a', 0, 0, 100, 0);
    const b = straight('b', 104, 0, 200, 0);
    const c = { ...straight('c', 100, 3, 100, 100), color: '#ff0000' };
    const join = findJoin([a, b, c], { x: 102, y: 0 }, 10, 8, false)!;
    expect(join).toMatchObject({ a: 0, endA: 'end', b: 1, endB: 'start' });
    const lines = joinInList([a, b, c], join);
    expect(lines).toHaveLength(2);
    expect(lines[0].points.map((p) => p.x)).toEqual([0, 102, 200]);
    expect(findJoin([a, c], { x: 100, y: 1 }, 10, 8, false)).toBeNull();
    expect(findJoin([a, c], { x: 100, y: 1 }, 10, 8, true)).toBeTruthy();
    // Joining start to start turns one line round.
    const r = connectLines(straight('r', 50, 0, 0, 0), 'end', straight('q', 0, 0, 0, 50), 'start');
    expect(r.points.map((p) => [p.x, p.y])).toEqual([
      [50, 0],
      [0, 0],
      [0, 50],
    ]);
    expect(r.corners).toEqual([1]);
  });

  it('adjusts the width of the touched part', () => {
    expect(adjustedWidth(1, 10, 'thicken', 4, false)).toBeCloseTo(1.4);
    expect(adjustedWidth(0.2, 10, 'narrow', 4, true)).toBeCloseTo(0.1);
    expect(adjustedWidth(0.2, 10, 'narrow', 4, false)).toBe(0);
    expect(adjustedWidth(1, 10, 'scaleUp', 50, false)).toBeCloseTo(1.5);
    const l = straight('s', 0, 0, 200, 0);
    const path = linePath(l);
    expect(path).toHaveLength(2);
    const dense = splineLine(l, Array.from({ length: 101 }, (_, i) => ({ x: i * 2, y: 0, s: 1, d: 1 })));
    const out = rewidth(dense, (i, s) => (linePath(dense)[i].x > 100 ? s * 2 : undefined));
    const wide = linePath(out).filter((p) => p.x > 120);
    expect(wide.every((p) => Math.abs(p.s - 2) < 0.05)).toBe(true);
    expect(linePath(out).filter((p) => p.x < 80).every((p) => Math.abs(p.s - 1) < 0.05)).toBe(true);
  });

  it('redraws the part of a line between where the new stroke starts and ends', () => {
    const l = splineLine({ id: 'l', color: '#000000', brush }, Array.from({ length: 101 }, (_, i) => ({ x: i * 2, y: 0, s: 1, d: 1 })));
    // A bump from x = 60 to x = 140.
    const stroke = Array.from({ length: 41 }, (_, i) => ({ x: 60 + i * 2, y: -Math.sin((i / 40) * Math.PI) * 30 }));
    const out = redrawLine(l, stroke, 5, true)!;
    expect(off(out, [{ x: 100, y: -30 }])).toBeLessThan(1);
    expect(off(out, [{ x: 20, y: 0 }, { x: 180, y: 0 }])).toBeLessThan(0.5);
    // Drawn the other way round: the same.
    const back = redrawLine(l, [...stroke].reverse(), 5, true)!;
    expect(off(back, [{ x: 100, y: -30 }])).toBeLessThan(1);
    expect(linePath(back)[0].x).toBeCloseTo(0, 6);
    // Too far from the line: nothing.
    expect(redrawLine(l, [{ x: 0, y: 50 }, { x: 10, y: 50 }], 5, true)).toBeNull();
    // Beyond the end (not fixed): the end follows the stroke.
    const longer = redrawLine(l, [{ x: 180, y: 0 }, { x: 200, y: 0 }, { x: 240, y: 20 }], 5, false)!;
    const end = linePath(longer)[linePath(longer).length - 1];
    expect([end.x, end.y]).toEqual([240, 20]);
  });
});
