// Activity bar steps: clicking anywhere on the bar opens the finished-steps list,
// and when the reply finishes the steps stay under the reply (folded, click to open).
// A step that ran a command opens its full command, split one part per line and coloured.
require('./logpatch');
const { app, BrowserWindow } = require('electron');
const path = require('path');
app.disableHardwareAcceleration(); app.setPath('userData', require('os').tmpdir() + '/ovly-ui-test-replysteps');
let pass = 0, fail = 0;
const check = (n, ok, i = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${i ? ' — ' + i : ''}`); };
process.on('unhandledRejection', (e) => { console.log('FAIL  unexpected error —', e && e.message); app.exit(1); });
const style = process.argv[2]; // e.g. Work, Pip-Boy, Classic: also saves a screenshot
const CMD = 'cd /c/proj && npm install --no-audit && npm test -- --grep "login flow" | tee out.log; echo done';
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 700, height: 800, show: false, frame: false, useContentSize: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (c) => w.webContents.executeJavaScript(c).catch((e) => 'ERR ' + e.message);
  w.loadFile(path.join(__dirname, '../../ui/index.html')); await new Promise((r) => w.webContents.once('did-finish-load', r)); await wait(2200);

  const sess = { id: 'claude:steps-1', sessionUuid: 'steps-1', source: 'claude', project: 'p', cwd: 'C:/p', status: 'running', state: 'running', subagents: [], mtime: Date.now(), runningSince: Date.now(), activity: { kind: 'tool', tool: 'Read', input: { file_path: 'C:/p/a.js' }, since: Date.now() } };
  await js(`window.__S = ${JSON.stringify(sess)}; window.__cbs.onSessionsSync([window.__S]); showDetailView(window.__S); sessionChatHistory.get(window.__S.id).fromDisk = true; renderActivity(window.__S); 1`);
  await wait(300);
  const step = async (act) => { await js(`window.__S.activity = ${JSON.stringify({ ...act, since: Date.now() })}; renderActivity(window.__S); 1`); await wait(150); };
  await step({ kind: 'tool', tool: 'Edit', input: { file_path: 'C:/p/b.js' } });
  await step({ kind: 'tool', tool: 'Bash', input: { command: CMD } });
  await step({ kind: 'tool', tool: 'Read', input: { file_path: 'C:/p/c.js' } });
  check('the bar counts finished steps', /3 done/.test(await js(`document.querySelector('#activityRow .act-stack')?.textContent || ''`)));
  check('the bar shows a hand cursor', (await js(`getComputedStyle(document.getElementById('activityRow')).cursor`)) === 'pointer');

  await js(`document.getElementById('activityVerb').click(); 1`); await wait(200);
  check('clicking the bar opens the steps list', (await js(`document.querySelectorAll('#activityRow .act-step').length`)) === 3);
  await js(`document.querySelector('#activityRow .act-step.has-cmd').click(); 1`); await wait(150);
  const barCmd = await js(`document.querySelector('#activityRow .step-cmd')?.textContent || ''`);
  check('a command step opens the full command, one part per line',
    barCmd === 'cd /c/proj\n  && npm install --no-audit\n  && npm test -- --grep "login flow"\n  | tee out.log;\necho done', JSON.stringify(barCmd));
  check('the command is coloured', (await js(`document.querySelectorAll('#activityRow .step-cmd span[class^=hljs]').length`)) > 0);
  check('the list stayed open (clicking a step does not close it)', (await js(`getComputedStyle(document.querySelector('#activityRow .act-progress')).display`)) !== 'none');
  await js(`renderActivity(window.__S); 1`); await wait(150);
  check('the command stays open while the bar updates', !!(await js(`document.querySelector('#activityRow .step-cmd')?.offsetParent`)));
  await js(`document.getElementById('activityRow').click(); 1`); await wait(200);
  check('clicking the bar again closes the list', (await js(`getComputedStyle(document.querySelector('#activityRow .act-progress')).display`)) === 'none');

  // the reply finishes
  await js(`window.__S.status = 'idle'; window.__S.state = 'idle'; window.__S.activity = null; renderActivity(window.__S);
    const m = { role: 'assistant', text: 'All done.', time: 'Just now', source: 'claude' }; sessionChatHistory.get(window.__S.id).push(m); m.el = appendBubble(m); 1`);
  await wait(2500);
  check('the bar goes away', (await js(`document.getElementById('activityRow').style.display`)) === 'none');
  const last = `[...document.querySelectorAll('#chatStream .chat-bubble.assistant')].pop()`;
  check('the steps stay under the reply', /4 steps/.test(await js(`${last}.querySelector('.step-list .edit-title')?.textContent || ''`)));
  check('folded at first', (await js(`${last}.querySelector('.step-body').style.display`)) === 'none');
  await js(`${last}.querySelector('.step-head').click(); 1`); await wait(150);
  const rows = await js(`[...${last}.querySelectorAll('.step-row')].map((r) => r.textContent)`);
  check('click opens them, oldest first', Array.isArray(rows) && rows.length === 4 && /a\.js/.test(rows[0]) && /npm install/.test(rows[2]), JSON.stringify(rows));
  await js(`${last}.querySelector('.step-row.has-cmd').click(); 1`); await wait(150);
  check('under the reply too, a command step opens its full command', /\n {2}\| tee out\.log;\necho done$/.test(await js(`${last}.querySelector('.step-cmd')?.textContent || ''`)));
  check('kept with the message (survives a redraw)', (await js(`showDetailView(window.__S); !!${last}.querySelector('.step-list')`)) === true);
  if (style) {
    await js(`[...document.querySelectorAll('.style-pills .theme-pill')].find(x => /^${style}/.test(x.textContent))?.click(); showDetailView(window.__S); ${last}.querySelector('.step-head').click(); ${last}.querySelector('.step-row.has-cmd').click(); 1`); await wait(800);
    console.log('body:', await js(`document.body.className`), '| code bg:', await js(`getComputedStyle(${last}.querySelector('.step-cmd')).backgroundColor`), '| keyword:', await js(`getComputedStyle(${last}.querySelector('.step-cmd .hljs-built_in, .step-cmd .hljs-keyword') || document.body).color`));
    const img = await w.webContents.capturePage(); require('fs').writeFileSync(path.join(require('os').tmpdir(), `ovly-replysteps-${style}.png`), img.toPNG());
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  app.exit(fail ? 1 : 0);
});
