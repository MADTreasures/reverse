/**
 * Gradient nodes on a colour bar: drag a node sideways to move it, down out of the bar to delete
 * it, click below the bar to add one. The selected node's colour (main, sub or a specified colour),
 * opacity and position are editable.
 */
import { useState, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { resolveStops, sampleGradient, type GradientStop } from '../../paint/gradient';

export function GradientBar({ stops, onChange, main = '#000000', sub = '#ffffff' }: { stops: GradientStop[]; onChange: (s: GradientStop[]) => void; main?: string; sub?: string }) {
  const [selected, setSelected] = useState(0);
  const bar = useRef<HTMLDivElement>(null);
  const sel = stops[Math.min(selected, stops.length - 1)];
  const resolved = resolveStops(stops, main, sub);
  const css = `linear-gradient(to right, ${resolved
    .map((s) => {
      const [r, g, b, a] = sampleGradient([s], 0);
      return `rgba(${r},${g},${b},${a}) ${(s.pos * 100).toFixed(1)}%`;
    })
    .join(', ')})`;
  const shown = (s: GradientStop) => (s.color === 'main' ? main : s.color === 'sub' ? sub : s.color);

  const posAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };

  const drag = (index: number, list: GradientStop[]) => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSelected(index);
    const startY = e.clientY;
    const move = (ev: PointerEvent) => {
      const next = list.map((s) => ({ ...s }));
      if (ev.clientY - startY > 40 && next.length > 2) {
        next.splice(index, 1);
        setSelected(0);
      } else next[index].pos = Number(posAt(ev.clientX).toFixed(3));
      onChange(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const add = (e: ReactPointerEvent) => {
    const pos = Number(posAt(e.clientX).toFixed(3));
    const [r, g, b, a] = sampleGradient(resolved, pos);
    const hex = `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
    const next = [...stops, { pos, color: hex, opacity: Number(a.toFixed(2)) }];
    onChange(next);
    setSelected(next.length - 1);
  };

  const patch = (p: Partial<GradientStop>) => onChange(stops.map((s) => (s === sel ? { ...s, ...p } : s)));

  return (
    <div className="gradient-editor">
      <div className="gradient-bar" ref={bar} data-testid="gradient-bar" style={{ backgroundImage: `${css}, conic-gradient(#ccc 0 25%, #fff 0 50%, #ccc 0 75%, #fff 0)` }} />
      <div className="gradient-nodes" onPointerDown={add} title="Click to add a node">
        {stops.map((s, i) => (
          <span
            key={i}
            className={`gradient-node ${s === sel ? 'on' : ''}`}
            style={{ left: `${s.pos * 100}%`, background: shown(s) }}
            onPointerDown={drag(i, stops)}
            data-testid="gradient-node"
            title={s.color === 'main' ? 'Main color' : s.color === 'sub' ? 'Sub color' : s.color}
          />
        ))}
      </div>
      {sel && (
        <div className="gradient-node-props">
          <select aria-label="Node color" value={sel.color === 'main' || sel.color === 'sub' ? sel.color : 'specified'} onChange={(e) => patch({ color: e.target.value === 'specified' ? shown(sel) : e.target.value })}>
            <option value="main">Main color</option>
            <option value="sub">Sub color</option>
            <option value="specified">Specified color</option>
          </select>
          {sel.color !== 'main' && sel.color !== 'sub' && <input type="color" aria-label="Specified color" value={sel.color} onChange={(e) => patch({ color: e.target.value })} />}
          <label>
            Opacity{' '}
            <input
              type="number"
              min={0}
              max={100}
              value={Math.round(sel.opacity * 100)}
              onChange={(e) => patch({ opacity: Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100 })}
            />
            %
          </label>
          <label>
            Position{' '}
            <input type="number" min={0} max={100} value={Math.round(sel.pos * 100)} onChange={(e) => patch({ pos: Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100 })} />%
          </label>
          <button type="button" className="btn small" title="Flip the gradient" onClick={() => onChange(stops.map((s) => ({ ...s, pos: 1 - s.pos })))}>
            Flip
          </button>
        </div>
      )}
    </div>
  );
}
