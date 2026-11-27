// Chat Tree mode: "Tree" in the chat toolbar (remembered) shows the open chat's tree as a full canvas.
// Every node is a real chat (main/chat-tree.js runs them).
//   - click a node → its chat box opens beside the canvas (💬 on the node); ✕ Back to tree closes it again
//     (you can talk to any level)
//   - commands run down the wires as blue lights, results up as green ones, questions as amber ones
//   - ⇡ Follow up: when the chat you are in sends a result / question to its parent, the chat below
//     switches to the parent as it arrives (not while you are typing: then a bar offers to go). ↩ Back returns.
//   - ↳ Child starts a child chat from the open chat with your own task; ⏸ / ■ pause or stop the whole tree;
//     the $ figure is the tree's spend / budget (click to change the budget).
// The design and a scripted demo: docs/design/chat-tree-plan.html. Look: styles/chat-tree.css.
(function () {
  const api = window.electronAPI;
  const stream = document.getElementById('chatStream');
  const btn = document.getElementById('tbTree');
  if (!api?.treeGet || !stream || !btn) return;

  const NW = 168, NH = 54, HG = 14, VG = 34, PAD = 12, TRAVEL = 0.9; // node size, gaps, light travel (s)
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let on = !!api.settings?.treeView;
  let follow = api.settings?.treeFollow !== false;
  let tree = null;      // snapshot from main: { root, spent, budget, paused, stopped, nodes: [...] }
  let lastId = '';
  let pos = new Map();  // node key -> { x, y } (centre)
  let packets = [];     // { from, to, kind, t0 }
  let raf = 0;
  let backTo = null;

  // ---------- DOM ----------
  const panel = el('div', 'tree-panel');
  panel.id = 'treePanel';
  const head = el('div', 'tp-head');
  const title = el('span', 'tp-title', '🌳 Chat Tree');
  const budget = el('button', 'tp-budget');
  budget.title = 'Spent / budget for this tree — click to change the budget';
  const sp = el('span', 'tp-sp');
  const bNew = el('button', 'tp-btn', '↳ Child');
  bNew.title = 'Start a child chat from this chat with your own task';
  const bFollow = el('button', 'tp-btn tp-follow');
  bFollow.title = 'When the chat you are in sends a result or question to its parent, switch to the parent';
  const bPause = el('button', 'tp-btn', '⏸');
  const bStop = el('button', 'tp-btn tp-stop', '■');
  bStop.title = 'Stop every running chat in this tree';
  const bReplay = el('button', 'tp-btn', '⟲');
  bReplay.title = 'Replay this tree: watch its tasks and results go back and forth again';
  head.append(title, budget, sp, bNew, bFollow, bReplay, bPause, bStop);

  const form = el('div', 'tp-form');
  form.hidden = true;
  const fTitle = el('input', 'tp-in');
  fTitle.placeholder = 'Name, e.g. “Check the server logs”';
  const fTask = el('textarea', 'tp-in tp-task');
  fTask.placeholder = 'Task for the child chat (it only sees this — say what to do and what to report)';
  const fRow = el('div', 'tp-frow');
  const fModel = el('select', 'tp-in tp-model');
  for (const [v, t] of [['', 'Default model'], ['haiku', 'Haiku'], ['sonnet', 'Sonnet'], ['opus', 'Opus']]) { const o = el('option', '', t); o.value = v; fModel.appendChild(o); }
  const fRO = el('label', 'tp-ro');
  const fROc = el('input'); fROc.type = 'checkbox';
  fRO.append(fROc, document.createTextNode(' read-only'));
  const fGo = el('button', 'tp-btn tp-primary', 'Start child');
  const fCancel = el('button', 'tp-btn', 'Cancel');
  fRow.append(fModel, fRO, el('span', 'tp-sp'), fCancel, fGo);
  form.append(fTitle, fTask, fRow);

  const wrap = el('div', 'tp-wrap');
  const stage = el('div', 'tp-stage');
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'tp-svg');
  stage.appendChild(svg);
  wrap.appendChild(stage);
  const hint = el('div', 'tp-hint');
  const toast = el('div', 'tp-toast');
  const toastText = el('span');
  const toastBtn = el('button', 'tp-btn');
  toast.append(toastText, toastBtn);
  panel.append(head, form, wrap, hint, toast);
  // the canvas sits beside the chat column: full width until you open a node's chat
  const convoMain = stream.closest('.convo-main') || stream.parentElement;
  convoMain.before(panel);
  const chatBar = el('div', 'tp-chatbar');
  const chatName = el('span', 'tp-chatname');
  const bClose = el('button', 'tp-btn', '✕ Back to tree');
  bClose.title = 'Close this chat and show the whole tree';
  chatBar.append(el('span', '', '💬'), chatName, el('span', 'tp-sp'), bClose);
  convoMain.prepend(chatBar);
  let chatOpen = false;
  function setChatOpen(v) {
    chatOpen = !!v;
    document.body.classList.toggle('tree-chat-open', on && chatOpen);
    if (on) requestAnimationFrame(draw);
  }
  bClose.addEventListener('click', () => setChatOpen(false));
  // side by side needs room for both; below that the chat box replaces the canvas
  const body = panel.parentElement;
  const fitNarrow = () => document.body.classList.toggle('tree-narrow', (body.clientWidth || 9999) < 720);
  new ResizeObserver(() => { fitNarrow(); if (on) draw(); }).observe(body);
  new ResizeObserver(() => { if (on) draw(); }).observe(wrap);
  fitNarrow();

  // ---------- helpers ----------
  const cur = () => (typeof currentActiveSession !== 'undefined' ? currentActiveSession : null);
  const sessions = () => (typeof sessionsList !== 'undefined' ? sessionsList : []);
  const nodeBy = (k) => tree?.nodes.find((n) => n.key === k || (n.sid && n.sid === k)) || null;
  const isMe = (n, s) => !!(n && s && (n.sid === s.id || n.key === s.id));
  const sessionOf = (n) => (n && n.sid ? sessions().find((s) => s.id === n.sid) : null) || null;
  const name = (n) => (n ? n.title || (n.parent ? n.short : 'Main chat') : '?');
  const money = (v) => '$' + (Number(v) || 0).toFixed(2);
  const typing = () => !!document.getElementById('replyTextarea')?.value.trim();

  const STATE_TEXT = {
    waiting: 'Waiting for its children', asking: 'Asked its parent a question', queued: 'Queued — too many running',
    done: 'Done · result sent up', error: 'Stopped with an error', stopped: 'Stopped', idle: 'Idle',
  };
  function stepText(n) {
    const s = sessionOf(n);
    if (s && (s.unread || s.state === 'attention') && n.state !== 'running') return 'Needs your input';
    if (n.state === 'running') {
      const label = String(s?.statusLabel || '').replace(/^Running\s*/i, '').replace(/^[(:]\s*|\)$/g, '');
      return label || 'Working…';
    }
    return STATE_TEXT[n.state] || n.state;
  }

  function showToast(text, kind, back, label) {
    toast.className = 'tp-toast on' + (kind ? ' ' + kind : '');
    toastText.textContent = text;
    backTo = back || null;
    toastBtn.hidden = !back;
    if (back) toastBtn.textContent = label || '↩ Back';
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => { toast.className = 'tp-toast'; }, kind === 'warn' ? 15000 : 9000);
  }
  toastBtn.addEventListener('click', () => { if (backTo) openNode(backTo); toast.className = 'tp-toast'; });

  function openNode(n) {
    const s = sessionOf(n);
    if (!s) { showToast(n.sid ? 'That chat is not in the list yet — try again in a moment.' : 'Starting… it opens once Claude has named the chat.'); return; }
    if (cur()?.id !== s.id) showDetailView(s);
    chatName.textContent = name(n) === 'Main' ? 'Main chat' : name(n);
    setChatOpen(true);
  }

  // ---------- layout + draw ----------
  function layout() {
    pos = new Map();
    if (!tree) return { w: 0, h: 0 };
    const byParent = new Map();
    for (const n of tree.nodes) { const k = n.parent || ''; if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(n); }
    for (const list of byParent.values()) list.sort((a, b) => a.createdAt - b.createdAt);
    let leaf = 0, maxD = 0;
    const place = (n) => {
      const ch = byParent.get(n.key) || [];
      maxD = Math.max(maxD, n.depth);
      const y = PAD + n.depth * (NH + VG) + NH / 2;
      if (!ch.length) { pos.set(n.key, { x: PAD + leaf++ * (NW + HG) + NW / 2, y }); return; }
      ch.forEach(place);
      const xs = ch.map((c) => pos.get(c.key).x);
      pos.set(n.key, { x: (Math.min(...xs) + Math.max(...xs)) / 2, y });
    };
    const root = tree.nodes.find((n) => !n.parent);
    if (root) place(root);
    let w = PAD * 2 + Math.max(1, leaf) * (NW + HG) - HG;
    const h = PAD * 2 + (maxD + 1) * (NH + VG) - VG;
    const room = wrap.clientWidth || w;
    if (w < room) { const dx = (room - w) / 2; for (const p of pos.values()) p.x += dx; w = room; }
    return { w, h };
  }
  const ends = (from, to) => {
    const a = pos.get(from), b = pos.get(to);
    if (!a || !b) return null;
    return [a.x, a.y + NH / 2, a.x, a.y + NH / 2 + 22, b.x, b.y - NH / 2 - 22, b.x, b.y - NH / 2];
  };
  function bez(p, t) {
    const u = 1 - t;
    return { x: u * u * u * p[0] + 3 * u * u * t * p[2] + 3 * u * t * t * p[4] + t * t * t * p[6], y: u * u * u * p[1] + 3 * u * u * t * p[3] + 3 * u * t * t * p[5] + t * t * t * p[7] };
  }

  function draw() {
    if (!on) return;
    const s = cur();
    stage.querySelectorAll('.tp-node').forEach((x) => x.remove());
    svg.querySelectorAll('.tp-wire').forEach((x) => x.remove());
    // no tree yet: the open chat alone, with how to start one
    const solo = !tree;
    let view = solo
      ? { nodes: s ? [{ key: s.id, sid: s.id, short: 'main', parent: null, depth: 0, title: s.sessionTitle || s.aiTitle || s.project || 'This chat', model: '', state: 'idle', spent: 0, inbox: 0, createdAt: 0 }] : [] }
      : tree;
    // replay: only the nodes that existed at that moment, with the state they had
    if (replay && !solo) {
      view = { ...tree, nodes: tree.nodes.filter((n) => !n.parent || replay.shown.has(n.key))
        .map((n) => ({ ...n, inbox: 0, state: replay.states.get(n.key) || (n.parent ? 'idle' : 'waiting') })) };
    }
    panel.classList.toggle('replaying', !!replay);
    bReplay.textContent = replay ? '■ replay' : '⟲';
    bReplay.hidden = solo;
    const saved = tree;
    tree = view.nodes.length ? view : null;
    const { w, h } = layout();
    tree = saved;
    stage.style.width = w + 'px';
    stage.style.height = h + 'px';
    hint.hidden = !solo;
    hint.textContent = s ? 'No child chats yet. While Tree mode is on, Claude can start them here — ask it to split the work (e.g. “use child chats for the tests and the docs”) — or press ↳ Child.' : '';
    budget.hidden = solo;
    bPause.hidden = bStop.hidden = solo;
    if (!solo) {
      budget.textContent = `${money(tree.spent)} / ${money(tree.budget)}`;
      budget.classList.toggle('warn', tree.spent >= tree.budget * 0.8);
      bPause.textContent = tree.paused ? '▶' : '⏸';
      bPause.title = tree.paused ? 'Resume the tree' : 'Pause: hold new messages between chats';
      title.textContent = tree.stopped ? '🌳 Chat Tree · stopped' : tree.paused ? '🌳 Chat Tree · paused' : '🌳 Chat Tree';
    } else title.textContent = '🌳 Chat Tree';
    bFollow.classList.toggle('on', follow);
    bFollow.textContent = follow ? '⇡ Follow up' : '📌 Stay';

    for (const n of view.nodes) {
      if (n.parent) {
        const p = ends(n.parent, n.key);
        if (p) {
          const path = document.createElementNS(NS, 'path');
          path.setAttribute('class', 'tp-wire');
          path.dataset.key = n.key;
          path.setAttribute('d', `M ${p[0]} ${p[1]} C ${p[2]} ${p[3]}, ${p[4]} ${p[5]}, ${p[6]} ${p[7]}`);
          svg.insertBefore(path, svg.firstChild);
        }
      }
      const at = pos.get(n.key);
      if (!at) continue;
      const d = el('div', `tp-node st-${n.state}` + (n.parent ? '' : ' root') + (isMe(n, s) ? ' focus' : ''));
      d.style.left = (at.x - NW / 2) + 'px';
      d.style.top = (at.y - NH / 2) + 'px';
      d.dataset.key = n.key;
      const top = el('div', 'tp-ntop');
      top.append(el('span', 'tp-dot'), el('b', '', name(n)));
      if (n.inbox) top.appendChild(el('span', 'tp-inbox', String(n.inbox)));
      const ss = sessionOf(n);
      if (ss && (ss.unread || ss.state === 'attention')) top.appendChild(el('span', 'tp-attn', '!'));
      d.append(top, el('div', 'tp-step', stepText(n)),
        el('div', 'tp-meta', [n.parent ? n.short : 'top chat', n.model, n.readOnly ? 'read-only' : '',
          n.merged ? '✓ merged' : n.work && n.work.commits ? `⎇ ${n.work.files} file${n.work.files === 1 ? '' : 's'}` : '',
          n.spent ? money(n.spent) : ''].filter(Boolean).join(' · ')));
      d.title = name(n) + (n.branch && !n.merged ? `\nWorks on git branch ${n.branch}` : '') + '\nClick to chat with it';
      if (n.parent && !replay) {
        const acts = el('div', 'tp-acts');
        const busy = ['running', 'queued', 'preparing', 'waiting', 'asking'].includes(n.state);
        if (n.work && n.work.commits && !n.merged && !busy) {
          const mg = el('button', 'tp-act tp-merge', '⤵ Merge');
          mg.title = `Merge its branch ${n.branch} into the parent's folder (${n.work.stat || n.work.files + ' files'})`;
          mg.addEventListener('click', (e) => { e.stopPropagation(); mergeNode(n, mg); });
          acts.appendChild(mg);
        }
        const rm = el('button', 'tp-act tp-rm', '✕');
        rm.title = 'Remove from the tree (stops it and its children; hides their chats — nothing is deleted)';
        rm.addEventListener('click', (e) => { e.stopPropagation(); removeNode(n); });
        acts.appendChild(rm);
        d.appendChild(acts);
      }
      d.addEventListener('click', () => openNode(n));
      stage.appendChild(d);
    }
    // keep the node you are chatting with in view when the canvas is narrower than the tree
    const me = view.nodes.find((n) => isMe(n, s));
    const p = me && pos.get(me.key);
    if (p && (p.x < wrap.scrollLeft + NW / 2 || p.x > wrap.scrollLeft + wrap.clientWidth - NW / 2)) wrap.scrollLeft = Math.max(0, p.x - wrap.clientWidth / 2);
  }

  // ---------- lights on the wires ----------
  function frame() {
    raf = 0;
    const now = performance.now() / 1000;
    svg.querySelectorAll('.tp-pk').forEach((x) => x.remove());
    svg.querySelectorAll('.tp-wire.lit').forEach((x) => x.classList.remove('lit', 'cmd', 'res', 'ask', 'err'));
    packets = packets.filter((p) => now - p.t0 < TRAVEL);
    for (const p of packets) {
      const down = p.kind === 'command';
      const child = down ? p.to : p.from;
      const parent = down ? p.from : p.to;
      const pts = ends(parent, child);
      if (!pts) continue;
      let f = (now - p.t0) / TRAVEL;
      f = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
      const at = bez(pts, down ? f : 1 - f);
      const cls = { command: 'cmd', result: 'res', question: 'ask', error: 'err', merge: 'res' }[p.kind] || 'res';
      svg.querySelector(`.tp-wire[data-key="${CSS.escape(child)}"]`)?.classList.add('lit', cls);
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'tp-pk ' + cls);
      g.setAttribute('transform', `translate(${at.x},${at.y})`);
      g.innerHTML = `<circle r="6"></circle><text x="10" y="4">${{ command: '▼ task', result: '▲ result', question: '▲ question', error: '✕ error', merge: '⤵ merged' }[p.kind] || ''}</text>`;
      svg.appendChild(g);
    }
    if (packets.length) raf = requestAnimationFrame(frame);
  }
  function flash(key, cls) {
    const d = stage.querySelector(`.tp-node[data-key="${CSS.escape(key)}"]`);
    if (!d) return;
    d.classList.remove('fl-cmd', 'fl-res');
    void d.offsetWidth;
    d.classList.add(cls);
    setTimeout(() => d.classList.remove(cls), 700);
  }

  // ---------- data ----------
  async function load() {
    const s = cur();
    lastId = s?.id || '';
    if (!on || !s) { tree = null; draw(); return; }
    api.treeEnable?.(s.id, true); // Tree mode on → Claude may start child chats in this chat
    let t = null;
    try { t = await api.treeGet(s.id); } catch (_) {}
    if (cur()?.id !== s.id) return;
    tree = t || null;
    draw();
  }
  api.onTreeUpdate?.((snap) => {
    if (!snap) return;
    if (snap.removed) { if (tree?.root === snap.root) { tree = null; draw(); } return; }
    const s = cur();
    if ((tree && snap.root === tree.root) || (s && snap.nodes?.some((n) => isMe(n, s)))) { tree = snap; draw(); }
  });
  api.onTreeEvent?.((ev) => {
    if (!on || !tree || ev.root !== tree.root) return;
    const t0 = performance.now() / 1000;
    if (!reduce) { packets.push({ from: ev.from, to: ev.to, kind: ev.kind, t0 }); if (!raf) raf = requestAnimationFrame(frame); }
    setTimeout(() => flash(ev.to, ev.kind === 'command' ? 'fl-cmd' : 'fl-res'), reduce ? 0 : TRAVEL * 1000);
    // follow up: the chat you are in talked to its parent
    if (ev.kind === 'command' || !follow) return;
    const from = nodeBy(ev.from), to = nodeBy(ev.to);
    if (!from || !to || !isMe(from, cur())) return;
    const what = ev.kind === 'question' ? 'is asking' : ev.kind === 'error' ? 'stopped with an error, telling' : 'sent its result to';
    setTimeout(() => {
      if (!isMe(from, cur())) return; // you moved on meanwhile
      if (typing()) { showToast(`↑ ${name(from)} ${what} ${name(to)}`, 'warn', to, 'Go there'); return; }
      openNode(to);
      showToast(`↑ ${name(from)} ${what} ${name(to)} — switched here`, '', from, '↩ Back');
    }, reduce ? 0 : TRAVEL * 1000);
  });
  api.onTreeNotice?.((d) => { if (on && tree && d.root === tree.root) showToast(d.text, 'warn'); });
  api.onSessionsSync?.(() => { if (on) draw(); }); // step texts and "needs input"
  uiInterval(() => { if (on && (cur()?.id || '') !== lastId) load(); }, 300); // chat switched

  // ---------- remove / merge ----------
  async function removeNode(n) {
    if (!confirm(`Remove ${n.short} "${n.title}" and its child chats from the tree?\n\nRunning ones are stopped. Their chats are hidden in the list (not deleted). A git branch with unmerged work is kept.`)) return;
    let r = null;
    try { r = await api.treeRemove(n.key); } catch (e) { r = { ok: false, text: e.message }; }
    if (!r?.ok) { showToast(r?.text || 'Could not remove it.', 'warn'); return; }
    if (r.sids?.length) window.hideSessions?.(r.sids);
    if (r.sids?.includes(cur()?.id)) setChatOpen(false);
    showToast(r.text);
  }
  async function mergeNode(n, btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = 'Merging…';
    let r = null;
    try { r = await api.treeMerge(n.key); } catch (e) { r = { ok: false, text: e.message }; }
    showToast(r?.text || 'Could not merge.', r?.ok ? '' : 'warn');
    load();
  }

  // ---------- replay: the tree's log played back (nodes appear, lights run, captions say what was sent) ----------
  let replay = null;
  const fastOf = () => (typeof window.__treeReplayFast === 'number' ? window.__treeReplayFast : 1);
  const CAPTION = { command: '▼', result: '▲', question: '▲ ?', error: '✕', merge: '⤵' };
  async function startReplay() {
    if (!tree) return;
    let data = null;
    try { data = await api.treeLog(tree.root); } catch (_) {}
    const events = (data?.log || []).filter((e) => ['node', 'command', 'result', 'question', 'error', 'merge'].includes(e.kind));
    if (!events.length) { showToast('Nothing to replay yet.'); return; }
    const fast = typeof window.__treeReplayFast === 'number' ? window.__treeReplayFast : 1; // tests speed it up
    const times = [];
    events.forEach((e, i) => { times.push(i ? times[i - 1] + Math.min(1.6, Math.max(0.35, (e.at - events[i - 1].at) / 1000)) * fast : 0.3 * fast); });
    replay = { events, times, idx: 0, start: performance.now() / 1000, shown: new Set(), states: new Map() };
    draw();
    replay.timer = setInterval(stepReplay, 40);
  }
  function stopReplay() {
    if (!replay) return;
    clearInterval(replay.timer);
    replay = null;
    toast.className = 'tp-toast';
    draw();
  }
  function stepReplay() {
    if (!replay) return;
    const t = performance.now() / 1000 - replay.start;
    let changedView = false;
    while (replay.idx < replay.events.length && replay.times[replay.idx] <= t) {
      const e = replay.events[replay.idx++];
      changedView = true;
      if (e.kind === 'node') { replay.shown.add(e.key); continue; }
      if (e.kind === 'command') { replay.shown.add(e.to); replay.states.set(e.to, 'running'); }
      else replay.states.set(e.from, { result: 'done', question: 'asking', error: 'error', merge: 'done' }[e.kind]);
      if (!reduce) { packets.push({ from: e.from, to: e.to, kind: e.kind, t0: performance.now() / 1000 }); if (!raf) raf = requestAnimationFrame(frame); }
      const nf = nodeBy(e.from), nt = nodeBy(e.to);
      showToast(`${CAPTION[e.kind] || ''} ${name(nf)} → ${name(nt)}: ${e.text || ''}`);
    }
    if (changedView) draw();
    if (replay.idx >= replay.events.length && t > replay.times[replay.times.length - 1] + 1.5 * fastOf()) stopReplay();
  }
  bReplay.addEventListener('click', () => (replay ? stopReplay() : startReplay()));

  // ---------- controls ----------
  function setOn(v, save) {
    on = !!v;
    document.body.classList.toggle('chat-tree-on', on);
    chatOpen = false;
    document.body.classList.remove('tree-chat-open');
    btn.classList.toggle('open', on);
    if (save) api.storeSet?.('treeView', on);
    stopReplay();
    if (!on && save) api.treeEnable?.(null, false); // off → chats that are not in a tree lose the tools again
    if (on) load(); else { tree = null; packets = []; }
  }
  window.setChatTree = (v) => setOn(v, true);
  window.chatTreeOn = () => on;
  btn.addEventListener('click', (e) => { e.stopPropagation(); setOn(!on, true); });
  bFollow.addEventListener('click', () => { follow = !follow; api.storeSet?.('treeFollow', follow); draw(); });
  bPause.addEventListener('click', async () => { if (tree) { await api.treePause(tree.root, !tree.paused); } });
  bStop.addEventListener('click', async () => {
    if (!tree) return;
    if (!confirm('Stop every running chat in this tree? Their work so far is kept.')) return;
    await api.treeStop(tree.root);
  });
  budget.addEventListener('click', () => {
    if (!tree || budget.querySelector('input')) return;
    const inp = el('input', 'tp-in tp-bin');
    inp.type = 'number'; inp.min = '0.1'; inp.step = '0.5'; inp.value = String(tree.budget);
    budget.textContent = '$';
    budget.appendChild(inp);
    inp.focus(); inp.select();
    const done = async (ok) => { if (ok && Number(inp.value) > 0) await api.treeBudget(tree.root, Number(inp.value)); draw(); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    inp.addEventListener('blur', () => done(true));
  });
  bNew.addEventListener('click', () => { form.hidden = !form.hidden; if (!form.hidden) fTask.focus(); });
  fCancel.addEventListener('click', () => { form.hidden = true; });
  fGo.addEventListener('click', async () => {
    const s = cur();
    const task = fTask.value.trim();
    if (!s || !task) { fTask.focus(); return; }
    if (s.source !== 'claude') { showToast('Child chats work with Claude chats.', 'warn'); return; }
    fGo.disabled = true;
    let r = null;
    try { r = await api.treeStartChild({ parentId: s.id, title: fTitle.value.trim() || task.slice(0, 50), task, model: fModel.value, readOnly: fROc.checked }); } catch (e) { r = { ok: false, text: e.message }; }
    fGo.disabled = false;
    if (!r?.ok) { showToast(r?.text || 'Could not start the child chat.', 'warn'); return; }
    fTitle.value = fTask.value = ''; fROc.checked = false;
    form.hidden = true;
    showToast(`Started ${r.short}. Its result comes back to this chat.`);
    load();
  });

  setOn(on, false);
})();
