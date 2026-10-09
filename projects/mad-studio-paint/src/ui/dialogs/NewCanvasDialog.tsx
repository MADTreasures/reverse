import { useState } from 'react';
import { CANVAS_PRESETS, MAX_CANVAS_SIDE, clampCanvasSide } from '../../model/document';
import { newCanvas } from '../../io/documentIO';
import { DEFAULT_TIMELINE, MAX_FPS, MAX_FRAMES } from '../../paint/animation';
import { defaultFrameSettings, layoutFrames, type FrameSettings, type Margins, type RefPoint } from '../../paint/outputFrame';
import { closeDialog } from '../overlays';

const int = (v: string, min: number, max: number) => Math.max(min, Math.min(max, Math.round(Number(v)) || 0));

/** Top, bottom, left and right in px. */
function MarginInputs({ label, value, onChange }: { label: string; value: Margins; onChange: (m: Margins) => void }) {
  return (
    <span className="margin-inputs">
      {(['top', 'bottom', 'left', 'right'] as const).map((k) => (
        <label key={k} className="with-unit">
          {k[0].toUpperCase() + k.slice(1)}
          <input type="number" min={0} max={MAX_CANVAS_SIDE} aria-label={`${label} ${k}`} value={value[k]} onChange={(e) => onChange({ ...value, [k]: int(e.target.value, 0, MAX_CANVAS_SIDE) })} />
        </label>
      ))}
    </span>
  );
}

const REF_LABELS: Record<string, string> = { '-1': 'left', '0': 'center', '1': 'right' };
const REF_ROWS: Record<string, string> = { '-1': 'top', '0': 'middle', '1': 'bottom' };

/** Where the output frame lies in the overflow frame: nine points. */
function ReferencePoint({ x, y, onChange }: { x: RefPoint; y: RefPoint; onChange: (x: RefPoint, y: RefPoint) => void }) {
  const steps: RefPoint[] = [-1, 0, 1];
  return (
    <span className="ref-point" role="radiogroup" aria-label="Reference point">
      {steps.map((ry) =>
        steps.map((rx) => (
          <button
            key={`${rx}${ry}`}
            type="button"
            role="radio"
            aria-checked={rx === x && ry === y}
            aria-label={`Reference point ${REF_ROWS[ry]} ${REF_LABELS[rx]}`}
            className={rx === x && ry === y ? 'on' : ''}
            onClick={() => onChange(rx, ry)}
          />
        )),
      )}
    </span>
  );
}

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
  // Animation frame settings: Width/Height are then the size of the output frame.
  const [frames, setFrames] = useState<FrameSettings | null>(null);
  const settings = frames ? { ...frames, width, height } : null;
  const layout = settings ? layoutFrames(settings) : null;
  const setF = (patch: Partial<FrameSettings>) => setFrames((f) => (f ? { ...f, ...patch } : f));
  const overflow = frames?.overflow ?? { scale: true, w: 2, h: 1, refX: -1 as RefPoint, refY: 0 as RefPoint, offsetX: 0, offsetY: 0 };
  const setO = (patch: Partial<typeof overflow>) => setF({ overflow: { ...overflow, ...patch } });

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
    const anim = animated ? { cels, fps } : undefined;
    if (animated && layout) {
      void newCanvas(name.trim() || 'Untitled', clampCanvasSide(layout.width), clampCanvasSide(layout.height), Math.max(1, Math.round(dpi)), paper, anim, layout.frame);
      return;
    }
    void newCanvas(name.trim() || 'Untitled', clampCanvasSide(width), clampCanvasSide(height), Math.max(1, Math.round(dpi)), paper, anim);
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
            <label />
            <label className="check">
              <input type="checkbox" checked={frames !== null} onChange={(e) => setFrames(e.target.checked ? defaultFrameSettings(width, height) : null)} /> Animation frame settings
            </label>
          </>
        )}
        {animated && frames && layout && (
          <>
            <label />
            <span className="muted" data-testid="new-canvas-size">
              Width and height set the output frame; the canvas becomes {layout.width} × {layout.height} px
            </span>
            <label />
            <label className="check">
              <input type="checkbox" checked={frames.safe !== null} onChange={(e) => setF({ safe: e.target.checked ? defaultFrameSettings(width, height).safe : null })} /> Title-safe area
            </label>
            {frames.safe && (
              <>
                <label />
                <MarginInputs label="Title-safe area" value={frames.safe} onChange={(safe) => setF({ safe })} />
              </>
            )}
            <label />
            <label className="check">
              <input type="checkbox" checked={frames.overflow !== null} onChange={(e) => setF({ overflow: e.target.checked ? overflow : null })} /> Overflow frame
            </label>
            {frames.overflow && (
              <>
                <label htmlFor="ov-mode">Overflow size</label>
                <select id="ov-mode" value={overflow.scale ? 'scale' : 'size'} onChange={(e) => setO(e.target.value === 'scale' ? { scale: true, w: 2, h: 1 } : { scale: false, w: width * 2, h: height })}>
                  <option value="scale">Specified scale</option>
                  <option value="size">Specified size</option>
                </select>
                <label>Overflow width / height</label>
                <span className="with-unit">
                  <input type="number" aria-label="Overflow width" min={1} step={overflow.scale ? 0.05 : 1} value={overflow.w} onChange={(e) => setO({ w: Math.max(1, Number(e.target.value) || 1) })} /> /
                  <input type="number" aria-label="Overflow height" min={1} step={overflow.scale ? 0.05 : 1} value={overflow.h} onChange={(e) => setO({ h: Math.max(1, Number(e.target.value) || 1) })} />
                  {overflow.scale ? '×' : 'px'}
                </span>
                <label>Reference point</label>
                <ReferencePoint x={overflow.refX} y={overflow.refY} onChange={(refX, refY) => setO({ refX, refY })} />
                <label>Offset X / Y</label>
                <span className="with-unit">
                  <input type="number" aria-label="Offset X" value={overflow.offsetX} onChange={(e) => setO({ offsetX: Math.round(Number(e.target.value)) || 0 })} /> /
                  <input type="number" aria-label="Offset Y" value={overflow.offsetY} onChange={(e) => setO({ offsetY: Math.round(Number(e.target.value)) || 0 })} /> px
                </span>
              </>
            )}
            <label>Blank space</label>
            <MarginInputs label="Blank space" value={frames.blank} onChange={(blank) => setF({ blank })} />
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
