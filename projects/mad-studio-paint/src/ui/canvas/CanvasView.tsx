import { useEffect, useRef } from 'react';
import { maskOutline, type Mask } from '../../paint/mask';
import { invert, apply as applyMatrix, viewMatrix, type Matrix } from '../../paint/viewMath';
import { engine } from '../../engine/engine';
import { isMac } from '../../platform/platform';
import * as actions from '../../store/actions';
import { getState, useStore } from '../../store/store';
import { controller } from '../../tools/controller';
import type { PointerInfo } from '../../tools/types';
import { SelectionLauncher } from './SelectionLauncher';

let workspaceBg: string | null = null;
/** Colour around the canvas, from the theme (read once). */
function workspaceColor(): string {
  workspaceBg ??= getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim() || '#5c5c5c';
  return workspaceBg;
}

/** Selection outline in document coordinates, cached per mask object. */
const outlineCache = new WeakMap<Mask, Path2D>();
function outlinePath(mask: Mask): Path2D {
  let p = outlineCache.get(mask);
  if (!p) {
    p = new Path2D();
    const segs = maskOutline(mask);
    for (let i = 0; i < segs.length; i += 4) {
      p.moveTo(segs[i], segs[i + 1]);
      p.lineTo(segs[i + 2], segs[i + 3]);
    }
    outlineCache.set(mask, p);
  }
  return p;
}

let checker: HTMLCanvasElement | null = null;
function checkerTile(): HTMLCanvasElement {
  if (!checker) {
    checker = document.createElement('canvas');
    checker.width = 16;
    checker.height = 16;
    const c = checker.getContext('2d')!;
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, 16, 16);
    c.fillStyle = '#d6d6d6';
    c.fillRect(0, 0, 8, 8);
    c.fillRect(8, 8, 8, 8);
  }
  return checker;
}

/** The drawing area: renders the composite with the view transform and feeds pointer input to the tools. */
export function CanvasView() {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = hostRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let frame = 0;
    let dash = 0;
    let matrix: Matrix = [1, 0, 0, 1, 0, 0];
    let inverse: Matrix = [1, 0, 0, 1, 0, 0];

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };

    function draw() {
      frame = 0;
      const s = getState();
      const dpr = window.devicePixelRatio || 1;
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const { doc, view } = s;
      matrix = viewMatrix(view, { w, h }, { w: doc.width, h: doc.height });
      inverse = invert(matrix);
      controller.view = { matrix, zoom: view.zoom, dash };
      controller.center = { x: w / 2, y: h / 2 };

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = workspaceColor();
      ctx.fillRect(0, 0, w, h);

      const [a, b, c, d, e, f] = matrix;
      ctx.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, e * dpr, f * dpr);
      // Drop shadow under the canvas.
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 8 * dpr;
      ctx.fillStyle = doc.paper.visible ? doc.paper.color : '#ffffff';
      ctx.fillRect(0, 0, doc.width, doc.height);
      ctx.restore();
      if (!doc.paper.visible) {
        const pattern = ctx.createPattern(checkerTile(), 'repeat')!;
        pattern.setTransform(new DOMMatrix().scale(1 / view.zoom));
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, doc.width, doc.height);
      }
      if (engine.ready) {
        ctx.imageSmoothingEnabled = view.zoom < 2;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(engine.composite(), 0, 0);
      }
      if (s.selection && s.showSelectionBorder) {
        const path = outlinePath(s.selection);
        ctx.lineWidth = 1 / view.zoom;
        ctx.setLineDash([4 / view.zoom, 4 / view.zoom]);
        ctx.strokeStyle = '#ffffff';
        ctx.lineDashOffset = 0;
        ctx.stroke(path);
        ctx.strokeStyle = '#000000';
        ctx.lineDashOffset = (dash + 4) / view.zoom;
        ctx.stroke(path);
        ctx.setLineDash([]);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      controller.overlay(ctx);
      canvas.style.cursor = controller.cursor();
    }

    const toInfo = (e: PointerEvent): PointerInfo => {
      const r = canvas.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      const p = applyMatrix(inverse, sx, sy);
      const pen = e.pointerType === 'pen';
      return {
        x: p.x,
        y: p.y,
        sx,
        sy,
        pressure: pen ? Math.max(0.01, e.pressure || 0) : 1,
        button: e.button,
        pointerType: e.pointerType,
        time: e.timeStamp,
        shift: e.shiftKey,
        alt: e.altKey,
        mod: isMac ? e.metaKey : e.ctrlKey,
        space: controller.mods.space,
      };
    };

    const onDown = (e: PointerEvent) => {
      if (controller.busy) return;
      if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur?.();
      canvas.setPointerCapture(e.pointerId);
      controller.setModifiers({ shift: e.shiftKey, alt: e.altKey, mod: isMac ? e.metaKey : e.ctrlKey });
      controller.down(toInfo(e));
    };
    const onMove = (e: PointerEvent) => {
      const info = toInfo(e);
      const coalesced = controller.busy && e.getCoalescedEvents ? e.getCoalescedEvents().map(toInfo) : [];
      controller.move(info, coalesced);
    };
    const onUp = (e: PointerEvent) => {
      if (!controller.busy) return;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      controller.up(toInfo(e));
    };
    const onCancel = () => controller.cancel();
    const onLeave = () => {
      if (!controller.busy) controller.leave();
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const anchor = { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
      const { view } = getState();
      if (e.ctrlKey && !e.shiftKey) {
        // Pinch on a trackpad (or Ctrl+wheel): smooth zoom at the pointer.
        actions.zoomTo(view.zoom * Math.exp(-e.deltaY * 0.01), anchor);
      } else if (e.shiftKey && !e.altKey) {
        // Shift+wheel rotates the view.
        actions.rotateView(Math.sign(e.deltaY || e.deltaX) * 5);
      } else if (e.altKey || isMouseWheel(e)) {
        actions.zoomStep(e.deltaY < 0 ? 1 : -1, anchor);
      } else {
        // Two-finger scroll on a trackpad pans.
        actions.setView({ panX: view.panX - e.deltaX, panY: view.panY - e.deltaY });
      }
    };
    const onContext = (e: Event) => e.preventDefault();

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContext);

    const ro = new ResizeObserver(() => {
      useStore.setState({ viewport: { w: host.clientWidth, h: host.clientHeight } });
      schedule();
    });
    ro.observe(host);
    const unsubs = [
      engine.onRender(schedule),
      controller.onChange(schedule),
      useStore.subscribe((s, prev) => {
        if (s.view !== prev.view || s.doc !== prev.doc || s.selection !== prev.selection || s.subTools !== prev.subTools || s.tool !== prev.tool || s.showSelectionBorder !== prev.showSelectionBorder) schedule();
      }),
    ];
    // Marching ants.
    const ants = setInterval(() => {
      if (getState().selection) {
        dash = (dash + 1) % 8;
        schedule();
      }
    }, 120);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(ants);
      ro.disconnect();
      unsubs.forEach((u) => u());
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContext);
    };
  }, []);

  return (
    <div className="canvas-host" ref={hostRef}>
      <canvas ref={canvasRef} className="paint-canvas" data-testid="paint-canvas" />
      <SelectionLauncher />
    </div>
  );
}

/** Mouse wheels send line-based or large integer deltas; trackpads send small pixel deltas. */
function isMouseWheel(e: WheelEvent): boolean {
  if (e.deltaMode !== 0) return true;
  if (e.deltaX !== 0) return false;
  return Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50;
}
