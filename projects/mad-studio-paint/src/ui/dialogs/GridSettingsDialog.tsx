/** View > Grid/Ruler bar settings: start point of the grid and ruler bar, grid gap and divisions. */
import { useState } from 'react';
import { GRID_ORIGINS, type GridOrigin } from '../../paint/grid';
import * as actions from '../../store/actions';
import { getState } from '../../store/store';
import { closeDialog } from '../overlays';

export function GridSettingsDialog() {
  const [g, setG] = useState(() => actions.gridOf(getState().doc));
  const set = (patch: Partial<typeof g>) => setG((v) => ({ ...v, ...patch }));
  const ok = (asDefault: boolean) => {
    actions.setGridSettings(g, asDefault);
    if (!asDefault) closeDialog();
  };
  return (
    <form
      className="modal grid-settings"
      role="dialog"
      aria-label="Grid/Ruler bar settings"
      onSubmit={(e) => {
        e.preventDefault();
        ok(false);
      }}
    >
      <h2>Grid/Ruler bar settings</h2>
      <div className="grid-settings-body">
        <div>
          <fieldset className="group">
            <legend>Start point of grid/ruler bar</legend>
            <div className="grid-origins" role="radiogroup" aria-label="Start point of grid/ruler bar">
              {GRID_ORIGINS.map(([id, label]) => (
                <label key={id} className={`check origin-${id}`}>
                  <input type="radio" name="grid-origin" checked={g.origin === id} onChange={() => set({ origin: id as GridOrigin })} /> {label}
                </label>
              ))}
            </div>
            <div className="form-grid">
              <label htmlFor="grid-x">W(H)</label>
              <span className="with-unit">
                <input id="grid-x" type="number" disabled={g.origin !== 'custom'} value={g.x} onChange={(e) => set({ x: Number(e.target.value) || 0 })} /> px
              </span>
              <label htmlFor="grid-y">H(V)</label>
              <span className="with-unit">
                <input id="grid-y" type="number" disabled={g.origin !== 'custom'} value={g.y} onChange={(e) => set({ y: Number(e.target.value) || 0 })} /> px
              </span>
            </div>
          </fieldset>
          <fieldset className="group">
            <legend>Grid settings</legend>
            <div className="form-grid">
              <label htmlFor="grid-gap">Gap</label>
              <span className="with-unit">
                <input id="grid-gap" type="number" min={1} max={10000} value={g.gap} onChange={(e) => set({ gap: Math.max(1, Number(e.target.value) || 1) })} /> px
              </span>
              <label htmlFor="grid-div">Number of divisions</label>
              <input id="grid-div" type="number" min={1} max={100} value={g.divisions} onChange={(e) => set({ divisions: Math.max(1, Math.round(Number(e.target.value) || 1)) })} />
            </div>
          </fieldset>
        </div>
        <div className="filter-side">
          <button type="submit" className="btn primary">
            OK
          </button>
          <button type="button" className="btn" onClick={closeDialog}>
            Cancel
          </button>
          <button type="button" className="btn" onClick={() => ok(true)}>
            Save as default
          </button>
        </div>
      </div>
    </form>
  );
}
