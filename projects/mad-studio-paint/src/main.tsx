import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { engine } from './engine/engine';
import { buildDocumentBytes, listenForNativeOpen, openFileBytes, restoreAutosave, startAutosave } from './io/documentIO';
import { native, isElectron, isMac } from './platform/platform';
import * as actions from './store/actions';
import { getState, useStore } from './store/store';
import { controller } from './tools/controller';
import { runCommand } from './ui/commands';
import { installKeyboard } from './ui/keyboard';
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
    });
  } catch {
    // Ignore.
  }
  useStore.subscribe((s, prev) => {
    if (s.workspace === prev.workspace && s.showSelectionLauncher === prev.showSelectionLauncher) return;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ workspace: s.workspace, showSelectionLauncher: s.showSelectionLauncher }));
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
