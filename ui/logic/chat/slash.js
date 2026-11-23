// Reply options for the next message (model / effort / new conversation), HUD slash commands (/model /effort /clear
// /mcp /handoff /help), the "/" autocomplete menu, and starting a new chat. Moved out of app.js; loaded right
// after it (it hooks listeners onto replyTextarea, which app.js defines).
// Tool-approval prompts stay in app.js.
// ===========================================================================
// Claude commands, MCP servers & tool approvals
// ===========================================================================
const replyOptionsEl = document.getElementById('replyOptions');
const slashMenu = document.getElementById('slashMenu');
const btnMcp = document.getElementById('btnMcp');
const mcpPanel = document.getElementById('mcpPanel');
const mcpList = document.getElementById('mcpList');
const btnMcpRefresh = document.getElementById('btnMcpRefresh');

const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
const MODEL_ALIASES = ['opus', 'sonnet', 'haiku', 'fable', 'opusplan'];

// Commands the HUD handles itself (they only exist in the interactive CLI)
// or passes straight through to `claude -p`.
// Commands with `options` open a nested choice list when picked.
const BUILTIN_COMMANDS = [
  {
    name: 'model', args: '›', description: 'Model for your next replies in this session', kind: 'hud',
    current: (s, o) => o.model || 'default',
    options: [
      { value: 'default', description: 'Use the session’s model' },
      { value: 'opus', description: 'Most capable' },
      { value: 'sonnet', description: 'Fast and capable' },
      { value: 'haiku', description: 'Fastest' },
      { value: 'fable', description: 'Fable' },
      { value: 'opusplan', description: 'Opus plans · Sonnet executes (use with 📝 Plan)' },
    ],
  },
  {
    name: 'effort', args: '›', description: 'Reasoning effort for your next replies', kind: 'hud',
    current: (s, o) => o.effort || 'default',
    options: [
      { value: 'default', description: 'Use the session’s effort' },
      { value: 'low', description: 'Quickest answers' },
      { value: 'medium', description: 'Balanced' },
      { value: 'high', description: 'Think harder' },
      { value: 'xhigh', description: 'Think much harder' },
      { value: 'max', description: 'Maximum reasoning' },
    ],
  },
  { name: 'clear', args: '', description: 'Open a new, empty conversation in the same folder', kind: 'hud' },
  { name: 'handoff', args: '', description: 'Summarise this chat and continue in a fresh one (keeps long chats cheap)', kind: 'hud' },
  { name: 'mcp', args: '', description: 'Show MCP servers and their status', kind: 'hud' },
  { name: 'help', args: '', description: 'List available commands', kind: 'hud' },
  { name: 'compact', args: '[instructions]', description: 'Summarize the conversation to free up context', kind: 'claude' },
  { name: 'init', args: '', description: 'Create a CLAUDE.md for this project', kind: 'claude' },
  { name: 'plan', args: '[goal]', description: 'Step-by-step planning before execution', kind: 'antigravity' },
  { name: 'goal', args: '[goal]', description: 'Thorough autonomous execution until the goal is achieved', kind: 'antigravity' },
  { name: 'boost', args: '[task]', description: 'Deep thinking, strategic planning & rigorous verification', kind: 'antigravity' },
  { name: 'teamwork', args: '[task]', description: 'Coordinate a swarm of autonomous agents in parallel', kind: 'antigravity' },
  { name: 'grill-me', args: '[topic]', description: 'Interactive interview to resolve design decisions', kind: 'antigravity' },
  { name: 'schedule', args: '[when]', description: 'Run an instruction on a recurring schedule or timer', kind: 'antigravity' },
  { name: 'browser', args: '[task]', description: 'Browse or interact with web applications', kind: 'antigravity' },
  { name: 'learn', args: '[lesson]', description: 'Persist a workflow or correction for future tasks', kind: 'antigravity' },
];

// ---- per-session overrides for the next reply ----
const replyOptions = new Map(); // sessionId -> { model, effort, newSession }

