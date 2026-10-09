import { describe, expect, it } from 'vitest';
import { areaRect, defaultFrameSettings, layoutFrames, mapOutputFrame, resizeOutputFrame, safeRect, sanitizeOutputFrame } from './outputFrame';

describe('animation frame lines', () => {
  it('the reference defaults: title-safe area and blank space of about a tenth', () => {
    const s = defaultFrameSettings(720, 540);
    expect(s.safe).toEqual({ top: 50, bottom: 50, left: 50, right: 50 });
    expect(s.blank).toEqual({ top: 54, bottom: 54, left: 72, right: 72 });
    // The canvas is the output frame with the blank space around it.
    const l = layoutFrames(s);
    expect([l.width, l.height]).toEqual([864, 648]);
    expect(l.frame).toEqual({ x: 72, y: 54, w: 720, h: 540, safe: { top: 50, bottom: 50, left: 50, right: 50 } });
    expect(safeRect(l.frame)).toEqual({ x: 122, y: 104, w: 620, h: 440 });
  });

  it('an overflow frame twice as wide, the output frame on its left or moved by an offset', () => {
    const s = { ...defaultFrameSettings(720, 540), safe: null, overflow: { scale: true, w: 2, h: 1, refX: -1 as const, refY: 0 as const, offsetX: 0, offsetY: 0 } };
    const l = layoutFrames(s);
    expect([l.width, l.height]).toEqual([1440 + 144, 540 + 108]);
    expect(l.frame).toEqual({ x: 72, y: 54, w: 720, h: 540, overflow: { x: 72, y: 54, w: 1440, h: 540 } });
    // Right, then 100 px back to the left; an offset never leaves the overflow frame.
    expect(layoutFrames({ ...s, overflow: { ...s.overflow, refX: 1, offsetX: -100 } }).frame.x).toBe(72 + 720 - 100);
    expect(layoutFrames({ ...s, overflow: { ...s.overflow, refX: 1, offsetX: 500 } }).frame.x).toBe(72 + 720);
    // Specified size: at least the output frame.
    expect(layoutFrames({ ...s, overflow: { ...s.overflow, scale: false, w: 600, h: 900 } }).frame.overflow).toEqual({ x: 72, y: 54, w: 720, h: 900 });
  });

  it('exports draw the output frame, the overflow frame or the entire canvas', () => {
    const { frame } = layoutFrames({ ...defaultFrameSettings(100, 50), overflow: { scale: true, w: 1.5, h: 1, refX: 0, refY: 0, offsetX: 0, offsetY: 0 } });
    expect(areaRect(frame, 'output', 170, 60)).toEqual({ x: 35, y: 5, w: 100, h: 50 });
    expect(areaRect(frame, 'overflow', 170, 60)).toEqual({ x: 10, y: 5, w: 150, h: 50 });
    expect(areaRect(frame, 'canvas', 170, 60)).toEqual({ x: 0, y: 0, w: 170, h: 60 });
    expect(areaRect(undefined, 'output', 170, 60)).toEqual({ x: 0, y: 0, w: 170, h: 60 });
  });

  it('follows the canvas when it is resized or scaled', () => {
    const f = { x: 10, y: 10, w: 100, h: 50, safe: { top: 5, bottom: 5, left: 10, right: 10 } };
    expect(mapOutputFrame(f, 2, 2, 0, 0, 400, 200)).toEqual({ x: 20, y: 20, w: 200, h: 100, safe: { top: 10, bottom: 10, left: 20, right: 20 } });
    expect(mapOutputFrame(f, 1, 1, -50, 0, 80, 80)).toEqual({ x: 0, y: 10, w: 60, h: 50, safe: { top: 5, bottom: 5, left: 10, right: 10 } });
    expect(mapOutputFrame(f, 1, 1, -200, 0, 80, 80)).toBeUndefined();
  });

  it('a 2D camera folder sets the size of the output frame (about its middle)', () => {
    expect(resizeOutputFrame(undefined, 100, 50, 400, 300)).toEqual({ x: 150, y: 125, w: 100, h: 50 });
    const f = { x: 10, y: 10, w: 100, h: 100, safe: { top: 30, bottom: 30, left: 5, right: 5 } };
    expect(resizeOutputFrame(f, 40, 40, 120, 120)).toEqual({ x: 40, y: 40, w: 40, h: 40, safe: { top: 30, bottom: 9, left: 5, right: 5 } });
    expect(resizeOutputFrame(f, 500, 20, 120, 120)).toEqual({ x: 0, y: 50, w: 120, h: 20, safe: { top: 19, bottom: 0, left: 5, right: 5 } });
  });

  it('reads frame lines from files safely', () => {
    expect(sanitizeOutputFrame(null, 100, 100)).toBeUndefined();
    expect(sanitizeOutputFrame({ x: 'a' }, 100, 100)).toBeUndefined();
    expect(sanitizeOutputFrame({ x: -5, y: 10, w: 500, h: 20, safe: { top: 30, left: 2 }, overflow: { x: 0, y: 0, w: 100, h: 100 } }, 100, 100)).toEqual({
      x: 0,
      y: 10,
      w: 100,
      h: 20,
      safe: { top: 19, bottom: 0, left: 2, right: 0 },
      overflow: { x: 0, y: 0, w: 100, h: 100 },
    });
  });
});
