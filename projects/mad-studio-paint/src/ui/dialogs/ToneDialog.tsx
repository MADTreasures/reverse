/** Layer > New tone layer: the Simple tone settings (frequency, density, type, angle). */
import { useState } from 'react';
import { defaultTone, DOT_SHAPES, type DotShape } from '../../paint/tone';
import * as actions from '../../store/actions';
import { getState } from '../../store/store';
import { closeDialog } from '../overlays';

export function NewToneDialog() {
  const [frequency, setFrequency] = useState(() => defaultTone(getState().doc.dpi).frequency);
  const [value, setValue] = useState(10);
  const [shape, setShape] = useState<DotShape>('circle');
  const [angle, setAngle] = useState(45);
  const num = (v: string, min: number, max: number, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  };
  return (
    <form
      className="modal"
      role="dialog"
      aria-label="Simple tone settings"
      onSubmit={(e) => {
        e.preventDefault();
        actions.addToneLayer({ frequency, value, shape, angle });
        closeDialog();
      }}
    >
      <h2>Simple tone settings</h2>
      <div className="form-grid">
        <label htmlFor="tone-freq">Frequency (lpi)</label>
        <input id="tone-freq" type="number" min={1} max={300} step={0.5} value={frequency} onChange={(e) => setFrequency(num(e.target.value, 1, 300, frequency))} />
        <label htmlFor="tone-density">Density (%)</label>
        <input id="tone-density" type="number" min={0} max={100} value={value} onChange={(e) => setValue(num(e.target.value, 0, 100, value))} />
        <label htmlFor="tone-type">Type</label>
        <select id="tone-type" value={shape} onChange={(e) => setShape(e.target.value as DotShape)}>
          {DOT_SHAPES.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <label htmlFor="tone-angle">Angle (°)</label>
        <input id="tone-angle" type="number" min={-180} max={180} value={angle} onChange={(e) => setAngle(num(e.target.value, -180, 180, angle))} />
      </div>
      <p className="muted">The tone fills the selection (the whole canvas without one); its layer mask can be edited later.</p>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={closeDialog}>
          Cancel
        </button>
        <button type="submit" className="btn primary">
          OK
        </button>
      </div>
    </form>
  );
}
