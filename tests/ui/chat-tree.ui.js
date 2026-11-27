// Chat Tree mode: the tree above the chat, click a node to chat with it, and the chat follows up to the parent
// when the chat you are in sends its result / question (not while you type). Usage: electron chat-tree.ui.js [shot]
require('./logpatch');
const { app, BrowserWindow } = require('electron');
const path = require('path');
const os = require('os');
app.disableHardwareAcceleration(); app.setPath('userData', os.tmpdir() + '/ovly-ui-test-tree');
let pass = 0, fail = 0;
const check = (n, ok, i = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${i ? ' — ' + i : ''}`); };
process.on('unhandledRejection', (e) => { console.log('FAIL  unexpected error —', e && e.message); app.exit(1); });

app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 820, height: 900, show: false, frame: false, useContentSize: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (c) => w.webContents.executeJavaScript(c).catch((e) => 'ERR ' + e.message);
  w.loadFile(path.join(__dirname, '../../ui/index.html')); await new Promise((r) => w.webContents.once('did-finish-load', r)); await wait(2000);

  const S = (id, project, extra = {}) => ({ id, sessionUuid: id.replace('claude_', ''), source: 'claude', project, cwd: 'C:/p', status: 'idle', state: 'idle', subagents: [], mtime: Date.now(), ...extra });
  const sessions = [S('claude_root', 'Main chat'), S('claude_c1', 'Investigate', { status: 'running', statusLabel: 'Running: Read' }), S('claude_c2', 'Tests'), S('claude_g1', 'Logs'), S('claude_other', 'Unrelated')];
  const tree = {
    root: 'claude_root', spent: 0.42, budget: 2, paused: false, stopped: false,
    nodes: [
      { key: 'claude_root', sid: 'claude_root', short: 'main', parent: null, depth: 0, title: 'Main chat', model: '', state: 'waiting', spent: 0.2, inbox: 1, createdAt: 1 },
      { key: 'claude_tree_a', sid: 'claude_c1', short: 'c1', parent: 'claude_root', depth: 1, title: 'Investigate the loop', model: 'sonnet', readOnly: true, state: 'running', spent: 0.1, inbox: 0, createdAt: 2 },
      { key: 'claude_tree_b', sid: 'claude_c2', short: 'c2', parent: 'claude_root', depth: 1, title: 'Write tests', model: 'haiku', state: 'done', spent: 0.08, inbox: 0, createdAt: 3, branch: 'ovly-tree/c2-abc', merged: false, work: { commits: 1, files: 2, stat: '2 files changed, 30 insertions(+)' } },
      { key: 'claude_tree_g', sid: 'claude_g1', short: 'c3', parent: 'claude_tree_a', depth: 2, title: 'Check the logs', model: 'haiku', state: 'running', spent: 0.04, inbox: 0, createdAt: 4 },
    ],
  };
  await js(`window.__T = ${JSON.stringify(tree)};
    window.__treeFor = (id) => window.__T.nodes.some(n => n.sid === id || n.key === id) ? window.__T : null;
    window.__cbs.onSessionsSync(${JSON.stringify(sessions)});
    showDetailView(sessionsList.find(s => s.id === 'claude_root')); 1`);
  await wait(300);
const shown = (sel) => js(`(() => { const e = document.querySelector('${sel}'); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0; })()`);
  const shot = async (name) => { if (!process.argv[2]) return; const img = await w.webContents.capturePage(); require('fs').writeFileSync(path.join(os.tmpdir(), name), img.toPNG()); };
  const curId = () => js(`currentActiveSession && currentActiveSession.id`);
  const focus = () => js(`[...document.querySelectorAll('.tp-node.focus')].map(n => n.dataset.key).join(',')`);

  check('Tree is off at first (no panel)', (await js(`getComputedStyle(document.getElementById('treePanel')).display`)) === 'none');
  await js(`document.getElementById('tbTree').click(); 1`); await wait(400);
  check('the Tree button shows the panel above the chat', (await js(`getComputedStyle(document.getElementById('treePanel')).display`)) === 'flex'
    && (await js(`!!(document.getElementById('treePanel').compareDocumentPosition(document.getElementById('chatStream')) & Node.DOCUMENT_POSITION_FOLLOWING)`)) === true);
  check('Tree mode shows the full canvas: the chat box is hidden', (await shown('#detailView .convo-main')) === false);
  const full = await js(`Math.round(document.getElementById('treePanel').getBoundingClientRect().width)`);
  await shot('ovly-tree-full.png');
  check('every node of the tree is drawn', (await js(`document.querySelectorAll('.tp-node').length`)) === 4);
  check('…with a wire from each child to its parent', (await js(`document.querySelectorAll('.tp-wire').length`)) === 3);
  check('the chat you are in has the 💬 ring', (await focus()) === 'claude_root');
  check('the parent shows its inbox count', (await js(`document.querySelector('.tp-node.root .tp-inbox')?.textContent`)) === '1');
  check('a running child shows its live step', /Read/.test(await js(`document.querySelector('.tp-node[data-key="claude_tree_a"] .tp-step').textContent`)));
  check('the spend / budget is shown', (await js(`document.querySelector('.tp-budget').textContent`)) === '$0.42 / $2.00');
  const geo = await js(`(() => { const r = (k) => document.querySelector('.tp-node[data-key="' + k + '"]').getBoundingClientRect(); const a = r('claude_root'), b = r('claude_tree_a'), c = r('claude_tree_g'); return [a.top < b.top, b.top < c.top, Math.abs((b.left + b.right) / 2 - (c.left + c.right) / 2) < 2]; })()`);
  check('levels go down the panel; a single child sits under its parent', JSON.stringify(geo) === '[true,true,true]', JSON.stringify(geo));

  await js(`document.querySelector('.tp-node[data-key="claude_tree_a"]').click(); 1`); await wait(400);
  check('clicking a node opens that chat', (await curId()) === 'claude_c1');
  check("narrow window: the chat box takes the canvas' place", (await shown('#detailView .convo-main')) && (await shown('#treePanel')) === false);
  w.setContentSize(1300, 900); await wait(500);
  check('…in a chat box beside the canvas', (await shown('#detailView .convo-main'))
    && (await js(`document.getElementById('treePanel').getBoundingClientRect().right <= document.querySelector('#detailView .convo-main').getBoundingClientRect().left + 1`)) === true
    && (await js(`Math.round(document.getElementById('treePanel').getBoundingClientRect().width)`)) < full);
  check("…headed with the node's name and ✕ Back to tree", (await js(`document.querySelector('.tp-chatname').textContent`)) === 'Investigate the loop');
  await shot('ovly-tree-split.png');
  w.setContentSize(820, 900); await wait(400);
  check('…and the 💬 ring moves to it', (await focus()) === 'claude_tree_a');
  check('Tree mode stays on while you chat with a child', (await js(`document.body.classList.contains('chat-tree-on')`)) === true);

  // the child you are chatting with sends its result up → the chat follows to the parent
  await js(`window.__cbs.onTreeEvent({ root: 'claude_root', kind: 'result', from: 'claude_tree_a', to: 'claude_root', text: 'Cause: guard.ts:42' }); 1`);
  await wait(300);
  check('a light runs up the wire', (await js(`!!document.querySelector('.tp-pk.res')`)) === true);
  check('…and the chat waits for it to arrive', (await curId()) === 'claude_c1');
  await wait(1000);
  check('then the chat switches to the parent', (await curId()) === 'claude_root');
  check('…with a bar saying why, and ↩ Back', /Investigate the loop sent its result to Main chat — switched here/.test(await js(`document.querySelector('.tp-toast.on span')?.textContent || ''`))
    && (await js(`document.querySelector('.tp-toast .tp-btn').textContent`)) === '↩ Back');
  await js(`document.querySelector('.tp-toast .tp-btn').click(); 1`); await wait(300);
  check('↩ Back returns to the child', (await curId()) === 'claude_c1');

  // a question goes up while you are typing → no switch, a bar offers to go
  await js(`document.getElementById('replyTextarea').value = 'half-written message'; window.__cbs.onTreeEvent({ root: 'claude_root', kind: 'question', from: 'claude_tree_a', to: 'claude_root', text: 'Mock or real?' }); 1`);
  await wait(1300);
  check('while you type it does not switch', (await curId()) === 'claude_c1');
  check('…an amber bar offers “Go there” instead', (await js(`document.querySelector('.tp-toast.on.warn .tp-btn')?.textContent`)) === 'Go there'
    && /is asking Main/.test(await js(`document.querySelector('.tp-toast span').textContent`)));
  check('…and your draft is kept', (await js(`document.getElementById('replyTextarea').value`)) === 'half-written message');
  await js(`document.getElementById('replyTextarea').value = ''; 1`);

  // things that must NOT move you: a command going down, a result from a chat you are not in
  await js(`window.__cbs.onTreeEvent({ root: 'claude_root', kind: 'command', from: 'claude_tree_a', to: 'claude_tree_g', text: 'grep logs' }); window.__cbs.onTreeEvent({ root: 'claude_root', kind: 'result', from: 'claude_tree_b', to: 'claude_root', text: 'x' }); 1`);
  await wait(1300);
  check('a command going down, or another chat\'s result, does not move you', (await curId()) === 'claude_c1');
  await js(`document.querySelector('.tp-follow').click(); window.__cbs.onTreeEvent({ root: 'claude_root', kind: 'result', from: 'claude_tree_a', to: 'claude_root', text: 'y' }); 1`);
  await wait(1300);
  check('📌 Stay (Follow up off) never switches', (await curId()) === 'claude_c1' && (await js(`document.querySelector('.tp-follow').textContent`)) === '📌 Stay');
  await js(`document.querySelector('.tp-follow').click(); 1`);

  // ↳ Child: your own task for a child of the open chat
  await js(`document.querySelector('.tp-head .tp-btn').click(); 1`); await wait(100);
  await js(`(() => { const f = document.querySelector('.tp-form'); f.querySelector('input').value = 'Grep the logs'; f.querySelector('textarea').value = 'Find 302s on /login'; f.querySelector('select').value = 'haiku'; f.querySelector('.tp-primary').click(); })(); 1`);
  await wait(300);
  const call = await js(`JSON.stringify(window.__calls.filter(c => c[0] === 'treeStart').map(c => c[1]))`);
  check('↳ Child starts a child of the open chat with your task', call === JSON.stringify([{ parentId: 'claude_c1', title: 'Grep the logs', task: 'Find 302s on /login', model: 'haiku', readOnly: false }]), call);

  // ⤵ Merge / ✕ Remove on child nodes
  check('a child with work on its branch shows ⎇ files and ⤵ Merge', /⎇ 2 files/.test(await js(`document.querySelector('.tp-node[data-key="claude_tree_b"] .tp-meta').textContent`))
    && (await js(`!!document.querySelector('.tp-node[data-key="claude_tree_b"] .tp-merge')`)) === true);
  check('a running child has no ⤵ Merge', (await js(`!!document.querySelector('.tp-node[data-key="claude_tree_a"] .tp-merge')`)) === false);
  check('the top chat has no ✕ (only children can be removed)', (await js(`!!document.querySelector('.tp-node.root .tp-rm')`)) === false);
  const before = await curId();
  await js(`document.querySelector('.tp-node[data-key="claude_tree_b"] .tp-merge').click(); 1`); await wait(300);
  check('⤵ Merge asks the engine to merge that child (and does not open it)', (await js(`JSON.stringify(window.__calls.filter(c => c[0] === 'treeMerge').map(c => c[1]))`)) === '["claude_tree_b"]' && (await curId()) === before);
  check('…and says what happened', /Merged c2/.test(await js(`document.querySelector('.tp-toast span').textContent`)));
  await js(`window.__metaSaved = []; const o = window.electronAPI.storeSet; window.electronAPI.storeSet = (k, v) => { if (k === 'sessionMeta') window.__metaSaved.push(v); return o && o(k, v); }; 1`);
  await js(`window.confirm = () => true; document.querySelector('.tp-node[data-key="claude_tree_b"] .tp-rm').click(); 1`); await wait(400);
  check('✕ removes that child via the engine', (await js(`JSON.stringify(window.__calls.filter(c => c[0] === 'treeRemove').map(c => c[1]))`)) === '["claude_tree_b"]');
  check('…and hides its chat in the list (saved as hidden)', (await js(`JSON.stringify(window.__metaSaved.map(m => m.hidden))`)) === '[["claude_c2"]]', await js(`JSON.stringify(window.__metaSaved)`));
  await js(`window.confirm = () => false; document.querySelector('.tp-node[data-key="claude_tree_a"] .tp-rm').click(); 1`); await wait(200);
  check('cancelling the question removes nothing', (await js(`window.__calls.filter(c => c[0] === 'treeRemove').length`)) === 1);

  // ⟲ Replay: nodes appear in the order they were made, lights run, captions say what was sent
  await js(`window.__treeReplayFast = 0.3; window.__treeLog = [
    { at: 1000, kind: 'node', key: 'claude_tree_a' }, { at: 1100, kind: 'command', from: 'claude_root', to: 'claude_tree_a', text: 'find the bug' },
    { at: 3000, kind: 'node', key: 'claude_tree_g' }, { at: 3100, kind: 'command', from: 'claude_tree_a', to: 'claude_tree_g', text: 'grep logs' },
    { at: 6000, kind: 'result', from: 'claude_tree_g', to: 'claude_tree_a', text: '302 loop' } ]; 1`);
  await js(`document.querySelector('.tp-head .tp-btn[title^="Replay"]').click(); 1`); await wait(30);
  check('replay starts from the top chat alone', (await js(`document.querySelectorAll('.tp-node').length`)) === 1 && (await js(`document.getElementById('treePanel').classList.contains('replaying')`)) === true);
  await wait(800);
  const mid = await js(`[...document.querySelectorAll('.tp-node')].map(n => n.dataset.key).sort().join(',')`);
  check('…then the nodes appear as they were made', mid === 'claude_root,claude_tree_a,claude_tree_g', mid);
  check('…with a caption of what was sent', /302 loop|grep logs|find the bug/.test(await js(`document.querySelector('.tp-toast span').textContent`)));
  await wait(900);
  check('…and the live tree comes back at the end', (await js(`document.getElementById('treePanel').classList.contains('replaying')`)) === false && (await js(`document.querySelectorAll('.tp-node').length`)) === 4);

  if (process.argv[2]) {
    await js(`showDetailView(sessionsList.find(s => s.id === 'claude_root')); 1`); await wait(400);
    await js(`window.__cbs.onTreeEvent({ root: 'claude_root', kind: 'command', from: 'claude_root', to: 'claude_tree_b', text: 'more' }); 1`); await wait(420);
    const img = await w.webContents.capturePage();
    require('fs').writeFileSync(path.join(os.tmpdir(), 'ovly-tree.png'), img.toPNG());
  }

  // a chat with no tree: just itself and a hint
  await js(`showDetailView(sessionsList.find(s => s.id === 'claude_other')); 1`); await wait(500);
  check('a chat without children shows itself and how to start', (await js(`document.querySelectorAll('.tp-node').length`)) === 1
    && /No child chats yet/.test(await js(`document.querySelector('.tp-hint').textContent`)));

  await js(`showDetailView(sessionsList.find(s => s.id === 'claude_root')); 1`); await wait(300);
  await js(`document.querySelector('.tp-node').click(); 1`); await wait(300);
  await js(`document.querySelector('.tp-chatbar .tp-btn').click(); 1`); await wait(200);
  check('✕ Back to tree closes the chat box: full canvas again', (await shown('#detailView .convo-main')) === false && (await shown('#treePanel')) === true);
  await js(`document.getElementById('tbTree').click(); 1`); await wait(200);
  const en = await js(`JSON.stringify(window.__calls.filter(c => c[0] === 'treeEnable').map(c => [c[1], c[2]]))`);
  check('Tree mode gives Claude the tools in the chats you open with it on', /\["claude_root",true\]/.test(en) && /\["claude_c1",true\]/.test(en), en);
  check('…and turning Tree mode off takes them away again', /\[null,false\]\]$/.test(en), en);
  check('Tree again hides it', (await js(`getComputedStyle(document.getElementById('treePanel')).display`)) === 'none' && (await shown('#detailView .convo-main')) === true);

  console.log(`\n${pass} passed, ${fail} failed`);
  app.exit(fail ? 1 : 0);
});
