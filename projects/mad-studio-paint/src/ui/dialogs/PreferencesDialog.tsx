import * as actions from '../../store/actions';
import { DEFAULT_PREFS, useStore } from '../../store/store';
import { closeDialog } from '../overlays';

/** Preferences (⌘K): interface theme, rotation step, undo levels and the tool-key hold time. */
export function PreferencesDialog() {
  const prefs = useStore((s) => s.prefs);
  return (
    <div className="modal" role="dialog" aria-label="Preferences">
      <h2>Preferences</h2>
      <div className="form-grid">
        <label>Interface</label>
        <div className="segmented">
          <button className={prefs.theme === 'dark' ? 'on' : ''} onClick={() => actions.setPreferences({ theme: 'dark' })}>
            Dark mode
          </button>
          <button className={prefs.theme === 'light' ? 'on' : ''} onClick={() => actions.setPreferences({ theme: 'light' })}>
            Light mode
          </button>
        </div>
        <label htmlFor="pref-rotation">Rotation step</label>
        <span className="with-unit">
          <input
            id="pref-rotation"
            type="number"
            min={1}
            max={90}
            value={prefs.rotationStep}
            onChange={(e) => actions.setPreferences({ rotationStep: Math.max(1, Math.min(90, Number(e.target.value) || DEFAULT_PREFS.rotationStep)) })}
          />
          ° (View › Rotate left / right)
        </span>
        <label htmlFor="pref-undo">Number of undos</label>
        <span className="with-unit">
          <input
            id="pref-undo"
            type="number"
            min={1}
            max={500}
            value={prefs.undoLevels}
            onChange={(e) => actions.setPreferences({ undoLevels: Math.max(1, Math.min(500, Math.round(Number(e.target.value)) || DEFAULT_PREFS.undoLevels)) })}
          />
        </span>
        <label htmlFor="pref-hold">Tool key hold</label>
        <span className="with-unit">
          <input
            id="pref-hold"
            type="number"
            min={100}
            max={3000}
            step={50}
            value={prefs.holdMs}
            onChange={(e) => actions.setPreferences({ holdMs: Math.max(100, Math.min(3000, Number(e.target.value) || DEFAULT_PREFS.holdMs)) })}
          />
          ms – holding a tool key longer switches back when released
        </span>
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={() => actions.setPreferences({ ...DEFAULT_PREFS })}>
          Revert to defaults
        </button>
        <button className="btn primary" autoFocus onClick={closeDialog}>
          OK
        </button>
      </div>
    </div>
  );
}
