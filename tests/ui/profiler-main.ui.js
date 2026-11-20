// The profiler's main-process side (main/profiler.js) with real Electron numbers: processes, labels, the watcher
// timer, and that only the HUD page may ask.
require('./logpatch');
const { app, BrowserWindow } = require('electron');
const path = require('path');
app.disableHardwareAcceleration(); app.setPath('userData', require('os').tmpdir() + '/ovly-ui-test-ud13');
let pass = 0, fail = 0;
const check = (n, ok, i = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${i ? ' — ' + i : ''}`); };
process.on('unhandledRejection', (e) => { console.log('FAIL  unexpected error —', e && e.message); app.exit(1); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const busy = (ms) => { const t = Date.now(); while (Date.now() - t < ms); };

app.whenReady().then(async () => {
  const mk = () => new BrowserWindow({ show: false, width: 300, height: 200, webPreferences: { contextIsolation: false, nodeIntegration: true } });
  const hud = mk(), other = mk();
  await hud.loadURL('about:blank'); await other.loadURL('about:blank');
  const watcher = { sessions: new Map([['a', 1], ['b', 2]]), check() { busy(5); } };
  const prof = require('../../main/profiler.js').create({ getMainWin: () => hud, getWatcher: () => watcher });
  prof.hookWatcher();
  for (let i = 0; i < 4; i++) { watcher.check(); await wait(10); }
  await wait(1100); // a little time for the event-loop monitor

  const s = prof.sample();
  check('every Electron process is listed with memory and CPU', s.processes.length >= 3 && s.processes.every((p) => p.workingMB > 0 && typeof p.cpu === 'number' && p.type), JSON.stringify(s.processes.map((p) => p.type)));
  check('the main process is named, and there is a window process', s.processes.some((p) => p.name === 'Main process' && p.type === 'Browser') && s.processes.some((p) => p.type === 'Tab'));
  check('Node heap and total memory are real numbers', s.main.heapUsedMB > 1 && s.main.rssMB > s.main.heapUsedMB);
  check('the event-loop numbers are present', Number.isFinite(s.loop.meanMs) && Number.isFinite(s.loop.p99Ms) && s.loop.maxMs >= 0);
  check('the watcher check is timed: 4 calls, about 5 ms each', s.watcher.avgMs >= 4 && s.watcher.avgMs < 40 && s.watcher.maxMs >= s.watcher.avgMs && s.watcher.perSec > 0 && s.watcher.sessions === 2, JSON.stringify(s.watcher));
  const s2 = prof.sample();
  check('each sample covers the time since the last one (counters reset)', s2.watcher.perSec === 0 && s2.watcher.maxMs === 0);
  prof.hookWatcher();
  watcher.check();
  check('hooking twice does not time a call twice', prof.sample().watcher.perSec > 0);

  const ask = (win) => win.webContents.executeJavaScript(`require('electron').ipcRenderer.invoke('perf:sample')`);
  const fromHud = await ask(hud);
  check('the HUD page gets a sample over IPC', fromHud && Array.isArray(fromHud.processes));
  check('another window gets nothing', (await ask(other)) === null);

  prof.cleanup();
  console.log(`\n${pass} passed, ${fail} failed`);
  app.exit(fail ? 1 : 0);
});
