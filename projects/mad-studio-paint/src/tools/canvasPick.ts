/**
 * While a dialog takes colours from the canvas (Select > Select color gamut), a click or drag on
 * the canvas gives it the points instead of using the current tool (Space still pans).
 */
import type { PointerInfo, ToolSession } from './types';

let handler: ((x: number, y: number) => void) | null = null;
const listeners = new Set<() => void>();

export const canvasPick = {
  get active(): boolean {
    return handler !== null;
  },
  /** Presses on the canvas call `fn` with the document point. */
  start(fn: (x: number, y: number) => void): void {
    handler = fn;
    notify();
  },
  end(): void {
    handler = null;
    notify();
  },
  onChange(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

function notify(): void {
  for (const l of listeners) l();
}

/** A press on the canvas while a dialog picks from it: the point goes to the dialog. */
export class CanvasPickSession implements ToolSession {
  readonly cursor = 'crosshair';

  constructor(p: PointerInfo) {
    handler?.(Math.floor(p.x), Math.floor(p.y));
  }

  move(): void {}

  up(): void {}

  cancel(): void {}
}
