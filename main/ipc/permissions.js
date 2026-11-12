// Tool-approval server and the saved "Always allow" rules that back it.
//
// Claude Code runs with --permission-prompt-tool pointing at this local HTTP
// endpoint. It POSTs each request here; we show it in the HUD and answer with
// the user's choice.
//
// Shared with main.js through ctx.permissions: pendingPermissions and
// sessionAliases are mutated from the reply-sending code when a process ends
// or a draft id is replaced by the real session id.

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const shellRules = require('../../approval-shell');

const PERM_TOKEN = crypto.randomBytes(24).toString('hex');
const PERMISSION_TIMEOUT_MS = 10 * 60 * 1000;

// ---- Saved "Always allow" rules (persist across restarts) ------------------
// A rule = { id, tool, folder, prefix }.  folder '' = any folder; prefix is
// only used for Bash ("npm test" matches "npm test --silent" but never a
// command that chains something else on with ; & | ` $( > < or a newline).
const RULES_FILE = path.join(os.homedir(), '.ovly-claude', 'approval-rules.json');

const normFolder = (p) => (p ? path.resolve(String(p)).replace(/[\\/]+$/, '').toLowerCase() : '');
const isShellToolName = (t) => t === 'Bash' || t === 'run_command';

function createState() {
  let approvalRules = [];
  try {
    approvalRules = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8')).filter((r) => r && r.tool);
  } catch (err) {}

  return {
    approvalRules,
    pendingPermissions: new Map(), // id -> { res, onDecision, timer, sessionId, toolName }
    sessionAliases: new Map(),     // New-chat draft id -> real 'claude_<uuid>' or 'antigravity_<uuid>' id
    permPort: 0,
  };
}

function saveRules(state) {
  try {
    fs.mkdirSync(path.dirname(RULES_FILE), { recursive: true });
    fs.writeFileSync(RULES_FILE, JSON.stringify(state.approvalRules, null, 2));
  } catch (err) {
    console.error('[Main] could not save approval rules:', err.message);
  }
}

function sessionCwd(ctx, sessionId) {
  try {
    const watcher = ctx.getWatcher();
    const session = watcher && watcher.sessions && watcher.sessions.get(sessionId);
    return session && session.cwd ? session.cwd : '';
  } catch (err) { return ''; }
}

// Is this request covered by saved rules?  For a shell command also returns
// what "Always allow" can offer: { allowed, always: { prefixes, stillAsks } | null }
function checkRules(state, cwd, toolName, input) {
  const folderOk = (r) => !r.folder || (!!cwd && normFolder(cwd) === r.folder);
  const isShell = input && typeof input.command === 'string';
  const mine = state.approvalRules.filter((r) =>
    (r.tool === toolName || (isShell && isShellToolName(toolName) && isShellToolName(r.tool))) && folderOk(r)
  );
  if (!isShell) {
    return { allowed: mine.some((r) => !r.prefix), offer: cwd ? { prefixes: [''], stillAsks: [] } : null };
  }
  if (mine.some((r) => !r.prefix)) return { allowed: true, offer: null }; // blanket rule for this tool
  const covers = (part) => mine.some((r) => r.prefix && shellRules.prefixMatches(part, r.prefix));
  const a = shellRules.analyse(input.command, cwd, covers);
  return {
    allowed: a.allowed,
    offer: cwd && a.prefixes ? { prefixes: a.prefixes, stillAsks: a.stillAsks || [] } : null,
  };
}

function answerPermission(state, id, decision) {
  const p = state.pendingPermissions.get(id);
  if (!p) return;
  state.pendingPermissions.delete(id);
  clearTimeout(p.timer);
  if (typeof p.onDecision === 'function') {
    try { p.onDecision(decision); } catch (err) {}
    return;
  }
  try {
    p.res.writeHead(200, { 'Content-Type': 'application/json' });
    p.res.end(JSON.stringify(decision));
  } catch (err) {}
}

