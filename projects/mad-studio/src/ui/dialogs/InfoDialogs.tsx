import { SHORTCUTS, type CommandId } from '../commands';
import { closeDialog } from '../overlays';
import { isMac } from '../../platform/platform';

const mod = isMac ? '⌘' : 'Ctrl';

const COMMAND_LABELS: [CommandId, string][] = [
  ['playPause', 'Play / pause'],
  ['toggleMode', 'Pattern / song mode'],
  ['record', 'Record'],
  ['metronome', 'Metronome'],
  ['window:playlist', 'Playlist'],
  ['window:channelRack', 'Channel rack'],
  ['window:pianoRoll', 'Piano roll'],
  ['toggleBrowser', 'Browser'],
  ['window:mixer', 'Mixer'],
  ['prevPattern', 'Previous pattern'],
  ['nextPattern', 'Next pattern'],
  ['newPattern', 'New pattern'],
  ['typingKeyboard', 'Typing keyboard to piano'],
  ['undo', 'Undo'],
  ['redo', 'Redo'],
  ['new', 'New project'],
  ['open', 'Open project'],
  ['save', 'Save'],
  ['saveAs', 'Save as'],
  ['export', 'Export WAV'],
];

const EDITOR_SHORTCUTS: [string, string][] = [
  ['Click / drag', 'Draw and move notes or clips'],
  ['Right-click / drag', 'Delete'],
  [`${mod}+drag`, 'Rectangle selection'],
  ['Shift+drag (playlist)', 'Duplicate clip'],
  ['Alt/⌥ while dragging', 'Disable snap'],
  [`${mod}+A / ${mod}+C / ${mod}+V`, 'Select all / copy / paste'],
  [`${mod}+B`, 'Duplicate selection'],
  ['Delete / Backspace', 'Delete selection'],
  ['↑ ↓ (Shift: octave)', 'Transpose selected notes'],
  ['Q', 'Quantize selection'],
  [`${mod}+wheel / pinch`, 'Zoom horizontally'],
  ['Shift+wheel', 'Scroll horizontally'],
  ['Z S X D C … / Q 2 W 3 E …', 'Typing keyboard (when enabled)'],
];

export function ShortcutsDialog() {
  return (
    <div className="modal wide" role="dialog" aria-label="Keyboard shortcuts">
      <h2>Keyboard shortcuts</h2>
      <div className="shortcut-columns">
        <table className="shortcut-table">
          <tbody>
            {COMMAND_LABELS.map(([id, label]) => (
              <tr key={id}>
                <td>{label}</td>
                <td>
                  <kbd>{SHORTCUTS[id]}</kbd>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="shortcut-table">
          <tbody>
            {EDITOR_SHORTCUTS.map(([keys, label]) => (
              <tr key={keys}>
                <td>{label}</td>
                <td>
                  <kbd>{keys}</kbd>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="modal-actions">
        <button className="btn primary" onClick={closeDialog}>
          Close
        </button>
      </div>
    </div>
  );
}

export function AboutDialog() {
  return (
    <div className="modal" role="dialog" aria-label="About MAD Studio">
      <h2>
        MAD<span className="accent">STUDIO</span> <span className="dim">0.1</span>
      </h2>
      <p>
        Pattern-based music studio: channel rack with step sequencer, piano roll, playlist arrangement, mixer with insert
        effects, synthesizer, sampler and WAV export.
      </p>
      <p className="dim">
        Independent project inspired by the workflow of classic pattern-based DAWs. All code, sounds and graphics are
        original; no third-party samples are included – the drum kit is synthesised on start-up.
      </p>
      <div className="modal-actions">
        <button className="btn primary" onClick={closeDialog}>
          Close
        </button>
      </div>
    </div>
  );
}
