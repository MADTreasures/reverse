/**
 * Edit gradient (Advanced settings of the gradient tool or a gradient layer): the gradient bar and
 * a gradient list – the app's own presets and the user's gradient set (kept in this browser /
 * app), which can be loaded, replaced, duplicated, added to and deleted.
 */
import { useState } from 'react';
import { GRADIENT_PRESETS, resolveStops, sanitizeGradientStops, sampleGradient, type GradientStop } from '../../paint/gradient';
import * as actions from '../../store/actions';
import { currentSubTool, getState } from '../../store/store';
import { GradientBar } from '../controls/GradientBar';
import { closeDialog } from '../overlays';

const SET_KEY = 'mad-paint:gradients';

interface NamedGradient {
  name: string;
  stops: GradientStop[];
}

function loadSet(): NamedGradient[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SET_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 200).flatMap((g): NamedGradient[] => {
      const r = (g && typeof g === 'object' ? g : {}) as Record<string, unknown>;
      const stops = sanitizeGradientStops(r.stops);
      return stops ? [{ name: typeof r.name === 'string' ? r.name.slice(0, 60) : 'Gradient', stops }] : [];
    });
  } catch {
    return [];
  }
}

function saveSet(list: NamedGradient[]): void {
  try {
    localStorage.setItem(SET_KEY, JSON.stringify(list));
  } catch {
    // Storage can be unavailable (private mode); the list then lasts for this session.
  }
}

/** What the dialog edits: the selected gradient layer, or the current gradient sub tool. */
function target(): { layerId: string; stops: GradientStop[] } | { subId: string; stops: GradientStop[] } | null {
  const s = getState();
  const l = actions.activeLayer(s);
  if (l?.kind === 'gradient' && (s.tool === 'gradient' || s.tool === 'object')) return { layerId: l.id, stops: l.gradient.stops };
  const sub = currentSubTool(s, 'gradient');
  return sub.gradient ? { subId: sub.id, stops: sub.gradient.stops } : null;
}

const css = (stops: GradientStop[], main: string, sub: string) =>
  `linear-gradient(to right, ${resolveStops(stops, main, sub)
    .map((s) => {
      const [r, g, b, a] = sampleGradient([s], 0);
      return `rgba(${r},${g},${b},${a}) ${(s.pos * 100).toFixed(1)}%`;
    })
    .join(', ')}), conic-gradient(#ccc 0 25%, #fff 0 50%, #ccc 0 75%, #fff 0)`;

export function GradientDialog() {
  const [initial] = useState(target);
  const [stops, setStops] = useState<GradientStop[]>(() => initial?.stops ?? []);
  const [mine, setMine] = useState<NamedGradient[]>(loadSet);
  const [picked, setPicked] = useState<{ own: boolean; index: number } | null>(null);
  const { main, sub } = getState().colors;
  const list: (NamedGradient & { own: boolean; index: number })[] = [
    ...GRADIENT_PRESETS.map((g, index) => ({ ...g, own: false, index })),
    ...mine.map((g, index) => ({ ...g, own: true, index })),
  ];
  const update = (next: NamedGradient[]) => {
    setMine(next);
    saveSet(next);
  };
  const chosen = picked ? (picked.own ? mine[picked.index] : GRADIENT_PRESETS[picked.index]) : null;
  if (!initial) return null;
  return (
    <form
      className="modal gradient-dialog"
      role="dialog"
      aria-label="Edit gradient"
      onSubmit={(e) => {
        e.preventDefault();
        if ('layerId' in initial) actions.setGradientFill(initial.layerId, { stops: resolveStops(stops, main, sub) }, 'Edit gradient');
        else {
          const s = currentSubTool(getState(), 'gradient');
          if (s.gradient) actions.updateSubTool(initial.subId, { gradient: { ...s.gradient, stops } });
        }
        closeDialog();
      }}
    >
      <h2>Edit gradient</h2>
      <GradientBar stops={stops} onChange={setStops} main={main} sub={sub} />
      <div className="gradient-list" role="listbox" aria-label="Gradient list">
        {list.map((g) => (
          <button
            type="button"
            key={`${g.own}-${g.index}`}
            role="option"
            aria-selected={picked?.own === g.own && picked.index === g.index}
            className={`gradient-item ${picked?.own === g.own && picked.index === g.index ? 'on' : ''}`}
            onClick={() => setPicked({ own: g.own, index: g.index })}
            onDoubleClick={() => setStops(g.stops.map((s) => ({ ...s })))}
          >
            <span className="gradient-swatch" style={{ backgroundImage: css(g.stops, main, sub) }} />
            <span>{g.name}</span>
          </button>
        ))}
      </div>
      <div className="gradient-list-actions">
        <button type="button" className="btn small" disabled={!chosen} onClick={() => chosen && setStops(chosen.stops.map((s) => ({ ...s })))}>
          Load to gradient bar
        </button>
        <button type="button" className="btn small" disabled={!picked?.own} onClick={() => picked?.own && update(mine.map((g, i) => (i === picked.index ? { ...g, stops } : g)))}>
          Replace saved gradient
        </button>
        <button type="button" className="btn small" disabled={!chosen} onClick={() => chosen && update([...mine, { name: `${chosen.name} copy`, stops: chosen.stops }])}>
          Duplicate
        </button>
        <button type="button" className="btn small" onClick={() => update([...mine, { name: `Gradient ${mine.length + 1}`, stops }])}>
          Create new gradient
        </button>
        <button
          type="button"
          className="btn small"
          disabled={!picked?.own}
          onClick={() => {
            if (!picked?.own) return;
            update(mine.filter((_, i) => i !== picked.index));
            setPicked(null);
          }}
        >
          Delete
        </button>
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