function startPermissionServer(ctx, state) {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/permission' || req.headers['x-hud-token'] !== PERM_TOKEN) {
      res.writeHead(403);
      return res.end();
    }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 5e6) req.destroy(); });
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(body); } catch (err) { res.writeHead(400); return res.end(); }
      const { toolName = 'unknown', input = {} } = payload;
      // a New-chat run was started under a draft id; report the real session
      const sessionId = state.sessionAliases.get(payload.sessionId || '') || payload.sessionId || '';

      const cwd = sessionCwd(ctx, sessionId);
      const check = checkRules(state, cwd, toolName, input);
      if (check.allowed) {
        console.log(`[Main] Auto-allowed ${toolName} by saved rules`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ behavior: 'allow' }));
      }
      // What the "Always allow" button can offer. Rules are always scoped to the
      // session's folder. For a chained command: one rule per safe part; parts
      // that can't get a rule (rm, node, …) are listed in stillAsks.
      const always = check.offer ? {
        tool: toolName,
        prefixes: check.offer.prefixes,
        prefix: check.offer.prefixes.filter(Boolean).join(' + '), // label for the button
        stillAsks: check.offer.stillAsks,
        folder: cwd,
      } : null;

      const id = crypto.randomBytes(8).toString('hex');
      const timer = setTimeout(() => {
        answerPermission(state, id, { behavior: 'deny', message: 'No answer in the HUD within 10 minutes.' });
        sendToWin(ctx, 'permission-expired', { id });
      }, PERMISSION_TIMEOUT_MS);
      state.pendingPermissions.set(id, { res, timer, sessionId, toolName, always });

      // If the client gives up (e.g. Claude was stopped), drop the prompt
      res.on('close', () => {
        if (state.pendingPermissions.has(id)) {
          state.pendingPermissions.delete(id);
          clearTimeout(timer);
          sendToWin(ctx, 'permission-expired', { id });
        }
      });

      const win = ctx.getWin();
      if (win && !win.isDestroyed()) {
        if (ctx.window.isDocked()) ctx.window.undock();
        win.showInactive();
        win.webContents.send('permission-request', { id, sessionId, toolName, input, always });
      }
    });
  });

  server.listen(0, '127.0.0.1', () => {
    state.permPort = server.address().port;
    console.log(`[Main] Permission endpoint on 127.0.0.1:${state.permPort}`);
  });
  return server;
}

function sendToWin(ctx, channel, payload) {
  const win = ctx.getWin();
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function register(r, ctx, state) {
  r.on('permission-response', (_ctx, _event, { id, choice, message }) => {
    const p = state.pendingPermissions.get(id);
    if (!p) return;
    if (choice === 'always' && p.always) {
      const folder = normFolder(p.always.folder);
      const prefixes = Array.isArray(p.always.prefixes) ? p.always.prefixes : [p.always.prefix || ''];
      let added = false;
      for (const prefix of prefixes) {
        const exists = state.approvalRules.some((rule) =>
          rule.tool === p.always.tool && (rule.prefix || '') === prefix && rule.folder === folder);
        if (exists) continue;
        state.approvalRules.push({ id: crypto.randomBytes(4).toString('hex'), tool: p.always.tool, prefix, folder, created: Date.now() });
        added = true;
      }
      if (added) saveRules(state);
    }
    const note = typeof message === 'string' && message.trim() ? message.trim().slice(0, 4000) : 'The user denied this in the HUD.';
    answerPermission(state, id, choice === 'deny'
      ? { behavior: 'deny', message: note }
      : { behavior: 'allow' });
  });

  r.handle('rules-list', () => state.approvalRules);
  r.handle('rules-delete', (_ctx, _event, id) => {
    state.approvalRules = state.approvalRules.filter((rule) => rule.id !== id);
    saveRules(state);
    return state.approvalRules;
  });
  r.handle('rules-clear', () => {
    state.approvalRules = [];
    saveRules(state);
    return state.approvalRules;
  });
}

module.exports = {
  createState,
  startPermissionServer,
  register,
  answerPermission,
  // PERM_TOKEN goes to the claude process; sendToWin lets other modules
  // notify the HUD about expired prompts they cause.
  PERM_TOKEN,
  PERMISSION_TIMEOUT_MS,
  sendToWin,
};
