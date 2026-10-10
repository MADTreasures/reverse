// MAD Studio – Electron main process (macOS app shell around the web build in ../dist).
const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, session, shell } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { EngineHost } = require('./engine.cjs');

const DIST = path.join(__dirname, '..', 'dist');
const DEV_URL = process.env.MAD_DEV_URL || '';
const SMOKE = process.argv.includes('--smoke-test');
// Automated tests run the app with a throwaway profile and without the "unsaved changes" prompt.
const TEST_PROFILE = process.env.MAD_STUDIO_TEST_PROFILE || '';
if (TEST_PROFILE) app.setPath('userData', TEST_PROFILE);
const APP_ORIGIN = 'app://mad-studio';
const isMac = process.platform === 'darwin';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.setName('MAD Studio');

let mainWindow = null;
let documentEdited = false;
let rendererReadyForFiles = false;
const pendingFiles = [];
// Files the user picked in a dialog or opened from Finder. The renderer may only
// re-save to these paths without a dialog, never to arbitrary locations.
const userChosenPaths = new Set();
/** Native audio engine process (null until the app is ready). */
let engine = null;
let lastEngineReady = null;

// ---------------------------------------------------------------- window state

const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  try {
    return JSON.parse(fsSync.readFileSync(stateFile(), 'utf8'));
  } catch {
    return { width: 1440, height: 900 };
  }
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  const bounds = win.getNormalBounds();
  try {
    fsSync.writeFileSync(stateFile(), JSON.stringify({ ...bounds, maximized: win.isMaximized() }));
  } catch {
    // Not critical.
  }
}

// ---------------------------------------------------------------- helpers

function isTrustedSender(event) {
  const url = event.senderFrame?.url ?? '';
  return url.startsWith(APP_ORIGIN) || (DEV_URL !== '' && url.startsWith(DEV_URL));
}

function send(action) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('menu:action', action);
}

/** Smoke test: called when the engine answered the ping. */
let smokeEngineDone = null;

function sendEngineMessage(msg) {
  if (msg.type === 'ready') lastEngineReady = msg;
  if (msg.type === 'engine.exit') lastEngineReady = null;
  if (SMOKE && msg.type === 'ready') console.log(`MAD_STUDIO_ENGINE_OK ${msg.version ?? ''} ${msg.sampleRate ?? ''}Hz null=${msg.device?.null ?? '?'}`);
  if (SMOKE && msg.type === 'pong' && smokeEngineDone) smokeEngineDone();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('engine:message', msg);
}

async function readFileForRenderer(filePath) {
  const data = await fs.readFile(filePath);
  userChosenPaths.add(path.resolve(filePath));
  return { name: path.basename(filePath), path: filePath, data: new Uint8Array(data) };
}

async function deliverOpenedFile(filePath) {
  try {
    const file = await readFileForRenderer(filePath);
    if (rendererReadyForFiles && mainWindow) mainWindow.webContents.send('file:opened', file);
    else pendingFiles.push(file);
  } catch (err) {
    dialog.showErrorBox('Could not open file', String(err));
  }
}

// ---------------------------------------------------------------- menu

