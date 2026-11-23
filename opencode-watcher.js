// OpenCode as a third source for the HUD.
//
// Claude and Antigravity are watched by re-reading log files. OpenCode is
// different: it runs a background HTTP service that already knows every
// session, streams events, and accepts prompts. So instead of parsing anything
// we subscribe to /api/event and POST to /api/session/<id>/prompt. That is also
// why approvals are exact here: OpenCode asks through the API and we answer
// through it, with no MCP server in the middle.
//
// This module owns the connection and produces session objects shaped exactly
// like watcher.js's (`source: 'opencode'`), so the rest of the app cannot tell
// the difference. It never throws into the caller: when OpenCode is missing or
// the service dies we keep the last state and reconnect quietly.

const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVICE_FILE = path.join(os.homedir(), '.local', 'state', 'opencode', 'service.json');
const PREFIX = 'opencode_';
const RESYNC_MS = 60 * 1000;
const RECONNECT_MS = 10 * 1000;
const SESSION_AGE_MS = 48 * 60 * 60 * 1000;
const MAX_SESSIONS = 40;

const hudId = (sessionID) => PREFIX + sessionID;
const apiId = (id) => (typeof id === 'string' && id.startsWith(PREFIX) ? id.slice(PREFIX.length) : id);

// Same rule watcher.js uses for Claude: a reply that ends in a question means
// the agent is waiting for YOU. Kept in sync on purpose (see endsWithQuestion).
function endsWithQuestion(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/\(\s*yes\s*\/\s*no\s*\)\s*$/i.test(t)) return true;
  const tail = t.split(/\n\s*\n/).pop().trim();
  return tail.endsWith('?');
}

function shortText(text, max = 140) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 3) + '...' : t;
}

function toolSummary(name, input) {
  if (!input || typeof input !== 'object') return name || '';
  const first = input.command || input.filePath || input.path || input.pattern || input.query || input.description;
  return first ? `${name}: ${shortText(first, 90)}` : name || '';
}

function assistantText(message) {
  const out = [];
  for (const p of (message && message.content) || []) {
    if (p.type === 'text' && p.text) out.push(p.text);
    else if (p.type === 'tool' && p.state?.status === 'error') out.push(`\n\n_${p.name || 'tool'} failed_`);
  }
  return out.join('').trim();
}

