// Workspace line in the conversation header (under the chat title):
//   📁 ovly-claude   C:\Users\…\Desktop\ovly-claude
// Click = open the folder in Explorer · right-click = copy the full path.
(function () {
  const api = window.electronAPI;
  const personal = document.getElementById('convoPersonal');
  if (!personal) return;

  const line = document.createElement('div');
  line.className = 'convo-workspace';
  line.style.display = 'none';
  const ico = document.createElement('span');
  ico.className = 'ws-ico';
  ico.textContent = '📁';
  const name = document.createElement('span');
  name.className = 'ws-name';
  const full = document.createElement('span');
  full.className = 'ws-path';
  line.append(ico, name, full);
  personal.after(line);

  // C:\Users\nuttapon\Desktop\x → ~\Desktop\x (keeps the line short)
  function shortPath(p) {
    const s = String(p || '');
    const m = s.match(/^[a-zA-Z]:[\\/]Users[\\/][^\\/]+(.*)$/);
    return m ? '~' + m[1] : s;
  }

  let shown = '';
  function update() {
    const s = currentActiveSession;
    const cwd = s && detailView.classList.contains('active') ? (s.cwd || '') : '';
    const key = cwd + '|' + (s?.project || '');
    if (key === shown) return;
    shown = key;
    if (!cwd) { line.style.display = 'none'; return; }
    const folder = cwd.split(/[\\/]/).filter(Boolean).pop() || cwd;
    name.textContent = folder;
    full.textContent = shortPath(cwd);
    line.title = `Workspace: ${cwd}\nClick to open in Explorer · right-click to copy the path`;
    line.style.display = '';
  }
  setInterval(update, 400);

  line.addEventListener('click', async () => {
    const cwd = currentActiveSession?.cwd;
    if (!cwd) return;
    const ok = await api.openFolder?.(cwd);
    if (!ok) replyStatusMsg.textContent = '⚠ That folder no longer exists';
  });
  line.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const cwd = currentActiveSession?.cwd;
    if (!cwd) return;
    api.copyToClipboard(cwd);
    line.classList.add('copied');
    setTimeout(() => line.classList.remove('copied'), 900);
  });
})();
