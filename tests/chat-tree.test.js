// Chat Tree engine (main/chat-tree.js) with a fake Claude runner: commands go down, results / questions come
// back up into the parent's inbox and are delivered as one message, limits and budget hold, and the
// mcp/tree.js server reaches the engine over its local endpoint.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');
const { spawn } = require('child_process');
const { createChatTree } = require('../main/chat-tree');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function setup(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovly-tree-test-'));
  const runHooks = new EventEmitter();
  const aliases = new Map();
  const runs = [];   // every turn the engine asked for: { text, session, options }
  const sent = [];   // [channel, data] to the window
  const stopped = [];
  const settings = { treeBudget: opts.budget ?? 2 };
  const tree = createChatTree({
    file: path.join(dir, 'trees.json'),
    runClaudeTurn: (a) => { runs.push(a); },
    runHooks, aliases, token: 'tok',
    getWin: () => ({ isDestroyed: () => false, webContents: { send: (ch, d) => sent.push([ch, d]) } }),
    getWatcher: () => ({ sessions: new Map([['claude_root', { cwd: opts.cwd || dir, project: 'proj' }]]) }),
    stopReply: (id) => { stopped.push(id); return true; },
    getSetting: (k, d) => (k in settings ? settings[k] : d),
    titleFor: opts.titleFor,
    // worktrees go to a temp folder, never ~/.ovly-claude
    git: opts.wtRoot ? { ...require('../main/tree-git'), createWorktree: (c, l) => require('../main/tree-git').createWorktree(c, l, opts.wtRoot) } : undefined,
  });
  // simulate a claude process for a run the engine started
  let n = 0;
  async function finishRun(run, { text = 'ok', cost = 0, code = 0, report, ask, caller } = {}) {
    const startedAs = run.session.id;
    const sid = run.session.draft ? 'claude_real_' + (++n) : startedAs;
    runHooks.emit('start', startedAs, startedAs);
    if (sid !== startedAs) { aliases.set(startedAs, sid); runHooks.emit('rekey', startedAs, sid); }
    if (report) tree.call(caller || sid, 'report_to_parent', { result: report });
    if (ask) tree.call(caller || sid, 'ask_parent', { question: ask });
    runHooks.emit('end', { sessionId: sid, startedAsId: startedAs, text, cost, code, error: '', stopped: false });
    await wait(90);
    return sid;
  }
  // the user's own turn in the root chat (sent from the HUD, not by the engine)
  function userTurn(id) { runHooks.emit('start', id, id); return async (text = 'root reply') => { runHooks.emit('end', { sessionId: id, startedAsId: id, text, cost: 0, code: 0 }); await wait(90); }; }
  return { tree, runs, sent, stopped, finishRun, userTurn, dir };
}

test('a child starts with a brief task in the parent\'s folder', () => {
  const { tree, runs, dir } = setup();
  const r = tree.call('claude_root', 'child_start', { title: 'Write tests', task: 'Write tests for guard.ts', model: 'haiku', readOnly: true });
  assert.ok(r.ok, r.text);
  assert.strictEqual(r.short, 'c1');
  assert.strictEqual(runs.length, 1);
  const run = runs[0];
  assert.match(run.text, /task from parent chat/);
  assert.match(run.text, /Write tests for guard\.ts/);
  assert.match(run.text, /report_to_parent/);
  assert.strictEqual(run.session.cwd, dir);
  assert.strictEqual(run.options.newSession, true);
  assert.strictEqual(run.options.model, 'haiku');
  assert.strictEqual(run.options.plan, true, 'read-only child runs in plan mode');
  assert.strictEqual(run.options.quiet, true);
});

test('a finished child\'s reply goes up and is delivered to the idle parent as one message', async () => {
  const { tree, runs, sent, finishRun } = setup();
  tree.call('claude_root', 'child_start', { title: 'A', task: 'do A' });
  tree.call('claude_root', 'child_start', { title: 'B', task: 'do B' });
  const [a, b] = runs;
  await finishRun(a, { text: 'A is done', cost: 0.1 });
  assert.strictEqual(runs.length, 3, 'parent got a turn');
  assert.strictEqual(runs[2].session.id, 'claude_root');
  assert.match(runs[2].text, /Result from c1 "A":\nA is done/);
  assert.match(runs[2].text, /Still working: c2/);
  assert.ok(sent.some(([ch, d]) => ch === 'tree:event' && d.kind === 'result'), 'a result light for the view');
  // B finishes while the parent is still busy → waits in the inbox, delivered after the parent's turn
  await finishRun(b, { text: 'B is done' });
  assert.strictEqual(runs.length, 3, 'not delivered while the parent runs');
  await finishRun(runs[2], { text: 'thanks' });
  assert.strictEqual(runs.length, 4);
  assert.match(runs[3].text, /Result from c2 "B":\nB is done/);
});

