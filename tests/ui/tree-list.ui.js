// Chat list: Chat Tree child chats sit under their parent (indented, ↳ + their name), grandchildren under
// their parent, and ▾ N folds them away. Usage: electron tree-list.ui.js [shot]
require('./logpatch');
const { app, BrowserWindow } = require('electron');
const path = require('path');
const os = require('os');
app.disableHardwareAcceleration(); app.setPath('userData', os.tmpdir() + '/ovly-ui-test-treelist');
let pass = 0, fail = 0;
const check = (n, ok, i = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${i ? ' — ' + i : ''}`); };
process.on('unhandledRejection', (e) => { console.log('FAIL  unexpected error —', e && e.message); app.exit(1); });

app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 820, height: 700, show: false, frame: false, useContentSize: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (c) => w.webContents.executeJavaScript(c).catch((e) => 'ERR ' + e.message);
  w.loadFile(path.join(__dirname, '../../ui/index.html')); await new Promise((r) => w.webContents.once('did-finish-load', r)); await wait(2000);

  const now = Date.now();
  // newest first in the list, so children (started later) would normally sit ABOVE their parent
  const S = (id, title, ago) => ({ id, sessionUuid: id.replace('claude_', ''), source: 'claude', project: 'ovly', cwd: 'C:/ovly', status: 'idle', state: 'idle', subagents: [], mtime: now - ago, aiTitle: title });
  const sessions = [S('claude_g1', '[Chat Tree · task from parent chat', 1000), S('claude_c2', '[Chat Tree · task', 2000), S('claude_other', 'Other chat', 3000), S('claude_c1', '[Chat Tree · task', 4000), S('claude_root', '', 60000)];
  const links = [
    { sid: 'claude_root', root: true, title: 'Fix the login loop, with tests', depth: 0 },
    { sid: 'claude_c1', parentSid: 'claude_root', short: 'c1', title: 'Investigate the loop', depth: 1, createdAt: 1 },
    { sid: 'claude_c2', parentSid: 'claude_root', short: 'c2', title: 'Write tests', depth: 1, createdAt: 2 },
    { sid: 'claude_g1', parentSid: 'claude_c1', short: 'c3', title: 'Check the logs', depth: 2, createdAt: 3 },
  ];
  await js(`window.__links = ${JSON.stringify(links)}; window.__cbs.onSessionsSync(${JSON.stringify(sessions)}); window.refreshTreeList(); 1`);
  await wait(500);
  const order = () => js(`[...document.querySelectorAll('#sessionsContainer .session-row')].filter(r => r.offsetParent).map(r => r.id.replace('card-claude_', ''))`);
  const o = await order();
  const at = (id) => o.indexOf(id);
  check('children follow their parent: root, c1, its child g1, then c2', at('c1') === at('root') + 1 && at('g1') === at('root') + 2 && at('c2') === at('root') + 3, JSON.stringify(o));
  check('an unrelated chat stays on its own level', at('other') >= 0 && !(await js(`document.getElementById('card-claude_other').classList.contains('tree-child')`)));
  const ind = await js(`['root','c1','g1'].map(k => Math.round(document.getElementById('card-claude_' + k).getBoundingClientRect().left))`);
  check('each level is indented further', ind[0] < ind[1] && ind[1] < ind[2], JSON.stringify(ind));
  check('a child shows ↳ and its task name instead of the raw first message', (await js(`document.querySelector('#card-claude_c1 .row-title').textContent`)) === '↳ Investigate the loop');
  check('an untitled top chat shows its tree name', (await js(`document.querySelector('#card-claude_root .row-title').textContent`)) === 'Fix the login loop, with tests');
  check('the parent gets a ▾ 2 toggle', (await js(`document.querySelector('#card-claude_root .tree-fold')?.textContent`)) === '▾ 2');

  if (process.argv[2]) { const img = await w.webContents.capturePage(); require('fs').writeFileSync(path.join(os.tmpdir(), 'ovly-tree-list.png'), img.toPNG()); }

  await js(`document.querySelector('#card-claude_root .tree-fold').click(); 1`); await wait(150);
  check('▾ folds every child and grandchild away', JSON.stringify((await order()).filter((x) => ['c1', 'c2', 'g1'].includes(x))) === '[]');
  check('…and turns into ▸ 2', (await js(`document.querySelector('#card-claude_root .tree-fold').textContent`)) === '▸ 2');
  check('folding does not open the chat', (await js(`document.getElementById('detailView').classList.contains('active')`)) === false);
  await js(`window.__cbs.onSessionsSync(${JSON.stringify(sessions)}); 1`); await wait(300);
  check('the fold stays when the list redraws', JSON.stringify((await order()).filter((x) => ['c1', 'c2', 'g1'].includes(x))) === '[]');
  await js(`document.querySelector('#card-claude_root .tree-fold').click(); 1`); await wait(150);
  check('▸ shows them again', (await order()).includes('g1'));

  await js(`document.getElementById('card-claude_c1').click(); 1`); await wait(300);
  check('clicking a child row opens that chat', (await js(`currentActiveSession && currentActiveSession.id`)) === 'claude_c1');

  console.log(`\n${pass} passed, ${fail} failed`);
  app.exit(fail ? 1 : 0);
});
