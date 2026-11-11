const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snipAPI', {
  onImage: (cb) => ipcRenderer.on('snip-image', (_e, dataUrl) => cb(dataUrl)),
  // rect in CSS pixels of the snip window, or null to cancel
  done: (rect) => ipcRenderer.send('snip-result', rect),
});
