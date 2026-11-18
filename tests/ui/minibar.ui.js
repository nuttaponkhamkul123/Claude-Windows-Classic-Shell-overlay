require('./logpatch');
const { app, BrowserWindow } = require('electron');
const path = require('path');
app.disableHardwareAcceleration(); app.setPath('userData', require('os').tmpdir() + '/ovly-ui-test-ud');
let pass = 0, fail = 0;
const check = (n, ok, i = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${i ? ' — ' + i : ''}`); };
const now = Date.now();
const S = (id, name, over = {}) => ({ id, sessionUuid: id, source: 'claude', project: name, cwd: 'C:/w/' + name, sessionTitle: name, status: 'idle', state: 'waiting', unread: false, mtime: now, ...over });
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 600, height: 34, show: false, frame: false, webPreferences: { preload: path.join(__dirname, 'preload-minibar.js'), contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } });
  w.webContents.on('console-message', (e) => { if (e.level === 'error') console.log('[page]', e.message, e.sourceId, e.lineNumber); });
  w.loadFile(path.join(__dirname, '../../ui/minibar.html')); await new Promise((r) => w.webContents.once('did-finish-load', r));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (c) => w.webContents.executeJavaScript(c).catch((e) => 'ERR ' + e.message);
  const q = (sel, prop = 'textContent') => js(`document.querySelector(${JSON.stringify(sel)})?.${prop}`);
  const feed = (k, v) => js(`window.__feed(${JSON.stringify(k)}, ${JSON.stringify(v)}); 1`);
  const calls = () => js('window.__calls');
  const id = (x) => `document.getElementById('${x}')`;
  await wait(300);

  check('uses the Pip-Boy colours from the HUD style', await js(`document.body.classList.contains('mb-pip')`));
  await feed('sessions', []);
  check('no chats: says so', /No chats/.test(await q('#sum')));

  await feed('sessions', [
    S('a', 'alpha', { status: 'running', activity: { kind: 'tool', tool: 'Bash', input: { command: 'npm test' }, since: now - 35000 }, context: { used: 80000, window: 200000 } }),
    S('b', 'beta', { unread: true, detail: 'Which file?' }),
    S('c', 'gamma'),
  ]);
  await wait(200);
  check('summary: 1 needs you, 1 running', /1\s*needs you/.test(await q('#sum')) && /1\s*running/.test(await q('#sum')), await q('#sum'));
  check('three status dots, needs-you first', (await js(`document.querySelectorAll('#dots .mb-dot').length`)) === 3 && await js(`document.querySelector('#dots .mb-dot').classList.contains('need')`));
  check('the bar glows when something needs you', await js(`${id('mb')}.classList.contains('need')`));
  check('busiest chat line: name, what it is doing, time', /alpha · Running npm test/.test(await q('#actText')) && /0:3\d/.test(await q('#actTime')), (await q('#actText')) + ' ' + (await q('#actTime')));
  await js(`${id('stop')}.click()`);
  check('Stop sends stop-reply for that chat', JSON.stringify((await calls()).filter((c) => c[0] === 'stop')) === '[["stop","a"]]');

  // approval
  await feed('perms', [{ id: 'p1', sessionId: 'a', toolName: 'Bash', input: { command: 'rm -rf build' } }]);
  await wait(100);
  check('an approval replaces the chat line', !(await js(`${id('perm')}.hidden`)) && await js(`${id('act')}.hidden`));
  check('it names the chat, the tool and the command', /alpha · Bash: rm -rf build/.test(await q('#permText')), await q('#permText'));
  await js(`${id('allow')}.click()`);
  await js(`${id('deny')}.click()`);
  const pc = (await calls()).filter((c) => c[0] === 'perm');
  check('Allow and Deny answer that approval id', JSON.stringify(pc) === '[["perm","p1","allow"],["perm","p1","deny"]]', JSON.stringify(pc));
  await feed('perms', []);
  check('answered elsewhere: the approval goes away', await js(`${id('perm')}.hidden`));

  // queue
  await feed('queues', { a: { n: 2, held: false } });
  check('queue badge: "2 queued", no Resume', /2 queued/.test(await q('#queueText')) && await js(`${id('resume')}.hidden`));
  await feed('queues', { a: { n: 2, held: true } });
  check('kept queue: "2 kept" with Resume', /2 kept/.test(await q('#queueText')) && !(await js(`${id('resume')}.hidden`)));
  await js(`${id('resume')}.click()`);
  check('Resume asks the HUD to resume', (await calls()).some((c) => c[0] === 'resume'));
  await feed('queues', {});
  check('no queue: badge hidden', await js(`${id('queue')}.hidden`));

  // numbers
  await wait(1900);
  check('numbers on the right: cost, context, tokens today', /\$1\.50/.test(await q('#stats')) && /40% ctx/.test(await q('#stats')) && /1\.2M today/.test(await q('#stats')), await q('#stats'));

  // hover: a panel with the chat list and a reply box
  await js(`${id('mb')}.dispatchEvent(new MouseEvent('mouseenter'))`);
  await wait(450);
  check('hover opens the chat list', (await js(`${id('mb')}.classList.contains('open')`)) && (await js(`document.querySelectorAll('.mb-row').length`)) === 3);
  check('needs-you chat is listed first, with its question', /beta/.test(await js(`document.querySelector('.mb-row .mb-row-name').textContent`)) && /Which file/.test(await js(`document.querySelector('.mb-row .mb-row-stat').textContent`)));
  check('the window height follows the panel', (await calls()).some((c) => c[0] === 'height' && c[1] > 34));
  await js(`document.querySelector('.mb-row').click()`);
  check('clicking a chat opens it in the HUD', (await calls()).some((c) => c[0] === 'open' && c[1] === 'b'));

  // quick reply: the target is the chat that needs you; a running chat is refused
  check('reply box targets the chat that needs you', (await js(`${id('target')}.value`)) === 'b');
  await js(`${id('input')}.value = 'the second one'; ${id('reply')}.requestSubmit(); 1`);
  const sent = (await calls()).filter((c) => c[0] === 'send');
  check('quick reply sends the text to that chat', sent.length === 1 && sent[0][1] === 'the second one' && sent[0][2].id === 'b', JSON.stringify(sent));
  await js(`${id('target')}.value = 'a'; ${id('input')}.value = 'hi'; ${id('reply')}.requestSubmit(); 1`);
  check('a busy chat is refused with a message, nothing sent', (await calls()).filter((c) => c[0] === 'send').length === 1 && /busy/.test(await q('#note')), await q('#note'));

  // edge and click-through prefs
  await js(`window.__calls.length = 0; 1`);
  await feed('prefs', { auto: false, through: true, edge: 'bottom' });
  check('bottom edge: the panel opens upwards', await js(`${id('mb')}.classList.contains('bottom')`));
  check('click-through: the window starts ignoring the mouse', (await calls()).some((c) => c[0] === 'ignore' && c[1] === true));

  // auto-hide: quiet for a while, then a thin line
  await js(`${id('input')}.value = ''; ${id('input')}.blur(); ${id('mb')}.dispatchEvent(new MouseEvent('mouseleave')); 1`);
  await feed('prefs', { auto: true, through: false, edge: 'top' });
  await feed('perms', []);
  await feed('sessions', [S('c', 'gamma')]);
  await feed('queues', {});
  await wait(9800);
  check('auto-hide: quiet for 8 seconds, the bar shrinks to a line', await js(`${id('mb')}.classList.contains('line')`));
  check('the window is told to be 6px high', (await calls()).some((c) => c[0] === 'height' && c[1] === 6), JSON.stringify((await calls()).filter((c) => c[0] === 'height')));
  await js(`${id('mb')}.dispatchEvent(new MouseEvent('mouseenter')); 1`);
  await wait(200);
  check('pointing at the line brings the bar back', !(await js(`${id('mb')}.classList.contains('line')`)));
  await feed('sessions', [S('c', 'gamma', { unread: true })]);
  check('something needs you: the bar stays', !(await js(`${id('mb')}.classList.contains('line')`)));

  console.log(`\n${pass} passed, ${fail} failed`);
  app.exit(fail ? 1 : 0);
});
