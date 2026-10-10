/** Global keyboard handling: commands, tool keys (with hold-to-switch), Space and modifier tracking. */
import { isMac } from '../platform/platform';
import type { ToolId } from '../paint/tools';
import * as actions from '../store/actions';
import { stop as stopPlayback } from '../store/animationActions';
import { getState } from '../store/store';
import { pasteImage, copy, cut } from '../store/clipboard';
import { controller } from '../tools/controller';
import { PolylineSelect } from '../tools/sessions';
import { CurveInput } from '../tools/curveInput';
import { cancelTransform, isTransforming } from '../tools/transform';
import { CurveFigure } from '../tools/sessions';
import { commandForShortcut, isEnabled, runCommand, targetsForShortcut, toolForShortcut } from './commands';
import { noteCommand, playAction } from '../store/autoActionStore';
import { closeMenu, isModalOpen, useOverlays } from './overlays';
import { eventToShortcut, keyName } from './shortcuts';

const isTextTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'color', 'range'].includes((t as HTMLInputElement).type)));

/** Clipboard keys go through the copy/cut/paste events so native menus and the system clipboard work. */
const CLIPBOARD_KEYS: Record<string, string> = { 'Mod+c': 'copy', 'Mod+x': 'cut', 'Mod+v': 'paste' };

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
      // ⌘C / ⌘X / ⌘V go through the clipboard events while they still copy, cut and paste; set on
      // something else (Shortcut Settings), they do that instead.
      if (CLIPBOARD_KEYS[shortcut]) {
        if (commandForShortcut(shortcut)?.id === CLIPBOARD_KEYS[shortcut]) return;
        e.preventDefault();
      }
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
      // Figure > Curve being bent: Esc cancels.
      if (CurveFigure.active && e.key === 'Escape') {
        e.preventDefault();
        CurveFigure.cancel();
        controller.leave();
        return;
      }
      // Curve ruler being placed: Enter finishes, Esc cancels, Backspace removes the last point.
      if (CurveInput.active && ['Enter', 'Escape', 'Backspace', 'Delete'].includes(e.key)) {
        e.preventDefault();
        if (e.key === 'Enter') CurveInput.finish();
        else if (e.key === 'Escape') CurveInput.cancel();
        else CurveInput.undoPoint();
        controller.leave();
        return;
      }
      const cmd = commandForShortcut(shortcut);
      if (cmd) {
        e.preventDefault();
        if (!e.repeat || ['undo', 'redo', 'brushSmaller', 'brushBigger', 'zoomIn', 'zoomOut', 'rotateLeft', 'rotateRight'].includes(cmd.id)) {
          // Through runCommand: an auto action being recorded takes it in.
          if (isEnabled(cmd)) void runCommand(cmd.id);
        }
        return;
      }
      // Auto actions with a shortcut (Shortcut Settings) play.
      const action = targetsForShortcut(shortcut).find((t) => t.startsWith('action:'));
      if (action) {
        e.preventDefault();
        if (!e.repeat) void playAction(action.slice('action:'.length), null);
        return;
      }
      // Tool keys: a tool's shortcut, or its plain key (Shift aside); held down, the tool is only borrowed.
      if (!e.repeat && !isTransforming()) {
        const key = keyName({ key: e.key, code: e.code, alt: false, shift: false });
        const current = getState().tool;
        const next = toolForShortcut(shortcut, current) ?? (!mod && !e.altKey ? toolForShortcut(key, current) : null);
        if (next) {
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

  // ⌘C / ⌘X / ⌘V come as clipboard events; an auto action being recorded takes them in too.
  document.addEventListener('copy', (e) => {
    if (isTextTarget(e.target) || isModalOpen()) return;
    if (!copy()) return;
    e.preventDefault();
    noteCommand('copy', 'Copy');
  });
  document.addEventListener('cut', (e) => {
    if (isTextTarget(e.target) || isModalOpen()) return;
    if (!cut()) return;
    e.preventDefault();
    noteCommand('cut', 'Cut');
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
    } else if (pasteImage()) noteCommand('paste', 'Paste');
  });
}