function buildMenu() {
  // Shortcuts are handled in the renderer; menu accelerators are display-only to avoid double triggers.
  const item = (label, action, accelerator) => ({
    label,
    click: () => send(action),
    ...(accelerator ? { accelerator, registerAccelerator: false } : {}),
  });
  const sep = { type: 'separator' };
  const template = [
    ...(isMac
      ? [
          {
            label: 'MAD Studio',
            submenu: [
              item('About MAD Studio', 'about'),
              sep,
              { role: 'services' },
              sep,
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              sep,
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        item('New (Basic Drum Kit)', 'new'),
        { label: 'New from Template', submenu: [item('Basic Drum Kit', 'new'), item('Demo Song “MAD Groove”', 'demo')] },
        item('Open…', 'open', 'CmdOrCtrl+O'),
        sep,
        item('Save', 'save', 'CmdOrCtrl+S'),
        item('Save As…', 'saveAs', 'Shift+CmdOrCtrl+S'),
        item('Save New Version', 'saveNewVersion', 'CmdOrCtrl+N'),
        sep,
        { label: 'Import', submenu: [item('Audio Files…', 'importSamples'), item('MIDI File…', 'importMidi')] },
        { label: 'Export', submenu: [item('Audio File (WAV, FLAC, MP3, OGG)…', 'export', 'CmdOrCtrl+R'), item('MIDI File…', 'exportMidi')] },
        ...(isMac ? [] : [sep, { role: 'quit' }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        item('Undo', 'undo', 'CmdOrCtrl+Z'),
        item('Redo', 'redo', 'Alt+CmdOrCtrl+Z'),
        sep,
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Patterns',
      submenu: [
        item('Find First Empty…', 'findFirstEmptyPattern', 'Shift+F4'),
        item('Find Next Empty…', 'newPatternNamed', 'F4'),
        item('Find Next Empty (No Naming)', 'newPattern', 'CmdOrCtrl+F4'),
        sep,
        item('Rename…', 'renamePattern', 'F2'),
        item('Transpose…', 'transposePattern'),
        sep,
        item('Insert One', 'insertPattern', isMac ? undefined : 'Shift+CmdOrCtrl+Insert'),
        item('Clone', 'clonePattern', 'Shift+CmdOrCtrl+C'),
        item('Delete…', 'deletePattern', isMac ? 'Shift+Cmd+Backspace' : 'Shift+Ctrl+Delete'),
        sep,
        item('Move Up', 'movePatternUp', 'Shift+CmdOrCtrl+Up'),
        item('Move Down', 'movePatternDown', 'Shift+CmdOrCtrl+Down'),
        sep,
        item('Split by Channel', 'splitPattern'),
        sep,
        item('Previous Pattern', 'prevPattern', '-'),
        item('Next Pattern', 'nextPattern', '='),
      ],
    },
    {
      label: 'Transport',
      submenu: [
        item('Play / Stop', 'playPause', 'Space'),
        // On macOS Cmd+Space (Spotlight) and Cmd+H (Hide) belong to the system: use the Control key there.
        item('Play / Pause', 'pause', isMac ? 'Ctrl+Space' : 'CmdOrCtrl+Space'),
        item('Stop', 'stop'),
        item('Stop All Sound', 'panic', isMac ? 'Ctrl+H' : 'CmdOrCtrl+H'),
        item('Pattern / Song Mode', 'toggleMode', 'L'),
        item('Record', 'record', 'R'),
      ],
    },
    {
      label: 'View',
      submenu: [
        item('Playlist', 'window:playlist', 'F5'),
        item('Piano Roll', 'window:pianoRoll', 'F7'),
        item('Channel Rack', 'window:channelRack', 'F6'),
        item('Mixer', 'window:mixer', 'F9'),
        item('Browser', 'toggleBrowser', 'Alt+F8'),
        item('Plugin Picker / Manager', 'pluginPicker', 'F8'),
        sep,
        item('Close All Windows', 'closeAllWindows', 'F12'),
        item('Close All Plugin Windows', 'closePluginWindows', 'Alt+F12'),
        item('Close All Unfocused Windows', 'closeUnfocusedWindows', 'CmdOrCtrl+F12'),
        sep,
        { role: 'togglefullscreen' },
        ...(DEV_URL ? [sep, { role: 'reload' }, { role: 'toggleDevTools' }] : []),
      ],
    },
    {
      label: 'Options',
      submenu: [
        item('Audio Settings…', 'audioSettings'),
        item('Manage Plugins…', 'pluginPicker'),
        item('Project Info…', 'projectInfo'),
        sep,
        item('Typing Keyboard to Piano', 'typingKeyboard', 'CmdOrCtrl+T'),
        item('Metronome', 'metronome', 'CmdOrCtrl+M'),
        item('Recording Precount', 'precount', 'CmdOrCtrl+P'),
        item('Start on Input', 'startOnInput', 'CmdOrCtrl+I'),
      ],
    },
    {
      label: 'Tools',
      submenu: [
        item('Create Automation Clip (Last Tweaked)', 'lastTweakedAutomation'),
        sep,
        {
          label: 'Dump Score Log to Selected Pattern',
          submenu: [
            item('Last Minute', 'dumpScoreLog1'),
            item('Last 2 Minutes', 'dumpScoreLog2'),
            item('Last 5 Minutes', 'dumpScoreLog5'),
            item('Last 10 Minutes', 'dumpScoreLog10'),
          ],
        },
        item('Clear Score Log', 'clearScoreLog'),
      ],
    },
    // Own window menu: the default one claims Cmd+M, which is FL Studio's metronome shortcut.
    {
      label: 'Window',
      submenu: [
        { role: 'minimize', accelerator: 'Alt+CmdOrCtrl+M' },
        { role: 'zoom' },
        ...(isMac ? [sep, { role: 'front' }] : [{ role: 'close' }]),
      ],
    },
    { role: 'help', submenu: [item('Keyboard Shortcuts', 'shortcuts', 'F1'), item('About MAD Studio', 'about')] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------- IPC

function registerIpc() {
  ipcMain.handle('file:save', async (event, opts) => {
    if (!isTrustedSender(event) || !(opts?.data instanceof Uint8Array)) return null;
    const requested = typeof opts.path === 'string' && opts.path ? path.resolve(opts.path) : null;
    let target = requested && userChosenPaths.has(requested) ? requested : null;
    if (!target) {
      const res = await dialog.showSaveDialog(mainWindow, {
        defaultPath: typeof opts.suggestedName === 'string' ? opts.suggestedName : 'Untitled',
        filters: Array.isArray(opts.filters) ? opts.filters : [],
      });
      if (res.canceled || !res.filePath) return null;
      target = path.resolve(res.filePath);
      userChosenPaths.add(target);
    }
    await fs.writeFile(target, Buffer.from(opts.data));
    if (isMac) app.addRecentDocument(target);
    return { path: target, name: path.basename(target) };
  });

  ipcMain.handle('file:open', async (event, opts) => {
    if (!isTrustedSender(event)) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: opts?.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: Array.isArray(opts?.filters) ? opts.filters : [],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return Promise.all(res.filePaths.map(readFileForRenderer));
  });

  ipcMain.handle('file:choose-folder', async (event, title) => {
    if (!isTrustedSender(event)) return null;
    const res = await dialog.showOpenDialog(mainWindow, { title: typeof title === 'string' ? title : 'Choose folder', properties: ['openDirectory'] });
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
  });

  ipcMain.on('window:set-edited', (event, edited) => {
    if (!isTrustedSender(event)) return;
    documentEdited = Boolean(edited);
    if (isMac && mainWindow) mainWindow.setDocumentEdited(documentEdited);
  });

  ipcMain.on('window:set-title', (event, title) => {
    if (isTrustedSender(event) && mainWindow) mainWindow.setTitle(String(title).slice(0, 200));
  });

  ipcMain.on('file:ready-for-open', (event) => {
    if (!isTrustedSender(event)) return;
    rendererReadyForFiles = true;
    for (const file of pendingFiles.splice(0)) mainWindow.webContents.send('file:opened', file);
  });

  ipcMain.on('app:ready', (event) => {
    if (!isTrustedSender(event)) return;
    if (SMOKE) {
      console.log('MAD_STUDIO_SMOKE_OK');
      // With a bundled engine the smoke test also waits for the engine: its "ready", then a
      // ping/pong round trip over stdio.
      if (!engine?.available) return void app.exit(0);
      const deadline = setTimeout(() => {
        console.log('MAD_STUDIO_ENGINE_FAILED');
        app.exit(1);
      }, 30_000);
      smokeEngineDone = () => {
        clearTimeout(deadline);
        console.log('MAD_STUDIO_ENGINE_PONG');
        app.exit(0);
      };
      const waitReady = setInterval(() => {
        if (!lastEngineReady) return;
        clearInterval(waitReady);
        engine.send({ type: 'ping', requestId: 'smoke' });
      }, 100);
    }
  });

  // --- native audio engine relay (engine/PROTOCOL.md)
  ipcMain.on('engine:info', (event) => {
    event.returnValue = isTrustedSender(event) && engine ? { available: engine.available, recordFolder: engine.recordFolder } : { available: false, recordFolder: '' };
  });
  ipcMain.on('engine:subscribe', (event) => {
    if (isTrustedSender(event) && lastEngineReady) event.sender.send('engine:message', lastEngineReady);
  });
  ipcMain.on('engine:send', (event, msg) => {
    if (isTrustedSender(event)) engine?.send(msg);
  });
  ipcMain.on('engine:restart', (event) => {
    if (isTrustedSender(event)) engine?.restart();
  });
  ipcMain.handle('engine:load-sample', async (event, opts) => {
    if (!isTrustedSender(event) || !engine || !opts || !Array.isArray(opts.channels)) return;
    const channels = opts.channels.filter((c) => c instanceof Float32Array);
    await engine.loadSample(String(opts.id), Number(opts.sampleRate), channels);
  });
  ipcMain.handle('engine:read-file', async (event, filePath) => {
    if (!isTrustedSender(event) || !engine) throw new Error('Access denied');
    return engine.readFile(filePath);
  });
  ipcMain.handle('engine:temp-path', (event, name) => {
    if (!isTrustedSender(event) || !engine) return null;
    return engine.tempPath(name);
  });
}

// ---------------------------------------------------------------- window

function createWindow() {
  const state = loadWindowState();
  mainWindow = new BrowserWindow({
    width: state.width || 1440,
    height: state.height || 900,
    x: state.x,
    y: state.y,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    title: 'MAD Studio',
    backgroundColor: '#121619',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 21 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  if (state.maximized) mainWindow.maximize();

  mainWindow.once('ready-to-show', () => {
    if (!SMOKE) mainWindow.show();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(APP_ORIGIN) && !(DEV_URL && url.startsWith(DEV_URL))) e.preventDefault();
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    if (SMOKE) {
      console.error('Renderer crashed:', details.reason);
      app.exit(1);
    }
  });
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    if (SMOKE) {
      console.error('Load failed:', code, desc);
      app.exit(1);
    }
  });
  if (SMOKE) {
    mainWindow.webContents.on('console-message', (event) => {
      const level = event.level ?? '';
      if (level === 'error' || level === 3) console.error('[renderer]', event.message);
    });
  }

  mainWindow.on('close', (e) => {
    saveWindowState(mainWindow);
    if (!documentEdited || SMOKE || TEST_PROFILE) return;
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['Quit', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'You have unsaved changes.',
      detail: 'The session is autosaved and restored on the next start, but it is not written to a project file.',
    });
    if (choice === 1) e.preventDefault();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    rendererReadyForFiles = false;
  });

  void mainWindow.loadURL(DEV_URL || `${APP_ORIGIN}/index.html`);
}

// ---------------------------------------------------------------- lifecycle

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  void deliverOpenedFile(filePath);
});

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    const filePath = path.normalize(path.join(DIST, rel));
    if (!filePath.startsWith(DIST + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(filePath).toString());
  });

  // Web MIDI for hardware keyboards and audio-only capture (recording without the native engine);
  // everything else (camera, screen, location, …) is denied.
  const allowed = new Set(['midi', 'midiSysex']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    if (permission === 'media') {
      const types = Array.isArray(details?.mediaTypes) ? details.mediaTypes : [];
      return callback(types.length > 0 && types.every((t) => t === 'audio'));
    }
    callback(allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, _origin, details) =>
    permission === 'media' ? details?.mediaType === 'audio' : allowed.has(permission),
  );

  engine = new EngineHost(sendEngineMessage);
  registerIpc();
  buildMenu();
  createWindow();
  engine.start();

  // Files passed on the command line (Windows/Linux, or `open -a`).
  for (const arg of process.argv.slice(1)) {
    if (arg.endsWith('.madstudio') && fsSync.existsSync(arg)) void deliverOpenedFile(arg);
  }

  if (SMOKE) {
    setTimeout(() => {
      console.error('Smoke test timed out');
      app.exit(1);
    }, 45000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac || SMOKE) app.quit();
});

app.on('will-quit', () => engine?.stop());
