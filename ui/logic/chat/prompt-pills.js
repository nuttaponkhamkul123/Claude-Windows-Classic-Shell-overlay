// "Explain …" requests from the Changes panel shown as pills instead of the long prompt.
//   • In the chat: your message shows  ✦ Explain change · app.js  (click to see the full prompt).
//     Works for old messages too — the prompt is recognised by its wording.
//   • In the input: if you were typing, the request waits as a removable pill above your
//     text and is attached when you send (window.addPromptChip(prompt)).
// Claude still receives the full prompt; only the display changes.
(function () {
  // first line of a prompt built by git-diff.js
  const START = /^Explain (?:this (change|new file|deletion|rename) ?(?:\(from `[^`]*`\))?: `([^`]+)`|the uncommitted changes in the (folder) `([^`]+)`)/;
  const KIND = { change: 'Explain change', 'new file': 'Explain new file', deletion: 'Explain deletion', rename: 'Explain rename', folder: 'Explain folder' };

  function parse(block) {
    const m = block.match(START);
    if (!m) return null;
    const first = block.split('\n')[0];
    // must look like ours, not someone typing "Explain this change: `x`" by hand
    if (!/\((?:modified|added|deleted|renamed|untracked|new, not committed yet|\d+ files?)[,)]/.test(first) ||
        !/git -C "|Read it and tell me/.test(block)) return null;
    const isFolder = m[3] === 'folder';
    const path = isFolder ? m[4] : m[2];
    const name = isFolder ? path.replace(/\/$/, '') + '/' : path.split('/').pop();
    const stats = (first.match(/([+]\d+ −\d+)/) || [])[1] || '';
    const files = isFolder ? ((first.match(/\((\d+ files?)/) || [])[1] || '') : '';
    return { kind: KIND[isFolder ? 'folder' : m[1]] || 'Explain', path, name, stats, files, text: block };
  }

  // text → [{ text } | { pill }] in order; null when there's no pill in it
  window.splitExplainPrompts = function (text) {
    const parts = String(text || '').split(/\n{2,}(?=Explain (?:this |the uncommitted changes in the folder `))/);
    const out = [];
    let any = false;
    for (const p of parts) {
      const pill = parse(p);
      if (pill) { any = true; out.push({ pill }); } else out.push({ text: p });
    }
    return any ? out : null;
  };

  // short label, e.g. for the "You said:" bar
  window.explainLabel = function (text) {
    const segs = window.splitExplainPrompts(text);
    if (!segs) return null;
    return segs.map((s) => (s.pill ? `✦ ${s.pill.kind} · ${s.pill.name}` : s.text.trim())).filter(Boolean).join('  ');
  };

  function pillEl(p, { onRemove } = {}) {
    const wrap = document.createElement('span');
    wrap.className = 'explain-pill-wrap';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'explain-pill';
    b.title = `${p.path}${p.stats ? ` · ${p.stats}` : ''}\nClick to see the full request sent to Claude`;
    const ico = document.createElement('span'); ico.className = 'ep-ico'; ico.textContent = '✦';
    const kind = document.createElement('span'); kind.className = 'ep-kind'; kind.textContent = p.kind;
    const name = document.createElement('span'); name.className = 'ep-name'; name.textContent = p.name;
    b.append(ico, kind, name);
    if (p.files || p.stats) {
      const meta = document.createElement('span'); meta.className = 'ep-meta';
      meta.textContent = [p.files, p.stats].filter(Boolean).join(' · ');
      b.append(meta);
    }
    wrap.append(b);
    if (onRemove) {
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'ep-x';
      x.textContent = '✕';
      x.title = 'Remove';
      x.addEventListener('click', (e) => { e.stopPropagation(); onRemove(); });
      b.append(x);
    }
    const detail = document.createElement('pre');
    detail.className = 'ep-detail';
    detail.textContent = p.text;
    detail.hidden = true;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (onRemove) return; // in the input the pill isn't expandable
      detail.hidden = !detail.hidden;
      b.classList.toggle('open', !detail.hidden);
    });
    wrap.append(detail);
    return wrap;
  }
  window.makeExplainPill = (p) => pillEl(p);

  // ---- pills waiting in the input, per chat ----
  const box = document.getElementById('replyTextarea');
  const replyBox = document.querySelector('.reply-box');
  if (!box || !replyBox || typeof submitReply !== 'function') return;
  const chips = new Map(); // session id -> [prompt text]
  const tray = document.createElement('div');
  tray.className = 'prompt-chips';
  replyBox.insertBefore(tray, box);
  const curId = () => (typeof currentActiveSession !== 'undefined' && currentActiveSession ? currentActiveSession.id : '');

  function render() {
    tray.innerHTML = '';
    const list = chips.get(curId()) || [];
    tray.classList.toggle('has', list.length > 0);
    list.forEach((text, i) => {
      const p = parse(text) || { kind: 'Request', name: '', text, path: '' };
      tray.append(pillEl(p, { onRemove: () => { list.splice(i, 1); render(); } }));
    });
  }
  window.addPromptChip = function (text) {
    const id = curId();
    if (!id) return false;
    if (!chips.has(id)) chips.set(id, []);
    chips.get(id).push(text);
    render();
    box.focus();
    return true;
  };

  // attach the waiting pills to whatever you send next (this wraps the queue-aware
  // submitReply from features.js, so queued sends get the full text too)
  const prev = submitReply;
  // eslint-disable-next-line no-global-assign
  submitReply = function (text) {
    const id = curId();
    const list = chips.get(id) || [];
    if (!list.length) return prev(text);
    const typed = String(text ?? box.value ?? '').trim();
    if (typed.startsWith('/')) return prev(text); // slash commands go as they are
    const full = [typed, ...list].filter(Boolean).join('\n\n');
    chips.delete(id);
    render();
    box.value = '';
    return prev(full);
  };

  let shown = null;
  setInterval(() => { const id = curId(); if (id !== shown) { shown = id; render(); } }, 400);
})();
