/** Layer > New frame border folder, Layer > Ruler/Frame > Divide frame border equally and Frame templates. */
import { useState } from 'react';
import { flatten } from '../../model/layers';
import { mmToPx, polygonBounds } from '../../paint/frames';
import { FRAME_TEMPLATES, sanitizeTemplate, templateFromPanels, templatePanels, type FrameTemplate } from '../../paint/frameTemplates';
import { getState } from '../../store/store';
import { addFrameFolder, addFrameTemplate, divideFrameEqually, pageFrame } from '../../store/frameActions';
import { closeDialog, toast } from '../overlays';

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

const OWN_KEY = 'mad-paint:frame-templates';

function loadOwn(): FrameTemplate[] {
  try {
    const raw = JSON.parse(localStorage.getItem(OWN_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.slice(0, 100).map(sanitizeTemplate).filter((t): t is FrameTemplate => t !== null) : [];
  } catch {
    return [];
  }
}

function saveOwn(list: FrameTemplate[]): void {
  try {
    localStorage.setItem(OWN_KEY, JSON.stringify(list));
  } catch {
    // Storage can be unavailable; the list then lasts for this session.
  }
}

/** A small picture of a template on a page. */
function TemplateThumb({ t }: { t: FrameTemplate }) {
  const W = 56;
  const H = 80;
  const panels = templatePanels(t, { x: 4, y: 4, w: W - 8, h: H - 8 }, 2, 3, { w: W, h: H });
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <rect x="0.5" y="0.5" width={W - 1} height={H - 1} fill="#fff" stroke="#888" />
      {panels.map((p, i) => (
        <polygon key={i} points={p.map((q) => `${q.x},${q.y}`).join(' ')} fill="none" stroke="#111" strokeWidth="1.2" />
      ))}
    </svg>
  );
}

/**
 * Layer > Ruler/Frame > Frame templates: page layouts that make the frames at once (the reference
 * drags framing templates from its material palette). Frames on the canvas can be registered as
 * an own template.
 */
export function FrameTemplateDialog() {
  const [own, setOwn] = useState<FrameTemplate[]>(loadOwn);
  const [picked, setPicked] = useState<string>(FRAME_TEMPLATES[4].id);
  const [line, setLine] = useState(5);
  const [draw, setDraw] = useState(true);
  const [gapTB, setGapTB] = useState(4);
  const [gapLR, setGapLR] = useState(2);
  const [separate, setSeparate] = useState(true);
  const [ownName, setOwnName] = useState('');
  const all = [...FRAME_TEMPLATES, ...own];
  const chosen = all.find((t) => t.id === picked) ?? null;
  const update = (list: FrameTemplate[]) => {
    setOwn(list);
    saveOwn(list);
  };
  const register = () => {
    const { doc } = getState();
    const panels = flatten(doc.layers).flatMap((l) => (l.kind === 'folder' && l.frame ? l.frame.panels.map((p) => p.points) : []));
    if (panels.length === 0) {
      toast('There are no frames on the canvas to register', 'error');
      return;
    }
    const t = templateFromPanels(ownName.trim() || `Template ${own.length + 1}`, panels, { w: doc.width, h: doc.height });
    update([...own, t]);
    setPicked(t.id);
    setOwnName('');
  };
  return (
    <form
      className="modal frame-template-dialog"
      role="dialog"
      aria-label="Frame templates"
      onSubmit={(e) => {
        e.preventDefault();
        if (!chosen) return;
        const { doc } = getState();
        const page = polygonBounds(pageFrame(doc));
        const panels = templatePanels(chosen, page, mmToPx(gapLR, doc.dpi), mmToPx(gapTB, doc.dpi), { w: doc.width, h: doc.height });
        addFrameTemplate(panels, line, draw, separate);
        closeDialog();
      }}
    >
      <h2>Frame templates</h2>
      <div className="template-list" role="listbox" aria-label="Templates">
        {all.map((t) => (
          <button
            type="button"
            key={t.id}
            role="option"
            aria-selected={t.id === picked}
            className={`template-item ${t.id === picked ? 'on' : ''}`}
            onClick={() => setPicked(t.id)}
            title={t.panels ? 'Registered template' : undefined}
          >
            <TemplateThumb t={t} />
            <span>{t.name}</span>
          </button>
        ))}
      </div>
      <div className="form-grid">
        {numberInput('template-gap-tb', 'Gutter top/bottom (mm)', gapTB, setGapTB, 0, 50, 0.5)}
        {numberInput('template-gap-lr', 'Gutter left/right (mm)', gapLR, setGapLR, 0, 50, 0.5)}
        {numberInput('template-line', 'Line width (px)', line, setLine, 0, 100, 0.5)}
        <label />
        <label className="check">
          <input type="checkbox" checked={draw} onChange={(e) => setDraw(e.target.checked)} />
          Draw border
        </label>
        <label />
        <label className="check">
          <input type="checkbox" checked={separate} onChange={(e) => setSeparate(e.target.checked)} />
          A frame border folder per frame
        </label>
      </div>
      <div className="gradient-list-actions">
        <input className="template-name" aria-label="Template name" placeholder={`Template ${own.length + 1}`} value={ownName} onChange={(e) => setOwnName(e.target.value.slice(0, 60))} />
        <button type="button" className="btn small" onClick={register}>
          Register frames on the canvas
        </button>
        <button
          type="button"
          className="btn small"
          disabled={!chosen?.panels}
          onClick={() => {
            update(own.filter((t) => t.id !== picked));
            setPicked(FRAME_TEMPLATES[0].id);
          }}
        >
          Delete template
        </button>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={closeDialog}>
          Cancel
        </button>
        <button type="submit" className="btn primary" disabled={!chosen}>
          OK
        </button>
      </div>
    </form>
  );
}
