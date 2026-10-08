import { useMemo, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { monotoneCurve, type CurvePoint } from '../../paint/curve';

/**
 * Curve graph (tone curve, pen pressure): click to add a point, drag to move it, drag it out of the
 * graph to delete it (two points always stay). Points range over 0..max on both axes.
 */
export function CurveEditor({
  points,
  onChange,
  max = 1,
  size = 160,
  background,
  testId,
  label,
}: {
  points: CurvePoint[];
  onChange: (p: CurvePoint[]) => void;
  max?: number;
  size?: number;
  background?: ReactNode;
  testId?: string;
  label: string;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const f = useMemo(() => monotoneCurve(points), [points]);
  const path = useMemo(() => {
    const steps = 64;
    let d = '';
    for (let i = 0; i <= steps; i++) {
      const x = (i / steps) * max;
      const y = Math.min(max, Math.max(0, f(x)));
      d += `${i === 0 ? 'M' : 'L'}${((x / max) * 100).toFixed(2)} ${(100 - (y / max) * 100).toFixed(2)}`;
    }
    return d;
  }, [f, max]);
  const round = (v: number) => (max > 1 ? Math.round(v) : Math.round(v * 1000) / 1000);

  const toValue = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * max, y: (1 - (e.clientY - r.top) / r.height) * max };
  };

  const drag = (index: number, start: CurvePoint[]) => {
    const move = (ev: PointerEvent) => {
      const { x, y } = toValue(ev);
      const margin = max * 0.1;
      const outside = x < -margin || x > max + margin || y < -margin || y > max + margin;
      const next = start.map((p) => [...p] as CurvePoint);
      if (outside && next.length > 2) next.splice(index, 1);
      else next[index] = [round(Math.min(max, Math.max(0, x))), round(Math.min(max, Math.max(0, y)))];
      onChange(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const down = (e: ReactPointerEvent<SVGSVGElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const { x, y } = toValue(e);
    const near = max * 0.05;
    const hit = points.findIndex(([px, py]) => Math.hypot(px - x, py - y) < near);
    if (hit >= 0) {
      drag(hit, points);
      return;
    }
    const nx = round(Math.min(max, Math.max(0, x)));
    const next = [...points, [nx, round(Math.min(max, Math.max(0, f(nx))))] as CurvePoint].sort((a, b) => a[0] - b[0]);
    onChange(next);
    drag(
      next.findIndex((p) => p[0] === nx),
      next,
    );
  };

  return (
    <div className="curve-box" style={{ width: size, height: size }}>
      {background}
      <svg ref={svg} className="curve" viewBox="-3 -3 106 106" data-testid={testId} role="img" aria-label={label} onPointerDown={down}>
        <path d="M0 100L100 0" className="diagonal" />
        <path d={path} className="line" />
        {points.map(([x, y], i) => (
          <circle key={i} cx={(x / max) * 100} cy={100 - (y / max) * 100} r={2.6} />
        ))}
      </svg>
    </div>
  );
}
