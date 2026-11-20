// The REAL app (main.js + preload + page) in a throw-away home folder: "Always on top" and "Chime" are remembered
// between runs, and the tray / Settings row follow. Run twice by the test itself (two processes).
//   node_modules/.bin/electron tests/ui/saved-settings.ui.js   (the runner calls it with no arguments: first run)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const phase = process.env.SAVED_PHASE || '';
const home = process.env.SAVED_HOME || fs.mkdtempSync(path.join(os.tmpdir(), 'ovly-saved-'));
const settingsFile = path.join(home, '.ovly-claude', 'settings.json');
const log = (s) => fs.appendFileSync(path.join(home, 'result.txt'), s + '\n');

if (!phase) {
  // parent: run phase 1 (start with defaults, turn both off), then phase 2 (start again, expect them still off)
  const electron = process.versions.electron ? process.execPath : require('electron'); // (run by the runner inside Electron, or by plain node)
  const results = [];
  for (const p of ['one', 'two']) {
    const r = spawnSync(electron, [__filename], { env: { ...process.env, SAVED_PHASE: p, SAVED_HOME: home, USERPROFILE: home, HOME: home }, encoding: 'utf8', timeout: 60000 });
    if (r.status !== 0) results.push(`phase ${p} exited ${r.status}`);
  }
  const out = fs.existsSync(path.join(home, 'result.txt')) ? fs.readFileSync(path.join(home, 'result.txt'), 'utf8') : '';
  const lines = out.split('\n').filter(Boolean).concat(results.map((x) => 'FAIL  ' + x));
  lines.forEach((l) => console.log(l));
  const failed = lines.filter((l) => l.startsWith('FAIL')).length;
  console.log(`\n${lines.length - failed} passed, ${failed} failed`);
  process.exit(failed || lines.length < 6 ? 1 : 0);
} else {
  // child: the app itself
  const { app, BrowserWindow } = require('electron');
  app.disableHardwareAcceleration();
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const check = (n, ok, i = '') => log(`${ok ? 'PASS' : 'FAIL'}  [${phase}] ${n}${i ? ' — ' + i : ''}`);
  process.on('unhandledRejection', (e) => { log('FAIL  unexpected error — ' + (e && e.message)); app.exit(1); });
  require('../../main.js');
  app.whenReady().then(async () => {
    await wait(5000);
    const win = BrowserWindow.getAllWindows().find((w) => /index\.html/.test(w.webContents.getURL()));
    if (!win) { log('FAIL  the HUD window did not open'); app.exit(1); return; }
    const js = (c) => win.webContents.executeJavaScript(c);
    const saved = () => { try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch (_) { return {}; } };
    if (phase === 'one') {
      check('first run: always on top is on by default', win.isAlwaysOnTop() && (await js(`document.getElementById('btnPin').classList.contains('active')`)));
      check('first run: the chime is on by default', await js(`document.getElementById('btnSound').classList.contains('active')`));
      await js(`document.getElementById('btnPin').click()`);
      await js(`document.getElementById('btnSound').click()`);
      await wait(900);
      check('turning them off: the window is no longer always on top', !win.isAlwaysOnTop());
      check('and both are written to the settings file', saved().alwaysOnTop === false && saved().chime === false, JSON.stringify({ alwaysOnTop: saved().alwaysOnTop, chime: saved().chime }));
    } else {
      check('second run: the window starts NOT always on top', !win.isAlwaysOnTop());
      check('second run: the Settings row shows it is off', !(await js(`document.getElementById('btnPin').classList.contains('active')`)));
      check('second run: the chime is still off (row and sound engine)', !(await js(`document.getElementById('btnSound').classList.contains('active')`)) && (await js(`window.soundSynth.enabled`)) === false);
      await js(`document.getElementById('btnPin').click()`);
      await wait(900);
      check('turning it back on: window and file follow', win.isAlwaysOnTop() && saved().alwaysOnTop === true);
    }
    app.exit(0);
  });
}
