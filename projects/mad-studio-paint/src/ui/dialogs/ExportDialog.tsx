/**
 * File > Export (single layer) > format: the format's export settings dialog laid out like the
 * reference's (Preview, format settings, Output image, Export range, Color, Output size) and the
 * Export preview (zoomable picture, JPEG quality, file size). File > Save duplicate > .psd / .psb.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { encodeExport, exportImage, exportPsd, renderExport, saveExport, type ExportRange, type ImageExportOptions } from '../../io/documentIO';
import { EXPRESSION_COLORS, fromPixels, IMAGE_FORMATS, MAX_EXPORT_SIDE, outputSize, toPixels, type ExpressionColor, type ImageFormat, type OutputSize, type SizeUnit } from '../../io/imageExport';
import { maskBounds } from '../../paint/mask';
import { areaRect } from '../../paint/outputFrame';
import { useStore } from '../../store/store';
import { closeDialog, openDialog } from '../overlays';

let chosen: ImageFormat = 'png';
/** The settings chosen last (the dialog opens with them). */
let last: Partial<ImageExportOptions> & { preview?: boolean } = {};
/** The export the Export preview shows. */
let previewing: ImageExportOptions | null = null;

/** File > Export (single layer) > a format. */
export function openImageExport(format: ImageFormat): void {
  chosen = format;
  openDialog('export');
}

const clamp = (v: number, min: number, max: number, fallback: number) => (Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback);
const round2 = (v: number) => Math.round(v * 100) / 100;

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="group">
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

