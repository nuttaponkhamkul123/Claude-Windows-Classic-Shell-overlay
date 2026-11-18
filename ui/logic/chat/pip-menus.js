// Shelter style: dropdowns open as full-screen Pip-Boy menus instead of small pop-ups (the look is in
// theme-shelter-pip.css, "Full-screen menus").
//
// While a chat is open, the tab bar along the bottom stays on screen under the menu: the open menu's tab is
// highlighted, Chat is not, and clicking another tab switches straight to that menu. Clicking Chat (or the
// open tab again, or Esc) goes back to the chat. When there is no tab bar (e.g. Settings opened from the
// contact list) a "‹ Back" key is added to the menu instead.
(function () {
  const TB = '#detailView .convo-toolbar';
  const PANELS = `${TB} > .mcp-panel, #usagePanel`;
  const TABS = ['tbSkills', 'tbRemote', 'tbNewChat', 'tbSettings', 'btnMcp', 'tbNotes']; // tabs that open a menu / window
  const shown = (p) => p.style.display !== 'none' && p.getClientRects().length > 0; // (offsetParent is null for fixed boxes)
  const shelter = () => document.body.classList.contains('style-shelter');
  const toolbar = () => document.querySelector(TB);

  // the toolbar menus close on a click on empty space (toolbar.js); MCP has no handler of its own
  function closeMenus() {
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const mcp = document.getElementById('mcpPanel');
    if (mcp) mcp.style.display = 'none';
    document.querySelectorAll(`${TB} > .tb-btn.open`).forEach((b) => b.classList.remove('open'));
  }
  // …plus Settings and Usage, which have their own close functions (app.js)
  function closeAll() {
    closeMenus();
    if (typeof closeSettingsPanel === 'function') closeSettingsPanel();
    if (typeof closeUsagePanel === 'function') closeUsagePanel();
  }
  let inBack = false;
  function back() {
    inBack = true;
    try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } // Usage and Settings close on Esc
    finally { inBack = false; }
    closeMenus();
  }
  // a full-screen menu needs Esc too (before, only the Skills filter box knew it)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || inBack || !shelter()) return;
    if ([...document.querySelectorAll(`${TB} > .mcp-panel`)].some(shown)) closeMenus();
  });

  // which tab owns the menu that is open now (null: none, or a menu that has no tab, like Model or Usage)
  function openTab() {
    const tb = toolbar();
    if (!tb) return null;
    const open = tb.querySelector(':scope > .tb-btn.open');
    if (open) return open;
    const mcp = document.getElementById('mcpPanel');
    return mcp && mcp.style.display !== 'none' ? document.getElementById('btnMcp') : null;
  }
  const anyMenuOpen = () =>
    [...document.querySelectorAll(PANELS)].some(shown) || !!document.querySelector('#settingsOverlay:not([style*="display: none"])');

  // clicking a tab: Chat (or a tab that has nothing to open) closes everything; another tab first closes
  // the menu that is open, then its own handler opens its menu; the open tab's own click toggles it shut
  document.addEventListener('click', (e) => {
    if (!shelter()) return;
    const t = e.target.closest(`${TB} > .tb-btn`);
    if (!t) return;
    if (t.classList.contains('pip-current')) { closeAll(); return; }
    if (!TABS.includes(t.id) || !anyMenuOpen()) return;
    if (t !== openTab()) closeAll();
  }, true);

  function tick() {
    const on = shelter();
    const tb = toolbar();
    const dv = document.getElementById('detailView');
    const tabs = on && tb && dv && dv.classList.contains('active') && tb.getClientRects().length > 0;
    document.body.classList.toggle('pip-tabs-on', !!tabs);
    if (tabs) {
      // where the menus must stop so the tab bar stays visible: just above the tallest tab key
      const tops = [...tb.querySelectorAll(':scope > .tb-btn')].filter((b) => b.getClientRects().length).map((b) => b.getBoundingClientRect().top);
      const gap = Math.max(40, Math.round(innerHeight - Math.min(...tops) + 4));
      if (document.body.dataset.pipGap !== String(gap)) {
        document.body.dataset.pipGap = String(gap);
        document.body.style.setProperty('--pip-tb-gap', gap + 'px');
      }
      // highlight: the open menu's tab, not Chat
      const owner = openTab();
      tb.querySelectorAll(':scope > .tb-btn.pip-on').forEach((b) => { if (b !== owner) b.classList.remove('pip-on'); });
      if (owner) owner.classList.add('pip-on');
      tb.classList.toggle('pip-away', !!owner || (document.querySelector('#settingsOverlay:not([style*="display: none"])') !== null));
    }
    if (!on) return;
    document.querySelectorAll(PANELS).forEach((p) => {
      if (!shown(p) || p.querySelector(':scope > .pip-menu-back')) return;
      const b = document.createElement('button');
      b.className = 'pip-menu-back';
      b.textContent = '‹ Back';
      b.title = 'Close (Esc)';
      b.addEventListener('click', (e) => { e.stopPropagation(); back(); });
      p.appendChild(b); // (panels that rebuild their contents get it again on the next tick)
    });
  }
  uiInterval(tick, 200);
})();
