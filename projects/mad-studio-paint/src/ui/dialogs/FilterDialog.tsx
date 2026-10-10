/**
 * The settings dialog of a Filter menu entry, laid out like the reference: each value as a number
 * with a bar under it, choices as lists, OK / Cancel / Preview on the right. The preview is
 * computed in the background and shown on the canvas; filters with a centre show a red × there
 * that follows presses and drags on the canvas.
 */
import { useEffect, useRef, useState } from 'react';
import { FilterRunner } from '../../engine/filterRunner';
import { defaultValues, filterSpec, type FilterId, type FilterParam, type FilterValues } from '../../paint/filters';
import { filterRect, startFilter, type FilterSession } from '../../store/filterActions';
import { filterCenter } from '../../tools/filterCenter';
import { closeDialog } from '../overlays';

/** Last settings of each filter in this session: a filter reopens with them, like the reference. */
const lastValues = new Map<FilterId, FilterValues>();

const keyOf = (v: FilterValues) => JSON.stringify(v);

export function FilterDialog({ id }: { id: FilterId }) {
  const spec = filterSpec(id);
  const [values, setValues] = useState<FilterValues>(() => ({ ...defaultValues(id), ...lastValues.get(id) }));
  const [preview, setPreview] = useState(true);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const session = useRef<{ s: FilterSession; runner: FilterRunner } | null>(null);
  const shown = useRef('');

  useEffect(() => {
    const s = startFilter();
    if (!s) {
      closeDialog();
      return;
    }
    const runner = new FilterRunner(s.source);
    session.current = { s, runner };
    if (spec.center) {
      // The × starts in the middle of the selection (or canvas), or where it was last time.
      const last = lastValues.get(id);
      const cx = typeof last?.cx === 'number' ? last.cx : Math.round(s.area.x + s.area.w / 2);
      const cy = typeof last?.cy === 'number' ? last.cy : Math.round(s.area.y + s.area.h / 2);
      setValues((v) => ({ ...v, cx, cy }));
      filterCenter.start(cx, cy, (x, y) => setValues((v) => ({ ...v, cx: x, cy: y })));
      document.body.classList.add('canvas-only');
    }
    setReady(true);
    return () => {
      runner.dispose();
      filterCenter.end();
      document.body.classList.remove('canvas-only');
      // After OK this does nothing (the change is already recorded).
      s.preview.cancel();
      session.current = null;
    };
  }, [id, spec.center]);

  useEffect(() => {
    const cur = session.current;
    if (!ready || !cur) return;
    if (spec.center && typeof values.cx !== 'number') return;
    if (!preview) {
      cur.s.preview.applyPixels(null, null);
      shown.current = '';
      setBusy(false);
      return;
    }
    const rect = filterRect(cur.s, id, values);
    const key = keyOf(values);
    if (!rect) {
      cur.s.preview.applyPixels(null, null);
      shown.current = key;
      return;
    }
    setBusy(true);
    void cur.runner.run({ id, values, rect, ctx: cur.s.ctx }).then((img) => {
      if (!img || session.current !== cur) return;
      cur.s.preview.applyPixels(img, rect);
      shown.current = key;
      setBusy(false);
    });
  }, [values, preview, ready, id, spec.center]);

  const ok = async () => {
    const cur = session.current;
    if (!cur) return;
    lastValues.set(id, values);
    const key = keyOf(values);
    if (shown.current !== key) {
      const rect = filterRect(cur.s, id, values);
      setBusy(true);
      const img = rect ? await cur.runner.run({ id, values, rect, ctx: cur.s.ctx }) : null;
      // Closed (Cancel / Esc) while computing: nothing to record.
      if (session.current !== cur) return;
      if (rect && !img) return;
      cur.s.preview.applyPixels(img, rect);
    }
    cur.s.preview.commit(spec.label);
    closeDialog();
  };

  const set = (patch: FilterValues) => setValues((v) => ({ ...v, ...patch }));
  const visible = spec.params.filter((p) => !p.show || p.show(values));

  return (
    <form
      className="modal filter-dialog"
      role="dialog"
      aria-label={spec.label}
      aria-busy={busy}
      onSubmit={(e) => {
        e.preventDefault();
        void ok();
      }}
    >
      <h2>{spec.label}</h2>
      <div className="filter-body">
        <div className="filter-params">
          {visible.map((p) => (
            <ParamRow key={p.key} param={p} value={values[p.key]} onChange={set} />
          ))}
          {spec.center && <p className="muted filter-hint">Press or drag on the canvas to move the centre (×).</p>}
        </div>
        <div className="filter-side">
          <button type="submit" className="btn primary" disabled={!ready}>
            OK
          </button>
          <button type="button" className="btn" onClick={closeDialog}>
            Cancel
          </button>
          <label className="check">
            <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} /> Preview
          </label>
          <span className={`filter-busy ${busy ? 'on' : ''}`} aria-hidden={!busy}>
            Working…
          </span>
        </div>
      </div>
    </form>
  );
}

function ParamRow({ param: p, value, onChange }: { param: FilterParam; value: FilterValues[string] | undefined; onChange: (patch: FilterValues) => void }) {
  const id = `filter-${p.key}`;
  if (p.kind === 'number') {
    const v = typeof value === 'number' ? value : p.default;
    const step = p.step ?? 1;
    const decimals = step < 1 ? Math.min(2, Math.ceil(-Math.log10(step))) : 0;
    const put = (n: number) => onChange({ [p.key]: Math.min(p.max, Math.max(p.min, Number(n.toFixed(decimals)))) });
    return (
      <div className="filter-row number">
        <label htmlFor={id}>{p.label}</label>
        <input
          id={id}
          className="filter-value"
          type="number"
          min={p.min}
          max={p.max}
          step={step}
          value={Number(v.toFixed(decimals))}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (e.target.value !== '' && Number.isFinite(n)) put(n);
          }}
        />
        <input className="filter-bar" type="range" aria-label={`${p.label} slider`} min={p.min} max={p.max} step={step} value={v} onChange={(e) => put(Number(e.target.value))} />
      </div>
    );
  }
  if (p.kind === 'select') {
    return (
      <div className="filter-row">
        <label htmlFor={id}>{p.label}</label>
        <select
          id={id}
          value={String(value ?? p.default)}
          onChange={(e) => {
            const next = e.target.value;
            // A preset sets the other values too (Retro film).
            onChange({ [p.key]: next, ...(p.presets?.[next] ?? {}) });
          }}
        >
          {p.options.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>
    );
  }
  if (p.kind === 'check') {
    return (
      <div className="filter-row">
        <label className="check">
          <input type="checkbox" checked={value === true} onChange={(e) => onChange({ [p.key]: e.target.checked })} /> {p.label}
        </label>
      </div>
    );
  }
  return (
    <div className="filter-row">
      <button type="button" className="btn" onClick={() => onChange({ [p.key]: Math.floor(Math.random() * 2 ** 31) })}>
        {p.label}
      </button>
    </div>
  );
}
