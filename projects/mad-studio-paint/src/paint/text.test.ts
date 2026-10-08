import { describe, expect, it } from 'vitest';
import {
  balloonBounds,
  DEFAULT_TEXT_STYLE,
  hitBalloon,
  hitTextBox,
  layoutText,
  sanitizeBalloon,
  sanitizeTextBox,
  tailShapes,
  transformBalloon,
  transformText,
  type Balloon,
  type Measure,
  type TextBox,
} from './text';

/** Every character is half the font size wide (plus letter spacing). */
const measure: Measure = (text, font, spacing) => {
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
  return [...text].length * (size / 2 + spacing);
};

const box = (patch: Partial<TextBox> = {}): TextBox => ({ ...DEFAULT_TEXT_STYLE, size: 20, lineSpacing: 1, id: 't', x: 0, y: 0, angle: 0, w: 100, h: 100, wrap: false, text: '', ...patch });

const balloon = (patch: Partial<Balloon> = {}): Balloon => ({
  id: 'b',
  shape: 'ellipse',
  x: 0,
  y: 0,
  w: 200,
  h: 100,
  angle: 0,
  lineWidth: 3,
  lineColor: '#000000',
  fillColor: '#ffffff',
  tails: [],
  ...patch,
});

describe('text layout', () => {
  it('sizes a box without wrapping to its text, line by line', () => {
    const l = layoutText(box({ text: 'abcd\nab' }), measure);
    expect(l.w).toBe(40);
    expect(l.h).toBe(40);
    expect(l.runs.map((r) => [r.text, r.y])).toEqual([
      ['abcd', 10],
      ['ab', 30],
    ]);
  });

  it('wraps at the frame and aligns lines', () => {
    const l = layoutText(box({ text: 'aaa bbb ccc', wrap: true, w: 75, align: 'right' }), measure);
    // "aaa bbb" is 70 px wide; "ccc" goes to the next line, right aligned.
    expect(l.runs.map((r) => r.text)).toEqual(['aaa bbb', 'ccc']);
    expect(l.runs[1].x).toBe(75 - 30);
    // A word longer than the frame breaks between letters; CJK text breaks anywhere.
    expect(layoutText(box({ text: 'abcdefghij', wrap: true, w: 45 }), measure).runs.map((r) => r.text)).toEqual(['abcd', 'efgh', 'ij']);
    expect(layoutText(box({ text: '日本語の文章', wrap: true, w: 30 }), measure).runs.map((r) => r.text)).toEqual(['日本語', 'の文章']);
  });

  it('sets vertical text in columns from right to left, Latin letters sideways', () => {
    const l = layoutText(box({ text: 'あい\nAB', vertical: true }), measure);
    expect(l.w).toBe(40);
    expect(l.h).toBe(40);
    const [a, , capA] = l.runs;
    expect(a).toMatchObject({ text: 'あ', x: 30, y: 10 });
    expect(a.sideways).toBeUndefined();
    expect(capA).toMatchObject({ text: 'A', x: 10, sideways: true });
  });
});

describe('text boxes and balloons', () => {
  it('hit tests rotated frames', () => {
    const t = box({ x: 100, y: 100, w: 50, h: 20, angle: Math.PI / 2 });
    // Rotated a quarter turn about its anchor, the frame runs downwards and to the left.
    expect(hitTextBox(t, { x: 90, y: 120 })).toBe(true);
    expect(hitTextBox(t, { x: 120, y: 120 })).toBe(false);
  });

  it('moving, scaling and rotating keeps the centre in place; mirrors keep text readable', () => {
    const t = box({ x: 0, y: 0, w: 40, h: 20 });
    const scaled = transformText(t, [2, 0, 0, 2, 0, 0], true);
    expect(scaled).toMatchObject({ x: 0, y: 0, w: 80, h: 40, size: 40 });
    expect(transformText(t, [2, 0, 0, 2, 0, 0], false).size).toBe(20);
    const flipped = transformText(t, [-1, 0, 0, 1, 100, 0], true);
    // The frame lands on x 60…100 and is not turned upside down.
    expect(flipped.x).toBeCloseTo(60, 6);
    expect(Math.abs(flipped.angle)).toBeCloseTo(0, 6);
    const turned = transformText(t, [0, 1, -1, 0, 0, 0], true);
    expect(turned.angle).toBeCloseTo(Math.PI / 2, 6);
  });

  it('balloons are hit inside their body and tails; tails stretch the bounds', () => {
    const b = balloon({ tails: [{ id: 'q', tip: { x: 100, y: 200 }, width: 30, bend: 0, kind: 'pointed' }] });
    expect(hitBalloon(b, { x: 100, y: 50 })).toBe(true);
    expect(hitBalloon(b, { x: 5, y: 5 })).toBe(false);
    expect(hitBalloon(b, { x: 100, y: 180 })).toBe(true);
    expect(balloonBounds(b).h).toBeGreaterThan(200);
    const thought = tailShapes({ ...b, tails: [] }, { id: 'q', tip: { x: 100, y: 200 }, width: 30, bend: 0, kind: 'thought' });
    expect(thought).toHaveLength(3);
    const moved = transformBalloon(b, [1, 0, 0, 1, 10, 20]);
    expect(moved).toMatchObject({ x: 10, y: 20, w: 200, h: 100 });
    expect(moved.tails[0].tip).toEqual({ x: 110, y: 220 });
  });

  it('sanitizes text boxes and balloons from files', () => {
    expect(sanitizeTextBox({ text: 5 })).toBeNull();
    expect(sanitizeTextBox({ text: 'Hi', font: 'x;}', size: -3, align: 'evil' })).toMatchObject({ text: 'Hi', font: 'sans-serif', size: 0.5, align: 'left' });
    expect(sanitizeBalloon({ shape: 'star', fillColor: null, tails: [{ tip: { x: 1 } }] })).toMatchObject({ shape: 'ellipse', fillColor: null, tails: [{ tip: { x: 1, y: 0 }, kind: 'pointed' }] });
  });
});
