// Renamable agent name — per session. Click the name in the conversation
// header ("Claude" / "Antigravity") to name the agent in THIS chat only.
// Saved in ~/.ovly-claude/settings.json (sessionAgentNames); used for
// "<name> said", the header and the tag in the contact list.
(function () {
  const api = window.electronAPI;
  const nameEl = document.getElementById('convoName');
  if (!nameEl || typeof sessionAgentNames === 'undefined') return;
  const DEFAULTS = { claude: 'Claude', antigravity: 'Antigravity' };
  const defaultFor = (source) => (source === 'claude' ? DEFAULTS.claude : DEFAULTS.antigravity);
  const save = () => api.storeSet?.('sessionAgentNames', { ...sessionAgentNames });

  // Re-label everything on screen after a rename / on load
  function refreshLabels() {
    const s = currentActiveSession;
    if (s) {
      document.querySelectorAll('#chatStream .chat-bubble.assistant .bubble-meta .meta-name').forEach((n) => {
        n.textContent = agentLabel(s.source, s.id);
      });
      updateConvoHeader(s);
    }
    if (typeof renderSessionCards === 'function') renderSessionCards(true);
  }

  // Load saved per-session names. (An older version renamed every chat at
  // once — that global name is dropped, so all chats start from the default.)
  (api.storeGetAll ? api.storeGetAll() : Promise.resolve({})).then((store) => {
    const saved = store && store.sessionAgentNames;
    if (saved && typeof saved === 'object') {
      for (const [id, name] of Object.entries(saved)) {
        if (typeof name === 'string' && name.trim()) sessionAgentNames[id] = name.trim();
      }
    }
    if (store && store.agentNames && Object.keys(store.agentNames).length) api.storeSet?.('agentNames', {});
    refreshLabels();
  }).catch(() => {});

  // A New chat got its real id → keep the name you gave the draft
  api.onReplyRekey?.(({ oldId, newId }) => {
    if (sessionAgentNames[oldId]) {
      sessionAgentNames[newId] = sessionAgentNames[oldId];
      delete sessionAgentNames[oldId];
      save();
    }
  });

  nameEl.classList.add('renamable');
  nameEl.title = 'Click to rename the agent in this chat';

  nameEl.addEventListener('click', () => {
    const s = currentActiveSession;
    if (!s || nameEl.querySelector('input')) return;
    const def = defaultFor(s.source);
    const input = document.createElement('input');
    input.className = 'agent-rename';
    input.value = agentLabel(s.source, s.id);
    input.maxLength = 32;
    input.placeholder = def;
    input.title = `Name for this chat only · Enter to save · Esc to cancel · empty = back to ${def}`;
    nameEl.textContent = '';
    nameEl.appendChild(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (keep) => {
      if (done) return;
      done = true;
      if (keep) {
        const v = input.value.trim();
        if (v && v !== def) sessionAgentNames[s.id] = v;
        else delete sessionAgentNames[s.id];
        save();
      }
      nameEl.textContent = agentLabel(s.source, s.id);
      refreshLabels();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (e) => e.stopPropagation());
  });
})();
