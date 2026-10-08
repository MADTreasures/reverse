/**
 * Tonal correction dialog, shared by Edit > Tonal correction (changes the layer's pixels),
 * Layer > New correction layer and the settings of an existing correction layer. Every change is
 * previewed on the canvas; OK records one undo step, Cancel restores everything.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { CurveEditor } from '../controls/CurveEditor';
import { findLayer } from '../../model/layers';
import type { Id } from '../../model/types';
import { GRADIENT_PRESETS, resolveStops, sampleGradient, type GradientStop } from '../../paint/gradient';
import {
  CHANNELS,
  correctionLabel,
  defaultCorrection,
  histogram,
  type Channel,
  type Correction,
  type CurvePoint,
  type Levels,
} from '../../paint/tonal';
import { ctx2d } from '../../engine/canvas';
import { engine } from '../../engine/engine';
import * as actions from '../../store/actions';
import { getState } from '../../store/store';
import { closeDialog, toast, type TonalTarget } from '../overlays';

/** One open dialog: how the preview is shown, committed and undone. */
interface Session {
  show(c: Correction | null): void;
  ok(c: Correction): void;
  cancel(): void;
  pixels: ImageData | null;
}

function startSession(target: TonalTarget, initial: Correction): Session | null {
  if (target.kind === 'pixels') {
    const p = new actions.FilterPreview();
    if (!p.ok) return null;
    return {
      show: (c) => p.applyCorrection(c),
      ok: () => p.commit(correctionLabel(target.type)),
      cancel: () => p.cancel(),
      pixels: p.pixels,
    };
  }
  // Layers correct the composite below them: its histogram is the guide.
  const composite = engine.composite();
  const pixels = ctx2d(composite, true).getImageData(0, 0, composite.width, composite.height);
  const preview = actions.beginDocPreview();
  const id: Id = target.kind === 'newLayer' ? actions.addCorrectionLayer(initial, true) : target.layerId;
  const label = target.kind === 'newLayer' ? 'New correction layer' : 'Correction layer settings';
  const setVisible = (visible: boolean) =>
    actions.previewDoc((doc) => {
      const l = findLayer(doc.layers, id);
      if (l) l.visible = visible;
    });
  const wasVisible = findLayer(getState().doc.layers, id)?.visible ?? true;
  return {
    show: (c) => {
      if (c) actions.previewCorrection(id, c);
      setVisible(c ? wasVisible : false);
    },
    ok: (c) => {
      actions.previewCorrection(id, c);
      setVisible(wasVisible);
      actions.commitDocPreview(preview, label);
    },
    cancel: () => actions.cancelDocPreview(preview),
    pixels,
  };
}

function initialCorrection(target: TonalTarget): Correction | null {
  if (target.kind !== 'layer') return defaultCorrection(target.type);
  const l = findLayer(getState().doc.layers, target.layerId);
  return l?.kind === 'correction' ? structuredClone(l.correction) : null;
}

