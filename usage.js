// ---------------------------------------------------------------------------
// Local usage stats for Claude Code and Antigravity (last 7 days).
//
// Claude Code:  ~/.claude/projects/**/*.jsonl
//   • assistant entries carry message.usage (input, cache writes, cache reads,
//     output) + model + timestamp. One API message can be logged as several
//     entries with the same message.id → de-duplicated by that id.
//   • "cost-state" entries carry the session's running totalCostUSD
//     (API-equivalent cost; subscriptions aren't billed per token).
// Antigravity:  ~/.gemini/antigravity/brain/*/.system_generated/logs/transcript.jsonl
//   • PLANNER_RESPONSE steps carry input_tokens / cache_read_tokens / output_tokens.
//
// Plan limits (5-hour / weekly %) are NOT stored locally, so they can't be shown.
// Per-file results are cached by mtime+size; only changed files are re-read.
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const DAYS = 7;
const fileCache = new Map(); // path -> { mtime, size, data }

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function listFiles(root, maxDepth, test, cutoffMs) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.isFile() && test(full)) {
        try {
          const st = fs.statSync(full);
          if (st.mtimeMs >= cutoffMs) out.push({ path: full, mtime: st.mtimeMs, size: st.size });
        } catch (err) {}
      }
    }
  };
  walk(root, 0);
  return out;
}

function readLines(file, onLine) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf-8' }), crlfDelay: Infinity });
    rl.on('line', onLine);
    rl.on('close', resolve);
    rl.on('error', resolve);
  });
}

// ---- Claude Code ----
async function parseClaudeFile(file) {
  const msgs = new Map(); // message id -> record
  let cost = null;
  let costSessionId = null;
  let title = '';
  let cwd = '';
  await readLines(file, (line) => {
    // cheap pre-filter before JSON.parse (lines can be huge)
    if (!line.includes('"usage"') && !line.includes('"cost-state"') && !line.includes('"ai-title"')) {
      if (!cwd && line.includes('"cwd"')) {
        const m = line.match(/"cwd":"((?:[^"\\]|\\.)*)"/);
        if (m) { try { cwd = JSON.parse(`"${m[1]}"`); } catch (e) {} }
      }
      return;
    }
    let e;
    try { e = JSON.parse(line); } catch (err) { return; }
    if (!cwd && e.cwd) cwd = e.cwd;
    if (e.type === 'ai-title' && e.aiTitle) title = e.aiTitle;
    if (e.type === 'cost-state' && typeof e.totalCostUSD === 'number') {
      cost = e.totalCostUSD;
      costSessionId = e.sessionId || null;
    }
    if (e.type === 'assistant' && e.message?.usage && e.message.model && e.message.model !== '<synthetic>') {
      const u = e.message.usage;
      const id = e.message.id || e.requestId || e.uuid;
      msgs.set(id, {
        ts: Date.parse(e.timestamp) || 0,
        model: e.message.model,
        sessionId: e.sessionId || '',
        input: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0),
        cacheRead: u.cache_read_input_tokens || 0,
        output: u.output_tokens || 0,
      });
    }
  });
  return { msgs: [...msgs.values()], cost, costSessionId, title, cwd };
}

// ---- Antigravity ----
function getSqlite() {
  try { return require('node:sqlite').DatabaseSync; } catch (_) { return null; }
}

