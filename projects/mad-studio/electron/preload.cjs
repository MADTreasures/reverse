// Minimal, typed bridge between the sandboxed renderer and the main process.
const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, cb) {
  const handler = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('madNative', {
  platform: process.platform,
  saveFile: (opts) => ipcRenderer.invoke('file:save', opts),
  openFile: (opts) => ipcRenderer.invoke('file:open', opts),
  onMenu: (cb) => subscribe('menu:action', cb),
  onOpenFile: (cb) => {
    const off = subscribe('file:opened', cb);
    ipcRenderer.send('file:ready-for-open');
    return off;
  },
  setDocumentEdited: (edited) => ipcRenderer.send('window:set-edited', Boolean(edited)),
  setTitle: (title) => ipcRenderer.send('window:set-title', String(title)),
  ready: () => ipcRenderer.send('app:ready'),
});
