// Conversation toolbar extras (loaded after app.js):
//   "Skills ▾"   next to Effort — skills & custom commands for this folder
//   "📱 Remote ▾" next to MCP   — Claude Code Remote Control
(function () {
  const api = window.electronAPI;
  const toolbar = document.querySelector('.convo-toolbar');
  const tbModel = document.getElementById('tbModel');
  const btnMcpEl = document.getElementById('btnMcp');
  if (!toolbar || !tbModel) return;
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // Shown for both Claude Code and Antigravity conversations
  const tbSkills = el('button', 'tb-btn', 'Skills ▾');
  tbSkills.id = 'tbSkills';
  tbSkills.title = 'Skills & custom commands for this folder';
  tbModel.after(tbSkills);

  const tbRemote = el('button', 'tb-btn', '📱 Remote ▾');
  tbRemote.id = 'tbRemote';
  tbRemote.title = 'Remote Control: continue this conversation remotely';
  if (btnMcpEl) btnMcpEl.before(tbRemote); else toolbar.appendChild(tbRemote);

  // Both dropdowns reuse the MCP panel's look
  const skillsPanel = el('div', 'mcp-panel fx-drop');
  const remotePanel = el('div', 'mcp-panel fx-drop');
  for (const p of [skillsPanel, remotePanel]) {
    p.style.display = 'none';
    toolbar.appendChild(p);
    p.addEventListener('click', (e) => e.stopPropagation());
  }

  // "New chat ▾" → Claude Code or Antigravity
  const tbNewChat = document.getElementById('tbNewChat');
  const newChatPanel = el('div', 'mcp-panel fx-drop fx-newchat');
  newChatPanel.style.display = 'none';
  toolbar.appendChild(newChatPanel);
  newChatPanel.addEventListener('click', (e) => e.stopPropagation());
  if (tbNewChat) tbNewChat.textContent = 'New chat ▾';

  // "Model" in Antigravity chats → its own model list (`agy models`)
  const claudeModelPanel = el('div', 'mcp-panel fx-drop fx-claudemodel');
  claudeModelPanel.style.display = 'none';
  toolbar.appendChild(claudeModelPanel);
  claudeModelPanel.addEventListener('click', (e) => e.stopPropagation());
  const agyModelPanel = el('div', 'mcp-panel fx-drop fx-agymodel');
  agyModelPanel.style.display = 'none';
  toolbar.appendChild(agyModelPanel);
  agyModelPanel.addEventListener('click', (e) => e.stopPropagation());

  function closeAll() {
    for (const [p, b] of [[skillsPanel, tbSkills], [remotePanel, tbRemote], [newChatPanel, tbNewChat], [agyModelPanel, tbModel], [claudeModelPanel, tbModel]]) {
      if (!p || !b) continue;
      p.style.display = 'none';
      b.classList.remove('open');
    }
  }
  // Returns true if the panel is now open
  function togglePanel(panel, btn) {
    const wasOpen = panel.style.display !== 'none';
    closeAll();
    if (typeof closeSettingsPanel === 'function') closeSettingsPanel();
    const mcp = document.getElementById('mcpPanel');
    if (mcp) mcp.style.display = 'none';
    if (wasOpen) return false;
    panel.style.right = 'auto';
    panel.style.display = '';
    const maxLeft = toolbar.clientWidth - panel.offsetWidth - 2;
    panel.style.left = Math.max(0, Math.min(btn.offsetLeft, maxLeft)) + 'px';
    btn.classList.add('open');
    return true;
  }
  document.addEventListener('click', (e) => {
    if (e.target === tbSkills || e.target === tbRemote || e.target === tbNewChat || e.target === tbModel) return;
    if (![skillsPanel, remotePanel, newChatPanel, agyModelPanel, claudeModelPanel].some((p) => p.contains(e.target))) closeAll();
  });

  // ---------------- Claude Code: Model ▾ → pick a model, then its effort ----------------
  function renderClaudeModel(step, model) {
    const s = currentActiveSession;
    if (!s) return;
    const opts = getReplyOptions(s);
    const cmd = (n) => BUILTIN_COMMANDS.find((c) => c.name === n);
    claudeModelPanel.innerHTML = '';
    const head = el('div', 'mcp-panel-head');
    const list = el('div', 'fx-skill-list');
    const row = (value, desc, selected, onPick) => {
      const r = el('div', 'fx-skill-row fx-model-row' + (selected ? ' selected' : ''));
      const top = el('div', 'fx-skill-top');
      top.append(el('span', 'fx-model-check', selected ? '✓' : ''), el('span', 'fx-skill-name', value));
      r.appendChild(top);
      if (desc) r.appendChild(el('div', 'fx-skill-desc', desc));
      r.addEventListener('click', onPick);
      list.appendChild(r);
    };
    if (step === 'model') {
      head.append(el('span', null, 'Model'));
      for (const o of cmd('model').options) {
        row(o.value, o.description, (opts.model || 'default') === o.value, () => renderClaudeModel('effort', o.value));
      }
    } else {
      const back = el('button', 'tb-btn', '‹ Model');
      back.addEventListener('click', (e) => { e.stopPropagation(); renderClaudeModel('model'); });
      head.append(back, el('span', null, 'Effort · ' + model));
      for (const o of cmd('effort').options) {
        row(o.value, o.description, (opts.effort || 'default') === o.value, () => {
          if (model === 'default') delete opts.model; else opts.model = model;
          if (o.value === 'default') delete opts.effort; else opts.effort = o.value;
          closeAll();
          renderReplyOptions();
          addSystemNote(`Next replies: model ${model}, effort ${o.value}.`);
        });
      }
    }
    claudeModelPanel.append(head, list);
  }
  window.openClaudeModelMenu = function () {
    if (togglePanel(claudeModelPanel, tbModel)) renderClaudeModel('model');
  };

  // ---------------- Antigravity model + effort picker ----------------
  let agyModels = null;
  async function renderAgyModels(step = 'model', chosenModel = null) {
    const s = currentActiveSession;
    if (!s) return;
    const opts = getReplyOptions(s);
    agyModelPanel.innerHTML = '';
    const head = el('div', 'mcp-panel-head');
    const list = el('div', 'fx-skill-list');

    if (step === 'effort') {
      const back = el('button', 'tb-btn', '‹ Model');
      back.addEventListener('click', (e) => { e.stopPropagation(); renderAgyModels('model'); });
      head.append(back, el('span', null, 'Effort · ' + (chosenModel?.label || 'Default')));
      agyModelPanel.append(head, list);
      const efforts = [
        { value: 'default', description: 'Default effort for this model' },
        { value: 'low', description: 'Fastest, minimal reasoning' },
        { value: 'medium', description: 'Balanced speed and reasoning' },
        { value: 'high', description: 'Deeper reasoning for harder tasks' },
        { value: 'xhigh', description: 'Extended deep reasoning' },
        { value: 'max', description: 'Maximum thinking budget' },
      ];
      for (const ef of efforts) {
        const selected = (opts.effort || 'default') === ef.value;
        const r = el('div', 'fx-skill-row fx-model-row' + (selected ? ' selected' : ''));
        const top = el('div', 'fx-skill-top');
        top.append(el('span', 'fx-model-check', selected ? '✓' : ''), el('span', 'fx-skill-name', ef.value));
        r.appendChild(top);
        r.appendChild(el('div', 'fx-skill-desc', ef.description));
        r.addEventListener('click', () => {
          if (chosenModel?.id) opts.model = chosenModel.id; else delete opts.model;
          if (ef.value === 'default') delete opts.effort; else opts.effort = ef.value;
          closeAll();
          renderReplyOptions();
          addSystemNote(`Next Antigravity replies: model ${chosenModel?.label || 'default'}, effort ${ef.value}.`);
        });
        list.appendChild(r);
      }
      return;
    }

    head.append(el('span', null, 'Antigravity model'));
    const efBtn = el('button', 'tb-btn fx-skill-install', `Effort: ${opts.effort || 'default'} ▸`);
    efBtn.title = 'Choose reasoning effort level';
    efBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const curM = (agyModels || []).find((m) => m.id === opts.model);
      renderAgyModels('effort', { id: opts.model || '', label: curM ? curM.name : (opts.model || 'Default') });
    });
    head.appendChild(efBtn);
    agyModelPanel.append(head, list);

    if (!agyModels) {
      list.appendChild(el('div', 'mcp-empty', 'Loading models…'));
      try { agyModels = await api.agyModels?.(); } catch (_) { agyModels = []; }
      list.innerHTML = '';
    }
    const pick = (id, label) => {
      if (id) opts.model = id; else delete opts.model;
      closeAll();
      renderReplyOptions();
      addSystemNote(id ? `Model set to ${label} for your next messages in this chat.` : 'Model reset — Antigravity uses its default.');
    };
    const row = (id, label, sub) => {
      const r = el('div', 'fx-skill-row fx-model-row' + ((opts.model || '') === id ? ' selected' : ''));
      const top = el('div', 'fx-skill-top');
      top.append(el('span', 'fx-model-check', (opts.model || '') === id ? '✓' : ''), el('span', 'fx-skill-name', label));
      r.appendChild(top);
      if (sub) r.appendChild(el('div', 'fx-skill-desc', sub));
      r.addEventListener('click', () => pick(id, label));
      list.appendChild(r);
    };
    row('', 'Default', 'Whatever Antigravity is set to use');
    if (!agyModels || !agyModels.length) {
      list.appendChild(el('div', 'mcp-empty', 'Could not read the model list (is the agy CLI installed?).'));
      return;
    }
    for (const m of agyModels) row(m.id, m.name, m.id);
  }
  window.openAgyModelMenu = function () {
    if (!tbModel) return;
    if (togglePanel(agyModelPanel, tbModel)) renderAgyModels('model');
  };

  // ---------------- New chat: pick the folder + the agent ----------------
  // Recent folders = folders you picked here (saved) + folders of known sessions.
  let recentPicked = [];
  (api.storeGetAll ? api.storeGetAll() : Promise.resolve({})).then((st) => {
    if (Array.isArray(st?.newChatFolders)) recentPicked = st.newChatFolders.filter((p) => typeof p === 'string');
  }).catch(() => {});
  const folderName = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || String(p || '');
  const samePath = (a, b) => String(a || '').replace(/[\\/]+$/, '').toLowerCase() === String(b || '').replace(/[\\/]+$/, '').toLowerCase();
  function recentFolders(exclude) {
    const out = [];
    const add = (p) => { if (p && !samePath(p, exclude) && !out.some((q) => samePath(q, p))) out.push(p); };
    recentPicked.forEach(add);
    [...(sessionsList || [])].filter((x) => x && x.cwd && (x.source === 'claude' || x.source === 'antigravity'))
      .sort((a, b) => (b.mtime || 0) - (a.mtime || 0)).forEach((x) => add(x.cwd));
    return out.slice(0, 6);
  }
  function rememberFolder(p) {
    recentPicked = [p, ...recentPicked.filter((q) => !samePath(q, p))].slice(0, 10);
    api.storeSet?.('newChatFolders', recentPicked);
  }

  // Fills `panel` with the New-chat menu. `s` = open conversation (or null).
  function renderNewChatInto(panel, s, close) {
    let folder = s?.cwd || recentPicked[0] || '';
    const draw = () => {
      panel.innerHTML = '';
      const head = el('div', 'mcp-panel-head');
      head.append(el('span', null, 'New chat'));
      panel.appendChild(head);

      // Folder: current choice + "Change…"
      panel.appendChild(el('div', 'fx-skill-group', 'Folder'));
      const cur = el('div', 'fx-nc-folder');
      cur.append(el('span', 'fx-nc-folder-ico', '📁'));
      const txt = el('div', 'fx-nc-folder-text');
      txt.append(el('div', 'fx-nc-folder-name', folder ? folderName(folder) : 'No folder chosen'),
        el('div', 'fx-nc-folder-path', folder || 'Pick the folder the agent should work in'));
      cur.append(txt);
      const btn = el('button', 'fx-nc-browse', 'Change…');
      btn.title = 'Choose any folder on this PC';
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const picked = await api.pickFolder?.(folder);
        if (picked) { folder = picked; draw(); }
      });
      cur.append(btn);
      panel.appendChild(cur);

      const recents = recentFolders(folder);
      if (recents.length) {
        const list = el('div', 'fx-nc-recents');
        for (const p of recents) {
          const r = el('div', 'fx-nc-recent', folderName(p));
          r.title = p;
          r.addEventListener('click', () => { folder = p; draw(); });
          list.appendChild(r);
        }
        panel.appendChild(list);
      }

      // Agent
      panel.appendChild(el('div', 'fx-skill-group', 'Start with'));
      const option = (agent, label, desc) => {
        const row = el('div', 'fx-skill-row fx-newchat-row' + (folder ? '' : ' disabled'));
        const top = el('div', 'fx-skill-top');
        top.append(el('span', `fx-newchat-ico ${agent}`), el('span', 'fx-skill-name', label));
        if (s?.source === agent) top.appendChild(el('span', 'fx-skill-scope', 'current'));
        row.append(top, el('div', 'fx-skill-desc', desc));
        row.addEventListener('click', async () => {
          if (!folder) return;
          if (api.folderExists && !(await api.folderExists(folder))) {
            row.querySelector('.fx-skill-desc').textContent = '⚠ That folder no longer exists — pick another one.';
            return;
          }
          if (!s || !samePath(folder, s.cwd)) rememberFolder(folder);
          close();
          const keep = s && (s.source === 'claude' || s.source === 'antigravity') ? s : null;
          startNewChat(keep, agent, keep && samePath(folder, keep.cwd) ? undefined : folder);
        });
        panel.appendChild(row);
      };
      option('claude', 'Claude Code', 'Fresh Claude Code conversation' + (s?.source === 'claude' ? ' (keeps your Model / Effort choice).' : '.'));
      option('antigravity', 'Antigravity', 'Fresh Antigravity conversation' + (s?.source === 'antigravity' ? ' (keeps your Model / Effort choice).' : ', using its default model.'));
    };
    draw();
  }
  window.openNewChatMenu = function () {
    if (!tbNewChat) return;
    if (togglePanel(newChatPanel, tbNewChat)) renderNewChatInto(newChatPanel, currentActiveSession, closeAll);
  };

  // Same menu from the contact list (footer "＋ New chat"), no conversation open
  const footer = document.querySelector('#listView .popup-footer');
  if (footer) {
    const listBtn = el('button', 'btn-action primary fx-nc-listbtn', '＋ New chat');
    listBtn.title = 'Start a new conversation in any folder';
    footer.appendChild(listBtn);
    const listPanel = el('div', 'mcp-panel fx-drop fx-newchat fx-nc-up');
    listPanel.style.display = 'none';
    footer.appendChild(listPanel);
    listPanel.addEventListener('click', (e) => e.stopPropagation());
    const hide = () => { listPanel.style.display = 'none'; listBtn.classList.remove('open'); };
    listBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (listPanel.style.display !== 'none') { hide(); return; }
      renderNewChatInto(listPanel, null, hide);
      listPanel.style.display = '';
      listBtn.classList.add('open');
    });
    document.addEventListener('click', (e) => { if (!listPanel.contains(e.target) && e.target !== listBtn) hide(); });
  }

  // ---------------- Skills ----------------
  const skillsHead = el('div', 'mcp-panel-head');
  skillsHead.append(el('span', null, 'Skills & commands'));
  const skInstall = el('button', 'tb-btn fx-skill-install', '＋ Install…');
  skInstall.title = 'Install a skill from GitHub, a folder or a .zip';
  skInstall.addEventListener('click', (e) => { e.stopPropagation(); closeAll(); if (window.openSkillInstaller) window.openSkillInstaller(); });
  skillsHead.appendChild(skInstall);
  const skillFilter = el('input', 'fx-skill-filter');
  skillFilter.placeholder = 'Filter…';
  const skillList = el('div', 'fx-skill-list');
  skillsPanel.append(skillsHead, skillFilter, skillList);

  let skillItems = [];
  function renderSkillList() {
    const q = skillFilter.value.trim().toLowerCase();
    const shown = skillItems.filter((c) => !q || c.name.toLowerCase().includes(q) ||
      String(c.description || '').toLowerCase().includes(q));
    skillList.innerHTML = '';
    if (!shown.length) {
      const isAg = currentActiveSession?.source === 'antigravity';
      skillList.appendChild(el('div', 'mcp-empty', skillItems.length
        ? 'No match.'
        : isAg
          ? 'No skills or workflows found.\nAdd them in .agents/skills/<name>/SKILL.md\nor ~/.gemini/config/skills/<name>/SKILL.md'
          : 'No skills or custom commands found.\nAdd them in .claude/skills/<name>/SKILL.md\nor .claude/commands/<name>.md'));
      return;
    }
    for (const [kind, label] of [['skill', 'Skills'], ['command', 'Commands & Workflows']]) {
      const group = shown.filter((c) => (c.kind || 'command') === kind);
      if (!group.length) continue;
      skillList.appendChild(el('div', 'fx-skill-group', label));
      for (const c of group) {
        const row = el('div', 'fx-skill-row');
        const top = el('div', 'fx-skill-top');
        const scopeLabel = c.scope === 'project' ? 'project' : c.scope === 'builtin' ? 'built-in' : 'user';
        top.append(el('span', 'fx-skill-name', '/' + c.name),
          el('span', 'fx-skill-scope', scopeLabel));
        row.appendChild(top);
        if (c.description) row.appendChild(el('div', 'fx-skill-desc', c.description));
        row.title = 'Click to put it in the message box';
        row.addEventListener('click', () => {
          closeAll();
          replyTextarea.value = `/${c.name} `;
          replyTextarea.focus();
          const end = replyTextarea.value.length;
          replyTextarea.setSelectionRange(end, end);
        });
        skillList.appendChild(row);
      }
    }
  }
  skillFilter.addEventListener('input', renderSkillList);
  skillFilter.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAll();
    if (e.key === 'Enter') skillList.querySelector('.fx-skill-row')?.click();
  });

  tbSkills.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!togglePanel(skillsPanel, tbSkills)) return;
    skillFilter.value = '';
    skillList.innerHTML = '';
    skillList.appendChild(el('div', 'mcp-empty', 'Loading…'));
    try {
      skillItems = await loadSlashCommands(currentActiveSession?.cwd || '', true, currentActiveSession?.source);
    } catch (_) { skillItems = []; }
    renderSkillList();
    skillFilter.focus();
  });

  // ---------------- Remote Control ----------------
  function renderRemote() {
    const s = currentActiveSession;
    const isAg = s?.source === 'antigravity';
    remotePanel.innerHTML = '';
    const head = el('div', 'mcp-panel-head');
    head.append(el('span', null, isAg ? 'Antigravity Remote Control' : 'Remote Control'));
    remotePanel.appendChild(head);

    const title = String(s?.sessionTitle || s?.project || 'HUD').slice(0, 50);
    const uuid = s && !s.draft ? (s.sessionUuid || String(s.id || '').replace(/^(claude|antigravity)_/, '')) : '';

    const option = (label, desc, run, disabled) => {
      const row = el('div', 'fx-skill-row fx-remote-row' + (disabled ? ' disabled' : ''));
      row.append(el('div', 'fx-skill-name', label), el('div', 'fx-skill-desc', desc));
      if (!disabled) row.addEventListener('click', run);
      remotePanel.appendChild(row);
    };
    const start = async (opts, okMsg) => {
      closeAll();
      let r = null;
      try {
        r = await api.remoteControl?.({ ...opts, source: s?.source, appDataDir: s?.appDataDir });
      } catch (e) { r = { ok: false, error: e.message }; }
      replyStatusMsg.textContent = r?.ok ? okMsg : `⚠ ${r?.error || 'Could not start Remote Control'}`;
    };

    option('📱 Continue this conversation remotely',
      uuid
        ? (isAg
          ? 'Opens this chat in an Antigravity CLI window with Remote Control (--remote-control) enabled.'
          : 'Opens this chat in a Claude Code window with Remote Control on. Then pick it in claude.ai/code or the Claude app.')
        : 'Send a first message to start this conversation, then try again.',
      () => start({ mode: 'resume', cwd: s?.cwd, uuid, name: title },
        isAg
          ? '📱 Antigravity Remote Control window opened.'
          : '📱 Remote Control window opened. Open claude.ai/code or the Claude app to continue.'),
      !uuid);
    option('🗂 Remote Control for this folder',
      isAg
        ? 'Starts the Antigravity Remote Control daemon for this workspace folder.'
        : 'Runs a Remote Control server here, so you can start new sessions in this folder from your phone.',
      () => start({ mode: 'folder', cwd: s?.cwd, name: s?.project || 'HUD' },
        '🗂 Remote Control server started for this folder.'));
    remotePanel.appendChild(el('div', 'mcp-hint',
      'Keep the window that opens running while you use it remotely.\n' +
      'If this chat is also open in another window, close that one first so both are not writing to it.'));
  }
  tbRemote.addEventListener('click', (e) => {
    e.stopPropagation();
    if (togglePanel(remotePanel, tbRemote)) renderRemote();
  });
})();
