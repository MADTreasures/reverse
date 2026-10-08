import { useRef } from 'react';

interface SliderProps {
  label?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Map the bar position logarithmically (brush sizes, zoom). */
  log?: boolean;
  unit?: string;
  decimals?: number;
  onChange: (v: number) => void;
  /** Called once at the end of a drag (for undo coalescing). */
  onCommit?: () => void;
  testId?: string;
  /** Accessible name when there is no visible label. */
  ariaLabel?: string;
}

/** The "number + bar" slider used throughout the palettes: drag or click the bar, or type a value. */
export function Slider({ label, value, min, max, step = 1, log, unit = '', decimals = 0, onChange, onCommit, testId, ariaLabel }: SliderProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const toT = (v: number) => (log ? Math.log(Math.max(min, v) / min) / Math.log(max / min) : (v - min) / (max - min));
  const fromT = (t: number) => {
    const c = Math.min(1, Math.max(0, t));
    const raw = log ? min * Math.pow(max / min, c) : min + (max - min) * c;
    const stepped = Math.round(raw / step) * step;
    return Math.min(max, Math.max(min, Number(stepped.toFixed(4))));
  };
  const setFromEvent = (e: React.PointerEvent | PointerEvent) => {
    const r = barRef.current!.getBoundingClientRect();
    onChange(fromT((e.clientX - r.left) / r.width));
  };
  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    barRef.current!.setPointerCapture(e.pointerId);
    setFromEvent(e);
    const move = (ev: PointerEvent) => setFromEvent(ev);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onCommit?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div className="slider" data-testid={testId}>
      {label && <span className="slider-label">{label}</span>}
      <input
        className="slider-number"
        aria-label={ariaLabel ?? label}
        type="number"
        value={Number(value.toFixed(decimals))}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
        }}
        onBlur={() => onCommit?.()}
        onKeyDown={(e) => e.stopPropagation()}
      />
      {unit && <span className="slider-unit">{unit}</span>}
      <div className="slider-bar" ref={barRef} onPointerDown={onDown}>
        <div className="slider-fill" style={{ width: `${toT(value) * 100}%` }} />
      </div>
    </div>
  );
}