export function TonalDialog({ target }: { target: TonalTarget }) {
  const initial = useMemo(() => initialCorrection(target), [target]);
  const [c, setC] = useState<Correction | null>(initial);
  const [preview, setPreview] = useState(true);
  const session = useRef<Session | null>(null);
  const done = useRef(false);
  const [pixels, setPixels] = useState<ImageData | null>(null);

  useEffect(() => {
    if (!initial) {
      closeDialog();
      return;
    }
    const s = startSession(target, initial);
    if (!s) {
      toast(actions.rasterOnlyBlocker() ?? 'Select a raster layer first', 'error');
      closeDialog();
      return;
    }
    session.current = s;
    setPixels(s.pixels);
    return () => {
      // Closing without OK (Esc, click outside) restores everything.
      if (!done.current) s.cancel();
      session.current = null;
    };
  }, [initial, target]);

  useEffect(() => {
    if (c) session.current?.show(preview ? c : null);
  }, [c, preview]);

  if (!c) return null;
  const title = correctionLabel(c.type);
  const ok = () => {
    done.current = true;
    session.current?.ok(c);
    closeDialog();
  };

  return (
    <form
      className="modal tonal"
      role="dialog"
      aria-label={title}
      onSubmit={(e) => {
        e.preventDefault();
        ok();
      }}
    >
      <h2>{title}</h2>
      <Controls c={c} onChange={setC} pixels={pixels} />
      <div className="modal-actions">
        <label className="check preview-toggle">
          <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} /> Preview
        </label>
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

function Controls({ c, onChange, pixels }: { c: Correction; onChange: (c: Correction) => void; pixels: ImageData | null }) {
  switch (c.type) {
    case 'brightnessContrast':
      return (
        <div className="form-grid">
          <SliderRow label="Brightness" min={-100} max={100} value={c.brightness} onChange={(v) => onChange({ ...c, brightness: v })} />
          <SliderRow label="Contrast" min={-100} max={100} value={c.contrast} onChange={(v) => onChange({ ...c, contrast: v })} />
        </div>
      );
    case 'hsl':
      return (
        <div className="form-grid">
          <SliderRow label="Hue" min={-180} max={180} value={c.hue} onChange={(v) => onChange({ ...c, hue: v })} />
          <SliderRow label="Saturation" min={-100} max={100} value={c.saturation} onChange={(v) => onChange({ ...c, saturation: v })} />
          <SliderRow label="Luminosity" min={-100} max={100} value={c.luminosity} onChange={(v) => onChange({ ...c, luminosity: v })} />
        </div>
      );
    case 'levels':
      return <LevelsControls c={c} onChange={onChange} pixels={pixels} />;
    case 'toneCurve':
      return <CurveControls c={c} onChange={onChange} pixels={pixels} />;
    case 'colorBalance':
      return <BalanceControls c={c} onChange={onChange} />;
    case 'posterize':
      return (
        <div className="form-grid">
          <SliderRow label="Levels" min={2} max={20} value={c.levels} onChange={(v) => onChange({ ...c, levels: v })} />
        </div>
      );
    case 'binarize':
      return (
        <div className="form-grid">
          <SliderRow label="Threshold" min={1} max={255} value={c.threshold} onChange={(v) => onChange({ ...c, threshold: v })} />
        </div>
      );
    case 'gradientMap':
      return <GradientMapControls c={c} onChange={onChange} />;
    case 'reverse':
      return <p className="muted">Reverse gradient has no settings.</p>;
  }
}

function SliderRow({ label, min, max, step = 1, value, onChange }: { label: string; min: number; max: number; step?: number; value: number; onChange: (v: number) => void }) {
  const id = `tonal-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <span className="with-unit">
        <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)));
          }}
        />
      </span>
    </>
  );
}

function ChannelSelect({ value, onChange }: { value: Channel; onChange: (c: Channel) => void }) {
  return (
    <>
      <label htmlFor="tonal-channel">Channel</label>
      <select id="tonal-channel" value={value} onChange={(e) => onChange(e.target.value as Channel)}>
        {CHANNELS.map((ch) => (
          <option key={ch.id} value={ch.id}>
            {ch.label}
          </option>
        ))}
      </select>
    </>
  );
}

/** Histogram as filled columns (log-scaled so small peaks stay visible). */
function Histogram({ pixels, channel, width = 256, height = 96 }: { pixels: ImageData | null; channel: Channel; width?: number; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const bins = useMemo(() => (pixels ? histogram(pixels.data, channel) : null), [pixels, channel]);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, width, height);
    if (!bins) return;
    const max = Math.log1p(Math.max(...bins));
    ctx.fillStyle = channel === 'r' ? '#e05555' : channel === 'g' ? '#55b055' : channel === 'b' ? '#5577e0' : '#9a9a9a';
    for (let i = 0; i < 256; i++) {
      const h = max > 0 ? (Math.log1p(bins[i]) / max) * height : 0;
      ctx.fillRect((i * width) / 256, height - h, Math.ceil(width / 256), h);
    }
  }, [bins, channel, width, height]);
  return <canvas ref={ref} className="histogram" width={width} height={height} />;
}

function LevelsControls({ c, onChange, pixels }: { c: Extract<Correction, { type: 'levels' }>; onChange: (c: Correction) => void; pixels: ImageData | null }) {
  const [channel, setChannel] = useState<Channel>('rgb');
  const l = c.levels[channel];
  const set = (patch: Partial<Levels>) => onChange({ ...c, levels: { ...c.levels, [channel]: { ...l, ...patch } } });
  return (
    <div className="form-grid">
      <ChannelSelect value={channel} onChange={setChannel} />
      <label />
      <Histogram pixels={pixels} channel={channel} />
      <SliderRow label="Shadows" min={0} max={254} value={l.inBlack} onChange={(v) => set({ inBlack: Math.min(v, l.inWhite - 1) })} />
      <SliderRow label="Midtones" min={0.1} max={9.99} step={0.01} value={l.gamma} onChange={(v) => set({ gamma: v })} />
      <SliderRow label="Highlights" min={1} max={255} value={l.inWhite} onChange={(v) => set({ inWhite: Math.max(v, l.inBlack + 1) })} />
      <SliderRow label="Shadows output" min={0} max={255} value={l.outBlack} onChange={(v) => set({ outBlack: v })} />
      <SliderRow label="Highlights output" min={0} max={255} value={l.outWhite} onChange={(v) => set({ outWhite: v })} />
    </div>
  );
}

/** Tone curve graph over the histogram: click to add a point, drag to move, drag out of the graph to delete. */
function CurveControls({ c, onChange, pixels }: { c: Extract<Correction, { type: 'toneCurve' }>; onChange: (c: Correction) => void; pixels: ImageData | null }) {
  const [channel, setChannel] = useState<Channel>('rgb');
  return (
    <div className="form-grid">
      <ChannelSelect value={channel} onChange={setChannel} />
      <label />
      <CurveEditor
        label="Tone curve"
        testId="tone-curve"
        max={255}
        size={256}
        points={c.curves[channel]}
        onChange={(pts: CurvePoint[]) => onChange({ ...c, curves: { ...c.curves, [channel]: pts } })}
        background={<Histogram pixels={pixels} channel={channel} width={256} height={256} />}
      />
      <label />
      <span className="muted">Click to add a point · drag a point out of the graph to delete it</span>
    </div>
  );
}

const RANGES = [
  { key: 'shadows', label: 'Shadows' },
  { key: 'midtones', label: 'Midtones' },
  { key: 'highlights', label: 'Highlights' },
] as const;

function BalanceControls({ c, onChange }: { c: Extract<Correction, { type: 'colorBalance' }>; onChange: (c: Correction) => void }) {
  const [range, setRange] = useState<'shadows' | 'midtones' | 'highlights'>('midtones');
  const v = c[range];
  const set = (i: number, value: number) => onChange({ ...c, [range]: v.map((x, k) => (k === i ? value : x)) as typeof v });
  return (
    <div className="form-grid">
      <label>Range</label>
      <span className="segmented">
        {RANGES.map((r) => (
          <button key={r.key} type="button" className={range === r.key ? 'on' : ''} onClick={() => setRange(r.key)}>
            {r.label}
          </button>
        ))}
      </span>
      <SliderRow label="Cyan – Red" min={-100} max={100} value={v[0]} onChange={(x) => set(0, x)} />
      <SliderRow label="Magenta – Green" min={-100} max={100} value={v[1]} onChange={(x) => set(1, x)} />
      <SliderRow label="Yellow – Blue" min={-100} max={100} value={v[2]} onChange={(x) => set(2, x)} />
      <label />
      <label className="check">
        <input type="checkbox" checked={c.preserveLuminosity} onChange={(e) => onChange({ ...c, preserveLuminosity: e.target.checked })} /> Keep brightness
      </label>
    </div>
  );
}

function GradientMapControls({ c, onChange }: { c: Extract<Correction, { type: 'gradientMap' }>; onChange: (c: Correction) => void }) {
  const colors = getState().colors;
  return (
    <div className="form-grid">
      <label htmlFor="tonal-preset">Gradient</label>
      <select
        id="tonal-preset"
        value=""
        onChange={(e) => {
          const preset = GRADIENT_PRESETS.find((p) => p.name === e.target.value);
          if (preset) onChange({ ...c, stops: resolveStops(preset.stops, colors.main, colors.sub) });
        }}
      >
        <option value="">Choose a preset…</option>
        {GRADIENT_PRESETS.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
          </option>
        ))}
      </select>
      <label />
      <GradientBar stops={c.stops} onChange={(stops) => onChange({ ...c, stops })} />
    </div>
  );
}

/**
 * Gradient nodes on a colour bar: drag a node sideways to move it, down out of the bar to delete
 * it, click below the bar to add one. The selected node's colour, opacity and position are editable.
 */
export function GradientBar({ stops, onChange }: { stops: GradientStop[]; onChange: (s: GradientStop[]) => void }) {
  const [selected, setSelected] = useState(0);
  const bar = useRef<HTMLDivElement>(null);
  const sel = stops[Math.min(selected, stops.length - 1)];
  const css = `linear-gradient(to right, ${[...stops]
    .sort((a, b) => a.pos - b.pos)
    .map((s) => {
      const [r, g, b, a] = sampleGradient([s], 0);
      return `rgba(${r},${g},${b},${a}) ${(s.pos * 100).toFixed(1)}%`;
    })
    .join(', ')})`;

  const posAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };

  const drag = (index: number, list: GradientStop[]) => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSelected(index);
    const startY = e.clientY;
    const move = (ev: PointerEvent) => {
      const next = list.map((s) => ({ ...s }));
      if (ev.clientY - startY > 40 && next.length > 2) {
        next.splice(index, 1);
        setSelected(0);
      } else next[index].pos = Number(posAt(ev.clientX).toFixed(3));
      onChange(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const add = (e: ReactPointerEvent) => {
    const pos = Number(posAt(e.clientX).toFixed(3));
    const [r, g, b, a] = sampleGradient(stops, pos);
    const hex = `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
    const next = [...stops, { pos, color: hex, opacity: Number(a.toFixed(2)) }];
    onChange(next);
    setSelected(next.length - 1);
  };

  return (
    <div className="gradient-editor">
      <div className="gradient-bar" ref={bar} style={{ backgroundImage: `${css}, conic-gradient(#ccc 0 25%, #fff 0 50%, #ccc 0 75%, #fff 0)` }} />
      <div className="gradient-nodes" onPointerDown={add} title="Click to add a node">
        {stops.map((s, i) => (
          <span
            key={i}
            className={`gradient-node ${s === sel ? 'on' : ''}`}
            style={{ left: `${s.pos * 100}%`, background: s.color.startsWith('#') ? s.color : '#888' }}
            onPointerDown={drag(i, stops)}
            data-testid="gradient-node"
          />
        ))}
      </div>
      {sel && (
        <div className="gradient-node-props">
          <label>
            Color{' '}
            <input
              type="color"
              value={sel.color.startsWith('#') ? sel.color : '#000000'}
              onChange={(e) => onChange(stops.map((s) => (s === sel ? { ...s, color: e.target.value } : s)))}
            />
          </label>
          <label>
            Opacity{' '}
            <input
              type="number"
              min={0}
              max={100}
              value={Math.round(sel.opacity * 100)}
              onChange={(e) => onChange(stops.map((s) => (s === sel ? { ...s, opacity: Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100 } : s)))}
            />
            %
          </label>
          <label>
            Position{' '}
            <input
              type="number"
              min={0}
              max={100}
              value={Math.round(sel.pos * 100)}
              onChange={(e) => onChange(stops.map((s) => (s === sel ? { ...s, pos: Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100 } : s)))}
            />
            %
          </label>
          <button type="button" className="btn" onClick={() => onChange(stops.map((s) => ({ ...s, pos: 1 - s.pos })))}>
            Reverse
          </button>
        </div>
      )}
    </div>
  );
}