export function ExportDialog() {
  const format = chosen;
  const info = IMAGE_FORMATS[format];
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const [preview, setPreview] = useState(last.preview ?? false);
  const [quality, setQuality] = useState(Math.round((last.quality ?? 1) * 100));
  const [lossless, setLossless] = useState(last.lossless ?? true);
  const [background, setBackground] = useState(last.background ?? false);
  const [drafts, setDrafts] = useState(last.drafts ?? false);
  const [text, setText] = useState(last.text ?? true);
  const [range, setRange] = useState<ExportRange>(last.range === 'output' && doc.outputFrame ? 'output' : 'canvas');
  const [color, setColor] = useState<ExpressionColor>(last.color ?? 'auto');
  const [transparent, setTransparent] = useState(last.transparent ?? false);
  const [mode, setMode] = useState<OutputSize['mode']>(last.size?.mode ?? 'scale');
  const [percent, setPercent] = useState(last.size?.mode === 'scale' ? last.size.percent : 100);
  const [unit, setUnit] = useState<SizeUnit>('px');
  const [dpi, setDpi] = useState(last.size?.mode === 'resolution' ? last.size.dpi : doc.dpi);
  const [busy, setBusy] = useState(false);
  const area = range === 'output' && doc.outputFrame ? areaRect(doc.outputFrame, 'output', doc.width, doc.height) : range === 'selection' && selection ? (maskBounds(selection) ?? { x: 0, y: 0, w: doc.width, h: doc.height }) : { x: 0, y: 0, w: doc.width, h: doc.height };
  // Specify output size: the width in pixels (the height keeps the area's aspect ratio).
  const [sizeW, setSizeW] = useState(area.w);
  const sizeH = Math.max(1, Math.round((sizeW * area.h) / area.w));
  const size: OutputSize = mode === 'scale' ? { mode, percent } : mode === 'size' ? { mode, width: sizeW, height: sizeH, unit: 'px' } : { mode, dpi };
  const out = outputSize(size, area.w, area.h, doc.dpi);
  const shown = (px: number) => round2(fromPixels(px, unit, doc.dpi));
  const options = (): ImageExportOptions => ({ format, quality: quality / 100, lossless, background, drafts, text, range, color, transparent, size });

  const run = async () => {
    const o = options();
    last = { ...o, preview };
    if (preview) {
      previewing = o;
      openDialog('exportPreview');
      return;
    }
    setBusy(true);
    await new Promise((r) => setTimeout(r, 20));
    const ok = await exportImage(o);
    setBusy(false);
    if (ok) closeDialog();
  };

  return (
    <form
      className="modal export-settings"
      role="dialog"
      aria-label={`${info.name} export settings`}
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
    >
      <h2>{info.name} export settings</h2>
      <Group title="Preview">
        <label className="check">
          <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} /> Preview rendering result on output
        </label>
      </Group>
      {format === 'jpeg' && (
        <Group title="JPEG settings">
          <span className="with-unit">
            <label htmlFor="ex-quality">Quality</label>
            <input id="ex-quality" type="number" min={1} max={100} value={quality} onChange={(e) => setQuality(clamp(Math.round(Number(e.target.value)), 1, 100, quality))} />
          </span>
        </Group>
      )}
      {format === 'webp' && (
        <Group title="WebP settings">
          <label className="check">
            <input type="radio" name="ex-webp" checked={lossless} onChange={() => setLossless(true)} /> Prioritize quality
          </label>
          <span className="with-unit">
            <label className="check">
              <input type="radio" name="ex-webp" checked={!lossless} onChange={() => setLossless(false)} /> Prioritize file size
            </label>
            <label htmlFor="ex-webp-quality">Quality</label>
            <input id="ex-webp-quality" type="number" min={1} max={100} value={quality} disabled={lossless} onChange={(e) => setQuality(clamp(Math.round(Number(e.target.value)), 1, 100, quality))} />
          </span>
        </Group>
      )}
      {(format === 'psd' || format === 'psb') && (
        <Group title="Photoshop file settings">
          <label className="check">
            <input type="checkbox" checked={background} onChange={(e) => setBackground(e.target.checked)} /> Output as background
          </label>
        </Group>
      )}
      <Group title="Output image">
        <span className="checks">
          <label className="check">
            <input type="checkbox" checked={drafts} onChange={(e) => setDrafts(e.target.checked)} /> Draft
          </label>
          <label className="check">
            <input type="checkbox" checked={text} onChange={(e) => setText(e.target.checked)} /> Text
          </label>
        </span>
        <span className="with-unit">
          <label htmlFor="ex-range">Export range</label>
          <select
            id="ex-range"
            value={range}
            onChange={(e) => {
              const r = e.target.value as ExportRange;
              setRange(r);
              const a = r === 'output' && doc.outputFrame ? areaRect(doc.outputFrame, 'output', doc.width, doc.height) : r === 'selection' && selection ? maskBounds(selection) : null;
              setSizeW(a?.w ?? doc.width);
            }}
          >
            <option value="canvas">Entire canvas</option>
            {doc.outputFrame && <option value="output">Output frame</option>}
            {selection && <option value="selection">Selection</option>}
          </select>
        </span>
      </Group>
      <Group title="Color">
        <span className="with-unit">
          <label htmlFor="ex-color">Expression color</label>
          <select id="ex-color" value={color} onChange={(e) => setColor(e.target.value as ExpressionColor)}>
            {EXPRESSION_COLORS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </span>
        {info.transparency && (
          <label className="check">
            <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} /> Export transparency
          </label>
        )}
      </Group>
      <Group title="Output size">
        <span className="with-unit">
          <label className="check">
            <input type="radio" name="ex-size" checked={mode === 'scale'} onChange={() => setMode('scale')} /> Scale ratio from original data
          </label>
          <input type="number" aria-label="Scale ratio" min={1} max={1000} step={0.01} value={percent} disabled={mode !== 'scale'} onChange={(e) => setPercent(clamp(Number(e.target.value), 1, 1000, percent))} /> %
        </span>
        <span className="with-unit">
          <label className="check">
            <input type="radio" name="ex-size" checked={mode === 'size'} onChange={() => setMode('size')} /> Specify output size
          </label>
        </span>
        <span className="with-unit indent">
          <label htmlFor="ex-out-w">Width</label>
          <input
            id="ex-out-w"
            type="number"
            min={0}
            step="any"
            value={shown(sizeW)}
            disabled={mode !== 'size'}
            onChange={(e) => setSizeW(clamp(Math.round(toPixels(Number(e.target.value), unit, doc.dpi)), 1, MAX_EXPORT_SIDE, sizeW))}
          />
          <label htmlFor="ex-out-h">Height</label>
          <input
            id="ex-out-h"
            type="number"
            min={0}
            step="any"
            value={shown(sizeH)}
            disabled={mode !== 'size'}
            onChange={(e) => setSizeW(clamp(Math.round((toPixels(Number(e.target.value), unit, doc.dpi) * area.w) / area.h), 1, MAX_EXPORT_SIDE, sizeW))}
          />
          <select className="unit" aria-label="Unit" value={unit} disabled={mode !== 'size'} onChange={(e) => setUnit(e.target.value as SizeUnit)}>
            <option value="px">px</option>
            <option value="mm">mm</option>
            <option value="cm">cm</option>
            <option value="in">in</option>
          </select>
        </span>
        <span className="with-unit">
          <label className="check">
            <input type="radio" name="ex-size" checked={mode === 'resolution'} onChange={() => setMode('resolution')} /> Specify resolution
          </label>
          <input type="number" aria-label="Resolution" min={72} max={1200} value={dpi} disabled={mode !== 'resolution'} onChange={(e) => setDpi(clamp(Math.round(Number(e.target.value)), 72, 1200, dpi))} /> dpi
        </span>
        <span className="muted" data-testid="export-size">
          {out.width} × {out.height} px · {format === 'webp' ? 72 : out.dpi} dpi
        </span>
      </Group>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={closeDialog}>
          Cancel
        </button>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Exporting…' : 'OK'}
        </button>
      </div>
    </form>
  );
}

