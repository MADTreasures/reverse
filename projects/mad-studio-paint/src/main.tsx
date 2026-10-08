import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { engine } from './engine/engine';
import { buildDocumentBytes, listenForNativeOpen, openFileBytes, restoreAutosave, startAutosave } from './io/documentIO';
import { native, isElectron, isMac } from './platform/platform';
import { keyedTrackOf } from './model/animation';
import { sanitizeOnion } from './paint/animation';
import { shownLightLayers } from './store/lightTableActions';
import * as actions from './store/actions';
import { getState, useStore } from './store/store';
import { controller } from './tools/controller';
import { runCommand } from './ui/commands';
import { installKeyboard } from './ui/keyboard';
import { nativeMenuTemplate } from './ui/nativeMenu';
import { toast } from './ui/overlays';
import './styles/base.css';
import './styles/app.css';

/** Window title like "Name (2000 x 2000px 350dpi 37.4%) - MAD Studio Paint". */
function syncTitle(): void {
  let last = '';
  const update = () => {
    const s = getState();
    const z = Math.round(s.view.zoom * 1000) / 10;
    const title = `${s.doc.name}${s.dirty ? '*' : ''} (${s.doc.width} x ${s.doc.height}px ${s.doc.dpi}dpi ${z}%) - MAD Studio Paint`;
    if (title === last) return;
    last = title;
    document.title = title;
    native?.setTitle(title);
    native?.setDocumentEdited(s.dirty);
  };
  update();
  useStore.subscribe((s, prev) => {
    if (s.doc !== prev.doc || s.dirty !== prev.dirty || s.view.zoom !== prev.view.zoom) update();
  });
}

const PREFS_KEY = 'mad-paint:prefs';

/** Workspace and view preferences survive restarts. */
function persistPreferences(): void {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const p = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    useStore.setState({
      ...(p.workspace === 'default' || p.workspace === 'classic' ? { workspace: p.workspace } : {}),
      ...(typeof p.showSelectionLauncher === 'boolean' ? { showSelectionLauncher: p.showSelectionLauncher } : {}),
      ...(typeof p.loop === 'boolean' ? { loop: p.loop } : {}),
      ...(typeof p.timelineShown === 'boolean' ? { timelineShown: p.timelineShown } : {}),
      ...(typeof p.timelineHeight === 'number' && Number.isFinite(p.timelineHeight) ? { timelineHeight: Math.min(700, Math.max(110, p.timelineHeight)) } : {}),
      ...(p.onion ? { onion: sanitizeOnion(p.onion) } : {}),
    });
  } catch {
    // Ignore.
  }
  useStore.subscribe((s, prev) => {
    const keys = ['workspace', 'showSelectionLauncher', 'loop', 'timelineShown', 'timelineHeight', 'onion'] as const;
    if (keys.every((k) => s[k] === prev[k])) return;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(Object.fromEntries(keys.map((k) => [k, s[k]]))));
    } catch {
      // Ignore.
    }
  });
}

/** Keeps the pixel engine in step with the document structure and selection in the store. */
function connectEngine(): void {
  useStore.subscribe((s, prev) => {
    if (s.doc !== prev.doc) engine.setDocument(s.doc);
    if (s.selection !== prev.selection) engine.setSelection(s.selection);
    if (s.frame !== prev.frame) engine.setFrame(s.frame);
    if (s.onionSkin !== prev.onionSkin || s.onion !== prev.onion) engine.setOnion(s.onionSkin ? s.onion : null);
    if (s.cameraView !== prev.cameraView) engine.setCameraView(s.cameraView);
    const lightKeys = ['doc', 'activeLayerId', 'lockedCel', 'lightOn', 'lightShowCel', 'lightShowGeneral'] as const;
    if (lightKeys.some((k) => s[k] !== prev[k])) engine.setLightTable(shownLightLayers(s));
    // Edit layers with active keyframes: the current track is drawn as it is; another track turns it off.
    if (s.editKeyed !== prev.editKeyed || s.activeLayerId !== prev.activeLayerId || s.doc !== prev.doc) {
      const track = s.editKeyed ? (keyedTrackOf(s.doc.layers, s.activeLayerId)?.id ?? null) : null;
      if (s.editKeyed && prev.editKeyed && track !== keyedTrackOf(prev.doc.layers, prev.activeLayerId)?.id) {
        useStore.setState({ editKeyed: false });
        return;
      }
      engine.setUnkeyed(track);
    }
  });
}

async function boot(): Promise<void> {
  if (isElectron) document.body.classList.add('electron');
  if (isMac) document.body.classList.add('mac');

  const s = getState();
  engine.load(s.doc);
  connectEngine();
  actions.restoreSubTools();
  actions.restorePreferences();
  persistPreferences();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  installKeyboard();
  // Let the layout settle so "fit to window" knows the canvas size.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const restored = await restoreAutosave();
  if (restored) toast('Restored your last session (not yet saved to a file).');
  else actions.fitToWindow();
  startAutosave();
  syncTitle();
  listenForNativeOpen();
  native?.onMenu((action) => void runCommand(action));
  native?.setMenu(nativeMenuTemplate());

  window.addEventListener('beforeunload', (e) => {
    if (getState().dirty && !isElectron) e.preventDefault();
  });

  // Automation hooks for tests and power users.
  Object.assign(window, {
    __madPaint: { useStore, actions, engine, controller, runCommand, buildDocumentBytes, openFileBytes },
  });
  native?.ready();
}

void boot();
