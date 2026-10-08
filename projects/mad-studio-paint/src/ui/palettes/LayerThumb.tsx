import { useEffect, useRef } from 'react';
import type { Id } from '../../model/types';
import { getSurface, onSurfaceChange, revisionOf } from '../../engine/surfaces';
import { useStore } from '../../store/store';

const W = 40;
const H = 30;

/** Small preview of a raster layer (or a mask: white shows, black hides), refreshed (throttled) when its pixels change. */
export function LayerThumb({ id, mask = false }: { id: Id; mask?: boolean }) {
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
      if (mask) {
        ctx.fillStyle = '#000';
        ctx.fillRect((c.width - w) / 2, (c.height - h) / 2, w, h);
        const white = document.createElement('canvas');
        white.width = c.width;
        white.height = c.height;
        const wctx = white.getContext('2d')!;
        wctx.drawImage(s, (c.width - w) / 2, (c.height - h) / 2, w, h);
        wctx.globalCompositeOperation = 'source-in';
        wctx.fillStyle = '#fff';
        wctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(white, 0, 0);
      } else ctx.drawImage(s, (c.width - w) / 2, (c.height - h) / 2, w, h);
    };
    draw();
    const off = onSurfaceChange(() => {
      if (revisionOf(id) !== rev && !timer) timer = setTimeout(draw, 150);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [id, width, height, mask]);

  return <canvas ref={ref} className="layer-thumb" style={{ width: W, height: H }} />;
}
