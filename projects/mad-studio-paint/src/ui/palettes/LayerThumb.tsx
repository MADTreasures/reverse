import { useEffect, useRef } from 'react';
import type { Id } from '../../model/types';
import { getSurface, onSurfaceChange, revisionOf } from '../../engine/surfaces';
import { useStore } from '../../store/store';

const W = 40;
const H = 30;

/** Small preview of a raster layer, refreshed (throttled) when its pixels change. */
export function LayerThumb({ id }: { id: Id }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const width = useStore((s) => s.doc.width);
  const height = useStore((s) => s.doc.height);

  useEffect(() => {
    let rev = -1;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const draw = () => {
      timer = null;
      const c = ref.current;
      const s = getSurface(id);
      if (!c || !s) return;
      rev = revisionOf(id);
      const dpr = window.devicePixelRatio || 1;
      c.width = W * dpr;
      c.height = H * dpr;
      const ctx = c.getContext('2d')!;
      const k = Math.min((W * dpr) / width, (H * dpr) / height);
      const w = width * k;
      const h = height * k;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.imageSmoothingQuality = 'medium';
      ctx.drawImage(s, (c.width - w) / 2, (c.height - h) / 2, w, h);
    };
    draw();
    const off = onSurfaceChange(() => {
      if (revisionOf(id) !== rev && !timer) timer = setTimeout(draw, 150);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [id, width, height]);

  return <canvas ref={ref} className="layer-thumb" style={{ width: W, height: H }} />;
}
