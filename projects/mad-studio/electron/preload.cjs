// Minimal, typed bridge between the sandboxed renderer and the main process.
const { contextBridge, ipcRenderer } = require('electron');

// Channels are spelled out literally (no generic subscribe helper) so the IPC surface
// stays auditable, e.g. with REA's static Electron analysis.
const engineInfo = ipcRenderer.sendSync('engine:info');

contextBridge.exposeInMainWorld('madNative', {
  // Native audio engine (VST3/AU hosting, recording) – relayed by the main process.
  engine: {
    available: Boolean(engineInfo && engineInfo.available),
    recordFolder: String((engineInfo && engineInfo.recordFolder) || ''),
    send: (message) => ipcRenderer.send('engine:send', message),
    onMessage: (cb) => {
      const handler = (_event, message) => cb(message);
      ipcRenderer.on('engine:message', handler);
      ipcRenderer.send('engine:subscribe');
      return () => ipcRenderer.removeListener('engine:message', handler);
    },
    loadSample: (id, sampleRate, channels) => ipcRenderer.invoke('engine:load-sample', { id, sampleRate, channels }),
    readFile: (filePath) => ipcRenderer.invoke('engine:read-file', filePath),
    tempPath: (name) => ipcRenderer.invoke('engine:temp-path', name),
    restart: () => ipcRenderer.send('engine:restart'),
  },
  platform: process.platform,
  saveFile: (opts) => ipcRenderer.invoke('file:save', opts),
  openFile: (opts) => ipcRenderer.invoke('file:open', opts),
  chooseFolder: (title) => ipcRenderer.invoke('file:choose-folder', title),
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
  ready: () => ipcRenderer.send('app:ready'),
});
