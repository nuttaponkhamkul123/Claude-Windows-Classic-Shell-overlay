// Work style layout: chat list as a sidebar on the left, the open chat on the
// right (like Slack / Teams), instead of the Explorer address bar + one view
// at a time. All the looks are in theme-work.css (body.style-work); this file
// only does what CSS can't:
//  - moves the conversation search box from the address bar into the sidebar
//    (and back when you leave Work style),
//  - highlights the open chat's row,
//  - a "‹ Chats" button for narrow windows, where only one pane fits.
(function () {
  const listView = document.getElementById('listView');
  const detailView = document.getElementById('detailView');
  const listToolbar = document.getElementById('listToolbar');
  const container = document.getElementById('sessionsContainer');
  const convoToolbar = detailView?.querySelector('.convo-toolbar');
  if (!listView || !detailView || !container) return;

  // ---- search box: address bar ⇄ sidebar ----
  const search = document.querySelector('.explorer-bar .xb-search');
  const home = search && { parent: search.parentElement, next: search.nextSibling };
  function placeSearch(work) {
    if (!search) return;
    if (work && search.parentElement !== listView) listToolbar.after(search);
    else if (!work && search.parentElement === listView) home.parent.insertBefore(search, home.next);
  }

  // ---- highlight the open chat in the list (+ replay the pane's enter animation on switch) ----
  let shownId = null;
  function markActive() {
    const id = detailView.classList.contains('active') && typeof currentActiveSession !== 'undefined' && currentActiveSession
      ? currentActiveSession.id : null;
    if (id && id !== shownId) {
      detailView.classList.remove('wk-enter');
      void detailView.offsetWidth; // restart the CSS animation
      detailView.classList.add('wk-enter');
    }
    shownId = id;
    container.querySelectorAll('.session-row.wk-active').forEach((r) => { if (r.id !== `card-${id}`) r.classList.remove('wk-active'); });
    if (id) document.getElementById(`card-${id}`)?.classList.add('wk-active');
  }
  new MutationObserver(markActive).observe(container, { childList: true, subtree: true });
  new MutationObserver(markActive).observe(detailView, { attributes: true, attributeFilter: ['class'] });

  // ---- narrow window: back to the list ----
  if (convoToolbar) {
    const back = document.createElement('button');
    back.className = 'tb-btn wk-back';
    back.textContent = '‹ Chats';
    back.title = 'Back to the chat list';
    back.addEventListener('click', (e) => { e.stopPropagation(); if (typeof showListView === 'function') showListView(); });
    convoToolbar.prepend(back);
  }

  // ---- "working…" dots at the end of the chat while the agent is busy ----
  // Shown whenever the activity line is (from the moment you press Send until
  // the reply is done), and kept as the last thing in the chat.
  const stream = document.getElementById('chatStream');
  const activityRow = document.getElementById('activityRow');
  const typing = document.createElement('div');
  typing.className = 'wk-typing';
  typing.innerHTML = '<span class="wk-dots"><i></i><i></i><i></i></span><span class="wk-typing-text"></span>';
  const typingText = typing.querySelector('.wk-typing-text');
  function syncTyping() {
    if (!stream || !activityRow) return;
    const busy = activityRow.style.display !== 'none' && detailView.classList.contains('active');
    if (!busy) { if (typing.parentElement) typing.remove(); return; }
    const verb = document.getElementById('activityVerb')?.textContent.trim();
    typingText.textContent = verb || 'Working…';
    if (stream.lastElementChild !== typing) {
      const nearBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 80;
      stream.appendChild(typing);
      if (nearBottom) stream.scrollTop = stream.scrollHeight;
    }
  }
  if (stream && activityRow) {
    new MutationObserver(syncTyping).observe(activityRow, { attributes: true, attributeFilter: ['style'], childList: true, subtree: true, characterData: true });
    new MutationObserver(syncTyping).observe(stream, { childList: true });
    new MutationObserver(syncTyping).observe(detailView, { attributes: true, attributeFilter: ['class'] });
  }

  // empty chat pane (no chat open yet)
  const empty = document.createElement('div');
  empty.className = 'wk-empty';
  empty.innerHTML = '<div class="wk-empty-title">No chat open</div><div class="wk-empty-sub">Pick a chat on the left, or start a new one.</div>';
  detailView.after(empty);

  // ---- follow the style switch ----
  let was = null;
  function sync() {
    const work = document.body.classList.contains('style-work');
    if (work === was) return;
    was = work;
    placeSearch(work);
    markActive();
  }
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  sync();
})();
