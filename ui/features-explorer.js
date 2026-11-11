// Windows 7 Explorer-style address bar on the glass under the title bar:
//   (◀)(▶)  [ 🤖 AI HUD ▸ ovly-claude ▸ Chat title          ↻ ]  [ Search conversations 🔍 ]
// Back = to the contact list · Forward = re-open the last conversation.
// Breadcrumb segments are clickable. The search box drives the existing
// conversation search (features.js), whose own row in the list is hidden.
(function () {
  const card = document.getElementById('overlayCard');
  const header = card && card.querySelector('.pill-header');
  if (!header) return;


  const bar = el('div', 'explorer-bar');
  const nav = el('div', 'xb-nav');
  const back = el('button', 'xb-orb xb-back');
  back.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 3.5 5 8l4.5 4.5" /></svg>';
  back.title = 'Back to Contacts';
  const fwd = el('button', 'xb-orb xb-fwd');
  fwd.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 3.5 11 8l-4.5 4.5" /></svg>';
  nav.append(back, fwd);

  const addr = el('div', 'xb-address');
  const addrIco = el('span', 'xb-addr-ico');
  const crumbs = el('div', 'xb-crumbs');
  const refresh = el('button', 'xb-refresh', '↻');
  refresh.title = 'Refresh';
  addr.append(addrIco, crumbs, refresh);

  const search = el('div', 'xb-search');
  const sInput = el('input', 'xb-search-input');
  sInput.type = 'text';
  sInput.placeholder = 'Search conversations';
  sInput.spellcheck = false;
  const sIco = el('span', 'xb-search-ico');
  sIco.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="6.5" cy="6.5" r="4.2"/><path d="M9.6 9.6 14 14"/></svg>';
  search.append(sInput, sIco);

  bar.append(nav, addr, search);
  header.after(bar);
  document.body.classList.add('has-explorer-bar');

  // the bar is not part of the window-drag area: stop presses from reaching it
  bar.addEventListener('pointerdown', (e) => e.stopPropagation());

  // ---------- state ----------
  let lastChat = null; // last opened conversation (for Forward)
  const inChat = () => !!currentActiveSession;
  const inUsage = () => document.body.classList.contains('usage-open');

  function toList() {
    if (inChat() || inUsage()) showListView();
    if (!isExpanded) setExpanded(true);
  }

  back.addEventListener('click', () => { if (!back.disabled) toList(); });
  fwd.addEventListener('click', () => {
    if (fwd.disabled || !lastChat) return;
    const s = sessionsList.find((x) => x.id === lastChat.id) || lastChat;
    showDetailView(s);
  });
  refresh.addEventListener('click', () => {
    refresh.classList.add('spin');
    setTimeout(() => refresh.classList.remove('spin'), 500);
    try { renderSessionCards(true); } catch (_) {}
    if (currentActiveSession) try { updateConvoHeader(currentActiveSession); } catch (_) {}
  });

  // ---------- search → the existing conversation search ----------
  const fxInput = () => document.querySelector('.fx-search-input');
  function pushSearch() {
    const target = fxInput();
    if (!target) return;
    if (sInput.value.trim() && (inChat() || inUsage())) toList();
    target.value = sInput.value;
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }
  sInput.addEventListener('input', pushSearch);
  sInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      sInput.value = '';
      const t = fxInput();
      if (t) t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      sInput.blur();
    }
  });
  // features.js clears its box after opening a hit → mirror that
  setInterval(() => {
    const t = fxInput();
    if (t && !t.value && sInput.value && document.activeElement !== sInput) sInput.value = '';
  }, 500);

  // ---------- breadcrumb ----------
  function crumb(text, onClick, cls) {
    const c = el('button', 'xb-crumb' + (cls ? ' ' + cls : ''), text);
    c.title = text;
    if (onClick) c.addEventListener('click', onClick);
    else c.disabled = true;
    return c;
  }
  const sep = () => el('span', 'xb-sep', '▸');

  let shownKey = '';
  function update() {
    const s = currentActiveSession;
    if (s) lastChat = s;
    const view = s ? 'chat' : inUsage() ? 'usage' : 'list';
    const title = s ? (s.sessionTitle || 'Conversation') : '';
    const key = [view, s?.id, s?.project, title, lastChat?.id, isExpanded].join('|');
    if (key === shownKey) return;
    shownKey = key;

    back.disabled = view === 'list';
    fwd.disabled = view !== 'list' || !lastChat;
    fwd.title = lastChat ? `Forward to “${lastChat.sessionTitle || lastChat.project || 'conversation'}”` : 'Forward';

    // icon: the chat's robot, or the HUD sparkle
    if (s && typeof setRobotAvatar === 'function') setRobotAvatar(addrIco, s);
    else { addrIco.classList.remove('has-robot'); addrIco.textContent = '✦'; }

    crumbs.innerHTML = '';
    crumbs.append(sep(), crumb('AI HUD', view === 'list' ? null : toList));
    if (view === 'usage') crumbs.append(sep(), crumb('Usage', null, 'current'));
    else if (view === 'list') crumbs.append(sep(), crumb('Contacts', null, 'current'));
    else {
      crumbs.append(sep(), crumb(s.project || 'Folder', () => {
        // project segment → the list, filtered by searching the project name is too broad;
        // just open the contact list where that folder's group is
        toList();
      }));
      crumbs.append(sep(), crumb(title, null, 'current'));
    }
    // keep the end of the path visible when it is long
    crumbs.scrollLeft = crumbs.scrollWidth;
  }
  setInterval(update, 300);
  update();
})();
