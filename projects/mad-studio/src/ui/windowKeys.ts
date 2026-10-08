import { useStore } from '../store/store';

export type KeyHandler = (e: KeyboardEvent) => boolean;

/** Key handlers of the editors, by window id; they receive keys while their window is focused. */
export const windowHandlers = new Map<string, KeyHandler>();

export function registerWindowKeys(windowId: string, handler: KeyHandler): () => void {
  windowHandlers.set(windowId, handler);
  return () => {
    if (windowHandlers.get(windowId) === handler) windowHandlers.delete(windowId);
  };
}

/** Sends a Ctrl/Cmd shortcut to the focused editor, for menu items like Edit › Copy. */
export function sendToFocusedEditor(code: string, key: string): boolean {
  const focused = useStore.getState().ui.focusedWindow;
  const handler = focused ? windowHandlers.get(focused) : undefined;
  return handler ? handler(new KeyboardEvent('keydown', { code, key, ctrlKey: true, metaKey: true })) : false;
}
