// Pinned-notes panel (docked left of the HUD). Data comes from main/notes.js.
(function () {
  const api = window.notesAPI;
  const $ = (id) => document.getElementById(id);
  const list = $('npList');
  const filter = $('npFilter');
  const open = new Set(); // expanded note ids
  let notes = [];
  let flashId = null;

  const theme = api.settings.theme || 'aero';
  document.body.classList.add(theme === 'vista' || theme === 'dark' ? 'np-dark' : 'np-light');

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

  function draw() {
    const q = filter.value.trim().toLowerCase();
    const shown = notes.filter((n) => !q || `${n.title} ${n.project} ${n.tags.join(' ')} ${n.body}`.toLowerCase().includes(q));
    $('npCount').textContent = notes.length ? String(notes.length) : '';
    $('npEmpty').hidden = notes.length > 0;
    list.textContent = '';
    for (const n of shown) {
      const card = el('div', 'np-card' + (open.has(n.id) ? ' open' : '') + (n.id === flashId ? ' flash' : ''));
      card.dataset.id = n.id;

      const top = el('div', 'np-card-top');
      top.append(el('span', 'np-caret', open.has(n.id) ? '▾' : '▸'), el('span', 'np-card-title', n.title));
      top.title = n.cwd || n.title;
      top.addEventListener('click', () => { open.has(n.id) ? open.delete(n.id) : open.add(n.id); draw(); });
      card.appendChild(top);

      const meta = el('div', 'np-meta');
      if (n.project) meta.appendChild(el('span', 'np-proj', n.project));
      for (const t of n.tags) meta.appendChild(el('span', 'np-tag', '#' + t));
      meta.appendChild(el('span', 'np-when', ago(n.pinned)));
      card.appendChild(meta);

      if (open.has(n.id)) {
        const body = el('div', 'np-body');
        body.appendChild(renderMd(n.body));
        card.appendChild(body);
      } else {
        const peek = n.body.replace(/[#>*`_\-\[\]]/g, '').replace(/\s+/g, ' ').trim();
        card.appendChild(el('div', 'np-peek', peek.slice(0, 140) + (peek.length > 140 ? '…' : '')));
      }

      const acts = el('div', 'np-acts');
      const btn = (label, title, fn) => {
        const b = el('button', 'np-btn', label);
        b.title = title;
        b.addEventListener('click', (e) => { e.stopPropagation(); fn(b); });
        acts.appendChild(b);
      };
      btn('📋 Copy', 'Copy the Markdown', async (b) => { if (await api.copy(n.id)) { b.textContent = '✓ Copied'; setTimeout(() => (b.textContent = '📋 Copy'), 1200); } });
      btn('📝 Open', 'Open the .md file in your editor', () => api.openFile(n.id));
      let armed = false;
      btn('Unpin', 'Remove from the panel (the file is kept in .unpinned)', async (b) => {
        if (!armed) { armed = true; b.textContent = 'Sure?'; b.classList.add('danger'); setTimeout(() => { armed = false; b.textContent = 'Unpin'; b.classList.remove('danger'); }, 2500); return; }
        await api.unpin(n.id);
      });
      card.appendChild(acts);
      list.appendChild(card);
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
    list.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    setTimeout(() => { flashId = null; list.querySelector('.np-card.flash')?.classList.remove('flash'); }, 2200);
  });
  setInterval(() => { if (notes.length) draw(); }, 60000); // refresh "x min ago"
  load();
})();
