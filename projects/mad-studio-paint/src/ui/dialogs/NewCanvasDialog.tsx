import { useState } from 'react';
import { CANVAS_PRESETS, MAX_CANVAS_SIDE, clampCanvasSide } from '../../model/document';
import { newCanvas } from '../../io/documentIO';
import { closeDialog } from '../overlays';

export function NewCanvasDialog() {
  const [name, setName] = useState('Illustration');
  const [preset, setPreset] = useState(CANVAS_PRESETS[0].id);
  const [width, setWidth] = useState(CANVAS_PRESETS[0].width);
  const [height, setHeight] = useState(CANVAS_PRESETS[0].height);
  const [dpi, setDpi] = useState(CANVAS_PRESETS[0].dpi);
  const [paper, setPaper] = useState('#ffffff');

  const choose = (id: string) => {
    const p = CANVAS_PRESETS.find((x) => x.id === id);
    setPreset(id);
    if (p) {
      setWidth(p.width);
      setHeight(p.height);
      setDpi(p.dpi);
    }
  };

  const ok = () => {
    closeDialog();
    void newCanvas(name.trim() || 'Untitled', clampCanvasSide(width), clampCanvasSide(height), Math.max(1, Math.round(dpi)), paper);
  };

  return (
    <form
      className="modal"
      role="dialog"
      aria-label="New canvas"
      onSubmit={(e) => {
        e.preventDefault();
        ok();
      }}
    >
      <h2>New</h2>
      <div className="form-grid">
        <label>File name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <label>Preset</label>
        <select value={preset} onChange={(e) => choose(e.target.value)}>
          {CANVAS_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
        <label>Width</label>
        <span className="with-unit">
          <input type="number" min={16} max={MAX_CANVAS_SIDE} value={width} aria-label="Width" onChange={(e) => (setWidth(Number(e.target.value)), setPreset('custom'))} /> px
        </span>
        <label>Height</label>
        <span className="with-unit">
          <input type="number" min={16} max={MAX_CANVAS_SIDE} value={height} aria-label="Height" onChange={(e) => (setHeight(Number(e.target.value)), setPreset('custom'))} /> px
        </span>
        <label>Resolution</label>
        <span className="with-unit">
          <input type="number" min={1} max={2400} value={dpi} aria-label="Resolution" onChange={(e) => (setDpi(Number(e.target.value)), setPreset('custom'))} /> dpi
        </span>
        <label>Paper color</label>
        <input type="color" value={paper} onChange={(e) => setPaper(e.target.value)} aria-label="Paper color" />
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
