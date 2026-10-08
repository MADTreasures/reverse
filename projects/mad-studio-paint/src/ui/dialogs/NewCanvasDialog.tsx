import { useState } from 'react';
import { CANVAS_PRESETS, MAX_CANVAS_SIDE, clampCanvasSide } from '../../model/document';
import { newCanvas } from '../../io/documentIO';
import { DEFAULT_TIMELINE, MAX_FPS, MAX_FRAMES } from '../../paint/animation';
import { closeDialog } from '../overlays';

export function NewCanvasDialog() {
  const [name, setName] = useState('Illustration');
  const [preset, setPreset] = useState(CANVAS_PRESETS[0].id);
  const [width, setWidth] = useState(CANVAS_PRESETS[0].width);
  const [height, setHeight] = useState(CANVAS_PRESETS[0].height);
  const [dpi, setDpi] = useState(CANVAS_PRESETS[0].dpi);
  const [paper, setPaper] = useState('#ffffff');
  const [animated, setAnimated] = useState(false);
  const [cels, setCels] = useState(DEFAULT_TIMELINE.frames);
  const [fps, setFps] = useState(DEFAULT_TIMELINE.fps);

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
    void newCanvas(name.trim() || 'Untitled', clampCanvasSide(width), clampCanvasSide(height), Math.max(1, Math.round(dpi)), paper, animated ? { cels, fps } : undefined);
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
        <label />
        <label className="check">
          <input type="checkbox" checked={animated} onChange={(e) => setAnimated(e.target.checked)} /> Create animated illustration
        </label>
        {animated && (
          <>
            <label htmlFor="new-cels">Number of cels</label>
            <input id="new-cels" type="number" min={1} max={MAX_FRAMES} value={cels} onChange={(e) => setCels(Math.max(1, Math.min(MAX_FRAMES, Math.round(Number(e.target.value)) || 1)))} />
            <label htmlFor="new-fps">Frame rate</label>
            <span className="with-unit">
              <input id="new-fps" type="number" min={1} max={MAX_FPS} value={fps} onChange={(e) => setFps(Math.max(1, Math.min(MAX_FPS, Math.round(Number(e.target.value)) || 1)))} /> fps
            </span>
            <label>Playback time</label>
            <span>{(cels / fps).toFixed(2)} s</span>
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
