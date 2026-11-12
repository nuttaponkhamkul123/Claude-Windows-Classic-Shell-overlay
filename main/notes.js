// Pinned notes: a side window docked to the LEFT of the HUD that shows the
// Markdown notes Claude pins with the ovly-pinner MCP tool (pinner-mcp.js).
// Notes live in ~/.ovly-claude/notes/*.md; this module watches that folder,
// opens the panel when a new note arrives, and keeps it glued to the HUD.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { BrowserWindow, ipcMain, shell, clipboard } = require('electron');

const NOTES_DIR = path.join(os.homedir(), '.ovly-claude', 'notes');
const TRASH_DIR = path.join(NOTES_DIR, '.unpinned');
const ID_RE = /^[0-9]{8}-[0-9]{6}-[a-z0-9-]{1,60}$/;
const PANEL_W = 340;
const GAP = 6;

let getMain = () => null;
let notesWin = null;
let watcher = null;
let known = new Set();
let changeTimer = null;

const fileOf = (id) => (ID_RE.test(String(id || '')) ? path.join(NOTES_DIR, `${id}.md`) : null);

function parse(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const meta = {};
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^(\w+):\s*(.*)$/);
      if (!kv) continue;
      try { meta[kv[1]] = JSON.parse(kv[2]); } catch (_) { meta[kv[1]] = kv[2]; }
    }
  }
  return { meta, body: m ? raw.slice(m[0].length) : raw };
}

function listNotes() {
  let files = [];
  try { files = fs.readdirSync(NOTES_DIR).filter((f) => f.endsWith('.md')); } catch (_) { return []; }
  const out = [];
  for (const f of files) {
    const id = f.slice(0, -3);
    if (!ID_RE.test(id)) continue;
    try {
      const { meta, body } = parse(fs.readFileSync(path.join(NOTES_DIR, f), 'utf8'));
      out.push({
        id,
        title: String(meta.title || id),
        project: String(meta.project || ''),
        cwd: String(meta.cwd || ''),
        pinned: String(meta.pinned || ''),
        tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
        body,
      });
    } catch (_) {}
  }
  out.sort((a, b) => (a.id < b.id ? 1 : -1)); // newest first (ids start with a timestamp)
  return out;
}

// ---- the docked window ----
function placeNextToHud() {
  const main = getMain();
  if (!notesWin || notesWin.isDestroyed() || !main || main.isDestroyed()) return;
  const b = main.getBounds();
  // HUD folded into its small edge tab: tuck the panel away until it opens again
  if (b.width < 300) { if (notesWin.isVisible()) notesWin.hide(); return; }
  notesWin.setBounds({ x: Math.max(0, b.x - PANEL_W - GAP), y: b.y, width: PANEL_W, height: b.height });
  if (!notesWin.isVisible() && main.isVisible() && !main.isMinimized()) notesWin.showInactive();
}

function openPanel(focusId) {
  const main = getMain();
  if (!main || main.isDestroyed()) return;
  if (notesWin && !notesWin.isDestroyed()) {
    placeNextToHud();
    notesWin.showInactive();
    if (focusId) notesWin.webContents.send('notes:focus', focusId);
    return;
  }
  notesWin = new BrowserWindow({
    // Owned by the HUD: stays on the HUD's virtual desktop and hides/minimizes with it.
    // (No skipTaskbar: on Windows that makes a "tool window", which shows on EVERY desktop;
    //  an owned window gets no taskbar button anyway.)
    parent: main,
    width: PANEL_W,
    height: main.getBounds().height,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'notes-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  notesWin.setAlwaysOnTop(true, 'screen-saver');
  notesWin.loadFile(path.join(__dirname, '..', 'ui', 'notes.html'));
  // links in notes open in the browser / editor, never inside the panel
  notesWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  notesWin.webContents.on('will-navigate', (e, url) => { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); });
  notesWin.once('ready-to-show', () => {
    placeNextToHud();
    notesWin.showInactive();
    if (focusId) notesWin.webContents.send('notes:focus', focusId);
  });
  notesWin.on('closed', () => { notesWin = null; tellMain(); });
  tellMain();
}

function closePanel() {
  if (notesWin && !notesWin.isDestroyed()) notesWin.close();
}

function tellMain() {
  const main = getMain();
  if (main && !main.isDestroyed()) {
    main.webContents.send('notes:state', { open: !!(notesWin && !notesWin.isDestroyed()), count: known.size });
  }
}

// ---- watch the folder; a NEW note opens the panel and highlights it ----
function onFolderChange() {
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => {
    const ids = new Set(listNotes().map((n) => n.id));
    const added = [...ids].filter((id) => !known.has(id));
    known = ids;
    if (notesWin && !notesWin.isDestroyed()) notesWin.webContents.send('notes:changed');
    if (added.length) openPanel(added.sort().pop());
    tellMain();
  }, 150);
}

function startWatching() {
  fs.mkdirSync(NOTES_DIR, { recursive: true });
  known = new Set(listNotes().map((n) => n.id));
  try { watcher = fs.watch(NOTES_DIR, onFolderChange); } catch (_) {}
}

function register({ getWin }) {
  getMain = getWin;
  startWatching();

  // keep the panel glued to the HUD
  const main = getMain();
  if (main) {
    main.on('move', placeNextToHud);
    main.on('resize', placeNextToHud);
    const hidePanel = () => notesWin && !notesWin.isDestroyed() && notesWin.hide();
    const showPanel = () => { if (notesWin && !notesWin.isDestroyed()) { placeNextToHud(); notesWin.showInactive(); } };
    main.on('minimize', hidePanel);
    main.on('hide', hidePanel);
    main.on('restore', showPanel);
    main.on('show', showPanel);
    main.on('closed', closePanel);
  }

  ipcMain.on('notes:theme', (_e, theme) => {
    if (notesWin && !notesWin.isDestroyed()) notesWin.webContents.send('notes:theme', String(theme || ''));
  });
  ipcMain.handle('notes:list', () => listNotes());
  ipcMain.handle('notes:toggle', () => {
    if (notesWin && !notesWin.isDestroyed()) closePanel(); else openPanel();
    return true;
  });
  ipcMain.handle('notes:state', () => ({ open: !!(notesWin && !notesWin.isDestroyed()), count: known.size }));
  ipcMain.handle('notes:close', () => { closePanel(); return true; });
  ipcMain.handle('notes:copy', (_e, id) => {
    const f = fileOf(id);
    if (!f || !fs.existsSync(f)) return false;
    clipboard.writeText(parse(fs.readFileSync(f, 'utf8')).body.trim());
    return true;
  });
  ipcMain.handle('notes:open-file', (_e, id) => {
    const f = fileOf(id);
    if (f && fs.existsSync(f)) shell.openPath(f);
    return !!f;
  });
  ipcMain.handle('notes:open-folder', () => { shell.openPath(NOTES_DIR); return true; });
  ipcMain.handle('notes:unpin', (_e, id) => {
    const f = fileOf(id);
    if (!f || !fs.existsSync(f)) return false;
    fs.mkdirSync(TRASH_DIR, { recursive: true });
    fs.renameSync(f, path.join(TRASH_DIR, `${id}.md`));
    return true;
  });
}

function cleanup() {
  try { watcher && watcher.close(); } catch (_) {}
  closePanel();
}

module.exports = { register, cleanup, NOTES_DIR };
