import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { endCoalesce, gestureKey } from '../../store/actions';
import { noteTweaked } from '../../store/automationActions';
import { setHint } from '../hint';
import { controlMenu } from '../menus/controlMenu';
import { showMenu } from '../overlays';
import { useAutomatedValue } from './Knob';

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
  /** Automation target key: right-click offers "Create automation clip". */
  target?: string;
  defaultValue?: number;
}

/** Numeric display that changes by vertical drag; double-click to type a value. */
export function DragNumber({ value, min, max, step, onChange, format, hint, className = '', decimals = 0, target, defaultValue }: DragNumberProps) {
  const drag = useRef<{ y: number; v: number; key: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const automated = useAutomatedValue(target);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const change = (v: number, key: string) => {
    onChange(v, key);
    if (target) noteTweaked(target);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || editing) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, v: value, key: gestureKey('number') };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    // Ctrl/Cmd (FL Studio) or Shift: fine steps with decimals.
    const fine = e.ctrlKey || e.metaKey || e.shiftKey;
    const raw = d.v + (d.y - e.clientY) * step * (fine ? 0.1 : 1);
    const p = Math.pow(10, fine ? Math.max(decimals, 1) : 0);
    const v = clamp(Math.round(raw * p) / p);
    if (v !== value) change(v, d.key);
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
      onWheel={(e) => change(clamp(value + (e.deltaY < 0 ? 1 : -1) * (e.ctrlKey || e.metaKey || e.shiftKey ? 0.1 : 1)), `wheel:${hint}`)}
      onContextMenu={(e) => {
        if (!target) return;
        e.preventDefault();
        e.stopPropagation();
        showMenu(e, controlMenu({ label: hint, value, min, max, defaultValue: defaultValue ?? value, onChange, target, format }));
      }}
    >
      {format(automated ?? value)}
    </div>
  );
}
