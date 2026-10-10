import { useRef } from 'react';
import * as actions from '../../store/actions';
import { currentSubTool, drawingColor, useStore } from '../../store/store';

/** Vertical brush size and opacity sliders next to the canvas. */
export function ToolSliders() {
  const sub = useStore((s) => currentSubTool(s));
  const color = useStore((s) => (s.colors.transparent ? 'transparent' : drawingColor(s.colors)));
  const b = sub.brush;
  const size = actions.brushSizeOf(sub);
  return (
    <div className="tool-sliders" data-testid="tool-sliders">
      <VSlider
        label={size !== null ? `${size.toFixed(size < 10 ? 1 : 0)}\npx` : '–'}
        value={size !== null ? Math.log(size / 0.5) / Math.log(2000 / 0.5) : 0}
        disabled={size === null}
        onChange={(t) => actions.setBrushSize(0.5 * Math.pow(2000 / 0.5, t))}
        className="size"
        aria="Brush size"
      />
      <VSlider
        label={b ? `${Math.round(b.opacity * 100)}\n%` : '–'}
        value={b ? b.opacity : 0}
        disabled={!b || b.mode === 'blend'}
        onChange={(t) => b && actions.updateSubTool(sub.id, { brush: { ...b, opacity: Math.round(t * 100) / 100 } })}
        className="opacity"
        bubbleColor={color}
        aria="Opacity"
      />
    </div>
  );
}

function VSlider(props: { label: string; value: number; disabled: boolean; onChange: (t: number) => void; className: string; bubbleColor?: string; aria: string }) {
  const track = useRef<HTMLDivElement>(null);
  const down = (e: React.PointerEvent) => {
    if (props.disabled) return;
    e.preventDefault();
    const set = (ev: { clientY: number }) => {
      const r = track.current!.getBoundingClientRect();
      props.onChange(Math.min(1, Math.max(0, 1 - (ev.clientY - r.top) / r.height)));
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
  const light = props.bubbleColor && props.bubbleColor !== 'transparent' && isLight(props.bubbleColor);
  return (
    <div className={`vslider ${props.className} ${props.disabled ? 'disabled' : ''}`} role="slider" aria-label={props.aria} aria-valuenow={Math.round(props.value * 100)}>
      <div className="vs-bubble" style={props.bubbleColor ? { background: props.bubbleColor === 'transparent' ? undefined : props.bubbleColor, color: light ? '#111' : '#fff' } : undefined}>
        {props.label.split('\n').map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
      <div className="vs-track" ref={track} onPointerDown={down}>
        <div className="vs-knob" style={{ bottom: `calc(${props.value * 100}% - 8px)` }} />
      </div>
    </div>
  );
}

function isLight(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}
