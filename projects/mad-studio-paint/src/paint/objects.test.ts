import { describe, expect, it } from 'vitest';
import { contentBounds, idsTouching, pickObject, removeObjects, transformContent, type Content } from './objects';
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
