/**
 * The red × of the filter dialogs with a centre (Radial blur, Twirl, Fish-eye lens …): shown on
 * the canvas while the dialog is open; pressing or dragging on the canvas moves it.
 */
import { apply as applyMatrix } from '../paint/viewMath';
import type { OverlayView, PointerInfo, ToolSession } from './types';

interface CenterState {
  x: number;
  y: number;
  onMove: (x: number, y: number) => void;
}

let state: CenterState | null = null;
const listeners = new Set<() => void>();

export const filterCenter = {
  get active(): boolean {
    return state !== null;
  },
  get point(): { x: number; y: number } | null {
    return state ? { x: state.x, y: state.y } : null;
  },
  /** Shows the × at (x, y); `onMove` hears where the user puts it. */
  start(x: number, y: number, onMove: (x: number, y: number) => void): void {
    state = { x, y, onMove };
    notify();
  },
  /** Moves the × without telling the dialog (it set the value itself). */
  set(x: number, y: number): void {
    if (!state) return;
    state.x = x;
    state.y = y;
    notify();
  },
  end(): void {
    state = null;
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

function moveTo(p: PointerInfo): void {
  if (!state) return;
  state.x = Math.round(p.x);
  state.y = Math.round(p.y);
  state.onMove(state.x, state.y);
  notify();
}

/** Press and drag on the canvas while a filter dialog with a centre is open. */
export class FilterCenterSession implements ToolSession {
  readonly cursor = 'crosshair';

  constructor(p: PointerInfo) {
    moveTo(p);
  }

  move(p: PointerInfo): void {
    moveTo(p);
  }

  up(p: PointerInfo): void {
    moveTo(p);
  }

  cancel(): void {}
}

/** The red × (with a white halo so it shows on any colour). */
export function drawFilterCenter(ctx: CanvasRenderingContext2D, view: OverlayView): void {
  if (!state) return;
  const c = applyMatrix(view.matrix, state.x, state.y);
  const r = 6;
  ctx.save();
  ctx.lineCap = 'round';
  for (const [color, width] of [
    ['rgba(255,255,255,0.9)', 4],
    ['#e0201b', 2],
  ] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(c.x - r, c.y - r);
    ctx.lineTo(c.x + r, c.y + r);
    ctx.moveTo(c.x + r, c.y - r);
    ctx.lineTo(c.x - r, c.y + r);
    ctx.stroke();
  }
  ctx.restore();
}
