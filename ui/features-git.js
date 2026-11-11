// Git panel in the conversation header (top right):
//   ⎇ branch            ↑ahead ↓behind
//   ● N changed · M new
//   👤 git user name
// Refreshes when a conversation opens and every 10 s while it is shown.
// Click = copy the branch name.
(function () {
  const api = window.electronAPI;
  const contact = document.querySelector('.convo-contact');
  if (!contact || !api.gitInfo) return;

  const box = el('div', 'git-box');
  box.style.display = 'none';
  contact.appendChild(box);

  let shownCwd = null;
  let lastJson = '';
  let busy = false;

  function render(info, cwd) {
    const json = JSON.stringify(info) + cwd;
    if (json === lastJson) return;
    lastJson = json;
    box.innerHTML = '';
    if (!info) {
      box.className = 'git-box git-none';
      box.appendChild(el('div', 'git-faint', 'Not a git repository'));
      box.title = cwd || '';
      return;
    }
    box.className = 'git-box';

    const l1 = el('div', 'git-line git-branch-line');
    l1.append(el('span', 'git-ico', '⎇'));
    const br = el('span', 'git-branch', info.branch);
    l1.appendChild(br);
    if (info.detached) l1.appendChild(el('span', 'git-tag', 'detached'));
    if (info.ahead) l1.appendChild(el('span', 'git-ahead', `↑${info.ahead}`));
    if (info.behind) l1.appendChild(el('span', 'git-behind', `↓${info.behind}`));

    const l2 = el('div', 'git-line');
    if (info.changed) {
      const tracked = info.changed - info.untracked;
      const parts = [];
      if (tracked) parts.push(`${tracked} changed`);
      if (info.untracked) parts.push(`${info.untracked} new`);
      l2.append(el('span', 'git-dirty-dot', '●'), el('span', 'git-dirty', parts.join(' · ')));
    } else {
      l2.append(el('span', 'git-clean-dot', '✓'), el('span', 'git-clean', 'Clean'));
    }
    if (!info.upstream && !info.detached) l2.appendChild(el('span', 'git-tag', 'not pushed'));

    const l3 = el('div', 'git-line git-user-line');
    l3.append(el('span', 'git-ico', '👤'));
    l3.appendChild(el('span', info.userName ? 'git-user' : 'git-user git-warn', info.userName || 'No git user set'));

    box.append(l1, l2, l3);
    box.title = [
      `Repository: ${info.repo}`,
      `Branch: ${info.branch}${info.detached ? ' (detached HEAD)' : ''}`,
      info.upstream ? `Tracking: ${info.upstream}${info.ahead ? ` · ${info.ahead} to push` : ''}${info.behind ? ` · ${info.behind} to pull` : ''}`
        : 'No upstream branch (not pushed yet)',
      info.changed ? `${info.changed} file(s) changed${info.staged ? `, ${info.staged} staged` : ''}${info.untracked ? `, ${info.untracked} untracked` : ''}` : 'Working tree clean',
      `Git user: ${info.userName || '(not set)'}${info.userEmail ? ` <${info.userEmail}>` : ''}`,
      '',
      'Click to copy the branch name',
    ].join('\n');
  }

  async function refresh(force) {
    const s = currentActiveSession;
    const visible = s && detailView.classList.contains('active') && s.cwd;
    if (!visible) { box.style.display = 'none'; shownCwd = null; return; }
    if (busy) return;
    if (!force && shownCwd === s.cwd && document.hidden) return;
    busy = true;
    try {
      const cwd = s.cwd;
      const info = await api.gitInfo(cwd);
      if (currentActiveSession?.cwd !== cwd) return; // switched meanwhile
      shownCwd = cwd;
      render(info, cwd);
      box.style.display = '';
      contact.classList.add('has-git');
    } catch (_) {
      box.style.display = 'none';
    } finally {
      busy = false;
    }
  }

  box.addEventListener('click', () => {
    const b = box.querySelector('.git-branch');
    if (!b) return;
    api.copyToClipboard(b.textContent);
    box.classList.add('copied');
    setTimeout(() => box.classList.remove('copied'), 900);
  });

  // When the open conversation changes → refresh now; otherwise every 10 s
  let lastKey = '';
  setInterval(() => {
    const s = currentActiveSession;
    const key = s && detailView.classList.contains('active') ? `${s.id}|${s.cwd}` : '';
    if (key !== lastKey) { lastKey = key; lastJson = ''; refresh(true); }
  }, 400);
  setInterval(() => refresh(false), 10000);
  // a reply just finished → files / commits probably changed
  api.onReplyStatus?.(({ status }) => { if (status === 'idle') setTimeout(() => refresh(true), 600); });
})();
