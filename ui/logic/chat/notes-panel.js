// Pinned notes: the Markdown notes Claude pins with the pin_note tool. A panel that slides in from the right
// (like the Steps and git panels). Data comes from main/notes.js (~/.ovly-claude/notes/*.md); a NEW note opens
// the panel on it. Notes are grouped by workspace; a workspace with several notes rests as a deck of cards.
//   window.toggleNotes()   window.openNotes(noteId?)   window.closeNotes()
// Note text is written by an AI: it goes through marked, which safe-markdown.js cleans (no scripts, handlers,
// remote images or forms).
(function () {
  const api = window.electronAPI;
  if (!api?.notesList) return;

  const mk = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  function ago(iso) {
    const t = Date.parse(iso);
    if (!t) return '';
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return new Date(t).toLocaleDateString();
  }
  function renderMd(md) {
    const html = window.marked ? window.marked.parse(md) : md.replace(/[&<]/g, (c) => (c === '&' ? '&amp;' : '&lt;'));
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    tpl.content.querySelectorAll('a').forEach((a) => { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noreferrer'); });
    return tpl.content;
  }

  // ---- skeleton ----
  const backdrop = mk('div', 'np-backdrop');
  const panel = mk('aside', 'np-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Pinned notes');
  panel.tabIndex = -1;
  const head = mk('header', 'np-head');
  const titleBox = mk('div', 'np-titlebox');
  const title = mk('div', 'np-title', 'Pinned notes');
  const sub = mk('div', 'np-sub');
  titleBox.append(title, sub);
  const btnFolder = mk('button', 'np-btn', 'Folder');
  btnFolder.title = 'Open the notes folder';
  const btnClose = mk('button', 'np-btn np-icon', '✕');
  btnClose.title = 'Close (Esc)';
  head.append(titleBox, btnFolder, btnClose);
  const bar = mk('div', 'np-bar');
  const filter = mk('input', 'np-filter');
  filter.type = 'text';
  filter.placeholder = 'Filter notes…';
  filter.spellcheck = false;
  bar.appendChild(filter);
  const list = mk('div', 'np-list');
  const empty = mk('div', 'np-empty');
  empty.hidden = true;
  empty.append(mk('b', null, 'No pinned notes yet'), (() => {
    const p = mk('p');
    p.append('Ask Claude in any chat: ', mk('i', null, '"pin this as a note"'), '.', document.createElement('br'), 'It saves Markdown here with the ', mk('code', null, 'pin_note'), ' tool.');
    return p;
  })());
  // reader: one note, full size, in the panel
  const reader = mk('div', 'np-reader');
  reader.hidden = true;
  const rbar = mk('div', 'np-reader-bar');
  const rBack = mk('button', 'np-btn', '‹ Notes');
  rBack.title = 'Back to all notes (Esc)';
  const rTitle = mk('div', 'np-reader-title');
  const rModes = mk('div', 'np-modes');
  const rPreview = mk('button', 'np-btn np-mode on', 'Preview');
  const rSource = mk('button', 'np-btn np-mode', 'Markdown');
  rModes.append(rPreview, rSource);
  const rCopy = mk('button', 'np-btn', 'Copy');
  rbar.append(rBack, rTitle, rModes, rCopy);
  const rMeta = mk('div', 'np-reader-meta');
  const rBody = mk('div', 'np-reader-body');
  reader.append(rbar, rMeta, rBody);
  panel.append(head, bar, list, empty, reader);
  document.body.append(backdrop, panel);

  // ---- state ----
  const open = new Set();    // expanded note ids
  const spread = new Set();  // workspaces whose cards are dealt out
  let notes = [];
  let flashId = null;
  const isOpen = () => document.body.classList.contains('np-open');
  const groupKey = (n) => n.project || 'Other';

  // ---- one note card ----
  function buildCard(n) {
    const card = mk('div', 'np-card' + (open.has(n.id) ? ' open' : '') + (n.id === flashId ? ' flash' : ''));
    card.dataset.id = n.id;
    const top = mk('div', 'np-card-top');
    top.append(mk('span', 'np-caret', open.has(n.id) ? '▾' : '▸'), mk('span', 'np-card-title', n.title));
    top.title = n.cwd || n.title;
    top.addEventListener('click', (e) => {
      if (card.closest('.np-stack.stacked')) return; // the deck handles the click
      e.stopPropagation();
      open.has(n.id) ? open.delete(n.id) : open.add(n.id);
      draw();
    });
    card.appendChild(top);

    const meta = mk('div', 'np-meta');
    for (const t of n.tags) meta.appendChild(mk('span', 'np-tag', '#' + t));
    meta.appendChild(mk('span', 'np-when', ago(n.pinned)));
    card.appendChild(meta);

    if (open.has(n.id)) {
      const body = mk('div', 'np-body');
      body.appendChild(renderMd(n.body));
      card.appendChild(body);
    } else {
      // plain-text preview: drop list bullets and Markdown marks (keep "_": it is in names like DATABASE_URL)
      const peek = n.body.replace(/^\s*([-*+]|\d+\.)\s+/gm, '').replace(/[#>*`[\]]/g, '').replace(/\s+/g, ' ').trim();
      card.appendChild(mk('div', 'np-peek', peek.slice(0, 160) + (peek.length > 160 ? '…' : '')));
    }

    const acts = mk('div', 'np-acts');
    const btn = (label, hint, fn) => {
      const b = mk('button', 'np-btn', label);
      b.title = hint;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(b); });
      acts.appendChild(b);
    };
    btn('Copy', 'Copy the Markdown', async (b) => { if (await api.notesCopy(n.id)) { b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1200); } });
    btn('Open', 'Read the whole note here', () => openReader(n.id));
    let armed = false;
    btn('Unpin', 'Remove from the panel (the file is kept in .unpinned)', async (b) => {
      if (!armed) { armed = true; b.textContent = 'Sure?'; b.classList.add('danger'); setTimeout(() => { armed = false; b.textContent = 'Unpin'; b.classList.remove('danger'); }, 2500); return; }
      await api.notesUnpin(n.id);
    });
    card.appendChild(acts);
    return card;
  }

  // Deal out / gather a deck with a slide: remember where each card was, redraw, then animate every card from
  // its old spot to its new one.
  function toggleGroup(key) {
    const sel = `.np-group[data-key="${CSS.escape(key)}"] .np-card`;
    const before = new Map();
    list.querySelectorAll(sel).forEach((c) => before.set(c.dataset.id, c.getBoundingClientRect()));
    spread.has(key) ? spread.delete(key) : spread.add(key);
    draw();
    const opening = spread.has(key);
    list.querySelectorAll(sel).forEach((c, i) => {
      const old = before.get(c.dataset.id);
      if (!old) return;
      const now = c.getBoundingClientRect();
      const dy = old.top - now.top;
      const sx = old.width / (now.width || 1);
      if (Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01) return;
      c.animate([
        { transform: `translateY(${dy}px) scale(${sx})`, opacity: opening && i > 2 ? 0 : 1 },
        { transform: 'none', opacity: 1 },
      ], { duration: 260 + Math.min(i, 6) * 45, easing: 'cubic-bezier(.2,.8,.3,1)' });
    });
  }

  function draw() {
    const q = filter.value.trim().toLowerCase();
    const shown = notes.filter((n) => !q || `${n.title} ${n.project} ${n.tags.join(' ')} ${n.body}`.toLowerCase().includes(q));
    sub.textContent = notes.length ? `${notes.length} note${notes.length === 1 ? '' : 's'}${q ? ` · ${shown.length} match` : ''}` : '';
    empty.hidden = notes.length > 0;
    bar.hidden = !notes.length;
    list.hidden = !notes.length;
    const keepTop = list.scrollTop;
    list.textContent = '';
    const groups = new Map();
    for (const n of shown) {
      const k = groupKey(n);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(n); // already newest first
    }
    if (notes.length && !shown.length) list.appendChild(mk('div', 'np-nomatch', 'No note matches.'));
    for (const [key, items] of groups) {
      const dealt = spread.has(key) || items.length === 1 || !!q; // searching shows every match
      const g = mk('div', 'np-group');
      g.dataset.key = key;
      const gh = mk('div', 'np-group-head' + (dealt ? ' open' : ''));
      gh.append(mk('span', 'np-group-caret', dealt ? '▾' : '▸'), mk('span', 'np-group-name', key), mk('span', 'np-group-count', `${items.length} note${items.length === 1 ? '' : 's'}`));
      gh.title = items[0].cwd || key;
      if (items.length > 1 && !q) gh.addEventListener('click', () => toggleGroup(key));
      else gh.classList.add('static');
      g.appendChild(gh);
      const stack = mk('div', 'np-stack ' + (dealt ? 'dealt' : 'stacked'));
      stack.style.setProperty('--peek', String(Math.min(items.length, 3) - 1));
      items.forEach((n, i) => {
        const c = buildCard(n);
        if (!dealt) c.style.setProperty('--i', String(i));
        stack.appendChild(c);
      });
      if (!dealt) {
        stack.title = `${items.length} notes: click to spread them out`;
        stack.addEventListener('click', () => toggleGroup(key));
      }
      g.appendChild(stack);
      list.appendChild(g);
    }
    list.scrollTop = keepTop;
  }

  // ---- reader ----
  let reading = null;     // id of the note being read
  let readMode = 'preview';
  function drawReader() {
    const n = notes.find((x) => x.id === reading);
    if (!n) { closeReader(); return; }
    rTitle.textContent = n.title;
    rTitle.title = n.cwd || n.title;
    rMeta.textContent = '';
    if (n.project) rMeta.appendChild(mk('span', 'np-reader-proj', n.project));
    for (const t of n.tags) rMeta.appendChild(mk('span', 'np-tag', '#' + t));
    rMeta.appendChild(mk('span', 'np-when', ago(n.pinned)));
    rPreview.classList.toggle('on', readMode === 'preview');
    rSource.classList.toggle('on', readMode === 'source');
    const keep = rBody.scrollTop;
    rBody.textContent = '';
    if (readMode === 'source') rBody.appendChild(mk('pre', 'np-source', n.body));
    else { const b = mk('div', 'np-body np-body-full'); b.appendChild(renderMd(n.body)); rBody.appendChild(b); }
    rBody.scrollTop = keep;
  }
  function openReader(id) {
    reading = id;
    panel.classList.add('np-reading');
    reader.hidden = false;
    rBody.scrollTop = 0;
    drawReader();
  }
  function closeReader() {
    reading = null;
    panel.classList.remove('np-reading');
    reader.hidden = true;
    draw();
  }
  rBack.addEventListener('click', closeReader);
  rPreview.addEventListener('click', () => { readMode = 'preview'; drawReader(); });
  rSource.addEventListener('click', () => { readMode = 'source'; drawReader(); });
  rCopy.addEventListener('click', async () => { if (reading && await api.notesCopy(reading)) { rCopy.textContent = 'Copied'; setTimeout(() => { rCopy.textContent = 'Copy'; }, 1200); } });

  async function load() {
    try { notes = (await api.notesList()) || []; } catch (_) { notes = []; }
    if (reading) drawReader(); else draw();
  }

  // ---- open / close ----
  function setOpen(on) {
    if (!on && reading) { reading = null; panel.classList.remove('np-reading'); reader.hidden = true; }
    document.body.classList.toggle('np-open', on);
    window.paintNotesButtons?.();
    if (on) { load(); setTimeout(() => (filter.hidden ? panel : filter).focus?.(), 60); }
  }
  async function openNotes(focusId) {
    setOpen(true);
    if (!focusId) return;
    if (reading) closeReader();
    flashId = focusId;
    open.add(focusId);
    await load();
    const fresh = notes.find((x) => x.id === focusId);
    if (fresh && !spread.has(groupKey(fresh))) { spread.add(groupKey(fresh)); draw(); }
    list.querySelector(`[data-id="${CSS.escape(focusId)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    setTimeout(() => { flashId = null; list.querySelector('.np-card.flash')?.classList.remove('flash'); }, 2200);
  }
  window.openNotes = openNotes;
  window.closeNotes = () => setOpen(false);
  window.toggleNotes = () => (isOpen() ? setOpen(false) : openNotes());

  backdrop.addEventListener('click', () => setOpen(false));
  btnClose.addEventListener('click', () => setOpen(false));
  btnFolder.addEventListener('click', () => api.notesOpenFolder());
  filter.addEventListener('input', draw);
  filter.addEventListener('keydown', (e) => { if (e.key === 'Escape' && filter.value) { e.stopPropagation(); filter.value = ''; draw(); } });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !isOpen() || (e.target === filter && filter.value)) return;
    if (reading) closeReader(); else setOpen(false); // Esc: out of the reader first, then close
  }, true);
  api.onNotesChanged(() => { if (isOpen()) load(); });
  api.onNotesNew(({ id }) => openNotes(id)); // Claude pinned something: show it
  uiInterval(() => { if (isOpen() && notes.length) draw(); }, 60000); // "x min ago"
})();
