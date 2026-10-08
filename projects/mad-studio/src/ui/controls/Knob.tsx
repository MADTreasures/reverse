import { useRef, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { useAutomationOverlay } from '../../audio/automationRuntime';
import { endCoalesce, gestureKey } from '../../store/actions';
import { engine } from '../../audio/engine';
import { noteTweaked, recordAutomationValue } from '../../store/automationActions';
import { setHint } from '../hint';
import { controlMenu } from '../menus/controlMenu';
import { showMenu } from '../overlays';

export interface KnobProps {
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  onChange: (value: number, gesture: string) => void;
  label?: string;
  size?: number;
  curve?: 'linear' | 'log';
  bipolar?: boolean;
  /** Snap to whole numbers (or option indices). */
  integer?: boolean;
  format?: (value: number) => string;
  color?: string;
  className?: string;
  showLabel?: boolean;
  /** Automation target key (enables "Create automation clip" in the right-click menu). */
  target?: string;
}

export function toNormalized(v: number, min: number, max: number, curve: 'linear' | 'log' = 'linear'): number {
  if (curve === 'log' && min > 0) return Math.log(v / min) / Math.log(max / min);
  return (v - min) / (max - min);
}

export function fromNormalized(n: number, min: number, max: number, curve: 'linear' | 'log' = 'linear'): number {
  const c = Math.min(1, Math.max(0, n));
  if (curve === 'log' && min > 0) return min * Math.pow(max / min, c);
  return min + c * (max - min);
}

const START = -135;
const SWEEP = 270;

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const a = Math.min(from, to);
  const b = Math.max(from, to);
  const [x1, y1] = polar(cx, cy, r, a);
  const [x2, y2] = polar(cx, cy, r, b);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${b - a > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

/** Value an automation clip currently drives for `target`, if any. */
export function useAutomatedValue(target: string | undefined): number | undefined {
  return useAutomationOverlay((s) => (target ? s.values[target] : undefined));
}

/**
 * Rotary control like FL Studio's: drag vertically (Shift = fine), wheel, double-click to reset,
 * right-click for the control menu (reset, automation, copy/paste/type value).
 */
export function Knob({
  value,
  min,
  max,
  defaultValue,
  onChange,
  label,
  size = 26,
  curve = 'linear',
  bipolar = false,
  integer = false,
  format = (v) => v.toFixed(2),
  color = 'var(--accent)',
  className = '',
  showLabel = false,
  target,
}: KnobProps) {
  const drag = useRef<{ startY: number; startN: number; key: string } | null>(null);
  const automated = useAutomatedValue(target);
  const shown = automated ?? value;
  const n = Math.min(1, Math.max(0, toNormalized(shown, min, max, curve)));
  const describe = (v: number) => `${label ? `${label}: ` : ''}${format(v)}`;

  const emit = (norm: number, key: string) => {
    let v = fromNormalized(norm, min, max, curve);
    if (integer) v = Math.round(v);
    if (v !== value) onChange(v, key);
    if (target) {
      noteTweaked(target);
      recordAutomationValue(target, v, engine.playheadTick());
    }
    setHint(describe(v));
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, startN: n, key: gestureKey('knob') };
    setHint(describe(value));
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const range = e.shiftKey ? 800 : 160;
    emit(d.startN + (d.startY - e.clientY) / range, d.key);
  };
  const onPointerUp = () => {
    drag.current = null;
    endCoalesce();
  };
  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    const step = (integer ? 1 / Math.max(1, max - min) : e.shiftKey ? 0.002 : 0.02) * (e.deltaY < 0 ? 1 : -1);
    emit(n + step, `wheel:${label ?? ''}`);
  };

  const r = size / 2 - 3;
  const c = size / 2;
  const angle = START + n * SWEEP;
  const from = bipolar ? 0 : START;
  const [px, py] = polar(c, c, r - 3, angle);

  return (
    <div
      className={`knob ${automated !== undefined ? 'automated' : ''} ${className}`}
      style={{ width: size, height: showLabel ? size + 12 : size }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => {
        onChange(defaultValue, gestureKey('reset'));
        endCoalesce();
        setHint(describe(defaultValue));
      }}
      onWheel={onWheel}
      onMouseEnter={() => setHint(describe(shown))}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        showMenu(e, controlMenu({ label: label ?? 'Value', value, min, max, curve, integer, defaultValue, onChange, target, format }));
      }}
      role="slider"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={shown}
    >
      <svg width={size} height={size}>
        <circle cx={c} cy={c} r={r} className="knob-body" />
        <path d={arc(c, c, r, START, START + SWEEP)} className="knob-track" />
        {Math.abs(angle - from) > 0.5 && <path d={arc(c, c, r, from, angle)} className="knob-value" style={{ stroke: color }} />}
        <line x1={c} y1={c} x2={px} y2={py} className="knob-pointer" />
      </svg>
      {showLabel && label && <div className="knob-label">{label}</div>}
    </div>
  );
}
