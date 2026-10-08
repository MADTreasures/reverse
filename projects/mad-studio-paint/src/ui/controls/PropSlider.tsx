import { useRef } from 'react';
import { Icon } from './Icons';

interface PropSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  log?: boolean;
  decimals?: number;
  unit?: string;
  onChange: (v: number) => void;
  /** Pen pressure ("dynamics") toggle at the far right; omitted = no button. */
  pressure?: boolean;
  onPressure?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  testId?: string;
}

/**
 * Tool settings row: label with a thin bar under it, the value with spin arrows, and a
 * pressure button at the far right.
 */
export function PropSlider({ label, value, min, max, step = 1, log, decimals = 0, unit, onChange, pressure, onPressure, testId }: PropSliderProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const toT = (v: number) => (log ? Math.log(Math.max(min, v) / min) / Math.log(max / min) : (v - min) / (max - min));
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const fromT = (t: number) => {
    const c = Math.min(1, Math.max(0, t));
    const raw = log ? min * Math.pow(max / min, c) : min + (max - min) * c;
    return clamp(Number((Math.round(raw / step) * step).toFixed(4)));
  };
  const drag = (e: React.PointerEvent) => {
    e.preventDefault();
    const set = (ev: { clientX: number }) => {
      const r = barRef.current!.getBoundingClientRect();
      onChange(fromT((ev.clientX - r.left) / r.width));
    };
    set(e);
    const move = (ev: PointerEvent) => set(ev);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const spin = (dir: 1 | -1) => {
    if (log) {
      const v = value * (dir > 0 ? 1.1 : 1 / 1.1);
      onChange(clamp(Number((Math.round(v / step) * step).toFixed(4))));
    } else onChange(clamp(Number((value + dir * step).toFixed(4))));
  };
  return (
    <div className="prop-slider" data-testid={testId}>
      <div className="ps-left" onPointerDown={drag}>
        <span className="ps-label">{label}</span>
        <div className="ps-bar" ref={barRef}>
          <div className="ps-fill" style={{ width: `${toT(value) * 100}%` }} />
        </div>
      </div>
      <div className="ps-value">
        <input
          type="number"
          aria-label={label}
          value={Number(value.toFixed(decimals))}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(clamp(v));
          }}
          onKeyDown={(e) => e.stopPropagation()}
        />
        {unit && <span className="ps-unit">{unit}</span>}
        <span className="ps-spin">
          <button tabIndex={-1} aria-label={`${label} up`} onClick={() => spin(1)}>
            ▴
          </button>
          <button tabIndex={-1} aria-label={`${label} down`} onClick={() => spin(-1)}>
            ▾
          </button>
        </span>
      </div>
      {onPressure ? (
        <button className={`ps-dyn ${pressure ? 'on' : ''}`} title="Dynamics (pen pressure, tilt, random)" aria-label={`${label}: dynamics`} aria-pressed={pressure} onClick={onPressure}>
          <Icon name="pressure" size={13} />
        </button>
      ) : (
        <span className="ps-dyn-space" />
      )}
    </div>
  );
}
