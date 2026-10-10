/**
 * Select menu dialogs like the reference's: Expand / Shrink selected area (width, sharp or rounded
 * corners), Blur border (range) and Select color gamut (stays open while colours are picked on the
 * canvas: error margin, new / add / delete, Refer multiple, Reset).
 */
import { useEffect, useRef, useState } from 'react';
import type { FillReference } from '../../paint/tools';
import * as actions from '../../store/actions';
import { DEFAULT_GAMUT, pickColorGamut, type GamutSettings, type GamutType } from '../../store/selectionActions';
import { getState, setState } from '../../store/store';
import { canvasPick } from '../../tools/canvasPick';
import { closeDialog } from '../overlays';

const clampInt = (v: string, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

function Actions() {
  return (
    <div className="modal-actions">
      <button type="button" className="btn" onClick={closeDialog}>
        Cancel
      </button>
      <button type="submit" className="btn primary">
        OK
      </button>
    </div>
  );
}

/** The last values used, offered again next time. */
const last = { grow: 4, corners: 'sharp' as 'sharp' | 'rounded', blur: 6, gamut: DEFAULT_GAMUT };

/** Select > Expand selected area / Shrink selected area. */
export function GrowSelectionDialog({ mode }: { mode: 'expand' | 'shrink' }) {
  const [width, setWidth] = useState(last.grow);
  const [corners, setCorners] = useState(last.corners);
  const title = mode === 'expand' ? 'Expand selected area' : 'Shrink selected area';
  return (
    <form
      className="modal small"
      role="dialog"
      aria-label={title}
      onSubmit={(e) => {
        e.preventDefault();
        last.grow = width;
        last.corners = corners;
        actions.growSelection(mode === 'expand' ? width : -width, corners);
        closeDialog();
      }}
    >
      <h2>{title}</h2>
      <div className="form-grid">
        <label htmlFor="grow-width">{mode === 'expand' ? 'Expansion width' : 'Shrinking width'}</label>
        <span className="with-unit">
          <input id="grow-width" type="number" min={1} max={1000} value={width} autoFocus onFocus={(e) => e.target.select()} onChange={(e) => setWidth(clampInt(e.target.value, 1, 1000, width))} /> px
        </span>
        <label>{mode === 'expand' ? 'Expansion type' : 'Shrinking type'}</label>
        <div className="segmented" role="radiogroup" aria-label={mode === 'expand' ? 'Expansion type' : 'Shrinking type'}>
          {(
            [
              ['sharp', 'Sharp corners'],
              ['rounded', 'Rounded corners'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={corners === id} className={corners === id ? 'on' : ''} onClick={() => setCorners(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <Actions />
    </form>
  );
}

/** Select > Blur border. */
export function BlurBorderDialog() {
  const [range, setRange] = useState(last.blur);
  return (
    <form
      className="modal small"
      role="dialog"
      aria-label="Blur border"
      onSubmit={(e) => {
        e.preventDefault();
        last.blur = range;
        actions.blurSelection(range);
        closeDialog();
      }}
    >
      <h2>Blur border</h2>
      <div className="form-grid">
        <label htmlFor="blur-range">Blur range</label>
        <span className="with-unit">
          <input id="blur-range" type="number" min={1} max={500} value={range} autoFocus onFocus={(e) => e.target.select()} onChange={(e) => setRange(clampInt(e.target.value, 1, 500, range))} /> px
        </span>
      </div>
      <p className="muted">The border fades out over this distance; a soft selection shows its middle with the marching ants.</p>
      <Actions />
    </form>
  );
}

const GAMUT_TYPES: [GamutType, string][] = [
  ['new', 'New selection'],
  ['add', 'Add to selection'],
  ['delete', 'Delete from selection'],
];

const GAMUT_REFERENCES: [FillReference, string][] = [
  ['all', 'All layers'],
  ['reference', 'Reference layer'],
  ['layer', 'Selected layer'],
  ['folder', 'Layer in folder'],
];

/**
 * Select > Select color gamut: while it is open, clicking the canvas selects every pixel of a
 * similar colour; OK keeps the selection (one undo step), Cancel puts the old one back.
 */
export function ColorGamutDialog() {
  const [o, setO] = useState<GamutSettings>(last.gamut);
  const settings = useRef(o);
  settings.current = o;
  const before = useRef(getState().selection);
  const done = useRef(false);
  useEffect(() => {
    // The canvas takes the clicks; the rest of the window waits for the dialog.
    document.body.classList.add('canvas-only');
    canvasPick.start((x, y) => pickColorGamut(x, y, settings.current));
    return () => {
      document.body.classList.remove('canvas-only');
      canvasPick.end();
      if (!done.current) setState({ selection: before.current });
    };
  }, []);
  const set = (patch: Partial<GamutSettings>) => setO((x) => ({ ...x, ...patch }));
  return (
    <form
      className="modal small"
      role="dialog"
      aria-label="Select color gamut"
      onSubmit={(e) => {
        e.preventDefault();
        done.current = true;
        last.gamut = o;
        actions.commitSelection(before.current, 'Select color gamut');
        closeDialog();
      }}
    >
      <h2>Select color gamut</h2>
      <p className="muted">Click colours on the canvas to select them.</p>
      <div className="form-grid">
        <label htmlFor="gamut-margin">Error margin of color</label>
        <input id="gamut-margin" type="number" min={0} max={100} step={0.5} value={o.margin} onChange={(e) => set({ margin: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />
        <label>Selection type</label>
        <div className="segmented" role="radiogroup" aria-label="Selection type">
          {GAMUT_TYPES.map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={o.type === id} className={o.type === id ? 'on' : ''} onClick={() => set({ type: id })}>
              {label}
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={o.multiple} onChange={(e) => set({ multiple: e.target.checked })} /> Refer multiple
        </label>
        <select aria-label="Refer multiple" value={o.reference} disabled={!o.multiple} onChange={(e) => set({ reference: e.target.value as FillReference })}>
          {GAMUT_REFERENCES.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={() => setO(DEFAULT_GAMUT)}>
          Reset
        </button>
        <span className="spacer" />
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