class OpencodeWatcher extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.serviceFile = opts.serviceFile || SERVICE_FILE;
    this.dismissedAlerts = opts.dismissedAlerts || null; // shared with watcher.js
    this.sessions = new Map(); // hudId -> session object (what the HUD renders)
    this.raw = new Map();      // hudId -> Session.Info as last fetched
    this.live = new Map();     // hudId -> turn state from events
    this.permissions = new Map(); // requestID -> Permission.Request
    this.endpoint = null;
    this.connected = false;
    this.stopped = false;
    this.abort = null;
    this.reconnectTimer = null;
    this.timers = [];
    this.lastError = '';
  }

  // ---- connection -------------------------------------------------------

  readService() {
    try {
      const s = JSON.parse(fs.readFileSync(this.serviceFile, 'utf8'));
      if (!s || !s.url) return null;
      return { url: String(s.url).replace(/\/+$/, ''), password: String(s.password || '') };
    } catch (err) {
      return null;
    }
  }

  authHeader() {
    return 'Basic ' + Buffer.from('opencode:' + (this.endpoint?.password || '')).toString('base64');
  }

  async call(method, p, body, timeoutMs = 15000) {
    if (!this.endpoint) throw new Error('OpenCode is not running');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(this.endpoint.url + p, {
        method,
        headers: {
          authorization: this.authHeader(),
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (err) {}
      if (!res.ok) {
        const msg = (json && (json.message || json._tag)) || text.slice(0, 200) || `HTTP ${res.status}`;
        throw new Error(`${method} ${p} failed: ${msg}`);
      }
      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  start() {
    this.stopped = false;
    this.connectLoop();
    this.timers.push(setInterval(() => this.resync(), RESYNC_MS));
  }

  stop() {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    try { this.abort?.abort(); } catch (err) {}
    this.abort = null;
    this.connected = false;
  }

  async connectLoop() {
    if (this.stopped) return;
    const svc = this.readService();
    if (!svc) {
      this.lastError = 'OpenCode is not running';
      this.emit('state', { connected: false, error: this.lastError });
      this.scheduleReconnect();
      return;
    }
    this.endpoint = svc;
    try {
      await this.loadSessions();
      this.connected = true;
      this.lastError = '';
      this.emit('state', { connected: true });
      this.subscribe(0); // long-lived; resolves when the stream ends
    } catch (err) {
      this.connected = false;
      this.lastError = err.message;
      this.emit('state', { connected: false, error: err.message });
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectLoop();
    }, RECONNECT_MS);
  }

  // ---- reading sessions -------------------------------------------------

  // GET /api/session is newest first. Keep the last 48h (like the Claude
  // watcher does for its log folders) plus anything running right now.
  async loadSessions() {
    const list = await this.call('GET', '/api/session');
    const active = await this.call('GET', '/api/session/active').catch(() => ({ data: {} }));
    const activeIds = new Set(Object.keys((active && active.data) || {}));
    const cutoff = Date.now() - SESSION_AGE_MS;
    const rows = (list.data || [])
      .filter((s) => s && s.id)
      .filter((s) => activeIds.has(s.id) || (s.time?.updated || s.time?.created || 0) >= cutoff)
      .slice(0, MAX_SESSIONS);

    const seen = new Set();
    for (const info of rows) {
      const id = hudId(info.id);
      seen.add(id);
      this.raw.set(id, info);
      const live = this.live.get(id);
      if (activeIds.has(info.id) && !live?.running) {
        this.live.set(id, { ...(live || newTurn()), running: true });
      } else if (!activeIds.has(info.id) && live?.running) {
        live.running = false;
      }
      this.sessions.set(id, this.buildSession(id));
    }
    for (const id of [...this.sessions.keys()]) {
      if (!seen.has(id)) {
        this.sessions.delete(id);
        this.raw.delete(id);
        this.live.delete(id);
      }
    }
    this.emit('update');
  }

  async resync() {
    if (!this.connected) return;
    try {
      await this.loadSessions();
      // The card subtitle is the last reply. Only the newest few need it.
      const need = [...this.sessions.values()]
        .filter((s) => !s.fullContent)
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 10);
      for (const s of need) await this.fillLastReply(s.id);
    } catch (err) {
      this.connected = false;
      this.lastError = err.message;
      this.emit('state', { connected: false, error: err.message });
      this.scheduleReconnect();
    }
  }

  async fillLastReply(id) {
    try {
      const res = await this.call('GET', `/api/session/${apiId(id)}/message`);
      // newest first, so the first assistant message is the last reply
      const last = (res.data || []).find((m) => m.type === 'assistant');
      const text = last ? assistantText(last) : '';
      if (!text) return;
      const live = this.live.get(id) || newTurn();
      live.text = text;
      live.textFromStored = true;
      this.live.set(id, live);
      this.refresh(id);
    } catch (err) {}
  }

  buildSession(id) {
    const info = this.raw.get(id) || {};
    const live = this.live.get(id) || newTurn();
    const prev = this.sessions.get(id);
    const running = !!live.running;
    const text = live.text || '';
    const question = !running && (live.text ? endsWithQuestion(live.text) : !!prev?.isQuestion);
    const dir = info.location?.directory || prev?.cwd || '';
    const title = info.title || prev?.aiTitle || '';
    const tool = running ? live.tool : '';
    const recordId = `${info.time?.updated || 0}_${running ? 'run' : question ? 'q' : 'idle'}_${live.tool || ''}`;

    const alertKey = id + '_' + recordId;
    const unread = question && !(this.dismissedAlerts && this.dismissedAlerts.has(alertKey));

    return {
      id,
      sessionUuid: info.id || apiId(id),
      source: 'opencode',
      project: dir ? path.basename(dir) : '',
      cwd: dir,
      aiTitle: title,
      sessionTitle: title || prev?.sessionTitle || '',
      model: info.model?.id || prev?.model || '',
      effort: info.model?.variant || prev?.effort || '',
      agent: info.agent || prev?.agent || '',
      context: null, // OpenCode reports usage per step, not a context meter
      tokens: info.tokens || prev?.tokens || null,
      cost: typeof info.cost === 'number' ? info.cost : (prev?.cost ?? 0),
      activity: running
        ? { kind: tool ? 'tool' : 'thinking', tool: tool || undefined, since: live.startedAt || Date.now() }
        : null,
      placeholder: running && !text,
      lastTurnTs: info.time?.updated || prev?.lastTurnTs || 0,
      status: running ? 'running' : 'idle',
      statusLabel: live.failed ? 'Idle (Error)'
        : running ? (tool ? `Running: ${tool}` : 'Running (Thinking...)')
        : question ? 'Idle (Question)' : 'Idle (Ready)',
      state: question ? 'attention' : running ? 'thinking' : 'waiting',
      title: running
        ? (tool ? `OpenCode is running ${tool}` : 'OpenCode is thinking...')
        : question ? (title ? `${title} — Question` : 'OpenCode asked a question!')
        : (title || 'OpenCode ready'),
      detail: running ? (live.detail || prev?.detail || '') : (shortText(text) || prev?.detail || ''),
      fullContent: text || prev?.fullContent || '',
      isQuestion: question,
      mtime: info.time?.updated || info.time?.created || prev?.mtime || Date.now(),
      lastRecordId: recordId,
      unread,
      timestamp: new Date(info.time?.updated || info.time?.created || Date.now()).toISOString(),
    };
  }

  refresh(id) {
    if (!this.sessions.has(id) && !this.raw.has(id)) return;
    const prev = this.sessions.get(id);
    const next = this.buildSession(id);
    this.sessions.set(id, next);
    if (next.state === 'attention' && next.unread && (!prev || prev.state !== 'attention' || prev.lastRecordId !== next.lastRecordId)) {
      this.emit('alert', next);
    }
    this.emit('update');
  }

  // ---- event stream -----------------------------------------------------

  subscribe(attempt) {
    const ctrl = new AbortController();
    this.abort = ctrl;
    fetch(this.endpoint.url + '/api/event', {
      headers: { authorization: this.authHeader(), accept: 'text/event-stream' },
      signal: ctrl.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`event stream failed: HTTP ${res.status}`);
        this.connected = true;
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const chunks = buf.split('\n\n');
          buf = chunks.pop() || '';
          for (const chunk of chunks) {
            const line = chunk.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            let evt;
            try { evt = JSON.parse(line.slice(6)); } catch (err) { continue; }
            this.handleEvent(evt);
          }
        }
        throw new Error('event stream closed');
      })
      .catch((err) => {
        if (this.stopped) return;
        this.connected = false;
        this.lastError = err.message;
        this.emit('state', { connected: false, error: err.message });
        // one immediate retry covers a service restart; after that, back off
        if (!attempt) this.subscribe(1);
        else this.scheduleReconnect();
      });
  }

  handleEvent(evt) {
    const type = evt && evt.type;
    if (!type) return;
    const d = evt.data || {};

    if (type === 'server.connected') {
      this.loadSessions().catch(() => {});
      return;
    }
    if (type === 'permission.asked') {
      this.permissions.set(d.id, d);
      const id = hudId(d.sessionID);
      const live = this.live.get(id) || newTurn();
      live.tool = 'approval';
      live.running = true;
      this.live.set(id, live);
      const s = this.sessions.get(id);
      if (s) { s.state = 'attention'; s.unread = true; s.statusLabel = 'Needs approval'; }
      this.emit('permission', d);
      this.emit('update');
      return;
    }
    if (type === 'permission.replied') {
      this.permissions.delete(d.id);
      const id = hudId(d.sessionID);
      const live = this.live.get(id);
      if (live) { live.tool = ''; this.live.set(id, live); }
      this.refresh(id);
      return;
    }

    const sid = d.sessionID;
    if (!sid) return;
    const id = hudId(sid);
    const live = this.live.get(id) || newTurn();
    this.live.set(id, live);
    let notify = false;
    let finished = false;

    switch (type) {
      case 'session.created':
        this.loadSessions().catch(() => {});
        return;
      case 'session.deleted':
        this.sessions.delete(id);
        this.raw.delete(id);
        this.live.delete(id);
        this.emit('update');
        return;
      case 'session.renamed':
        if (d.title) {
          const info = this.raw.get(id) || {};
          info.title = d.title;
          this.raw.set(id, info);
          notify = true;
        }
        break;
      case 'session.execution.started':
        live.running = true;
        live.failed = false;
        live.text = '';
        live.tool = '';
        live.detail = '';
        live.startedAt = Date.now();
        live.toolNames = new Map();
        notify = true;
        break;
      case 'session.step.started': {
        const info = this.raw.get(id) || {};
        if (d.agent) info.agent = d.agent;
        if (d.model) info.model = { ...(info.model || {}), ...d.model };
        this.raw.set(id, info);
        live.running = true;
        notify = true;
        break;
      }
      case 'session.tool.input.started':
        if (d.id && d.name) { live.toolNames.set(d.id, d.name); live.tool = d.name; notify = true; }
        break;
      case 'session.tool.called':
        if (d.id) {
          live.tool = live.toolNames.get(d.id) || live.tool || 'tool';
          live.detail = toolSummary(live.tool, d.input);
          notify = true;
        }
        break;
      case 'session.tool.success':
      case 'session.tool.failed':
        live.tool = '';
        live.detail = '';
        notify = true;
        break;
      case 'session.text.delta':
        live.text = (live.text || '') + (d.delta || '');
        notify = true;
        this.emit('stream', { sessionId: id, text: live.text, done: false });
        break;
      case 'session.text.ended':
        live.text = d.text || live.text || '';
        notify = true;
        this.emit('stream', { sessionId: id, text: live.text, done: false });
        break;
      case 'session.usage.updated': {
        const info = this.raw.get(id) || {};
        if (d.tokens) info.tokens = d.tokens;
        if (typeof d.cost === 'number') info.cost = d.cost;
        this.raw.set(id, info);
        notify = true;
        break;
      }
      case 'session.execution.failed':
        live.failed = true;
        // falls through to the idle handling below
      case 'session.execution.succeeded':
      case 'session.execution.interrupted':
      case 'session.idle': {
        live.running = false;
        live.tool = '';
        live.detail = '';
        live.startedAt = 0;
        notify = true;
        finished = true; // emit after refresh so the final label is up to date
        break;
      }
      default:
        return;
    }

    if (notify) this.refresh(id);
    if (finished) {
      this.emit('stream', {
        sessionId: id,
        text: live.text || '',
        done: true,
        statusLabel: this.sessions.get(id)?.statusLabel,
      });
    }
  }

  // ---- control ----------------------------------------------------------

  // Send a message. With no session yet (a New chat draft) OpenCode creates one
  // and we return the real id so the caller can re-key the open conversation.
  async sendPrompt({ id, text, cwd, plan, model, files = [] }) {
    let sid = id ? apiId(id) : '';
    if (!this.connected) await this.ensureService();
    if (!sid) {
      const created = await this.call('POST', '/api/session', { location: { directory: cwd } });
      sid = created.data.id;
      this.raw.set(hudId(sid), created.data);
    }
    if (plan) await this.call('POST', `/api/session/${sid}/agent`, { agent: 'plan' }).catch(() => {});
    const ref = await this.resolveModel(model, cwd).catch(() => null);
    if (ref) await this.call('POST', `/api/session/${sid}/model`, { model: ref }).catch(() => {});
    this.live.set(hudId(sid), { ...newTurn(), running: true, startedAt: Date.now() });
    this.refresh(hudId(sid));
    const body = { text };
    if (files.length) body.files = files;
    await this.call('POST', `/api/session/${sid}/prompt`, body);
    return sid;
  }

  async interrupt(id) {
    return this.call('POST', `/api/session/${apiId(id)}/interrupt`, undefined).catch(() => null);
  }

  async replyPermission(requestID, decision) {
    const req = this.permissions.get(requestID);
    if (!req) return false;
    this.permissions.delete(requestID);
    await this.call('POST', `/api/session/${req.sessionID}/permission/${requestID}/reply`, { decision });
    return true;
  }

  // Same shape as readClaudeHistory: an array of { role, text, ts } with a
  // `.cwd` property on it (the HUD and handoff-note both rely on that).
  async history(id) {
    const sid = apiId(id);
    const res = await this.call('GET', `/api/session/${sid}/message`);
    const session = await this.call('GET', `/api/session/${sid}`).catch(() => null);
    const messages = [];
    // GET /message is newest first; the HUD renders oldest first.
    for (const m of (res.data || []).slice().reverse()) {
      if (m.type === 'user') {
        messages.push({ role: 'user', text: m.text || '', ts: m.time?.created || 0, imageCount: (m.files || []).length });
      } else if (m.type === 'assistant') {
        messages.push({ role: 'assistant', text: assistantText(m), ts: m.time?.created || 0, edits: [] });
      }
    }
    messages.cwd = session?.data?.location?.directory || '';
    return messages;
  }

  // The background service stops now and then; start it (once at a time) and reconnect.
  // Resolves true when it answers again.
  ensureService() {
    if (!this.starting) {
      this.starting = new Promise((resolve) => {
        require('child_process').exec('opencode service start', { timeout: 20000, windowsHide: true }, () => resolve());
      }).then(() => {
        this.endpoint = this.readService() || this.endpoint;
        return this.call('GET', '/api/model', undefined, 5000).then(() => true, () => false);
      }).then((ok) => {
        if (ok && !this.connected) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; this.connectLoop(); }
        return ok;
      }).finally(() => { this.starting = null; });
    }
    return this.starting;
  }

  // Chat models for this folder, normalised for the HUD's /model menu.
  // If the service is down, start it and try once more.
  async models(cwd) {
    try { return await this.modelsOnce(cwd); } catch (err) {
      if (!(await this.ensureService())) throw err;
      return this.modelsOnce(cwd);
    }
  }

  async modelsOnce(cwd) {
    const q = cwd ? '?directory=' + encodeURIComponent(cwd) : '';
    const res = await this.call('GET', '/api/model' + q);
    return (res.data || [])
      .filter((m) => m && m.enabled !== false && (m.type === 'chat' || !m.type))
      .map((m) => ({
        id: m.modelID || m.id,
        modelID: m.modelID || m.id,
        providerID: m.providerID,
        name: m.name || m.modelID || m.id,
        description: m.name || m.modelID || m.id,
      }));
  }

  // The UI stores "providerID/modelID" (or just a model id/name). OpenCode's
  // API needs both halves, so look them up once per folder.
  async resolveModel(value, cwd) {
    const s = String(value || '').trim();
    if (!s || s === 'default') return null;
    const list = await this.models(cwd);
    const lower = s.toLowerCase();
    const found = list.find((m) =>
      `${m.providerID}/${m.modelID}` === s || m.modelID === s || m.id === s ||
      String(m.name).toLowerCase() === lower);
    if (found) return { id: found.modelID, providerID: found.providerID };
    if (s.includes('/')) {
      const [providerID, ...rest] = s.split('/');
      if (providerID && rest.length) return { id: rest.join('/'), providerID };
    }
    return null;
  }

  async commands(cwd) {
    const q = cwd ? '?directory=' + encodeURIComponent(cwd) : '';
    const [cmds, skills] = await Promise.all([
      this.call('GET', '/api/command' + q).catch(() => ({ data: [] })),
      this.call('GET', '/api/skill' + q).catch(() => ({ data: [] })),
    ]);
    const out = [];
    for (const c of cmds.data || []) out.push({ name: c.name, description: c.description || '', kind: 'command', scope: 'opencode' });
    for (const s of skills.data || []) {
      const name = s.name || s.id;
      if (name) out.push({ name, description: s.description || '', kind: 'skill', scope: 'opencode' });
    }
    return out;
  }

  status() {
    return { connected: this.connected, error: this.lastError, url: this.endpoint?.url || '' };
  }
}

function newTurn() {
  return { running: false, text: '', tool: '', detail: '', startedAt: 0, failed: false, toolNames: new Map() };
}

module.exports = OpencodeWatcher;
module.exports.hudId = hudId;
module.exports.apiId = apiId;
module.exports.endsWithQuestion = endsWithQuestion;
module.exports.assistantText = assistantText;
module.exports.toolSummary = toolSummary;
