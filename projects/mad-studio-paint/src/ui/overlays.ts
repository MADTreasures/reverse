import { create } from 'zustand';
import type { Id } from '../model/types';
import type { CorrectionType } from '../paint/tonal';
import type { FilterId } from '../paint/filters';

export interface MenuItem {
  label?: string;
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  checked?: boolean;
  separator?: boolean;
  submenu?: MenuItem[];
}

export type CustomDialogId = 'newCanvas' | 'colorSettings' | 'export' | 'exportPreview' | 'exportPsd' | 'frameTemplates' | 'timelineSettings' | 'newTimeline' | 'frameRate' | 'manageTimelines' | 'cameraFolder' | 'assignMultiple' | 'centerCanvas' | 'onionSkin' | 'exportGif' | 'exportApng' | 'exportWebp' | 'exportSequence' | 'exportCels' | 'exportAudio' | 'exportMovie' | 'canvasSize' | 'imageResolution' | 'gridSettings' | 'colorSets' | 'preferences' | 'about' | 'shortcuts' | 'pressure' | 'newFrameFolder' | 'divideFrame' | 'drawAlongRuler' | 'newTone' | 'gradient' | 'timelineLabel' | 'trackLabel' | 'goToFrame' | 'goToLabel' | 'insertFrame' | 'deleteFrame' | 'expandSelection' | 'shrinkSelection' | 'blurBorder' | 'colorGamut' | 'registerMaterial';

/** What a tonal correction dialog changes. */
export type TonalTarget =
  /** Edit > Tonal correction: the current layer's pixels. */
  | { kind: 'pixels'; type: CorrectionType }
  /** Layer > New correction layer. */
  | { kind: 'newLayer'; type: CorrectionType }
  /** The settings of an existing correction layer. */
  | { kind: 'layer'; layerId: Id };

type DialogSpec =
  | { kind: 'prompt'; title: string; value: string; resolve: (v: string | null) => void }
  | { kind: 'confirm'; title: string; message: string; okLabel: string; danger: boolean; resolve: (v: boolean) => void }
  | { kind: 'custom'; id: CustomDialogId }
  | { kind: 'tonal'; target: TonalTarget }
  | { kind: 'filter'; filter: FilterId };

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

export function showMenu(at: { x: number; y: number }, items: MenuItem[]): void {
  useOverlays.setState({ menu: { x: at.x, y: at.y, items } });
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
  useOverlays.setState({ dialog: { kind: 'custom', id }, menu: null });
}

export function openTonalDialog(target: TonalTarget): void {
  useOverlays.setState({ dialog: { kind: 'tonal', target }, menu: null });
}

export function openFilterDialog(filter: FilterId): void {
  useOverlays.setState({ dialog: { kind: 'filter', filter }, menu: null });
}

export function closeDialog(): void {
  const d = useOverlays.getState().dialog;
  if (d?.kind === 'prompt') d.resolve(null);
  else if (d?.kind === 'confirm') d.resolve(false);
  else useOverlays.setState({ dialog: null });
}

let toastId = 0;
export function toast(text: string, kind: 'info' | 'error' = 'info'): void {
  const id = ++toastId;
  useOverlays.setState((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
  setTimeout(() => useOverlays.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 6000 : 3200);
}

export const isModalOpen = () => useOverlays.getState().dialog !== null;
