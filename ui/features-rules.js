// Settings → Approval rules: review / delete the "Always allow" rules that were
// saved from approval cards (stored by main.js in ~/.ovly-claude/approval-rules.json).
(function () {
  const api = window.electronAPI;
  const settings = document.getElementById('settingsPanel');
  const header = document.querySelector('.detail-header');
  if (!api?.rulesList || !settings || !header) return;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // Settings row
  const row = el('button', 'set-row');
  row.id = 'btnRules';
  row.title = 'Tools and commands you chose "Always allow" for';
  row.append(el('span', 'set-ico', '🛡'), el('span', 'set-label', 'Approval rules'), el('span', 'set-val', ''));
  const sep = settings.querySelector('.set-sep');
  settings.insertBefore(row, sep || null);
  const countEl = row.querySelector('.set-val');

  // Panel
  const panel = el('div', 'mcp-panel rules-panel');
  panel.style.display = 'none';
  const head = el('div', 'mcp-panel-head');
  head.append(el('span', '', 'Always-allow rules'));
  const clear = el('button', 'mcp-refresh', 'Clear all');
  clear.title = 'Delete every saved rule';
  head.append(clear);
  const list = el('div', 'mcp-list');
  panel.append(head, list);
  header.appendChild(panel);

  function folderName(p) {
    const parts = String(p || '').split(/[\\/]/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : p;
  }

  function draw(rules) {
    countEl.textContent = rules.length ? String(rules.length) : '';
    list.innerHTML = '';
    if (!rules.length) {
      list.append(el('div', 'mcp-empty',
        'No rules yet.\nWhen Claude asks to use a tool, press “Always allow … here” on the approval card and it will be listed here.'));
      return;
    }
    for (const r of rules) {
      const item = el('div', 'mcp-row rule-row');
      const what = r.prefix ? `${r.tool}: ${r.prefix}…` : r.tool.replace(/^mcp__(.+?)__(.+)$/, '$1 › $2');
      const name = el('span', 'mcp-name', what);
      name.title = `${what}\nFolder: ${r.folder || 'any'}`;
      const where = el('span', 'mcp-status', folderName(r.folder) || 'any folder');
      where.title = r.folder || 'any folder';
      const del = el('button', 'mcp-refresh rule-del', '✕');
      del.title = 'Delete this rule — it will ask again';
      del.addEventListener('click', async (e) => { e.stopPropagation(); draw(await api.rulesDelete(r.id)); });
      item.append(name, where, del);
      list.appendChild(item);
    }
  }
  clear.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (confirm('Delete all saved always-allow rules?')) draw(await api.rulesClear());
  });

  async function refresh() { draw(await api.rulesList()); }
  row.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (typeof closeSettingsPanel === 'function') closeSettingsPanel();
    await refresh();
    panel.style.display = '';
  });
  document.addEventListener('click', (e) => {
    if (panel.style.display !== 'none' && !panel.contains(e.target) && e.target !== row) panel.style.display = 'none';
  });
  refresh(); // show the count in the Settings row
  setInterval(() => { if (panel.style.display === 'none') refresh(); }, 15000);
})();
