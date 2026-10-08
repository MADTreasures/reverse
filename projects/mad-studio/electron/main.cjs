// MAD Studio – Electron main process (macOS app shell around the web build in ../dist).
const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, session, shell } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');
const DEV_URL = process.env.MAD_DEV_URL || '';
const SMOKE = process.argv.includes('--smoke-test');
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
        item('New Project', 'new', 'CmdOrCtrl+N'),
        item('Open…', 'open', 'CmdOrCtrl+O'),
        item('Open Demo Song', 'demo'),
        sep,
        item('Save', 'save', 'CmdOrCtrl+S'),
        item('Save As…', 'saveAs', 'Shift+CmdOrCtrl+S'),
        sep,
        item('Import Audio Files…', 'importSamples'),
        item('Export WAV…', 'export', 'CmdOrCtrl+R'),
        sep,
        item('Project Name…', 'projectInfo'),
        ...(isMac ? [] : [sep, { role: 'quit' }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        item('Undo', 'undo', 'CmdOrCtrl+Z'),
        item('Redo', 'redo', 'Shift+CmdOrCtrl+Z'),
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
        item('New Pattern', 'newPattern', 'CmdOrCtrl+F4'),
        item('Clone Pattern', 'clonePattern'),
        item('Rename Pattern…', 'renamePattern'),
        item('Delete Pattern…', 'deletePattern'),
        sep,
        item('Previous Pattern', 'prevPattern', '['),
        item('Next Pattern', 'nextPattern', ']'),
      ],
    },
    {
      label: 'Transport',
      submenu: [
        item('Play / Pause', 'playPause', 'Space'),
        item('Stop', 'stop'),
        item('Pattern / Song Mode', 'toggleMode', 'L'),
        item('Record', 'record', 'R'),
        item('Metronome', 'metronome', 'M'),
        item('Typing Keyboard to Piano', 'typingKeyboard', 'CmdOrCtrl+T'),
      ],
    },
    {
      label: 'View',
      submenu: [
        item('Playlist', 'window:playlist', 'F5'),
        item('Channel Rack', 'window:channelRack', 'F6'),
        item('Piano Roll', 'window:pianoRoll', 'F7'),
        item('Browser', 'toggleBrowser', 'F8'),
        item('Mixer', 'window:mixer', 'F9'),
        sep,
        { role: 'togglefullscreen' },
        ...(DEV_URL ? [sep, { role: 'reload' }, { role: 'toggleDevTools' }] : []),
      ],
    },
    { role: 'windowMenu' },
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
      app.exit(0);
    }
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
    if (!documentEdited || SMOKE) return;
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

  // Web MIDI for hardware keyboards; everything else is denied.
  const allowed = new Set(['midi', 'midiSysex']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  registerIpc();
  buildMenu();
  createWindow();

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
