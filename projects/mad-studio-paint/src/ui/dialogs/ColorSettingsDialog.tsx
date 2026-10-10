/**
 * Color settings: the reference's colour dialog (new fill layers, a fill layer's colour): a hue
 * ring with its saturation/brightness square, RGB and hex values, and the current and new colour.
 */
import { useState } from 'react';
import { hexToRgb, rgbToHex } from '../../model/color';
import { closeDialog, openDialog } from '../overlays';
import { ColorWheel } from '../palettes/ColorWheel';

let request: { title: string; color: string; done: (hex: string) => void } | null = null;

/** Opens Color settings with a colour; `done` gets the chosen one (not called on Cancel). */
export function openColorSettings(color: string, done: (hex: string) => void, title = 'Color settings'): void {
  request = { title, color: color.toLowerCase(), done };
  openDialog('colorSettings');
}

export function ColorSettingsDialog() {
  const r = request;
  const [hex, setHex] = useState(r?.color ?? '#000000');
  const [text, setText] = useState(hex);
  if (!r) return null;
  const rgb = hexToRgb(hex) ?? { r: 0, g: 0, b: 0 };
  const set = (h: string) => {
    setHex(h);
    setText(h);
  };
  const channel = (k: 'r' | 'g' | 'b', label: string) => (
    <>
      <label htmlFor={`cs-${k}`}>{label}</label>
      <input
        id={`cs-${k}`}
        type="number"
        min={0}
        max={255}
        value={rgb[k]}
        onChange={(e) => {
          const v = Math.max(0, Math.min(255, Math.round(Number(e.target.value)) || 0));
          set(rgbToHex({ ...rgb, [k]: v }));
        }}
      />
    </>
  );
  return (
    <form
      className="modal small color-settings"
      role="dialog"
      aria-label={r.title}
      onSubmit={(e) => {
        e.preventDefault();
        request = null;
        closeDialog();
        r.done(hex);
      }}
    >
      <h2>{r.title}</h2>
      <div className="color-settings-body">
        <ColorWheel size={180} value={hex} onChange={set} />
        <div className="form-grid">
          <label>Color</label>
          <span className="color-compare" data-testid="color-compare">
            <span style={{ background: r.color }} title="Current color" />
            <span style={{ background: hex }} title="New color" />
          </span>
          {channel('r', 'R')}
          {channel('g', 'G')}
          {channel('b', 'B')}
          <label htmlFor="cs-hex">Hex</label>
          <input
            id="cs-hex"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              const v = e.target.value.trim().toLowerCase();
              if (/^#?[0-9a-f]{6}$/.test(v)) setHex(v.startsWith('#') ? v : `#${v}`);
            }}
          />
        </div>
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
