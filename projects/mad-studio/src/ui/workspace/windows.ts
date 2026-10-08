import { setUi } from '../../store/actions';
import { useStore, type WindowState } from '../../store/store';

export type FixedWindow = 'playlist' | 'channelRack' | 'pianoRoll' | 'mixer';

export const WINDOW_TITLES: Record<FixedWindow, string> = {
  playlist: 'Playlist',
  channelRack: 'Channel rack',
  pianoRoll: 'Piano roll',
  mixer: 'Mixer',
};

function workspaceSize(): { w: number; h: number } {
  const el = document.querySelector('.workspace');
  return el ? { w: el.clientWidth, h: el.clientHeight } : { w: 1200, h: 700 };
}

/** Keeps a window reachable inside the workspace. */
function clampToWorkspace(win: WindowState): WindowState {
  const { w, h } = workspaceSize();
  const width = Math.min(Math.max(win.w, 260), Math.max(260, w));
  const height = Math.min(Math.max(win.h, 120), Math.max(120, h));
  return {
    ...win,
    w: width,
    h: height,
    x: Math.min(Math.max(win.x, -width + 80), Math.max(0, w - 80)),
    y: Math.min(Math.max(win.y, 0), Math.max(0, h - 28)),
  };
}

export function focusWindow(id: string): void {
  const s = useStore.getState();
  if (s.ui.focusedWindow === id && s.ui.windows[id]?.z === s.ui.topZ) return;
  setUi((d) => {
    const win = d.windows[id];
    if (!win) return;
    if (win.z !== d.topZ) {
      d.topZ += 1;
      win.z = d.topZ;
    }
    d.focusedWindow = id;
  });
}

export function openWindow(id: string, defaults?: Partial<WindowState>): void {
  setUi((d) => {
    const existing = d.windows[id];
    const { w, h } = workspaceSize();
    const base: WindowState = existing ?? {
      open: true,
      x: Math.max(0, (w - (defaults?.w ?? 520)) / 2 + (Object.keys(d.windows).length % 6) * 18),
      y: Math.max(0, (h - (defaults?.h ?? 380)) / 3 + (Object.keys(d.windows).length % 6) * 18),
      w: 520,
      h: 380,
      z: 0,
      ...defaults,
    };
    d.topZ += 1;
    d.windows[id] = clampToWorkspace({ ...base, open: true, z: d.topZ });
    d.focusedWindow = id;
  });
}

export function closeWindow(id: string): void {
  setUi((d) => {
    const win = d.windows[id];
    if (!win) return;
    if (id.startsWith('channel:') || id.startsWith('effect:')) delete d.windows[id];
    else win.open = false;
    if (d.focusedWindow === id) d.focusedWindow = null;
  });
}

export function toggleWindow(id: FixedWindow): void {
  const s = useStore.getState();
  const win = s.ui.windows[id];
  if (win?.open && s.ui.focusedWindow === id) closeWindow(id);
  else openWindow(id);
}

export function moveWindow(id: string, x: number, y: number): void {
  setUi((d) => {
    const win = d.windows[id];
    if (win) {
      win.x = Math.round(x);
      win.y = Math.max(0, Math.round(y));
    }
  });
}

export function resizeWindow(id: string, w: number, h: number): void {
  setUi((d) => {
    const win = d.windows[id];
    if (win) {
      win.w = Math.max(260, Math.round(w));
      win.h = Math.max(120, Math.round(h));
    }
  });
}

export function toggleMaximize(id: string): void {
  setUi((d) => {
    const win = d.windows[id];
    if (win) win.maximized = !win.maximized;
  });
  focusWindow(id);
}

export function openChannelEditor(channelId: string): void {
  openWindow(`channel:${channelId}`, { w: 640, h: 420 });
}

/** FL Studio's channel button: the first click opens the channel's window, the next one closes it. */
export function toggleChannelEditor(channelId: string): void {
  const id = `channel:${channelId}`;
  if (useStore.getState().ui.windows[id]?.open) closeWindow(id);
  else openChannelEditor(channelId);
}

export function openEffectEditor(trackIndex: number, slotId: string): void {
  openWindow(`effect:${trackIndex}:${slotId}`, { w: 420, h: 230 });
}

export function openPianoRoll(channelId: string): void {
  setUi((d) => {
    d.pianoRollChannelId = channelId;
    d.selectedChannelId = channelId;
  });
  openWindow('pianoRoll');
}
