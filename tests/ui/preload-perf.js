// The harness preload plus a fake profiler sample (the real one comes from main/profiler.js).
require('./preload.js');
const api = window.electronAPI;
let n = 0;
window.__perfCalls = [];
api.perfSample = async () => {
  n++;
  window.__perfCalls.push(n);
  return {
    at: Date.now(), uptimeSec: 3600,
    processes: [
      { pid: 100, type: 'Browser', name: 'Main process', workingMB: 160 + n, privateMB: 120, cpu: 0.4 },
      { pid: 101, type: 'Tab', name: 'HUD window', workingMB: 240, privateMB: 200, cpu: 2.1 },
      { pid: 102, type: 'Tab', name: 'Mini bar window', workingMB: 90, privateMB: 70, cpu: 0.1 },
      { pid: 103, type: 'GPU', name: 'GPU', workingMB: 110, privateMB: 90, cpu: 0.8 },
    ],
    main: { rssMB: 160, heapUsedMB: 28.4, heapTotalMB: 40, externalMB: 4 },
    loop: { meanMs: 0.5, p99Ms: 2.2, maxMs: 9.5 },
    watcher: { perSec: 1.25, avgMs: 3.4, maxMs: 12.8, sessions: 7 },
  };
};
api.copyToClipboard = (t) => { window.__copied = t; };
