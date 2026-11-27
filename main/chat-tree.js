// Chat Tree: a chat (the parent) can start child chats, send them tasks and get their results back.
// Children are real Claude chats run with `claude -p` (main.js runClaudeTurn), so you can open them, reply,
// approve their tools and stop them like any other chat. The tree view is ui/logic/chat/tree.js; the plan
// with the design is docs/design/chat-tree-plan.html.
//
//   Claude side: mcp/tree.js gives every HUD-run Claude chat these tools; they POST here (local, token):
//     child_start { title, task, model?, context?: 'brief'|'full', readOnly? }   child_send { child, task }
//     child_status {}   child_stop { child }   report_to_parent { result, … }   ask_parent { question }
//   Flow: a command starts / wakes a child. When a child's turn ends, what it reported (or asked, or its last
//   reply) goes into its parent's inbox; an idle parent gets the inbox at once as one message (automatic
//   delivery), a busy one when its turn ends. A node that still has working children waits instead of reporting.
//   Limits: depth 3, 5 children per chat, 4 chats of a tree running at once (others queue), budget per tree
//   (default $2, setting treeBudget) — over it, new tasks are refused; results still go up so the tree can finish.
//
// Node ids: `key` is fixed (the draft id a child started under, or the root chat's id); `sid` is the real
// session id once Claude has named it ('claude_<uuid>').
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const FILE = path.join(os.homedir(), '.ovly-claude', 'chat-trees.json');
const LIMITS = { depth: 3, children: 5, running: 4 };
const DEFAULT_BUDGET = 2;
const MAX_TEXT = 20000;
const MODELS = new Set(['haiku', 'sonnet', 'opus']);

const clip = (t, n = MAX_TEXT) => { t = String(t == null ? '' : t).trim(); return t.length > n ? t.slice(0, n) + '\n…(cut)' : t; };
const oneLine = (t, n = 60) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

