// HUD extra features (renderer side). Loaded after app.js and uses its globals.
//   1. Files edited by each reply (+/− lines, inline diff, open in VS Code)
//   2. Quick prompts (⚡) — global + per-project, editable
//   3. Desktop notifications toggle + today's summary (Settings)
//   4. Search across all conversations (session list)
//   5. Queue a message while the agent is busy
//   6. Stop button for a reply sent from the HUD
//   7. Voice typing (🎤 → Windows dictation)
//   8. Pin / rename / hide sessions (right-click a card)
//   + copy-reply button, global hotkey focus, cost per card, export conversation
(function () {
  const api = window.electronAPI;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // -------------------------------------------------------------------------
  // Persistent settings (~/.ovly-claude/settings.json via main)
  // -------------------------------------------------------------------------
  let store = {};
  const setStore = (k, v) => { store[k] = v; api.storeSet?.(k, v); };
  const ready = (api.storeGetAll ? api.storeGetAll() : Promise.resolve({}))
    .then((s) => { store = s || {}; })
    .catch(() => {});

  // -------------------------------------------------------------------------
  // 1. Edited files under a reply  +  copy button
  // -------------------------------------------------------------------------
  const baseOf = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || p;
  const dirOf = (p) => { const parts = String(p || '').split(/[\\/]/); parts.pop(); return parts.slice(-2).join('/'); };

  // Trim the lines both sides share at the start/end so only the change shows
  function diffLines(oldText, newText) {
    const a = oldText ? oldText.split('\n') : [];
    const b = newText ? newText.split('\n') : [];
    let s = 0;
    while (s < a.length && s < b.length && a[s] === b[s]) s++;
    let ea = a.length - 1, eb = b.length - 1;
    while (ea >= s && eb >= s && a[ea] === b[eb]) { ea--; eb--; }
    const out = [];
    if (s > 0) out.push({ t: 'ctx', s: a[s - 1] });
    for (let i = s; i <= ea; i++) out.push({ t: 'del', s: a[i] });
    for (let i = s; i <= eb; i++) out.push({ t: 'add', s: b[i] });
    if (ea + 1 < a.length) out.push({ t: 'ctx', s: a[ea + 1] });
    return out;
  }

  function renderDiff(box, edit) {
    box.innerHTML = '';
    let shown = 0;
    const MAX = 220;
    edit.hunks.forEach((h, i) => {
      if (shown >= MAX) return;
      if (i > 0) box.appendChild(el('div', 'df-sep', '⋯'));
      const lines = h.whole ? h.new.split('\n').map((s) => ({ t: 'add', s })) : diffLines(h.old, h.new);
      for (const l of lines) {
        if (shown++ >= MAX) { box.appendChild(el('div', 'df-more', '… (more lines not shown — open the file)')); return; }
        const row = el('div', `df-line df-${l.t}`);
        row.textContent = (l.t === 'add' ? '+ ' : l.t === 'del' ? '− ' : '  ') + l.s;
        box.appendChild(row);
      }
    });
  }

  function renderEdits(bubble, edits) {
    bubble.querySelector('.edit-list')?.remove();
    if (!edits || !edits.length) return;
    const list = el('div', 'edit-list');
    const totalA = edits.reduce((n, e) => n + e.added, 0);
    const totalR = edits.reduce((n, e) => n + e.removed, 0);
    const head = el('div', 'edit-head');
    head.append(el('span', 'edit-title', `📝 Edited ${edits.length} file${edits.length > 1 ? 's' : ''}`),
      el('span', 'edit-add', `+${totalA}`), el('span', 'edit-del', `−${totalR}`));
    list.appendChild(head);
    for (const ed of edits) {
      const row = el('div', 'edit-row');
      row.title = ed.path + '\nClick to see the change';
      const name = el('span', 'edit-name', baseOf(ed.path));
      const dir = el('span', 'edit-dir', dirOf(ed.path));
      const stats = el('span', 'edit-stats');
      stats.append(el('span', 'edit-add', `+${ed.added}`), el('span', 'edit-del', `−${ed.removed}`));
      const open = el('button', 'edit-open', 'Open');
      open.title = 'Open in VS Code';
      open.addEventListener('click', async (e) => {
        e.stopPropagation();
        const r = await api.openFile?.(ed.path);
        if (r === 'missing') replyStatusMsg.textContent = '⚠ File no longer exists';
      });
      row.append(name, dir, stats, open);
      const diff = el('div', 'edit-diff');
      diff.style.display = 'none';
      row.addEventListener('click', () => {
        const opening = diff.style.display === 'none';
        if (opening && !diff.childElementCount) renderDiff(diff, ed);
        diff.style.display = opening ? '' : 'none';
        row.classList.toggle('open', opening);
      });
      list.append(row, diff);
    }
    bubble.appendChild(list);
  }

  window.decorateBubble = function (bubble, msg) {
    if (msg.role === 'assistant' && !bubble.querySelector('.bubble-copy')) {
      const copy = el('button', 'bubble-copy', '📋');
      copy.title = 'Copy this reply (markdown)';
      copy.addEventListener('click', (e) => {
        e.stopPropagation();
        const content = bubble.querySelector('.bubble-content');
        const md = bubble._md || msg.text || (content ? content.innerText : '');
        api.copyToClipboard(md);
        copy.textContent = '✓';
        setTimeout(() => { copy.textContent = '📋'; }, 1200);
      });
      bubble.appendChild(copy);
    }
    if (msg.edits && msg.edits.length) renderEdits(bubble, msg.edits);
  };

  // The agent's newest reply to your latest message (nothing newer than your own message)
  function replyAfterLastUser() {
    const bs = [...chatStream.querySelectorAll('.chat-bubble')];
    for (let i = bs.length - 1; i >= 0; i--) {
      if (bs[i].classList.contains('user')) return null;
      if (bs[i].classList.contains('assistant') && bs[i].id !== 'streamingBubble' && !bs[i].classList.contains('pending')) return bs[i];
    }
    return null;
  }

  // A reply sent from the HUD finished: attach the files it edited to the reply.
  // The reply may still be a moment away (it arrives with the next update), so wait
  // for it; only if none shows up within 8 s, add a stand-in message to hold the list.
  let pendingEdits = null; // { sessionId, edits, at }
  function attachPendingEdits() {
    if (!pendingEdits) return;
    const p = pendingEdits;
    if (!currentActiveSession || currentActiveSession.id !== p.sessionId) { pendingEdits = null; return; }
    const history = sessionChatHistory.get(p.sessionId) || [];
    const bubble = replyAfterLastUser();
    if (bubble) {
      renderEdits(bubble, p.edits);
      const h = [...history].reverse().find((m) => m.role === 'assistant');
      if (h) h.edits = p.edits;
      pendingEdits = null;
    } else if (Date.now() - p.at > 8000) {
      const msg = { role: 'assistant', text: '*(edited files — see below)*', time: 'Just now', source: currentActiveSession.source || 'claude', edits: p.edits };
      history.push(msg);
      msg.el = appendBubble(msg);
      pendingEdits = null;
    }
  }
  setInterval(attachPendingEdits, 500);

  api.onReplyStatus?.(({ sessionId, status, text, edits }) => {
    if (status !== 'idle' || !currentActiveSession || currentActiveSession.id !== sessionId) return;
    if (text) { const b = replyAfterLastUser(); if (b) b._md = text; }
    if (edits && edits.length) { pendingEdits = { sessionId, edits, at: Date.now() }; attachPendingEdits(); }
  });

  // -------------------------------------------------------------------------
  // Reply-toolbar buttons: ⚡ quick prompts, 🎤 voice
  // -------------------------------------------------------------------------
  const toolbar = document.querySelector('.reply-toolbar');
  const anchor = $('btnSnip') || $('btnSlash');
  const btnPrompts = el('button', 'rt-btn rt-prompts', '⚡');
  btnPrompts.title = 'Quick prompts — click to send, Shift+click to insert';
  const btnVoice = el('button', 'rt-btn rt-voice', '🎤');
  btnVoice.title = 'Voice typing — talk instead of typing (Windows dictation, Win+H)';
  if (toolbar && anchor) anchor.after(btnPrompts, btnVoice);

  btnVoice.addEventListener('click', async () => {
    replyTextarea.focus();
    const ok = await api.voiceTyping?.();
    if (!ok) replyStatusMsg.textContent = 'Voice typing needs Windows (Win+H)';
  });

  // -------------------------------------------------------------------------
  // 2. Quick prompts
  // -------------------------------------------------------------------------
  const DEFAULT_PROMPTS = [
    'Continue',
    'Run the tests and fix any failures',
    'Commit these changes with a clear message',
    'Explain what you just did, briefly',
    'Review your last change for bugs',
  ];
  const promptsData = () => store.prompts || { global: DEFAULT_PROMPTS.slice(), byCwd: {} };
  const cwdKey = () => (currentActiveSession?.cwd || '').toLowerCase();

  const promptMenu = el('div', 'quick-prompts');
  promptMenu.style.display = 'none';
  document.querySelector('.reply-section')?.appendChild(promptMenu);

  function closePrompts() { promptMenu.style.display = 'none'; btnPrompts.classList.remove('open'); }

  function renderPromptMenu() {
    const d = promptsData();
    const proj = d.byCwd[cwdKey()] || [];
    promptMenu.innerHTML = '';
    const head = el('div', 'qp-head');
    head.append(el('span', null, 'Quick prompts'));
    const edit = el('button', 'qp-edit', '✎ Edit');
    edit.addEventListener('click', (e) => { e.stopPropagation(); renderPromptEditor(); });
    head.appendChild(edit);
    promptMenu.appendChild(head);
    const add = (p, tag) => {
      const item = el('div', 'qp-item');
      item.append(el('span', 'qp-text', p));
      if (tag) item.append(el('span', 'qp-tag', tag));
      item.title = 'Click to send · Shift+click to put it in the box';
      item.addEventListener('click', (e) => {
        closePrompts();
        if (e.shiftKey) { replyTextarea.value = p; replyTextarea.focus(); return; }
        replyTextarea.value = p;
        submitReply();
      });
      promptMenu.appendChild(item);
    };
    proj.forEach((p) => add(p, currentActiveSession?.project || 'project'));
    d.global.forEach((p) => add(p));
    if (!proj.length && !d.global.length) promptMenu.appendChild(el('div', 'qp-empty', 'No prompts yet — click ✎ Edit'));
  }

  function renderPromptEditor() {
    const d = promptsData();
    promptMenu.innerHTML = '';
    const head = el('div', 'qp-head');
    head.append(el('span', null, 'Edit quick prompts — one per line'));
    promptMenu.appendChild(head);
    promptMenu.appendChild(el('div', 'qp-label', 'All projects'));
    const g = el('textarea', 'qp-area');
    g.value = d.global.join('\n');
    promptMenu.appendChild(g);
    let p = null;
    if (currentActiveSession?.cwd) {
      promptMenu.appendChild(el('div', 'qp-label', `Only in ${currentActiveSession.project || currentActiveSession.cwd}`));
      p = el('textarea', 'qp-area');
      p.value = (d.byCwd[cwdKey()] || []).join('\n');
      promptMenu.appendChild(p);
    }
    const row = el('div', 'qp-actions');
    const save = el('button', 'qp-btn primary', 'Save');
    const cancel = el('button', 'qp-btn', 'Cancel');
    const reset = el('button', 'qp-btn', 'Defaults');
    const lines = (t) => t.value.split('\n').map((s) => s.trim()).filter(Boolean);
    save.addEventListener('click', (e) => {
      e.stopPropagation();
      const next = { global: lines(g), byCwd: { ...d.byCwd } };
      if (p) { const l = lines(p); if (l.length) next.byCwd[cwdKey()] = l; else delete next.byCwd[cwdKey()]; }
      setStore('prompts', next);
      renderPromptMenu();
    });
    cancel.addEventListener('click', (e) => { e.stopPropagation(); renderPromptMenu(); });
    reset.addEventListener('click', (e) => { e.stopPropagation(); g.value = DEFAULT_PROMPTS.join('\n'); });
    row.append(reset, cancel, save);
    promptMenu.appendChild(row);
    g.focus();
  }

  btnPrompts.addEventListener('click', (e) => {
    e.stopPropagation();
    if (promptMenu.style.display !== 'none') { closePrompts(); return; }
    renderPromptMenu();
    promptMenu.style.display = '';
    btnPrompts.classList.add('open');
  });
  promptMenu.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => { if (promptMenu.style.display !== 'none') closePrompts(); });

  // -------------------------------------------------------------------------
  // 5. Queue a message while the agent is busy
  // -------------------------------------------------------------------------
  const queues = new Map(); // sessionId -> [{ text, attachments }]
  const idleTicks = new Map();

  function liveSession(id) {
    return sessionsList.find((x) => x.id === id) || (currentActiveSession?.id === id ? currentActiveSession : null);
  }
  // Busy = a reply sent from the HUD is still streaming, or the session shows
  // *recent* activity. A "running" status with nothing new for 90 s is not
  // trusted (it may be stuck), so messages are never held forever.
  const BUSY_STALE_MS = 90 * 1000;
  function isBusy(s) {
    if (!s) return false;
    if (liveActivity.has(s.id)) return true;
    if (currentActiveSession?.id === s.id && document.getElementById('streamingBubble')) return true;
    const live = liveSession(s.id) || s;
    if (live.status !== 'running') return false;
    const lastActivity = Math.max(Number(live.mtime) || 0, Number(live.lastTurnTs) || 0);
    return Date.now() - lastActivity < BUSY_STALE_MS;
  }

  const queueBar = el('div', 'queue-bar');
  queueBar.style.display = 'none';
  document.querySelector('.reply-box')?.before(queueBar);

  function renderQueue() {
    const q = currentActiveSession ? (queues.get(currentActiveSession.id) || []) : [];
    const aName = currentActiveSession ? agentLabel(currentActiveSession.source, currentActiveSession.id) : 'Claude';
    queueBar.innerHTML = '';
    queueBar.style.display = q.length ? '' : 'none';
    q.forEach((item, i) => {
      const chip = el('div', 'queue-chip');
      chip.append(el('span', 'queue-ico', '⏳'));
      const label = item.text || `${item.attachments.length} attachment(s)`;
      chip.append(el('span', 'queue-text', `${i === 0 ? `Sends when ${aName} is done: ` : 'Then: '}${label}`));
      const x = el('button', 'queue-x', '✕');
      x.title = 'Remove from queue';
      x.addEventListener('click', () => { q.splice(i, 1); renderQueue(); });
      chip.appendChild(x);
      queueBar.appendChild(chip);
    });
  }

  const origSubmit = submitReply;
  // eslint-disable-next-line no-global-assign
  submitReply = function (text) {
    const s = currentActiveSession;
    const reply = (text || replyTextarea.value || '').trim();
    if (s && !s.draft && (reply || attachments.length) && !reply.startsWith('/') && isBusy(s)) {
      if (!queues.has(s.id)) queues.set(s.id, []);
      queues.get(s.id).push({ text: reply, attachments: attachments.slice() });
      replyTextarea.value = '';
      attachments = [];
      renderAttachments();
      renderQueue();
      replyStatusMsg.textContent = `⏳ Queued — it will be sent when ${agentLabel(s.source, s.id)} finishes`;
      return;
    }
    return origSubmit(text);
  };

  function flushQueues() {
    for (const [id, q] of queues) {
      if (!q.length) { queues.delete(id); continue; }
      const s = liveSession(id);
      if (!s || isBusy(s)) { idleTicks.set(id, 0); continue; }
      const n = (idleTicks.get(id) || 0) + 1;
      idleTicks.set(id, n);
      if (n < 2) continue; // idle for ~2 s, so a turn that is just chaining tools isn't interrupted
      idleTicks.set(id, 0);
      const item = q.shift();
      if (currentActiveSession?.id === id) {
        const keepText = replyTextarea.value, keepAtt = attachments;
        replyTextarea.value = item.text;
        attachments = item.attachments;
        origSubmit();
        replyTextarea.value = keepText;
        attachments = keepAtt;
        renderAttachments();
      } else {
        const keepAtt = attachments;
        attachments = item.attachments;
        const att = attachmentPayload();
        attachments = keepAtt;
        const userMsg = { role: 'user', text: item.text, images: att.images, time: 'Just now' };
        if (!sessionChatHistory.has(id)) sessionChatHistory.set(id, []);
        sessionChatHistory.get(id).push(userMsg);
        liveActivity.set(id, { act: { kind: 'sending', since: Date.now() }, at: Date.now() });
        api.sendReply({ text: item.text, ...att, session: s, options: {} });
      }
      renderQueue();
    }
  }

  // -------------------------------------------------------------------------
  // 6. Stop button (in the activity line)
  // -------------------------------------------------------------------------
  const activityRow = $('activityRow');
  const btnStop = el('button', 'activity-stop', '■ Stop');
  btnStop.title = 'Stop this reply';
  btnStop.style.display = 'none';
  activityRow?.appendChild(btnStop);
  btnStop.addEventListener('click', async () => {
    if (!currentActiveSession) return;
    btnStop.disabled = true;
    const ok = await api.stopReply?.(currentActiveSession.id);
    btnStop.disabled = false;
    if (!ok) replyStatusMsg.textContent = 'Only replies sent from this HUD can be stopped here';
  });

  // -------------------------------------------------------------------------
  // 8. Pin / rename / hide sessions
  // -------------------------------------------------------------------------
  const meta = () => store.sessionMeta || { pinned: [], names: {}, hidden: [] };
  const saveMeta = (m) => setStore('sessionMeta', m);
  let showHidden = false;
  let costs = {};

  const origRenderCards = renderSessionCards;
  // eslint-disable-next-line no-global-assign
  renderSessionCards = function (force) {
    const m = meta();
    const pinned = new Set(m.pinned), hidden = new Set(m.hidden);
    const all = sessionsList;
    const named = all.map((s) => (m.names[s.id] ? { ...s, sessionTitle: m.names[s.id] } : s));
    const visible = named.filter((s) => showHidden || !hidden.has(s.id));
    const pinnedList = visible.filter((s) => pinned.has(s.id) && matchesFilter(s));
    const marker = el('div', 'fx-marker');
    sessionsContainer.appendChild(marker);
    sessionsList = visible.filter((s) => !pinned.has(s.id));
    try { origRenderCards(force); } finally { sessionsList = all; }
    if (marker.isConnected) { marker.remove(); return; } // list kept as-is (you were selecting text)

    if (pinnedList.length) {
      if (!sessionsList.some(matchesFilter)) sessionsContainer.innerHTML = '';
      const group = el('div', 'workspace-group fx-pinned-group');
      const header = el('div', 'workspace-header');
      header.append(el('span', 'workspace-caret', '📌'), el('span', 'workspace-name', 'Pinned'));
      const body = el('div', 'workspace-body');
      pinnedList.forEach((s) => body.appendChild(buildSessionCard(s)));
      group.append(header, body);
      sessionsContainer.prepend(group);
    }
    // hidden / pinned marks + cost on each card
    sessionsContainer.querySelectorAll('.session-row').forEach((row) => {
      const id = row.id.replace(/^card-/, '');
      if (hidden.has(id)) row.classList.add('fx-hidden');
      if (pinned.has(id)) row.classList.add('fx-pinned');
      const c = costs[id];
      if (c != null && c >= 0.005) {
        const meta = row.querySelector('.row-meta');
        if (meta && !meta.querySelector('.row-cost')) {
          const span = el('span', 'row-cost', `$${c < 10 ? c.toFixed(2) : c.toFixed(0)}`);
          span.title = 'API-equivalent cost of this session so far (subscriptions are not billed per token)';
          meta.appendChild(span);
        }
      }
    });
    const nHidden = all.filter((s) => hidden.has(s.id)).length;
    if (nHidden) {
      const t = el('div', 'fx-hidden-toggle', showHidden ? `Hide hidden sessions (${nHidden})` : `Show hidden sessions (${nHidden})`);
      t.addEventListener('click', () => { showHidden = !showHidden; renderSessionCards(true); });
      sessionsContainer.appendChild(t);
    }
  };

  function matchesFilter(s) {
    if (currentFilter === 'running') return s.status === 'running';
    if (currentFilter === 'idle') return s.status === 'idle';
    if (currentFilter === 'attention') return s.state === 'attention';
    return true;
  }

  // Renamed sessions keep their name in the conversation header too
  const origHeader = updateConvoHeader;
  // eslint-disable-next-line no-global-assign
  updateConvoHeader = function (s) {
    origHeader(s);
    const name = s && meta().names[s.id];
    if (name) $('convoPersonal').textContent = name;
  };

  // Right-click menu on a session card
  const ctxMenu = el('div', 'fx-menu');
  ctxMenu.style.display = 'none';
  document.body.appendChild(ctxMenu);
  const closeMenu = () => { ctxMenu.style.display = 'none'; };
  document.addEventListener('click', (e) => { if (!ctxMenu.contains(e.target)) closeMenu(); });
  window.addEventListener('blur', closeMenu);

  sessionsContainer.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.session-row');
    if (!row) return;
    e.preventDefault();
    const id = row.id.replace(/^card-/, '');
    const s = sessionsList.find((x) => x.id === id);
    const m = meta();
    const isPinned = m.pinned.includes(id), isHidden = m.hidden.includes(id);
    ctxMenu.innerHTML = '';
    const item = (label, fn) => {
      const b = el('button', 'fx-menu-item', label);
      b.addEventListener('click', (ev) => { ev.stopPropagation(); fn(); });
      ctxMenu.appendChild(b);
    };
    item(isPinned ? '📌 Unpin' : '📌 Pin to top', () => {
      m.pinned = isPinned ? m.pinned.filter((x) => x !== id) : [...m.pinned, id];
      saveMeta(m); closeMenu(); renderSessionCards(true);
    });
    item('✎ Rename…', () => {
      ctxMenu.innerHTML = '';
      const input = el('input', 'fx-rename');
      input.value = m.names[id] || s?.sessionTitle || '';
      input.placeholder = 'Name (empty = original)';
      const done = () => {
        const v = input.value.trim();
        if (v && v !== s?.sessionTitle) m.names[id] = v; else delete m.names[id];
        saveMeta(m); closeMenu(); renderSessionCards(true);
        if (currentActiveSession) updateConvoHeader(currentActiveSession);
      };
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') done();
        if (ev.key === 'Escape') closeMenu();
        ev.stopPropagation();
      });
      ctxMenu.appendChild(input);
      input.focus();
      input.select();
    });
    item(isHidden ? '👁 Unhide' : '🙈 Hide', () => {
      m.hidden = isHidden ? m.hidden.filter((x) => x !== id) : [...m.hidden, id];
      saveMeta(m); closeMenu(); renderSessionCards(true);
    });
    ctxMenu.style.display = '';
    const w = ctxMenu.offsetWidth, h = ctxMenu.offsetHeight;
    ctxMenu.style.left = Math.min(e.clientX, window.innerWidth - w - 4) + 'px';
    ctxMenu.style.top = Math.min(e.clientY, window.innerHeight - h - 4) + 'px';
  });

  // Cost per card (refreshed every minute)
  async function refreshCosts() {
    if (!api.getSessionCosts) return;
    const ids = sessionsList.filter((s) => s.source === 'claude').map((s) => s.id);
    if (!ids.length) return;
    try {
      const next = await api.getSessionCosts(ids);
      const changed = JSON.stringify(next) !== JSON.stringify(costs);
      costs = next || {};
      if (changed && listView.classList.contains('active')) renderSessionCards();
    } catch (_) {}
  }

  // -------------------------------------------------------------------------
  // 4. Search across all conversations
  // -------------------------------------------------------------------------
  const searchBox = el('div', 'fx-search');
  const searchInput = el('input', 'fx-search-input');
  searchInput.type = 'search';
  searchInput.placeholder = '🔍 Search all conversations…';
  searchBox.appendChild(searchInput);
  const results = el('div', 'fx-results');
  results.style.display = 'none';
  sessionsContainer.before(searchBox);
  sessionsContainer.after(results);

  let searchTimer = null, searchSeq = 0;
  let jump = null; // { id, q, snippet, until }

  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function highlight(text, q) {
    const safe = escapeHtml(text);
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
    return safe.replace(re, (m) => `<mark>${m}</mark>`);
  }

  function endSearch() {
    searchInput.value = '';
    results.style.display = 'none';
    results.innerHTML = '';
    sessionsContainer.style.display = '';
  }

  async function runSearch() {
    const q = searchInput.value.trim();
    if (q.length < 2) { results.style.display = 'none'; sessionsContainer.style.display = ''; return; }
    const seq = ++searchSeq;
    results.innerHTML = '';
    results.appendChild(el('div', 'fx-results-note', 'Searching…'));
    results.style.display = '';
    sessionsContainer.style.display = 'none';
    const hits = await api.searchTranscripts?.(q) || [];
    if (seq !== searchSeq) return;
    results.innerHTML = '';
    if (!hits.length) { results.appendChild(el('div', 'fx-results-note', `No messages contain “${q}” (last 60 days).`)); return; }
    results.appendChild(el('div', 'fx-results-note', `${hits.length} match${hits.length > 1 ? 'es' : ''} — click to open`));
    for (const h of hits) {
      const row = el('div', 'fx-hit');
      const top = el('div', 'fx-hit-top');
      const srcLabel = h.source === 'antigravity' ? 'Antigravity' : 'Claude';
      top.append(el('span', 'fx-hit-title', h.title || h.project || 'Conversation'),
        el('span', 'fx-hit-proj', `${srcLabel}${h.project ? ' · ' + h.project : ''}`),
        el('span', 'fx-hit-time', formatShortAgo(h.ts)));
      const snip = el('div', 'fx-hit-snip');
      snip.innerHTML = `<b>${h.role === 'user' ? 'You' : srcLabel}:</b> ${highlight(h.snippet, q)}`;
      row.append(top, snip);
      row.addEventListener('click', () => openHit(h, q));
      results.appendChild(row);
    }
  }

  searchInput.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 350); });
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { endSearch(); e.stopPropagation(); } });

  function openHit(h, q) {
    let s = sessionsList.find((x) => x.id === h.id);
    if (!s) {
      const src = h.source || (String(h.id || '').startsWith('antigravity_') ? 'antigravity' : 'claude');
      s = {
        id: h.id, sessionUuid: h.uuid, source: src, project: h.project || (src === 'antigravity' ? 'Antigravity' : 'Claude'), cwd: h.cwd || '',
        sessionTitle: h.title || h.project || '', status: 'idle', statusLabel: 'Idle', state: 'idle',
        fullContent: '', detail: '', mtime: h.ts,
      };
    }
    jump = { id: h.id, q: q.toLowerCase(), snippet: h.snippet.replace(/^…|…$/g, '').toLowerCase().replace(/\s+/g, ' '), until: Date.now() + 8000 };
    endSearch();
    showDetailView(s);
    tryJump();
  }

  // After the conversation (and its history) loads, scroll to the match
  function tryJump() {
    if (!jump) return;
    if (Date.now() > jump.until || currentActiveSession?.id !== jump.id) { jump = null; return; }
    const bubbles = [...chatStream.querySelectorAll('.chat-bubble')];
    const textOf = (b) => (b.querySelector('.bubble-content')?.textContent || '').toLowerCase().replace(/\s+/g, ' ');
    const core = jump.snippet.slice(Math.max(0, jump.snippet.indexOf(jump.q) - 20), jump.snippet.indexOf(jump.q) + jump.q.length + 20);
    const target = bubbles.find((b) => core && textOf(b).includes(core)) ||
      [...bubbles].reverse().find((b) => textOf(b).includes(jump.q));
    if (!target) return;
    jump = null;
    const delta = target.getBoundingClientRect().top - chatStream.getBoundingClientRect().top;
    chatStream.scrollTop += delta - 10;
    target.classList.add('fx-flash');
    setTimeout(() => target.classList.remove('fx-flash'), 2400);
  }
  new MutationObserver(() => { if (jump) setTimeout(tryJump, 30); }).observe(chatStream, { childList: true });

  // -------------------------------------------------------------------------
  // 3 / export: extra Settings rows
  // -------------------------------------------------------------------------
  const settingsPanelEl = $('settingsPanel');
  const restartRow = $('btnRestartApp');
  const sep = settingsPanelEl?.querySelector('.set-sep');
  function setRow(id, ico, label) {
    const b = el('button', 'set-row');
    b.id = id;
    b.append(el('span', 'set-ico', ico), el('span', 'set-label', label), el('span', 'set-check'));
    return b;
  }
  const rowNotify = setRow('btnNotify', '💬', 'Desktop notifications');
  rowNotify.title = 'Windows notification when a session finishes';
  const rowDigest = setRow('btnDigest', '📊', "Today's summary");
  rowDigest.querySelector('.set-check').remove();
  const digestBox = el('div', 'set-digest');
  digestBox.style.display = 'none';
  const rowExport = setRow('btnExport', '💾', 'Export conversation…');
  rowExport.querySelector('.set-check').remove();
  rowExport.title = 'Save this conversation as a Markdown file';
  if (settingsPanelEl) {
    (sep || restartRow)?.before(rowNotify, rowDigest, digestBox, rowExport);
  }

  ready.then(() => rowNotify.classList.toggle('active', store.notify !== false));
  rowNotify.addEventListener('click', () => {
    const on = store.notify === false; // toggling
    setStore('notify', on);
    rowNotify.classList.toggle('active', on);
  });
  rowDigest.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (digestBox.style.display !== 'none') { digestBox.style.display = 'none'; return; }
    digestBox.textContent = 'Loading…';
    digestBox.style.display = '';
    digestBox.textContent = await api.getDigest?.() || 'No data yet';
  });
  rowExport.addEventListener('click', async () => {
    closeSettingsPanel();
    const s = currentActiveSession;
    if (!s) return;
    const history = sessionChatHistory.get(s.id) || [];
    const agent = agentLabel(s.source, s.id);
    const title = (meta().names[s.id]) || s.sessionTitle || s.project || 'Conversation';
    let md = `# ${title}\n\n_${s.project || ''}${s.cwd ? ` · ${s.cwd}` : ''} · exported ${new Date().toLocaleString()}_\n\n`;
    for (const m of history) {
      const who = m.role === 'user' ? 'You' : agent;
      md += `---\n\n**${who}**${m.time ? ` _(${m.time})_` : ''}\n\n${(m.el?._md) || m.text || ''}\n\n`;
      if (m.edits?.length) {
        md += `Edited files:\n${m.edits.map((e) => `- \`${e.path}\` (+${e.added} −${e.removed})`).join('\n')}\n\n`;
      }
    }
    const saved = await api.exportConversation?.(title, md);
    if (saved) replyStatusMsg.textContent = `💾 Saved to ${saved}`;
  });

  // -------------------------------------------------------------------------
  // Hotkey / notification → open / focus
  // -------------------------------------------------------------------------
  api.onFocusInput?.(() => {
    if (!isExpanded) setExpanded(true);
    if (currentActiveSession) setTimeout(() => replyTextarea.focus(), 120);
    else setTimeout(() => searchInput.focus(), 120);
  });
  api.onOpenSession?.(({ sessionId }) => {
    const s = sessionsList.find((x) => x.id === sessionId);
    if (s) showDetailView(s);
  });

  // -------------------------------------------------------------------------
  // Tick: queue flush, Stop visibility, "which conversation am I viewing"
  // -------------------------------------------------------------------------
  let lastViewing;
  setInterval(() => {
    flushQueues();
    const s = currentActiveSession;
    btnStop.style.display = s && liveActivity.has(s.id) ? '' : 'none';
    const viewing = s && detailView.classList.contains('active') ? s.id : null;
    if (viewing !== lastViewing) { lastViewing = viewing; api.viewingSession?.(viewing); renderQueue(); }
  }, 1000);

  ready.then(() => { renderSessionCards(true); refreshCosts(); });
  setInterval(refreshCosts, 60000);
})();
