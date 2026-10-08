import { describe, expect, it } from 'vitest';
import {
  applyAffine,
  curveMiddle,
  defaultPerspective,
  distanceToRuler,
  isSpecial,
  moveHandle,
  perspectiveConstraint,
  rulerConstraint,
  rulerHandles,
  rulerLine,
  sanitizeRuler,
  symmetryTransforms,
  translateRuler,
  type Ruler,
} from './rulers';

const close = (p: { x: number; y: number }, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x, 6);
  expect(p.y).toBeCloseTo(y, 6);
};

describe('rulers', () => {
  it('symmetry with 2 lines mirrors left/right around a vertical axis', () => {
    const r: Ruler = { kind: 'symmetry', id: 's', center: { x: 100, y: 100 }, angle: -Math.PI / 2, lines: 2, mirror: true };
    const t = symmetryTransforms(r);
    expect(t).toHaveLength(2);
    close(applyAffine(t[0], { x: 80, y: 50 }), 80, 50);
    close(applyAffine(t[1], { x: 80, y: 50 }), 120, 50);
  });

  it('rotational symmetry repeats around the centre; line symmetry also mirrors', () => {
    const rot = symmetryTransforms({ kind: 'symmetry', id: 's', center: { x: 0, y: 0 }, angle: 0, lines: 4, mirror: false });
    expect(rot).toHaveLength(4);
    close(applyAffine(rot[1], { x: 10, y: 0 }), 0, 10);
    const kaleido = symmetryTransforms({ kind: 'symmetry', id: 's', center: { x: 0, y: 0 }, angle: 0, lines: 6, mirror: true });
    expect(kaleido).toHaveLength(6);
  });

  it('special rulers constrain strokes: parallel, radial, concentric', () => {
    const par = rulerConstraint({ kind: 'parallel', id: 'p', origin: { x: 0, y: 0 }, angle: 0 }, { x: 10, y: 30 })!;
    close(par({ x: 50, y: 41 }), 50, 30);
    const rad = rulerConstraint({ kind: 'radial', id: 'r', center: { x: 0, y: 0 } }, { x: 10, y: 10 })!;
    close(rad({ x: 20, y: 30 }), 25, 25);
    const con = rulerConstraint({ kind: 'concentric', id: 'c', center: { x: 0, y: 0 }, rx: 20, ry: 10, angle: 0 }, { x: 40, y: 0 })!;
    // The ellipse through (40, 0) has radii 40 × 20.
    close(con({ x: 0, y: 5 }), 0, 20);
  });

  it('linear rulers and guides only catch strokes that start near them', () => {
    const lin: Ruler = { kind: 'linear', id: 'l', a: { x: 0, y: 100 }, b: { x: 200, y: 100 } };
    expect(rulerConstraint(lin, { x: 50, y: 300 })).toBeNull();
    close(rulerConstraint(lin, { x: 50, y: 110 })!({ x: 80, y: 130 }), 80, 100);
    const guide: Ruler = { kind: 'guide', id: 'g', vertical: true, pos: 40 };
    close(rulerConstraint(guide, { x: 45, y: 0 })!({ x: 90, y: 70 }), 40, 70);
  });

  it('perspective strokes follow the vanishing point closest to their direction', () => {
    const r = { kind: 'perspective' as const, id: 'p', vps: [{ x: -1000, y: 0 }, { x: 1000, y: 0 }] };
    const right = perspectiveConstraint(r, { x: 0, y: 100 }, { x: 30, y: 98 })!;
    const p = right({ x: 500, y: 0 });
    // On the line from (0, 100) to the right vanishing point.
    expect(Math.abs((p.y - 100) / p.x - -100 / 1000)).toBeLessThan(1e-9);
    const up = perspectiveConstraint(r, { x: 0, y: 100 }, { x: 1, y: 60 })!;
    close(up({ x: 30, y: 10 }), 0, 10);
  });

  it('handles move and the whole ruler translates', () => {
    const s: Ruler = { kind: 'symmetry', id: 's', center: { x: 0, y: 0 }, angle: 0, lines: 2, mirror: true };
    const turned = moveHandle(s, 'rotate', { x: 0, y: 10 });
    expect(turned.kind === 'symmetry' && turned.angle).toBeCloseTo(Math.PI / 2, 6);
    const p: Ruler = { kind: 'perspective', id: 'p', vps: defaultPerspective(2, 1000, 500) };
    const moved = moveHandle(p, 'vp0', { x: -300, y: 260 });
    expect(moved.kind === 'perspective' && moved.vps[1].y).toBe(260);
    const t = translateRuler({ kind: 'linear', id: 'l', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }, 5, 5);
    expect(t.kind === 'linear' && t.a).toEqual({ x: 5, y: 5 });
    expect(distanceToRuler({ kind: 'linear', id: 'l', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }, { x: 5, y: 3 })).toBe(3);
  });

  it('sanitizes rulers from files', () => {
    expect(sanitizeRuler({ kind: 'evil' })).toBeNull();
    expect(sanitizeRuler({ kind: 'symmetry', id: 'x', lines: 99, center: { x: 'a' } })).toMatchObject({ lines: 32, center: { x: 0, y: 0 }, mirror: true });
    expect(sanitizeRuler({ kind: 'perspective', vps: [] })).toBeNull();
  });

  it('curve and figure rulers catch strokes that start near them and keep them on the line', () => {
    const curve: Ruler = {
      kind: 'curve',
      id: 'c',
      curve: 'spline',
      points: [
        { x: 0, y: 100 },
        { x: 100, y: 0 },
        { x: 200, y: 100 },
      ],
    };
    expect(isSpecial(curve)).toBe(false);
    expect(rulerConstraint(curve, { x: 100, y: 60 })).toBeNull();
    const c = rulerConstraint(curve, { x: 100, y: 10 })!;
    // On the curve (sampled every few pixels).
    const top = c({ x: 100, y: 5 });
    expect(Math.hypot(top.x - 100, top.y)).toBeLessThan(0.5);
    // Past the end the stroke stays at the end.
    for (let x = 100; x <= 300; x += 4) c({ x, y: 100 - Math.abs(100 - x) });
    close(c({ x: 300, y: 100 }), 200, 100);
    expect(distanceToRuler(curve, { x: 100, y: -7 })).toBeCloseTo(7, 6);
    const fig: Ruler = { kind: 'figure', id: 'f', shape: 'rect', center: { x: 50, y: 50 }, rx: 40, ry: 20, angle: 0, corners: 4 };
    const f = rulerConstraint(fig, { x: 20, y: 28 })!;
    close(f({ x: 50, y: 35 }), 50, 30);
    // Round the corner and down the right side.
    close(f({ x: 85, y: 30 }), 85, 30);
    close(f({ x: 95, y: 50 }), 90, 50);
    expect(rulerConstraint(fig, { x: 50, y: 150 })).toBeNull();
  });

  it('special curve rulers: parallel, multiple and radial curves', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
    ];
    const par: Ruler = { kind: 'parallelCurve', id: 'p', curve: 'polyline', points };
    expect(isSpecial(par)).toBe(true);
    const p = rulerConstraint(par, { x: 50, y: 30 })!;
    close(p({ x: 150, y: 41 }), 150, 30);
    // Beyond the end the parallel goes on straight.
    close(p({ x: 260, y: 20 }), 260, 30);
    const multi: Ruler = {
      kind: 'multiCurve',
      id: 'm',
      curve: 'polyline',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 50 },
      ],
      angle: Math.PI / 2,
    };
    const m = rulerConstraint(multi, { x: 50, y: 65 })!;
    // The same slope, 40 px lower.
    close(m({ x: 80, y: 0 }), m({ x: 80, y: 0 }).x, m({ x: 80, y: 0 }).x / 2 + 40);
    const radial: Ruler = {
      kind: 'radialCurve',
      id: 'r',
      curve: 'polyline',
      center: { x: 0, y: 0 },
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    };
    const r = rulerConstraint(radial, { x: 0, y: 50 })!;
    close(r({ x: 3, y: 80 }), 0, 80);
    // A bent radial curve: strokes follow the curve itself, not its straight extension behind the centre.
    const bent: Ruler = {
      kind: 'radialCurve',
      id: 'b',
      curve: 'polyline',
      center: { x: 0, y: 0 },
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
    };
    const b = rulerConstraint(bent, { x: 0, y: 50 })!;
    for (let y = 50; y <= 100; y += 5) b({ x: 0, y });
    close(b({ x: -50, y: 105 }), -50, 100);
  });

  it('curve rulers edit point by point; cubic anchors take their direction points along', () => {
    const cubic: Ruler = {
      kind: 'curve',
      id: 'c',
      curve: 'cubic',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 40, y: 0 },
        { x: 50, y: 0 },
        { x: 60, y: 0 },
        { x: 90, y: 0 },
        { x: 100, y: 0 },
      ],
    };
    expect(rulerHandles(cubic, { w: 100, h: 100 }).map((h) => h.key)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
    const moved = moveHandle(cubic, 'p3', { x: 50, y: 20 });
    expect(moved.kind === 'curve' && moved.points.slice(2, 5)).toEqual([
      { x: 40, y: 20 },
      { x: 50, y: 20 },
      { x: 60, y: 20 },
    ]);
    // Turning one direction point of a smooth anchor turns the other one too.
    const turned = moveHandle(cubic, 'p4', { x: 50, y: 10 });
    expect(turned.kind === 'curve' && turned.points[2].x).toBeCloseTo(50, 6);
    expect(turned.kind === 'curve' && turned.points[2].y).toBeCloseTo(-10, 6);
    const multi: Ruler = { kind: 'multiCurve', id: 'm', curve: 'polyline', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], angle: Math.PI / 2 };
    close(curveMiddle(multi), 50, 0);
    const rotate = rulerHandles(multi, { w: 100, h: 100 }).find((h) => h.key === 'rotate')!;
    close(rotate.at, 50, 80);
    const m2 = moveHandle(multi, 'rotate', { x: 130, y: 0 });
    expect(m2.kind === 'multiCurve' && m2.angle).toBeCloseTo(0, 6);
    const radial: Ruler = { kind: 'radialCurve', id: 'r', curve: 'polyline', center: { x: 0, y: 0 }, points: [{ x: 0, y: 0 }, { x: 50, y: 0 }] };
    const r2 = moveHandle(radial, 'center', { x: 5, y: 5 });
    expect(r2.kind === 'radialCurve' && r2.points[0]).toEqual({ x: 5, y: 5 });
    const t = translateRuler(radial, 1, 2);
    expect(t.kind === 'radialCurve' && [t.center, t.points[1]]).toEqual([{ x: 1, y: 2 }, { x: 51, y: 2 }]);
  });

  it('figure rulers resize and turn with their handles', () => {
    const fig: Ruler = { kind: 'figure', id: 'f', shape: 'ellipse', center: { x: 0, y: 0 }, rx: 40, ry: 20, angle: 0, corners: 6 };
    const keys = rulerHandles(fig, { w: 100, h: 100 });
    expect(keys.map((h) => h.key)).toEqual(['center', 'size', 'rotate']);
    close(keys[1].at, 40, 20);
    const sized = moveHandle(fig, 'size', { x: -60, y: 30 });
    expect(sized.kind === 'figure' && [sized.rx, sized.ry]).toEqual([60, 30]);
    const square = moveHandle(fig, 'size', { x: 60, y: 30 }, true);
    expect(square.kind === 'figure' && [square.rx, square.ry]).toEqual([60, 60]);
    const turned = moveHandle(fig, 'rotate', { x: 100, y: 0 });
    expect(turned.kind === 'figure' && turned.angle).toBeCloseTo(Math.PI / 2, 6);
  });

  it('Draw along ruler draws linear, curve and figure rulers and guides, not special ones', () => {
    const size = { w: 300, h: 200 };
    expect(rulerLine({ kind: 'guide', id: 'g', vertical: true, pos: 40 }, size)).toEqual([
      { x: 40, y: 0 },
      { x: 40, y: 200 },
    ]);
    const rect = rulerLine({ kind: 'figure', id: 'f', shape: 'rect', center: { x: 50, y: 50 }, rx: 10, ry: 10, angle: 0, corners: 4 }, size)!;
    expect(rect[0]).toEqual(rect[rect.length - 1]);
    expect(rulerLine({ kind: 'radial', id: 'r', center: { x: 0, y: 0 } }, size)).toBeNull();
    expect(rulerLine({ kind: 'parallelCurve', id: 'p', curve: 'polyline', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, size)).toBeNull();
  });

  it('sanitizes curve and figure rulers', () => {
    expect(sanitizeRuler({ kind: 'curve', curve: 'cubic', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }] })).toBeNull();
    const c = sanitizeRuler({ kind: 'curve', curve: 'weird', points: [{ x: 0, y: 0 }, { x: 1, y: 'a' }, { x: 2, y: 2 }], corners: [0, 1, 1, 9, 'x'] });
    expect(c).toMatchObject({ kind: 'curve', curve: 'spline', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 2 }], corners: [1] });
    const cubic = sanitizeRuler({ kind: 'parallelCurve', curve: 'cubic', points: Array.from({ length: 6 }, (_, i) => ({ x: i, y: 0 })) });
    expect(cubic?.kind === 'parallelCurve' && cubic.points).toHaveLength(4);
    expect(sanitizeRuler({ kind: 'radialCurve', points: [{ x: 3, y: 4 }, { x: 5, y: 6 }] })).toMatchObject({ center: { x: 3, y: 4 } });
    expect(sanitizeRuler({ kind: 'figure', shape: 'star', corners: 99, rx: -5 })).toMatchObject({ shape: 'ellipse', corners: 32, rx: 1 });
  });
});
