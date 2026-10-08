import { useState } from 'react';
import { exportImage, exportPsd, type ExportFormat } from '../../io/documentIO';
import { useStore } from '../../store/store';
import { closeDialog } from '../overlays';

export function ExportDialog() {
  const doc = useStore((s) => s.doc);
  const [format, setFormat] = useState<ExportFormat>('png');
  const [scale, setScale] = useState(100);
  const [transparent, setTransparent] = useState(false);
  const [quality, setQuality] = useState(92);
  const [skipDraft, setSkipDraft] = useState(true);
  const [background, setBackground] = useState(false);
  const [busy, setBusy] = useState(false);
  const w = Math.max(1, Math.round((doc.width * scale) / 100));
  const h = Math.max(1, Math.round((doc.height * scale) / 100));

  const run = async () => {
    setBusy(true);
    const ok = await exportImage(format, { scale: scale / 100, transparent, quality: quality / 100, skipDraft, background });
    setBusy(false);
    if (ok) closeDialog();
  };

  return (
    <form
      className="modal"
      role="dialog"
      aria-label="Export"
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
    >
      <h2>Export (single layer)</h2>
      <div className="form-grid">
        <label>Format</label>
        <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)} aria-label="Format">
          <option value="png">PNG</option>
          <option value="jpeg">JPEG</option>
          <option value="webp">WebP</option>
          <option value="psd">Photoshop document (.psd)</option>
        </select>
        <label>Scale</label>
        <span className="with-unit">
          <input type="number" min={1} max={400} value={scale} onChange={(e) => setScale(Math.max(1, Math.min(400, Number(e.target.value) || 100)))} aria-label="Scale" /> % → {w} × {h} px
        </span>
        {format === 'psd' && (
          <>
            <label />
            <label className="check">
              <input type="checkbox" checked={background} onChange={(e) => setBackground(e.target.checked)} /> Output as background
            </label>
          </>
        )}
        {format !== 'jpeg' && !(format === 'psd' && background) && (
          <>
            <label />
            <label className="check">
              <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} /> Transparent background (hide paper)
            </label>
          </>
        )}
        {(format === 'jpeg' || format === 'webp') && (
          <>
            <label>Quality</label>
            <span className="with-unit">
              <input type="number" min={10} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))} aria-label="Quality" /> %
            </span>
          </>
        )}
        <label />
        <label className="check">
          <input type="checkbox" checked={skipDraft} onChange={(e) => setSkipDraft(e.target.checked)} /> Hide draft layers
        </label>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={closeDialog}>
          Cancel
        </button>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Exporting…' : 'Export'}
        </button>
      </div>
    </form>
  );
}

/**
 * File > Save duplicate > .psd: export settings. Like the reference, draft layers are not output
 * unless ticked; vector, text and gradient layers are rasterized.
 */
export function PsdExportDialog() {
  const [drafts, setDrafts] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const ok = await exportPsd({ skipDraft: !drafts });
    setBusy(false);
    if (ok) closeDialog();
  };
  return (
    <form
      className="modal"
      role="dialog"
      aria-label="Export settings"
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
    >
      <h2>Save duplicate as Photoshop document</h2>
      <div className="form-grid">
        <label>Output image</label>
        <label className="check">
          <input type="checkbox" checked={drafts} onChange={(e) => setDrafts(e.target.checked)} /> Draft layers
        </label>
        <label>Expression color</label>
        <select value="rgb" disabled aria-label="Expression color">
          <option value="rgb">RGB color</option>
        </select>
      </div>
      <p className="muted">Vector, text and gradient layers are rasterized; effects without a Photoshop counterpart are applied to the pixels.</p>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={closeDialog}>
          Cancel
        </button>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Saving…' : 'OK'}
        </button>
      </div>
    </form>
  );
}
