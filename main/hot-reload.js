// Hot reload while developing the HUD itself.
//   ui/*.css          → swapped in place (no reload: nothing on screen is lost)
//   ui/*.js, *.html   → the window refreshes; the open chat + unsent text come back
//   main-process code → an "Update ready — Restart" bar (never restarts on its own,
//                       so a running reply is not cut off)
// Off in a packaged build. Uses fs.watch (recursive works on Windows/macOS).

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const ROOT = path.join(__dirname, '..');
const IGNORE = /(^|[\\/])(node_modules|\.git|\.claude|dist|tools)([\\/]|$)|\.tmp\.|~$|\.log$/i;
// main-process files: changes need a restart (mcp/pinner.js is run by Claude, not by the HUD)
const isMainSide = (rel) => /^(main|watcher|features-main|skill-install-main|usage|approval-shell|preload|notes-preload|snip-preload|run)\.js$/i.test(rel) ||
  /^(main|mcp)[\\/].+\.js$/i.test(rel) && !/^mcp[\\/]pinner\.js$/i.test(rel);

function register({ getWin, getNotesWin }) {
  if (app.isPackaged) return;
  let timer = null;
  const pending = { css: new Set(), page: false, notesPage: false, main: new Set() };

  const flush = () => {
    timer = null;
    const win = getWin();
    const notes = getNotesWin ? getNotesWin() : null;
    const alive = (w) => w && !w.isDestroyed();
    if (pending.main.size && alive(win)) {
      win.webContents.send('hot:update-ready', [...pending.main]);
    }
    if (pending.page && alive(win)) {
      win.webContents.send('hot:before-reload'); // renderer saves the open chat + draft
      setTimeout(() => alive(win) && win.webContents.reloadIgnoringCache(), 120);
    } else if (pending.css.size && alive(win)) {
      win.webContents.send('hot:css', [...pending.css]);
    }
    if (alive(notes) && (pending.notesPage || [...pending.css].some((f) => /notes\.css$/i.test(f)))) {
      notes.webContents.reloadIgnoringCache();
    }
    pending.css.clear(); pending.page = false; pending.notesPage = false; pending.main.clear();
  };

  let watcher;
  try {
    watcher = fs.watch(ROOT, { recursive: true }, (_ev, file) => {
      if (!file) return;
      const rel = String(file).replace(/\\/g, '/');
      if (IGNORE.test(rel)) return;
      if (/^ui\/.+\.css$/i.test(rel)) pending.css.add(path.basename(rel));
      else if (/^ui\/(notes\.html|logic\/notes\.js)$/i.test(rel)) pending.notesPage = true;
      else if (/^ui\/.+\.(js|html|svg)$/i.test(rel) || /^robot_.*\.svg$/i.test(rel)) pending.page = true;
      else if (isMainSide(rel)) pending.main.add(rel);
      else return;
      clearTimeout(timer);
      timer = setTimeout(flush, 350); // editors save in bursts
    });
  } catch (e) {
    console.error('[hot-reload] could not watch:', e.message);
    return;
  }
  app.on('will-quit', () => { try { watcher.close(); } catch (_) {} });
}

module.exports = { register };