function readAgSummaryMap(summaryDb) {
  const DatabaseSync = getSqlite();
  const map = new Map();
  if (!DatabaseSync || !fs.existsSync(summaryDb)) return map;
  let db;
  try {
    db = new DatabaseSync(summaryDb, { readOnly: true });
    const rows = db.prepare('SELECT conversation_id, title, workspace_uris FROM conversation_summaries').all();
    for (const r of rows) {
      if (!r || !r.conversation_id) continue;
      let cwd = '';
      if (r.workspace_uris) {
        try {
          const arr = JSON.parse(r.workspace_uris);
          if (Array.isArray(arr) && arr[0]) {
            let s = decodeURIComponent(String(arr[0]).replace(/^file:\/\//i, ''));
            if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(s)) s = s.slice(1);
            cwd = path.normalize(s);
          }
        } catch (_) {}
      }
      map.set(String(r.conversation_id), { title: (r.title || '').trim(), cwd });
    }
  } catch (_) {} finally {
    try { db && db.close(); } catch (_) {}
  }
  return map;
}

function readAgDbModel(dbPath) {
  const DatabaseSync = getSqlite();
  if (!DatabaseSync || !dbPath || !fs.existsSync(dbPath)) return '';
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const gm = db.prepare('SELECT data FROM gen_metadata ORDER BY idx DESC LIMIT 1').get();
    if (gm?.data) {
      const decoded = new TextDecoder('utf-8', { fatal: false }).decode(gm.data);
      const m = decoded.match(/(Gemini\s+[\w.\s-]+?\((?:Low|Medium|High|XHigh|Max|Thinking)\)|Claude\s+[\w.\s-]+?\((?:Low|Medium|High|XHigh|Max|Thinking)\)|GPT-OSS[\w.\s-]+?\((?:Low|Medium|High|XHigh|Max)\)|gemini-[a-z0-9.-]+|claude-[a-z0-9.-]+|gpt-oss-[a-z0-9.-]+)/i);
      if (m) return m[1].trim();
    }
  } catch (_) {} finally {
    try { db && db.close(); } catch (_) {}
  }
  return '';
}

async function parseAntigravityFile(file) {
  const steps = [];
  let title = '';
  let cwd = '';
  let currentModel = '';
  await readLines(file, (line) => {
    if (!line.includes('"PLANNER_RESPONSE"') && !line.includes('"USER_INPUT"')) return;
    let e;
    try { e = JSON.parse(line); } catch (err) { return; }
    if (e.type === 'USER_INPUT' && typeof e.content === 'string') {
      const c = e.content;
      if (!title) {
        const m = c.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
        const promptText = (m ? m[1] : c.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '')).replace(/\s+/g, ' ').trim().slice(0, 120);
        if (promptText) title = promptText;
      }
      if (!cwd) {
        const ws = c.match(/Active Workspaces:\s*\r?\n-\s*([a-zA-Z]:\\[^\r\n]+|\/[^\r\n]+)/);
        if (ws) cwd = ws[1].trim();
        else {
          const cw = c.match(/Command Working Directory:\s*([a-zA-Z]:\\[^\r\n]+|\/[^\r\n]+)/);
          if (cw) cwd = cw[1].trim();
        }
      }
      if (c.includes('Model Selection')) {
        const mm = c.match(/changed setting `Model Selection` from [^\r\n]+? to ([^\r\n]+?)\.?$/im) ||
                   c.match(/changed setting `Model Selection` from [^\r\n]+? to ([^\r\n]+)/i);
        if (mm && mm[1]) {
          const cleaned = mm[1].trim().replace(/\.\s[\s\S]*$/, '').replace(/\.$/, '');
          if (!/^none$/i.test(cleaned)) currentModel = cleaned;
        }
      }
    }
    if (e.type === 'PLANNER_RESPONSE' && (e.input_tokens || e.output_tokens)) {
      steps.push({
        ts: Date.parse(e.created_at) || 0,
        model: currentModel,
        input: e.input_tokens || 0,
        cacheRead: e.cache_read_tokens || 0,
        output: e.output_tokens || 0,
        total: (e.input_tokens || 0) + (e.output_tokens || 0),
      });
    }
  });
  return { steps, title, cwd, model: currentModel };
}

async function cachedParse(f, parser) {
  const hit = fileCache.get(f.path);
  if (hit && hit.mtime === f.mtime && hit.size === f.size) return hit.data;
  const data = await parser(f.path);
  fileCache.set(f.path, { mtime: f.mtime, size: f.size, data });
  return data;
}

function emptyBucket() {
  return { tokens: 0, input: 0, cacheRead: 0, output: 0, count: 0 };
}

function addTo(b, r) {
  b.input += r.input;
  b.cacheRead += r.cacheRead;
  b.output += r.output;
  // Claude: input excludes cache reads → total = all three.
  // Antigravity: input already includes cached tokens → record sets `total`.
  b.tokens += r.total != null ? r.total : r.input + r.cacheRead + r.output;
  b.count += 1;
}