/**
 * Export preview (Preview rendering result on output): the picture as it will be written, with a
 * zoom; for JPEG the quality (the picture shows it) and the file size.
 */
export function ExportPreviewDialog() {
  const o = previewing;
  const rendered = useMemo(() => (o ? renderExport(o) : null), [o]);
  const [quality, setQuality] = useState(Math.round((o?.quality ?? 1) * 100));
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!o || !rendered) return;
    let live = true;
    let made: string | null = null;
    const timer = setTimeout(async () => {
      const b = await encodeExport(rendered.canvas, rendered.dpi, { ...o, quality: quality / 100 });
      if (!live) return;
      setBytes(b);
      // JPEG and WebP show as written (their quality shows); the other formats as drawn.
      made = o.format === 'jpeg' || o.format === 'webp' ? URL.createObjectURL(new Blob([b.slice().buffer], { type: IMAGE_FORMATS[o.format].mime })) : null;
      setUrl(made ?? rendered.canvas.toDataURL());
    }, 80);
    return () => {
      live = false;
      clearTimeout(timer);
      if (made) URL.revokeObjectURL(made);
    };
  }, [o, rendered, quality]);
  if (!o || !rendered) return null;
  const { width, height } = rendered.canvas;
  const percent = zoom ?? null;
  const step = (dir: 1 | -1) => setZoom((z) => clamp(Math.round((z ?? 100) * (dir > 0 ? 1.25 : 0.8)), 1, 800, 100));
  return (
    <form
      className="modal export-preview"
      role="dialog"
      aria-label="Export preview"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const b = bytes ?? (await encodeExport(rendered.canvas, rendered.dpi, { ...o, quality: quality / 100 }));
        const ok = await saveExport(b, o.format);
        setBusy(false);
        if (ok) closeDialog();
      }}
    >
      <h2>Export preview ({percent === null ? 'fit' : `${percent}%`})</h2>
      <div className={`export-preview-image ${percent === null ? 'fit' : ''}`} data-testid="export-preview">
        {url && <img src={url} alt="Exported image" style={percent === null ? undefined : { width: (width * percent) / 100, height: (height * percent) / 100 }} />}
      </div>
      <div className="export-preview-bar">
        <input type="range" aria-label="Zoom" min={1} max={800} value={percent ?? 100} onChange={(e) => setZoom(Number(e.target.value))} />
        <button type="button" className="btn small" onClick={() => step(-1)}>
          Zoom out
        </button>
        <button type="button" className="btn small" onClick={() => step(1)}>
          Zoom in
        </button>
        <button type="button" className="btn small" onClick={() => setZoom(100)}>
          100%
        </button>
        <button type="button" className="btn small" onClick={() => setZoom(null)}>
          Fit
        </button>
        {o.format === 'jpeg' && (
          <span className="with-unit">
            <label htmlFor="pv-quality">Quality</label>
            <input id="pv-quality" type="number" min={1} max={100} value={quality} onChange={(e) => setQuality(clamp(Math.round(Number(e.target.value)), 1, 100, quality))} />
          </span>
        )}
        <span className="muted" data-testid="export-file-size">
          File size {bytes ? (bytes.length / 1024).toFixed(2) : '…'} [KByte]
        </span>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={closeDialog}>
          Cancel
        </button>
        <button type="submit" className="btn primary" disabled={busy || !bytes}>
          OK
        </button>
      </div>
    </form>
  );
}

let duplicatePsb = false;

/** File > Save duplicate > .psd / .psb. */
export function openPsdDuplicate(psb: boolean): void {
  duplicatePsb = psb;
  openDialog('exportPsd');
}

/**
 * File > Save duplicate > .psd / .psb: export settings. Like the reference, draft layers are not
 * output unless ticked; vector, text and gradient layers are rasterized.
 */
export function PsdExportDialog() {
  const psb = duplicatePsb;
  const [drafts, setDrafts] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const ok = await exportPsd({ skipDraft: !drafts, psb });
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
      <h2>Save duplicate as Photoshop {psb ? 'big document (.psb)' : 'document (.psd)'}</h2>
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
