/**
 * View > Ruler bar: rulers along the top and the left of the canvas window, counting pixels from
 * the start point of the grid/ruler bar settings, with a mark following the pointer. While the
 * view is turned (other than by a quarter turn) the bars stay empty.
 */
import { useEffect, useRef } from 'react';
import { gridOrigin, rulerTicks } from '../../paint/grid';
import { apply as applyMatrix, invert, viewMatrix } from '../../paint/viewMath';
import { gridOf } from '../../store/actions';
import { getState, useStore } from '../../store/store';
import { controller } from '../../tools/controller';

export const RULER_PX = 18;

/** Colours of the current theme (light or dark). */
function theme() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return { bg: v('--bg-1', '#3f3f3f'), line: v('--line-soft', '#555'), text: v('--text-dim', '#aaa'), mark: v('--accent-strong', '#5b7fc7') };
}

export function RulerBar() {
  const show = useStore((s) => s.showRulerBar);
  const top = useRef<HTMLCanvasElement>(null);
  const left = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!show) return;
    let frame = 0;
    const draw = () => {
      frame = 0;
      const t = top.current;
      const l = left.current;
      if (!t || !l) return;
      const s = getState();
      const { w, h } = s.viewport;
      const dpr = window.devicePixelRatio || 1;
      const size = (c: HTMLCanvasElement, cw: number, ch: number) => {
        if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) {
          c.width = Math.round(cw * dpr);
          c.height = Math.round(ch * dpr);
        }
        const ctx = c.getContext('2d')!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return ctx;
      };
      const tc = size(t, w, RULER_PX);
      const lc = size(l, RULER_PX, h);
      const m = viewMatrix(s.view, { w, h }, { w: s.doc.width, h: s.doc.height });
      const inv = invert(m);
      const c = theme();
      const o = gridOrigin(gridOf(s.doc), s.doc.width, s.doc.height);
      // Doc x along the top bar, doc y along the left one: only while the view is upright (or flipped).
      const upright = Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9;
      const hover = controller.hover;
      const bar = (ctx: CanvasRenderingContext2D, horizontal: boolean) => {
        const len = horizontal ? w : h;
        ctx.fillStyle = c.bg;
        ctx.fillRect(0, 0, horizontal ? len : RULER_PX, horizontal ? RULER_PX : len);
        ctx.strokeStyle = c.line;
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (horizontal) {
          ctx.moveTo(0, RULER_PX - 0.5);
          ctx.lineTo(len, RULER_PX - 0.5);
        } else {
          ctx.moveTo(RULER_PX - 0.5, 0);
          ctx.lineTo(RULER_PX - 0.5, len);
        }
        ctx.stroke();
        if (!upright) return;
        const scale = horizontal ? m[0] : m[3];
        const offset = horizontal ? m[4] : m[5];
        const a = (0 - offset) / scale;
        const b = (len - offset) / scale;
        const ticks = rulerTicks(horizontal ? o.x : o.y, Math.min(a, b), Math.max(a, b), Math.abs(scale));
        ctx.strokeStyle = c.text;
        ctx.fillStyle = c.text;
        ctx.font = '9px system-ui, sans-serif';
        ctx.beginPath();
        for (const tick of ticks) {
          const p = Math.round(tick.pos * scale + offset) + 0.5;
          const depth = tick.size === 'long' ? RULER_PX : tick.size === 'mid' ? 7 : 4;
          if (horizontal) {
            ctx.moveTo(p, RULER_PX);
            ctx.lineTo(p, RULER_PX - depth);
          } else {
            ctx.moveTo(RULER_PX, p);
            ctx.lineTo(RULER_PX - depth, p);
          }
          if (!tick.label) continue;
          if (horizontal) ctx.fillText(tick.label, p + 2, 9);
          else {
            ctx.save();
            ctx.translate(9, p + 2);
            ctx.rotate(Math.PI / 2);
            ctx.fillText(tick.label, 0, 0);
            ctx.restore();
          }
        }
        ctx.stroke();
        // Where the pointer is.
        if (hover) {
          const d = applyMatrix(inv, hover.sx, hover.sy);
          const p = horizontal ? d.x * scale + offset : d.y * scale + offset;
          ctx.strokeStyle = c.mark;
          ctx.beginPath();
          if (horizontal) {
            ctx.moveTo(Math.round(p) + 0.5, 0);
            ctx.lineTo(Math.round(p) + 0.5, RULER_PX);
          } else {
            ctx.moveTo(0, Math.round(p) + 0.5);
            ctx.lineTo(RULER_PX, Math.round(p) + 0.5);
          }
          ctx.stroke();
        }
      };
      bar(tc, true);
      bar(lc, false);
      // The corner where the bars meet.
      tc.fillStyle = c.bg;
      tc.fillRect(0, 0, RULER_PX, RULER_PX);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    schedule();
    const unsubs = [
      controller.onChange(schedule),
      useStore.subscribe((s, prev) => {
        if (s.view !== prev.view || s.viewport !== prev.viewport || s.doc !== prev.doc) schedule();
      }),
    ];
    return () => {
      cancelAnimationFrame(frame);
      unsubs.forEach((u) => u());
    };
  }, [show]);

  if (!show) return null;
  return (
    <>
      <canvas ref={top} className="ruler-bar top" data-testid="ruler-bar-top" aria-hidden />
      <canvas ref={left} className="ruler-bar left" data-testid="ruler-bar-left" aria-hidden />
    </>
  );
}
