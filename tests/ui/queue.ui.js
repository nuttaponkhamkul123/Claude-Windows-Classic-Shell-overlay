require("./logpatch");
const { app, BrowserWindow } = require('electron'); const path = require('path'); const fs = require('fs');
app.disableHardwareAcceleration(); app.setPath('userData', require('os').tmpdir() + '/ovly-ui-test-ud');
const W = +process.argv[2] || 1100, STYLE = process.argv[3] || 'Pip-Boy';
const mkSession = (status) => { const now = Date.now(); return { id: 'claude_s2', sessionUuid: 's2', source: 'claude', project: 'ovly-claude', cwd: 'C:/work/ovly-claude', status, state: status === 'running' ? 'tool' : 'waiting', statusLabel: status === 'running' ? 'Running: Bash' : 'Idle', title: 'ovly-claude', sessionTitle: 'Flow', detail: 'x', fullContent: 'Done.', model: 'claude-opus-5-5', mtime: now, lastTurnTs: now, context: { used: 80000, window: 200000 }, activity: status === 'running' ? { kind: 'tool', tool: 'Bash', input: { command: 'npm test' }, since: now - 5000, steps: 2 } : null }; };
let pass = 0, fail = 0; const check = (n, ok, i = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${i ? ' — ' + i : ''}`); };
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: W, height: 720, show: false, frame: false, useContentSize: true, webPreferences: { preload: path.join(__dirname, 'preload-queue.js'), contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } });
  w.webContents.on('console-message', (e) => { if (e.level === 'error' && !/available/.test(e.message)) console.log('[page]', e.message, e.sourceId, e.lineNumber); });
  const load = async () => { w.loadFile('' + path.join(__dirname, '../../ui/index.html').split(path.sep).join('/') + ''); await new Promise((r) => w.webContents.once('did-finish-load', r)); await wait(2200); };
  const js = (c) => w.webContents.executeJavaScript(c).catch((e) => 'ERR ' + e.message);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async () => {}; // (screenshots are only for looking by hand)
  const open = async (status) => {
    await js(`window.__cbs.onSessionsSync(${JSON.stringify([mkSession(status)])}); document.head.insertAdjacentHTML('beforeend','<style>*{transition:none!important;animation:none!important}</style>'); 1`);
    await js(`[...document.querySelectorAll('.style-pills .theme-pill')].find(x => ${new RegExp(STYLE === 'Classic' ? 'Classic' : '^' + STYLE).toString()}.test(x.textContent))?.click(); 1`); await wait(500);
    await js(`showDetailView(sessionsList[0]); 1`); await wait(1000);
  };
  const rows = () => js(`document.querySelectorAll('.queue-row').length`);
  const text = (sel) => js(`document.querySelector(${JSON.stringify(sel)})?.textContent || ''`);

  await load();
  await js(`localStorage.removeItem('fakeStore'); 1`); await load();
  await open('running');
  for (const t of ['first: add a test for the login bug', 'second: update the README with the new flags and run the full test suite afterwards, then summarise what changed', 'third: bump the version']) {
    await js(`submitReply(${JSON.stringify(t)}); 1`); await wait(150);
  }
  check('3 queued → 3 numbered lines in the card', (await rows()) === 3, String(await rows()));
  check('header says "Queue" and "3 waiting"', /Queue/.test(await text('.queue-title')) && /3 waiting/.test(await text('.queue-count')));
  check('the first line is marked "next · sends when Claude is done"', /next/.test(await text('.queue-row .queue-tag.next')));
  check('the chat list shows "3 queued" on that chat', /3 queued/.test(await text('.session-row .row-queue')));
  await shot(`q1-${STYLE}.png`);
  await js(`document.querySelector('.queue-head').click()`); await wait(150);
  check('collapse: the lines are hidden, a "next:" peek shows', (await rows()) === 0 && /next: first/.test(await text('.queue-peek')));
  await shot(`q2-${STYLE}.png`);
  await js(`document.querySelector('.queue-head').click()`); await wait(150);
  check('expand again: 3 lines back', (await rows()) === 3);
  await js(`document.querySelectorAll('.queue-row')[1].click()`); await wait(100);
  check('click a line: it opens to the whole message', await js(`document.querySelectorAll('.queue-row')[1].classList.contains('full')`));
  await js(`document.querySelectorAll('.queue-x')[2].click()`); await wait(150);
  check('✕ removes just that line (3 → 2)', (await rows()) === 2 && /2 waiting/.test(await text('.queue-count')));
  check('the list badge follows ("2 queued")', /2 queued/.test(await text('.session-row .row-queue')));

  // ---- restart: reload the page, the queue must still be there
  const saved = await js(`JSON.parse(localStorage.getItem('fakeStore') || '{}').queuedMessages`);
  check('the queue was saved to settings', saved && saved.claude_s2 && saved.claude_s2.length === 2, JSON.stringify(saved && saved.claude_s2 && saved.claude_s2.map((i) => i.text.slice(0, 12))));
  await load(); await open('running');
  check('after a restart: the 2 messages are back in the card', (await rows()) === 2, String(await rows()));
  check('and are marked "kept after restart"', /kept after restart/.test(await js(`document.querySelector('.queue-bar').textContent`)));
  check('the order is kept', /first/.test(await text('.queue-row .queue-text')));
  check('the card says the queue is held, with Resume and Clear', /held/.test(await text('.queue-count')) && !!(await js(`document.querySelector('.queue-resume')`)) && /Kept from before the restart/.test(await text('.queue-held-text')));
  check('the list badge says "2 held"', /2 held/.test(await text('.session-row .row-queue')));
  await shot(`q3-${STYLE}.png`);

  // ---- the chat is free: a HELD queue is NOT sent on its own
  await js(`window.__cbs.onSessionsSync(${JSON.stringify([mkSession('idle')])}); 1`);
  await wait(6000);
  let sent = await js(`window.__sent`);
  check('chat free after a restart: nothing is sent until you resume', Array.isArray(sent) && sent.length === 0, JSON.stringify(sent));
  check('and the held messages are still shown and saved', (await rows()) === 2 && (await js(`JSON.parse(localStorage.getItem('fakeStore') || '{}').queuedMessages.claude_s2.length`)) === 2);
  // ---- Resume sending: now they go out, in order
  await js(`document.querySelector('.queue-resume').click()`); await wait(200);
  check('Resume sending: the held notice goes away', !(await js(`document.querySelector('.queue-held')`)) && /waiting/.test(await text('.queue-count')));
  await wait(6000);
  sent = await js(`window.__sent`);
  check('chat free: only the first restored message goes out (one at a time)', Array.isArray(sent) && sent.length === 1 && /^first/.test(sent[0]), JSON.stringify((sent || []).map((s) => s.slice(0, 8))));
  const mid = await js(`JSON.parse(localStorage.getItem('fakeStore') || '{}').queuedMessages`);
  check('the saved queue shrinks to the one still waiting', mid && mid.claude_s2 && mid.claude_s2.length === 1 && /^second/.test(mid.claude_s2[0].text), JSON.stringify(mid && mid.claude_s2 && mid.claude_s2.length));
  await js(`window.__cbs.onReplyStatus({ sessionId: 'claude_s2', status: 'idle', statusLabel: 'Idle', text: 'done' }); 1`);
  await js(`window.__cbs.onSessionsSync(${JSON.stringify([mkSession('idle')])}); 1`); // the watcher reports the chat idle again
  await wait(6000);
  sent = await js(`window.__sent`);
  check('first reply finished: the second goes out, in order', sent.length === 2 && /^second/.test(sent[1]), JSON.stringify((sent || []).map((s) => s.slice(0, 8))));
  const after = await js(`JSON.parse(localStorage.getItem('fakeStore') || '{}').queuedMessages`);
  check('and the saved queue is empty afterwards', !after || !after.claude_s2 || after.claude_s2.length === 0, JSON.stringify(after));
  check('the card is gone', (await js(`document.querySelector('.queue-bar').style.display`)) === 'none');

  // ---- limits: a runaway queue is refused, not stored
  await js(`window.__cbs.onSessionsSync(${JSON.stringify([mkSession('running')])}); 1`); await wait(500);
  await js(`window.__sent.length = 0; 1`);
  for (let i = 1; i <= 22; i++) await js(`submitReply('m' + ${i}); 1`);
  check('at most 20 messages per chat are queued', (await rows()) === 20, String(await rows()));
  check('the 21st is refused with a message', /queue is full/i.test(await text('#replyStatusMsg')));
  await js(`document.querySelector('.queue-clear').click(); 1`); await wait(150);
  await js(`submitReply('x'.repeat(50001)); 1`); await wait(150);
  check('a message over 50,000 characters is refused, not queued', (await rows()) === 0 && /too long/i.test(await text('#replyStatusMsg')));
  console.log(`\n${pass} passed, ${fail} failed`);
  app.exit(fail ? 1 : 0);
});
