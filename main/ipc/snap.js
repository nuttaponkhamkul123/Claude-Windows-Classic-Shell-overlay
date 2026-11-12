// Test nudge, the window shake animation, and multi-monitor quick snip.
//
// ctx.appState carries the short-lived animation flags shared with the drag
// handlers in main.js (dragTimer / boundsAnim) plus shakeTimer / lastNudgeAt,
// which only this module touches.

const { BrowserWindow, desktopCapturer, ipcMain, screen } = require('electron');
const path = require('path');

let snipInProgress = null;

function register(r) {
  // "Test Nudge" button: run the real nudge as if the most recent session finished.
  // Short delay so you can let go of the mouse / look at the window first.
  r.on('test-nudge', (ctx) => {
    setTimeout(() => {
      const latest = ctx.getWatcher() ? ctx.getWatcher().getAllSessions()[0] : null;
      ctx.appState.lastNudgeAt = 0; // bypass the 3-second limit for tests
      nudge(ctx, latest ? [latest] : []);
    }, 400);
  });

  // ---------- Quick snip (all monitors): hide the HUD, freeze every screen,
  // let the user drag a rectangle on any of them, return the cropped PNG ----------
  r.handle('quick-snip', async (ctx) => {
    if (snipInProgress) return snipInProgress;
    snipInProgress = (async () => {
      const win = ctx.getWin();
      const displays = screen.getAllDisplays();
      const wasVisible = win && win.isVisible();
      if (wasVisible) win.hide();
      await new Promise((resolve) => setTimeout(resolve, 220)); // let DWM drop the HUD from the screen

      let pairs = [];
      try {
        // one capture call for every screen; size the thumbnails for the largest physical display
        const maxW = Math.max(...displays.map((d) => Math.round(d.bounds.width * (d.scaleFactor || 1))));
        const maxH = Math.max(...displays.map((d) => Math.round(d.bounds.height * (d.scaleFactor || 1))));
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: maxW, height: maxH } });
        const used = new Set();
        displays.forEach((d, i) => {
          // match by display id; fall back to list order (display_id can be blank on some Windows setups)
          let src = sources.find((s) => s.display_id && String(s.display_id) === String(d.id));
          if (!src && sources.length === displays.length) src = sources[i];
          if (!src || used.has(src.id) || !src.thumbnail || src.thumbnail.isEmpty()) return;
          used.add(src.id);
          pairs.push({ display: d, shot: src.thumbnail });
        });
      } catch (err) {
        console.error('[snip] capture failed:', err.message);
      }

      let result = null;
      if (pairs.length) {
        const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
        result = await runSnipSelectors(pairs, cursorDisplay.id);
      }

      if (win && wasVisible) { win.show(); win.focus(); }
      return result; // data URL or null (cancelled / failed)
    })();
    try { return await snipInProgress; } finally { snipInProgress = null; }
  });
}

// One frozen-screen window per monitor. The first finished selection (or a
// cancel on any screen) closes them all.
function runSnipSelectors(pairs, focusDisplayId) {
  return new Promise((resolve) => {
    const wins = new Map(); // webContents.id -> { win, display, shot }
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      ipcMain.removeListener('snip-result', onResult);
      for (const { win } of wins.values()) if (!win.isDestroyed()) win.close();
      resolve(val);
    };
    const onResult = (event, rect) => {
      const entry = wins.get(event.sender.id);
      if (!entry) return;
      if (!rect || rect.width < 3 || rect.height < 3) return finish(null);
      const b = entry.display.bounds;
      const size = entry.shot.getSize();
      const kx = size.width / b.width, ky = size.height / b.height;
      const crop = {
        x: Math.max(0, Math.round(rect.x * kx)),
        y: Math.max(0, Math.round(rect.y * ky)),
        width: Math.round(rect.width * kx),
        height: Math.round(rect.height * ky),
      };
      crop.width = Math.min(crop.width, size.width - crop.x);
      crop.height = Math.min(crop.height, size.height - crop.y);
      try { finish(entry.shot.crop(crop).toDataURL()); } catch (err) { finish(null); }
    };
    ipcMain.on('snip-result', onResult);

    for (const { display, shot } of pairs) {
      const b = display.bounds;
      const win = new BrowserWindow({
        x: b.x, y: b.y, width: b.width, height: b.height,
        frame: false, transparent: false, resizable: false, movable: false,
        skipTaskbar: true, alwaysOnTop: true, fullscreenable: false, hasShadow: false,
        backgroundColor: '#000000', show: false,
        webPreferences: { preload: path.join(__dirname, '..', '..', 'snip-preload.js'), contextIsolation: true, nodeIntegration: false },
      });
      win.setAlwaysOnTop(true, 'screen-saver');
      wins.set(win.webContents.id, { win, display, shot });
      win.on('closed', () => finish(null)); // e.g. Alt+F4 on any screen = cancel
      win.loadFile(path.join(__dirname, '..', '..', 'ui', 'snip.html'));
      win.webContents.once('did-finish-load', () => {
        if (done) return;
        win.webContents.send('snip-image', shot.toDataURL());
        win.setBounds(b); // re-apply: Windows may adjust bounds across mixed-DPI monitors
        if (display.id === focusDisplayId) { win.show(); win.focus(); } else win.showInactive();
      });
    }
  });
}

// Finished sessions shake the window, at most once every 3 s.
function nudge(ctx, sessions) {
  const win = ctx.getWin();
  if (!win || win.isDestroyed()) return;
  win.webContents.send('session-nudge', { ids: sessions.map((s) => s.id) });
  // Several finishing together = one shake
  if (Date.now() - ctx.appState.lastNudgeAt < 3000) return;
  ctx.appState.lastNudgeAt = Date.now();
  shakeWindow(ctx);
}

function shakeWindow(ctx) {
  const win = ctx.getWin();
  if (!win || win.isDestroyed()) return;
  const { appState } = ctx;
  if (appState.dragTimer || appState.boundsAnim || appState.shakeTimer) return; // don't fight a drag / animation
  if (!win.isVisible()) win.showInactive();

  const start = win.getBounds();
  // Docked tab shakes vertically so it stays stuck to the screen edge
  const vertical = ctx.window.isDocked();
  const offsets = [10, -10, 8, -8, 6, -6, 4, -4, 2, -2, 0];
  let i = 0;
  appState.shakeTimer = setInterval(() => {
    const w = ctx.getWin();
    if (!w || w.isDestroyed()) { clearInterval(appState.shakeTimer); appState.shakeTimer = null; return; }
    const d = offsets[i++];
    const dy = i % 2 ? 2 : -2; // a little diagonal wobble, like MSN
    w.setBounds({
      x: start.x + (vertical ? 0 : d),
      y: start.y + (vertical ? d : dy),
      width: start.width,
      height: start.height,
    });
    if (i >= offsets.length) {
      clearInterval(appState.shakeTimer);
      appState.shakeTimer = null;
      w.setBounds(start); // back exactly where it was
    }
  }, 45);
}

module.exports = { register, nudge };
