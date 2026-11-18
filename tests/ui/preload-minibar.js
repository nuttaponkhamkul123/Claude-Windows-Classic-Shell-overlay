// Stub of the mini bar's preload (minibar-preload.js): the test feeds data in through window.__feed and reads
// what the page sent out from window.__calls.
const cb = {};
window.__calls = [];
const rec = (name) => (...a) => { window.__calls.push([name, ...a]); };
window.__feed = (kind, v) => cb[kind] && cb[kind](v);
window.barAPI = {
  settings: { uiStyle: 'pip' },
  onSessions: (f) => { cb.sessions = f; }, onPerms: (f) => { cb.perms = f; },
  onQueues: (f) => { cb.queues = f; }, onPrefs: (f) => { cb.prefs = f; },
  setHeight: rec('height'), setIgnore: rec('ignore'), menu: rec('menu'), close: rec('close'),
  openChat: rec('open'), resumeQueue: rec('resume'), respondPermission: rec('perm'),
  stopReply: (id) => { window.__calls.push(['stop', id]); return Promise.resolve(true); },
  sendReply: rec('send'),
  getUsageToday: () => Promise.resolve({ tokens: 1234567 }),
  getSessionCosts: () => Promise.resolve({ a: 1.5 }),
};
