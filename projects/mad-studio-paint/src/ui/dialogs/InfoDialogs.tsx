import { isMac } from '../../platform/platform';
import { TOOLS } from '../../paint/tools';
import { COMMANDS, commandShortcuts, toolShortcuts } from '../commands';
import { formatShortcut } from '../shortcuts';
import { closeDialog } from '../overlays';

export function AboutDialog() {
  return (
    <div className="modal small" role="dialog" aria-label="About">
      <h2>MAD Studio Paint</h2>
      <p>Version 0.1 · a layer-based painting and illustration app for macOS and the browser.</p>
      <p className="muted">
        Independent clean-room project by MADTreasures. Workflow modelled on the public documentation of professional illustration software; no code, assets or file
        formats of other products are used.
      </p>
      <div className="modal-actions">
        <button className="btn primary" autoFocus onClick={closeDialog}>
          OK
        </button>
      </div>
    </div>
  );
}

const MOD = isMac ? '⌘' : 'Ctrl';
const ALT = isMac ? '⌥' : 'Alt';

const MODIFIERS: [string, string][] = [
  ['Space + drag', 'Hand (scroll the canvas)'],
  ['Shift + Space + drag', 'Rotate the view (double-click resets)'],
  [`Space, then ${MOD} + click`, 'Zoom in'],
  [`${ALT} + Space + click`, 'Zoom out'],
  ['Mouse wheel / pinch', 'Zoom · Shift + wheel rotates'],
  [`${ALT} + click (drawing tools)`, 'Eyedropper'],
  ['Right click', 'Eyedropper'],
  [`${MOD}${ALT} + drag (brushes)`, 'Change brush size'],
  ['Shift + drag (brushes)', 'Straight line'],
  ['Shift + click (brushes)', 'Straight line from the end of the last stroke'],
  [`${MOD}⇧ + click`, 'Select the layer under the pointer'],
  [`Shift / ${ALT} / Shift${ALT} + drag (selection)`, 'Add / delete / select from current'],
  ['Shift during a rectangle / ellipse', 'Square / circle'],
  ['Shift + click (fill)', 'Switch "refer multiple" for this click'],
  [`${ALT} + drag (move layer)`, 'Keep the original (copy)'],
  ['Shift + drag (move layer / transform)', 'Fix the direction · 45° steps'],
  ['Enter / Esc / double-click (transform)', 'Confirm / cancel / confirm'],
  [`${ALT} + click on an eye (layer palette)`, 'Show only this layer (again: show all)'],
  [`${MOD} + click on a thumbnail`, 'Selection from the layer (+ Shift: add)'],
  [`${ALT} + drag a layer`, 'Duplicate the layer'],
  ['Hold a tool key', 'Switch tools only while the key is held'],
];

export function ShortcutsDialog() {
  // The shortcuts as set in Shortcut Settings.
  const commands = COMMANDS.filter((c) => commandShortcuts(c.id).length);
  return (
    <div className="modal wide" role="dialog" aria-label="Keyboard shortcuts">
      <h2>Keyboard shortcuts</h2>
      <div className="shortcut-columns">
        <section>
          <h3>Tools</h3>
          <table>
            <tbody>
              {TOOLS.filter((t) => toolShortcuts(t.id).length).map((t) => (
                <tr key={t.id}>
                  <td className="kbd">{toolShortcuts(t.id).map((k) => formatShortcut(k, isMac)).join('  ')}</td>
                  <td>{t.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>While drawing</h3>
          <table>
            <tbody>
              {MODIFIERS.map(([k, v]) => (
                <tr key={k}>
                  <td className="kbd">{k}</td>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section>
          <h3>Commands</h3>
          <table>
            <tbody>
              {commands.map((c) => (
                <tr key={c.id}>
                  <td className="kbd">{commandShortcuts(c.id).map((k) => formatShortcut(k, isMac)).join('  ')}</td>
                  <td>{c.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
      <div className="modal-actions">
        <button className="btn primary" autoFocus onClick={closeDialog}>
          Close
        </button>
      </div>
    </div>
  );
}
