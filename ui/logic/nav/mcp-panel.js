// MCP servers panel: list, add, remove, sign in. Moved out of app.js; loaded after logic/chat/slash.js, which
// declares btnMcp / mcpPanel / mcpList / btnMcpRefresh.
// ---- MCP servers panel ----
// "＋ Add server": http / sse (URL) or stdio (command + args), for all projects or this folder
function mcpAddForm(s) {
  const mk = (tag, cls, props) => Object.assign(document.createElement(tag), { className: cls || '' }, props || {});
  const box = mk('details', 'mcp-add');
  box.appendChild(mk('summary', '', { textContent: '＋ Add server' }));
  const type = mk('select', 'mcp-in');
  for (const [v, l] of [['http', 'HTTP (URL)'], ['sse', 'SSE (URL)'], ['stdio', 'Command']]) type.appendChild(mk('option', '', { value: v, textContent: l }));
  const name = mk('input', 'mcp-in', { placeholder: 'name (e.g. sentry)' });
  const target = mk('input', 'mcp-in', { placeholder: 'https://… or command' });
  const args = mk('input', 'mcp-in', { placeholder: 'arguments (command only)' });
  const scope = mk('select', 'mcp-in');
  for (const [v, l] of [['user', 'All my projects'], ['local', 'This folder (private)'], ['project', 'This folder (shared .mcp.json)']]) scope.appendChild(mk('option', '', { value: v, textContent: l }));
  const go = mk('button', 'mcp-act', { textContent: 'Add' });
  const msg = mk('div', 'mcp-hint');
  const sync = () => { args.style.display = type.value === 'stdio' ? '' : 'none'; };
  type.addEventListener('change', sync);
  sync();
  box.addEventListener('keydown', (e) => e.stopPropagation());
  go.addEventListener('click', async () => {
    go.disabled = true;
    msg.textContent = 'Adding…';
    const r = await window.electronAPI.mcpAdd({ transport: type.value, name: name.value.trim(), target: target.value, args: args.value, scope: scope.value, cwd: s?.cwd, source: s?.source });
    go.disabled = false;
    if (r.ok) loadMcp(true); else msg.textContent = r.message || 'Could not add it.';
  });
  box.append(type, name, target, args, scope, go, msg);
  return box;
}
async function loadMcp(refresh = false) {
  const s = currentActiveSession;
  const isAgy = s?.source === 'antigravity';
  mcpList.innerHTML = '<div class="mcp-empty">Checking servers… (this can take a few seconds)</div>';
  let result;
  try { result = await window.electronAPI.listMcpServers(s?.cwd, refresh, s?.source); }
  catch (e) { result = { servers: [], error: e.message }; }
  if (currentActiveSession !== s) return;

  mcpList.innerHTML = '';
  if (!result.servers || !result.servers.length) {
    const empty = document.createElement('div');
    empty.className = 'mcp-empty';
    empty.textContent = result.error ? `Couldn't run "${isAgy ? 'agy' : 'claude'} mcp list": ${result.error}` : (result.raw || 'No MCP servers configured.');
    mcpList.appendChild(empty);
    mcpList.appendChild(mcpAddForm(s));
    return;
  }
  for (const srv of result.servers) {
    const row = document.createElement('div');
    row.className = `mcp-row mcp-${srv.status}`;
    const dot = document.createElement('span');
    dot.className = 'mcp-dot';
    const name = document.createElement('span');
    name.className = 'mcp-name';
    name.textContent = srv.name;
    name.title = srv.detail;
    const st = document.createElement('span');
    st.className = 'mcp-status';
    st.textContent = srv.statusText;
    row.append(dot, name, st);
    const btn = (label, title, fn) => {
      const b = document.createElement('button');
      b.className = 'mcp-act';
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(b); });
      row.appendChild(b);
    };
    // needs sign-in / failed: open Claude Code / Antigravity to sign in or reconnect it
    if (srv.status === 'auth' || srv.status === 'failed') {
      btn('Sign in', `Opens ${isAgy ? 'Antigravity' : 'Claude Code'} in a console to sign in or reconnect`, () => window.electronAPI.mcpSignin({ cwd: s?.cwd, source: s?.source }));
    }
    // claude.ai connectors are managed on claude.ai, not by the CLI
    if (!/^claude\.ai\b/i.test(srv.name)) {
      btn('✕', 'Remove this server', async (b) => {
        if (b.textContent !== 'Sure?') { b.textContent = 'Sure?'; setTimeout(() => { b.textContent = '✕'; }, 3000); return; }
        const r = await window.electronAPI.mcpRemove({ name: srv.name, cwd: s?.cwd, source: s?.source });
        if (r.ok) loadMcp(true); else b.title = r.message || 'Could not remove';
      });
    }
    mcpList.appendChild(row);
  }
  mcpList.appendChild(mcpAddForm(s));
  const hint = document.createElement('div');
  hint.className = 'mcp-hint';
  hint.textContent = 'Replies sent from the HUD can use these. Tools that need permission will ask you here.';
  mcpList.appendChild(hint);
}

function openMcpPanel() {
  closeUsagePanel();
  mcpPanel.style.display = '';
  loadMcp(false);
}

btnMcp?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (mcpPanel.style.display === 'none') openMcpPanel();
  else mcpPanel.style.display = 'none';
});
btnMcpRefresh?.addEventListener('click', (e) => { e.stopPropagation(); loadMcp(true); });
document.addEventListener('click', (e) => {
  if (mcpPanel.style.display !== 'none' && !mcpPanel.contains(e.target) && e.target !== btnMcp) {
    mcpPanel.style.display = 'none';
  }
});
