// MAD Studio Paint – Electron main process (macOS app shell around the web build in ../dist).
const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, session, shell } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');
const DEV_URL = process.env.MAD_PAINT_DEV_URL || '';
const SMOKE = process.argv.includes('--smoke-test');
const APP_ORIGIN = 'app://mad-studio-paint';
const isMac = process.platform === 'darwin';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);
app.setName('MAD Studio Paint');

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
  // Cut / copy / paste use roles so the renderer receives the clipboard events.
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
            label: 'MAD Studio Paint',
            submenu: [
              item('About MAD Studio Paint', 'about'),
              sep,
              item('Preferences…', 'preferences', 'CmdOrCtrl+K'),
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
        item('New…', 'new', 'CmdOrCtrl+N'),
        item('Open…', 'open', 'CmdOrCtrl+O'),
        sep,
        item('Save', 'save', 'CmdOrCtrl+S'),
        item('Save as…', 'saveAs', 'Shift+CmdOrCtrl+S'),
        sep,
        item('Import image as layer…', 'importImage'),
        item('Export (single layer)…', 'export'),
        sep,
        item('Canvas name…', 'renameCanvas'),
        ...(isMac ? [] : [sep, item('Preferences…', 'preferences', 'CmdOrCtrl+K'), sep, { role: 'quit' }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        item('Undo', 'undo', 'CmdOrCtrl+Z'),
        item('Redo', 'redo', 'CmdOrCtrl+Y'),
        sep,
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        item('Delete', 'clear', 'Backspace'),
        item('Delete outside selected area', 'clearOutside', 'Shift+Backspace'),
        sep,
        item('Fill', 'fill', 'Alt+Backspace'),
        item('Tonal correction: Hue/Saturation/Luminosity…', 'hsl', 'CmdOrCtrl+U'),
        item('Tonal correction: Brightness/Contrast…', 'brightnessContrast'),
        item('Tonal correction: Reverse gradient', 'negative', 'CmdOrCtrl+I'),
        sep,
        item('Transform: Scale up/Scale down/Rotate', 'transform', 'CmdOrCtrl+T'),
        item('Transform: Free transform', 'freeTransform', 'Shift+CmdOrCtrl+T'),
        item('Flip layer horizontal', 'flipLayerH'),
        item('Flip layer vertical', 'flipLayerV'),
        sep,
        item('Change image resolution…', 'imageResolution'),
        item('Change canvas size…', 'canvasSize'),
      ],
    },
    {
      label: 'Layer',
      submenu: [
        item('New raster layer', 'newRasterLayer', 'Shift+CmdOrCtrl+N'),
        item('New layer folder', 'newFolder'),
        item('Create folder and insert layer', 'groupLayer', 'CmdOrCtrl+G'),
        item('Ungroup layer folder', 'ungroupLayer', 'Shift+CmdOrCtrl+G'),
        sep,
        item('Duplicate layer', 'duplicateLayer'),
        item('Delete layer', 'deleteLayer'),
        sep,
        item('Clip to layer below', 'clip', 'Alt+CmdOrCtrl+G'),
        item('Set as reference layer', 'reference'),
        item('Set as draft layer', 'draft'),
        item('Lock layer', 'lockLayer', 'CmdOrCtrl+L'),
        item('Lock transparent pixels', 'lockAlpha'),
        sep,
        item('Merge with layer below', 'mergeDown', 'CmdOrCtrl+E'),
        item('Merge visible layers', 'mergeVisible', 'Shift+CmdOrCtrl+E'),
        item('Flatten image', 'flatten'),
        sep,
        item('Select layer above', 'selectLayerAbove', 'Alt+]'),
        item('Select layer below', 'selectLayerBelow', 'Alt+['),
      ],
    },
    {
      label: 'Select',
      submenu: [
        item('Select all', 'selectAll', 'CmdOrCtrl+A'),
        item('Deselect', 'deselect', 'CmdOrCtrl+D'),
        item('Reselect', 'reselect', 'Shift+CmdOrCtrl+D'),
        item('Invert selected area', 'invertSelection', 'Shift+CmdOrCtrl+I'),
        sep,
        item('Expand selected area…', 'expandSelection'),
        item('Shrink selected area…', 'shrinkSelection'),
      ],
    },
    {
      label: 'View',
      submenu: [
        item('Zoom in', 'zoomIn', 'CmdOrCtrl+='),
        item('Zoom out', 'zoomOut', 'CmdOrCtrl+-'),
        item('100%', 'actualPixels', 'Alt+CmdOrCtrl+0'),
        item('Fit to screen', 'fit', 'CmdOrCtrl+0'),
        item('Reset display', 'resetDisplay'),
        sep,
        item('Rotate left', 'rotateLeft', '-'),
        item('Rotate right', 'rotateRight', '='),
        item('Rotate 90°', 'rotate90'),
        item('Rotate 180°', 'rotate180'),
        item('Rotate 270°', 'rotate270'),
        item('Reset rotation', 'resetRotation'),
        item('Flip horizontal', 'flipViewH'),
        item('Flip vertical', 'flipViewV'),
        sep,
        item('Selection launcher', 'selectionLauncher'),
        item('Show border of selected area', 'selectionBorder'),
        { role: 'togglefullscreen' },
        ...(DEV_URL ? [sep, { role: 'reload' }, { role: 'toggleDevTools' }] : []),
      ],
    },
    {
      label: 'Filter',
      submenu: [item('Blur: Gaussian blur…', 'gaussianBlur')],
    },
    {
      label: 'Window',
      submenu: [
        item('Workspace: Default', 'workspaceDefault'),
        item('Workspace: Classic layout', 'workspaceClassic'),
        sep,
        item('Hide all palettes', 'togglePalettes', 'Tab'),
        item('Hide title bar and menu bar', 'toggleMenuBar', 'Shift+Tab'),
        sep,
        { role: 'minimize' },
        { role: 'zoom' },
      ],
    },
    { role: 'help', submenu: [item('Keyboard Shortcuts', 'shortcuts', 'F1'), item('About MAD Studio Paint', 'about')] },
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
      console.log('MAD_PAINT_SMOKE_OK');
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
    title: 'MAD Studio Paint',
    backgroundColor: '#3f3f3f',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 13 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
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
      detail: 'The canvas is autosaved and restored on the next start, but it is not written to a .madpaint file.',
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

  // Clipboard access for copy/paste of images; everything else is denied.
  const allowed = new Set(['clipboard-read', 'clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  registerIpc();
  buildMenu();
  createWindow();

  // Files passed on the command line (Windows/Linux, or `open -a`).
  for (const arg of process.argv.slice(1)) {
    if (arg.endsWith('.madpaint') && fsSync.existsSync(arg)) void deliverOpenedFile(arg);
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
