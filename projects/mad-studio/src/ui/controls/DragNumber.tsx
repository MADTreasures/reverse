import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { endCoalesce, gestureKey } from '../../store/actions';
import { setHint } from '../hint';

interface DragNumberProps {
  value: number;
  min: number;
  max: number;
  /** Change per pixel of vertical drag. */
  step: number;
  onChange: (value: number, gesture: string) => void;
  format: (value: number) => string;
  hint: string;
  className?: string;
  decimals?: number;
}

/** Numeric display that changes by vertical drag; double-click to type a value. */
export function DragNumber({ value, min, max, step, onChange, format, hint, className = '', decimals = 0 }: DragNumberProps) {
  const drag = useRef<{ y: number; v: number; key: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || editing) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, v: value, key: gestureKey('number') };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const factor = e.shiftKey ? 0.1 : 1;
    const raw = d.v + (d.y - e.clientY) * step * factor;
    const p = Math.pow(10, e.shiftKey ? Math.max(decimals, 1) : 0);
    const v = clamp(Math.round(raw * p) / p);
    if (v !== value) onChange(v, d.key);
    setHint(`${hint}: ${format(v)}`);
  };
  const onPointerUp = () => {
    drag.current = null;
    endCoalesce();
  };

  if (editing) {
    return (
      <input
        className={`drag-number-input ${className}`}
        autoFocus
        defaultValue={String(value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            const v = Number((e.target as HTMLInputElement).value.replace(',', '.'));
            if (Number.isFinite(v)) onChange(clamp(v), gestureKey('typed'));
            setEditing(false);
          } else if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }
  return (
    <div
      className={`drag-number ${className}`}
      data-hint={`${hint} – drag up/down, double-click to type`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => setEditing(true)}
      onWheel={(e) => onChange(clamp(value + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 0.1 : 1)), `wheel:${hint}`)}
    >
      {format(value)}
    </div>
  );
}
