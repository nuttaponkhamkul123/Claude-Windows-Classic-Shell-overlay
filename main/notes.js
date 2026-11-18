// Pinned notes: the Markdown notes Claude pins with the ovly-pinner MCP tool (mcp/pinner.js).
// Notes live in ~/.ovly-claude/notes/*.md. This module reads and watches that folder and answers the
// HUD page (the Notes panel slides in from the right, ui/logic/chat/notes-panel.js). A NEW note is
// announced to the page, which opens the panel on it.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ipcMain, shell, clipboard } = require('electron');

const NOTES_DIR = path.join(os.homedir(), '.ovly-claude', 'notes');
const TRASH_DIR = path.join(NOTES_DIR, '.unpinned');
const ID_RE = /^[0-9]{8}-[0-9]{6}-[a-z0-9-]{1,60}$/;

let getMain = () => null;
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

// ---- the panel lives in the HUD page (ui/logic/chat/notes-panel.js); main only reads the folder ----
function tellMain(extra) {
  const main = getMain();
  if (main && !main.isDestroyed()) main.webContents.send('notes:state', { count: known.size, ...(extra || {}) });
}

// ---- watch the folder; a NEW note opens the panel and highlights it ----
function onFolderChange() {
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => {
    const ids = new Set(listNotes().map((n) => n.id));
    const added = [...ids].filter((id) => !known.has(id));
    known = ids;
    const main = getMain();
    if (main && !main.isDestroyed()) {
      main.webContents.send('notes:changed');
      if (added.length) main.webContents.send('notes:new', { id: added.sort().pop() });
    }
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

  ipcMain.handle('notes:list', () => listNotes());
  ipcMain.handle('notes:state', () => ({ count: known.size }));
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
}

module.exports = { register, cleanup, NOTES_DIR };
