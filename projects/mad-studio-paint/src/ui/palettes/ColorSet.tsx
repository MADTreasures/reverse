import { useState } from 'react';
import { hexToRgb } from '../../model/color';
import * as actions from '../../store/actions';
import { drawingColor, useStore } from '../../store/store';
import { Icon } from '../controls/Icons';

/** Own default colour set: greys, a hue row, muted tones, skin and earth tones. */
export const DEFAULT_COLOR_SET: string[] = [
  '#000000', '#ffffff', '#262626', '#4d4d4d', '#737373', '#999999', '#bfbfbf', '#e6e6e6',
  '#e53935', '#fb8c00', '#fdd835', '#43a047', '#00acc1', '#1e88e5', '#5e35b1', '#d81b60',
  '#ef9a9a', '#ffcc80', '#fff59d', '#a5d6a7', '#80deea', '#90caf9', '#b39ddb', '#f48fb1',
  '#8e2b2b', '#8a4b12', '#7d6b12', '#245c27', '#0d5c66', '#163e7a', '#3b2373', '#7a1a45',
  '#fde3d0', '#f6c9a8', '#e8a87c', '#c98a5f', '#a0663f', '#7a4a2a', '#53321d', '#2e1c11',
];

const STORAGE_KEY = 'mad-paint:colorset';

function loadSet(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(v) && v.every((c) => typeof c === 'string' && hexToRgb(c))) return v as string[];
  } catch {
    // Ignore.
  }
  return DEFAULT_COLOR_SET;
}

/** A grid of saved colours: click to use, add the current colour, delete or replace the selected one. */
export function ColorSet() {
  const [set, setSet] = useState<string[]>(loadSet);
  const [selected, setSelected] = useState<number | null>(null);
  const current = useStore((s) => drawingColor(s.colors));
  const save = (next: string[]) => {
    setSet(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore.
    }
  };
  const rgb = hexToRgb(selected !== null ? set[selected] : current)!;
  return (
    <div className="color-set" data-testid="color-set">
      <div className="color-set-grid">
        {set.map((c, i) => (
          <button
            key={i}
            className={`swatch ${selected === i ? 'selected' : ''}`}
            style={{ background: c }}
            title={c}
            aria-label={c}
            onClick={() => {
              setSelected(i);
              actions.setDrawingColor(c);
            }}
          />
        ))}
      </div>
      <div className="color-set-footer">
        <span className="rgb-readout">
          <i style={{ background: '#d33' }} />
          {rgb.r} <i style={{ background: '#3a3' }} />
          {rgb.g} <i style={{ background: '#36d' }} />
          {rgb.b}
        </span>
        <span className="spacer" />
        <button className="icon-btn" title="Replace the selected color with the drawing color" aria-label="Replace color" disabled={selected === null} onClick={() => selected !== null && save(set.map((c, i) => (i === selected ? current : c)))}>
          <Icon name="swap" size={14} />
        </button>
        <button className="icon-btn" title="Add the drawing color" aria-label="Add color" onClick={() => save([...set, current])}>
          <Icon name="newLayer" size={14} />
        </button>
        <button
          className="icon-btn"
          title="Delete the selected color"
          aria-label="Delete color"
          disabled={selected === null}
          onClick={() => {
            if (selected === null) return;
            save(set.filter((_, i) => i !== selected));
            setSelected(null);
          }}
        >
          <Icon name="trash" size={14} />
        </button>
      </div>
    </div>
  );
}
