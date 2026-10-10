import { useStore } from '../store/store';
import { muteChannelByIndex, runCommand, type CommandId } from './commands';
import { liveNoteOff, liveNoteOn } from './liveInput';
import { closeDialog, closeMenu, useOverlays } from './overlays';
import { windowHandlers } from './windowKeys';
import { closeWindow } from './workspace/windows';

/** Physical key → semitone offset (layout independent, so QWERTZ works too). */
const TYPING_KEYS: Record<string, number> = {
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
  Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21,
  Digit7: 22, KeyU: 23, KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28,
};
const TYPING_BASE = 48; // C4 in this app's naming = MIDI 48

export { registerWindowKeys } from './windowKeys';

export function isTextInput(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

const held = new Map<string, number>();

function releaseAll(): void {
  for (const handle of held.values()) liveNoteOff(handle);
  held.clear();
}

/** Global shortcuts, following FL Studio's defaults (Ctrl = Cmd on the Mac). */
function shortcutFor(e: KeyboardEvent): CommandId | null {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.shiftKey && !e.altKey) {
    // FL Studio's pattern list shortcuts.
    switch (e.code) {
      case 'KeyC':
        return 'clonePattern';
      case 'Delete':
      case 'Backspace':
        return 'deletePattern';
      case 'Insert':
        return 'insertPattern';
      case 'ArrowUp':
        return 'movePatternUp';
      case 'ArrowDown':
        return 'movePatternDown';
    }
  }
  if (mod) {
    switch (e.code) {
      case 'KeyZ':
        // FL Studio 26: Ctrl+Z undoes step by step, Ctrl+Alt+Z redoes (Ctrl+Shift+Z / Ctrl+Y too).
        return e.altKey || e.shiftKey ? 'redo' : 'undo';
      case 'KeyY':
        return 'redo';
      case 'KeyS':
        return e.shiftKey ? 'saveAs' : 'save';
      case 'KeyO':
        return 'open';
      case 'KeyN':
        return 'saveNewVersion';
      case 'KeyR':
        return 'export';
      case 'KeyT':
        return 'typingKeyboard';
      case 'KeyM':
        return 'metronome';
      case 'KeyP':
        return 'precount';
      case 'KeyH':
        return 'panic';
      case 'Space':
        return 'pause';
      case 'F4':
        return 'newPattern';
      case 'F12':
        return 'closeUnfocusedWindows';
      case 'KeyI':
        return 'startOnInput';
      default:
        return null;
    }
  }
  if (e.altKey) return e.code === 'F8' ? 'toggleBrowser' : e.code === 'F12' ? 'closePluginWindows' : null;
  if (e.shiftKey && e.code === 'F4') return 'findFirstEmptyPattern';
  switch (e.code) {
    case 'Space':
      return 'playPause';
    case 'KeyL':
      return 'toggleMode';
    case 'KeyR':
      return 'record';
    case 'Home':
      return 'gotoStart';
    case 'Enter':
    case 'NumpadEnter':
      return 'togglePlaylistMax';
    case 'F1':
      return 'shortcuts';
    case 'F2':
      return 'renamePattern';
    case 'F4':
      return 'newPatternNamed';
    case 'F5':
      return 'window:playlist';
    case 'F6':
      return 'window:channelRack';
    case 'F7':
      return 'window:pianoRoll';
    case 'F8':
      return 'pluginPicker';
    case 'F9':
      return 'window:mixer';
    case 'F12':
      return 'closeAllWindows';
    case 'BracketLeft':
    case 'NumpadSubtract':
    case 'Minus':
      return 'prevPattern';
    case 'BracketRight':
    case 'NumpadAdd':
    case 'Equal':
      return 'nextPattern';
    default:
      return null;
  }
}

/** FL Studio: 1–0 mute the first ten channels, Ctrl+1–0 solo them (typing keyboard off). */
function channelDigit(e: KeyboardEvent): number | null {
  const m = /^Digit(\d)$/.exec(e.code);
  if (!m || e.altKey || e.shiftKey) return null;
  const d = Number(m[1]);
  return d === 0 ? 9 : d - 1;
}

function onKeyDown(e: KeyboardEvent): void {
  const overlays = useOverlays.getState();
  if (e.key === 'Escape') {
    if (overlays.menu) closeMenu();
    else if (overlays.dialog) closeDialog();
    else if (!isTextInput(e.target)) {
      // FL Studio: Esc closes the focused window (after the editor had a chance to clear its selection).
      const s = useStore.getState();
      const focused = s.ui.focusedWindow;
      if (focused && windowHandlers.get(focused)?.(e)) return;
      if (focused && focused !== 'playlist') closeWindow(focused);
    }
    return;
  }
  // Tool dialogs preview their result live: Space still starts and stops playback to listen to it.
  if (overlays.dialog?.kind === 'tool' && e.code === 'Space' && !isTextInput(e.target)) {
    e.preventDefault();
    void runCommand('playPause');
    return;
  }
  if (overlays.dialog || isTextInput(e.target)) return;

  const s = useStore.getState();
  const mod = e.metaKey || e.ctrlKey;

  // Typing keyboard to piano takes letters and digits while enabled.
  const semitone = TYPING_KEYS[e.code];
  if (s.ui.typingKeyboard && !mod && !e.altKey && semitone !== undefined) {
    e.preventDefault();
    if (!e.repeat && !held.has(e.code) && s.ui.selectedChannelId) {
      held.set(e.code, liveNoteOn(s.ui.selectedChannelId, TYPING_BASE + semitone));
    }
    return;
  }

  const focused = s.ui.focusedWindow;
  const handler = focused ? windowHandlers.get(focused) : undefined;
  if (handler?.(e)) {
    e.preventDefault();
    return;
  }

  const command = shortcutFor(e);
  if (command) {
    e.preventDefault();
    void runCommand(command);
    return;
  }

  const digit = channelDigit(e);
  if (digit !== null && !s.ui.typingKeyboard) {
    e.preventDefault();
    muteChannelByIndex(digit, mod);
  }
}

function onKeyUp(e: KeyboardEvent): void {
  const handle = held.get(e.code);
  if (handle !== undefined) {
    liveNoteOff(handle);
    held.delete(e.code);
  }
}

export function installKeyboard(): void {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', releaseAll);
}
