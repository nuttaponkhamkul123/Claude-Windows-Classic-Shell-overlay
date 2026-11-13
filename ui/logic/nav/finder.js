// Ctrl+K quick finder: type to jump to a chat, run an action, or find a message.
//   Chats    — by title, agent name, folder or status
//   Actions  — New chat, Settings, Notes, View, Group, Contacts
//   Messages — full-text search of the transcripts (same as the old search box)
// ↑/↓ to move, Enter to open, Esc to close. Also opened by the 🔍 key in the toolbar.
(function () {
  const api = window.electronAPI;
  const box = el('div', 'finder');
  box.style.display = 'none';
  box.innerHTML = '<div class="finder-panel" role="dialog" aria-label="Quick finder">' +
    '<input class="finder-input" type="text" spellcheck="false" placeholder="Find a chat, action or message…  (Esc to close)">' +
    '<div class="finder-list" role="listbox"></div><div class="finder-foot">↑↓ move · Enter open · Esc close</div></div>';
  document.body.appendChild(box);
  const input = box.querySelector('.finder-input');
  const list = box.querySelector('.finder-list');
  let rows = [];        // [{ el, run }]
  let sel = 0;
  let msgSeq = 0;
  let msgTimer = null;

  const click = (id) => () => document.getElementById(id)?.click();
  const ACTIONS = [
    { label: 'New chat', hint: 'Start a conversation in any folder', icon: '＋', run: click('lbNewChat') },
    { label: 'Settings', hint: 'Style, theme, chime, nudge…', icon: '⚙', run: click('lbSettings') },
    { label: 'Pinned notes', hint: 'Open the notes panel', icon: '📌', run: click('lbNotes') },
    { label: 'Contacts', hint: 'Back to the contact list', icon: '‹', run: () => { if (typeof showListView === 'function') showListView(); } },
    { label: 'Switch view (Vault / List)', hint: 'How the contact list is drawn', icon: '▦', run: click('lbView') },
    { label: 'Group by folder / status', hint: 'How chats are grouped', icon: '☰', run: click('lbGroup') },
  ];

  const norm = (t) => String(t || '').toLowerCase();
  const matches = (hay, words) => words.every((w) => hay.includes(w));

  function chatRows(words) {
    const all = typeof sessionsList !== 'undefined' ? sessionsList : [];
    return all
      .map((s) => {
        const name = typeof agentLabel === 'function' ? agentLabel(s.source, s.id) : 'Claude';
        const title = s.sessionTitle || s.aiTitle || 'Untitled chat';
        const state = s.unread || s.state === 'attention' ? 'needs you' : s.status === 'running' ? 'running' : 'idle';
        const hay = norm(`${title} ${name} ${s.project} ${state}`);
        const score = !words.length ? 0 : (norm(title).startsWith(words[0]) ? 0 : 1);
        return { s, name, title, state, hay, score };
      })
      .filter((c) => matches(c.hay, words))
      .sort((a, b) => a.score - b.score || (b.s.mtime || 0) - (a.s.mtime || 0))
      .slice(0, 8);
  }

  function addHead(text) { list.appendChild(el('div', 'finder-head', text)); }
  function addRow(icon, label, sub, run, cls = '') {
    const r = el('div', `finder-row ${cls}`);
    r.setAttribute('role', 'option');
    r.append(el('span', 'finder-ico', icon), el('span', 'finder-label', label), el('span', 'finder-sub', sub || ''));
    r.addEventListener('mousemove', () => select(rows.findIndex((x) => x.el === r)));
    r.addEventListener('click', () => { close(); run(); });
    list.appendChild(r);
    rows.push({ el: r, run });
  }

  function render() {
    const q = input.value.trim();
    const words = norm(q).split(/\s+/).filter(Boolean);
    list.textContent = '';
    rows = [];
    const chats = chatRows(words);
    if (chats.length) {
      addHead('Chats');
      for (const c of chats) {
        addRow(c.state === 'needs you' ? '❗' : c.state === 'running' ? '▶' : '●', c.title, `${c.name} · ${c.s.project || ''} · ${c.state}`,
          () => (typeof zoomIntoChat === 'function' && document.querySelector(`.vault-walker[data-sid="${CSS.escape(c.s.id)}"]`)
            ? zoomIntoChat(c.s, document.querySelector(`.vault-walker[data-sid="${CSS.escape(c.s.id)}"]`))
            : showDetailView(c.s)), `st-${c.state.replace(' ', '-')}`);
      }
    }
    const acts = ACTIONS.filter((a) => matches(norm(`${a.label} ${a.hint}`), words));
    if (acts.length) {
      addHead('Actions');
      for (const a of acts) addRow(a.icon, a.label, a.hint, a.run);
    }
    if (q.length >= 2 && api.searchTranscripts) {
      addHead('In messages');
      const note = el('div', 'finder-note', 'Searching…');
      list.appendChild(note);
      clearTimeout(msgTimer);
      const seq = ++msgSeq;
      msgTimer = setTimeout(async () => {
        const hits = (await api.searchTranscripts(q).catch(() => [])) || [];
        if (seq !== msgSeq || box.style.display === 'none') return;
        note.remove();
        if (!hits.length) { list.appendChild(el('div', 'finder-note', `No messages contain “${q}”.`)); return; }
        for (const h of hits.slice(0, 8)) {
          const who = h.role === 'user' ? 'You' : (h.source === 'antigravity' ? 'Antigravity' : 'Claude');
          addRow('💬', String(h.snippet || '').replace(/\s+/g, ' ').slice(0, 90), `${who} · ${h.title || h.project || 'Conversation'}`,
            () => window.fxOpenSearchHit?.(h, q), 'finder-msg');
        }
        select(sel);
      }, 300);
    }
    if (!rows.length && !(q.length >= 2)) list.appendChild(el('div', 'finder-note', 'Nothing matches.'));
    select(0);
  }

  function select(i) {
    if (!rows.length) return;
    sel = Math.max(0, Math.min(rows.length - 1, i));
    rows.forEach((r, k) => r.el.classList.toggle('on', k === sel));
    rows[sel].el.scrollIntoView({ block: 'nearest' });
  }

  function open() {
    box.style.display = '';
    input.value = '';
    render();
    input.focus();
  }
  function close() { box.style.display = 'none'; }
  window.openFinder = open;

  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); select(sel + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); select(sel - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = rows[sel]; if (r) { close(); r.run(); } }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    e.stopPropagation();
  });
  box.addEventListener('mousedown', (e) => { if (e.target === box) close(); });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (box.style.display === 'none') open(); else close();
    }
  });

  // 🔍 key in the contact-list toolbar (Shelter has no address-bar search)
  const toolbar = document.getElementById('listToolbar');
  if (toolbar) {
    const btn = el('button', 'tb-btn tb-find', '🔍 Find');
    btn.title = 'Find a chat, action or message (Ctrl+K)';
    btn.addEventListener('click', (e) => { e.stopPropagation(); open(); });
    const notes = document.getElementById('lbNotes');
    if (notes) notes.after(btn); else toolbar.appendChild(btn);
  }
})();
