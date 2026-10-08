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

const MENU_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ACCELERATOR = /^(?:(?:Shift|Alt|CmdOrCtrl)\+){0,3}(?:[A-Z0-9]|F[0-9]{1,2}|Backspace|Delete|Enter|Escape|Space|Tab|Up|Down|Left|Right|Plus|[-=[\]\\;',./`@^])$/;
/** Commands the OS handles through roles, so the renderer receives real clipboard events. */
const ROLE_COMMANDS = { cut: 'cut', copy: 'copy', paste: 'paste' };

/** Drops separators at the ends and repeated ones (left over when items are filtered). */
function tidy(items) {
  const out = [];
  for (const it of items) {
    if (it.type === 'separator' && (out.length === 0 || out[out.length - 1].type === 'separator')) continue;
    out.push(it);
  }
  while (out.length && out[out.length - 1].type === 'separator') out.pop();
  return out;
}

/**
 * Converts the renderer's menu template (built from the same command table as the in-window menu bar)
 * into Electron menu items. Everything is validated: the template crosses the IPC boundary.
 */
function fromTemplate(items, depth) {
  if (!Array.isArray(items) || depth > 3) return [];
  const out = [];
  for (const it of items.slice(0, 100)) {
    if (!it || typeof it !== 'object') continue;
    if (it.separator === true) {
      out.push(sep);
      continue;
    }
    const label = typeof it.label === 'string' ? it.label.slice(0, 100) : '';
    if (!label) continue;
    if (Array.isArray(it.submenu)) {
      out.push({ label, submenu: fromTemplate(it.submenu, depth + 1) });
      continue;
    }
    if (typeof it.id !== 'string' || !MENU_ID.test(it.id)) continue;
    // macOS keeps Preferences in the application menu.
    if (isMac && it.id === 'preferences') continue;
    if (ROLE_COMMANDS[it.id]) {
      out.push({ role: ROLE_COMMANDS[it.id] });
      continue;
    }
    const accelerator = typeof it.accelerator === 'string' && ACCELERATOR.test(it.accelerator) ? it.accelerator : undefined;
    out.push(item(label, it.id, accelerator));
  }
  return tidy(out);
}

const sep = { type: 'separator' };

// Shortcuts are handled in the renderer; menu accelerators are display-only to avoid double triggers.
function item(label, action, accelerator) {
  return { label, click: () => send(action), ...(accelerator ? { accelerator, registerAccelerator: false } : {}) };
}

/** Builds the menu bar; `template` comes from the renderer (null until it has loaded). */
function buildMenu(template) {
  const appMenu = isMac
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
    : [];
  const menus = Array.isArray(template) ? template.slice(0, 12) : [];
  const built = menus
    .filter((m) => m && typeof m.label === 'string' && Array.isArray(m.submenu))
    .map((m) => {
      const label = m.label.slice(0, 40);
      const submenu = fromTemplate(m.submenu, 1);
      if (label === 'File' && !isMac) submenu.push(sep, { role: 'quit' });
      if (label === 'View') submenu.push(sep, { role: 'togglefullscreen' }, ...(DEV_URL ? [sep, { role: 'reload' }, { role: 'toggleDevTools' }] : []));
      if (label === 'Window') submenu.push(sep, { role: 'minimize' }, { role: 'zoom' });
      return label === 'Help' ? { role: 'help', submenu } : { label, submenu };
    });
  // Until the renderer sends its menus, keep the clipboard and window basics available.
  const fallback = [
    { label: 'Edit', submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate([...appMenu, ...(built.length ? built : fallback)]));
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

  ipcMain.on('menu:set', (event, template) => {
    if (!isTrustedSender(event)) return;
    try {
      buildMenu(template);
    } catch (err) {
      console.error('Could not build the menu:', err);
      if (SMOKE) app.exit(1);
    }
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
      // The renderer sends its menus before it reports ready.
      const labels = Menu.getApplicationMenu()?.items.map((i) => i.label) ?? [];
      if (!labels.includes('Layer')) {
        console.error('The menu from the renderer is missing:', labels);
        app.exit(1);
        return;
      }
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
  buildMenu(null);
  createWindow();

  // Files passed on the command line (Windows/Linux, or `open -a`).
  for (const arg of process.argv.slice(1)) {
    if (/\.(madpaint|psd|psb)$/i.test(arg) && fsSync.existsSync(arg)) void deliverOpenedFile(arg);
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
