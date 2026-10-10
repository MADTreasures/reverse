import { useState } from 'react';
import * as actions from '../../store/actions';
import { useStore } from '../../store/store';
import { closeDialog } from '../overlays';

/** Edit > Change canvas size / Change image resolution. */
export function CanvasSizeDialog({ mode }: { mode: 'canvas' | 'resolution' }) {
  const doc = useStore((s) => s.doc);
  const [w, setW] = useState(doc.width);
  const [h, setH] = useState(doc.height);
  const [dpi, setDpi] = useState(doc.dpi);
  const [keep, setKeep] = useState(true);
  const ratio = doc.width / doc.height;
  const setWidth = (v: number) => {
    setW(v);
    if (keep && mode === 'resolution') setH(Math.max(1, Math.round(v / ratio)));
  };
  const setHeight = (v: number) => {
    setH(v);
    if (keep && mode === 'resolution') setW(Math.max(1, Math.round(v * ratio)));
  };
  const ok = () => {
    const cw = Math.max(16, Math.min(8000, Math.round(w)));
    const ch = Math.max(16, Math.min(8000, Math.round(h)));
    closeDialog();
    if (mode === 'canvas') actions.changeCanvasSize(cw, ch);
    else actions.changeImageResolution(cw, ch, Math.max(1, Math.round(dpi)));
  };
  return (
    <form
      className="modal"
      role="dialog"
      aria-label={mode === 'canvas' ? 'Change canvas size' : 'Change image resolution'}
      onSubmit={(e) => {
        e.preventDefault();
        ok();
      }}
    >
      <h2>{mode === 'canvas' ? 'Change canvas size' : 'Change image resolution'}</h2>
      <div className="form-grid">
        <label>Width</label>
        <span className="with-unit">
          <input type="number" min={16} max={8000} value={w} aria-label="Width" onChange={(e) => setWidth(Number(e.target.value))} /> px
        </span>
        <label>Height</label>
        <span className="with-unit">
          <input type="number" min={16} max={8000} value={h} aria-label="Height" onChange={(e) => setHeight(Number(e.target.value))} /> px
        </span>
        {mode === 'resolution' && (
          <>
            <label>Resolution</label>
            <span className="with-unit">
              <input type="number" min={1} max={2400} value={dpi} aria-label="Resolution" onChange={(e) => setDpi(Number(e.target.value))} /> dpi
            </span>
            <label />
            <label className="check">
              <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Keep aspect ratio
            </label>
          </>
        )}
        {mode === 'canvas' && (
          <>
            <label />
            <span className="muted">The image stays centred; new areas are transparent.</span>
          </>
        )}
      </div>
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
