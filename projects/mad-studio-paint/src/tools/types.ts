import type { Matrix } from '../paint/viewMath';

export interface Modifiers {
  shift: boolean;
  /** Option on macOS. */
  alt: boolean;
  /** Command on macOS, Ctrl elsewhere. */
  mod: boolean;
  space: boolean;
}

export interface PointerInfo extends Modifiers {
  /** Document coordinates. */
  x: number;
  y: number;
  /** Viewport coordinates (CSS px, relative to the canvas element). */
  sx: number;
  sy: number;
  pressure: number;
  /** Pen tilt: 0 upright … 1 flat, and the direction it leans (radians). */
  tilt: number;
  azimuth: number;
  button: number;
  pointerType: string;
  time: number;
}

export interface OverlayView {
  /** Document → viewport matrix. */
  matrix: Matrix;
  zoom: number;
  /** Animated dash offset for "marching ants". */
  dash: number;
}

/** One press-drag-release interaction. */
export interface ToolSession {
  move(p: PointerInfo, coalesced: PointerInfo[]): void;
  up(p: PointerInfo): void;
  cancel(): void;
  /** Modifier keys changed mid-drag (e.g. Shift to constrain). */
  modifiers?(m: Modifiers): void;
  overlay?(ctx: CanvasRenderingContext2D, view: OverlayView): void;
  cursor?: string;
}