function createChatTree(ctx) {
  // ctx: { runClaudeTurn, runHooks, aliases (Map draft→real), getWin, getWatcher, stopReply(id), getSetting, token, file? }
  const file = ctx.file || FILE;
  const tgit = ctx.git || require('./tree-git'); // worktrees for writing children
  let state = { seq: 0, nodes: {}, trees: {} };
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved && saved.nodes && saved.trees) state = saved;
  } catch (_) {}
  // after a restart nothing of ours is running any more
  for (const n of Object.values(state.nodes)) {
    if (['running', 'queued'].includes(n.state)) n.state = 'stopped';
    n.inbox = [];
    n.pending = null;
  }
  // the tree's spend = its child chats only (older files also counted the top chat)
  for (const t of Object.values(state.trees)) {
    t.spent = Object.values(state.nodes).filter((n) => n.root === t.root && n.parent).reduce((a, n) => a + (Number(n.spent) || 0), 0);
    if (t.spent < (typeof t.budget === 'number' ? t.budget : DEFAULT_BUDGET)) t.overBudget = false;
  }
  // Opt-in: Claude only gets the tree tools in chats that are part of a tree, or that you opened while
  // Tree mode was on (the view reports those; turning Tree mode off clears them). Other chats: no extra tools.
  const enabled = new Set();
  const running = new Set(); // session ids (draft and real) with a claude process right now
  const queues = new Map();  // root key -> [{ key, text }] waiting for a free run slot
  let port = 0;

  // ---------- store ----------
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(state)); } catch (e) { console.error('[tree] save failed:', e.message); }
    }, 300);
  }
  const nodes = () => Object.values(state.nodes);
  const real = (id) => (id && ctx.aliases.get(id)) || id;
  function nodeOf(id) {
    if (!id) return null;
    const r = real(id);
    return state.nodes[id] || nodes().find((n) => n.sid === id || n.sid === r || n.key === r) || null;
  }
  const kids = (n) => nodes().filter((c) => c.parent === n.key);
  const treeOf = (n) => state.trees[n.root];
  const isRunning = (n) => running.has(n.key) || (n.sid && running.has(n.sid));
  const busyKid = (c) => ['running', 'queued', 'waiting', 'asking'].includes(c.state) || isRunning(c);
  const budgetOf = (t) => (t && typeof t.budget === 'number' ? t.budget : Number(ctx.getSetting('treeBudget', DEFAULT_BUDGET)) || DEFAULT_BUDGET);
  const sessionOf = (id) => { try { return ctx.getWatcher()?.sessions?.get(real(id)) || null; } catch (_) { return null; } };

  // a name for the top chat: its own title, else its first message (free — no model call)
  function rootTitle(sid) {
    let t = '';
    try { t = ctx.titleFor ? ctx.titleFor(sid) : ''; } catch (_) {}
    const s = sessionOf(sid);
    return oneLine(t || s?.aiTitle || s?.project || 'Main chat', 50);
  }
  function ensureRoot(sessionId) {
    const existing = nodeOf(sessionId);
    if (existing) return existing;
    const s = sessionOf(sessionId);
    const key = real(sessionId);
    const n = state.nodes[key] = {
      key, sid: key, short: 'main', parent: null, root: key, depth: 0,
      title: rootTitle(key), model: '', readOnly: false,
      cwd: s?.cwd || '', state: 'idle', spent: 0, createdAt: Date.now(), inbox: [], pending: null,
    };
    state.trees[key] = { root: key, spent: 0, paused: false, stopped: false, createdAt: Date.now() };
    return n;
  }

  // ---------- telling the HUD ----------
  const send = (ch, data) => { const w = ctx.getWin(); if (w && !w.isDestroyed()) w.webContents.send(ch, data); };
  function snapshot(rootKey) {
    const t = state.trees[rootKey];
    if (!t) return null;
    return {
      root: rootKey, spent: t.spent, budget: budgetOf(t), paused: !!t.paused, stopped: !!t.stopped,
      nodes: nodes().filter((n) => n.root === rootKey).map((n) => ({
        key: n.key, sid: n.sid || '', short: n.short, parent: n.parent, depth: n.depth, title: n.title, model: n.model,
        readOnly: !!n.readOnly, state: isRunning(n) ? 'running' : n.state, spent: n.spent, inbox: n.inbox.length,
        createdAt: n.createdAt,
        branch: n.wt ? n.wt.branch : '', merged: !!n.merged,
        work: n.work ? { commits: n.work.commits, files: n.work.files.length, stat: n.work.stat } : null,
      })),
    };
  }
  const updTimers = new Map();
  function changed(rootKey) {
    save();
    if (updTimers.has(rootKey)) return;
    updTimers.set(rootKey, setTimeout(() => { updTimers.delete(rootKey); send('tree:update', snapshot(rootKey)); }, 80));
  }
  // one message on a wire: command (down), result / question / error (up). Drives the lights in the tree view.
  // Every message is also kept in the tree's log, which the view can replay later.
  const LOG_MAX = 400;
  function logEvent(rootKey, ev) {
    const t = state.trees[rootKey];
    if (!t) return;
    if (!Array.isArray(t.log)) t.log = [];
    t.log.push(ev);
    if (t.log.length > LOG_MAX) t.log.splice(0, t.log.length - LOG_MAX);
  }
  function wire(kind, from, to, text) {
    const ev = { root: from.root, kind, from: from.key, to: to.key, text: oneLine(text, 400), at: Date.now() };
    logEvent(from.root, { at: ev.at, kind, from: ev.from, to: ev.to, text: ev.text });
    send('tree:event', ev);
  }

  // ---------- running turns ----------
  // children only: the top chat is yours and never waits for a slot
  function runCount(rootKey) { return nodes().filter((n) => n.root === rootKey && n.parent && isRunning(n)).length; }
  function startRun(n, text) {
    const t = treeOf(n);
    if (!t || t.stopped) return;
    if (runCount(n.root) >= LIMITS.running) {
      if (!queues.has(n.root)) queues.set(n.root, []);
      queues.get(n.root).push({ key: n.key, text });
      n.state = 'queued';
      changed(n.root);
      return;
    }
    const first = !n.started;
    n.started = true;
    n.state = 'running';
    const session = { id: n.sid || n.key, sessionUuid: n.sid ? n.sid.replace(/^claude_/, '') : '', cwd: n.cwd, source: 'claude' };
    const options = { quiet: true, plan: !!n.readOnly };
    if (n.model) options.model = n.model;
    if (first && n.parent) {
      if (n.forkFrom) options.forkFrom = n.forkFrom; else options.newSession = true;
      session.draft = true;
    }
    running.add(session.id); // counted before the process reports in, so the limit holds
    ctx.runClaudeTurn({ text, session, options });
    changed(n.root);
  }
  function startQueued(rootKey) {
    const q = queues.get(rootKey);
    while (q && q.length && runCount(rootKey) < LIMITS.running) {
      const job = q.shift();
      const n = state.nodes[job.key];
      if (n) { n.state = 'idle'; startRun(n, job.text); }
    }
  }

  // Everything waiting in a node's inbox goes in as ONE message, when the node is free.
  function flush(n) {
    const t = treeOf(n);
    if (!t || t.paused || t.stopped || !n.inbox.length || isRunning(n) || n.state === 'queued') return;
    const items = n.inbox.splice(0);
    const parts = [];
    const cmds = items.filter((i) => i.kind === 'command');
    const ups = items.filter((i) => i.kind !== 'command');
    if (cmds.length) {
      const p = state.nodes[n.parent];
      parts.push(`[Chat Tree · from your parent chat "${p ? p.title : 'parent'}"]\n` + cmds.map((c) => c.text).join('\n\n'));
    }
    if (ups.length) {
      parts.push('[Chat Tree · messages from your child chats]\n\n' + ups.map((u) => {
        const c = state.nodes[u.from];
        const who = c ? `${c.short} "${c.title}"` : 'a child';
        if (u.kind === 'question') return `▲ Question from ${who} — answer it with child_send(child: "${c?.short}", task: <your answer>):\n${u.text}`;
        if (u.kind === 'error') return `✕ ${who} stopped with an error:\n${u.text}`;
        return `▲ Result from ${who}:\n${u.text}`;
      }).join('\n\n'));
      const still = kids(n).filter(busyKid);
      if (still.length) parts.push(`(Still working: ${still.map((c) => c.short).join(', ')} — their results will come as another message.)`);
    }
    startRun(n, parts.join('\n\n'));
  }

  function deliverUp(n, kind, text) {
    const p = state.nodes[n.parent];
    if (!p) return;
    p.inbox.push({ kind, from: n.key, text: clip(text || '(no text)') });
    wire(kind, n, p, text);
    flush(p);
  }

  ctx.runHooks.on('start', (id) => {
    running.add(id);
    const n = nodeOf(id);
    if (n) { if (n.state !== 'running') { n.state = 'running'; } changed(n.root); }
  });
  ctx.runHooks.on('rekey', (oldId, newId) => {
    if (running.has(oldId)) running.add(newId);
    const n = nodeOf(oldId);
    if (n) { n.sid = newId; changed(n.root); }
  });
  ctx.runHooks.on('end', (r) => {
    running.delete(r.sessionId); running.delete(r.startedAsId);
    const n = nodeOf(r.sessionId) || nodeOf(r.startedAsId);
    if (!n) return;
    if (r.sessionId && r.sessionId !== n.key) n.sid = r.sessionId;
    // let main.js finish its own "turn ended" messages before this chat (or its parent) starts again
    setTimeout(() => afterTurn(n, r).catch((e) => console.error('[tree] after turn:', e.message)), 60);
  });

  // A writing child's changes: commit what it left, then tell the parent where the work is.
  async function withWork(n, text) {
    if (!n.wt || n.merged) return text;
    try {
      await tgit.commitAll(n.wt.dir, `Chat Tree ${n.short}: ${n.title}`);
      n.work = await tgit.summary(n.wt.dir, n.wt.base, n.wt.branch);
    } catch (e) { return text + `\n\n(Could not read its git branch: ${e.message})`; }
    if (!n.work.commits) return text + '\n\n(No file changes on its branch.)';
    const files = n.work.files.slice(0, 12).join(', ') + (n.work.files.length > 12 ? ', …' : '');
    return text + `\n\nIts work is on git branch ${n.wt.branch}: ${n.work.commits} commit${n.work.commits > 1 ? 's' : ''}, ${n.work.stat || n.work.files.length + ' files'}.\n` +
      `Files: ${files}\nIt is NOT in your folder yet. Check it, then merge it with child_merge(child: "${n.short}").`;
  }

  async function afterTurn(n, r) {
    const t = treeOf(n);
    if (!t) return;
    const cost = Number(r.cost) || 0;
    n.spent += cost;
    if (n.parent) t.spent += cost; // the budget is for the child chats; your own top chat never counts
    if (t.stopped || r.stopped) { n.state = 'stopped'; n.pending = null; changed(n.root); return; }
    const pend = n.pending;
    n.pending = null;
    const failed = r.code !== 0 && !String(r.text || '').trim();
    if (pend && pend.kind === 'question') {
      n.state = 'asking';
      deliverUp(n, 'question', pend.text);
    } else if (pend && pend.kind === 'result') {
      n.state = 'done';
      deliverUp(n, 'result', await withWork(n, pend.text));
    } else if (kids(n).some(busyKid)) {
      n.state = 'waiting'; // its children will report; it reports when it has their results
    } else if (n.parent) {
      n.state = failed ? 'error' : 'done';
      deliverUp(n, failed ? 'error' : 'result', await withWork(n, failed ? (r.error || 'The chat ended with an error.') : r.text));
    } else {
      n.state = failed ? 'error' : 'idle';
    }
    if (t.spent >= budgetOf(t) && !t.overBudget) {
      t.overBudget = true;
      send('tree:notice', { root: n.root, text: `Chat Tree budget reached ($${t.spent.toFixed(2)} of $${budgetOf(t).toFixed(2)}): new tasks are refused.` });
    }
    flush(n);
    startQueued(n.root);
    changed(n.root);
  }

  // ---------- actions (tools and HUD buttons) ----------
  const fail = (text) => ({ ok: false, text });
  function canCommand(t) {
    if (!t) return 'There is no Chat Tree here.';
    if (t.stopped) return 'This Chat Tree was stopped by the user.';
    if (t.paused) return 'This Chat Tree is paused by the user; try again later or ask the user.';
    if (t.spent >= budgetOf(t)) return `The Chat Tree budget is used up ($${t.spent.toFixed(2)} of $${budgetOf(t).toFixed(2)}). Finish with what you have, or ask the user to raise it in Settings.`;
    return '';
  }

  function childStart(callerId, a = {}, byUser = false) {
    const p = byUser ? ensureRoot(callerId) : (nodeOf(callerId) || ensureRoot(callerId));
    const t = treeOf(p);
    const why = canCommand(t);
    if (why) return fail(why);
    const task = clip(a.task, 8000);
    if (!task) return fail('child_start needs a task.');
    if (p.depth + 1 > LIMITS.depth) return fail(`Too deep: a Chat Tree goes at most ${LIMITS.depth} levels down. Do this part yourself.`);
    if (kids(p).filter((c) => !['done', 'stopped', 'error'].includes(c.state)).length >= LIMITS.children) {
      return fail(`You already have ${LIMITS.children} working children. Wait for results first.`);
    }
    const model = MODELS.has(String(a.model || '').toLowerCase()) ? String(a.model).toLowerCase() : '';
    const full = a.context === 'full';
    const pSession = sessionOf(p.sid || p.key);
    const cwd = p.cwd || pSession?.cwd || '';
    if (!p.cwd && cwd) p.cwd = cwd;
    const key = 'claude_tree_' + crypto.randomBytes(5).toString('hex');
    const short = 'c' + (++state.seq);
    const n = state.nodes[key] = {
      key, sid: '', short, parent: p.key, root: p.root, depth: p.depth + 1,
      title: oneLine(a.title || task, 50), model, readOnly: !!a.readOnly, cwd,
      forkFrom: full && p.sid ? p.sid.replace(/^claude_/, '') : '',
      state: 'idle', spent: 0, createdAt: Date.now(), inbox: [], pending: null, byUser: !!byUser,
    };
    const brief = `[Chat Tree · task from ${byUser ? 'the user' : `parent chat "${p.title}"`}]\n${task}\n\n` +
      `You are child chat ${short} in a Chat Tree (the HUD's way of splitting work across chats). Work on this task only.\n` +
      `- When you are done, call report_to_parent with a short result: the answer, files you changed, open questions. Then end your turn.\n` +
      `- If you cannot go on without a decision, call ask_parent with one clear question, then end your turn. The answer arrives as a new message.\n` +
      (n.depth < LIMITS.depth ? `- You may split big work further with child_start.\n` : '') +
      (n.readOnly ? `- You are read-only: look and report; do not edit files.\n` : '');
    logEvent(p.root, { at: Date.now(), kind: 'node', key });
    wire('command', p, n, task);
    // a child that edits files gets its own git worktree + branch (setting treeWorktrees, or isolate: false to skip)
    const isolate = !n.readOnly && a.isolate !== false && ctx.getSetting('treeWorktrees', true) !== false && !!cwd && tgit.inRepo(cwd);
    if (isolate) {
      n.state = 'preparing';
      tgit.createWorktree(cwd, `${short}-${key.slice(-6)}`).then((wt) => {
        if (!state.nodes[key]) return; // removed meanwhile
        let note;
        if (wt.ok) {
          n.wt = { dir: wt.dir, branch: wt.branch, base: wt.base, top: wt.top };
          n.cwd = wt.cwd;
          note = `- Your folder is your own git worktree on branch ${wt.branch}, made from the last commit (uncommitted changes in the main folder are not here). Other chats can't touch it. Your changes are committed for you when you finish; your parent merges them.\n`;
        } else {
          note = `- (No separate worktree: ${wt.why}. You share the folder with other chats — keep your edits to the files of your task.)\n`;
        }
        n.state = 'idle';
        startRun(n, brief + note);
      }).catch((e) => { n.state = 'idle'; startRun(n, brief); console.error('[tree] worktree:', e.message); });
    } else {
      startRun(n, brief);
    }
    changed(p.root);
    return { ok: true, key, short, text: `Started child chat ${short} "${n.title}"${model ? ` (${model})` : ''}${isolate ? ' in its own git worktree (its changes come back on a branch for you to merge)' : ''}. It works on its own; its result comes back to you automatically as a new message. If you have nothing else to do, end your turn now.` };
  }

  function findChild(p, ref) {
    const r = String(ref || '').trim();
    return kids(p).find((c) => c.short === r || c.key === r || c.sid === r) || null;
  }

  function childSend(callerId, a = {}) {
    const p = nodeOf(callerId);
    if (!p) return fail('You have no child chats yet. Use child_start.');
    const c = findChild(p, a.child);
    if (!c) return fail(`No child "${a.child}". Your children: ${kids(p).map((k) => k.short).join(', ') || 'none'}.`);
    const why = canCommand(treeOf(p));
    if (why) return fail(why);
    if (c.merged) return fail(`${c.short} is finished: its work was merged and its worktree removed. Start a new child for more work.`);
    const task = clip(a.task, 8000);
    if (!task) return fail('child_send needs a task.');
    c.inbox.push({ kind: 'command', from: p.key, text: task });
    if (c.state === 'done' || c.state === 'asking' || c.state === 'error') c.state = 'idle';
    wire('command', p, c, task);
    flush(c);
    changed(p.root);
    return { ok: true, text: isRunning(c) ? `${c.short} is busy; it gets your message when its current turn ends.` : `Sent to ${c.short}. Its answer comes back automatically.` };
  }

  function childStatus(callerId) {
    const p = nodeOf(callerId);
    if (!p || !kids(p).length) return { ok: true, text: 'You have no child chats.' };
    const t = treeOf(p);
    const lines = kids(p).map((c) => {
      const s = sessionOf(c.sid);
      const step = isRunning(c) && s?.statusLabel ? ` — ${s.statusLabel}` : '';
      return `${c.short} "${c.title}": ${isRunning(c) ? 'running' : c.state}${step} · $${c.spent.toFixed(2)}`;
    });
    return { ok: true, text: lines.join('\n') + `\nTree budget: $${t.spent.toFixed(2)} of $${budgetOf(t).toFixed(2)}.` };
  }

  function stopNode(n) {
    for (const c of kids(n)) stopNode(c);
    n.inbox = [];
    n.pending = null;
    const q = queues.get(n.root);
    if (q) queues.set(n.root, q.filter((j) => j.key !== n.key));
    if (isRunning(n)) ctx.stopReply(n.sid || n.key);
    if (n.parent) n.state = 'stopped';
  }
  function childStop(callerId, a = {}) {
    const p = nodeOf(callerId);
    const c = p && findChild(p, a.child);
    if (!c) return fail(`No child "${a && a.child}".`);
    stopNode(c);
    changed(p.root);
    return { ok: true, text: `Stopped ${c.short} (and its children).` };
  }

  function report(callerId, a = {}, kind) {
    const n = nodeOf(callerId);
    if (!n || !n.parent) return fail('You are not a child chat in a Chat Tree, so there is no parent to send this to.');
    if (kind === 'question') {
      const q = clip(a.question, 4000);
      if (!q) return fail('ask_parent needs a question.');
      n.pending = { kind: 'question', text: q };
      return { ok: true, text: 'Your question goes to your parent when this turn ends. End your turn now; the answer will arrive as a new message.' };
    }
    let text = clip(a.result, 12000);
    if (!text) return fail('report_to_parent needs a result.');
    if (Array.isArray(a.files) && a.files.length) text += `\nFiles changed: ${a.files.slice(0, 40).join(', ')}`;
    if (a.openQuestions) text += `\nOpen questions: ${clip(a.openQuestions, 2000)}`;
    n.pending = { kind: 'result', text };
    return { ok: true, text: 'Result saved; it goes to your parent when this turn ends. End your turn now.' };
  }

  // Merge a child's branch into its parent's folder (the parent via child_merge, or you via ⤵ Merge).
  async function childMerge(callerId, a = {}, byUser = false) {
    let c, p;
    if (byUser) { c = nodeOf(a.key); p = c && state.nodes[c.parent]; }
    else { p = nodeOf(callerId); c = p && findChild(p, a.child); }
    if (!c || !p) return fail(`No child "${a.child || a.key}".`);
    if (!c.wt) return fail(`${c.short} worked in the shared folder: its changes are already there, nothing to merge.`);
    if (c.merged) return fail(`${c.short} is already merged.`);
    if (isRunning(c) || busyKid(c) || c.state === 'preparing') return fail(`${c.short} is still working. Merge when it has reported.`);
    if (!c.work) { await tgit.commitAll(c.wt.dir, `Chat Tree ${c.short}: ${c.title}`); c.work = await tgit.summary(c.wt.dir, c.wt.base, c.wt.branch); }
    if (!c.work.commits) return fail(`${c.short} made no changes, so there is nothing to merge.`);
    const target = p.cwd || sessionOf(p.sid || p.key)?.cwd || '';
    if (!target) return fail('The parent chat has no folder to merge into.');
    const m = await tgit.merge(target, c.wt.branch, `Merge Chat Tree ${c.short}: ${c.title}`);
    if (!m.ok) { changed(c.root); return fail(`Could not merge ${c.short}: ${m.why}. Its work stays on branch ${c.wt.branch}.`); }
    await tgit.removeWorktree(c.wt.top, c.wt.dir, c.wt.branch, true);
    c.merged = true;
    wire('merge', c, p, `merged ${c.work.files.length} file(s)`);
    changed(c.root);
    return { ok: true, text: `Merged ${c.short} "${c.title}" into ${target}: ${c.work.commits} commit(s), ${c.work.stat || c.work.files.length + ' files'}. Its worktree and branch were removed.` };
  }

  // Remove a child (and its children) from the tree: stop them, drop what they had not delivered,
  // remove their worktrees. Branches with unmerged work are kept. Their chats stay on disk.
  async function removeNode(key) {
    const n = state.nodes[key] || nodeOf(key);
    if (!n || !n.parent) return fail('Only child chats can be removed (not the top chat).');
    const all = [];
    const walk = (x) => { all.push(x); for (const c of kids(x)) walk(c); };
    walk(n);
    stopNode(n);
    const gone = new Set(all.map((x) => x.key));
    const kept = [];
    for (const x of all) {
      if (x.wt && !x.merged) {
        const keepBranch = !!(x.work ? x.work.commits : true);
        try { await tgit.removeWorktree(x.wt.top, x.wt.dir, x.wt.branch, !keepBranch); } catch (_) {}
        if (keepBranch) kept.push(x.wt.branch);
      }
    }
    for (const x of nodes()) if (x.inbox.length) x.inbox = x.inbox.filter((i) => !gone.has(i.from));
    const q = queues.get(n.root);
    if (q) queues.set(n.root, q.filter((j) => !gone.has(j.key)));
    for (const x of all) delete state.nodes[x.key];
    logEvent(n.root, { at: Date.now(), kind: 'removed', key: n.key });
    changed(n.root);
    return { ok: true, sids: all.map((x) => x.sid).filter(Boolean), keptBranches: kept,
      text: `Removed ${all.map((x) => x.short).join(', ')}.` + (kept.length ? ` Kept git branch${kept.length > 1 ? 'es' : ''} with their work: ${kept.join(', ')}.` : '') };
  }

  function call(sessionId, tool, args) {
    switch (tool) {
      case 'child_start': return childStart(sessionId, args);
      case 'child_send': return childSend(sessionId, args);
      case 'child_status': return childStatus(sessionId);
      case 'child_stop': return childStop(sessionId, args);
      case 'child_merge': return childMerge(sessionId, args);
      case 'report_to_parent': return report(sessionId, args, 'result');
      case 'ask_parent': return report(sessionId, args, 'question');
      default: return fail('Unknown Chat Tree tool: ' + tool);
    }
  }

  // ---------- HUD side ----------
  function wantsTools(sessionId) {
    if (!sessionId) return false;
    return !!nodeOf(sessionId) || enabled.has(real(sessionId)) || enabled.has(sessionId);
  }
  function enable(sessionId, on) {
    if (!sessionId) { if (!on) enabled.clear(); return true; }
    if (on) enabled.add(real(sessionId)); else enabled.delete(real(sessionId));
    return true;
  }
  function treeFor(sessionId) { const n = nodeOf(sessionId); return n ? snapshot(n.root) : null; }
  // every child chat with its parent's session id — the chat list nests children under their parent
  function links() {
    const roots = nodes().filter((n) => !n.parent && kids(n).length).map((n) => ({ sid: n.sid || n.key, root: true, title: n.title, depth: 0 }));
    return roots.concat(nodes().filter((n) => n.parent && n.sid).map((n) => {
      const p = state.nodes[n.parent];
      return { sid: n.sid, parentSid: (p && (p.sid || p.key)) || '', short: n.short, title: n.title, depth: n.depth, createdAt: n.createdAt };
    }));
  }
  function setPaused(rootKey, paused) {
    const t = state.trees[rootKey];
    if (!t) return false;
    t.paused = !!paused;
    if (!t.paused) { for (const n of nodes().filter((x) => x.root === rootKey)) flush(n); startQueued(rootKey); }
    changed(rootKey);
    return true;
  }
  function stopTree(rootKey) {
    const t = state.trees[rootKey];
    if (!t) return false;
    t.stopped = true;
    queues.delete(rootKey);
    const root = state.nodes[rootKey];
    if (root) for (const c of kids(root)) stopNode(c);
    changed(rootKey);
    return true;
  }
  // a stopped tree can be used again: new children start a fresh run of it
  function reopen(rootKey) { const t = state.trees[rootKey]; if (t && t.stopped) { t.stopped = false; t.overBudget = false; } }
  function setBudget(rootKey, dollars) {
    const t = state.trees[rootKey];
    const v = Number(dollars);
    if (!t || !(v > 0)) return false;
    t.budget = v;
    if (t.spent < v) t.overBudget = false;
    changed(rootKey);
    return true;
  }
  function forget(rootKey) {
    const t = state.trees[rootKey];
    if (!t) return false;
    stopTree(rootKey);
    for (const n of nodes()) if (n.root === rootKey) delete state.nodes[n.key];
    delete state.trees[rootKey];
    save();
    send('tree:update', { root: rootKey, removed: true });
    return true;
  }

  // ---------- local endpoint for mcp/tree.js ----------
  function listen() {
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/tree' || req.headers['x-hud-token'] !== ctx.token) { res.writeHead(403); return res.end(); }
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 2e6) req.destroy(); });
      req.on('end', () => {
        Promise.resolve().then(() => {
          const p = JSON.parse(body);
          return call(String(p.sessionId || ''), String(p.tool || ''), p.args && typeof p.args === 'object' ? p.args : {});
        }).catch((e) => fail('Bad request: ' + e.message)).then((out) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(out));
        });
      });
    });
    server.listen(0, '127.0.0.1', () => { port = server.address().port; });
    return server;
  }

  function register(ipcMain) {
    ipcMain.handle('tree:get', (_e, id) => treeFor(id));
    ipcMain.handle('tree:enable', (_e, id, on) => enable(id, on));
    ipcMain.handle('tree:links', () => links());
    ipcMain.handle('tree:remove', (_e, key) => removeNode(key));
    ipcMain.handle('tree:merge', (_e, key) => childMerge('', { key }, true));
    ipcMain.handle('tree:log', (_e, root) => { const t = state.trees[root]; return t ? { log: t.log || [], tree: snapshot(root) } : null; });
    ipcMain.handle('tree:start-child', (_e, a = {}) => {
      const n = nodeOf(a.parentId);
      if (n) reopen(n.root);
      return childStart(a.parentId, a, true);
    });
    ipcMain.handle('tree:pause', (_e, root, on) => setPaused(root, on));
    ipcMain.handle('tree:stop', (_e, root) => stopTree(root));
    ipcMain.handle('tree:budget', (_e, root, v) => setBudget(root, v));
    ipcMain.handle('tree:forget', (_e, root) => forget(root));
  }

  return {
    listen, register, call, treeFor, links, removeNode, childMerge, wantsTools, enable, getPort: () => port,
    // for tests
    _state: () => state, _running: running,
  };
}

module.exports = { createChatTree, LIMITS, DEFAULT_BUDGET };
