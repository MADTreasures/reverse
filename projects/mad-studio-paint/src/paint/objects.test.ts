import { describe, expect, it } from 'vitest';
import { contentBounds, idsTouching, localAffine, pickObject, removeObjects, transformContent, warpContent, type Content } from './objects';
import { DEFAULT_TEXT_STYLE, type Balloon, type TextBox } from './text';
import { DEFAULT_BRUSH } from './tools';

const text = (id: string, x: number, y: number, patch: Partial<TextBox> = {}): TextBox => ({ ...DEFAULT_TEXT_STYLE, id, x, y, w: 40, h: 20, angle: 0, wrap: false, text: 'Hi', ...patch });
const balloon = (id: string, x: number, y: number): Balloon => ({ id, shape: 'ellipse', x, y, w: 100, h: 60, angle: 0, lineWidth: 2, lineColor: '#000000', fillColor: '#ffffff', tails: [] });
const line = (id: string, y: number) => ({ id, color: '#000000', brush: { ...DEFAULT_BRUSH, size: 4 }, points: [0, 50, 100].map((x) => ({ x, y, s: 1, d: 1 })) });

const content: Content = { strokes: [line('l', 300)], balloons: [balloon('b', 0, 0)], texts: [text('in', 30, 20), text('out', 200, 200)], panels: [] };

describe('layer objects', () => {
  it('text in a balloon moves with it; other objects stay', () => {
    const moved = transformContent(content, new Set(['b']), [1, 0, 0, 1, 10, 5]);
    expect(moved.balloons[0]).toMatchObject({ x: 10, y: 5 });
    expect(moved.texts.find((t) => t.id === 'in')).toMatchObject({ x: 40, y: 25 });
    expect(moved.texts.find((t) => t.id === 'out')).toMatchObject({ x: 200, y: 200 });
    expect(moved.strokes[0]).toBe(content.strokes[0]);
  });

  it('scaling grows letters of text that does not wrap, and only the frame of text that does', () => {
    const c: Content = { strokes: [], balloons: [], panels: [], texts: [text('a', 0, 0), text('b', 100, 0, { wrap: true })] };
    const big = transformContent(c, null, [2, 0, 0, 2, 0, 0]);
    expect(big.texts.map((t) => t.size)).toEqual([48, 24]);
    expect(big.texts[1].w).toBe(80);
    // Scaling the whole image scales all letters.
    expect(transformContent(c, null, [2, 0, 0, 2, 0, 0], { scaleText: true }).texts.map((t) => t.size)).toEqual([48, 48]);
  });

  it('picks text over balloons, finds what a selection touches, bounds and removes', () => {
    expect(pickObject(content, { x: 40, y: 30 }, 0)).toBe('in');
    expect(pickObject(content, { x: 80, y: 30 }, 0)).toBe('b');
    expect(pickObject(content, { x: 50, y: 301 }, 2)).toBe('l');
    expect(pickObject(content, { x: 150, y: 150 }, 2)).toBeNull();
    expect([...idsTouching(content, (p) => p.y < 100)].sort()).toEqual(['b', 'in']);
    const box = contentBounds(content, new Set(['out']))!;
    expect(box.x).toBeLessThanOrEqual(200);
    expect(box.x + box.w).toBeGreaterThanOrEqual(240);
    expect(removeObjects(content, new Set(['b', 'l']))).toMatchObject({ strokes: [], balloons: [] });
  });
});

describe('non-affine transforms of objects', () => {
  it('maps line points exactly and widths by the local scale', () => {
    const c: Content = { strokes: [line('a', 10), line('b', 40)], texts: [], balloons: [], panels: [{ id: 'p', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }] };
    // A perspective-like map: rows further down are wider.
    const map = (p: { x: number; y: number }) => ({ x: p.x * (1 + p.y / 100), y: p.y * 2 });
    const out = warpContent(c, new Set(['a', 'p']), map);
    expect(out.strokes[0].points.map((p) => [Math.round(p.x * 1e9) / 1e9, p.y])).toEqual([
      [0, 20],
      [55, 20],
      [110, 20],
    ]);
    // Untouched objects stay; the width follows the area scale near the line (≈ √(1.1 · 2)).
    expect(out.strokes[1]).toBe(c.strokes[1]);
    expect(out.strokes[0].brush.size).toBeCloseTo(4 * Math.sqrt(1.1 * 2), 1);
    expect(out.panels[0].points[2].x).toBeCloseTo(11, 9);
    expect(out.panels[0].points[2].y).toBe(20);
  });

  it('approximates a map by its local affine part', () => {
    const m = localAffine((p) => ({ x: 2 * p.x + 3, y: p.y - p.x }), { x: 5, y: 5 });
    expect(m.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([2, -1, 0, 1, 3, 0]);
  });
});
