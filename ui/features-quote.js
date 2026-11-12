// Select text in the chat → a small "❝ Quote" button appears → click it (or
// press Ctrl+Q) to put the selection into the message box as a > quote.
(function () {
  const stream = document.getElementById('chatStream');
  const box = document.getElementById('replyTextarea');
  if (!stream || !box) return;

  const btn = document.createElement('button');
  btn.className = 'quote-pop';
  btn.textContent = '❝ Quote';
  btn.title = 'Reference this in your message (Ctrl+Q)';
  btn.hidden = true;
  document.body.appendChild(btn);

  let picked = '';
  const selectionInChat = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!stream.contains(range.commonAncestorContainer)) return null;
    const text = sel.toString().trim();
    return text ? { text, rect: range.getBoundingClientRect() } : null;
  };

  function quote(text) {
    const q = text.split(/\r?\n/).map((l) => '> ' + l).join('\n') + '\n\n';
    const v = box.value;
    const start = box.selectionStart ?? v.length;
    // Put it where the cursor is, on its own lines
    const before = v.slice(0, start);
    const lead = before && !before.endsWith('\n') ? '\n\n' : '';
    box.value = before + lead + q + v.slice(start);
    const pos = (before + lead + q).length;
    box.focus();
    box.setSelectionRange(pos, pos);
    box.dispatchEvent(new Event('input', { bubbles: true })); // auto-grow etc.
    hide();
    window.getSelection()?.removeAllRanges();
  }

  function hide() { btn.hidden = true; picked = ''; }

  document.addEventListener('mouseup', () => setTimeout(() => {
    const s = selectionInChat();
    if (!s) { if (!btn.matches(':hover')) hide(); return; }
    picked = s.text;
    btn.hidden = false;
    const w = btn.offsetWidth || 70;
    const x = Math.min(window.innerWidth - w - 4, Math.max(4, s.rect.left + s.rect.width / 2 - w / 2));
    const y = s.rect.top - 30 < 4 ? s.rect.bottom + 6 : s.rect.top - 30;
    btn.style.left = x + 'px';
    btn.style.top = y + 'px';
  }, 0));
  btn.addEventListener('mousedown', (e) => e.preventDefault()); // keep the selection
  btn.addEventListener('click', () => { if (picked) quote(picked); });
  stream.addEventListener('scroll', hide);
  // ---- Right-click menu: chat (Copy / Copy message / Quote) and message box (Cut / Copy / Paste) ----
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.hidden = true;
  document.body.appendChild(menu);
  const copyText = (t) => { if (window.electronAPI?.copyToClipboard) window.electronAPI.copyToClipboard(t); else navigator.clipboard?.writeText(t); };
  const closeMenu = () => { menu.hidden = true; };

  function showMenu(e, items) {
    e.preventDefault();
    menu.textContent = '';
    for (const it of items) {
      if (it === '-') { menu.appendChild(Object.assign(document.createElement('div'), { className: 'ctx-sep' })); continue; }
      const b = document.createElement('button');
      b.className = 'ctx-item';
      b.disabled = !!it.disabled;
      b.innerHTML = '<span></span><span class="ctx-key"></span>';
      b.firstChild.textContent = it.label;
      b.lastChild.textContent = it.key || '';
      b.addEventListener('mousedown', (ev) => ev.preventDefault()); // keep selection / focus
      b.addEventListener('click', () => { closeMenu(); it.run(); });
      menu.appendChild(b);
    }
    menu.hidden = false;
    const x = Math.min(e.clientX, window.innerWidth - menu.offsetWidth - 4);
    const y = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 4);
    menu.style.left = Math.max(4, x) + 'px';
    menu.style.top = Math.max(4, y) + 'px';
  }

  stream.addEventListener('contextmenu', (e) => {
    hide();
    const s = selectionInChat();
    const content = e.target.closest('.chat-bubble')?.querySelector('.bubble-content');
    const whole = content ? content.innerText.trim() : '';
    const items = [{ label: 'Copy', key: 'Ctrl+C', disabled: !s, run: () => copyText(s.text) }];
    if (whole) items.push({ label: 'Copy message', run: () => copyText(whole) });
    items.push('-', { label: '❝ Quote in reply', key: 'Ctrl+Q', disabled: !s && !whole, run: () => quote(s ? s.text : whole) });
    showMenu(e, items);
  });

  async function pasteIntoBox() {
    box.focus();
    let clip = {};
    try { clip = (await window.electronAPI?.readClipboard?.()) || {}; } catch (_) {}
    if (clip.text) {
      box.setRangeText(clip.text, box.selectionStart, box.selectionEnd, 'end');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (clip.image && typeof attachFiles === 'function') {
      const blob = await (await fetch(clip.image)).blob();
      attachFiles([new File([blob], 'pasted-image.png', { type: 'image/png' })]);
    }
  }

  box.addEventListener('contextmenu', (e) => {
    const has = box.selectionStart !== box.selectionEnd;
    const sel = () => box.value.slice(box.selectionStart, box.selectionEnd);
    showMenu(e, [
      { label: 'Cut', key: 'Ctrl+X', disabled: !has, run: () => { copyText(sel()); box.setRangeText('', box.selectionStart, box.selectionEnd, 'end'); box.dispatchEvent(new Event('input', { bubbles: true })); } },
      { label: 'Copy', key: 'Ctrl+C', disabled: !has, run: () => copyText(sel()) },
      { label: 'Paste', key: 'Ctrl+V', run: pasteIntoBox },
      '-',
      { label: 'Select all', key: 'Ctrl+A', run: () => { box.focus(); box.select(); } },
    ]);
  });

  document.addEventListener('mousedown', (e) => { if (!menu.contains(e.target)) closeMenu(); });
  window.addEventListener('blur', closeMenu);
  stream.addEventListener('scroll', closeMenu);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hide(); closeMenu(); }
    if (e.ctrlKey && (e.key === 'q' || e.key === 'Q')) {
      const s = selectionInChat();
      if (s) { e.preventDefault(); quote(s.text); }
    }
  });
})();

// 📌 Notes buttons: open/close the pinned-notes panel docked left of the HUD
(function () {
  const api = window.electronAPI;
  if (!api || !api.notesToggle) return;
  const btns = [...document.querySelectorAll('.tb-notes')];
  const paint = (st) => {
    for (const b of btns) {
      b.classList.toggle('open', !!(st && st.open));
      const badge = b.querySelector('.notes-badge');
      if (badge) badge.textContent = st && st.count ? String(st.count) : '';
    }
  };
  btns.forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); api.notesToggle(); }));
  api.onNotesState(paint);
  api.notesState().then(paint).catch(() => {});
})();
