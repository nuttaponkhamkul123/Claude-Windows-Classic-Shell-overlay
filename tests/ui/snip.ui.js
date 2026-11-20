// Quick snip (main/ipc/snap.js + ui/snip.html): the HUD hides, every screen is frozen in a selection window, a drag
// returns the cropped PNG, Esc / right-click cancels, and the HUD comes back. Drives the real snip windows with
// synthetic mouse events. Needs a real desktop session (it captures the screen).
require('./logpatch');
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
app.disableHardwareAcceleration(); app.setPath('userData', require('os').tmpdir() + '/ovly-ui-test-ud15');
let pass = 0, fail = 0;
const check = (n, ok, i = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${i ? ' — ' + i : ''}`); };
process.on('unhandledRejection', (e) => { console.log('FAIL  unexpected error —', e && e.stack || e); app.exit(1); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const snipWins = () => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && /snip\.html/.test(w.webContents.getURL()));

app.whenReady().then(async () => {
  const hud = new BrowserWindow({ x: 50, y: 50, width: 400, height: 300, show: true, webPreferences: { contextIsolation: false, nodeIntegration: true } });
  await hud.loadURL('about:blank');
  let barHidden = 0, barShown = 0;
  const ctx = { getWin: () => hud, snipBegin: () => { barHidden++; return () => { barShown++; }; } };
  const { createRegistry } = require('../../main/ipc');
  const reg = createRegistry(ctx);
  try { require('../../main/ipc/snap').register(reg); } catch (e) { console.log('FAIL  register threw —', e.message); app.exit(1); return; }

  // (a new snip only starts once the windows of the last one are really gone, so a test never grabs a closing window)
  const invoke = async () => {
    for (let i = 0; i < 50 && (snipWins().length || !hud.isVisible()); i++) await wait(100);
    return hud.webContents.executeJavaScript(`require('electron').ipcRenderer.invoke('quick-snip')`);
  };
  const drag = async (win, a, b) => {
    const wc = win.webContents;
    wc.sendInputEvent({ type: 'mouseMove', x: a.x, y: a.y });
    wc.sendInputEvent({ type: 'mouseDown', x: a.x, y: a.y, button: 'left', clickCount: 1 });
    await wait(60);
    wc.sendInputEvent({ type: 'mouseMove', x: b.x, y: b.y });
    await wait(60);
    wc.sendInputEvent({ type: 'mouseUp', x: b.x, y: b.y, button: 'left', clickCount: 1 });
  };
  const waitSnip = async () => { for (let i = 0; i < 60 && !(snipWins().length && snipWins().every((w) => w.isVisible())); i++) await wait(100); return snipWins(); };

  // 1) a drag returns a PNG
  let p = invoke();
  let wins = await waitSnip();
  check('a selection window opens on every screen', wins.length === screen.getAllDisplays().length, `${wins.length} of ${screen.getAllDisplays().length}`);
  check('the HUD hides while snipping', !hud.isVisible());
  await wait(600); // the frozen picture is sent after the page loads
  const imgOk = await wins[0].webContents.executeJavaScript(`(() => { const i = document.getElementById('shot'); return !!i.src && i.naturalWidth > 100; })()`);
  check('the frozen screenshot is shown in the window', imgOk);
  await drag(wins[0], { x: 120, y: 140 }, { x: 420, y: 340 });
  const res = await Promise.race([p, wait(8000).then(() => 'TIMEOUT')]);
  check('the drag returns a PNG data URL', typeof res === 'string' && res.startsWith('data:image/png'), String(res).slice(0, 40));
  if (typeof res === 'string' && res.startsWith('data:image/png')) {
    const { nativeImage } = require('electron');
    const img = nativeImage.createFromDataURL(res);
    const sz = img.getSize();
    const k = wins[0] ? screen.getAllDisplays()[0].scaleFactor || 1 : 1;
    check('and it is the size that was dragged (300 × 200 screen pixels)', Math.abs(sz.width - 300 * k) <= 2 && Math.abs(sz.height - 200 * k) <= 2, `${sz.width}x${sz.height} at scale ${k}`);
  }
  await wait(500);
  check('the selection windows are closed and the HUD is back', snipWins().length === 0 && hud.isVisible());

  // 2) Esc cancels
  p = invoke();
  wins = await waitSnip();
  await wait(400);
  wins[0].webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  wins[0].webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  const esc = await Promise.race([p, wait(6000).then(() => 'TIMEOUT')]);
  check('Esc cancels (null) and the HUD comes back', esc === null && (await wait(400), hud.isVisible() && snipWins().length === 0), String(esc));

  // 3) right-click cancels
  p = invoke();
  wins = await waitSnip();
  await wait(400);
  wins[0].webContents.sendInputEvent({ type: 'mouseDown', x: 50, y: 50, button: 'right', clickCount: 1 });
  wins[0].webContents.sendInputEvent({ type: 'mouseUp', x: 50, y: 50, button: 'right', clickCount: 1 });
  const rc = await Promise.race([p, wait(6000).then(() => 'TIMEOUT')]);
  check('right-click cancels', rc === null, String(rc));
  await wait(400);

  // 4) a tiny drag is a cancel, and a second request while one runs shares it
  p = invoke();
  wins = await waitSnip();
  await wait(400);
  const p2 = hud.webContents.executeJavaScript(`require('electron').ipcRenderer.invoke('quick-snip')`);
  await drag(wins[0], { x: 200, y: 200 }, { x: 201, y: 201 });
  const tiny = await Promise.race([p, wait(6000).then(() => 'TIMEOUT')]);
  const second = await Promise.race([p2, wait(3000).then(() => 'TIMEOUT')]);
  check('a 1-pixel drag counts as a cancel; a second request gets the same answer', tiny === null && second === null, `${tiny} / ${second}`);

  // 5) the mini bar steps aside for the snip and comes back
  check('the mini bar was asked to step aside for each snip, and to come back', barHidden >= 4 && barShown === barHidden, barHidden + ' / ' + barShown);

  // 6) Esc works from anywhere (a global shortcut while snipping, gone afterwards)
  const { globalShortcut } = require('electron');
  p = invoke();
  wins = await waitSnip();
  check('Esc is a global shortcut while the snip is open', globalShortcut.isRegistered('Escape'));
  wins[0].webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  await Promise.race([p, wait(4000)]);
  await wait(300);
  check('and is released afterwards', !globalShortcut.isRegistered('Escape'));

  // 7) the picture is mapped with the selection window's REAL size (Windows may resize it on mixed-scaling screens)
  p = invoke();
  wins = await waitSnip();
  await wait(500);
  const d0 = wins[0].getBounds();
  wins[0].setBounds({ x: d0.x, y: d0.y, width: Math.round(d0.width / 2), height: Math.round(d0.height / 2) });
  await wait(300);
  await drag(wins[0], { x: 100, y: 100 }, { x: 400, y: 300 });
  const half = await Promise.race([p, wait(8000).then(() => 'TIMEOUT')]);
  const hs = typeof half === 'string' && half.startsWith('data:') ? require('electron').nativeImage.createFromDataURL(half).getSize() : null;
  check('a window half the size still gives the right crop (300 x 200 dragged = 600 x 400 of the picture)', !!hs && Math.abs(hs.width - 600) <= 3 && Math.abs(hs.height - 400) <= 3, JSON.stringify(hs));

  // 8) nobody finishes: it gives the screen back after the timeout (set short here)
  ctx.snipTimeoutMs = 1500;
  const t0 = Date.now();
  const lost = await Promise.race([invoke(), wait(9000).then(() => 'TIMEOUT')]);
  check('with no answer the snip ends by itself (null) and the HUD is back', lost === null && Date.now() - t0 < 6000 && hud.isVisible() && snipWins().length === 0, String(lost));
  delete ctx.snipTimeoutMs;

  // 9) the picture cannot be taken: an error reaches the page, and nothing is left hidden
  ctx.snipCapture = async () => [];
  let msg = '';
  try { await invoke(); } catch (e) { msg = String(e.message); }
  check('no picture from Windows: the page gets an error it can show', /did not give a picture/.test(msg), msg.slice(-80));
  await wait(400);
  check('and the HUD and the mini bar are back, no window left behind', hud.isVisible() && snipWins().length === 0 && barShown === barHidden);
  delete ctx.snipCapture;
  p = invoke();
  wins = await waitSnip();
  check('a snip works again right after an error (nothing stuck)', wins.length > 0);
  wins[0].webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  await Promise.race([p, wait(4000)]);

  console.log(`\n${pass} passed, ${fail} failed`);
  app.exit(fail ? 1 : 0);
});
