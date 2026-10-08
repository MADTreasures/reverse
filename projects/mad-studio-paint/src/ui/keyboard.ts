/** Global keyboard handling: commands, tool keys (with hold-to-switch), Space and modifier tracking. */
import { isMac } from '../platform/platform';
import { toolForKey, type ToolId } from '../paint/tools';
import * as actions from '../store/actions';
import { stop as stopPlayback } from '../store/animationActions';
import { getState } from '../store/store';
import { pasteImage, copy, cut } from '../store/clipboard';
import { controller } from '../tools/controller';
import { PolylineSelect } from '../tools/sessions';
import { cancelTransform, isTransforming } from '../tools/transform';
import { commandForShortcut, isEnabled } from './commands';
import { closeMenu, isModalOpen, useOverlays } from './overlays';
import { eventToShortcut, keyName } from './shortcuts';

const isTextTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'color', 'range'].includes((t as HTMLInputElement).type)));

/** Clipboard keys go through the copy/cut/paste events so native menus and the system clipboard work. */
const CLIPBOARD_KEYS = new Set(['Mod+c', 'Mod+x', 'Mod+v']);

interface HeldTool {
  key: string;
  previous: ToolId;
  /** The tool was used while the key was held. */
  used: boolean;
  since: number;
}
let held: HeldTool | null = null;

function syncModifiers(e: KeyboardEvent | MouseEvent): void {
  controller.setModifiers({ shift: e.shiftKey, alt: e.altKey, mod: isMac ? e.metaKey : e.ctrlKey });
}

export function installKeyboard(): void {
  window.addEventListener(
    'keydown',
    (e) => {
      syncModifiers(e);
      if (isModalOpen() || isTextTarget(e.target)) return;
      if (useOverlays.getState().menu && e.key === 'Escape') {
        closeMenu();
        return;
      }
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) controller.setModifiers({ space: true });
        return;
      }
      if (controller.busy) {
        if (e.key === 'Escape') controller.cancel();
        // Shift/Alt changes are forwarded by syncModifiers; everything else waits for the stroke to end.
        if (!['Shift', 'Alt', 'Meta', 'Control'].includes(e.key)) e.preventDefault();
        return;
      }
      const shortcut = eventToShortcut({ key: e.key, code: e.code, shift: e.shiftKey, alt: e.altKey, mod });
      if (CLIPBOARD_KEYS.has(shortcut)) return;
      if (isTransforming() && e.key === 'Escape') {
        e.preventDefault();
        cancelTransform();
        return;
      }
      // Esc stops playback, like the reference.
      if (getState().playing && e.key === 'Escape') {
        e.preventDefault();
        stopPlayback();
        return;
      }
      // Polyline selection in progress: Enter closes, Esc cancels, Backspace removes the last corner.
      if (PolylineSelect.active && ['Enter', 'Escape', 'Backspace', 'Delete'].includes(e.key)) {
        e.preventDefault();
        if (e.key === 'Enter') PolylineSelect.finish();
        else if (e.key === 'Escape') PolylineSelect.cancel();
        else PolylineSelect.undoPoint();
        controller.leave();
        return;
      }
      const cmd = commandForShortcut(shortcut);
      if (cmd) {
        e.preventDefault();
        if (!e.repeat || ['undo', 'redo', 'brushSmaller', 'brushBigger', 'zoomIn', 'zoomOut', 'rotateLeft', 'rotateRight'].includes(cmd.id)) {
          if (isEnabled(cmd)) void cmd.run();
        }
        return;
      }
      // Tool keys: plain letters / "/" without modifiers.
      if (!mod && !e.altKey && !e.repeat) {
        const key = keyName({ key: e.key, code: e.code, alt: false, shift: false });
        const current = getState().tool;
        const next = toolForKey(key, current);
        if (next && !isTransforming()) {
          e.preventDefault();
          held = { key, previous: current, used: false, since: performance.now() };
          actions.setTool(next);
        }
      }
    },
    true,
  );

  window.addEventListener(
    'keyup',
    (e) => {
      syncModifiers(e);
      if (e.key === ' ' || e.code === 'Space') controller.setModifiers({ space: false });
      if (held && keyName({ key: e.key, code: e.code, alt: false, shift: false }) === held.key) {
        // Holding a tool key (longer than the hold time, or while drawing) switches back on release.
        if (held.used || performance.now() - held.since >= getState().prefs.holdMs) actions.setTool(held.previous);
        held = null;
      }
    },
    true,
  );

  controller.onChange(() => {
    if (held && controller.busy) held.used = true;
  });

  window.addEventListener('blur', () => {
    controller.setModifiers({ shift: false, alt: false, mod: false, space: false });
    held = null;
  });

  document.addEventListener('copy', (e) => {
    if (isTextTarget(e.target) || isModalOpen()) return;
    if (copy()) e.preventDefault();
  });
  document.addEventListener('cut', (e) => {
    if (isTextTarget(e.target) || isModalOpen()) return;
    if (cut()) e.preventDefault();
  });
  document.addEventListener('paste', (e) => {
    if (isTextTarget(e.target) || isModalOpen()) return;
    const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
    e.preventDefault();
    if (file) {
      void createImageBitmap(file).then((bmp) => {
        pasteImage(bmp);
        bmp.close();
      });
    } else pasteImage();
  });
}
