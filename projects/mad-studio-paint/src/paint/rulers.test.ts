import { describe, expect, it } from 'vitest';
import {
  applyAffine,
  defaultPerspective,
  distanceToRuler,
  moveHandle,
  perspectiveConstraint,
  rulerConstraint,
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
});
