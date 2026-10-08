/**
 * Routes pointer input on the canvas to the active tool, applying the modifier keys of the
 * reference workflow: Space = hand, Shift+Space = rotate, ⌘+Space = zoom in, ⌥+Space = zoom out,
 * ⌥-click = eyedropper while drawing, ⌘⌥-drag = brush size, ⌘⇧-click = select layer under pointer,
 * right click = eyedropper, middle button = hand.
 */
import { BRUSH_TOOLS, type ToolId } from '../paint/tools';
import { cursorFor, effectiveTool, type EffectiveTool } from './modifiers';
import { apply as applyMatrix } from '../paint/viewMath';
import { currentSubTool, getState, setState } from '../store/store';
import * as actions from '../store/actions';
import {
  autoSelectAt,
  BrushSession,
  BrushSizeSession,
  EyedropperSession,
  FigureSession,
  fillAt,
  GradientSession,
  HandSession,
  MoveSession,
  pickLayerAt,
  PolylineSelect,
  RotateSession,
  SelectionPenSession,
  SelectSession,
  ZoomSession,
} from './sessions';
import { drawRulers, rulerSession } from './rulerTool';
import { drawLineSelection, lineHandleCursor, objectSession } from './objectTool';
import { balloonSession, textSession } from './textTool';
import { frameSession } from './frameTool';
import { confirmTransform, drawTransformOverlay, hitHandle, isTransforming, transformCursor, TransformSession } from './transform';
import type { Modifiers, OverlayView, PointerInfo, ToolSession } from './types';

const DOUBLE_CLICK_MS = 350;

