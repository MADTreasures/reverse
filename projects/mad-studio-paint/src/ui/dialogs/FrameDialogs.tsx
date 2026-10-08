/** Layer > New frame border folder, and Layer > Ruler/Frame > Divide frame border equally. */
import { useState } from 'react';
import { getState } from '../../store/store';
import { addFrameFolder, divideFrameEqually, pageFrame } from '../../store/frameActions';
import { closeDialog } from '../overlays';

function DialogForm({ title, onOk, children }: { title: string; onOk: () => void; children: React.ReactNode }) {
  return (
    <form
      className="modal"
      role="dialog"
      aria-label={title}
      onSubmit={(e) => {
        e.preventDefault();
        onOk();
        closeDialog();
      }}
    >
      <h2>{title}</h2>
      <div className="form-grid">{children}</div>
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

const numberInput = (id: string, label: string, value: number, set: (v: number) => void, min: number, max: number, step = 1) => (
  <>
    <label htmlFor={id}>{label}</label>
    <input id={id} type="number" min={min} max={max} step={step} value={value} onChange={(e) => set(Math.max(min, Math.min(max, Number(e.target.value) || 0)))} />
  </>
);

/** Layer > New frame border folder: one frame inside the page margins. */
export function NewFrameFolderDialog() {
  const [line, setLine] = useState(5);
  const [draw, setDraw] = useState(true);
  return (
    <DialogForm title="New frame border folder" onOk={() => addFrameFolder(pageFrame(getState().doc), line, draw)}>
      <label />
      <label className="check">
        <input type="checkbox" checked={draw} onChange={(e) => setDraw(e.target.checked)} />
        Draw border
      </label>
      {numberInput('frame-line', 'Line width (px)', line, setLine, 0, 100, 0.5)}
    </DialogForm>
  );
}

/** Divides the selected frame (or the current frame border folder's first frame) into equal parts. */
export function DivideFrameDialog() {
  const [cols, setCols] = useState(2);
  const [rows, setRows] = useState(3);
  const [gapX, setGapX] = useState(2);
  const [gapY, setGapY] = useState(4);
  const [separate, setSeparate] = useState(true);
  return (
    <DialogForm title="Divide frame border equally" onOk={() => divideFrameEqually(cols, rows, gapX, gapY, separate)}>
      {numberInput('divide-cols', 'Vertical divisions (columns)', cols, setCols, 1, 20)}
      {numberInput('divide-rows', 'Horizontal divisions (rows)', rows, setRows, 1, 20)}
      {numberInput('divide-gap-x', 'Gutter left/right (mm)', gapX, setGapX, 0, 50, 0.5)}
      {numberInput('divide-gap-y', 'Gutter top/bottom (mm)', gapY, setGapY, 0, 50, 0.5)}
      <label />
      <label className="check">
        <input type="checkbox" checked={separate} onChange={(e) => setSeparate(e.target.checked)} />
        Divide folder (a frame border folder per frame)
      </label>
    </DialogForm>
  );
}
