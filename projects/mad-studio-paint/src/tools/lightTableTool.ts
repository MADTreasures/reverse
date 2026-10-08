/**
 * Light table tool (Operation): moves, scales and rotates the light table layer selected in the
 * Animation cels palette without changing what it shows (see placementBox.ts for the handles).
 */
import { engine } from '../engine/engine';
import { fromPlacement, lightPlacement, sourceRect, type LightLayer } from '../paint/lightTable';
import type { Placement } from '../paint/keyframes';
import { shownLightLayers, updateLight } from '../store/lightTableActions';
import { getState, setState } from '../store/store';
import { boxCursor, boxOf, dragPlacement, drawBox, hitBox, type BoxHandle } from './placementBox';
import type { Modifiers, OverlayView, PointerInfo, ToolSession } from './types';

const COLOR = '#14a37f';

/** The light table layer the tool moves: the selected one, if the display shows it. */
export function lightTarget(): LightLayer | null {
  const s = getState();
  return shownLightLayers(s)?.layers.find((l) => l.id === s.lightSelection) ?? null;
}

const boxFor = (l: LightLayer) => {
  const { width, height } = getState().doc;
  return boxOf(lightPlacement(l, width, height), sourceRect(l, width, height));
};

class LightTableSession implements ToolSession {
  private current: LightLayer;
  private last: PointerInfo;
  private moved = false;
  readonly cursor: string;

  constructor(
    private layer: LightLayer,
    private handle: BoxHandle,
    private start: PointerInfo,
  ) {
    this.current = layer;
    this.last = start;
    this.cursor = boxCursor(handle);
  }

  private base(): Placement {
    const { width, height } = getState().doc;
    return lightPlacement(this.layer, width, height);
  }

  private update(p: PointerInfo, m: Modifiers): void {
    if (!this.moved && Math.hypot(p.sx - this.start.sx, p.sy - this.start.sy) < 3) return;
    this.moved = true;
    this.current = fromPlacement(this.layer, dragPlacement(this.base(), this.handle, this.start, p, m, false));
    // The display shows the change until it is recorded.
    const shown = shownLightLayers();
    if (shown) engine.setLightTable({ ...shown, layers: shown.layers.map((l) => (l.id === this.layer.id ? this.current : l)) });
  }

  move(p: PointerInfo): void {
    this.last = p;
    this.update(p, p);
  }

  modifiers(m: Modifiers): void {
    this.update(this.last, m);
  }

  up(p: PointerInfo): void {
    this.update(p, p);
    if (!this.moved) return;
    const next = this.current;
    const label = this.handle.kind === 'rotate' ? 'Rotate light table layer' : this.handle.kind === 'scale' ? 'Scale light table layer' : 'Move light table layer';
    updateLight(this.layer.id, () => next, label);
  }

  cancel(): void {
    engine.setLightTable(shownLightLayers());
  }

  overlay(ctx: CanvasRenderingContext2D, view: OverlayView): void {
    drawBox(ctx, view, boxFor(this.current), { color: COLOR, width: 1.5, pivot: false });
  }
}

/** Light table tool: a session for the handle of the selected light table layer under the pointer. */
export function lightTableSession(p: PointerInfo, view: OverlayView): ToolSession | null {
  const l = lightTarget();
  if (!l) {
    setState({ hint: 'Select a light table layer in the Animation cels palette (Enable light table must be on)' });
    return null;
  }
  const handle = hitBox(p, view, boxFor(l), false);
  return handle ? new LightTableSession(l, handle, p) : null;
}

/** The selected light table layer's box (Light table tool, no drag). */
export function drawLightBox(ctx: CanvasRenderingContext2D, view: OverlayView): void {
  const l = lightTarget();
  if (l) drawBox(ctx, view, boxFor(l), { color: COLOR, width: 1.5, pivot: false });
}

export function lightHandleCursor(p: PointerInfo, view: OverlayView): string | null {
  const l = lightTarget();
  const h = l && hitBox(p, view, boxFor(l), false);
  return h ? boxCursor(h) : null;
}
