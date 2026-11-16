// Git changes panel: click the git box in the chat header → a panel slides in
// from the right with every changed file (vs HEAD, plus untracked files) and
// the diff of the selected one. Tick files (or right-click a file / folder) to
// Commit (message drafted by Claude if you like, optional push) or Discard
// (backed up, with Undo). Nothing changes until you confirm in a dialog.
//   window.openGitDiff(cwd, branch)
(function () {
  const api = window.electronAPI;
  if (!api?.gitChanges || !api?.gitFileDiff) return;

  const MAX_ROWS = 4000; // diff lines drawn per file
  const KIND = {
    modified: ['M', 'Modified'], added: ['A', 'Added'], deleted: ['D', 'Deleted'],
    renamed: ['R', 'Renamed'], untracked: ['U', 'New file (untracked)'],
  };
  const mk = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const baseName = (p) => p.split('/').pop();
  const dirName = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };

  // ---- skeleton ----
  const backdrop = mk('div', 'gd-backdrop');
  const panel = mk('aside', 'gd-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Git changes');
  panel.tabIndex = -1;

  const head = mk('header', 'gd-head');
  const titleBox = mk('div', 'gd-titlebox');
  const title = mk('div', 'gd-title', 'Changes');
  const sub = mk('div', 'gd-sub');
  titleBox.append(title, sub);
  const btnCopy = mk('button', 'gd-btn', 'Copy branch');
  btnCopy.title = 'Copy the branch name';
  const btnRefresh = mk('button', 'gd-btn gd-icon', '↻');
  btnRefresh.title = 'Refresh';
  const btnClose = mk('button', 'gd-btn gd-icon', '✕');
  btnClose.title = 'Close (Esc)';
  head.append(titleBox, btnCopy, btnRefresh, btnClose);

  const body = mk('div', 'gd-body');
  const listCol = mk('div', 'gd-listcol'); // file tree + the Commit / Discard bar under it
  const list = mk('div', 'gd-files');
  const actionBar = mk('div', 'gd-actions');
  listCol.append(list, actionBar);
  const view = mk('div', 'gd-view');
  body.append(listCol, view);
  panel.append(head, body);
  document.body.append(backdrop, panel);

  let state = { cwd: '', branch: '', top: '', files: [], selected: '' };
  let loadSeq = 0;

  // ---- file list as a folder tree ----
  // Folders first, then files, A→Z. A folder that only holds one folder is
  // merged with it ("ui/logic/nav"), like VS Code. Folders can be collapsed
  // (remembered while the app runs); ↑/↓ follow what's visible.
  const collapsed = new Set();
  let visibleOrder = [];
  function buildTree(files) {
    const root = { name: '', dirs: new Map(), files: [] };
    for (const f of files) {
      const parts = f.path.split('/');
      let node = root;
      for (const p of parts.slice(0, -1)) {
        if (!node.dirs.has(p)) node.dirs.set(p, { name: p, dirs: new Map(), files: [] });
        node = node.dirs.get(p);
      }
      node.files.push(f);
    }
    return root;
  }
  function totals(node) {
    let a = 0, r = 0, n = 0;
    for (const f of node.files) { a += f.added || 0; r += f.removed || 0; n++; }
    for (const d of node.dirs.values()) { const t = totals(d); a += t.a; r += t.r; n += t.n; }
    return { a, r, n };
  }
  const INDENT = 14;

  // ---- tick boxes: which files to commit / discard ----
  const ticked = new Set(); // file paths
  const under = (key) => state.files.filter((f) => f.path.startsWith(key + '/'));
  function checkBox(on, partial) {
    const c = mk('span', 'gd-check' + (on ? ' on' : '') + (partial ? ' part' : ''));
    c.setAttribute('role', 'checkbox');
    c.setAttribute('aria-checked', partial ? 'mixed' : String(on));
    c.innerHTML = '<svg viewBox="0 0 12 12" width="10" height="10"><path d="M2.2 6.3l2.4 2.4 5-5.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '<i class="gd-check-dash"></i>';
    return c;
  }
  function paintChecks() {
    for (const r of list.querySelectorAll('.gd-file')) {
      const on = ticked.has(r.dataset.path);
      const c = r.querySelector('.gd-check');
      c.classList.toggle('on', on); c.classList.remove('part'); c.setAttribute('aria-checked', String(on));
    }
    for (const r of list.querySelectorAll('.gd-folder')) {
      const fs_ = under(r.dataset.key);
      const n = fs_.filter((f) => ticked.has(f.path)).length;
      const c = r.querySelector('.gd-check');
      c.classList.toggle('on', n > 0 && n === fs_.length); c.classList.toggle('part', n > 0 && n < fs_.length);
      c.setAttribute('aria-checked', n > 0 && n < fs_.length ? 'mixed' : String(n > 0));
    }
    updateActions();
  }
  function fileRow(f, depth) {
    const row = mk('button', 'gd-file');
    row.dataset.path = f.path;
    row.style.paddingLeft = `${30 + depth * INDENT + 16}px`; // 22px tick column + chevron column, so names line up with folder names
    const tick = checkBox(ticked.has(f.path));
    tick.title = 'Include in Commit / Discard';
    tick.addEventListener('click', (e) => { e.stopPropagation(); if (ticked.has(f.path)) ticked.delete(f.path); else ticked.add(f.path); paintChecks(); });
    row.append(tick);
    const [letter, label] = KIND[f.kind] || ['M', 'Modified'];
    const badge = mk('span', `gd-badge gd-${f.kind}`, letter);
    badge.title = label + (f.staged ? ' · staged' : '');
    const names = mk('span', 'gd-names');
    names.append(mk('span', 'gd-name', baseName(f.path)));
    const stats = mk('span', 'gd-stats');
    if (f.binary) stats.append(mk('span', 'gd-dim', 'binary'));
    else if (f.large) stats.append(mk('span', 'gd-dim', 'large'));
    else {
      if (f.added) stats.append(mk('span', 'gd-add', `+${f.added}`));
      if (f.removed) stats.append(mk('span', 'gd-del', `−${f.removed}`));
    }
    row.title = f.from ? `${f.from} → ${f.path}` : f.path;
    row.append(badge, names, stats);
    row.addEventListener('click', () => select(f.path));
    row.addEventListener('contextmenu', (e) => showMenu(e, row, fileMenu(f)));
    return row;
  }

  // ---- right-click menu: "Explain this change" / "Explain this folder's changes" ----
  const menu = mk('div', 'gd-menu');
  menu.setAttribute('role', 'menu');
  panel.append(menu);
  let menuFor = null;
  function hideMenu() {
    menu.classList.remove('show');
    menuFor?.classList.remove('gd-menu-for');
    menuFor = null;
  }
  function showMenu(e, row, items) {
    e.preventDefault();
    e.stopPropagation();
    hideMenu();
    menu.innerHTML = '';
    for (const it of items) {
      if (it === '-') { menu.append(mk('div', 'gd-menu-sep')); continue; }
      const b = mk('button', 'gd-menu-item' + (it.primary ? ' primary' : '') + (it.danger ? ' danger' : ''));
      b.setAttribute('role', 'menuitem');
      b.append(mk('span', 'gd-menu-ico', it.icon || ''), mk('span', 'gd-menu-label', it.label));
      if (it.hint) b.append(mk('span', 'gd-menu-hint', it.hint));
      b.disabled = !!it.disabled;
      if (it.title) b.title = it.title;
      b.addEventListener('click', (ev) => { ev.stopPropagation(); hideMenu(); it.run(); });
      menu.append(b);
    }
    menuFor = row;
    row.classList.add('gd-menu-for');
    // place at the pointer, kept inside the panel
    const pr = panel.getBoundingClientRect();
    menu.classList.add('show');
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = `${Math.max(6, Math.min(e.clientX - pr.left, pr.width - mw - 6))}px`;
    menu.style.top = `${Math.max(6, Math.min(e.clientY - pr.top, pr.height - mh - 6))}px`;
    menu.querySelector('.gd-menu-item:not(:disabled)')?.focus();
  }
  document.addEventListener('mousedown', (e) => { if (menuFor && !menu.contains(e.target)) hideMenu(); }, true);
  list.addEventListener('scroll', hideMenu);
  window.addEventListener('blur', hideMenu);

  const chatIsOpen = () => !!(typeof currentActiveSession !== 'undefined' && currentActiveSession &&
    document.getElementById('detailView')?.classList.contains('active'));
  const KIND_WORD = { modified: 'modified', added: 'added', deleted: 'deleted', renamed: 'renamed', untracked: 'new, not committed yet' };
  const counts = (f) => (f.binary ? 'binary' : f.large ? 'large file' : `+${f.added || 0} −${f.removed || 0}`);
  const gitCmd = (rel) => `git -C "${state.top}" diff HEAD -- "${rel}"`;

  function explainFilePrompt(f) {
    if (f.kind === 'untracked') {
      return `Explain this new file: \`${f.path}\` (untracked, ${counts(f)}).\n` +
        `Read it and tell me what it does, how it fits into the rest of the project, and anything risky or unfinished.`;
    }
    const what = f.kind === 'deleted' ? 'deletion' : f.kind === 'renamed' ? `rename (from \`${f.from}\`)` : 'change';
    return `Explain this ${what}: \`${f.path}\` (${KIND_WORD[f.kind] || f.kind}, ${counts(f)}, uncommitted).\n` +
      `Run \`${gitCmd(f.path)}\` to see it, then tell me what changed, why it was probably done, and anything risky.`;
  }
  function explainFolderPrompt(key) {
    const inside = state.files.filter((f) => f.path.startsWith(key + '/'));
    const a = inside.reduce((n, f) => n + (f.added || 0), 0), r = inside.reduce((n, f) => n + (f.removed || 0), 0);
    const shown = inside.slice(0, 40).map((f) => `- \`${f.path}\` (${KIND_WORD[f.kind] || f.kind}, ${counts(f)})`);
    if (inside.length > shown.length) shown.push(`- … and ${inside.length - shown.length} more`);
    return `Explain the uncommitted changes in the folder \`${key}/\` (${inside.length} file${inside.length > 1 ? 's' : ''}, +${a} −${r}):\n` +
      shown.join('\n') + '\n\n' +
      `Run \`${gitCmd(key)}\` (and read the new, untracked files) and give me an overview: what changed as a whole, ` +
      `a short note per file, how they fit together, and anything risky.`;
  }

  // Send it to the open chat. If you were already typing (or have attachments),
  // don't send over that — put the request in the box for you to send.
  function sendToChat(text) {
    const box = document.getElementById('replyTextarea');
    if (!box || !chatIsOpen()) return;
    const busyBox = box.value.trim() || (typeof attachments !== 'undefined' && attachments.length);
    close();
    if (busyBox && window.addPromptChip?.(text)) {
      // you were typing: the request waits as a pill above your text (logic/chat/prompt-pills.js)
      if (typeof replyStatusMsg !== 'undefined') replyStatusMsg.textContent = 'Added as a pill — press Enter to send it with your message';
      return;
    }
    if (busyBox || typeof submitReply !== 'function') {
      const v = box.value;
      box.value = (v.trim() ? v.replace(/\s*$/, '') + '\n\n' : '') + text;
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
      box.dispatchEvent(new Event('input', { bubbles: true }));
      if (typeof replyStatusMsg !== 'undefined') replyStatusMsg.textContent = 'Added to your message — press Enter to send';
      return;
    }
    submitReply(text);
  }

  function fileMenu(f) {
    const open = chatIsOpen();
    return [
      { icon: '✦', label: 'Explain this change', primary: true, disabled: !open, title: open ? 'Ask Claude in this chat' : 'Open a chat first',
        run: () => sendToChat(explainFilePrompt(f)) },
      '-',
      { icon: '✓', label: 'Commit this file…', run: () => openCommit([f]) },
      { icon: '↶', label: f.kind === 'untracked' || f.kind === 'added' ? 'Delete this new file…' : 'Discard changes…', danger: true, run: () => openDiscard([f]) },
      '-',
      { icon: '↗', label: 'Open in VS Code', disabled: f.kind === 'deleted',
        run: () => api.openFile?.(state.top + '\\' + f.path.replace(/\//g, '\\')) },
      { icon: '⧉', label: 'Copy path', hint: f.path.length > 28 ? '…' + f.path.slice(-27) : f.path,
        run: () => api.copyToClipboard?.(f.path) },
    ];
  }
  function folderMenu(key) {
    const open = chatIsOpen();
    const n = state.files.filter((f) => f.path.startsWith(key + '/')).length;
    return [
      { icon: '✦', label: "Explain this folder's changes", hint: `${n} file${n > 1 ? 's' : ''}`, primary: true, disabled: !open,
        title: open ? 'Ask Claude in this chat' : 'Open a chat first', run: () => sendToChat(explainFolderPrompt(key)) },
      '-',
      { icon: '✓', label: 'Commit this folder…', hint: `${n} file${n > 1 ? 's' : ''}`, run: () => openCommit(under(key)) },
      { icon: '↶', label: "Discard this folder's changes…", danger: true, run: () => openDiscard(under(key)) },
      '-',
      { icon: '⧉', label: 'Copy folder path', run: () => api.copyToClipboard?.(key + '/') },
    ];
  }
  function drawNode(node, depth, prefix, out) {
    const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
    for (let d of dirs) {
      let name = d.name, key = prefix + d.name;
      while (!d.files.length && d.dirs.size === 1) { // merge single-folder chains
        const [only] = d.dirs.values();
        name += '/' + only.name; key += '/' + only.name; d = only;
      }
      const isClosed = collapsed.has(key);
      const t = totals(d);
      const row = mk('button', 'gd-folder' + (isClosed ? ' closed' : ''));
      row.dataset.key = key;
      row.style.paddingLeft = `${30 + depth * INDENT}px`;
      const inside = under(key), nOn = inside.filter((f) => ticked.has(f.path)).length;
      const tick = checkBox(nOn > 0 && nOn === inside.length, nOn > 0 && nOn < inside.length);
      tick.title = 'Include every file in this folder';
      tick.addEventListener('click', (e) => {
        e.stopPropagation();
        const all = inside.every((f) => ticked.has(f.path));
        for (const f of inside) { if (all) ticked.delete(f.path); else ticked.add(f.path); }
        paintChecks();
      });
      row.title = `${key}/ · ${t.n} file${t.n > 1 ? 's' : ''}`;
      const chev = mk('span', 'gd-chev');
      chev.innerHTML = '<svg viewBox="0 0 10 10" width="10" height="10"><path d="M3 2l3.5 3L3 8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      const icon = mk('span', 'gd-folder-ico');
      icon.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M1.5 4.5a1 1 0 0 1 1-1h3.6l1.4 1.5h6a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" fill="currentColor"/></svg>';
      const label = mk('span', 'gd-folder-name', name);
      const stats = mk('span', 'gd-stats');
      if (isClosed) stats.append(mk('span', 'gd-dim', `${t.n}`));
      else {
        if (t.a) stats.append(mk('span', 'gd-add gd-faint', `+${t.a}`));
        if (t.r) stats.append(mk('span', 'gd-del gd-faint', `−${t.r}`));
      }
      row.append(tick, chev, icon, label, stats);
      row.addEventListener('click', () => {
        if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key);
        drawList();
      });
      row.addEventListener('contextmenu', (e) => showMenu(e, row, folderMenu(key)));
      out.append(row);
      if (!isClosed) drawNode(d, depth + 1, key + '/', out);
    }
    for (const f of [...node.files].sort((a, b) => baseName(a.path).localeCompare(baseName(b.path)))) {
      out.append(fileRow(f, depth));
      visibleOrder.push(f.path);
    }
  }
  function drawList() {
    const keepScroll = list.scrollTop;
    list.innerHTML = '';
    visibleOrder = [];
    const { files } = state;
    updateActions();
    const totA = files.reduce((n, f) => n + (f.added || 0), 0);
    const totR = files.reduce((n, f) => n + (f.removed || 0), 0);
    sub.textContent = files.length
      ? `${state.branch ? state.branch + ' · ' : ''}${files.length} file${files.length > 1 ? 's' : ''} · +${totA} −${totR}`
      : `${state.branch ? state.branch + ' · ' : ''}working tree clean`;
    if (!files.length) { list.append(mk('div', 'gd-empty', 'No changes')); return; }
    const frag = document.createDocumentFragment();
    drawNode(buildTree(files), 0, '', frag);
    list.append(frag);
    list.scrollTop = keepScroll;
    markSelected();
  }
  function markSelected() {
    for (const r of list.querySelectorAll('.gd-file')) r.classList.toggle('sel', r.dataset.path === state.selected);
  }

  // ---- diff view ----
  function diffHeader(f) {
    const bar = mk('div', 'gd-viewhead');
    const p = mk('div', 'gd-path');
    p.append(mk('span', 'gd-path-dir', dirName(f.path) ? dirName(f.path) + '/' : ''), mk('span', 'gd-path-name', baseName(f.path)));
    if (f.from) p.append(mk('span', 'gd-dim', `  (from ${f.from})`));
    const open = mk('button', 'gd-btn', 'Open');
    open.title = 'Open in VS Code';
    open.disabled = f.kind === 'deleted';
    open.addEventListener('click', () => api.openFile?.(state.top + '\\' + f.path.replace(/\//g, '\\')));
    bar.append(p, open);
    return bar;
  }
  async function select(rel) {
    state.selected = rel;
    markSelected();
    const f = state.files.find((x) => x.path === rel);
    if (!f) return;
    const seq = ++loadSeq;
    rows = []; clearPick();
    view.innerHTML = '';
    view.append(diffHeader(f), mk('div', 'gd-note', 'Loading…'));
    const d = await api.gitFileDiff(state.cwd, rel);
    if (seq !== loadSeq) return; // another file was picked meanwhile
    view.innerHTML = '';
    view.append(diffHeader(f));
    if (!d || d.error) { view.append(mk('div', 'gd-note', d?.error || 'Could not load the diff')); return; }
    if (d.binary) { view.append(mk('div', 'gd-note', 'Binary file — no text diff')); return; }
    if (!d.lines.length) { view.append(mk('div', 'gd-note', f.kind === 'deleted' ? 'File deleted' : 'No text changes (mode or whitespace only)')); return; }
    view.append(mk('div', 'gd-hint', 'Click a line, drag the line numbers or Shift-click for several, Ctrl-click to add more · or select text for just a part'));
    view.append(renderDiff(d.lines, d.untracked, f));
    view.scrollTop = 0;
  }

  // ---- pick lines (or part of them) → "Add to chat" ----
  // rows[] = { el, code, t: '+' | '-' | ' ', o, n, text } for every code line (hunk headers excluded)
  // Two kinds of pick:
  //   picked   = Set of whole lines (click, Shift-click, Ctrl-click, drag on the line numbers)
  //   textPick = { rows, text } when text is highlighted with the mouse (part of a line or across lines)
  let rows = [], pickFile = null, anchor = -1, picked = new Set(), textPick = null, drag = null;
  const pickBar = mk('div', 'gd-pickbar');
  const pickText = mk('span', 'gd-pick-text');
  const pickAdd = mk('button', 'gd-btn gd-primary', 'Add to chat');
  const pickClear = mk('button', 'gd-btn gd-icon', '✕');
  pickClear.title = 'Clear the selection (Esc)';
  pickBar.append(pickText, pickAdd, pickClear);
  pickBar.addEventListener('mousedown', (e) => e.preventDefault()); // keep a text selection alive while clicking the bar
  panel.append(pickBar);

  const LANG = { js: 'js', mjs: 'js', cjs: 'js', ts: 'ts', tsx: 'tsx', jsx: 'jsx', py: 'python', css: 'css', html: 'html',
    json: 'json', md: 'md', sh: 'bash', ps1: 'powershell', cs: 'csharp', java: 'java', go: 'go', rs: 'rust', rb: 'ruby',
    php: 'php', cpp: 'cpp', c: 'c', h: 'c', yml: 'yaml', yaml: 'yaml', sql: 'sql', xml: 'xml', vue: 'vue' };
  const langOf = (p) => LANG[(p.split('.').pop() || '').toLowerCase()] || '';
  const sortedPicked = () => [...picked].sort((a, b) => a - b);

  function hasPick() { return picked.size > 0 || !!textPick; }
  function clearPick() {
    picked = new Set(); textPick = null; anchor = -1;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && view.contains(sel.anchorNode)) sel.removeAllRanges();
    paint();
  }
  function setPicked(set) { picked = set; textPick = null; paint(); }
  function paint() {
    rows.forEach((r, i) => r.el.classList.toggle('picked', picked.has(i)));
    updateBar();
  }
  function updateBar() {
    if (!hasPick() || !pickFile) { panel.classList.remove('picking'); return; }
    if (textPick) {
      pickText.textContent = `Selected text · ${baseName(pickFile.path)} ${lineLabel(textPick.rows)}`;
    } else {
      const sel = sortedPicked().map((i) => rows[i]);
      pickText.textContent = `${sel.length} line${sel.length > 1 ? 's' : ''} · ${baseName(pickFile.path)} ${lineLabel(sel)}`;
    }
    const chatOpen = !!(typeof currentActiveSession !== 'undefined' && currentActiveSession &&
      document.getElementById('detailView')?.classList.contains('active'));
    pickAdd.disabled = !chatOpen;
    pickAdd.title = chatOpen ? 'Put this in your message (Ctrl+Enter)' : 'Open a chat first';
    panel.classList.add('picking');
  }
  // "line 22", "lines 22–26", "lines 22–24, 30" (new numbering);
  // "removed lines 40–42 (old numbering)" when only deleted lines are picked
  function lineLabel(sel) {
    const nn = sel.filter((r) => r.n).map((r) => r.n);
    const nums = nn.length ? nn : sel.filter((r) => r.o).map((r) => r.o);
    const runs = [];
    for (const x of nums) {
      const last = runs[runs.length - 1];
      if (last && x === last[1] + 1) last[1] = x; else runs.push([x, x]);
    }
    const txt = runs.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ');
    const word = nums.length === 1 ? 'line' : 'lines';
    return nn.length ? `${word} ${txt}` : `removed ${word} ${txt} (old numbering)`;
  }

  // click / Shift-click / Ctrl-click on the code
  function onRowClick(i, e) {
    if (e.target.closest('.gd-ln')) return;          // the line-number gutter has its own handling
    if (window.getSelection()?.toString()) return;    // text was highlighted → that's a text pick
    if (e.ctrlKey || e.metaKey) {
      const s = new Set(picked);
      if (s.has(i)) s.delete(i); else s.add(i);
      anchor = i; setPicked(s);
    } else if (e.shiftKey && anchor >= 0) {
      setPicked(rangeSet(anchor, i));
    } else if (picked.size === 1 && picked.has(i)) {
      clearPick();                                     // click the only picked line again = unpick
    } else {
      anchor = i; setPicked(new Set([i]));
    }
  }
  function rangeSet(a, b) {
    const s = new Set();
    for (let k = Math.min(a, b); k <= Math.max(a, b); k++) s.add(k);
    return s;
  }
  // press on the line numbers and drag up/down = pick a block (Ctrl keeps what was picked)
  function onGutterDown(i, e) {
    if (e.button !== 0) return;
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    if ((e.ctrlKey || e.metaKey) && picked.has(i)) { const s = new Set(picked); s.delete(i); setPicked(s); return; }
    const start = e.shiftKey && anchor >= 0 ? anchor : i;
    drag = { start, base: (e.ctrlKey || e.metaKey) ? new Set(picked) : new Set() };
    anchor = start;
    dragTo(i);
  }
  function dragTo(i) {
    if (!drag) return;
    const s = new Set(drag.base);
    rangeSet(drag.start, i).forEach((k) => s.add(k));
    setPicked(s);
  }
  document.addEventListener('mouseup', () => { drag = null; });

  // highlighting text in the diff = a partial pick (only the highlighted characters)
  function partOf(codeEl, range) {
    const r = document.createRange();
    r.selectNodeContents(codeEl);
    if (range.compareBoundaryPoints(Range.START_TO_START, r) > 0) r.setStart(range.startContainer, range.startOffset);
    if (range.compareBoundaryPoints(Range.END_TO_END, r) < 0) r.setEnd(range.endContainer, range.endOffset);
    return r.toString();
  }
  let selTimer = 0;
  document.addEventListener('selectionchange', () => {
    clearTimeout(selTimer);
    selTimer = setTimeout(() => {
      if (!isOpen() || drag) return;
      const sel = window.getSelection();
      const diffEl = view.querySelector('.gd-diff');
      const inDiff = sel && !sel.isCollapsed && sel.rangeCount && diffEl && diffEl.contains(sel.getRangeAt(0).commonAncestorContainer);
      if (!inDiff) { if (textPick) { textPick = null; updateBar(); } return; }
      const range = sel.getRangeAt(0);
      const hit = [], parts = [];
      for (const r of rows) {
        if (!range.intersectsNode(r.code)) continue;
        const part = partOf(r.code, range);
        if (part === '' ) continue;
        hit.push(r); parts.push(part === ' ' && !r.text ? '' : part);
      }
      const text = parts.join('\n');
      if (!hit.length || !text.trim()) return;
      picked = new Set();
      rows.forEach((r) => r.el.classList.remove('picked'));
      textPick = { rows: hit, text };
      updateBar();
    }, 60);
  });

  function addToChat() {
    if (!hasPick() || pickAdd.disabled) return;
    let block;
    if (textPick) {
      const kinds = new Set(textPick.rows.map((r) => r.t));
      const what = kinds.size === 1 && kinds.has('+') ? ', added' : kinds.size === 1 && kinds.has('-') ? ', removed' : '';
      const whole = textPick.rows.length === 1 && textPick.text === textPick.rows[0].text;
      block = `In \`${pickFile.path}\` (${lineLabel(textPick.rows)}${what}${whole ? '' : ', selected part'}):\n` +
        '```' + langOf(pickFile.path) + '\n' + textPick.text + '\n```\n';
    } else {
      const idx = sortedPicked();
      const sel = idx.map((i) => rows[i]);
      const changed = sel.some((r) => r.t !== ' ');
      const body = [];
      idx.forEach((i, k) => {
        if (k && i !== idx[k - 1] + 1) body.push('…');       // gap between picked lines
        body.push(rows[i].t + rows[i].text);
      });
      block = `In \`${pickFile.path}\` (${lineLabel(sel)}${changed ? ', uncommitted change' : ''}):\n` +
        '```diff\n' + body.join('\n') + '\n```\n';
    }
    const box = document.getElementById('replyTextarea');
    if (!box) return;
    const v = box.value;
    const at = box.selectionStart ?? v.length;
    const before = v.slice(0, at);
    const lead = before && !before.endsWith('\n') ? '\n\n' : before ? '\n' : '';
    box.value = before + lead + block + '\n' + v.slice(at);
    const pos = (before + lead + block + '\n').length;
    clearPick();
    close();
    box.focus();
    box.setSelectionRange(pos, pos);
    box.dispatchEvent(new Event('input', { bubbles: true })); // auto-grow
  }
  pickAdd.addEventListener('click', addToChat);
  pickClear.addEventListener('click', clearPick);

  function renderDiff(lines, untracked, f) {
    const table = mk('div', 'gd-diff');
    rows = []; pickFile = f; clearPick();
    let o = 0, n = 0;
    const frag = document.createDocumentFragment();
    let drawn = 0;
    for (const l of lines) {
      if (drawn >= MAX_ROWS) break;
      const h = l.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
      if (h) {
        o = +h[1]; n = +h[2];
        const row = mk('div', 'gd-row gd-hunk');
        row.append(mk('span', 'gd-ln', '⋯'), mk('span', 'gd-ln', '⋯'), mk('span', 'gd-code', h[3].trim() || ' '));
        frag.append(row);
        drawn++;
        continue;
      }
      if (l.startsWith('\\')) continue; // "\ No newline at end of file"
      const t = l[0] === '+' || l[0] === '-' ? l[0] : ' ', text = l.slice(1);
      const row = mk('div', 'gd-row gd-pickable' + (t === '+' ? ' gd-plus' : t === '-' ? ' gd-minus' : ''));
      const oldN = t === '+' ? 0 : o++;
      const newN = t === '-' ? 0 : (untracked ? ++n : n++);
      const code = mk('span', 'gd-code', text || ' ');
      const html = text && window.highlightLine?.(text, (f.path.split('.').pop() || ''));
      if (html) code.innerHTML = html; // syntax colours, line by line
      const lnO = mk('span', 'gd-ln', oldN ? String(oldN) : '');
      const lnN = mk('span', 'gd-ln', newN ? String(newN) : '');
      row.append(lnO, lnN, code);
      const i = rows.length;
      rows.push({ el: row, code, t, o: oldN, n: newN, text });
      row.addEventListener('click', (e) => onRowClick(i, e));
      lnO.addEventListener('mousedown', (e) => onGutterDown(i, e));
      lnN.addEventListener('mousedown', (e) => onGutterDown(i, e));
      row.addEventListener('mouseenter', () => dragTo(i));
      frag.append(row);
      drawn++;
    }
    table.append(frag);
    if (lines.length > drawn) table.append(mk('div', 'gd-note', `… ${lines.length - drawn} more lines — open the file to see them all`));
    return table;
  }

  // ---- Commit / Discard ----
  // The bar under the tree acts on the ticked files; the right-click menu acts on one file / folder.
  const dlgBack = mk('div', 'gd-dlg-back');
  const dlg = mk('div', 'gd-dlg');
  dlg.setAttribute('role', 'dialog');
  dlg.setAttribute('aria-modal', 'true');
  dlgBack.append(dlg);
  const toast = mk('div', 'gd-toast');
  panel.append(dlgBack, toast);
  let dlgOpen = false, dlgBusy = false, dlgSubmit = null, toastTimer = null;
  function closeDialog() { if (dlgBusy) return; dlgOpen = false; dlgSubmit = null; dlgBack.classList.remove('show'); }
  function showDialog(build) {
    hideMenu();
    dlg.innerHTML = '';
    build(dlg);
    dlgOpen = true;
    dlgBack.classList.add('show');
    (dlg.querySelector('[data-focus]') || dlg).focus?.();
  }
  dlgBack.addEventListener('mousedown', (e) => { if (e.target === dlgBack) closeDialog(); });
  function say(text, { action, ms = 6000, bad = false } = {}) {
    clearTimeout(toastTimer);
    toast.innerHTML = '';
    toast.className = 'gd-toast show' + (bad ? ' bad' : '');
    toast.append(mk('span', 'gd-toast-text', text));
    if (action) {
      const b = mk('button', 'gd-btn', action.label);
      b.addEventListener('click', () => { toast.classList.remove('show'); action.run(); });
      toast.append(b);
    }
    toastTimer = setTimeout(() => toast.classList.remove('show'), ms);
  }
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const ticks = () => state.files.filter((f) => ticked.has(f.path));

  const barAll = checkBox(false);
  const barText = mk('span', 'gd-actions-text');
  const barCommit = mk('button', 'gd-btn primary', 'Commit…');
  const barDiscard = mk('button', 'gd-btn danger', 'Discard…');
  barAll.title = 'Tick / untick every file';
  barAll.addEventListener('click', () => {
    if (ticked.size === state.files.length) ticked.clear(); else state.files.forEach((f) => ticked.add(f.path));
    paintChecks();
  });
  barCommit.addEventListener('click', () => openCommit(ticks()));
  barDiscard.addEventListener('click', () => openDiscard(ticks()));
  actionBar.append(barAll, barText, barCommit, barDiscard);
  function updateActions() {
    const n = ticked.size, total = state.files.length;
    actionBar.hidden = !total;
    barAll.classList.toggle('on', total > 0 && n === total);
    barAll.classList.toggle('part', n > 0 && n < total);
    barText.textContent = n ? `${n} of ${total}` : 'Tick files';
    barText.title = n ? `${n} of ${total} files ticked` : 'Tick files to commit or discard them';
    barCommit.disabled = !n;
    barDiscard.disabled = !n;
  }

  function fileLines(files) {
    const box = mk('div', 'gd-dlg-files');
    for (const f of files.slice(0, 200)) {
      const li = mk('div', 'gd-dlg-file');
      li.append(mk('span', `gd-badge gd-${f.kind}`, (KIND[f.kind] || ['M'])[0]), mk('span', 'gd-dlg-path', f.path), mk('span', 'gd-stats gd-dim', counts(f)));
      box.append(li);
    }
    return box;
  }

  function openCommit(files) {
    if (!files.length) return;
    const paths = files.map((f) => f.path);
    showDialog((d) => {
      d.append(mk('div', 'gd-dlg-title', `Commit ${plural(files.length, 'file')}`), fileLines(files));
      const msg = mk('textarea', 'gd-dlg-msg');
      msg.rows = 5; msg.spellcheck = false; msg.dataset.focus = '1';
      msg.placeholder = 'Commit message — the first line is the summary';
      const draft = mk('button', 'gd-btn', '✦ Draft with Claude');
      draft.title = 'Claude (Haiku — cheap) reads the diff of these files and writes a message';
      const pushLabel = mk('label', 'gd-dlg-check');
      const push = mk('input'); push.type = 'checkbox';
      pushLabel.append(push, mk('span', null, 'Push after committing'));
      const acct = mk('input', 'gd-dlg-input');
      acct.placeholder = 'GitHub account for the push (optional — only if you use several)';
      acct.spellcheck = false; acct.hidden = true;
      api.storeGetAll?.().then((st) => { if (st?.gitPushAccount) acct.value = st.gitPushAccount; }).catch(() => {});
      push.addEventListener('change', () => { acct.hidden = !push.checked; go.textContent = push.checked ? 'Commit & push' : 'Commit'; });
      const status = mk('div', 'gd-dlg-status');
      const say_ = (t, bad) => { status.textContent = t; status.classList.toggle('bad', !!bad); };
      const cancel = mk('button', 'gd-btn', 'Cancel');
      const go = mk('button', 'gd-btn primary', 'Commit');
      const lock = (on) => { dlgBusy = on; for (const x of [msg, draft, push, acct, cancel, go]) x.disabled = on; };
      cancel.addEventListener('click', closeDialog);

      draft.addEventListener('click', async () => {
        lock(true); draft.textContent = 'Drafting…'; say_('Claude is reading the diff…');
        const r = await api.gitDraftMessage(state.cwd, paths).catch((e) => ({ error: e.message }));
        lock(false); draft.textContent = '✦ Draft with Claude';
        if (r?.message) { msg.value = r.message; say_(''); } else say_(r?.error || 'No draft came back', true);
        msg.focus();
      });
      async function submit() {
        if (dlgBusy) return;
        if (!msg.value.trim()) { say_('Write a commit message first', true); msg.focus(); return; }
        lock(true); say_('Committing…');
        const c = await api.gitCommit(state.cwd, paths, msg.value).catch((e) => ({ error: e.message }));
        if (c?.error) { lock(false); say_(c.error, true); return; }
        let note = `Committed ${c.sha}`, bad = false;
        if (push.checked) {
          say_('Pushing…');
          const p = await api.gitPush(state.cwd, acct.value).catch((e) => ({ error: e.message }));
          if (p?.error) { note += ` — but the push failed: ${p.error}`; bad = true; } else note += ' · pushed';
        }
        lock(false); closeDialog();
        paths.forEach((p) => ticked.delete(p));
        await load(true);
        say(note, { bad, ms: bad ? 14000 : 6000 });
      }
      dlgSubmit = submit;
      go.addEventListener('click', submit);
      const row = mk('div', 'gd-dlg-row');
      row.append(draft, mk('span', 'gd-dlg-hint', 'Ctrl+Enter to commit'));
      d.append(msg, row, pushLabel, acct, status, mk('div', 'gd-dlg-buttons'));
      d.lastChild.append(cancel, go);
    });
  }

  function openDiscard(files) {
    if (!files.length) return;
    const paths = files.map((f) => f.path);
    const fresh = files.filter((f) => f.kind === 'untracked' || f.kind === 'added').length;
    showDialog((d) => {
      d.append(mk('div', 'gd-dlg-title', `Discard changes in ${plural(files.length, 'file')}?`), fileLines(files));
      d.append(mk('div', 'gd-dlg-warn',
        (fresh ? `${plural(fresh, 'new file')} will be deleted. ` : '') +
        (files.length > fresh ? 'The other files go back to the last commit. ' : '') +
        'A backup is kept for a week, and you can undo right after.'));
      const status = mk('div', 'gd-dlg-status');
      const cancel = mk('button', 'gd-btn', 'Cancel');
      cancel.dataset.focus = '1'; // the safe choice has the focus
      const go = mk('button', 'gd-btn danger', 'Discard');
      cancel.addEventListener('click', closeDialog);
      async function submit() {
        if (dlgBusy) return;
        dlgBusy = true; go.disabled = cancel.disabled = true; status.textContent = 'Discarding…'; status.classList.remove('bad');
        const r = await api.gitDiscard(state.cwd, paths).catch((e) => ({ error: e.message }));
        dlgBusy = false; go.disabled = cancel.disabled = false;
        if (r?.error) { status.textContent = r.error; status.classList.add('bad'); if (r.backup) await load(true); return; }
        closeDialog();
        paths.forEach((p) => ticked.delete(p));
        await load(true);
        say(`Discarded ${plural(r.count, 'file')}`, { ms: 15000, action: { label: 'Undo', run: async () => {
          const u = await api.gitUndoDiscard(state.cwd, r.backup).catch((e) => ({ error: e.message }));
          await load(true);
          say(u?.error ? u.error : `Put back ${plural(u.count, 'file')}`, { bad: !!u?.error });
        } } });
      }
      // no Ctrl+Enter shortcut for the destructive one: it has to be clicked
      go.addEventListener('click', submit);
      d.append(status, mk('div', 'gd-dlg-buttons'));
      d.lastChild.append(cancel, go);
    });
  }

  // ---- load / open / close ----
  async function load(keepSelection) {
    btnRefresh.classList.add('spin');
    const r = await api.gitChanges(state.cwd).catch(() => null);
    btnRefresh.classList.remove('spin');
    if (!r) {
      state.files = [];
      list.innerHTML = '';
      list.append(mk('div', 'gd-empty', 'Not a git repository'));
      view.innerHTML = '';
      sub.textContent = '';
      return;
    }
    state.top = r.top;
    state.files = r.files;
    for (const p of [...ticked]) if (!state.files.some((f) => f.path === p)) ticked.delete(p); // gone since last look
    drawList();
    const still = keepSelection && state.files.some((f) => f.path === state.selected);
    const first = visibleOrder[0]; // top file in the tree
    if (still) select(state.selected);
    else if (first) select(first);
    else { view.innerHTML = ''; view.append(mk('div', 'gd-note gd-clean', '✓ Nothing to show — the working tree is clean')); }
  }
  function open(cwd, branch) {
    if (!cwd) return;
    const same = cwd === state.cwd;
    state.cwd = cwd;
    state.branch = branch || '';
    if (!same) { state.selected = ''; ticked.clear(); }
    title.textContent = 'Changes';
    document.body.classList.add('gd-open');
    liftApprovals(true);
    panel.focus();
    load(same);
  }
  function close() {
    hideMenu();
    dlgOpen = false; dlgSubmit = null; dlgBack.classList.remove('show'); // (a commit in progress carries on)
    document.body.classList.remove('gd-open');
    liftApprovals(false);
  }

  // Tool-approval cards live inside the main window card, which sits under this
  // panel — so a card that arrives while the panel is open would be hidden and
  // Claude would wait. While open, move the cards above the panel; put them back after.
  const approvals = document.getElementById('approvalToasts');
  const approvalsHome = approvals && { parent: approvals.parentElement, next: approvals.nextSibling };
  function liftApprovals(up) {
    if (!approvals) return;
    if (up && approvals.parentElement !== document.body) {
      document.body.appendChild(approvals); // after the panel → painted above it
      approvals.classList.add('over-gd');
    } else if (!up && approvals.parentElement === document.body) {
      approvals.classList.remove('over-gd');
      approvalsHome.parent.insertBefore(approvals, approvalsHome.next);
    }
    // approvals for the open chat show as cards while the panel covers the chat (app.js isApprovalInView)
    try { if (typeof renderApprovalToasts === 'function') renderApprovalToasts(); } catch (_) {}
  }
  // "Open" on a card jumps to that chat → get out of the way
  approvals?.addEventListener('click', (e) => {
    if (isOpen() && /^open$/i.test(e.target.closest('button')?.textContent.trim() || '')) close();
  });
  // A plan to approve or a question from Claude only shows inside the chat → close the panel for it
  api.onPermissionRequest?.((req) => {
    if (isOpen() && (req.toolName === 'ExitPlanMode' || req.toolName === 'AskUserQuestion')) close();
  });
  const isOpen = () => document.body.classList.contains('gd-open');

  btnClose.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  btnRefresh.addEventListener('click', () => load(true));
  btnCopy.addEventListener('click', () => {
    if (!state.branch) return;
    api.copyToClipboard?.(state.branch);
    btnCopy.textContent = 'Copied';
    setTimeout(() => { btnCopy.textContent = 'Copy branch'; }, 1000);
  });
  document.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    if (dlgOpen) { // a dialog has the keyboard: Esc closes it, Ctrl+Enter confirms (commit only)
      if (e.key === 'Escape') { e.stopPropagation(); closeDialog(); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && dlgSubmit) { e.preventDefault(); dlgSubmit(); }
      return;
    }
    if (e.key === 'Escape') { e.stopPropagation(); if (menuFor) hideMenu(); else if (hasPick()) clearPick(); else close(); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && hasPick()) { e.preventDefault(); addToChat(); return; }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && visibleOrder.length && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) {
      e.preventDefault(); // walk the files as shown in the tree (collapsed folders skipped)
      const i = visibleOrder.indexOf(state.selected);
      const next = visibleOrder[Math.max(0, Math.min(visibleOrder.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) { select(next); list.querySelector('.gd-file.sel')?.scrollIntoView({ block: 'nearest' }); }
    }
  }, true);

  window.openGitDiff = open;
})();
