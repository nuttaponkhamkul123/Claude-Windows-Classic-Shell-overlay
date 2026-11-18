// Bridge for the mini bar (ui/minibar.html). Only these calls exist.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('barAPI', {
  settings: ipcRenderer.sendSync('store-get-sync') || {},
  onSessions: (cb) => ipcRenderer.on('minibar:sessions', (_e, v) => cb(v)),
  onPerms: (cb) => ipcRenderer.on('minibar:perms', (_e, v) => cb(v)),
  onQueues: (cb) => ipcRenderer.on('minibar:queues', (_e, v) => cb(v)),
  onPrefs: (cb) => ipcRenderer.on('minibar:prefs', (_e, v) => cb(v)),
  setHeight: (h) => ipcRenderer.send('minibar:size', h),
  setIgnore: (on) => ipcRenderer.send('minibar:ignore', on),
  menu: () => ipcRenderer.send('minibar:menu'),
  close: () => ipcRenderer.send('minibar:close'),
  openChat: (sessionId) => ipcRenderer.send('minibar:open', sessionId),
  resumeQueue: () => ipcRenderer.send('minibar:resume-queue'),
  respondPermission: (id, choice) => ipcRenderer.send('permission-response', { id, choice }),
  stopReply: (sessionId) => ipcRenderer.invoke('stop-reply', sessionId),
  sendReply: (text, session) => ipcRenderer.send('send-reply', { text, session, options: {} }),
  getUsageToday: () => ipcRenderer.invoke('get-usage-today'),
  getSessionCosts: (ids) => ipcRenderer.invoke('get-session-costs', ids),
});
