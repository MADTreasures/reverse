// Minimal, typed bridge between the sandboxed renderer and the main process.
const { contextBridge, ipcRenderer } = require('electron');

// Channels are spelled out literally (no generic subscribe helper) so the IPC surface
// stays auditable, e.g. with REA's static Electron analysis.
contextBridge.exposeInMainWorld('madPaint', {
  platform: process.platform,
  saveFile: (opts) => ipcRenderer.invoke('file:save', opts),
  openFile: (opts) => ipcRenderer.invoke('file:open', opts),
  onMenu: (cb) => {
    const handler = (_event, action) => cb(action);
    ipcRenderer.on('menu:action', handler);
    return () => ipcRenderer.removeListener('menu:action', handler);
  },
  onOpenFile: (cb) => {
    const handler = (_event, file) => cb(file);
    ipcRenderer.on('file:opened', handler);
    ipcRenderer.send('file:ready-for-open');
    return () => ipcRenderer.removeListener('file:opened', handler);
  },
  setDocumentEdited: (edited) => ipcRenderer.send('window:set-edited', Boolean(edited)),
  setTitle: (title) => ipcRenderer.send('window:set-title', String(title)),
  setMenu: (template) => ipcRenderer.send('menu:set', template),
  ready: () => ipcRenderer.send('app:ready'),
});