test('report_to_parent wins over the last reply; ask_parent sends a question and child_send answers it', async () => {
  const { tree, runs, finishRun } = setup();
  tree.call('claude_root', 'child_start', { title: 'Investigate', task: 'find the bug' });
  const sid = await finishRun(runs[0], { text: 'long chatter', ask: 'Mock or real session?' });
  assert.match(runs[1].text, /Question from c1 "Investigate" — answer it with child_send\(child: "c1"/);
  assert.match(runs[1].text, /Mock or real session\?/);
  assert.strictEqual(tree.treeFor('claude_root').nodes.find((n) => n.short === 'c1').state, 'asking');
  await finishRun(runs[1], { text: 'ok' });
  const r = tree.call('claude_root', 'child_send', { child: 'c1', task: 'Use a mock.' });
  assert.ok(r.ok, r.text);
  const answer = runs[runs.length - 1];
  assert.strictEqual(answer.session.id, sid, 'the answer resumes the same child chat');
  assert.match(answer.text, /from your parent chat/);
  assert.match(answer.text, /Use a mock\./);
  await finishRun(answer, { text: 'chatter', report: 'Cause: guard.ts:42' });
  assert.match(runs[runs.length - 1].text, /Result from c1 "Investigate":\nCause: guard\.ts:42/);
});

test('a chat with working children waits instead of reporting; a grandchild\'s result goes to its own parent', async () => {
  const { tree, runs, finishRun } = setup();
  tree.call('claude_root', 'child_start', { title: 'Tests', task: 't' });
  const childRun = runs[0];
  // the child starts its own child during its turn
  const startedAs = childRun.session.id;
  const r = tree.call(startedAs, 'child_start', { title: 'e2e', task: 'run e2e' });
  assert.ok(r.ok, r.text);
  const grand = runs[1];
  const childSid = await finishRun(childRun, { text: 'started a child', caller: startedAs });
  assert.strictEqual(runs.length, 2, 'nothing went to the root yet');
  assert.strictEqual(tree.treeFor('claude_root').nodes.find((n) => n.short === 'c1').state, 'waiting');
  await finishRun(grand, { text: 'e2e: 1 failing' });
  const toChild = runs[2];
  assert.strictEqual(toChild.session.id, childSid);
  assert.match(toChild.text, /Result from c2 "e2e":\ne2e: 1 failing/);
  await finishRun(toChild, { text: 'all summarised' });
  assert.match(runs[3].text, /Result from c1 "Tests":\nall summarised/);
});

test('limits: depth 3, 5 working children, 4 running at once (the rest queue)', async () => {
  const { tree, runs, finishRun } = setup({ budget: 100 });
  for (let i = 0; i < 5; i++) assert.ok(tree.call('claude_root', 'child_start', { title: 'k' + i, task: 'x' }).ok);
  assert.strictEqual(runs.length, 4, 'only 4 run at once');
  assert.strictEqual(tree.treeFor('claude_root').nodes.filter((n) => n.state === 'queued').length, 1);
  const six = tree.call('claude_root', 'child_start', { title: 'k5', task: 'x' });
  assert.ok(!six.ok && /5 working children/.test(six.text));
  await finishRun(runs[0], { text: 'one' });
  assert.ok(runs.slice(4).some((r) => r.session.id.startsWith('claude_tree_')), 'the queued one started');
  assert.strictEqual(tree.treeFor('claude_root').nodes.filter((n) => n.state === 'queued').length, 0);
  // depth
  const t2 = setup({ budget: 100 });
  let caller = 'claude_root';
  for (let d = 1; d <= 3; d++) { const r = t2.tree.call(caller, 'child_start', { title: 'd' + d, task: 'x' }); assert.ok(r.ok, r.text); caller = r.key; }
  const deep = t2.tree.call(caller, 'child_start', { title: 'd4', task: 'x' });
  assert.ok(!deep.ok && /Too deep/.test(deep.text));
});

test('budget: once spent, new tasks are refused but results still go up', async () => {
  const { tree, runs, finishRun, sent } = setup({ budget: 0.5 });
  tree.call('claude_root', 'child_start', { title: 'A', task: 'a' });
  tree.call('claude_root', 'child_start', { title: 'B', task: 'b' });
  await finishRun(runs[0], { text: 'A done', cost: 0.6 });
  assert.match(runs[2].text, /Result from c1/);
  const r = tree.call('claude_root', 'child_start', { title: 'C', task: 'c' });
  assert.ok(!r.ok && /budget/.test(r.text), r.text);
  assert.ok(sent.some(([ch]) => ch === 'tree:notice'));
  assert.ok(tree.treeFor('claude_root').spent >= 0.6);
});

test("the top chat's own turns do not count toward the tree budget", async () => {
  const { tree, runs, finishRun, userTurn } = setup({ budget: 2 });
  tree.call('claude_root', 'child_start', { title: 'A', task: 'a' });
  userTurn('claude_root');
  // your own (long, expensive) top chat
  await finishRun(runs[0], { text: 'A done', cost: 0.09 });
  await finishRun({ session: { id: 'claude_root' } }, { text: 'root', cost: 8.5 });
  const snap = tree.treeFor('claude_root');
  assert.ok(Math.abs(snap.spent - 0.09) < 1e-9, 'only the child counts: ' + snap.spent);
  assert.ok(tree.call('claude_root', 'child_start', { title: 'B', task: 'b' }).ok, 'new tasks still allowed');
});

test('opt-in: tools only in chats of a tree, or chats opened while Tree mode is on', () => {
  const { tree, runs } = setup();
  assert.strictEqual(tree.wantsTools('claude_root'), false, 'a normal chat has no tree tools');
  tree.enable('claude_root', true);
  assert.strictEqual(tree.wantsTools('claude_root'), true, 'Tree mode on for it');
  tree.enable(null, false);
  assert.strictEqual(tree.wantsTools('claude_root'), false, 'Tree mode off clears it');
  tree.call('claude_root', 'child_start', { title: 'A', task: 'a' }); // e.g. via ↳ Child
  assert.strictEqual(tree.wantsTools('claude_root'), true, 'a chat with children keeps them');
  assert.strictEqual(tree.wantsTools(runs[0].session.id), true, 'children always have them (report_to_parent)');
  tree.enable(null, false);
  assert.strictEqual(tree.wantsTools('claude_root'), true, 'still in a tree after Tree mode is off');
});

test('report / ask are only for children; unknown child names are explained', () => {
  const { tree } = setup();
  assert.ok(!tree.call('claude_root', 'report_to_parent', { result: 'x' }).ok);
  tree.call('claude_root', 'child_start', { title: 'A', task: 'a' });
  const r = tree.call('claude_root', 'child_send', { child: 'c9', task: 'x' });
  assert.ok(!r.ok && /Your children: c1/.test(r.text));
});

test('the user talking to the root chat: results wait for that turn too', async () => {
  const { tree, runs, finishRun, userTurn } = setup();
  tree.call('claude_root', 'child_start', { title: 'A', task: 'a' });
  const endUser = userTurn('claude_root');
  await finishRun(runs[0], { text: 'A done' });
  assert.strictEqual(runs.length, 1, 'root is busy with your message');
  await endUser();
  assert.strictEqual(runs.length, 2);
  assert.match(runs[1].text, /A done/);
});

test('stop: running chats are stopped, queued work dropped, nothing more is delivered', async () => {
  const { tree, runs, stopped, finishRun, userTurn } = setup();
  tree.call('claude_root', 'child_start', { title: 'A', task: 'a' });
  userTurn(runs[0].session.id); // A is running
  const snap = tree.treeFor('claude_root');
  const ipc = { handle: (ch, fn) => { ipc[ch] = fn; } };
  tree.register(ipc);
  await ipc['tree:stop'](null, snap.root);
  assert.deepStrictEqual(stopped, [runs[0].session.id]);
  await finishRun(runs[0], { text: 'late' });
  assert.strictEqual(runs.length, 1, 'no delivery after stop');
});

test('mcp/tree.js lists the tools and forwards a call to the engine', async () => {
  const { tree } = setup();
  const server = tree.listen();
  while (!tree.getPort()) await wait(10);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'mcp', 'tree.js')], {
    env: { ...process.env, HUD_TREE_URL: `http://127.0.0.1:${tree.getPort()}/tree`, HUD_PERM_TOKEN: 'tok', HUD_SESSION_ID: 'claude_root' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const out = [];
  let buf = '';
  child.stdout.on('data', (c) => { buf += c; const lines = buf.split('\n'); buf = lines.pop(); for (const l of lines) if (l.trim()) out.push(JSON.parse(l)); });
  const rpc = (id, method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  rpc(1, 'initialize', {}); rpc(2, 'tools/list', {}); rpc(3, 'tools/call', { name: 'child_start', arguments: { title: 'Docs', task: 'update README' } });
  rpc(4, 'tools/call', { name: 'report_to_parent', arguments: { result: 'x' } });
  for (let i = 0; i < 100 && out.length < 4; i++) await wait(30);
  child.kill(); server.close();
  const byId = Object.fromEntries(out.map((m) => [m.id, m]));
  assert.deepStrictEqual(byId[2].result.tools.map((t) => t.name), ['child_start', 'child_send', 'child_status', 'child_stop', 'child_merge', 'report_to_parent', 'ask_parent']);
  assert.match(byId[3].result.content[0].text, /Started child chat c1 "Docs"/);
  assert.ok(!byId[3].result.isError);
  assert.ok(byId[4].result.isError, 'the root is not a child');
  assert.strictEqual(tree.treeFor('claude_root').nodes.length, 2);
});

test('the endpoint refuses calls without the token', async () => {
  const { tree } = setup();
  const server = tree.listen();
  while (!tree.getPort()) await wait(10);
  const status = await new Promise((resolve) => {
    const req = require('http').request(`http://127.0.0.1:${tree.getPort()}/tree`, { method: 'POST' }, (res) => resolve(res.statusCode));
    req.end('{}');
  });
  server.close();
  assert.strictEqual(status, 403);
});

// ---------- worktrees, merge, remove, replay log, names ----------
const { execFileSync } = require('child_process');
const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
function repo() {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'ovly-tree-repo-'));
  g(r, 'init', '-q', '-b', 'main');
  g(r, 'config', 'user.email', 't@t'); g(r, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(r, 'a.txt'), 'one\n');
  g(r, 'add', '-A'); g(r, 'commit', '-q', '-m', 'first');
  return { r, wt: fs.mkdtempSync(path.join(os.tmpdir(), 'ovly-tree-wt-')) };
}
const until = async (fn, ms = 8000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out'); await wait(30); } };

test('a writing child works in its own worktree; its work comes back as a branch and merges into the parent folder', async () => {
  const { r, wt } = repo();
  const { tree, runs, finishRun, sent } = setup({ cwd: r, wtRoot: wt });
  const start = tree.call('claude_root', 'child_start', { title: 'Add b', task: 'create b.txt' });
  assert.ok(start.ok && /own git worktree/.test(start.text), start.text);
  await until(() => runs.length === 1);
  const run = runs[0];
  assert.ok(run.session.cwd.startsWith(wt), 'the child runs in its worktree: ' + run.session.cwd);
  assert.match(run.text, /your own git worktree on branch ovly-tree\/c1-/);
  // the child edits its folder (and does not commit) — the main folder is untouched
  fs.writeFileSync(path.join(run.session.cwd, 'b.txt'), 'bee\n');
  assert.ok(!fs.existsSync(path.join(r, 'b.txt')));
  await finishRun(run, { text: 'Added b.txt' });
  await until(() => runs.length === 2);
  assert.match(runs[1].text, /Its work is on git branch ovly-tree\/c1-[\w-]+: 1 commit/);
  assert.match(runs[1].text, /Files: b\.txt/);
  assert.match(runs[1].text, /child_merge\(child: "c1"\)/);
  const node = tree.treeFor('claude_root').nodes.find((n) => n.short === 'c1');
  assert.ok(node.branch && node.work.commits === 1 && node.work.files === 1);
  // merge
  const m = await tree.call('claude_root', 'child_merge', { child: 'c1' });
  assert.ok(m.ok, m.text);
  assert.strictEqual(fs.readFileSync(path.join(r, 'b.txt'), 'utf8').replace(/\r\n/g, '\n'), 'bee\n'); // (git may check out CRLF on Windows)
  assert.ok(!fs.existsSync(run.session.cwd), 'worktree removed');
  assert.strictEqual(g(r, 'branch', '--list', 'ovly-tree/*'), '', 'branch removed after merging');
  assert.ok(sent.some(([ch, d]) => ch === 'tree:event' && d.kind === 'merge'));
  const again = tree.call('claude_root', 'child_send', { child: 'c1', task: 'more' });
  assert.ok(!again.ok && /finished/.test(again.text));
});

test('a merge conflict changes nothing in the parent folder and says which files', async () => {
  const { r, wt } = repo();
  const { tree, runs, finishRun } = setup({ cwd: r, wtRoot: wt });
  tree.call('claude_root', 'child_start', { title: 'Edit a', task: 'change a.txt' });
  await until(() => runs.length === 1);
  fs.writeFileSync(path.join(runs[0].session.cwd, 'a.txt'), 'child\n');
  await finishRun(runs[0], { text: 'changed a' });
  await until(() => runs.length === 2);
  // meanwhile the main folder changed the same line
  fs.writeFileSync(path.join(r, 'a.txt'), 'main\n'); g(r, 'commit', '-q', '-am', 'main edit');
  const m = await tree.call('claude_root', 'child_merge', { child: 'c1' });
  assert.ok(!m.ok && /conflicts in a\.txt/.test(m.text), m.text);
  assert.strictEqual(fs.readFileSync(path.join(r, 'a.txt'), 'utf8').replace(/\r\n/g, '\n'), 'main\n');
  assert.ok(!fs.existsSync(path.join(r, '.git', 'MERGE_HEAD')), 'the merge was undone');
  assert.strictEqual(g(r, 'status', '--porcelain'), '');
});

test('read-only children and folders outside git share the folder (no worktree)', async () => {
  const { r, wt } = repo();
  const { tree, runs } = setup({ cwd: r, wtRoot: wt });
  tree.call('claude_root', 'child_start', { title: 'Look', task: 'read', readOnly: true });
  assert.strictEqual(runs.length, 1, 'starts at once');
  assert.strictEqual(runs[0].session.cwd, r);
  const plain = setup();
  plain.tree.call('claude_root', 'child_start', { title: 'x', task: 'y' });
  assert.strictEqual(plain.runs.length, 1);
});

test('remove: the child and its children leave the tree; a branch with work is kept', async () => {
  const { r, wt } = repo();
  const { tree, runs, finishRun, stopped } = setup({ cwd: r, wtRoot: wt });
  const a = tree.call('claude_root', 'child_start', { title: 'A', task: 'a' });
  await until(() => runs.length === 1);
  const childStart = runs[0].session.id;
  tree.call(childStart, 'child_start', { title: 'A1', task: 'a1', readOnly: true });
  fs.writeFileSync(path.join(runs[0].session.cwd, 'c.txt'), 'c\n');
  await finishRun(runs[0], { text: 'started A1', caller: childStart });
  const ipc = { handle: (ch, fn) => { ipc[ch] = fn; } };
  tree.register(ipc);
  const res = await ipc['tree:remove'](null, a.key);
  assert.ok(res.ok, res.text);
  assert.match(res.text, /Removed c1, c2/);
  assert.strictEqual(res.keptBranches.length, 1, 'the branch with c.txt is kept');
  assert.match(g(r, 'branch', '--list', 'ovly-tree/*'), /ovly-tree\/c1-/);
  assert.ok(!fs.existsSync(runs[0].session.cwd), 'its worktree is gone');
  assert.strictEqual(tree.treeFor('claude_root').nodes.length, 1, 'only the top chat is left');
  assert.ok(stopped.length >= 1, 'the running grandchild was stopped');
  const top = await ipc['tree:remove'](null, 'claude_root');
  assert.ok(!top.ok, 'the top chat cannot be removed');
});

test('replay log and names: commands / results are logged; the top chat is named from its first message', async () => {
  const { tree, runs, finishRun } = setup({ titleFor: () => 'Fix the login redirect loop, with tests and docs' });
  tree.call('claude_root', 'child_start', { title: 'A', task: 'a' });
  await finishRun(runs[0], { text: 'done' });
  const ipc = { handle: (ch, fn) => { ipc[ch] = fn; } };
  tree.register(ipc);
  const lg = await ipc['tree:log'](null, 'claude_root');
  assert.deepStrictEqual(lg.log.map((e) => e.kind), ['node', 'command', 'result']);
  assert.ok(lg.log.every((e) => typeof e.at === 'number'));
  assert.strictEqual(lg.tree.nodes.find((n) => !n.parent).title, 'Fix the login redirect loop, with tests and docs');
  const links = tree.links();
  assert.deepStrictEqual(links.find((l) => l.root), { sid: 'claude_root', root: true, title: 'Fix the login redirect loop, with tests and docs', depth: 0 });
});
