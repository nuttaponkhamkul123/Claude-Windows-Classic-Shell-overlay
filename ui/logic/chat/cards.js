// Cards view of a chat: every question of yours is a card; click it to open or close the answer under it.
// Turn on / off with "Cards" in the chat toolbar (remembered). Nothing in the chat is rebuilt: the stream keeps
// its messages as they are, and this only marks them (qa-q = your question, qa-a = what belongs to its answer),
// so streaming, approvals and live updates work exactly as before. The look is in styles/chat-cards.css.
//   - the newest question is open (and stays open while its answer streams); older ones are closed
//   - a card you open or close yourself stays as you left it
//   - a collapsed card shows the first line of its answer under the question
//   window.setChatCards(on)   window.chatCardsOn()
(function () {
  const api = window.electronAPI;
  const stream = document.getElementById('chatStream');
  if (!stream) return;

  let on = !!(api && api.settings && api.settings.chatCards);
  const states = new Map(); // chat id -> { open:Set, autoLast:number|null, user:Set } (turn numbers)
  const stateOf = (id) => { if (!states.has(id)) states.set(id, { open: new Set(), autoLast: null, user: new Set() }); return states.get(id); };
  const chatId = () => (typeof currentActiveSession !== 'undefined' && currentActiveSession ? currentActiveSession.id : '');

  const isUser = (n) => n.classList.contains('chat-bubble') && n.classList.contains('user');
  const isLive = (n) => n.id === 'streamingBubble' || n.classList.contains('approval-card') || n.classList.contains('ask-card') || n.classList.contains('plan-card');
  const plain = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  function annotate() {
    const kids = [...stream.children];
    if (!on) {
      for (const k of kids) { k.classList.remove('qa-q', 'qa-a', 'qa-open'); k.removeAttribute('data-turn'); k.removeAttribute('data-peek'); if (k.getAttribute('role') === 'button' && k.classList.contains('chat-bubble')) { k.removeAttribute('role'); k.removeAttribute('tabindex'); k.removeAttribute('aria-expanded'); } }
      return;
    }
    const st = stateOf(chatId());
    // group: a user bubble starts a turn; everything after it (answers, notes, approvals) belongs to it
    let turn = -1;
    const turns = [];
    for (const k of kids) {
      if (isUser(k)) { turn++; turns[turn] = { q: k, a: [] }; k.dataset.turn = turn; }
      else if (turn >= 0) { turns[turn].a.push(k); k.dataset.turn = turn; }
      else k.removeAttribute('data-turn'); // before the first question: always shown
    }
    const last = turns.length - 1;
    if (last >= 0 && last !== st.autoLast) {
      if (st.autoLast != null && !st.user.has(st.autoLast)) st.open.delete(st.autoLast);
      if (!st.user.has(last) || !st.open.has(last)) st.open.add(last);
      st.autoLast = last;
    }
    if (last >= 0 && turns[last].a.some(isLive)) st.open.add(last); // an answer being written or waiting for you is never hidden
    turns.forEach((t, i) => {
      const open = st.open.has(i);
      t.q.classList.add('qa-q');
      t.q.classList.toggle('qa-open', open);
      t.q.setAttribute('role', 'button');
      t.q.setAttribute('tabindex', '0');
      t.q.setAttribute('aria-expanded', String(open));
      const first = t.a.find((k) => k.classList.contains('assistant'));
      t.q.dataset.peek = first ? plain(first.querySelector('.bubble-content')?.textContent, 160) : (t.a.length ? 'See below' : 'Waiting for the answer…');
      for (const k of t.a) { k.classList.add('qa-a'); k.classList.toggle('qa-open', open); }
    });
  }

  function toggle(q) {
    const i = Number(q.dataset.turn);
    if (!Number.isInteger(i)) return;
    const st = stateOf(chatId());
    st.user.add(i);
    if (st.open.has(i)) st.open.delete(i); else st.open.add(i);
    annotate();
    if (st.open.has(i)) q.scrollIntoView({ block: 'nearest' });
  }
  stream.addEventListener('click', (e) => {
    if (!on) return;
    const q = e.target.closest && e.target.closest('.qa-q');
    if (!q || !stream.contains(q)) return;
    if (e.target.closest('a, button, input, textarea, img, pre, code, .bubble-edits')) return; // links, copy buttons, code stay usable
    if (window.getSelection && String(window.getSelection()).length) return; // selecting text is not a click
    toggle(q);
  });
  stream.addEventListener('keydown', (e) => {
    if (!on || (e.key !== 'Enter' && e.key !== ' ')) return;
    const q = e.target.classList && e.target.classList.contains('qa-q') ? e.target : null;
    if (q) { e.preventDefault(); toggle(q); }
  });

  function setOn(v, save) {
    on = !!v;
    document.body.classList.toggle('chat-cards', on);
    document.getElementById('tbCards')?.classList.toggle('open', on);
    document.getElementById('btnCards')?.classList.toggle('active', on); // the Settings row
    if (on) { const f = document.getElementById('chatStream'); if (f && f.dataset.pipFilter) f.dataset.pipFilter = 'all'; }
    if (save) api?.storeSet?.('chatCards', on);
    annotate();
    if (on) stream.scrollTop = stream.scrollHeight;
  }
  window.setChatCards = (v) => setOn(v, true);
  window.chatCardsOn = () => on;

  new MutationObserver(() => { if (on) annotate(); }).observe(stream, { childList: true });
  const btn = document.getElementById('tbCards');
  if (btn) btn.addEventListener('click', (e) => { e.stopPropagation(); setOn(!on, true); });
  setOn(on, false);
})();
