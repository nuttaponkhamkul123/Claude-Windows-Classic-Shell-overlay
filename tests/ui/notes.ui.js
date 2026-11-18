require('./logpatch');
const { app, BrowserWindow } = require('electron');
const path = require('path');
app.disableHardwareAcceleration(); app.setPath('userData', require('os').tmpdir() + '/ovly-ui-test-ud5');
let pass = 0, fail = 0;
const check = (n, ok, i = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${i ? ' — ' + i : ''}`); };
const session = () => { const now = Date.now(); return { id: 'claude_s2', sessionUuid: 's2', source: 'claude', project: 'ovly-claude', cwd: 'C:/work/ovly-claude', status: 'idle', state: 'waiting', statusLabel: 'Idle', title: 'ovly-claude', sessionTitle: 'Flow', detail: 'x', fullContent: 'Done.', model: 'claude-opus-5-5', mtime: now, lastTurnTs: now, context: { used: 80000, window: 200000 }, activity: null }; };
process.on('unhandledRejection', (e) => { console.log('FAIL  unexpected error —', e && e.message); app.exit(1); });
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 1100, height: 720, show: false, frame: false, useContentSize: true, webPreferences: { preload: path.join(__dirname, 'preload-notes.js'), contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } });
  w.webContents.on('console-message', (e) => { if (e.level === 'error' && !/available/.test(e.message)) console.log('[page]', e.message, e.sourceId, e.lineNumber); });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (c) => w.webContents.executeJavaScript(c).catch((e) => 'ERR ' + e.message);
  const q = (sel, prop = 'textContent') => js(`document.querySelector(${JSON.stringify(sel)})?.${prop}`);
  const n = (sel) => js(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
  const calls = () => js('window.__notesCalls');
  const esc = () => js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  w.loadFile(path.join(__dirname, '../../ui/index.html')); await new Promise((r) => w.webContents.once('did-finish-load', r)); await wait(2200);
  await js(`window.__cbs.onSessionsSync(${JSON.stringify([session()])}); document.head.insertAdjacentHTML('beforeend','<style>*{transition:none!important;animation:none!important}</style>'); 1`);
  await js(`showDetailView(sessionsList[0]); 1`); await wait(800);

  const realPreload = require('fs').readFileSync(path.join(__dirname, '../../preload.js'), 'utf8');
  check('no separate Notes window any more (the real preload has no toggle / window calls)', !/notes:toggle|notes:theme|notes:close/.test(realPreload) && !require('fs').existsSync(path.join(__dirname, '../../ui/notes.html')));
  check('the Notes button shows the note count', /3/.test(await q('.tb-notes .notes-badge')), await q('.tb-notes .notes-badge'));
  await js(`document.getElementById('tbNotes').click()`); await wait(500);
  check('Notes slides the panel in', await js(`document.body.classList.contains('np-open')`));
  check('and the button shows it is open', await js(`document.getElementById('tbNotes').classList.contains('open')`));
  check('two workspaces: alpha (2 notes) and beta (1)', (await n('.np-group')) === 2 && /2 notes/.test(await q('.np-group .np-group-count')));
  check('alpha rests as a deck, beta as one open card', (await n('.np-stack.stacked')) === 1 && (await n('.np-stack.dealt')) === 1);
  check('the header counts the notes', /3 notes/.test(await q('.np-sub')), await q('.np-sub'));

  // deal the deck, open a card
  await js(`document.querySelector('.np-stack.stacked').click()`); await wait(300);
  check('click the deck: both cards are dealt out', (await n('.np-stack.stacked')) === 0 && (await n('.np-card')) === 3);
  await js(`document.querySelector('.np-card .np-card-top').click()`); await wait(150);
  check('click a card: the Markdown is rendered', /Steps/.test(await q('.np-body h2')) && (await n('.np-body li')) === 2 && /push/.test(await q('.np-body strong')));
  check('scripts and handlers in a note do not run or stay', (await js(`window.__pwned`)) === undefined && !(await js(`!!document.querySelector('.np-body script, .np-body img[onerror]')`)));

  // actions
  await js(`[...document.querySelectorAll('.np-acts .np-btn')].find((b) => b.textContent === 'Copy').click()`);
  await js(`[...document.querySelectorAll('.np-acts .np-btn')].find((b) => b.textContent === 'Open').click()`);
  await wait(100);
  const c = await calls();
  check('Copy and Open reach the main process with the note id', c.some((x) => x[0] === 'copy' && x[1] === '20261118-090000-newest') && c.some((x) => x[0] === 'open' && x[1] === '20261118-090000-newest'));
  await js(`[...document.querySelectorAll('.np-acts .np-btn')].find((b) => b.textContent === 'Unpin').click()`);
  check('Unpin asks "Sure?" first, nothing removed yet', /Sure/.test(await js(`[...document.querySelectorAll('.np-acts .np-btn')].find((b) => /Sure/.test(b.textContent))?.textContent`)) && !(await calls()).some((x) => x[0] === 'unpin'));
  await js(`[...document.querySelectorAll('.np-acts .np-btn')].find((b) => /Sure/.test(b.textContent)).click()`); await wait(100);
  check('the second click unpins it', (await calls()).some((x) => x[0] === 'unpin' && x[1] === '20261118-090000-newest'));
  await js(`window.__notesEmit('changed'); 1`); await wait(300);
  check('the list refreshes: 2 notes left', (await n('.np-card')) === 2 && /2 notes/.test(await q('.np-sub')), `${await n('.np-card')}`);

  // filter
  await js(`(() => { const i = document.querySelector('.np-filter'); i.value = 'release'; i.dispatchEvent(new Event('input', { bubbles: true })); })(); 1`); await wait(150);
  check('filter finds a note by its text', (await n('.np-card')) === 1 && /Release notes/.test(await q('.np-card-title')));
  const escInFilter = () => js(`document.querySelector('.np-filter').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await escInFilter(); await wait(150);
  check('Esc in the filter clears it first, and the panel stays', (await q('.np-filter', 'value')) === '' && (await js(`document.body.classList.contains('np-open')`)));
  await esc(); await wait(150);
  check('Esc again closes the panel', !(await js(`document.body.classList.contains('np-open')`)));
  check('and the button is not shown open', !(await js(`document.getElementById('tbNotes').classList.contains('open')`)));

  // a new note arrives
  await js(`window.__setNotes([{ id: '20261118-100000-fresh', title: 'Fresh note', project: 'gamma', cwd: 'C:/w/gamma', pinned: new Date().toISOString(), tags: [], body: 'just pinned' }]); window.__notesEmit('new', { id: '20261118-100000-fresh' }); 1`); await wait(700);
  check('a note pinned by Claude opens the panel on it', await js(`document.body.classList.contains('np-open')`) && /Fresh note/.test(await q('.np-card.open .np-card-title')), await q('.np-card-title'));
  check('and it is opened and highlighted', /just pinned/.test((await q('.np-card.open .np-body')) || ''));
  await js(`document.querySelector('.np-backdrop').click()`); await wait(150);
  check('clicking outside closes the panel', !(await js(`document.body.classList.contains('np-open')`)));

  // empty
  await js(`window.__setNotes([]); window.toggleNotes(); 1`); await wait(300);
  check('no notes: the how-to hint shows', !(await js(`document.querySelector('.np-empty').hidden`)) && /pin_note/.test(await q('.np-empty')));

  console.log(`\n${pass} passed, ${fail} failed`);
  app.exit(fail ? 1 : 0);
});
