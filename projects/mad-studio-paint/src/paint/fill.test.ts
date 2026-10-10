import { describe, expect, it } from 'vitest';
import { enclosedFillMask, scaleArea, shrinkToDrawing } from './fill';
import { createMask, polygonMask, rectMask } from './mask';

const W = 40;
const H = 30;

/** Transparent pixels with black square outlines (closed areas). */
function lineArt(boxes: [number, number, number, number][], gapAt?: [number, number]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  const ink = (x: number, y: number) => px.set([0, 0, 0, 255], (y * W + x) * 4);
  for (const [x0, y0, x1, y1] of boxes) {
    for (let x = x0; x <= x1; x++) {
      ink(x, y0);
      ink(x, y1);
    }
    for (let y = y0; y <= y1; y++) {
      ink(x0, y);
      ink(x1, y);
    }
  }
  if (gapAt) px.set([0, 0, 0, 0], (gapAt[1] * W + gapAt[0]) * 4);
  return px;
}

const count = (m: { data: Uint8Array }) => m.data.reduce((n, v) => n + (v ? 1 : 0), 0);
const at = (m: { data: Uint8Array }, x: number, y: number) => m.data[y * W + x];

describe('closed-area fills', () => {
  it('Enclose and fill: fills the closed areas inside the lasso, not the background around them', () => {
    const px = lineArt([
      [2, 2, 10, 10],
      [14, 2, 22, 10],
      [28, 2, 36, 10],
    ]);
    // The lasso goes round the first two boxes only.
    const lasso = polygonMask(W, H, [
      { x: 0, y: 0 },
      { x: 25, y: 0 },
      { x: 25, y: 15 },
      { x: 0, y: 15 },
    ]);
    const m = enclosedFillMask(px, W, H, lasso, { target: 'transparent', tolerance: 0 });
    expect(at(m, 5, 5)).toBe(255);
    expect(at(m, 18, 6)).toBe(255);
    expect(at(m, 31, 6)).toBe(0);
    // The background (open to the outside of the lasso) and the lines stay.
    expect(at(m, 12, 12)).toBe(0);
    expect(at(m, 2, 5)).toBe(0);
    expect(count(m)).toBe(2 * 7 * 7);
  });

  it('closes small gaps so an area with a break still counts as closed', () => {
    const px = lineArt([[2, 2, 12, 12]], [7, 2]);
    const lasso = rectMask(W, H, { x: 0, y: 0, w: 16, h: 16 });
    expect(at(enclosedFillMask(px, W, H, lasso, { target: 'transparent', tolerance: 0 }), 7, 7)).toBe(0);
    expect(at(enclosedFillMask(px, W, H, lasso, { target: 'transparent', tolerance: 0, closeGap: 1 }), 7, 7)).toBe(255);
  });

  it('All colours: each one-coloured area inside counts, lines included', () => {
    const px = lineArt([[2, 2, 10, 10]]);
    const lasso = rectMask(W, H, { x: 0, y: 0, w: 14, h: 14 });
    const m = enclosedFillMask(px, W, H, lasso, { target: 'all', tolerance: 0 });
    expect(at(m, 2, 2)).toBe(255);
    expect(at(m, 5, 5)).toBe(255);
    // The outside of the box reaches beyond the lasso.
    expect(at(m, 0, 0)).toBe(0);
  });

  it('Leftover pen: a small closed spot under the brushed path', () => {
    const px = lineArt([[2, 2, 6, 6]]);
    const brushed = createMask(W, H);
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) brushed.data[y * W + x] = 255;
    const m = enclosedFillMask(px, W, H, brushed, { target: 'transparent', tolerance: 0 });
    expect(count(m)).toBe(9);
  });
});

describe('area scaling', () => {
  const dot = () => {
    const m = createMask(W, H);
    m.data[15 * W + 20] = 255;
    return m;
  };

  it('grows with a square or a disc and shrinks back', () => {
    expect(count(scaleArea(dot(), 2, 'rectangle'))).toBe(25);
    const round = scaleArea(dot(), 2, 'round');
    expect(count(round)).toBe(13);
    expect(at(round, 22, 17)).toBe(0);
    const block = rectMask(W, H, { x: 10, y: 10, w: 10, h: 10 });
    expect(count(scaleArea(block, -2, 'rectangle'))).toBe(36);
    expect(count(scaleArea(block, -2, 'round'))).toBe(36);
  });

  it('To darkest pixel grows into a line up to its darkest middle, not beyond', () => {
    // A vertical line at x 10..14 whose opacity rises to the middle (x 12) and falls again.
    const px = new Uint8ClampedArray(W * H * 4);
    const alpha = [64, 160, 255, 160, 64];
    for (let y = 0; y < H; y++) for (let k = 0; k < 5; k++) px.set([0, 0, 0, alpha[k]], (y * W + 10 + k) * 4);
    const left = rectMask(W, H, { x: 0, y: 0, w: 10, h: H });
    const grown = scaleArea(left, 6, 'darkest', px);
    expect(at(grown, 12, 5)).toBe(255);
    expect(at(grown, 13, 5)).toBe(0);
    expect(at(scaleArea(left, 6, 'round', px), 15, 5)).toBe(255);
  });
});

describe('shrink selection', () => {
  it('shrinks a lasso onto the drawing: lines and enclosed areas stay, empty space around goes', () => {
    const px = lineArt([[5, 5, 15, 15]]);
    const lasso = rectMask(W, H, { x: 0, y: 0, w: 25, h: 25 });
    const m = shrinkToDrawing(px, W, H, lasso, { target: 'transparent', tolerance: 0 });
    expect(at(m, 5, 5)).toBe(255);
    expect(at(m, 10, 10)).toBe(255);
    expect(at(m, 2, 2)).toBe(0);
    expect(at(m, 30, 2)).toBe(0);
    expect(count(m)).toBe(11 * 11);
  });
});
