// "You said:" bar = sticky section header: it shows the message whose answer you are reading,
// so scrolling up into an older answer switches it to that older message.
require('./logpatch');
const { app, BrowserWindow } = require('electron');
const path = require('path');
app.disableHardwareAcceleration(); app.setPath('userData', require('os').tmpdir() + '/ovly-ui-test-pinprompt');
let pass = 0, fail = 0;
const check = (n, ok, i = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${i ? ' — ' + i : ''}`); };
process.on('unhandledRejection', (e) => { console.log('FAIL  unexpected error —', e && e.message); app.exit(1); });
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 700, height: 700, show: false, frame: false, useContentSize: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (c) => w.webContents.executeJavaScript(c).catch((e) => 'ERR ' + e.message);
  w.loadFile(path.join(__dirname, '../../ui/index.html')); await new Promise((r) => w.webContents.once('did-finish-load', r)); await wait(2200);

  const sess = { id: 'claude:pin-1', sessionUuid: 'pin-1', source: 'claude', project: 'p', cwd: 'C:/p', status: 'idle', state: 'idle', subagents: [], mtime: Date.now() };
  const long = (n) => Array.from({ length: 40 }, (_, i) => `Answer ${n}, line ${i + 1}.`).join('\n\n');
  await js(`window.__S = ${JSON.stringify(sess)}; window.__cbs.onSessionsSync([window.__S]); showDetailView(window.__S);
    const h = sessionChatHistory.get(window.__S.id); h.fromDisk = true; h.length = 0; chatStream.innerHTML = '';
    for (const [q, a] of [['first question', ${JSON.stringify(long(1))}], ['second question', ${JSON.stringify(long(2))}], ['third question', ${JSON.stringify(long(3))}]]) {
      for (const m of [{ role: 'user', text: q }, { role: 'assistant', text: a, source: 'claude' }]) { h.push(m); m.el = appendBubble(m); }
    } 1`);
  await wait(300);
  const bar = () => js(`(() => { const b = document.getElementById('pinnedPrompt'); return b.style.display === 'none' ? '' : b.querySelector('.pp-text').textContent; })()`);
  // scroll so the given bubble's top is at the chat's top, plus `dy` px
  const scrollTo = async (sel, dy) => { await js(`(() => { const el = ${sel}; chatStream.scrollTop += el.getBoundingClientRect().top - chatStream.getBoundingClientRect().top + ${dy}; })(); 1`); await wait(150); };
  const user = (i) => `document.querySelectorAll('#chatStream .chat-bubble.user')[${i}]`;
  const reply = (i) => `document.querySelectorAll('#chatStream .chat-bubble.assistant')[${i}]`;

  await js(`chatStream.scrollTop = chatStream.scrollHeight; 1`); await wait(150);
  check('at the bottom it shows your latest message', (await bar()) === 'third question', await bar());
  await scrollTo(reply(1), 200);
  check('scrolled into the 2nd answer, it shows the 2nd question', (await bar()) === 'second question', await bar());
  await scrollTo(reply(0), 200);
  check('scrolled into the 1st answer, it shows the 1st question', (await bar()) === 'first question', await bar());
  await scrollTo(user(0), -20);
  check('at the very top (first question in view) the bar is hidden', (await bar()) === '', await bar());
  await scrollTo(reply(1), 200);
  await js(`document.getElementById('pinnedPrompt').click(); 1`); await wait(900);
  check('clicking it jumps to that question', Math.abs(await js(`${user(1)}.getBoundingClientRect().top - chatStream.getBoundingClientRect().top`)) < 20);

  console.log(`\n${pass} passed, ${fail} failed`);
  app.exit(fail ? 1 : 0);
});
