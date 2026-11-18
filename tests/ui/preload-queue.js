// the harness preload, with a settings store that survives a page reload (to test the queue across a "restart")
require('./preload.js');
const api = window.electronAPI;
const read = () => { try { return JSON.parse(localStorage.getItem('fakeStore') || '{}'); } catch (_) { return {}; } };
api.storeGetAll = async () => read();
api.storeSet = (k, v) => { const s = read(); s[k] = v; localStorage.setItem('fakeStore', JSON.stringify(s)); };
window.__sent = [];
api.sendReply = (p) => { window.__sent.push(p.text); return Promise.resolve(true); };
