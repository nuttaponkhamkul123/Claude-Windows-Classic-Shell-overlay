// Shelter style: dropdowns open as full-screen Pip-Boy menus instead of small pop-ups (the look is in
// theme-shelter-pip.css, "Full-screen menus"). This file only adds a "‹ Back" key to the menus that
// have no close button of their own (Skills, Remote, New chat, Model, MCP, Usage). Back does what Esc
// already does for them. Other styles: nothing changes (the key is hidden there).
(function () {
  const PANELS = '#detailView .convo-toolbar > .mcp-panel, #usagePanel';
  const shown = (p) => p.style.display !== 'none' && p.getClientRects().length > 0; // (offsetParent is null for fixed boxes)

  // the toolbar menus close on a click on empty space (toolbar.js); MCP has no handler of its own
  function closeMenus() {
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const mcp = document.getElementById('mcpPanel');
    if (mcp) mcp.style.display = 'none';
    document.querySelectorAll('#detailView .convo-toolbar > .tb-btn.open').forEach((b) => b.classList.remove('open'));
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
    if (e.key !== 'Escape' || inBack || !document.body.classList.contains('style-shelter')) return;
    if ([...document.querySelectorAll('#detailView .convo-toolbar > .mcp-panel')].some(shown)) closeMenus();
  });

  function tick() {
    if (!document.body.classList.contains('style-shelter')) return;
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
  setInterval(tick, 200);
})();
