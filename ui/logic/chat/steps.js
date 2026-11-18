// Steps panel: what Claude did in this chat, step by step (read a file, edited, ran a command, searched…),
// grouped under the message that started them, with the time, whether it worked, how long it took and the
// start of its output. Open it from "Steps" in the chat toolbar. Type to find a step; chips filter by kind.
//   window.openSteps(session, { q, n })   open the panel for a chat (optionally filtered / with step n opened)
// The same steps are found across all chats by the list's search box (features.js → api.searchSteps).
(function () {
  const api = window.electronAPI;
  if (!api?.getSteps) return;

  const mk = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const KINDS = [['all', 'All'], ['edit', 'Edits'], ['run', 'Commands'], ['read', 'Reads'], ['search', 'Searches'], ['web', 'Web'], ['agent', 'Agents'], ['error', 'Failed']];
  const TAG = { edit: 'EDIT', run: 'RUN', read: 'READ', search: 'FIND', web: 'WEB', agent: 'AGENT', other: 'TOOL' };
  const pad = (n) => String(n).padStart(2, '0');
  const clock = (ts) => { if (!ts) return ''; const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const dur = (ms) => (ms == null ? '' : ms < 950 ? `${Math.round(ms)} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`);

  // ---- skeleton ----
  const backdrop = mk('div', 'sp-backdrop');
  const panel = mk('aside', 'sp-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Steps');
  panel.tabIndex = -1;
  const head = mk('header', 'sp-head');
  const titleBox = mk('div', 'sp-titlebox');
  const title = mk('div', 'sp-title', 'Steps');
  const sub = mk('div', 'sp-sub');
  titleBox.append(title, sub);
  const btnAll = mk('button', 'sp-btn', 'Search all chats');
  btnAll.title = 'Look for this text in the steps of every chat (opens the list search)';
  const btnRefresh = mk('button', 'sp-btn sp-icon', '↻');
  btnRefresh.title = 'Refresh';
  const btnClose = mk('button', 'sp-btn sp-icon', '✕');
  btnClose.title = 'Close (Esc)';
  head.append(titleBox, btnAll, btnRefresh, btnClose);

  const bar = mk('div', 'sp-bar');
  const input = mk('input', 'sp-input');
  input.type = 'text';
  input.placeholder = 'Find a step: a command, a file, a tool…';
  input.spellcheck = false;
  const chips = mk('div', 'sp-chips');
  bar.append(input, chips);
  const list = mk('div', 'sp-list');
  panel.append(head, bar, list);
  document.body.append(backdrop, panel);

  // ---- state ----
  let session = null;
  let data = { steps: [], turns: [], total: 0 };
  let kind = 'all';
  let q = '';
  let openN = null;     // step whose detail is open
  let seq = 0;
  let lastMtime = 0;
  let stick = true;     // keep the newest step in view while it grows

  const isOpen = () => document.body.classList.contains('sp-open');
  const hay = (s) => `${s.tool} ${s.verb} ${s.target} ${s.detail} ${s.file}`.toLowerCase();
  const keep = (s) => (kind === 'all' || (kind === 'error' ? s.ok === false : s.kind === kind)) && (!q || hay(s).includes(q));

  function hl(node, text) {
    text = String(text == null ? '' : text);
    const i = q ? text.toLowerCase().indexOf(q) : -1;
    if (i < 0) { node.textContent = text; return node; }
    node.append(text.slice(0, i), Object.assign(mk('mark', 'sp-mark'), { textContent: text.slice(i, i + q.length) }), text.slice(i + q.length));
    return node;
  }

  function drawChips() {
    chips.textContent = '';
    const count = (k) => data.steps.filter((s) => (k === 'all' ? true : k === 'error' ? s.ok === false : s.kind === k)).length;
    for (const [k, label] of KINDS) {
      const n = count(k);
      if (k !== 'all' && !n) continue;
      const b = mk('button', 'sp-chip' + (kind === k ? ' on' : '') + (k === 'error' ? ' bad' : ''), `${label} ${n}`);
      b.addEventListener('click', () => { kind = k; draw(); });
      chips.appendChild(b);
    }
  }

  function row(s, running) {
    const r = mk('div', 'sp-row' + (s.ok === false ? ' bad' : '') + (openN === s.n ? ' open' : ''));
    r.dataset.n = s.n;
    const top = mk('div', 'sp-row-top');
    const stat = s.ok === false ? 'FAILED' : s.ok === true ? 'OK' : running ? '…' : '';
    top.append(
      mk('span', 'sp-n', '#' + s.n),
      mk('span', 'sp-time', clock(s.ts)),
      mk('span', 'sp-tag sp-tag-' + s.kind, TAG[s.kind] || 'TOOL'),
      hl(mk('span', 'sp-what'), `${s.verb}${s.target ? ' ' + s.target : ''}`),
      mk('span', 'sp-dur', dur(s.ms)),
      mk('span', 'sp-stat' + (s.ok === false ? ' bad' : s.ok === true ? ' ok' : ''), stat),
    );
    r.appendChild(top);
    if (openN === s.n) {
      const d = mk('div', 'sp-detail');
      if (s.detail) { d.appendChild(mk('div', 'sp-lbl', s.kind === 'run' ? 'Command' : 'Details')); d.appendChild(hl(mk('pre', 'sp-code'), s.detail)); }
      if (s.result) { d.appendChild(mk('div', 'sp-lbl', s.ok === false ? 'What went wrong' : 'Output')); d.appendChild(mk('pre', 'sp-code' + (s.ok === false ? ' bad' : ''), s.result)); }
      else if (s.ok === null) d.appendChild(mk('div', 'sp-faint', running ? 'Still running…' : 'No result in the log.'));
      const acts = mk('div', 'sp-acts');
      const copy = mk('button', 'sp-btn', s.kind === 'run' ? 'Copy command' : 'Copy');
      copy.addEventListener('click', (e) => { e.stopPropagation(); api.copyToClipboard(s.detail || s.target); copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = s.kind === 'run' ? 'Copy command' : 'Copy'; }, 900); });
      acts.appendChild(copy);
      if (s.file) {
        const open = mk('button', 'sp-btn', 'Open file');
        open.addEventListener('click', (e) => { e.stopPropagation(); api.openFile?.(s.file); });
        acts.appendChild(open);
      }
      d.appendChild(acts);
      r.appendChild(d);
    }
    r.addEventListener('click', () => { openN = openN === s.n ? null : s.n; stick = false; draw(); });
    return r;
  }

  function draw() {
    const running = !!session && session.status === 'running';
    drawChips();
    const shown = data.steps.filter(keep);
    sub.textContent = session
      ? `${session.sessionTitle || session.project || 'Chat'} · ${data.total} step${data.total === 1 ? '' : 's'}${data.total > data.steps.length ? ` (last ${data.steps.length} shown)` : ''}${q || kind !== 'all' ? ` · ${shown.length} match` : ''}`
      : '';
    btnAll.hidden = !q;
    const keepTop = list.scrollTop;
    list.textContent = '';
    if (!data.steps.length) { list.appendChild(mk('div', 'sp-empty', 'No steps yet. They show up here as Claude reads, edits and runs things.')); return; }
    if (!shown.length) { list.appendChild(mk('div', 'sp-empty', 'No step matches.')); return; }
    let turn = -2;
    shown.forEach((s, idx) => {
      if (s.turn !== turn) {
        turn = s.turn;
        const t = data.turns[turn];
        const h = mk('div', 'sp-turn');
        h.append(mk('span', 'sp-turn-time', t ? clock(t.ts) : ''), mk('span', 'sp-turn-text', t ? t.prompt || '(message)' : 'Earlier steps'));
        list.appendChild(h);
      }
      list.appendChild(row(s, running && s.n === data.steps[data.steps.length - 1].n && idx === shown.length - 1));
    });
    if (stick) list.scrollTop = list.scrollHeight; else list.scrollTop = keepTop;
  }

  async function load(force) {
    if (!session) return;
    const my = ++seq;
    const id = session.id;
    let r;
    try { r = await api.getSteps(id); } catch (_) { r = null; }
    if (my !== seq || !session || session.id !== id) return;
    data = r && Array.isArray(r.steps) ? r : { steps: [], turns: [], total: 0 };
    lastMtime = session.mtime || 0;
    draw();
    if (force && openN != null) list.querySelector(`.sp-row[data-n="${openN}"]`)?.scrollIntoView({ block: 'center' });
  }

  function close() {
    document.body.classList.remove('sp-open');
    session = null;
    seq++;
  }
  function openFor(s, opts = {}) {
    if (!s) return;
    session = s;
    kind = 'all';
    q = String(opts.q || '').trim().toLowerCase();
    input.value = opts.q || '';
    openN = opts.n || null;
    stick = openN == null;
    data = { steps: [], turns: [], total: 0 };
    document.body.classList.add('sp-open');
    draw();
    load(true);
    setTimeout(() => (opts.q ? list : input).focus?.(), 60);
  }
  window.openSteps = openFor;
  window.closeSteps = close;

  // ---- wiring ----
  backdrop.addEventListener('click', close);
  btnClose.addEventListener('click', close);
  btnRefresh.addEventListener('click', () => { btnRefresh.classList.add('spin'); setTimeout(() => btnRefresh.classList.remove('spin'), 500); load(false); });
  input.addEventListener('input', () => { q = input.value.trim().toLowerCase(); stick = false; draw(); });
  list.addEventListener('scroll', () => { stick = list.scrollTop + list.clientHeight >= list.scrollHeight - 24; });
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  document.addEventListener('keydown', (e) => { if (isOpen() && e.key === 'Escape') close(); }, true);
  btnAll.addEventListener('click', () => {
    const text = input.value.trim();
    close();
    if (typeof showListView === 'function') showListView();
    const box = document.querySelector('.fx-search-input');
    if (box) { box.value = text; box.dispatchEvent(new Event('input', { bubbles: true })); box.focus(); }
  });

  // toolbar button
  const tb = document.querySelector('#detailView .convo-toolbar');
  const btn = document.getElementById('tbSteps');
  if (tb && btn) {
    btn.addEventListener('click', () => { if (isOpen()) close(); else if (currentActiveSession) openFor(currentActiveSession); });
  }

  // live: while open, reload when the chat's log changed; closing the chat closes the panel
  uiInterval(() => {
    if (!isOpen()) return;
    const s = currentActiveSession;
    if (!s || !detailView.classList.contains('active') || (session && s.id !== session.id)) { close(); return; }
    session = s;
    if ((s.mtime || 0) !== lastMtime) load(false);
  }, 2000);
})();
