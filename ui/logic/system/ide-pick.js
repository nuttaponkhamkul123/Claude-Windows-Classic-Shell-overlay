// IDE pickers shown in the HUD. The "HUD bridge" extension in VS Code / Antigravity
// sends any extension's pick list or text box here (main/ipc/ide-pick.js), e.g.
// abap-fs asking which transport request to use. Looks and works like Ctrl+P:
//   pick  — type to filter, ↑/↓, Enter picks; with several allowed, Space ticks and Enter confirms
//   input — type, Enter sends (the extension may reject it: its message shows and you try again)
// Esc cancels. Requests queue up and are shown one at a time.
(function () {
  const api = window.electronAPI;
  if (!api?.onIdePick) return;

  const box = el('div', 'finder ide-pick');
  box.style.display = 'none';
  box.innerHTML = '<div class="finder-panel ide-pick-panel" role="dialog" aria-label="Question from your editor">' +
    '<div class="ide-pick-head"><span class="ide-pick-src"></span><span class="ide-pick-title"></span></div>' +
    '<div class="ide-pick-prompt"></div>' +
    '<input class="finder-input ide-pick-input" type="text" spellcheck="false">' +
    '<div class="ide-pick-error" hidden></div>' +
    '<div class="finder-list ide-pick-list" role="listbox"></div>' +
    '<div class="finder-foot"></div></div>';
  document.body.appendChild(box);
  const $ = (s) => box.querySelector(s);
  const input = $('.ide-pick-input');
  const list = $('.ide-pick-list');

  const queue = [];
  let cur = null;     // the request on screen
  let rows = [];      // [{ el, index }] visible items
  let sel = 0;
  let ticked = new Set();

  function done(result) {
    if (!cur) return;
    api.answerIdePick(cur.id, result);
    cur = null;
    box.style.display = 'none';
    next();
  }

  function next() {
    if (cur || !queue.length) return;
    cur = queue.shift();
    ticked = new Set(cur.items.map((it, i) => (it.picked ? i : -1)).filter((i) => i >= 0));
    // the name comes from the extension itself, so the id (harder to fake) is shown next to it
    const sid = cur.source?.id;
    $('.ide-pick-src').textContent = (cur.source?.name || 'Your editor') + (sid && sid !== 'unknown' ? ` (${sid})` : '');
    $('.ide-pick-title').textContent = cur.title || (cur.kind === 'input' ? 'needs some text' : 'asks you to pick');
    const prompt = cur.kind === 'input' ? cur.prompt : '';
    $('.ide-pick-prompt').textContent = prompt;
    $('.ide-pick-prompt').hidden = !prompt;
    showError(cur.validationMessage);
    input.type = cur.kind === 'input' && cur.password ? 'password' : 'text';
    input.value = cur.kind === 'input' ? (cur.value || '') : '';
    input.placeholder = cur.placeHolder || (cur.kind === 'input' ? 'Type here…' : 'Type to filter…');
    list.hidden = cur.kind === 'input';
    $('.finder-foot').textContent = cur.kind === 'input' ? 'Enter send · Esc cancel'
      : cur.canPickMany ? '↑↓ move · Space tick · Enter OK · Esc cancel' : '↑↓ move · Enter pick · Esc cancel';
    box.style.display = '';
    draw();
    try { window.soundSynth?.playAttention?.(); } catch (_) {}
    requestAnimationFrame(() => { input.focus(); input.select(); });
  }

  function showError(msg) {
    const e = $('.ide-pick-error');
    e.textContent = msg || '';
    e.hidden = !msg;
  }

  // simple fuzzy match: every typed word appears in the label / description / detail
  function matches(it, q) {
    if (!q) return true;
    const hay = `${it.label} ${it.description} ${it.detail}`.toLowerCase();
    return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
  }

  function draw() {
    if (!cur || cur.kind === 'input') return;
    const q = input.value.trim();
    list.textContent = '';
    rows = [];
    let pendingSep = null;
    cur.items.forEach((it, i) => {
      if (it.separator) { pendingSep = it.label; return; }
      if (!matches(it, q)) return;
      if (pendingSep != null && !q) {
        const h = el('div', 'finder-head', pendingSep || '');
        list.appendChild(h);
      }
      pendingSep = null;
      const r = el('div', 'finder-row ide-pick-row');
      r.setAttribute('role', 'option');
      const ico = el('span', 'finder-ico', cur.canPickMany ? (ticked.has(i) ? '☑' : '☐') : '›');
      const label = el('span', 'finder-label');
      label.textContent = it.label;
      if (it.description) label.appendChild(el('span', 'ide-pick-desc', ' ' + it.description));
      r.append(ico, label);
      if (it.detail) r.appendChild(el('span', 'finder-sub', it.detail));
      r.title = [it.label, it.description, it.detail].filter(Boolean).join('\n');
      r.addEventListener('mousedown', (e) => e.preventDefault()); // keep the focus in the input so Esc and the arrows keep working
      r.addEventListener('mousemove', () => select(rows.findIndex((x) => x.el === r)));
      r.addEventListener('click', () => (cur.canPickMany ? toggle(i) : done({ index: i })));
      list.appendChild(r);
      rows.push({ el: r, index: i });
    });
    if (!rows.length) list.appendChild(el('div', 'finder-note', q ? 'No match.' : 'Nothing to pick.'));
    select(Math.min(sel, rows.length - 1));
  }

  function select(i) {
    if (i < 0 || !rows.length) { sel = 0; return; }
    rows[sel]?.el.classList.remove('on');
    sel = i;
    rows[sel].el.classList.add('on');
    rows[sel].el.scrollIntoView({ block: 'nearest' });
  }

  function toggle(i) {
    if (ticked.has(i)) ticked.delete(i); else ticked.add(i);
    draw();
  }

  input.addEventListener('input', () => { sel = 0; draw(); if (cur?.kind === 'input') showError(''); });
  input.addEventListener('keydown', (e) => {
    if (!cur) return;
    if (e.key === 'Escape') { e.preventDefault(); done({ cancelled: true }); return; }
    if (cur.kind === 'input') {
      if (e.key === 'Enter') { e.preventDefault(); done({ value: input.value }); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); select(Math.min(rows.length - 1, sel + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); select(Math.max(0, sel - 1)); }
    else if (e.key === ' ' && cur.canPickMany && rows[sel]) { e.preventDefault(); toggle(rows[sel].index); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (cur.canPickMany) done({ indices: [...ticked].sort((a, b) => a - b) });
      else if (rows[sel]) done({ index: rows[sel].index });
    }
  });
  // clicking the dimmed backdrop cancels, like Esc
  box.addEventListener('mousedown', (e) => { if (e.target === box) done({ cancelled: true }); });

  api.onIdePick((req) => { queue.push(req); next(); });
  api.onIdePickCancel(({ id }) => {
    const qi = queue.findIndex((r) => r.id === id);
    if (qi >= 0) queue.splice(qi, 1);
    if (cur?.id === id) { cur = null; box.style.display = 'none'; next(); }
  });
})();
