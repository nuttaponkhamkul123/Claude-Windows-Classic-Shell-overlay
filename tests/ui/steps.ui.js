require('./logpatch');
const { app, BrowserWindow } = require('electron');
const path = require('path');
app.disableHardwareAcceleration(); app.setPath('userData', require('os').tmpdir() + '/ovly-ui-test-ud3');
let pass = 0, fail = 0;
const check = (n, ok, i = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${i ? ' — ' + i : ''}`); };
const session = () => { const now = Date.now(); return { id: 'claude_s2', sessionUuid: 's2', source: 'claude', project: 'ovly-claude', cwd: 'C:/work/ovly-claude', status: 'idle', state: 'waiting', statusLabel: 'Idle', title: 'ovly-claude', sessionTitle: 'Flow', detail: 'x', fullContent: 'Done.', model: 'claude-opus-5-5', mtime: now, lastTurnTs: now, context: { used: 80000, window: 200000 }, activity: null }; };
process.on('unhandledRejection', (e) => { console.log('FAIL  unexpected error —', e && e.message); app.exit(1); });
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 1100, height: 720, show: false, frame: false, useContentSize: true, webPreferences: { preload: path.join(__dirname, 'preload-steps.js'), contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } });
  w.webContents.on('console-message', (e) => { if (e.level === 'error' && !/available/.test(e.message)) console.log('[page]', e.message, e.sourceId, e.lineNumber); });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (c) => w.webContents.executeJavaScript(c).catch((e) => 'ERR ' + e.message);
  const q = (sel, prop = 'textContent') => js(`document.querySelector(${JSON.stringify(sel)})?.${prop}`);
  const n = (sel) => js(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
  const calls = () => js('window.__stepCalls');
  w.loadFile(path.join(__dirname, '../../ui/index.html')); await new Promise((r) => w.webContents.once('did-finish-load', r)); await wait(2200);
  await js(`window.__cbs.onSessionsSync(${JSON.stringify([session()])}); document.head.insertAdjacentHTML('beforeend','<style>*{transition:none!important;animation:none!important}</style>'); 1`);
  await js(`showDetailView(sessionsList[0]); 1`); await wait(800);

  check('the chat toolbar has a Steps button', !!(await js(`document.getElementById('tbSteps')`)));
  await js(`document.getElementById('tbSteps').click()`); await wait(500);
  check('Steps opens the panel', await js(`document.body.classList.contains('sp-open')`));
  check('it asked for this chat\'s steps', JSON.stringify((await calls()).filter((c) => c[0] === 'getSteps')) === '[["getSteps","claude_s2"]]');
  check('5 steps, grouped under 2 messages you wrote', (await n('.sp-row')) === 5 && (await n('.sp-turn')) === 2 && /Fix the login bug/.test(await q('.sp-turn-text')), `${await n('.sp-row')} rows`);
  check('the header counts them', /Flow · 5 steps/.test(await q('.sp-sub')), await q('.sp-sub'));
  check('rows show kind, what happened, time taken, result', /RUN/.test(await js(`document.querySelectorAll('.sp-row')[2].textContent`)) && /npm test -- --silent/.test(await js(`document.querySelectorAll('.sp-row')[2].textContent`)) && /3\.0 s/.test(await js(`document.querySelectorAll('.sp-row')[2].textContent`)) && /FAILED/.test(await js(`document.querySelectorAll('.sp-row')[2].textContent`)));
  check('a failed step is marked', await js(`document.querySelectorAll('.sp-row')[2].classList.contains('bad')`));
  check('a step with no result yet is not marked ok or failed', !/OK|FAILED/.test(await js(`document.querySelectorAll('.sp-row')[4].querySelector('.sp-stat').textContent`)));

  // open a row
  await js(`document.querySelectorAll('.sp-row')[2].click()`); await wait(150);
  check('click a step: the command and what went wrong show', /Run the tests/.test(await q('.sp-detail')) && /1 failed/.test(await q('.sp-detail .sp-code.bad')));
  await js(`[...document.querySelectorAll('.sp-detail .sp-btn')].find((b) => /Copy/.test(b.textContent)).click()`);
  check('Copy command copies it', (await calls()).some((c) => c[0] === 'copy' && /npm test/.test(c[1])));
  await js(`document.querySelectorAll('.sp-row')[2].click()`); await wait(100);
  check('click again: it closes', (await n('.sp-detail')) === 0);
  await js(`document.querySelectorAll('.sp-row')[1].click()`); await wait(100);
  await js(`[...document.querySelectorAll('.sp-detail .sp-btn')].find((b) => /Open file/.test(b.textContent)).click()`);
  check('an edit has Open file', (await calls()).some((c) => c[0] === 'openFile' && /auth\.js/.test(c[1])));

  // filters
  await js(`[...document.querySelectorAll('.sp-chip')].find((b) => /^Failed/.test(b.textContent)).click()`); await wait(100);
  check('Failed chip: only the failed step', (await n('.sp-row')) === 1 && /npm test/.test(await q('.sp-row .sp-what')));
  await js(`[...document.querySelectorAll('.sp-chip')].find((b) => /^All/.test(b.textContent)).click()`); await wait(100);
  await js(`[...document.querySelectorAll('.sp-chip')].find((b) => /^Edits/.test(b.textContent)).click()`); await wait(100);
  check('Edits chip: only the edit', (await n('.sp-row')) === 1 && /Edited/.test(await q('.sp-row .sp-what')));
  await js(`[...document.querySelectorAll('.sp-chip')].find((b) => /^All/.test(b.textContent)).click()`); await wait(100);
  await js(`(() => { const i = document.querySelector('.sp-input'); i.value = 'auth'; i.dispatchEvent(new Event('input', { bubbles: true })); })(); 1`); await wait(150);
  check('typing finds steps by file name, with the match highlighted', (await n('.sp-row')) === 2 && (await n('.sp-mark')) >= 2);
  check('with text typed, "Search all chats" appears', !(await js(`[...document.querySelectorAll('.sp-head .sp-btn')].find((b) => /all chats/.test(b.textContent)).hidden`)));
  await js(`(() => { const i = document.querySelector('.sp-input'); i.value = 'zzzz'; i.dispatchEvent(new Event('input', { bubbles: true })); })(); 1`); await wait(100);
  check('no match says so', /No step matches/.test(await q('.sp-empty')));

  // close
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await wait(150);
  check('Esc closes the panel', !(await js(`document.body.classList.contains('sp-open')`)));

  // the list search also finds steps in every chat
  await js(`showListView(); 1`); await wait(400);
  await js(`(() => { const b = document.querySelector('.fx-search-input'); b.value = 'npm test'; b.dispatchEvent(new Event('input', { bubbles: true })); })(); 1`); await wait(1200);
  check('list search: a "steps" section with the hit', /1 step/.test(await q('#fxResults, .fx-results')) && (await n('.fx-hit-step')) === 1, (await q('.fx-results')) || '');
  await js(`document.querySelector('.fx-hit-step').click()`); await wait(900);
  check('clicking it opens the chat and its Steps panel on that search', await js(`document.body.classList.contains('sp-open')`) && (await q('.sp-input', 'value')) === 'npm test');
  check('the failed npm test step is opened', /1 failed/.test((await q('.sp-detail')) || ''));

  console.log(`\n${pass} passed, ${fail} failed`);
  app.exit(fail ? 1 : 0);
});
