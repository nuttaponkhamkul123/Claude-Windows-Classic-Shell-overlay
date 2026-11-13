// Vault rooms: right-click a room for New chat here / Open folder / Collapse / Hide,
// and double-click the floor to start a new chat in that room's workspace.
// (Right-clicking a robot or a drawer chip still opens the chat menu in features.js.)
(function () {
  const api = window.electronAPI;
  const menu = document.createElement('div');
  menu.className = 'fx-menu vault-room-menu';
  menu.style.display = 'none';
  document.body.appendChild(menu);
  const close = () => { menu.style.display = 'none'; };
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  window.addEventListener('blur', close);

  // the session a new chat copies its agent (and model) from
  const starterOf = (g) => g.sessions.find((s) => s.source === 'claude') ||
    g.sessions.find((s) => s.source === 'antigravity') || null;

  function newChatIn(g, x, y) {
    const from = starterOf(g);
    if (!from || !g.cwd) return false;
    if (typeof smokePuff === 'function' && x != null && !reducedMotion()) smokePuff(x, y, 40);
    setTimeout(() => startNewChat(from, from.source, g.cwd), x != null ? 260 : 0); // a new robot pops in…
    return true;
  }

  listView.addEventListener('contextmenu', (e) => {
    const room = e.target.closest('.vault-room');
    if (!room?.vaultGroup || e.target.closest('[data-sid]')) return;
    e.preventDefault();
    e.stopPropagation();
    const g = room.vaultGroup;
    const canChat = !!(g.cwd && starterOf(g));
    menu.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'vault-room-menu-head';
    head.textContent = g.name || 'Room';
    menu.appendChild(head);
    const item = (label, fn, enabled = true, hint = '') => {
      const b = document.createElement('button');
      b.className = 'fx-menu-item';
      b.textContent = label;
      b.disabled = !enabled;
      if (hint) b.title = hint;
      b.addEventListener('click', (ev) => { ev.stopPropagation(); close(); fn(); });
      menu.appendChild(b);
    };
    const noFolder = 'This room groups chats by status, not by folder';
    item('＋ New chat here', () => newChatIn(g), canChat, canChat ? `New chat in ${g.cwd}` : noFolder);
    item('📂 Open folder', () => api.openFolder?.(g.cwd), !!g.cwd, g.cwd || noFolder);
    if (typeof window.openFurnitureShop === 'function') {
      const wall = room.querySelector('.vault-wall')?.getBoundingClientRect();
      const pct = wall?.width ? ((e.clientX - wall.left) / wall.width) * 100 : 50;
      const at = { x: e.clientX, y: e.clientY };
      item('🪑 Furniture…', () => window.openFurnitureShop(g, pct, at.x, at.y), true, 'Add furniture to this room, or take pieces out');
    }
    if (typeof rerollWindowView === 'function' && (typeof vaultWindowsOn === 'undefined' || vaultWindowsOn)) {
      item('🪟 Change view', () => { rerollWindowView(g.windowKey, g.seed); renderSessionCards(true); },
        true, 'Show another scene through this room\'s window');
    }
    item('▸ Collapse room', () => {
      collapsedGroups.add(g.key);
      saveCollapsedGroups();
      renderSessionCards(true);
    }, true, 'Fold it to its name bar (click the bar to open it again)');
    item('🙈 Hide room', () => {
      hiddenRooms.add(g.key);
      saveHiddenRooms();
      renderSessionCards(true);
    }, true, 'Hide it from the Vault (the List view still shows it). "Show" at the bottom brings it back.');
    if (hiddenRooms.size) {
      item(`👁 Show hidden rooms (${hiddenRooms.size})`, () => { hiddenRooms.clear(); saveHiddenRooms(); renderSessionCards(true); });
    }
    menu.style.display = 'block';
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.max(4, Math.min(e.clientX, innerWidth - w - 4)) + 'px';
    menu.style.top = Math.max(4, Math.min(e.clientY, innerHeight - h - 4)) + 'px';
  }, true);

  // double-click the floor (not a robot, a bubble or the drawer) → new chat here
  listView.addEventListener('dblclick', (e) => {
    if (vaultFocus) return;
    const room = e.target.closest('.vault-room');
    if (!room?.vaultGroup || e.target.closest('.vault-walker, .vault-ask, .vault-say, button')) return;
    e.preventDefault();
    window.getSelection?.()?.removeAllRanges();
    if (!newChatIn(room.vaultGroup, e.clientX, e.clientY)) room.classList.add('vault-nope'), setTimeout(() => room.classList.remove('vault-nope'), 400);
  });
})();
