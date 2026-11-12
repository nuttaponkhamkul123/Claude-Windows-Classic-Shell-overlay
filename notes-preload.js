// Bridge for the pinned-notes panel (ui/notes.html). Only these calls exist.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notesAPI', {
  settings: ipcRenderer.sendSync('store-get-sync') || {},
  list: () => ipcRenderer.invoke('notes:list'),
  copy: (id) => ipcRenderer.invoke('notes:copy', id),
  openFile: (id) => ipcRenderer.invoke('notes:open-file', id),
  openFolder: () => ipcRenderer.invoke('notes:open-folder'),
  unpin: (id) => ipcRenderer.invoke('notes:unpin', id),
  close: () => ipcRenderer.invoke('notes:close'),
  onChanged: (cb) => ipcRenderer.on('notes:changed', () => cb()),
  onFocus: (cb) => ipcRenderer.on('notes:focus', (_e, id) => cb(id)),
  onTheme: (cb) => ipcRenderer.on('notes:theme', (_e, theme) => cb(theme)),
});
