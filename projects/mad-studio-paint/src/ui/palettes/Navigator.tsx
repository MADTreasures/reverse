import { useEffect, useRef } from 'react';
import { apply as applyMatrix, invert, viewMatrix } from '../../paint/viewMath';
import { engine } from '../../engine/engine';
import * as actions from '../../store/actions';
import { getState, useStore } from '../../store/store';
import { RotationControls, ZoomControls } from '../controls/ViewControls';

const W = 220;
const H = 140;

/** Overview of the whole canvas with the visible area, plus zoom / rotation controls. */
export function Navigator() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const draw = () => {
      timer = null;
      const c = ref.current;
      if (!c || !engine.ready) return;
      const s = getState();
      const dpr = window.devicePixelRatio || 1;
      c.width = W * dpr;
      c.height = H * dpr;
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const k = Math.min((W - 8) / s.doc.width, (H - 8) / s.doc.height);
      const w = s.doc.width * k;
      const h = s.doc.height * k;
      const x = (W - w) / 2;
      const y = (H - h) / 2;
      ctx.fillStyle = s.doc.paper.visible ? s.doc.paper.color : '#ffffff';
      ctx.fillRect(x, y, w, h);
      ctx.imageSmoothingQuality = 'medium';
      ctx.drawImage(engine.composite(), x, y, w, h);
      // Visible area of the main view.
      const m = invert(viewMatrix(s.view, s.viewport, { w: s.doc.width, h: s.doc.height }));
      const pts = [
        [0, 0],
        [s.viewport.w, 0],
        [s.viewport.w, s.viewport.h],
        [0, s.viewport.h],
      ].map(([px, py]) => applyMatrix(m, px, py));
      ctx.strokeStyle = '#e8473c';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(x + p.x * k, y + p.y * k) : ctx.lineTo(x + p.x * k, y + p.y * k)));
      ctx.closePath();
      ctx.stroke();
    };
    const schedule = () => {
      if (!timer) timer = setTimeout(draw, 120);
    };
    draw();
    const offs = [engine.onRender(schedule), useStore.subscribe(schedule)];
    return () => {
      offs.forEach((o) => o());
      if (timer) clearTimeout(timer);
    };
  }, []);

  /** Click or drag in the overview to centre the view there. */
  const onDown = (e: React.PointerEvent) => {
    const go = (ev: { clientX: number; clientY: number }) => {
      const s = getState();
      const r = ref.current!.getBoundingClientRect();
      const k = Math.min((W - 8) / s.doc.width, (H - 8) / s.doc.height);
      const dx = (ev.clientX - r.left - W / 2) / k;
      const dy = (ev.clientY - r.top - H / 2) / k;
      // Offset of that document point from the document centre, in view space.
      const m = viewMatrix({ ...s.view, panX: 0, panY: 0 }, s.viewport, { w: s.doc.width, h: s.doc.height });
      const p = applyMatrix(m, s.doc.width / 2 + dx, s.doc.height / 2 + dy);
      actions.setView({ panX: -(p.x - s.viewport.w / 2), panY: -(p.y - s.viewport.h / 2) });
    };
    go(e);
    const move = (ev: PointerEvent) => go(ev);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="navigator">
      <canvas ref={ref} style={{ width: W, height: H }} onPointerDown={onDown} data-testid="navigator" />
      <ZoomControls />
      <RotationControls />
    </div>
  );
}
