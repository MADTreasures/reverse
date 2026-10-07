import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { formatDb, volumeToGain } from '../../model/timing';
import { endCoalesce, gestureKey } from '../../store/actions';
import { setHint } from '../hint';

interface FaderProps {
  value: number;
  onChange: (value: number, gesture: string) => void;
  label?: string;
  height?: number;
  defaultValue?: number;
}

/** Vertical volume fader (0..1 position, 0.8 = 0 dB). */
export function Fader({ value, onChange, label = 'Volume', height = 120, defaultValue = 0.8 }: FaderProps) {
  const drag = useRef<{ startY: number; startV: number; key: string } | null>(null);
  const travel = height - 18;
  const describe = (v: number) => `${label}: ${formatDb(volumeToGain(v))}`;

  const set = (v: number, key: string) => {
    const c = Math.min(1, Math.max(0, v));
    onChange(c, key);
    setHint(describe(c));
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    const key = gestureKey('fader');
    const capY = rect.top + 9 + (1 - value) * travel;
    // Clicking beside the cap jumps there; grabbing the cap keeps relative motion.
    let startV = value;
    if (Math.abs(e.clientY - capY) > 10) {
      startV = 1 - (e.clientY - rect.top - 9) / travel;
      set(startV, key);
    }
    drag.current = { startY: e.clientY, startV, key };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const scale = e.shiftKey ? 0.2 : 1;
    set(d.startV + ((d.startY - e.clientY) / travel) * scale, d.key);
  };
  const onPointerUp = () => {
    drag.current = null;
    endCoalesce();
  };

  return (
    <div
      className="fader"
      style={{ height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => {
        set(defaultValue, gestureKey('reset'));
        endCoalesce();
      }}
      onWheel={(e) => set(value + (e.deltaY < 0 ? 0.01 : -0.01) * (e.shiftKey ? 0.25 : 1), `wheel:${label}`)}
      onMouseEnter={() => setHint(describe(value))}
      role="slider"
      aria-label={label}
      aria-valuenow={value}
    >
      <div className="fader-slot" />
      <div className="fader-unity" style={{ top: 9 + 0.2 * travel }} />
      <div className="fader-cap" style={{ top: (1 - value) * travel }} />
    </div>
  );
}