async function getUsage() {
  const now = new Date();
  const today0 = startOfDay(now);
  const from0 = new Date(today0);
  from0.setDate(from0.getDate() - (DAYS - 1));
  const fromMs = from0.getTime();

  const days = [];
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(from0);
    d.setDate(d.getDate() + i);
    days.push({
      key: dayKey(d),
      label: i === DAYS - 1 ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short' }),
      date: d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }),
    });
  }
  const dayIndex = new Map(days.map((d, i) => [d.key, i]));
  const todayKey = days[DAYS - 1].key;

  // ---------- Claude ----------
  const claude = {
    today: emptyBucket(), week: emptyBucket(),
    perDay: days.map(() => emptyBucket()),
    models: new Map(), sessions: new Map(), cost7d: 0, available: false,
  };
  const claudeRoot = path.join(os.homedir(), '.claude', 'projects');
  if (fs.existsSync(claudeRoot)) {
    claude.available = true;
    const files = listFiles(claudeRoot, 4, (p) => p.endsWith('.jsonl'), fromMs);
    const sessionCost = new Map();
    for (const f of files) {
      const data = await cachedParse(f, parseClaudeFile);
      if (data.costSessionId && data.cost != null) sessionCost.set(data.costSessionId, data.cost);
      for (const m of data.msgs) {
        if (m.ts < fromMs) continue;
        const k = dayKey(m.ts);
        const i = dayIndex.get(k);
        if (i === undefined) continue;
        addTo(claude.perDay[i], m);
        addTo(claude.week, m);
        if (k === todayKey) addTo(claude.today, m);

        if (!claude.models.has(m.model)) claude.models.set(m.model, emptyBucket());
        addTo(claude.models.get(m.model), m);

        const sid = m.sessionId || f.path;
        if (!claude.sessions.has(sid)) {
          claude.sessions.set(sid, { id: sid, title: '', project: '', ...emptyBucket() });
        }
        const s = claude.sessions.get(sid);
        addTo(s, m);
        if (!s.title && data.title) s.title = data.title;
        if (!s.project && data.cwd) s.project = path.basename(data.cwd);
      }
    }
    for (const sid of claude.sessions.keys()) claude.cost7d += sessionCost.get(sid) || 0;
  }

  // ---------- Antigravity ----------
  const ag = {
    today: emptyBucket(), week: emptyBucket(),
    perDay: days.map(() => emptyBucket()),
    models: new Map(), sessions: [], available: false,
  };
  const agRoots = ['antigravity', 'antigravity-ide', 'antigravity-cli'].map((n) =>
    path.join(os.homedir(), '.gemini', n)
  );
  const seenConvIds = new Set();
  for (const rootDir of agRoots) {
    const agBrain = path.join(rootDir, 'brain');
    if (!fs.existsSync(agBrain)) continue;
    ag.available = true;
    const summaries = readAgSummaryMap(path.join(rootDir, 'conversation_summaries.db'));
    const files = listFiles(agBrain, 4, (p) => p.endsWith(`${path.sep}logs${path.sep}transcript.jsonl`), fromMs);
    for (const f of files) {
      const parts = f.path.split(path.sep);
      const brainIdx = parts.lastIndexOf('brain');
      const convId = brainIdx >= 0 && parts[brainIdx + 1] ? parts[brainIdx + 1] : f.path;
      if (seenConvIds.has(convId)) continue;
      seenConvIds.add(convId);

      const data = await cachedParse(f, parseAntigravityFile);
      const sum = summaries.get(convId);
      const resolvedCwd = sum?.cwd || data.cwd || '';
      const resolvedTitle = sum?.title || data.title || 'Untitled conversation';
      const fallbackModel = data.model || readAgDbModel(path.join(rootDir, 'conversations', `${convId}.db`)) || 'Gemini (Antigravity)';
      const conv = {
        id: convId,
        title: resolvedTitle,
        project: resolvedCwd ? path.basename(resolvedCwd) : '',
        ...emptyBucket(),
      };
      for (const s of data.steps) {
        if (s.ts < fromMs) continue;
        const k = dayKey(s.ts);
        const i = dayIndex.get(k);
        if (i === undefined) continue;
        addTo(ag.perDay[i], s);
        addTo(ag.week, s);
        if (k === todayKey) addTo(ag.today, s);
        addTo(conv, s);

        const mName = s.model || fallbackModel;
        if (!ag.models.has(mName)) ag.models.set(mName, emptyBucket());
        addTo(ag.models.get(mName), s);
      }
      if (conv.count) ag.sessions.push(conv);
    }
  }

  const topSessions = (list) => [...list].sort((a, b) => b.tokens - a.tokens).slice(0, 5);
  return {
    generatedAt: Date.now(),
    days,
    claude: {
      available: claude.available,
      today: claude.today,
      week: claude.week,
      perDay: claude.perDay,
      cost7d: claude.cost7d,
      models: [...claude.models.entries()]
        .map(([model, b]) => ({ model, ...b }))
        .sort((a, b) => b.tokens - a.tokens),
      sessions: topSessions(claude.sessions.values()),
    },
    antigravity: {
      available: ag.available,
      today: ag.today,
      week: ag.week,
      perDay: ag.perDay,
      models: [...ag.models.entries()]
        .map(([model, b]) => ({ model, ...b }))
        .sort((a, b) => b.tokens - a.tokens),
      sessions: topSessions(ag.sessions),
    },
  };
}

