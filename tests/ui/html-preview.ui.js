// HTML preview: a "▶ Preview" button next to .html files in a reply and in the edited-files list;
// clicking it shows the page inside the chat (sandboxed frame, scripts run, no access to the HUD).
require('./logpatch');
const { app, BrowserWindow, ipcMain } = require('electron');
const fm = require('../../features-main.js');
fm.registerPreviewScheme();
const path = require('path');
const fs = require('fs');
const os = require('os');
app.disableHardwareAcceleration(); app.setPath('userData', os.tmpdir() + '/ovly-ui-test-htmlprev');
let pass = 0, fail = 0;
const check = (n, ok, i = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${i ? ' — ' + i : ''}`); };
process.on('unhandledRejection', (e) => { console.log('FAIL  unexpected error —', e && e.message); app.exit(1); });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovly-hp-'));
fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1');
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ovly-hp-out-'));
fs.writeFileSync(path.join(outside, 'x.css'), 'body{}');
fs.writeFileSync(path.join(dir, 'page.css'), 'body { color: rgb(1, 2, 3); }');
fs.writeFileSync(path.join(dir, 'page.html'), '<!DOCTYPE html><html><head><link rel="stylesheet" href="page.css"></head><body><p id="t">static</p><script>document.getElementById("t").textContent = "script ran";</script></body></html>');

app.whenReady().then(async () => {
  fm.servePreviewScheme();
  ipcMain.handle('html-preview-url', (_e, p, cwd) => fm.htmlPreviewUrl(p, cwd));
  const w = new BrowserWindow({ width: 700, height: 800, show: false, frame: false, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (c) => w.webContents.executeJavaScript(c).catch((e) => 'ERR ' + e.message);
  w.loadFile(path.join(__dirname, '../../ui/index.html')); await new Promise((r) => w.webContents.once('did-finish-load', r)); await wait(2000);

  const sess = { id: 'claude:hp-1', sessionUuid: 'hp-1', source: 'claude', project: 'p', cwd: dir, status: 'idle', state: 'idle', subagents: [], mtime: Date.now() };
  const reply = 'Wrote the plan to `page.html`, see also [the old one](missing.html) and `notes.md`.';
  const edits = [{ path: path.join(dir, 'page.html'), added: 3, removed: 0, hunks: [] }, { path: path.join(dir, 'app.js'), added: 1, removed: 0, hunks: [] }];
  await js(`window.__S = ${JSON.stringify(sess)}; window.__cbs.onSessionsSync([window.__S]); showDetailView(window.__S);
    const h = sessionChatHistory.get(window.__S.id); h.fromDisk = true; h.length = 0; chatStream.innerHTML = '';
    for (const m of [{ role: 'user', text: 'make a plan' }, { role: 'assistant', text: ${JSON.stringify(reply)}, source: 'claude', edits: ${JSON.stringify(edits)} }]) { h.push(m); m.el = appendBubble(m); } 1`);
  await wait(300);

  check('a Preview button follows each .html file in the reply (and nothing else)',
    (await js(`document.querySelectorAll('#chatStream .bubble-content .hp-chip').length`)) === 2);
  check('the edited-files list has Preview only on the .html file',
    JSON.stringify(await js(`[...document.querySelectorAll('#chatStream .edit-row')].map(r => !!r.querySelector('.hp-open'))`)) === '[true,false]');

  await js(`document.querySelector('#chatStream .bubble-content .hp-chip').click(); 1`); await wait(1200);
  check('clicking it shows the page in the chat', (await js(`!!document.querySelector('#chatStream .hp-box iframe.hp-frame')`)) === true);
  check('the frame is sandboxed (scripts only)', (await js(`document.querySelector('.hp-frame').getAttribute('sandbox')`)) === 'allow-scripts');
  const fr = w.webContents.mainFrame.framesInSubtree.find((f) => /page\.html/.test(f.url));
  check('the frame loaded the file (relative path, from the chat folder)', !!fr, fr ? '' : w.webContents.mainFrame.framesInSubtree.map((f) => f.url).join(', '));
  if (fr) {
    check('the page\'s own script ran', (await fr.executeJavaScript(`document.getElementById('t').textContent`)) === 'script ran');
    check('its CSS next to it loaded', (await fr.executeJavaScript(`getComputedStyle(document.body).color`)) === 'rgb(1, 2, 3)');
    const get = (p) => fr.executeJavaScript(`fetch(${JSON.stringify(p)}).then(r => r.status, () => 'error')`);
    check('the page can read its own styles', (await get('page.css')) === 200);
    check('…but not secrets next to it (.env)', (await get('.env')) === 403);
    const out = 'ovly-preview://local/' + path.join(outside, 'x.css').split(path.sep).map((s, i) => i ? encodeURIComponent(s) : s).join('/');
    check('…nor files outside the chat folder', (await get(out)) === 403, String(await get(out)));
    check('the page cannot reach the HUD', (await fr.executeJavaScript(`(() => { try { return parent.document ? 'leak' : 'leak'; } catch (e) { return 'blocked'; } })()`)) === 'blocked');
  }
  check('only one window (nothing opened outside)', BrowserWindow.getAllWindows().length === 1);
  await js(`document.querySelector('#chatStream .bubble-content .hp-chip').click(); 1`); await wait(150);
  check('clicking again closes it', (await js(`document.querySelectorAll('#chatStream .hp-box').length`)) === 0);

  await js(`document.querySelectorAll('#chatStream .bubble-content .hp-chip')[1].click(); 1`); await wait(300);
  check('a missing file says so instead of a blank frame', /not found/.test(await js(`document.querySelector('#chatStream .hp-err')?.textContent || ''`)));

  await js(`document.querySelector('#chatStream .edit-row .hp-open').click(); 1`); await wait(600);
  check('Preview in the edited-files list opens it under that file',
    (await js(`document.querySelector('#chatStream .edit-row .hp-open').closest('.edit-list').querySelector('.hp-box') ? 1 : 0`)) === 1);
  check('…without folding / unfolding the row', (await js(`document.querySelector('#chatStream .edit-row').classList.contains('open')`)) === false);
  await js(`document.querySelector('#chatStream .hp-box .hp-btn[title^="Close"]').click(); 1`); await wait(100);
  check('✕ closes it', (await js(`document.querySelectorAll('#chatStream .hp-box').length`)) === 0);

  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  app.exit(fail ? 1 : 0);
});
