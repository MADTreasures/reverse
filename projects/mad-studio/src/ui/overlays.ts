import { create } from 'zustand';
import type { ToolContext } from '../model/noteTools';

export interface MenuItem {
  label?: string;
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  checked?: boolean;
  separator?: boolean;
  danger?: boolean;
  /** Colour swatch shown before the label. */
  swatch?: string;
  submenu?: MenuItem[];
  /** Section title (FL Studio style grey band), not clickable. */
  header?: boolean;
  /** Radio-style mark instead of a check mark. */
  radio?: boolean;
}

export type CustomDialogId = 'export' | 'about' | 'shortcuts' | 'project' | 'plugins' | 'audio';

type DialogSpec =
  | { kind: 'prompt'; title: string; value: string; resolve: (v: string | null) => void }
  | { kind: 'confirm'; title: string; message: string; okLabel: string; danger: boolean; resolve: (v: boolean) => void }
  | { kind: 'custom'; id: CustomDialogId }
  | { kind: 'note'; patternId: string; channelId: string; noteId: string }
  | { kind: 'tool'; toolId: string; patternId: string; channelId: string; selected: string[]; ctx: ToolContext };

interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

interface OverlayState {
  menu: { x: number; y: number; items: MenuItem[] } | null;
  dialog: DialogSpec | null;
  toasts: Toast[];
}

export const useOverlays = create<OverlayState>(() => ({ menu: null, dialog: null, toasts: [] }));

export function showMenu(at: { clientX: number; clientY: number } | { x: number; y: number }, items: MenuItem[]): void {
  const x = 'clientX' in at ? at.clientX : at.x;
  const y = 'clientY' in at ? at.clientY : at.y;
  useOverlays.setState({ menu: { x, y, items } });
}

export function closeMenu(): void {
  if (useOverlays.getState().menu) useOverlays.setState({ menu: null });
}

export function promptDialog(title: string, value = ''): Promise<string | null> {
  return new Promise((resolve) => {
    useOverlays.setState({
      dialog: {
        kind: 'prompt',
        title,
        value,
        resolve: (v) => {
          useOverlays.setState({ dialog: null });
          resolve(v);
        },
      },
    });
  });
}

export function confirmDialog(title: string, message: string, okLabel = 'OK', danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    useOverlays.setState({
      dialog: {
        kind: 'confirm',
        title,
        message,
        okLabel,
        danger,
        resolve: (v) => {
          useOverlays.setState({ dialog: null });
          resolve(v);
        },
      },
    });
  });
}

export function openDialog(id: CustomDialogId): void {
  useOverlays.setState({ dialog: { kind: 'custom', id } });
}

/** FL Studio's note properties (double-click a note in the piano roll). */
export function openNoteProperties(patternId: string, channelId: string, noteId: string): void {
  useOverlays.setState({ dialog: { kind: 'note', patternId, channelId, noteId } });
}

/** A piano roll tool with parameters (FL Studio: Tools › Arpeggiate… etc.), previewed live. */
export function openToolDialog(toolId: string, patternId: string, channelId: string, selected: string[], ctx: ToolContext): void {
  useOverlays.setState({ dialog: { kind: 'tool', toolId, patternId, channelId, selected, ctx } });
}

export function closeDialog(): void {
  const d = useOverlays.getState().dialog;
  if (d?.kind === 'prompt') d.resolve(null);
  else if (d?.kind === 'confirm') d.resolve(false);
  else useOverlays.setState({ dialog: null });
}

let toastId = 0;
export function toast(text: string, kind: Toast['kind'] = 'info'): void {
  const id = ++toastId;
  useOverlays.setState((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
  setTimeout(() => useOverlays.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 6000 : 3200);
}