// ---------------------------------------------------------------------------
// Plan limits (what `/usage` shows: current 5-hour session %, weekly %, …).
// These live on Anthropic's side, not in local logs. We ask the same endpoint
// Claude Code uses, authenticated with Claude Code's own saved login
// (~/.claude/.credentials.json). The token is only ever sent to
// api.anthropic.com, never logged, and never handed to the renderer.
// The endpoint isn't a documented public API, so parsing is defensive.
// ---------------------------------------------------------------------------
const https = require('https');

let limitsCache = null; // { at, result }
const LIMITS_TTL_MS = 60 * 1000;

function readAccessToken() {
  const file = path.join(os.homedir(), '.claude', '.credentials.json');
  try {
    const creds = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const oauth = creds.claudeAiOauth || creds.claude_ai_oauth || null;
    if (!oauth || !oauth.accessToken) return { error: 'not-logged-in' };
    if (oauth.expiresAt && Date.now() > Number(oauth.expiresAt)) return { error: 'expired' };
    return { token: oauth.accessToken };
  } catch (e) {
    return { error: 'no-credentials' };
  }
}

function fetchJson(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'GET', headers, timeout: 15000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode }));
        }
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('Bad response')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Timed out')));
    req.on('error', reject);
    req.end();
  });
}

// five_hour → "Current session", seven_day → "Current week (all models)",
// seven_day_<model> → "Current week (<Model>)"
function limitLabel(key) {
  if (key === 'five_hour') return 'Current session';
  if (key === 'seven_day') return 'Current week (all models)';
  const m = key.match(/^seven_day_(.+)$/);
  if (m) return `Current week (${m[1].replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())})`;
  return null;
}

async function getPlanLimits(force = false) {
  if (!force && limitsCache && Date.now() - limitsCache.at < LIMITS_TTL_MS) return limitsCache.result;

  const auth = readAccessToken();
  let result;
  if (auth.error) {
    result = { available: false, reason: auth.error };
  } else {
    try {
      const data = await fetchJson('https://api.anthropic.com/api/oauth/usage', {
        Authorization: `Bearer ${auth.token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'Content-Type': 'application/json',
        'User-Agent': 'ovly-claude-hud',
      });
      const limits = [];
      for (const [key, v] of Object.entries(data || {})) {
        const label = limitLabel(key);
        if (!label || !v || typeof v !== 'object' || typeof v.utilization !== 'number') continue;
        limits.push({
          key,
          label,
          percent: Math.max(0, Math.min(100, v.utilization)),
          resetsAt: v.resets_at || v.resetsAt || null,
        });
      }
      // session first, then all-models week, then per-model weeks
      const rank = (k) => (k === 'five_hour' ? 0 : k === 'seven_day' ? 1 : 2);
      limits.sort((a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label));
      result = limits.length ? { available: true, limits } : { available: false, reason: 'no-data' };
    } catch (e) {
      result = { available: false, reason: e.status === 401 || e.status === 403 ? 'expired' : 'network', detail: e.message };
    }
  }
  limitsCache = { at: Date.now(), result };
  return result;
}

module.exports = { getUsage, getPlanLimits };
