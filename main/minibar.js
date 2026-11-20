// The mini bar: a slim always-on-top strip with the state of every chat, an approve/deny pair for tool
// approvals, the busiest chat's line with Stop, a queue badge, and (on hover) a short list of chats plus a
// one-line reply box. It is its own small window (ui/minibar.html); the big HUD window stays as it is.
//
// The window only draws what main tells it: sessions (from the watcher), pending approvals (mirrored from
// permissions.js) and the queue summary (reported by the HUD page). Answers go over the same IPC channels
// the HUD uses (permission-response, stop-reply, send-reply).
//
// Saved in settings as `miniBar`: { on, x, y, edge: 'top'|'bottom'|null, auto, through }.

const { BrowserWindow, Menu, ipcMain, screen } = require('electron');
const path = require('path');

const BAR_W = 760;
const BAR_H = 34;
const LINE_H = 6;      // auto-hidden: a thin line
const MAX_H = 440;
const SNAP = 48;       // px from a screen edge that snaps to it

function create({ features, getMainWin, showHud, onChange }) {
  let win = null;
  let sessions = [];
  const perms = new Map();      // approval id -> { id, sessionId, toolName, input }
  let queues = {};              // sessionId -> { n, held }
  let curH = BAR_H;
  let barPos = null;            // top-left of the collapsed bar
  let moving = false;           // our own setBounds, not a user drag

  const prefs = () => {
    const p = features.getSetting('miniBar', null);
    return { on: false, x: null, y: null, edge: 'top', auto: false, through: false, ...(p && typeof p === 'object' ? p : {}) };
  };
  const savePrefs = (patch) => features.setSetting('miniBar', { ...prefs(), ...patch });

  const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };
  const fromBar = (e) => win && !win.isDestroyed() && e.sender === win.webContents;
  const area = (pt) => screen.getDisplayNearestPoint(pt).workArea;

  // where the collapsed bar sits (clamped to a screen)
  function homePos() {
    const p = prefs();
    const wa = area(p.x != null ? { x: p.x, y: p.y || 0 } : screen.getPrimaryDisplay().workArea);
    const w = Math.min(BAR_W, wa.width - 20);
    const x = Math.max(wa.x, Math.min(p.x != null ? p.x : Math.round(wa.x + (wa.width - w) / 2), wa.x + wa.width - w));
    const y = p.edge === 'bottom' ? wa.y + wa.height - BAR_H
      : p.edge === 'top' ? wa.y
      : Math.max(wa.y, Math.min(p.y != null ? p.y : wa.y, wa.y + wa.height - BAR_H));
    return { x, y, w };
  }

  // size the window to `h`, keeping the bar where it is (grows down; up when stuck to the bottom edge)
  function applyHeight(h) {
    if (!win || win.isDestroyed()) return;
    const want = Math.max(LINE_H, Math.min(MAX_H, Math.round(h)));
    curH = want <= LINE_H ? BAR_H : want; // the thin line is the full bar window clipped to a strip (see setShape below)
    barPos = barPos || homePos();
    const wa = area({ x: barPos.x, y: barPos.y });
    const w = Math.min(BAR_W, wa.width - 20);
    const bottom = prefs().edge === 'bottom';
    let y = bottom ? barPos.y + BAR_H - curH : barPos.y;
    y = Math.max(wa.y, Math.min(y, wa.y + wa.height - curH));
    moving = true;
    win.setBounds({ x: barPos.x, y, width: w, height: curH });
    if (want <= LINE_H) win.setShape([{ x: 0, y: bottom ? BAR_H - LINE_H : 0, width: w, height: LINE_H }]);
    else win.setShape([]);
    setTimeout(() => { moving = false; }, 80);
  }

  function open() {
    if (win && !win.isDestroyed()) { win.showInactive(); return; }
    barPos = homePos();
    win = new BrowserWindow({
      width: barPos.w, height: BAR_H, x: barPos.x, y: barPos.y,
      frame: false, alwaysOnTop: true, resizable: false, hasShadow: false, backgroundColor: '#10151c', // (a transparent window cannot be under ~39px high on Windows)
      skipTaskbar: true, show: false, focusable: true, minimizable: false, maximizable: false, fullscreenable: false,
      webPreferences: { preload: path.join(__dirname, '..', 'minibar-preload.js'), contextIsolation: true, nodeIntegration: false },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.loadFile(path.join(__dirname, '..', 'ui', 'minibar.html'));
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.once('ready-to-show', () => { win.showInactive(); pushAll(); });
    win.on('moved', () => {
      if (moving || !win || win.isDestroyed()) return;
      // dropped by the user: stick to the top or bottom edge if close, remember the place
      const b = win.getBounds();
      const wa = area({ x: b.x + b.width / 2, y: b.y + 8 });
      let edge = null;
      // the bar's own top: an open panel hangs below it, or above it when the bar sits on the bottom edge
      const barTop = prefs().edge === 'bottom' ? b.y + b.height - BAR_H : b.y;
      if (barTop <= wa.y + SNAP) edge = 'top';
      else if (barTop + BAR_H >= wa.y + wa.height - SNAP) edge = 'bottom';
      const x = Math.max(wa.x, Math.min(b.x, wa.x + wa.width - b.width));
      const y = edge === 'top' ? wa.y : edge === 'bottom' ? wa.y + wa.height - BAR_H : Math.max(wa.y, Math.min(barTop, wa.y + wa.height - BAR_H));
      savePrefs({ x, y, edge });
      barPos = { x, y, w: b.width };
      applyHeight(curH);
    });
    const mine = win;
    win.on('closed', () => { if (win === mine) win = null; }); // (a late 'closed' of an old window must not drop a newer one)
    savePrefs({ on: true });
    if (onChange) onChange();
  }

  function close() {
    savePrefs({ on: false });
    if (win && !win.isDestroyed()) win.close();
    win = null;
    if (onChange) onChange();
  }

  function pushAll() {
    send('minibar:sessions', sessions);
    send('minibar:perms', [...perms.values()]);
    send('minibar:queues', queues);
    send('minibar:prefs', prefs());
  }

  // ---- fed by main.js / permissions.js ----
  function onSessions(list) {
    sessions = (list || []).map((s) => ({
      id: s.id, sessionUuid: s.sessionUuid, source: s.source, project: s.project, cwd: s.cwd,
      sessionTitle: s.sessionTitle, title: s.title, detail: s.detail, status: s.status, state: s.state,
      statusLabel: s.statusLabel, unread: !!s.unread, activity: s.activity || null, context: s.context || null,
      model: s.model, mtime: s.mtime,
    }));
    send('minibar:sessions', sessions);
  }
  function mirror(channel, payload) {
    if (channel === 'permission-request' && payload && payload.id) {
      perms.set(payload.id, { id: payload.id, sessionId: payload.sessionId, toolName: payload.toolName, input: payload.input });
      send('minibar:perms', [...perms.values()]);
    } else if (channel === 'permission-expired' && payload && perms.delete(payload.id)) {
      send('minibar:perms', [...perms.values()]);
    }
  }

  // ---- the bar's own requests ----
  function menu() {
    const p = prefs();
    Menu.buildFromTemplate([
      { label: 'Open the HUD', click: () => showHud() },
      { type: 'separator' },
      { label: 'Hide when nothing needs me', type: 'checkbox', checked: !!p.auto, click: (i) => { savePrefs({ auto: i.checked }); send('minibar:prefs', prefs()); } },
      { label: 'Let clicks pass through the empty parts', type: 'checkbox', checked: !!p.through, click: (i) => { savePrefs({ through: i.checked }); send('minibar:prefs', prefs()); if (!i.checked && win && !win.isDestroyed()) win.setIgnoreMouseEvents(false); } },
      { type: 'separator' },
      { label: 'Close the mini bar', click: () => close() },
    ]).popup({ window: win });
  }

  ipcMain.on('minibar:size', (e, h) => { if (fromBar(e) && Number.isFinite(h)) applyHeight(h); });
  ipcMain.on('minibar:ignore', (e, on) => { if (fromBar(e)) win.setIgnoreMouseEvents(!!on, { forward: true }); });
  ipcMain.on('minibar:menu', (e) => { if (fromBar(e)) menu(); });
  ipcMain.on('minibar:close', (e) => { if (fromBar(e)) close(); });
  ipcMain.on('minibar:open', (e, sessionId) => {
    if (!fromBar(e)) return;
    showHud();
    const mw = getMainWin();
    if (sessionId && mw && !mw.isDestroyed()) mw.webContents.send('open-session', { sessionId: String(sessionId) });
  });
  ipcMain.on('minibar:resume-queue', (e) => {
    if (!fromBar(e)) return;
    const mw = getMainWin();
    if (mw && !mw.isDestroyed()) mw.webContents.send('queue-resume');
  });
  // the HUD page reports how many messages wait in each chat's queue
  ipcMain.on('queue-summary', (e, summary) => {
    const mw = getMainWin();
    if (!mw || mw.isDestroyed() || e.sender !== mw.webContents) return;
    const clean = {};
    for (const [id, v] of Object.entries(summary && typeof summary === 'object' ? summary : {}).slice(0, 100)) {
      if (v && Number.isFinite(v.n) && v.n > 0) clean[String(id).slice(0, 120)] = { n: v.n | 0, held: !!v.held };
    }
    queues = clean;
    send('minibar:queues', queues);
  });
  // an approval answered anywhere closes it everywhere
  ipcMain.on('permission-response', (e, msg) => {
    const id = msg && msg.id;
    if (!id || !perms.delete(id)) return;
    send('minibar:perms', [...perms.values()]);
    const mw = getMainWin();
    if (win && !win.isDestroyed() && e.sender === win.webContents && mw && !mw.isDestroyed()) mw.webContents.send('permission-expired', { id });
  });

  const fromHud = (e) => { const mw = getMainWin(); return mw && !mw.isDestroyed() && e.sender === mw.webContents; };
  ipcMain.handle('minibar:toggle', (e) => { if (!fromHud(e)) return false; toggle(); return isOn(); });
  ipcMain.handle('minibar:state', (e) => fromHud(e) && isOn());

  function toggle() { if (win && !win.isDestroyed()) close(); else open(); }
  const isOn = () => !!(win && !win.isDestroyed());
  function start() { if (prefs().on) open(); }
  // hide the bar for a moment (a screen snip must not show it); the returned function brings it back
  function hideTemp() {
    if (!win || win.isDestroyed() || !win.isVisible()) return null;
    win.hide();
    return () => { if (win && !win.isDestroyed()) win.showInactive(); };
  }
  function cleanup() { if (win && !win.isDestroyed()) win.destroy(); win = null; }

  return { start, toggle, open, close, isOn, onSessions, mirror, hideTemp, cleanup };
}

module.exports = { create };
