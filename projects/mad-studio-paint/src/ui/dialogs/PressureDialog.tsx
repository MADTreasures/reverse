/**
 * File > Pen pressure settings: one pressure graph for all tools. Draw in the test area with the
 * pen; "Adjust from drawing" fits the graph to the pressure range used, "Stronger"/"Lighter" bend it.
 */
import { useEffect, useRef, useState } from 'react';
import { bendCurve, curveFromSamples, evalPressureCurve, LINEAR, type CurvePoint } from '../../paint/curve';
import * as actions from '../../store/actions';
import { getState } from '../../store/store';
import { CurveEditor } from '../controls/CurveEditor';
import { closeDialog } from '../overlays';

export function PressureDialog() {
  const [curve, setCurve] = useState<CurvePoint[]>(() => getState().prefs.pressureCurve);
  const samples = useRef<number[]>([]);
  const [count, setCount] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const curveRef = useRef(curve);
  curveRef.current = curve;

  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext('2d')!;
    let last: { x: number; y: number; w: number } | null = null;
    const pos = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
    };
    const raw = (e: PointerEvent) => (e.pointerType === 'pen' ? e.pressure : 0.5);
    const down = (e: PointerEvent) => {
      c.setPointerCapture(e.pointerId);
      const p = pos(e);
      last = { ...p, w: 1 + 16 * evalPressureCurve(curveRef.current, raw(e)) };
    };
    const move = (e: PointerEvent) => {
      if (!last) return;
      const p = pos(e);
      const pressure = raw(e);
      if (e.pointerType === 'pen') samples.current.push(pressure);
      const w = 1 + 16 * evalPressureCurve(curveRef.current, pressure);
      ctx.strokeStyle = '#222';
      ctx.lineCap = 'round';
      ctx.lineWidth = (w + last.w) / 2;
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = { ...p, w };
      setCount(samples.current.length);
    };
    const up = () => {
      last = null;
    };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    return () => {
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
    };
  }, []);

  const clearTest = () => {
    const c = canvas.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
  };
  const fitted = curveFromSamples(samples.current);

  return (
    <form
      className="modal pressure-dialog"
      role="dialog"
      aria-label="Pen pressure settings"
      onSubmit={(e) => {
        e.preventDefault();
        actions.setPreferences({ pressureCurve: curve });
        closeDialog();
      }}
    >
      <h2>Pen pressure settings</h2>
      <p className="muted">Draw in the test area with your pen, varying the pressure. The graph applies to all tools.</p>
      <div className="pressure-layout">
        <div className="pressure-graph">
          <CurveEditor label="Pen pressure graph" testId="pressure-curve" points={curve} onChange={setCurve} size={180} />
          <div className="pressure-buttons">
            <button type="button" className="btn small" onClick={() => setCurve((c) => bendCurve(c, 0.25))}>
              Stronger
            </button>
            <button type="button" className="btn small" onClick={() => setCurve((c) => bendCurve(c, -0.25))}>
              Lighter
            </button>
            <button type="button" className="btn small" onClick={() => setCurve(LINEAR)}>
              Reset
            </button>
          </div>
        </div>
        <div className="pressure-test">
          <canvas ref={canvas} width={300} height={180} className="pressure-canvas" data-testid="pressure-test" />
          <div className="pressure-buttons">
            <button type="button" className="btn small" disabled={!fitted} onClick={() => fitted && setCurve(fitted)} title="Fit the graph to the pressure you used">
              Adjust from drawing
            </button>
            <button type="button" className="btn small" onClick={clearTest}>
              Clear
            </button>
            <span className="muted">{count} pen samples</span>
          </div>
        </div>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={closeDialog}>
          Cancel
        </button>
        <button type="submit" className="btn primary">
          Done
        </button>
      </div>
    </form>
  );
}
