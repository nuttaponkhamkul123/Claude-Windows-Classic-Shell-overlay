// Small profiler: what the app costs right now. One sample = every Electron process (memory, CPU, which window it
// belongs to), the main process's Node heap, how late the main event loop runs, and how long the session
// watcher's check takes (it runs every 0.8 s). The HUD's Performance panel (ui/logic/system/perf.js) asks for a
// sample every couple of seconds while it is open; nothing is measured or kept while it is closed, except the
// light event-loop monitor and the watcher timer (a few microseconds per check).

const { app, BrowserWindow, ipcMain } = require('electron');
const { monitorEventLoopDelay } = require('perf_hooks');

const KB = 1024;

function create({ getMainWin, getWatcher }) {
  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  const w = { calls: 0, total: 0, max: 0, since: Date.now() };

  // time the watcher's check() (called as this.check() by its own timer, so replacing the property is enough)
  function hookWatcher() {
    const watcher = getWatcher && getWatcher();
    if (!watcher || watcher.__profiled || typeof watcher.check !== 'function') return;
    const orig = watcher.check;
    watcher.check = function (...args) {
      const t0 = process.hrtime.bigint();
      try { return orig.apply(this, args); } finally {
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        w.calls++; w.total += ms; if (ms > w.max) w.max = ms;
      }
    };
    watcher.__profiled = true;
  }

  function windowLabels() {
    const labels = new Map();
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      let url = '';
      try { url = win.webContents.getURL(); } catch (_) {}
      const name = /minibar\.html/i.test(url) ? 'Mini bar window' : /index\.html/i.test(url) ? 'HUD window' : /about:blank|^$/.test(url) ? 'Window' : 'Window';
      try { labels.set(win.webContents.getOSProcessId(), name); } catch (_) {}
    }
    return labels;
  }

  function sample() {
    hookWatcher();
    const labels = windowLabels();
    const processes = app.getAppMetrics().map((m) => ({
      pid: m.pid,
      type: m.type,
      name: labels.get(m.pid) || (m.type === 'Browser' ? 'Main process' : m.name || m.type),
      workingMB: (m.memory.workingSetSize || 0) / KB,
      privateMB: (m.memory.privateBytes || 0) / KB,
      cpu: m.cpu.percentCPUUsage || 0,
    }));
    const mem = process.memoryUsage();
    const secs = Math.max(0.001, (Date.now() - w.since) / 1000);
    const watcherStats = { perSec: w.calls / secs, avgMs: w.calls ? w.total / w.calls : 0, maxMs: w.max, sessions: (getWatcher && getWatcher() && getWatcher().sessions && getWatcher().sessions.size) || 0 };
    const out = {
      at: Date.now(),
      processes,
      main: { rssMB: mem.rss / 1048576, heapUsedMB: mem.heapUsed / 1048576, heapTotalMB: mem.heapTotal / 1048576, externalMB: mem.external / 1048576 },
      loop: { meanMs: loop.mean / 1e6 || 0, p99Ms: loop.percentile(99) / 1e6 || 0, maxMs: loop.max / 1e6 || 0 },
      watcher: watcherStats,
      uptimeSec: process.uptime(),
    };
    loop.reset(); w.calls = 0; w.total = 0; w.max = 0; w.since = Date.now(); // each sample covers the time since the last one
    return out;
  }

  // only the HUD page may ask
  ipcMain.handle('perf:sample', (e) => {
    const mw = getMainWin && getMainWin();
    if (!mw || mw.isDestroyed() || e.sender !== mw.webContents) return null;
    return sample();
  });

  return { sample, hookWatcher, cleanup: () => loop.disable() };
}

module.exports = { create };
