// The mini bar's window side (main/minibar.js) with the real page and preload: where it sits, how it grows,
// that approvals / queue reports are relayed, and that only the right windows may talk to it.
require('./logpatch');
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
app.disableHardwareAcceleration(); app.setPath('userData', require('os').tmpdir() + '/ovly-ui-test-ud2');
let pass = 0, fail = 0;
const check = (n, ok, i = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${i ? ' — ' + i : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

process.on('unhandledRejection', (e) => { console.log('FAIL  unexpected error —', e && e.message); app.exit(1); });
app.whenReady().then(async () => {
  ipcMain.on('store-get-sync', (e) => { e.returnValue = { uiStyle: 'shelter' }; }); // what the real settings store answers to the preload
  const store = {};
  const features = { getSetting: (k, d) => (k in store ? store[k] : d), setSetting: (k, v) => { store[k] = v; } };
  const mainWin = new BrowserWindow({ show: false, width: 300, height: 200 });
  await mainWin.loadURL('about:blank');
  const toMain = [];
  const realSend = mainWin.webContents.send.bind(mainWin.webContents);
  mainWin.webContents.send = (c, p) => { toMain.push([c, p]); return realSend(c, p); };
  let hudShown = 0;
  const bar = require('../../main/minibar.js').create({ features, getMainWin: () => mainWin, showHud: () => { hudShown++; } });
  const answered = [];
  ipcMain.on('permission-response', (_e, m) => answered.push(m));
  const wa = screen.getPrimaryDisplay().workArea;

  bar.toggle();
  await wait(1500);
  const win = BrowserWindow.getAllWindows().find((w) => w !== mainWin);
  const js = (c) => win.webContents.executeJavaScript(c).catch((e) => 'ERR ' + e.message);
  check('toggle opens the bar', bar.isOn() && !!win);
  check('it is remembered as on', store.miniBar && store.miniBar.on === true);
  let b = win.getBounds();
  check('starts on the top edge, centred, 34px high', b.y === wa.y && b.height === 34 && b.width > 400, JSON.stringify(b));
  check('always on top, not in the taskbar', win.isAlwaysOnTop());

  bar.onSessions([{ id: 'a', status: 'running', project: 'alpha', sessionTitle: 'alpha', activity: { kind: 'thinking' } }, { id: 'b', status: 'idle', unread: true, project: 'beta' }]);
  await wait(300);
  check('sessions reach the page', /1\s*needs you/.test(await js(`document.getElementById('sum').textContent`)));

  // approvals: mirrored in, answered from the bar, the HUD page is told to drop its copy
  bar.mirror('permission-request', { id: 'p9', sessionId: 'a', toolName: 'Bash', input: { command: 'ls' } });
  await wait(200);
  check('an approval shows in the bar', !(await js(`document.getElementById('perm').hidden`)));
  await js(`document.getElementById('allow').click()`);
  await wait(300);
  check('Allow reaches the permission-response channel', answered.some((m) => m.id === 'p9' && m.choice === 'allow'), JSON.stringify(answered));
  check('the HUD page is told the approval is closed', toMain.some(([c, p]) => c === 'permission-expired' && p.id === 'p9'));
  check('and the bar drops it', await js(`document.getElementById('perm').hidden`));

  // queue reports: only the HUD page may send them
  await js(`window.barAPI.resumeQueue(); 1`);
  await wait(200);
  check('Resume in the bar is passed to the HUD page', toMain.some(([c]) => c === 'queue-resume'));
  check('Open in the bar shows the HUD', (await js(`window.barAPI.openChat('b'); 1`), await wait(200), hudShown >= 1) && toMain.some(([c, p]) => c === 'open-session' && p.sessionId === 'b'));

  // growing: hover opens the panel, the bar stays put
  await js(`document.getElementById('mb').dispatchEvent(new MouseEvent('mouseenter')); 1`);
  await wait(900);
  b = win.getBounds();
  check('hover: the window grows downward, top stays on the edge', b.y === wa.y && b.height > 100, JSON.stringify(b));

  // auto-hide: the page asks for a 6px line; the window keeps 34px (it is clipped to a strip, Windows has a minimum height)
  await js(`window.barAPI.setHeight(6); 1`);
  await wait(200);
  check('the thin line keeps the window at 34px (clipped, not shrunk)', win.getBounds().height === 34, JSON.stringify(win.getBounds()));

  // a stranger cannot resize it: a call from another window is ignored
  await js(`window.barAPI.setHeight(138); 1`);
  await wait(200);
  const before = win.getBounds();
  ipcMain.emit('minibar:size', { sender: mainWin.webContents }, 300);
  await wait(200);
  check('size request from another window is ignored', win.getBounds().height === before.height);

  // bottom edge: remembered, then the panel grows upward
  bar.close();
  check('close is remembered as off', store.miniBar.on === false && !bar.isOn());
  store.miniBar = { ...store.miniBar, edge: 'bottom', x: null, y: null };
  bar.toggle();
  await wait(1500);
  const win2 = BrowserWindow.getAllWindows().find((w) => w !== mainWin && w !== win && !w.isDestroyed());
  b = win2.getBounds();
  check('bottom edge: sits on the bottom of the work area', b.y + b.height === wa.y + wa.height && b.height === 34, JSON.stringify(b));
  await win2.webContents.executeJavaScript(`document.getElementById('mb').dispatchEvent(new MouseEvent('mouseenter')); 1`);
  await wait(900);
  b = win2.getBounds();
  check('bottom edge: the panel grows upward, bottom stays', b.y + b.height === wa.y + wa.height && b.height > 100, JSON.stringify(b));

  bar.cleanup();
  console.log(`\n${pass} passed, ${fail} failed`);
  app.exit(fail ? 1 : 0);
});