class Controller {
  mods: Modifiers = { shift: false, alt: false, mod: false, space: false };
  private lastDown: { time: number; sx: number; sy: number; tool: string } | null = null;
  session: ToolSession | null = null;
  hover: PointerInfo | null = null;
  view: OverlayView = { matrix: [1, 0, 0, 1, 0, 0], zoom: 1, dash: 0 };
  center = { x: 0, y: 0 };
  private listeners = new Set<() => void>();

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const l of this.listeners) l();
  }

  get busy(): boolean {
    return this.session !== null;
  }

  current(button = 0): EffectiveTool {
    return effectiveTool(getState().tool, this.mods, button);
  }

  cursor(): string {
    if (this.session?.cursor) return this.session.cursor;
    if (isTransforming() && !this.mods.space && this.hover) return transformCursor(hitHandle(this.hover, this.view));
    const t = this.current();
    const line = t === 'object' && this.hover ? lineHandleCursor(this.hover, this.view) : null;
    if (line) return line;
    if (t === 'select' && currentSubTool().brush) return 'none';
    return cursorFor(t);
  }

  setModifiers(m: Partial<Modifiers>): void {
    const next = { ...this.mods, ...m };
    if (next.shift === this.mods.shift && next.alt === this.mods.alt && next.mod === this.mods.mod && next.space === this.mods.space) return;
    this.mods = next;
    this.session?.modifiers?.(next);
    this.changed();
  }

  down(p: PointerInfo): void {
    if (this.session) return;
    this.hover = p;
    this.session = this.start(p);
    this.changed();
  }

  /** True when this press is the second click of a double click with the same tool. */
  private isDoubleClick(p: PointerInfo, tool: string): boolean {
    const last = this.lastDown;
    this.lastDown = { time: p.time, sx: p.sx, sy: p.sy, tool };
    return Boolean(last && last.tool === tool && p.time - last.time < DOUBLE_CLICK_MS && Math.hypot(p.sx - last.sx, p.sy - last.sy) < 6);
  }

  private start(p: PointerInfo): ToolSession | null {
    if (isTransforming() && !p.space && p.button === 0) {
      const handle = hitHandle(p, this.view);
      // Double-click inside the box confirms the transform.
      if (this.isDoubleClick(p, 'transform') && handle.kind === 'move') {
        confirmTransform();
        return null;
      }
      return new TransformSession(p, handle);
    }
    const tool = effectiveTool(getState().tool, p, p.button);
    const sub = currentSubTool();
    if (getState().hint) setState({ hint: '' });
    const double = this.isDoubleClick(p, tool);
    switch (tool) {
      case 'hand':
        return new HandSession(p);
      case 'rotate':
        // Double-click with the rotate tool (or Shift+Space) resets the rotation.
        if (double) {
          actions.resetRotation();
          return null;
        }
        return new RotateSession(p, this.center);
      case 'zoom':
        return ZoomSession.create(p, getState().tool === 'zoom' ? sub : null, this.center);
      case 'zoomOut':
        return getState().tool === 'zoom' && !p.space ? ZoomSession.create(p, sub, this.center) : ZoomSession.create(p, null, this.center, true);
      case 'selectLayer':
        pickLayerAt(p);
        return null;
      case 'eyedropper':
        return new EyedropperSession(getState().tool === 'eyedropper' && Boolean(sub.fromLayer), p);
      case 'brushSize':
        return new BrushSizeSession(sub, p);
      case 'pickLayer':
        pickLayerAt(p);
        return null;
      case 'pen':
      case 'pencil':
      case 'brush':
      case 'airbrush':
      case 'eraser':
      case 'blend':
        return BrushSession.create(sub, p);
      case 'figure':
        return FigureSession.create(sub, p);
      case 'fill':
        fillAt(sub, p);
        return null;
      case 'gradient':
        return GradientSession.create(sub, p);
      case 'select':
        if (sub.selectShape === 'polyline') {
          PolylineSelect.click(p);
          return null;
        }
        if (sub.selectShape === 'pen' || sub.selectShape === 'erase') return new SelectionPenSession(sub, p);
        return new SelectSession(sub, p);
      case 'autoSelect':
        autoSelectAt(sub, p);
        return null;
      case 'move':
        return MoveSession.create(p);
      case 'ruler':
        return rulerSession(sub, p, this.view);
      case 'object':
        return objectSession(p, this.view);
      case 'text':
        return textSession(p);
      case 'balloon':
        return balloonSession(sub, p);
      case 'frame':
        return frameSession(sub, p);
      default:
        return null;
    }
  }

  move(p: PointerInfo, coalesced: PointerInfo[]): void {
    this.hover = p;
    if (this.session) this.session.move(p, coalesced);
    else if (PolylineSelect.active) PolylineSelect.active.hover = { x: p.x, y: p.y };
    this.changed();
  }

  up(p: PointerInfo): void {
    const s = this.session;
    this.session = null;
    if (s) s.up(p);
    this.changed();
  }

  cancel(): void {
    const s = this.session;
    this.session = null;
    s?.cancel();
    this.changed();
  }

  leave(): void {
    this.hover = null;
    this.changed();
  }

  /** Draws tool feedback (brush outline, selection preview, transform box) in viewport space. */
  overlay(ctx: CanvasRenderingContext2D): void {
    drawRulers(ctx, this.view);
    // The Object tool (also ⌘ with drawing tools) shows the selected vector lines.
    if (!this.session?.overlay && this.current() === 'object') drawLineSelection(ctx, this.view);
    drawTransformOverlay(ctx, this.view);
    PolylineSelect.overlay(ctx, this.view);
    if (this.session?.overlay) {
      this.session.overlay(ctx, this.view);
      if (!(this.session instanceof SelectionPenSession)) return;
    }
    const h = this.hover;
    if (!h || this.session instanceof TransformSession) return;
    const tool = this.current();
    const sub = currentSubTool();
    const brushCursor = BRUSH_TOOLS.includes(tool as ToolId) || (tool === 'select' && Boolean(sub.brush));
    if (!brushCursor || isTransforming()) return;
    if (!sub.brush) return;
    const c = applyMatrix(this.view.matrix, h.x, h.y);
    const r = (sub.brush.size / 2) * this.view.zoom;
    ctx.save();
    ctx.lineWidth = 1;
    if (r >= 3) {
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.arc(c.x, c.y, r + 1, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Small crosshair at the hot spot.
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.beginPath();
    ctx.moveTo(c.x - 4, c.y);
    ctx.lineTo(c.x + 4, c.y);
    ctx.moveTo(c.x, c.y - 4);
    ctx.lineTo(c.x, c.y + 4);
    ctx.stroke();
    ctx.restore();
  }
}

export const controller = new Controller();
