// Pinned-notes panel (docked left of the HUD). Data comes from main/notes.js.
(function () {
  const api = window.notesAPI;
  const $ = (id) => document.getElementById(id);
  const list = $('npList');
  const filter = $('npFilter');
  const open = new Set(); // expanded note ids
  let notes = [];
  let flashId = null;

  function applyTheme(theme) {
    const dark = theme === 'vista' || theme === 'dark';
    document.body.classList.toggle('np-dark', dark);
    document.body.classList.toggle('np-light', !dark);
  }
  applyTheme(api.settings.theme || 'aero');
  api.onTheme?.(applyTheme);

  const el = (tag, cls, text) => {
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
  // Markdown → HTML, then strip anything active (CSP blocks scripts anyway)
  function renderMd(md) {
    const html = window.marked ? window.marked.parse(md) : md.replace(/[&<]/g, (c) => (c === '&' ? '&amp;' : '&lt;'));
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    tpl.content.querySelectorAll('script, iframe, object, embed, form, style, link, meta').forEach((n) => n.remove());
    tpl.content.querySelectorAll('*').forEach((n) => {
      for (const a of [...n.attributes]) {
        if (/^on/i.test(a.name) || (/^(href|src)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) n.removeAttribute(a.name);
      }
      if (n.tagName === 'A') { n.setAttribute('target', '_blank'); n.setAttribute('rel', 'noreferrer'); }
      if (n.tagName === 'INPUT') n.setAttribute('disabled', ''); // task-list checkboxes
    });
    return tpl.content;
  }

  // ---- one note card ----
  function buildCard(n) {
    const card = el('div', 'np-card' + (open.has(n.id) ? ' open' : '') + (n.id === flashId ? ' flash' : ''));
    card.dataset.id = n.id;

    const top = el('div', 'np-card-top');
    top.append(el('span', 'np-caret', open.has(n.id) ? '▾' : '▸'), el('span', 'np-card-title', n.title));
    top.title = n.cwd || n.title;
    top.addEventListener('click', (e) => {
      if (card.closest('.np-stack.stacked')) return; // the deck handles the click
      e.stopPropagation();
      open.has(n.id) ? open.delete(n.id) : open.add(n.id);
      draw();
    });
    card.appendChild(top);

    const meta = el('div', 'np-meta');
    for (const t of n.tags) meta.appendChild(el('span', 'np-tag', '#' + t));
    meta.appendChild(el('span', 'np-when', ago(n.pinned)));
    card.appendChild(meta);

    if (open.has(n.id)) {
      const body = el('div', 'np-body');
      body.appendChild(renderMd(n.body));
      card.appendChild(body);
    } else {
      // plain-text preview: drop list bullets and Markdown marks (keep "_" — it's in names like DATABASE_URL)
      const peek = n.body.replace(/^\s*([-*+]|\d+\.)\s+/gm, '').replace(/[#>*`[\]]/g, '').replace(/\s+/g, ' ').trim();
      card.appendChild(el('div', 'np-peek', peek.slice(0, 140) + (peek.length > 140 ? '…' : '')));
    }

    const acts = el('div', 'np-acts');
    const btn = (label, title, fn) => {
      const bt = el('button', 'np-btn', label);
      bt.title = title;
      bt.addEventListener('click', (e) => { e.stopPropagation(); fn(bt); });
      acts.appendChild(bt);
    };
    btn('📋 Copy', 'Copy the Markdown', async (bt) => { if (await api.copy(n.id)) { bt.textContent = '✓ Copied'; setTimeout(() => (bt.textContent = '📋 Copy'), 1200); } });
    btn('📝 Open', 'Open the .md file in your editor', () => api.openFile(n.id));
    let armed = false;
    btn('Unpin', 'Remove from the panel (the file is kept in .unpinned)', async (bt) => {
      if (!armed) { armed = true; bt.textContent = 'Sure?'; bt.classList.add('danger'); setTimeout(() => { armed = false; bt.textContent = 'Unpin'; bt.classList.remove('danger'); }, 2500); return; }
      await api.unpin(n.id);
    });
    card.appendChild(acts);
    return card;
  }

  // ---- notes grouped by workspace; each group rests as a deck of cards ----
  const spread = new Set(); // workspaces whose cards are dealt out
  const groupKey = (n) => n.project || 'Other';

  // Deal out / gather a deck with a slide: remember where each card was,
  // redraw, then animate every card from its old spot to its new one (FLIP).
  function toggleGroup(key) {
    const before = new Map();
    list.querySelectorAll(`.np-group[data-key="${CSS.escape(key)}"] .np-card`).forEach((c) => before.set(c.dataset.id, c.getBoundingClientRect()));
    spread.has(key) ? spread.delete(key) : spread.add(key);
    draw();
    const opening = spread.has(key);
    list.querySelectorAll(`.np-group[data-key="${CSS.escape(key)}"] .np-card`).forEach((c, i) => {
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
    $('npCount').textContent = notes.length ? String(notes.length) : '';
    $('npEmpty').hidden = notes.length > 0;
    list.textContent = '';

    const groups = new Map();
    for (const n of shown) {
      const k = groupKey(n);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(n); // already newest first
    }
    // workspace with the newest note first
    for (const [key, items] of groups) {
      const dealt = spread.has(key) || items.length === 1 || !!q; // searching shows every match
      const g = el('div', 'np-group');
      g.dataset.key = key;

      const head = el('div', 'np-group-head' + (dealt ? ' open' : ''));
      head.append(
        el('span', 'np-group-caret', dealt ? '▾' : '▸'),
        el('span', 'np-group-name', key),
        el('span', 'np-group-count', `${items.length} note${items.length === 1 ? '' : 's'}`),
      );
      head.title = items[0].cwd || key;
      if (items.length > 1 && !q) head.addEventListener('click', () => toggleGroup(key));
      else head.classList.add('static');
      g.appendChild(head);

      const stack = el('div', 'np-stack ' + (dealt ? 'dealt' : 'stacked'));
      stack.style.setProperty('--peek', String(Math.min(items.length, 3) - 1));
      items.forEach((n, i) => {
        const c = buildCard(n);
        if (!dealt) c.style.setProperty('--i', String(i));
        stack.appendChild(c);
      });
      if (!dealt) {
        stack.title = `${items.length} notes — click to spread them out`;
        stack.addEventListener('click', () => toggleGroup(key));
      }
      g.appendChild(stack);
      list.appendChild(g);
    }
  }

  async function load() {
    try { notes = (await api.list()) || []; } catch (_) { notes = []; }
    draw();
  }

  filter.addEventListener('input', draw);
  filter.addEventListener('keydown', (e) => { if (e.key === 'Escape') { filter.value = ''; draw(); } });
  $('npClose').addEventListener('click', () => api.close());
  $('npFolder').addEventListener('click', () => api.openFolder());
  api.onChanged(load);
  api.onFocus(async (id) => {
    flashId = id;
    open.add(id);
    await load();
    const fresh = notes.find((x) => x.id === id);
    if (fresh && !spread.has(groupKey(fresh))) { spread.add(groupKey(fresh)); draw(); }
    list.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    setTimeout(() => { flashId = null; list.querySelector('.np-card.flash')?.classList.remove('flash'); }, 2200);
  });
  setInterval(() => { if (notes.length) draw(); }, 60000); // refresh "x min ago"
  load();
})();
