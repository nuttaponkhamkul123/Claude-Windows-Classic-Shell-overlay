// Install skills from the HUD: "＋ Install…" in the Skills menu, or Settings → Install skill….
//   1. give a GitHub address (owner/repo, or a link to a folder in a repo), a folder or a .zip
//   2. pick which skills it contains (scripts are listed so you can judge them)
//   3. install for all your projects, or only for this chat's folder
// Also lists what is installed, with Remove. The work is done by skill-install-main.js.
(function () {
  const api = window.electronAPI;
  if (!api || !api.skillScan) return;

  const folderName = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
  const activeCwd = () => (typeof currentActiveSession !== 'undefined' && currentActiveSession && currentActiveSession.cwd) || '';

  let overlay = null;
  let scan = null; // { token, found }

  function close() {
    if (scan && scan.token) api.skillCancel(scan.token);
    scan = null;
    if (overlay) { overlay.remove(); overlay = null; }
  }

  function open() {
    if (overlay) return;
    overlay = el('div', 'sk-overlay');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    const dlg = el('div', 'sk-dialog');
    overlay.appendChild(dlg);

    const head = el('div', 'sk-head');
    head.append(el('span', 'sk-title', 'Install a skill'));
    const x = el('button', 'sk-x', '✕');
    x.title = 'Close';
    x.addEventListener('click', close);
    head.appendChild(x);

    const body = el('div', 'sk-body');
    dlg.append(head, body);

    // ---- source ----
    body.appendChild(el('div', 'sk-label', 'GitHub address, folder or .zip file'));
    const row = el('div', 'sk-row');
    const input = el('input', 'sk-input');
    input.type = 'text';
    input.placeholder = 'anthropics/skills   or   https://github.com/owner/repo/tree/main/skills/name';
    input.spellcheck = false;
    const scanBtn = el('button', 'sk-btn primary', 'Scan');
    row.append(input, scanBtn);
    body.appendChild(row);
    const pick = el('div', 'sk-row sk-pick');
    const bFolder = el('button', 'sk-btn', '📂 Choose folder…');
    const bZip = el('button', 'sk-btn', '🗜 Choose .zip…');
    pick.append(bFolder, bZip);
    body.appendChild(pick);
    const status = el('div', 'sk-status');
    body.appendChild(status);
    const results = el('div', 'sk-results');
    body.appendChild(results);

    const setStatus = (t, kind) => { status.textContent = t || ''; status.className = 'sk-status' + (kind ? ' ' + kind : ''); };

    async function doScan() {
      const src = input.value.trim();
      if (!src) { setStatus('Enter an address, or choose a folder or .zip.', 'err'); return; }
      if (scan && scan.token) api.skillCancel(scan.token);
      scan = null;
      results.textContent = '';
      scanBtn.disabled = true;
      setStatus('Looking for skills…');
      let res = null;
      try { res = await api.skillScan(src); } catch (e) { res = { ok: false, error: e.message }; }
      scanBtn.disabled = false;
      if (!res || !res.ok) { setStatus((res && res.error) || 'Could not read that source.', 'err'); return; }
      scan = res;
      setStatus(`Found ${res.found.length} skill${res.found.length === 1 ? '' : 's'}. Choose what to install.`);
      renderFound(res);
    }

    function renderFound(res) {
      results.textContent = '';
      const checks = [];
      const list = el('div', 'sk-list');
      for (const f of res.found) {
        const r = el('label', 'sk-item' + (f.problem ? ' bad' : ''));
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = !f.problem;
        cb.disabled = !!f.problem;
        cb.dataset.name = f.name;
        checks.push(cb);
        const main = el('div', 'sk-item-main');
        const top = el('div', 'sk-item-top');
        top.append(el('b', null, '/' + f.name), el('span', 'sk-meta', `${f.files} file${f.files === 1 ? '' : 's'} · ${f.kb} KB`));
        main.appendChild(top);
        if (f.description) main.appendChild(el('div', 'sk-desc', f.description));
        if (f.problem) main.appendChild(el('div', 'sk-warn', '⛔ Cannot be installed: ' + f.problem));
        else if (f.scripts.length) {
          main.appendChild(el('div', 'sk-warn', '⚠ Includes scripts the agent may run: ' + f.scripts.join(', ') + (f.moreScripts ? ` … +${f.moreScripts} more` : '')));
        }
        if (f.installedUser) main.appendChild(el('div', 'sk-note', 'Already installed for all projects — installing again replaces it.'));
        r.append(cb, main);
        list.appendChild(r);
      }
      results.appendChild(list);
      results.appendChild(el('div', 'sk-trust', 'A skill is instructions (and sometimes scripts) that Claude / Antigravity will follow. Only install skills from sources you trust.'));

      const cwd = activeCwd();
      const scopeRow = el('div', 'sk-scope');
      const mk = (group, val, label, checked, disabled) => {
        const l = el('label', 'sk-radio' + (disabled ? ' off' : ''));
        const r = el('input');
        r.type = 'radio'; r.name = group; r.value = val; r.checked = checked; r.disabled = !!disabled;
        l.append(r, document.createTextNode(' ' + label));
        return l;
      };
      scopeRow.append(
        mk('skScope', 'user', 'All my projects (user skills)', true, false),
        mk('skScope', 'project', cwd ? `Only “${folderName(cwd)}”` : 'Only this folder (open a chat first)', false, !cwd),
      );
      results.appendChild(scopeRow);

      const targetRow = el('div', 'sk-scope');
      targetRow.append(
        mk('skTarget', 'both', 'Both (Claude & Antigravity)', true, false),
        mk('skTarget', 'claude', 'Claude only', false, false),
        mk('skTarget', 'antigravity', 'Antigravity only', false, false),
      );
      results.appendChild(targetRow);

      const go = el('button', 'sk-btn primary wide', 'Install selected');
      go.addEventListener('click', async () => {
        const names = checks.filter((c) => c.checked).map((c) => c.dataset.name);
        if (!names.length) { setStatus('Tick at least one skill.', 'err'); return; }
        const scope = (scopeRow.querySelector('input:checked') || {}).value || 'user';
        const target = (targetRow.querySelector('input:checked') || {}).value || 'both';
        go.disabled = true;
        const out = await api.skillInstall({ token: scan.token, names, scope, target, cwd, overwrite: true });
        go.disabled = false;
        if (out && out.installed && out.installed.length) {
          setStatus(`✓ Installed ${out.installed.map((n) => '/' + n).join(', ')}. Available in new chats.`, 'ok');
          if (!out.errors.length) { scan = null; results.textContent = ''; }
          renderInstalled();
        } else {
          setStatus((out && (out.error || (out.errors || []).join('; '))) || 'Nothing was installed.', 'err');
        }
      });
      results.appendChild(go);
    }

    scanBtn.addEventListener('click', doScan);
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') doScan(); if (e.key === 'Escape') close(); });
    bFolder.addEventListener('click', async () => { const p = await api.skillPick('folder'); if (p) { input.value = p; doScan(); } });
    bZip.addEventListener('click', async () => { const p = await api.skillPick('zip'); if (p) { input.value = p; doScan(); } });

    // ---- installed ----
    const instHead = el('div', 'sk-label sk-inst-head', 'Installed skills');
    const inst = el('div', 'sk-installed');
    body.append(instHead, inst);

    async function renderInstalled() {
      inst.textContent = '';
      let list = [];
      try { list = (await api.skillList(activeCwd())) || []; } catch (_) {}
      if (!list.length) { inst.appendChild(el('div', 'sk-empty', 'None yet.')); return; }
      for (const s of list) {
        const r = el('div', 'sk-inst-row');
        const info = el('div', 'sk-inst-info');
        const top = el('div', 'sk-item-top');
        const agentBadge = s.target === 'antigravity' ? 'Antigravity' : 'Claude';
        top.append(
          el('b', null, '/' + s.name),
          el('span', 'sk-scope-tag', `${agentBadge} · ${s.scope === 'project' ? 'this folder' : 'all projects'}`)
        );
        info.appendChild(top);
        if (s.description) info.appendChild(el('div', 'sk-desc', s.description));
        const rm = el('button', 'sk-btn small', 'Remove');
        let armed = false;
        rm.addEventListener('click', async () => {
          if (!armed) { armed = true; rm.textContent = 'Sure?'; rm.classList.add('danger'); setTimeout(() => { armed = false; rm.textContent = 'Remove'; rm.classList.remove('danger'); }, 3000); return; }
          const out = await api.skillRemove({ name: s.name, scope: s.scope, target: s.target, cwd: activeCwd() });
          if (out && out.ok) renderInstalled(); else setStatus((out && out.error) || 'Could not remove it.', 'err');
        });
        r.append(info, rm);
        inst.appendChild(r);
      }
    }

    document.body.appendChild(overlay);
    renderInstalled();
    input.focus();
  }

  window.openSkillInstaller = open;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay) close(); });

  // Settings → "Install skill…"
  const panel = document.getElementById('settingsPanel');
  if (panel && !document.getElementById('btnInstallSkill')) {
    const b = el('button', 'set-row');
    b.id = 'btnInstallSkill';
    b.title = 'Install skills from GitHub, a folder or a .zip';
    b.innerHTML = '<span class="set-ico">🧩</span><span class="set-label">Install skill…</span><span class="set-val"></span>';
    b.addEventListener('click', () => { if (typeof closeSettingsPanel === 'function') closeSettingsPanel(); open(); });
    const sep = panel.querySelector('.set-sep');
    if (sep) sep.before(b); else panel.appendChild(b);
  }
})();