function getReplyOptions(session) {
  if (!session) return {};
  if (!replyOptions.has(session.id)) replyOptions.set(session.id, {});
  return replyOptions.get(session.id);
}

// Options to send with this reply; /clear only applies once
function takeReplyOptions(session) {
  if (!session) return {};
  if (session.source !== 'claude' && session.source !== 'antigravity' && session.source !== 'opencode') return {};
  const opts = getReplyOptions(session);
  const out = { model: opts.model, effort: opts.effort, newSession: !!opts.newSession, plan: !!opts.plan };
  // Plan first: the planning message always uses the plan model, and the
  // "implement it" message right after approval uses the execute model (one-shot)
  if (opts.oneShotModel) { out.model = opts.oneShotModel; delete opts.oneShotModel; }
  else if (opts.plan && session.source === 'claude' && window.fxPlanModels) out.model = window.fxPlanModels.plan;
  // "This message only" effort from the Model menu
  if (opts.oneShotEffort) { out.effort = opts.oneShotEffort; delete opts.oneShotEffort; }
  if (session.draft && !session.draftSent) { out.newSession = true; session.draftSent = true; }
  opts.newSession = false;
  renderReplyOptions();
  return out;
}

function renderReplyOptions() {
  if (!replyOptionsEl) return;
  const s = currentActiveSession;
  const opts = s && (s.source === 'claude' || s.source === 'antigravity' || s.source === 'opencode') ? getReplyOptions(s) : {};
  replyOptionsEl.innerHTML = '';
  const chips = [];
  if (opts.oneShotModel) chips.push({ key: 'oneShotModel', label: `This message: ${opts.oneShotModel}` });
  if (opts.oneShotEffort) chips.push({ key: 'oneShotEffort', label: `This message: effort ${opts.oneShotEffort}` });
  if (opts.model) chips.push({ key: 'model', label: `Model: ${opts.model}` });
  if (opts.effort) chips.push({ key: 'effort', label: `Effort: ${opts.effort}` });
  if (opts.newSession) chips.push({ key: 'newSession', label: 'Next message starts a new conversation' });
  if (!chips.length) { replyOptionsEl.style.display = 'none'; return; }

  const lead = document.createElement('span');
  lead.className = 'reply-options-lead';
  lead.textContent = 'Next reply:';
  replyOptionsEl.appendChild(lead);
  for (const c of chips) {
    const chip = document.createElement('span');
    chip.className = 'reply-option-chip';
    chip.textContent = c.label;
    const x = document.createElement('button');
    x.textContent = '✕';
    x.title = 'Remove';
    x.addEventListener('click', () => { delete opts[c.key]; renderReplyOptions(); });
    chip.appendChild(x);
    replyOptionsEl.appendChild(chip);
  }
  replyOptionsEl.style.display = '';
}

// Small grey system line in the conversation (not sent anywhere)
function addSystemNote(text) {
  const note = document.createElement('div');
  note.className = 'chat-note';
  note.textContent = text;
  chatStream.appendChild(note);
  chatStream.scrollTop = chatStream.scrollHeight;
}

