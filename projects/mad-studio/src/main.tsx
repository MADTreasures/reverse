import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { engine } from './audio/engine';
import { renderProject, bufferChannels } from './audio/render';
import { samplePool } from './audio/samplePool';
import { signalStats } from './audio/wav';
import { native, isElectron, isMac } from './platform/platform';
import { usePlugins } from './plugins/pluginStore';
import { buildProjectBundle, listenForNativeOpen, openProjectBytes, restoreSession, startAutosave } from './project/projectIO';
import * as actions from './store/actions';
import { createAutomationClip, updateAutomation } from './store/automationActions';
import { defaultWindows, useStore, type UiState } from './store/store';
import { runCommand, type CommandId } from './ui/commands';
import { enableMidi, installKeyboard } from './ui/keyboard';
import { pluginInstanceFrom } from './ui/menus/pluginMenus';
import { toast } from './ui/overlays';
import './styles/base.css';
import './styles/app.css';

const UI_KEY = 'mad-studio:ui';

function restoreUiLayout(): void {
  try {
    const raw = localStorage.getItem(UI_KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<UiState>) : null;
    const ws = document.querySelector('.workspace');
    const fallback = defaultWindows(ws?.clientWidth ?? window.innerWidth - 230, ws?.clientHeight ?? window.innerHeight - 60);
    actions.setUi((d) => {
      d.windows = { ...fallback, ...(saved?.windows ?? {}) };
      for (const key of Object.keys(d.windows)) if (key.startsWith('channel:') || key.startsWith('effect:')) delete d.windows[key];
      d.topZ = Math.max(10, ...Object.values(d.windows).map((w) => w.z));
      if (saved?.browserOpen !== undefined) d.browserOpen = saved.browserOpen;
      if (saved?.browserWidth) d.browserWidth = saved.browserWidth;
      if (saved?.pianoRoll) d.pianoRoll = { ...d.pianoRoll, ...saved.pianoRoll };
      if (saved?.playlist) d.playlist = { ...d.playlist, ...saved.playlist };
    });
  } catch {
    // Ignore unreadable layout.
  }
}

let layoutTimer: ReturnType<typeof setTimeout> | null = null;
function persistUiLayout(): void {
  useStore.subscribe((s, prev) => {
    if (s.ui === prev.ui) return;
    if (layoutTimer) clearTimeout(layoutTimer);
    layoutTimer = setTimeout(() => {
      const { windows, browserOpen, browserWidth, pianoRoll, playlist } = useStore.getState().ui;
      const fixed = Object.fromEntries(Object.entries(windows).filter(([k]) => !k.includes(':')));
      try {
        localStorage.setItem(UI_KEY, JSON.stringify({ windows: fixed, browserOpen, browserWidth, pianoRoll, playlist }));
      } catch {
        // Storage may be unavailable.
      }
    }, 400);
  });
}

function syncTitle(): void {
  const update = () => {
    const s = useStore.getState();
    const title = `${s.dirty ? '• ' : ''}${s.project.name} – MAD Studio`;
    document.title = title;
    native?.setTitle(title);
    native?.setDocumentEdited(s.dirty);
  };
  update();
  useStore.subscribe((s, prev) => {
    if (s.project.name !== prev.project.name || s.dirty !== prev.dirty) update();
  });
}

async function boot(): Promise<void> {
  if (isElectron) document.body.classList.add('electron');
  if (isMac) document.body.classList.add('mac');

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  await engine.init();
  // Browsers only start audio after a user gesture.
  const unlock = () => void engine.resume();
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);

  installKeyboard();
  restoreUiLayout();
  persistUiLayout();
  const restored = await restoreSession();
  if (restored === 'autosave') toast('Restored your last session (not yet saved to a file).');
  startAutosave();
  syncTitle();
  listenForNativeOpen();
  native?.onMenu((action) => void runCommand(action as CommandId));
  if (isElectron) void enableMidi().catch(() => undefined);

  window.addEventListener('beforeunload', (e) => {
    if (useStore.getState().dirty && !isElectron) e.preventDefault();
  });

  // Automation hooks for tests and power users.
  Object.assign(window, {
    __madStudio: {
      useStore,
      actions,
      engine,
      samplePool,
      renderProject,
      bufferChannels,
      signalStats,
      buildProjectBundle,
      openProjectBytes,
      runCommand,
      createAutomationClip,
      updateAutomation,
      usePlugins,
      pluginInstanceFrom,
    },
  });
  native?.ready();
}

void boot();
