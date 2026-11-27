// Settings dialog: sections are tabs (one shown at a time, the last one used opens next time),
// and Chat has the "You said:" bar option (on = follows scrolling, off = always your latest message).
require('./logpatch');
const { app, BrowserWindow } = require('electron');
const path = require('path');
app.disableHardwareAcceleration(); app.setPath('userData', require('os').tmpdir() + '/ovly-ui-test-settabs');
let pass = 0, fail = 0;
const check = (n, ok, i = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${i ? ' — ' + i : ''}`); };
process.on('unhandledRejection', (e) => { console.log('FAIL  unexpected error —', e && e.message); app.exit(1); });
const style = process.argv[2]; // e.g. Work, Pip-Boy, Classic: also saves a screenshot
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 700, height: 800, show: false, frame: false, useContentSize: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (c) => w.webContents.executeJavaScript(c).catch((e) => 'ERR ' + e.message);
  w.loadFile(path.join(__dirname, '../../ui/index.html')); await new Promise((r) => w.webContents.once('did-finish-load', r)); await wait(2200);
  await js(`window.__cbs.onSessionsSync([]); localStorage.removeItem('ovly.settingsTab'); 1`);
  if (style) { await js(`[...document.querySelectorAll('.style-pills .theme-pill')].find(x => /^${style}/.test(x.textContent))?.click(); 1`); await wait(500); }

  const visible = () => js(`[...document.querySelectorAll('#settingsPanel .settings-sec')].filter(s => s.style.display !== 'none').map(s => s.dataset.tab)`);
  const tab = (name) => js(`[...document.querySelectorAll('.settings-tab')].find(t => t.textContent === '${name}').click(); 1`);
  await js(`document.getElementById('lbSettings').click(); 1`); await wait(400);
  check('the sections are tabs', JSON.stringify(await js(`[...document.querySelectorAll('.settings-tab')].map(t => t.textContent)`)) === '["Appearance","Behavior","Chat","Tools"]');
  check('one section shows at a time (the first, at first)', JSON.stringify(await visible()) === '["Appearance"]', JSON.stringify(await visible()));
  await tab('Chat'); await wait(150);
  check('clicking a tab shows its section', JSON.stringify(await visible()) === '["Chat"]');
  check('Chat has the "You said:" option, on by default', await js(`document.getElementById('btnPinFollow')?.classList.contains('active') && !!document.getElementById('btnPinFollow').offsetParent`));
  if (style) { const img = await w.webContents.capturePage(); require('fs').writeFileSync(path.join(require('os').tmpdir(), `ovly-settings-${style}.png`), img.toPNG()); }
  await js(`document.getElementById('btnSettingsDone').click(); 1`); await wait(150);
  await js(`document.getElementById('lbSettings').click(); 1`); await wait(300);
  check('it opens on the last tab you used', JSON.stringify(await visible()) === '["Chat"]');
  check('every row is in some tab', (await js(`document.querySelectorAll('#settingsPanel .set-row').length`)) === (await js(`document.querySelectorAll('#settingsPanel .settings-sec .set-row').length`)));

  // the option: off = the bar always shows your latest message
  const saved = [];
  await js(`window.__saved = []; const o = window.electronAPI.storeSet; window.electronAPI.storeSet = (k, v) => { window.__saved.push([k, v]); return o && o(k, v); }; 1`);
  await js(`document.getElementById('btnPinFollow').click(); 1`); await wait(100);
  check('turning it off is saved', JSON.stringify(await js(`window.__saved`)) === '[["pinFollowScroll",false]]' && !(await js(`document.getElementById('btnPinFollow').classList.contains('active')`)));
  await js(`document.getElementById('btnSettingsDone').click(); 1`);
  const sess = { id: 'claude:set-1', sessionUuid: 'set-1', source: 'claude', project: 'p', cwd: 'C:/p', status: 'idle', state: 'idle', subagents: [], mtime: Date.now() };
  const long = (n) => Array.from({ length: 40 }, (_, i) => `Answer ${n}, line ${i + 1}.`).join('\n\n');
  await js(`window.__S = ${JSON.stringify(sess)}; window.__cbs.onSessionsSync([window.__S]); showDetailView(window.__S);
    const h = sessionChatHistory.get(window.__S.id); h.fromDisk = true; h.length = 0; chatStream.innerHTML = '';
    for (const [q, a] of [['first question', ${JSON.stringify(long(1))}], ['second question', ${JSON.stringify(long(2))}]]) {
      for (const m of [{ role: 'user', text: q }, { role: 'assistant', text: a, source: 'claude' }]) { h.push(m); m.el = appendBubble(m); }
    } 1`);
  await wait(300);
  const bar = () => js(`(() => { const b = document.getElementById('pinnedPrompt'); return b.style.display === 'none' ? '' : b.querySelector('.pp-text').textContent; })()`);
  const intoFirstAnswer = `(() => { const el = document.querySelectorAll('#chatStream .chat-bubble.assistant')[0]; chatStream.scrollTop += el.getBoundingClientRect().top - chatStream.getBoundingClientRect().top + 200; })(); 1`;
  await js(`chatStream.scrollTop = chatStream.scrollHeight; 1`); await wait(150);
  check('off: at the bottom it shows your latest message', (await bar()) === 'second question', await bar());
  await js(intoFirstAnswer); await wait(150);
  check('off: in an older answer the bar hides (the latest message is below, in view)', (await bar()) === '', await bar());
  await js(`window.setPinFollow(true); 1`); await wait(150);
  check('on: in an older answer it shows that answer’s question', (await bar()) === 'first question', await bar());

  console.log(`\n${pass} passed, ${fail} failed`);
  app.exit(fail ? 1 : 0);
});