// New chat: open an empty conversation for the same folder right away. The
// first message starts a fresh Claude session (no --resume); as soon as
// Claude names it, this window becomes that session (see onReplyRekey).
// `folder` (optional) = another workspace picked in "New chat ▾"; without an
// open conversation, pass from = null and both `as` and `folder`.
function startNewChat(from, as, folder) {
  const SOURCES = ['claude', 'antigravity', 'opencode'];
  if (!from && folder && SOURCES.includes(as)) from = { source: as, cwd: folder };
  if (!from || !SOURCES.includes(from.source)) return;
  const source = SOURCES.includes(as) ? as : from.source;
  const cwd = folder || from.cwd;
  const sameFolder = !folder || folder === from.cwd;
  const project = sameFolder && from.project ? from.project
    : (String(cwd || '').split(/[\\/]/).filter(Boolean).pop() || cwd);
  // already a blank new chat with that agent in that folder
  if (from.draft && !from.draftSent && from.source === source && sameFolder) { replyTextarea.focus(); return; }
  // /model and /effort carry over when starting a new chat with the same agent
  const fromOpts = from.source === source ? getReplyOptions(from) : {};
  const draft = {
    id: `${source}_draft_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    sessionUuid: '',
    draft: true,
    draftSent: false,
    source,
    cwd,
    project,
    sessionTitle: 'New conversation',
    model: source === from.source ? (fromOpts.model || from.model) : undefined,
    effort: source === from.source ? (fromOpts.effort || from.effort) : undefined,
    status: 'idle',
    state: 'idle',
    statusLabel: 'Idle',
    unread: false,
    fullContent: '',
    detail: '',
    context: null,
    activity: null,
    mtime: Date.now(),
  };
  // carry /model and /effort overrides over to the new conversation
  const opts = {};
  if (fromOpts.model) opts.model = fromOpts.model;
  if (fromOpts.effort) opts.effort = fromOpts.effort;
  replyOptions.set(draft.id, opts);
  showDetailView(draft);
}

// The New-chat run got its real session id from Claude: re-key everything the
// HUD tracks for the draft, so the open window simply continues as that session.
if (window.electronAPI.onReplyRekey) {
  window.electronAPI.onReplyRekey(({ oldId, newId, sessionUuid }) => {
    const move = (map) => { if (map.has(oldId)) { map.set(newId, map.get(oldId)); map.delete(oldId); } };
    move(sessionChatHistory);
    move(replyOptions);
    move(liveActivity);
    move(activityFirstSeen);
    for (const req of pendingApprovals.values()) if (req.sessionId === oldId) req.sessionId = newId;
    if (currentActiveSession && currentActiveSession.id === oldId) {
      currentActiveSession.id = newId;
      currentActiveSession.sessionUuid = sessionUuid;
      currentActiveSession.draft = false; // later messages resume this session
      // if the watcher already found the new transcript, switch to it now
      const real = sessionsList.find((x) => x.id === newId);
      if (real) currentActiveSession = Object.assign(real, { status: 'running' });
      updateConvoHeader(currentActiveSession);
    }
  });
}

// Returns true if the HUD handled the command itself
function runHudCommand(input) {
  const m = input.match(/^\/(\S+)\s*([\s\S]*)$/);
  if (!m) return false;
  const name = m[1].toLowerCase();
  const arg = m[2].trim();
  const s = currentActiveSession;

  if (name === 'help') {
    const src = s?.source || 'claude';
    const custom = (slashCache.get(`${src}:${s?.cwd || ''}`) || []).map((c) => `/${c.name}`);
    const agentCmds = BUILTIN_COMMANDS
      .filter((c) => src === 'antigravity' ? (c.kind === 'antigravity' || c.name === 'compact') : c.kind === 'claude')
      .map((c) => `/${c.name}`);
    addSystemNote(
      'HUD commands: ' + BUILTIN_COMMANDS.filter((c) => c.kind === 'hud').map((c) => `/${c.name}`).join('  ') +
      `\nSent to ${src === 'antigravity' ? 'Antigravity' : 'Claude'}: ` + agentCmds.join('  ') +
      (custom.length ? '\nYour commands & skills: ' + custom.join('  ') : '')
    );
    return true;
  }
  if (name === 'mcp') { openMcpPanel(); return true; }
  if (name === 'handoff') { if (window.openHandoff) window.openHandoff(); else addSystemNote('Handoff is not available.'); return true; }

  if (!s || (s.source !== 'claude' && s.source !== 'antigravity' && s.source !== 'opencode')) {
    if (['model', 'effort', 'clear'].includes(name)) {
      addSystemNote(`/${name} only works for Claude Code, Antigravity and OpenCode sessions.`);
      return true;
    }
    return false;
  }
  const opts = getReplyOptions(s);

  if (name === 'model') {
    if (!arg) {
      addSystemNote(`Current model: ${opts.model || formatModelName(s.model) || 'default'}. Usage: /model <${MODEL_ALIASES.join('|')}|model-id|default>`);
    } else if (arg === 'default') {
      delete opts.model;
      addSystemNote('Model reset — replies use the session default.');
    } else {
      opts.model = arg;
      addSystemNote(`Model set to ${arg} for your next replies in this session.`);
    }
    renderReplyOptions();
    return true;
  }
  if (name === 'effort') {
    const level = arg.toLowerCase();
    if (!level) {
      addSystemNote(`Current effort: ${opts.effort || s.effort || 'default'}. Usage: /effort <${EFFORT_LEVELS.join('|')}|default>`);
    } else if (level === 'default') {
      delete opts.effort;
      addSystemNote('Effort reset to default.');
    } else if (EFFORT_LEVELS.includes(level)) {
      opts.effort = level;
      addSystemNote(`Effort set to ${level} for your next replies in this session.`);
    } else {
      addSystemNote(`Unknown effort "${arg}". Use one of: ${EFFORT_LEVELS.join(', ')}.`);
    }
    renderReplyOptions();
    return true;
  }
  if (name === 'clear') {
    startNewChat(s);
    return true;
  }
  return false; // /compact, /init, /plan, /goal, custom commands & skills → sent to the agent as-is
}

// ---- "/" autocomplete ----
const slashCache = new Map(); // "source:cwd" -> custom commands/skills
let agySlashModelOptions = null;
let slashItems = [];
let slashIndex = 0;

async function loadSlashCommands(cwd, forceOrSource = false, maybeSource = undefined) {
  const force = typeof forceOrSource === 'boolean' ? forceOrSource : false;
  const source = typeof forceOrSource === 'string'
    ? forceOrSource
    : (maybeSource !== undefined ? maybeSource : currentActiveSession?.source);
  const src = ['antigravity', 'opencode'].includes(source) ? source : 'claude';
  const key = `${src}:${cwd || ''}`;
  if (!force && slashCache.has(key)) return slashCache.get(key);
  let list = [];
  try { list = (await window.electronAPI.listSlashCommands(cwd, src)) || []; } catch (e) {}
  slashCache.set(key, list);
  return list;
}

let ocSlashModelOptions = null;
let ocSlashModelKey = '';

async function getOcSlashModelOptions(cwd) {
  const key = cwd || '';
  if (ocSlashModelOptions && ocSlashModelKey === key) return ocSlashModelOptions;
  let list = [];
  try { list = (await window.electronAPI.listModels?.(cwd, 'opencode')) || []; } catch (e) {}
  if (!list.length) {
    // Claude's names (opus, sonnet…) mean nothing to OpenCode, so don't offer them
    addSystemNote('Could not get OpenCode’s models — its background service is not answering. Try `opencode service start` in a terminal, then open Model again.');
    return [{ value: 'default', description: 'Use the session’s model' }];
  }
  ocSlashModelKey = key;
  ocSlashModelOptions = [
    { value: 'default', description: 'Use the session’s model' },
    ...list.map((m) => ({
      value: `${m.providerID}/${m.modelID}`,
      description: m.name || m.modelID || m.id,
    })),
  ];
  return ocSlashModelOptions;
}

async function getAgySlashModelOptions() {
  if (agySlashModelOptions) return agySlashModelOptions;
  const fallback = [
    { value: 'default', description: 'Use the session’s model' },
    { value: 'opus', description: 'Claude Opus' },
    { value: 'sonnet', description: 'Claude Sonnet' },
    { value: 'gemini-4-argon-medium', description: 'Gemini 4 Argon' },
    { value: 'gpt-oss-120b-medium', description: 'GPT-OSS 120B' },
  ];
  try {
    const r = await window.electronAPI.agyModels?.();
    const list = Array.isArray(r) ? r : r?.models;
    if (Array.isArray(list) && list.length) {
      agySlashModelOptions = [
        { value: 'default', description: 'Use the session’s model' },
        ...list.map((m) => ({ value: m.id || m.slug, description: m.name || m.id || m.slug })),
      ];
      return agySlashModelOptions;
    }
  } catch (e) {}
  return fallback;
}

function hideSlashMenu() {
  slashMenu.style.display = 'none';
  slashItems = [];
  slashParent = null;
}

let slashParent = null; // command whose nested options are shown (e.g. /effort)

async function updateSlashMenu() {
  if (!currentActiveSession) return hideSlashMenu();
  const isClaude = currentActiveSession.source === 'claude';
  const isAgy = currentActiveSession.source === 'antigravity';
  const isOc = currentActiveSession.source === 'opencode';

  // Level 2: "/effort " or "/model " → nested options of that command
  const sub = replyTextarea.value.match(/^\/(\S+)\s+(\S*)$/);
  if (sub && (isClaude || isAgy || isOc)) {
    const parent = BUILTIN_COMMANDS.find((c) => c.name === sub[1].toLowerCase() && c.options);
    if (parent) {
      const q2 = sub[2].toLowerCase();
      if (slashParent !== parent) slashIndex = 0;
      slashParent = parent;
      const current = parent.current(currentActiveSession, getReplyOptions(currentActiveSession));
      const optsList = (isAgy && parent.name === 'model') ? await getAgySlashModelOptions()
        : (isOc && parent.name === 'model') ? await getOcSlashModelOptions(currentActiveSession.cwd)
          : parent.options;
      slashItems = optsList
        .filter((o) => o.value.toLowerCase().includes(q2) || (o.description || '').toLowerCase().includes(q2))
        .map((o) => ({ ...o, isOption: true, selected: o.value === current }));
      if (!slashItems.length) return hideSlashMenu();
      // Start on the current choice when the list first opens
      if (!q2 && slashIndex === 0) slashIndex = Math.max(0, slashItems.findIndex((o) => o.selected));
      slashIndex = Math.min(slashIndex, slashItems.length - 1);
      return renderSlashMenu();
    }
  }
  slashParent = null;

  // Level 1: "/eff" → matching commands
  const m = replyTextarea.value.match(/^\/(\S*)$/);
  if (!m) return hideSlashMenu();
  const q = m[1].toLowerCase();
  const custom = (isClaude || isAgy || isOc) ? await loadSlashCommands(currentActiveSession.cwd, currentActiveSession.source) : [];
  // Still the same query after the await?
  if (!replyTextarea.value.match(/^\/(\S*)$/)) return hideSlashMenu();

  const builtins = BUILTIN_COMMANDS.filter((c) => {
    if (c.kind === 'hud') return true;
    if (isClaude) return c.kind === 'claude';
    if (isAgy) return c.kind === 'antigravity' || c.name === 'compact';
    return c.name === 'help' || c.name === 'mcp';
  });
  const all = [
    ...builtins,
    ...custom.filter((c) => !builtins.some((b) => b.name === c.name)),
  ];
  slashItems = all
    .filter((c) => c.name.toLowerCase().includes(q))
    .sort((a, b) => (b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)))
    .slice(0, 30);
  if (!slashItems.length) return hideSlashMenu();
  slashIndex = Math.min(slashIndex, slashItems.length - 1);
  renderSlashMenu();
}

function renderSlashMenu() {
  slashMenu.innerHTML = '';
  if (slashParent) return renderSlashOptions();
  slashItems.forEach((c, i) => {
    const item = document.createElement('div');
    item.className = `slash-item ${i === slashIndex ? 'active' : ''}`;
    const nameEl = document.createElement('span');
    nameEl.className = 'slash-name';
    nameEl.textContent = `/${c.name}`;
    const argsEl = document.createElement('span');
    argsEl.className = 'slash-args';
    argsEl.textContent = c.args || '';
    const desc = document.createElement('span');
    desc.className = 'slash-desc';
    desc.textContent = c.description || '';
    const tag = document.createElement('span');
    tag.className = `slash-tag tag-${c.kind}`;
    tag.textContent = c.kind === 'hud' ? 'HUD' : c.kind === 'claude' ? 'Claude'
      : c.kind === 'antigravity' ? 'Antigravity' : c.scope === 'opencode' ? 'OpenCode' : c.kind;
    item.append(nameEl, argsEl, desc, tag);
    item.addEventListener('mousedown', (e) => { e.preventDefault(); pickSlash(i); });
    slashMenu.appendChild(item);
  });
  slashMenu.style.display = '';
  slashMenu.querySelector('.slash-item.active')?.scrollIntoView({ block: 'nearest' });
}

// Nested options view:  ‹ /effort   Reasoning effort…
//                        ✓ medium   Balanced
function renderSlashOptions() {
  const head = document.createElement('div');
  head.className = 'slash-sub-head';
  const back = document.createElement('span');
  back.className = 'slash-back';
  back.textContent = `‹ /${slashParent.name}`;
  back.title = 'Back to commands';
  back.addEventListener('mousedown', (e) => { e.preventDefault(); slashGoBack(); });
  const hint = document.createElement('span');
  hint.className = 'slash-sub-desc';
  hint.textContent = slashParent.description;
  head.append(back, hint);
  slashMenu.appendChild(head);

  slashItems.forEach((o, i) => {
    const item = document.createElement('div');
    item.className = `slash-item slash-option ${i === slashIndex ? 'active' : ''} ${o.selected ? 'selected' : ''}`;
    const check = document.createElement('span');
    check.className = 'slash-check';
    check.textContent = o.selected ? '✓' : '';
    const nameEl = document.createElement('span');
    nameEl.className = 'slash-name';
    nameEl.textContent = o.value;
    const desc = document.createElement('span');
    desc.className = 'slash-desc';
    desc.textContent = o.description || '';
    item.append(check, nameEl, desc);
    item.addEventListener('mousedown', (e) => { e.preventDefault(); pickSlash(i); });
    slashMenu.appendChild(item);
  });
  slashMenu.style.display = '';
  slashMenu.querySelector('.slash-item.active')?.scrollIntoView({ block: 'nearest' });
}

function slashGoBack() {
  const name = slashParent ? slashParent.name : '';
  slashParent = null;
  replyTextarea.value = `/${name}`;
  slashIndex = 0;
  replyTextarea.focus();
  updateSlashMenu();
}

function pickSlash(i) {
  const c = slashItems[i];
  if (!c) return;

  // Picked a nested option → apply it right away (e.g. /effort high)
  if (c.isOption && slashParent) {
    const cmd = `/${slashParent.name} ${c.value}`;
    replyTextarea.value = '';
    hideSlashMenu();
    slashParent = null;
    runHudCommand(cmd);
    replyTextarea.focus();
    return;
  }

  replyTextarea.value = `/${c.name} `;
  replyTextarea.focus();
  if (c.options && ['claude', 'antigravity', 'opencode'].includes(currentActiveSession?.source)) {
    slashIndex = 0;
    updateSlashMenu(); // open the nested options
  } else {
    hideSlashMenu();
  }
}

function slashMenuHandleKey(e) {
  if (slashMenu.style.display === 'none' || !slashItems.length) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const d = e.key === 'ArrowDown' ? 1 : -1;
    slashIndex = (slashIndex + d + slashItems.length) % slashItems.length;
    renderSlashMenu();
    return true;
  }
  if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
    e.preventDefault();
    pickSlash(slashIndex);
    return true;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    if (slashParent) slashGoBack(); // first Esc goes back a level
    else hideSlashMenu();
    return true;
  }
  if (e.key === 'ArrowLeft' && slashParent && /\s$/.test(replyTextarea.value)) {
    e.preventDefault();
    slashGoBack();
    return true;
  }
  return false;
}

replyTextarea.addEventListener('input', () => { slashIndex = 0; updateSlashMenu(); });
replyTextarea.addEventListener('blur', () => setTimeout(() => {
  if (document.activeElement !== replyTextarea) hideSlashMenu(); // toolbar buttons refocus it
}, 120));
