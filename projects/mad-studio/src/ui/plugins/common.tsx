import { useEffect, useRef } from 'react';
import { engine } from '../../audio/engine';
import type { Envelope } from '../../model/types';
import { prepareCanvas } from '../animation';
import { Knob, type KnobProps } from '../controls/Knob';

/** Knob with a caption and live value underneath. */
export function KnobCell(props: KnobProps & { caption: string }) {
  const { caption, ...knob } = props;
  const format = knob.format ?? ((v: number) => v.toFixed(2));
  return (
    <div className="knob-cell">
      <Knob size={30} {...knob} label={knob.label ?? caption} />
      <span className="cell-label">{caption}</span>
      <span className="cell-value">{format(knob.value)}</span>
    </div>
  );
}

export const fmtSeconds = (v: number) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`);
export const fmtPercent = (v: number) => `${Math.round(v * 100)}%`;
export const fmtSigned = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
export const fmtHz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz` : `${Math.round(v)} Hz`);

/** Small ADSR preview. */
export function EnvelopeGraph({ env, width = 150, height = 52, color = '#ff9b3d' }: { env: Envelope; width?: number; height?: number; color?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = prepareCanvas(canvas, width, height);
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    const hold = 0.35;
    const total = env.attack + env.decay + hold + env.release || 1;
    const sx = (width - 8) / total;
    const top = 5;
    const bottom = height - 5;
    const h = bottom - top;
    const x0 = 4;
    const xa = x0 + env.attack * sx;
    const xd = xa + env.decay * sx;
    const xs = xd + hold * sx;
    const xr = xs + env.release * sx;
    const ys = bottom - env.sustain * h;
    ctx.beginPath();
    ctx.moveTo(x0, bottom);
    ctx.lineTo(xa, top);
    ctx.quadraticCurveTo(xa + (xd - xa) * 0.15, ys, xd, ys);
    ctx.lineTo(xs, ys);
    ctx.quadraticCurveTo(xs + (xr - xs) * 0.15, bottom, xr, bottom);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.lineTo(x0, bottom);
    ctx.fillStyle = `${color}22`;
    ctx.fill();
  }, [env, width, height, color]);
  return <canvas ref={ref} className="env-graph" style={{ width, height }} />;
}

/** Plays a note while the button is held. */
export function PreviewButton({ channelId, note }: { channelId: string; note: number }) {
  const handle = useRef<number | null>(null);
  const stop = () => {
    if (handle.current !== null) engine.noteOff(handle.current);
    handle.current = null;
  };
  return (
    <button
      className="btn"
      data-hint="Hold to preview"
      onPointerDown={() => {
        stop();
        handle.current = engine.noteOn(channelId, note);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
    >
      ▶ Preview
    </button>
  );
}
