require('./logpatch');
const { app, BrowserWindow } = require('electron');
const path = require('path');
app.disableHardwareAcceleration(); app.setPath('userData', require('os').tmpdir() + '/ovly-ui-test-ud11');
const SHOT = process.argv[2];
let pass = 0, fail = 0;
const check = (n, ok, i = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${i ? ' — ' + i : ''}`); };
const session = () => { const now = Date.now(); return { id: 'claude_s2', sessionUuid: 's2', source: 'claude', project: 'ovly-claude', cwd: 'C:/w', status: 'idle', state: 'waiting', statusLabel: 'Idle', title: 'ovly-claude', sessionTitle: 'Flow', detail: 'x', fullContent: 'Done.', model: 'claude-opus-5-5', mtime: now, lastTurnTs: now }; };
process.on('unhandledRejection', (e) => { console.log('FAIL  unexpected error —', e && e.message); app.exit(1); });
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 1000, height: 700, show: false, frame: false, useContentSize: true, webPreferences: { preload: path.join(__dirname, 'preload-cards.js'), contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } });
  w.webContents.on('console-message', (e) => { if (e.level === 'error' && !/available/.test(e.message)) console.log('[page]', e.message); });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (c) => w.webContents.executeJavaScript(c).catch((e) => 'ERR ' + e.message);
  const n = (sel) => js(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
  // visible answer bubbles (not display:none)
  const shown = () => js(`[...document.querySelectorAll('.chat-bubble.assistant')].filter((b) => getComputedStyle(b).display !== 'none').map((b) => b.querySelector('.bubble-content').textContent.slice(0, 12))`);
  const q = (i) => `document.querySelectorAll('.qa-q')[${i}]`;
  w.loadFile(path.join(__dirname, '../../ui/index.html')); await new Promise((r) => w.webContents.once('did-finish-load', r)); await wait(2200);
  await js(`window.__cbs.onSessionsSync(${JSON.stringify([session()])}); document.head.insertAdjacentHTML('beforeend','<style>*{transition:none!important;animation:none!important}</style>'); 1`);
  await js(`[...document.querySelectorAll('.style-pills .theme-pill')].find(x => /^${process.argv[3] || 'Work'}/.test(x.textContent))?.click(); 1`); await wait(500);
  await js(`showDetailView(sessionsList[0]); 1`); await wait(1500);

  check('before: no cards, all 3 answers visible', (await n('.qa-q')) === 0 && (await shown()).length === 3);
  await js(`document.getElementById('tbCards').click()`); await wait(300);
  check('Cards turns the view on and it is saved', await js(`document.body.classList.contains('chat-cards')`) && (await js(`window.__stored.chatCards`)) === true);
  check('3 questions become 3 cards', (await n('.qa-q')) === 3);
  check('only the newest answer is open', JSON.stringify(await shown()) === '["Reset in Set"]', JSON.stringify(await shown()));
  check('a closed card shows the first line of its answer', /Open Settings, then see the guide/.test(await js(`${q(0)}.dataset.peek`)), await js(`${q(0)}.dataset.peek`));
  check('the cards say whether they are open', (await js(`${q(0)}.getAttribute('aria-expanded')`)) === 'false' && (await js(`${q(2)}.getAttribute('aria-expanded')`)) === 'true');

  await js(`${q(0)}.click()`); await wait(150);
  check('click a card: its answer opens', (await shown()).length === 2 && await js(`${q(0)}.classList.contains('qa-open')`));
  await js(`${q(0)}.click()`); await wait(150);
  check('click again: it closes', (await shown()).length === 1);
  await js(`${q(0)}.click()`); await wait(150);
  await js(`document.querySelector('.qa-a.qa-open a').click(); 1`).catch(() => {}); await wait(100);
  check('a click on a link in the answer does not close it', (await shown()).length === 2);
  await js(`${q(1)}.focus(); ${q(1)}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`); await wait(150);
  check('Enter on a focused card opens it', await js(`${q(1)}.classList.contains('qa-open')`));
  await js(`${q(1)}.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))`); await wait(100);
  check('Space closes it again', !(await js(`${q(1)}.classList.contains('qa-open')`)));

  // a new question arrives
  await js(`appendBubble({ role: 'user', text: 'One more thing', time: 'now' }); 1`); await wait(300);
  check('a new question is a new card, and it is the open one', (await n('.qa-q')) === 4 && await js(`${q(3)}.classList.contains('qa-open')`));
  check('the card you opened yourself stays open; the old newest one closes', await js(`${q(0)}.classList.contains('qa-open')`) && !(await js(`${q(2)}.classList.contains('qa-open')`)));
  await js(`appendBubble({ role: 'assistant', id: 'streamingBubble', text: 'Typing…', source: 'claude' }); 1`); await wait(300);
  check('an answer being written is visible under the new card', (await shown()).some((s) => /Typing/.test(s)));
  await js(`${q(3)}.click()`); await wait(150);
  check('even if you close that card, the answer being written stays visible', (await shown()).some((s) => /Typing/.test(s)));
  if (SHOT) require('fs').writeFileSync(path.join(__dirname, 'shot-cards.png'), (await w.webContents.capturePage()).toPNG());

  // the Settings row does the same as the toolbar button
  check('Settings has a "Chat as cards" row, lit while Cards is on', !!(await js(`document.getElementById('btnCards')`)) && await js(`document.getElementById('btnCards').classList.contains('active')`));
  await js(`document.getElementById('btnCards').click()`); await wait(300);
  check('the row turns Cards off (saved, toolbar button and row follow)', !(await js(`document.body.classList.contains('chat-cards')`)) && (await js(`window.__stored.chatCards`)) === false && !(await js(`document.getElementById('btnCards').classList.contains('active')`)) && !(await js(`document.getElementById('tbCards').classList.contains('open')`)));
  await js(`document.getElementById('btnCards').click()`); await wait(300);
  check('and on again', (await js(`document.body.classList.contains('chat-cards')`)) && (await js(`window.__stored.chatCards`)) === true && (await n('.qa-q')) === 4);

  // off again
  await js(`document.getElementById('tbCards').click()`); await wait(300);
  check('the toolbar button also updates the Settings row', !(await js(`document.getElementById('btnCards').classList.contains('active')`)));
  check('Cards off: back to the normal chat, every answer visible', (await n('.qa-q')) === 0 && (await shown()).length === 4 && (await js(`window.__stored.chatCards`)) === false, String((await shown()).length));

  console.log(`\n${pass} passed, ${fail} failed`);
  app.exit(fail ? 1 : 0);
});
