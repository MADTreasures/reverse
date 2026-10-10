import { SHORTCUTS, type CommandId } from '../commands';
import { closeDialog } from '../overlays';
import { isMac, native } from '../../platform/platform';
import { AsioLogo, VstLogo } from '../brand/SteinbergLogos';

const mod = isMac ? '⌘' : 'Ctrl';

// The defaults follow FL Studio's keyboard shortcuts (Ctrl is ⌘ on the Mac).
const COMMAND_LABELS: [CommandId, string][] = [
  ['playPause', 'Play / stop'],
  ['pause', 'Play / pause'],
  ['toggleMode', 'Pattern / song mode'],
  ['record', 'Record'],
  ['precount', 'Recording precount'],
  ['metronome', 'Metronome'],
  ['panic', 'Stop all sound'],
  ['gotoStart', 'Song position to start'],
  ['window:playlist', 'Playlist'],
  ['window:channelRack', 'Channel rack'],
  ['window:pianoRoll', 'Piano roll'],
  ['pluginPicker', 'Plugin picker / manager'],
  ['toggleBrowser', 'Browser'],
  ['window:mixer', 'Mixer'],
  ['closeAllWindows', 'Close all windows'],
  ['togglePlaylistMax', 'Maximize / restore playlist'],
  ['prevPattern', 'Previous pattern'],
  ['nextPattern', 'Next pattern'],
  ['newPattern', 'New pattern'],
  ['newPatternNamed', 'New pattern with name'],
  ['renamePattern', 'Rename pattern'],
  ['typingKeyboard', 'Typing keyboard to piano'],
  ['undo', 'Undo (step by step)'],
  ['redo', 'Redo'],
  ['open', 'Open project'],
  ['save', 'Save'],
  ['saveAs', 'Save as'],
  ['saveNewVersion', 'Save new version'],
  ['export', 'Export wave file'],
];

const EDITOR_SHORTCUTS: [string, string][] = [
  ['Click / drag', 'Draw and move notes or clips'],
  ['Click a note', 'Its length, velocity and properties become the default for new notes'],
  ['Right-click / drag', 'Delete (notes, clips, steps)'],
  ['Double-click a note', 'Note properties'],
  ['Double-click a pattern clip', 'Open it in the piano roll'],
  ['Click the icon in a clip title', 'Clip menu (mute, source pattern, make unique …)'],
  ['Right-click a control', 'Reset, automation clip, type value'],
  [`${mod}+drag · Shift+drag a control`, 'Fine · coarse adjustment'],
  ['Right-click in an automation clip', 'Add point · on a point: curve mode'],
  ['Drag the small circle', 'Bend an automation segment'],
  [`${mod}+drag · ${mod}+Shift+drag`, 'Rectangle selection · add to selection'],
  [`${mod}+click · ${mod}+Shift+click`, 'Select one · add to selection'],
  ['Shift+drag', 'Clone notes or clips'],
  ['Alt/⌥ while dragging', 'Disable snap'],
  ['P · B · D · T · C · E', 'Draw · paint · delete · mute · slice · select tool'],
  [`${mod}+A / ${mod}+D`, 'Select all / deselect'],
  [`${mod}+C / ${mod}+X / ${mod}+V`, 'Copy / cut / paste'],
  [`${mod}+B`, 'Duplicate selection'],
  ['Delete / Backspace', 'Delete selection'],
  [`Shift+↑ ↓ · ${mod}+↑ ↓`, 'Transpose selected notes by a semitone · an octave'],
  ['Shift+← →', 'Move selected notes'],
  ['← → ↑ ↓ (piano roll)', 'Scroll'],
  [`${mod}+L (piano roll)`, 'Quick legato'],
  [`Q · Shift+Q · ${mod}+Q`, 'Quick quantize start times · starts and ends'],
  [`${mod}+U · ${mod}+G`, 'Quick chop · glue'],
  ['Alt+Q · Alt+U · Alt+L', 'Quantize… · chop… · articulate…'],
  ['Alt+A · Alt+S · Alt+F · Alt+W', 'Arpeggiate · strum · flam · claw machine'],
  ['Alt+K · Alt+Y · Alt+R · Alt+X · Alt+O', 'Limit · flip · randomize · scale levels · LFO'],
  ['Alt+P · Alt+E', 'Generate chord progression · riff machine'],
  ['Right-drag in the event lane', 'Reset the note property under the mouse'],
  ['Click the ruler', 'Set the playback position (piano roll: inside the pattern)'],
  ['Right-drag in the playlist ruler', 'Select a time range – song playback loops in it'],
  [`${mod}+D (playlist)`, 'Deselect clips and the time range'],
  ['1 … 0 · Ctrl+1 … 0', 'Mute · solo channels 1–10'],
  ['↑ ↓ · Alt+↑ ↓ (channel rack)', 'Select · move channel'],
  ['Alt+C · Alt+Del (channel rack)', 'Clone · delete channel'],
  [`${mod}+L (channel rack)`, 'Route to a free mixer track'],
  ['Esc', 'Deselect, or close the focused window'],
  [`${mod}+wheel / pinch`, 'Zoom horizontally'],
  ['Shift+wheel', 'Scroll horizontally'],
  ['Alt+wheel', 'Velocity (piano roll notes, channel rack steps) · track height (playlist)'],
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
  // ASIO drivers are a Windows-only part of the native engine.
  const asio = native?.platform === 'win32';
  return (
    <div className="modal" role="dialog" aria-label="About MAD Studio">
      <h2>
        MAD<span className="accent">STUDIO</span> <span className="dim">0.1</span>
      </h2>
      <p>
        Pattern-based music studio: channel rack with step sequencer, piano roll, playlist arrangement, automation clips,
        mixer with insert effects and audio recording, synthesizer, sampler and WAV export. The desktop app hosts VST®3
        and Audio Unit plug-ins through its native engine{asio ? ' and plays through ASIO® audio interfaces' : ''}.
      </p>
      <p className="dim">
        Independent project inspired by the workflow of classic pattern-based DAWs. All sounds and graphics are original;
        no third-party samples are included – the drum kit is synthesised on start-up. The native engine is built with
        JUCE (AGPLv3) and the VST3 SDK (MIT){asio ? ', with the ASIO SDK headers (GPLv3)' : ''}.
      </p>
      <div className="brand-logos">
        <VstLogo />
        {asio && <AsioLogo />}
      </div>
      <div className="modal-actions">
        <button className="btn primary" onClick={closeDialog}>
          Close
        </button>
      </div>
    </div>
  );
}
