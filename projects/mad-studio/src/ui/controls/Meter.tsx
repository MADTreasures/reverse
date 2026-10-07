import { useRef } from 'react';
import { engine } from '../../audio/engine';
import { prepareCanvas, useFrame } from '../animation';

const MIN_DB = -54;
const MAX_DB = 6;

function dbFraction(level: number): number {
  if (level <= 0) return 0;
  const db = 20 * Math.log10(level);
  return Math.min(1, Math.max(0, (db - MIN_DB) / (MAX_DB - MIN_DB)));
}

interface MeterProps {
  trackIndex: number;
  width?: number;
  height: number;
  horizontal?: boolean;
}

/** Stereo peak meter fed from a mixer track's analysers. */
export function Meter({ trackIndex, width = 10, height, horizontal = false }: MeterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const state = useRef({ levels: [0, 0], holds: [0, 0], holdTimes: [0, 0], clip: 0 });

  useFrame((time) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const [l, r] = engine.peaks(trackIndex);
    const st = state.current;
    [l, r].forEach((v, c) => {
      st.levels[c] = Math.max(v, st.levels[c] * 0.88);
      if (v >= st.holds[c] || time - st.holdTimes[c] > 900) {
        st.holds[c] = v;
        st.holdTimes[c] = time;
      }
      if (v > 1) st.clip = time;
    });
    const ctx = prepareCanvas(canvas, width, height);
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0b0e10';
    ctx.fillRect(0, 0, width, height);
    const len = horizontal ? width : height;
    const thick = horizontal ? height : width;
    const gap = 1;
    const bar = (thick - gap) / 2;
    const grad = horizontal ? ctx.createLinearGradient(0, 0, width, 0) : ctx.createLinearGradient(0, height, 0, 0);
    grad.addColorStop(0, '#3fbf5f');
    grad.addColorStop(0.72, '#9fe05a');
    grad.addColorStop(0.88, '#ffd34d');
    grad.addColorStop(1, '#ff4f4f');
    for (let c = 0; c < 2; c++) {
      const f = dbFraction(st.levels[c]);
      const hold = dbFraction(st.holds[c]);
      const off = c * (bar + gap);
      ctx.fillStyle = grad;
      if (horizontal) {
        ctx.fillRect(0, off, f * len, bar);
        ctx.fillStyle = '#e8eef3';
        if (hold > 0.01) ctx.fillRect(hold * len - 1, off, 1, bar);
      } else {
        ctx.fillRect(off, height - f * len, bar, f * len);
        ctx.fillStyle = '#e8eef3';
        if (hold > 0.01) ctx.fillRect(off, height - hold * len, bar, 1);
      }
    }
    if (time - st.clip < 1500) {
      ctx.fillStyle = '#ff4f4f';
      if (horizontal) ctx.fillRect(width - 2, 0, 2, height);
      else ctx.fillRect(0, 0, width, 2);
    }
  });

  return <canvas ref={canvasRef} className="meter" style={{ width, height }} />;
}
