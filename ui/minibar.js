// Mini bar page. Draws what main sends (sessions, approvals, queue summary) and sends answers back.
(function () {
  const api = window.barAPI;
  const $ = (id) => document.getElementById(id);
  const mb = $('mb');

  // ---- look: follow the HUD's style ----
  const STYLE = ['pip', 'work', 'classic'].includes(api.settings?.uiStyle) ? api.settings.uiStyle : 'shelter';
  document.body.classList.add('mb-' + STYLE);

  let sessions = [];
  let perms = [];
  let queues = {};
  let prefs = { auto: false, through: false, edge: 'top' };
  let hover = false;
  let typing = false;
  let todayTokens = null;
  let costs = {};
  let lastBusy = Date.now(); // last time something was running / waiting / queued

  const text = (v, n) => { const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const base = (p) => String(p || '').split(/[\\/]/).pop();
  const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const money = (n) => (n >= 10 ? '$' + n.toFixed(0) : '$' + n.toFixed(2));
  const tok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n));
  const name = (s) => s.sessionTitle || s.project || s.title || 'Chat';

  const isRunning = (s) => s.status === 'running';
  const needsYou = (s) => !isRunning(s) && (s.unread || s.state === 'attention');
  const permFor = (s) => perms.some((p) => p.sessionId === s.id);
  const stateOf = (s) => (permFor(s) || needsYou(s) ? 'need' : isRunning(s) ? 'run' : 'idle');

  // what Claude is doing, in a few words
  function doing(s) {
    const a = s.activity;
    if (!a) return s.statusLabel || 'Working';
    if (a.kind === 'thinking') return 'Thinking';
    if (a.kind === 'writing') return 'Writing the reply';
    if (a.kind === 'sending') return 'Sending your message';
    if (a.kind === 'compacting') return 'Compacting the conversation';
    const i = a.input || {};
    const t = a.tool || 'a tool';
    if (/^(Bash|PowerShell|run_command)$/.test(t)) return 'Running ' + text(i.command || i.CommandLine || 'a command', 60);
    if (/^(Read|view_file|read_file)/.test(t)) return 'Reading ' + base(i.file_path || i.AbsolutePath || i.Path);
    if (/^(Edit|MultiEdit|NotebookEdit|edit_file|replace_file_content|multi_replace_file_content)$/.test(t)) return 'Editing ' + base(i.file_path || i.notebook_path || i.TargetFile || i.Path);
    if (/^(Write|write_file)$/.test(t)) return 'Writing ' + base(i.file_path || i.TargetFile || i.Path);
    if (/^(Grep|grep_search)$/.test(t)) return 'Searching for ' + text(i.pattern || i.Query, 40);
    if (/^(Glob|find_by_name|list_dir)$/.test(t)) return 'Looking for files';
    if (/^(WebSearch|search_web)$/.test(t)) return 'Searching the web';
    if (/^(WebFetch|read_url_content)$/.test(t)) return 'Reading a web page';
    if (/^(Task|Agent)$/.test(t)) return 'Working with a sub-agent';
    return 'Using ' + t.replace(/^mcp__/, '').replace(/__/g, ' › ');
  }
  const permLine = (p) => {
    const i = p.input || {};
    const what = i.command || i.CommandLine || i.file_path || i.path || i.url || i.pattern || '';
    return `${p.toolName || 'A tool'}${what ? ': ' + text(what, 70) : ''}`;
  };

  // ---- sizes ----
  let lastH = 0;
  function pushHeight() {
    const line = mb.classList.contains('line');
    const h = line ? 6 : Math.ceil(mb.getBoundingClientRect().height);
    if (h !== lastH) { lastH = h; api.setHeight(h); }
  }

  // ---- drawing ----
  function dotEl(s) {
    const d = document.createElement('span');
    d.className = 'mb-dot ' + stateOf(s);
    d.title = `${name(s)}: ${stateOf(s) === 'need' ? 'needs you' : stateOf(s) === 'run' ? 'running' : 'idle'}`;
    d.addEventListener('click', () => api.openChat(s.id));
    return d;
  }

  function activeSession() {
    return sessions.filter(isRunning).sort((a, b) => (b.mtime || 0) - (a.mtime || 0))[0] || null;
  }
  function target() {
    return sessions.find((s) => permFor(s)) || sessions.find(needsYou) || [...sessions].sort((a, b) => (b.mtime || 0) - (a.mtime || 0))[0] || null;
  }

  function draw() {
    const run = sessions.filter(isRunning);
    const need = sessions.filter((s) => stateOf(s) === 'need');
    const qTotal = Object.values(queues).reduce((n, q) => n + q.n, 0);
    const held = Object.values(queues).some((q) => q.held);
    const busy = run.length || need.length || perms.length || qTotal;
    if (busy) lastBusy = Date.now();

    mb.classList.toggle('need', need.length > 0);
    mb.classList.toggle('bottom', prefs.edge === 'bottom');

    // status dots (needs-you first, then running, then idle)
    const dots = $('dots');
    dots.textContent = '';
    const order = { need: 0, run: 1, idle: 2 };
    [...sessions].sort((a, b) => order[stateOf(a)] - order[stateOf(b)]).slice(0, 14).forEach((s) => dots.appendChild(dotEl(s)));

    // summary
    const sum = $('sum');
    sum.textContent = '';
    const part = (n, label, cls) => { const b = document.createElement('span'); if (cls) b.className = cls; b.innerHTML = `<b>${n}</b> ${label}`; return b; };
    if (!sessions.length) sum.textContent = 'No chats';
    else {
      const bits = [];
      if (need.length) bits.push(part(need.length, 'needs you', 'need'));
      if (run.length) bits.push(part(run.length, 'running'));
      if (!bits.length) bits.push(part(sessions.length, sessions.length === 1 ? 'chat, idle' : 'chats, idle'));
      bits.forEach((b, i) => { if (i) sum.append(' · '); sum.append(b); });
    }

    // approval takes the middle of the bar; otherwise the busiest chat's line with Stop
    const p = perms[0];
    const act = activeSession();
    $('perm').hidden = !p;
    $('act').hidden = !!p || !act;
    if (p) {
      const owner = sessions.find((s) => s.id === p.sessionId);
      $('permText').textContent = (owner ? name(owner) + ' · ' : '') + permLine(p) + (perms.length > 1 ? `  (+${perms.length - 1} more)` : '');
      $('permText').title = $('permText').textContent;
      $('allow').dataset.id = p.id; $('deny').dataset.id = p.id;
    } else if (act) {
      $('actText').textContent = `${name(act)} · ${doing(act)}`;
      $('actText').title = $('actText').textContent;
      $('stop').dataset.id = act.id;
    }
    tickTime();

    // queue
    $('queue').hidden = !qTotal;
    $('queue').classList.toggle('held', held);
    $('queueText').textContent = `${qTotal} ${held ? 'kept' : 'queued'}`;
    $('resume').hidden = !held;

    // numbers on the right
    const bits = [];
    if (act && costs[act.id] != null) bits.push(money(costs[act.id]));
    if (act && act.context && act.context.window) bits.push(Math.round(100 * act.context.used / act.context.window) + '% ctx');
    if (todayTokens != null) bits.push(tok(todayTokens) + ' today');
    $('stats').textContent = bits.join(' · ');

    drawPanel();
    updateLayout();
  }

  function tickTime() {
    const act = activeSession();
    const t = $('actTime');
    t.textContent = act && act.activity && act.activity.since ? clock(Date.now() - act.activity.since) : '';
  }

  function drawPanel() {
    const list = $('list');
    list.textContent = '';
    const rows = [...sessions].sort((a, b) => {
      const o = { need: 0, run: 1, idle: 2 };
      return o[stateOf(a)] - o[stateOf(b)] || (b.mtime || 0) - (a.mtime || 0);
    }).slice(0, 12);
    if (!rows.length) { const e = document.createElement('div'); e.className = 'mb-empty'; e.textContent = 'No chats yet.'; list.appendChild(e); }
    rows.forEach((s) => {
      const r = document.createElement('div');
      r.className = 'mb-row';
      const st = stateOf(s);
      const n = document.createElement('span'); n.className = 'mb-row-name'; n.textContent = name(s);
      const t = document.createElement('span'); t.className = 'mb-row-stat';
      t.textContent = st === 'run' ? doing(s) : st === 'need' ? (permFor(s) ? 'Waiting for your approval' : text(s.detail || 'Needs your answer', 70)) : text(s.detail || 'Idle', 70);
      r.append(dotEl(s), n, t);
      const q = queues[s.id];
      if (q) { const qe = document.createElement('span'); qe.className = 'mb-row-q'; qe.textContent = `${q.n} ${q.held ? 'kept' : 'queued'}`; r.appendChild(qe); }
      r.addEventListener('click', () => api.openChat(s.id));
      list.appendChild(r);
    });
    // reply targets: keep the choice when the list changes
    const sel = $('target');
    const keep = sel.value;
    sel.textContent = '';
    const def = target();
    sessions.forEach((s) => { const o = document.createElement('option'); o.value = s.id; o.textContent = name(s); sel.appendChild(o); });
    sel.value = typing && keep && sessions.some((s) => s.id === keep) ? keep : (def ? def.id : '');
    $('input').placeholder = def && stateOf(def) === 'need' ? `Reply to ${name(def)}…` : 'Send a message to a chat…';
  }

  // ---- open / auto-hide ----
  let openTimer = null, closeTimer = null, hideTimer = null;
  function setOpen(on) {
    if (mb.classList.contains('line')) return;
    mb.classList.toggle('open', on);
    updateLayout();
  }
  function updateLayout() { requestAnimationFrame(pushHeight); }
  function setLine(on) {
    if (mb.classList.contains('line') === on) return;
    mb.classList.toggle('line', on);
    if (on) mb.classList.remove('open');
    updateLayout();
  }
  function wake() { setLine(false); lastBusy = Math.max(lastBusy, Date.now()); }

  mb.addEventListener('mouseenter', () => {
    hover = true;
    clearTimeout(closeTimer);
    if (mb.classList.contains('line')) { wake(); return; }
    openTimer = setTimeout(() => setOpen(true), 250);
  });
  mb.addEventListener('mouseleave', () => {
    hover = false;
    clearTimeout(openTimer);
    closeTimer = setTimeout(() => { if (!hover && !typing) setOpen(false); }, 450);
  });

  // auto-hide: nothing needs me for 8 seconds → a thin line
  setInterval(() => {
    if (document.hidden) return;
    tickTime();
    if (!prefs.auto) { setLine(false); return; }
    const calm = !hover && !typing && Date.now() - lastBusy > 8000;
    if (calm) setLine(true);
    else if (Date.now() - lastBusy <= 8000) setLine(false);
  }, 1000);

  // ---- click-through: only the buttons and the grip catch the mouse ----
  let ignoring = false;
  function applyThrough() {
    if (!prefs.through) { if (ignoring) { ignoring = false; api.setIgnore(false); } return; }
    if (!ignoring) { ignoring = true; api.setIgnore(true); }
  }
  document.addEventListener('mousemove', (e) => {
    if (!prefs.through) return;
    const hit = !!(e.target.closest && e.target.closest('[data-hit], .mb-panel')) && !mb.classList.contains('line');
    if (hit === ignoring) { ignoring = !hit; api.setIgnore(!hit); }
  });

  // ---- buttons ----
  $('allow').addEventListener('click', (e) => api.respondPermission(e.currentTarget.dataset.id, 'allow'));
  $('deny').addEventListener('click', (e) => api.respondPermission(e.currentTarget.dataset.id, 'deny'));
  $('stop').addEventListener('click', (e) => api.stopReply(e.currentTarget.dataset.id));
  $('resume').addEventListener('click', () => api.resumeQueue());
  $('openHud').addEventListener('click', () => api.openChat(''));
  $('closeBar').addEventListener('click', () => api.close());
  $('sum').addEventListener('click', () => { const s = sessions.find((x) => stateOf(x) === 'need') || activeSession(); api.openChat(s ? s.id : ''); });
  $('act').addEventListener('click', (e) => { if (e.target.closest('button')) return; const s = activeSession(); if (s) api.openChat(s.id); });
  document.addEventListener('contextmenu', (e) => { e.preventDefault(); api.menu(); });

  // ---- quick reply ----
  const note = $('note');
  const say = (m) => { note.textContent = m || ''; updateLayout(); };
  $('reply').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('input');
    const msg = input.value.trim();
    const s = sessions.find((x) => x.id === $('target').value);
    if (!msg) return;
    if (!s) return say('Pick a chat first.');
    if (isRunning(s)) return say(`${name(s)} is busy. Wait until it is done, or add the message in the HUD queue.`);
    api.sendReply(msg, { id: s.id, sessionUuid: s.sessionUuid, source: s.source, cwd: s.cwd, project: s.project });
    input.value = '';
    say(`Sent to ${name(s)}.`);
    setTimeout(() => say(''), 2500);
  });
  $('input').addEventListener('focus', () => { typing = true; clearTimeout(closeTimer); });
  $('input').addEventListener('blur', () => { typing = !!$('input').value; if (!typing && !hover) closeTimer = setTimeout(() => setOpen(false), 450); });
  $('input').addEventListener('input', () => { typing = true; say(''); });
  $('input').addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('input').value = ''; $('input').blur(); typing = false; setOpen(false); } });

  // ---- data from main ----
  api.onSessions((v) => { sessions = Array.isArray(v) ? v : []; draw(); });
  api.onPerms((v) => { perms = Array.isArray(v) ? v : []; if (perms.length) wake(); draw(); });
  api.onQueues((v) => { queues = v && typeof v === 'object' ? v : {}; draw(); });
  api.onPrefs((v) => { prefs = { ...prefs, ...(v || {}) }; applyThrough(); draw(); });

  async function refreshNumbers() {
    if (document.hidden || mb.classList.contains('line')) return;
    try { const u = await api.getUsageToday(); if (u && typeof u.tokens === 'number') todayTokens = u.tokens; } catch (_) {}
    const act = activeSession();
    if (act) { try { costs = { ...costs, ...(await api.getSessionCosts([act.id])) }; } catch (_) {} }
    draw();
  }
  setInterval(refreshNumbers, 45000);
  setTimeout(refreshNumbers, 1500);
  draw();
})();
