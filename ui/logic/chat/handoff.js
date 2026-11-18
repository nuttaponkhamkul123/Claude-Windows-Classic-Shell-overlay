// Hand off to a new chat: "Hand off ↗" next to the cost chip, or /handoff.
// A long chat gets expensive (every message re-sends all of it). This asks Claude
// (Haiku, cheap — it reads the transcript, the long chat itself is not re-sent) for
// a short note: goal / done / next / key files. You can edit it, then it opens a NEW
// chat in the same folder with the note in the input box. You press Send.
//   window.openHandoff()
(function () {
  const api = window.electronAPI;
  const row = document.querySelector('.cost-row'); // made by cost-meter.js (loaded before this)
  if (!api?.handoffNote || !row) return;
  const LONG_CHAT = 150000; // same line as the cost chip's warning

  const usable = (s) => !!s && (s.source === 'claude' || s.source === 'antigravity') && !s.draft;

  const btn = el('button', 'handoff-btn', 'Hand off ↗');
  btn.hidden = true;
  btn.title = 'Summarise this chat and continue in a fresh one — keeps long chats cheap';
  row.appendChild(btn);
  uiInterval(() => { // (two property writes: cheap enough to keep the button in step with chat switches)
    const s = currentActiveSession;
    btn.hidden = !usable(s);
    btn.classList.toggle('hot', (s?.context?.used || 0) >= LONG_CHAT);
  }, 250);

  const INTRO = 'This continues an earlier chat. Here is the handoff note from it:\n\n';
  const OUTRO = '\n\nRead the key files above, tell me briefly what you understand, then wait for my instruction.';

  let overlay = null;
  let seq = 0; // a late answer for a closed / regenerated dialog is ignored
  function close() { seq++; if (overlay) { overlay.remove(); overlay = null; } }

  function open() {
    const s = currentActiveSession;
    if (!usable(s)) { addSystemNote('Open a conversation first, then use /handoff.'); return; }
    if (overlay) return;

    overlay = el('div', 'sk-overlay');
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    const dlg = el('div', 'sk-dialog ho-dialog');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    overlay.appendChild(dlg);

    const head = el('div', 'sk-head');
    head.append(el('span', 'sk-title', 'Hand off to a new chat'));
    const x = el('button', 'sk-x', '✕');
    x.title = 'Close (Esc)';
    x.addEventListener('click', close);
    head.appendChild(x);

    const body = el('div', 'sk-body');
    body.appendChild(el('div', 'sk-label',
      'Claude (Haiku — cheap) writes a short note from this chat. Edit it if you like: it goes into a NEW chat in the same folder, and you press Send.'));
    const ta = el('textarea', 'ho-note');
    ta.rows = 14;
    ta.spellcheck = false;
    ta.placeholder = 'Summarising this chat…';
    body.appendChild(ta);
    const status = el('div', 'sk-status', '');
    body.appendChild(status);

    const actions = el('div', 'sk-row ho-actions');
    const again = el('button', 'sk-btn', '↻ Write again');
    const cancel = el('button', 'sk-btn', 'Cancel');
    const go = el('button', 'sk-btn primary', 'Start new chat ▸');
    go.title = 'Ctrl+Enter';
    actions.append(again, el('span', 'ho-spacer'), cancel, go);
    body.appendChild(actions);
    dlg.append(head, body);
    document.body.appendChild(overlay);

    async function generate() {
      const mine = ++seq;
      ta.disabled = again.disabled = go.disabled = true;
      ta.value = '';
      ta.placeholder = 'Summarising this chat…';
      status.className = 'sk-status';
      status.textContent = 'Claude is reading this chat…';
      const r = await api.handoffNote(s.id).catch((e) => ({ error: e.message }));
      if (mine !== seq || !overlay) return;
      ta.disabled = again.disabled = false;
      if (r?.note) {
        ta.value = INTRO + r.note + OUTRO;
        go.disabled = false;
        status.textContent = '';
        ta.focus();
        ta.setSelectionRange(0, 0);
      } else {
        status.className = 'sk-status err';
        status.textContent = (r?.error || 'No note came back') + ' — you can write your own note above, or try again.';
        ta.placeholder = 'Write what the new chat should know…';
        go.disabled = false;
      }
    }

    function start() {
      const text = ta.value.trim();
      if (!text || go.disabled) return;
      close();
      startNewChat(s); // same folder and agent; keeps your /model and /effort choice
      replyTextarea.value = text;
      replyTextarea.dispatchEvent(new Event('input', { bubbles: true }));
      replyTextarea.focus();
      replyTextarea.setSelectionRange(0, 0);
      replyTextarea.scrollTop = 0;
      if (typeof replyStatusMsg !== 'undefined') replyStatusMsg.textContent = 'Handoff note is in the box — check it, then press Send';
    }

    again.addEventListener('click', generate);
    cancel.addEventListener('click', close);
    go.addEventListener('click', start);
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); start(); }
    });
    generate();
  }

  btn.addEventListener('click', open);
  window.openHandoff = open;
})();
