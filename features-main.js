// Main-process side of the HUD's extra features:
//   • settings store (survives restarts — the app's userData folder is temporary)
//   • conversation history + files edited per reply (from Claude Code transcripts)
//   • search across all transcripts
//   • "done" desktop notifications + today's digest
//   • Stop a reply sent from the HUD
//   • voice typing (Windows Win+H), global hotkey, per-session cost, export
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { Notification, shell, dialog, globalShortcut } = require('electron');

let ctx = null; // { app, ipcMain, getWin, getWatcher, showHud }

// ---------------------------------------------------------------------------
// Settings store: ~/.ovly-claude/settings.json
// ---------------------------------------------------------------------------
const STORE_DIR = path.join(os.homedir(), '.ovly-claude');
const STORE_FILE = path.join(STORE_DIR, 'settings.json');
let store = {};
try { store = JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8')) || {}; } catch (_) { store = {}; }
let saveTimer = null;
function saveStore() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(STORE_DIR, { recursive: true });
      fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
    } catch (e) { console.error('[store] save failed:', e.message); }
  }, 200);
}
const getSetting = (k, d) => (store[k] === undefined ? d : store[k]);
function setSetting(k, v) { store[k] = v; saveStore(); }

// ---------------------------------------------------------------------------
// Transcript reading
// ---------------------------------------------------------------------------
const EDIT_TOOLS = new Set([
  'Edit', 'MultiEdit', 'Write', 'NotebookEdit',
  'edit_file', 'write_file', 'replace_file_content', 'multi_replace_file_content',
]);
const HUNK_MAX = 6000; // chars per side kept for the diff view

function unwrapAgString(v) {
  if (typeof v !== 'string') return v == null ? '' : String(v);
  const t = v.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    try { return JSON.parse(t); } catch (_) { return t.slice(1, -1); }
  }
  return v;
}

function readTail(filePath, bytes) {
  const size = fs.statSync(filePath).size;
  const start = Math.max(0, size - bytes);
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString('utf-8').split('\n');
    if (start > 0) lines.shift(); // first line is probably cut in half
    return lines;
  } finally { fs.closeSync(fd); }
}

function textOfContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b && b.type === 'text' && b.text).map((b) => b.text).join('\n\n');
}

const lineCount = (s) => (s ? String(s).split('\n').length : 0);
const clip = (s) => { s = String(s || ''); return s.length > HUNK_MAX ? s.slice(0, HUNK_MAX) + '\n…' : s; };

// One tool_use block (Claude or Antigravity) → { path, added, removed, hunks: [{ old, new }] } or null
function editFromToolUse(b) {
  if (!b || !EDIT_TOOLS.has(b.name)) return null;
  if (b.type && b.type !== 'tool_use') return null;
  const inp = b.input || b.args || {};
  const rawPath = inp.file_path || inp.notebook_path || inp.path || inp.Path || inp.TargetFile;
  const p = unwrapAgString(rawPath);
  if (!p) return null;
  const hunks = [];
  if (b.name === 'Write' || b.name === 'write_file') {
    const content = unwrapAgString(inp.content ?? inp.Content ?? '');
    hunks.push({ old: '', new: content, whole: true });
  } else if (b.name === 'MultiEdit' && Array.isArray(inp.edits)) {
    for (const e of inp.edits) hunks.push({ old: e.old_string || '', new: e.new_string || '' });
  } else if (b.name === 'multi_replace_file_content') {
    let chunks = inp.ReplacementChunks || inp.chunks || [];
    if (typeof chunks === 'string') { try { chunks = JSON.parse(chunks); } catch (_) { chunks = []; } }
    if (Array.isArray(chunks)) {
      for (const c of chunks) {
        hunks.push({
          old: unwrapAgString(c.TargetContent ?? c.old_string ?? ''),
          new: unwrapAgString(c.ReplacementContent ?? c.new_string ?? ''),
        });
      }
    }
  } else if (b.name === 'NotebookEdit') {
    hunks.push({ old: '', new: inp.new_source || '' });
  } else if (b.name === 'edit_file' || b.name === 'replace_file_content') {
    hunks.push({
      old: unwrapAgString(inp.Target ?? inp.TargetContent ?? inp.old_string ?? ''),
      new: unwrapAgString(inp.Replacement ?? inp.ReplacementContent ?? inp.new_string ?? ''),
    });
  } else {
    hunks.push({ old: inp.old_string || '', new: inp.new_string || '' });
  }
  let added = 0, removed = 0;
  for (const h of hunks) { added += lineCount(h.new); removed += lineCount(h.old); }
  return { path: p, added, removed, hunks: hunks.map((h) => ({ old: clip(h.old), new: clip(h.new), whole: !!h.whole })) };
}

function mergeEdit(list, ed) {
  const same = list.find((x) => x.path.toLowerCase() === ed.path.toLowerCase());
  if (!same) { list.push(ed); return; }
  same.added += ed.added; same.removed += ed.removed;
  same.hunks.push(...ed.hunks);
  if (same.hunks.length > 30) same.hunks = same.hunks.slice(-30);
}

// Your prompts + Claude's replies (text joined per turn) + the files each reply
// edited. Tool output, meta entries and slash-command plumbing are skipped.
function readClaudeHistory(filePath, { tailBytes = 4 * 1024 * 1024, max = 80 } = {}) {
  const msgs = [];
  let cwd = '';
  for (const line of readTail(filePath, tailBytes)) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch (_) { continue; }
    if (e.cwd) cwd = e.cwd;
    if (e.isSidechain || (e.type !== 'user' && e.type !== 'assistant')) continue;
    const ts = Date.parse(e.timestamp) || 0;
    const content = e.message?.content;

    if (e.type === 'user') {
      if (e.isMeta || e.isCompactSummary) continue;
      if (Array.isArray(content) && content.some((b) => b && b.type === 'tool_result')) continue;
      let text = textOfContent(content).trim();
      if (/^<(local-command-|command-name|command-message|command-args|system-reminder|bash-|user-memory)/.test(text)) continue;
      text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
      const imageCount = Array.isArray(content) ? content.filter((b) => b && b.type === 'image').length : 0;
      if (!text && !imageCount) continue;
      msgs.push({ role: 'user', text, ts, imageCount });
    } else {
      const text = textOfContent(content).trim();
      const edits = Array.isArray(content) ? content.map(editFromToolUse).filter(Boolean) : [];
      if (!text && !edits.length) continue;
      let last = msgs[msgs.length - 1];
      if (!last || last.role !== 'assistant') { last = { role: 'assistant', text: '', ts, edits: [] }; msgs.push(last); }
      if (text) last.text = last.text ? last.text + '\n\n' + text : text;
      last.ts = ts || last.ts;
      for (const ed of edits) mergeEdit(last.edits, ed);
    }
  }
  for (const m of msgs) {
    if (m.role === 'assistant' && !m.text && m.edits?.length) m.text = '*(edited files — see below)*';
  }
  const out = msgs.slice(-max);
  out.cwd = cwd;
  return out;
}

function cleanAgUserPrompt(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const m = raw.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
  if (m) return m[1].trim();
  const stripped = raw
    .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, '')
    .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/g, '')
    .replace(/<CONTEXT_SUMMARY>[\s\S]*?<\/CONTEXT_SUMMARY>/g, '')
    .trim();
  return stripped;
}

function readAntigravityHistory(filePath, { tailBytes = 6 * 1024 * 1024, max = 80, dbPath = null } = {}) {
  const msgs = [];
  let cwd = '';
  let maxStepSeen = -1;

  if (filePath && fs.existsSync(filePath)) {
    for (const line of readTail(filePath, tailBytes)) {
      if (!line.trim()) continue;
      let e;
      try { e = JSON.parse(line); } catch (_) { continue; }
      if (typeof e.step_index === 'number' && e.step_index > maxStepSeen) maxStepSeen = e.step_index;
      const ts = Date.parse(e.created_at) || 0;
      const contentStr = typeof e.content === 'string' ? e.content : '';

      if (!cwd && contentStr) {
        const ws = contentStr.match(/Active Workspaces:\s*\r?\n-\s*([a-zA-Z]:\\[^\r\n]+|\/[^\r\n]+)/);
        if (ws) cwd = ws[1].trim();
        else {
          const cw = contentStr.match(/Command Working Directory:\s*([a-zA-Z]:\\[^\r\n]+|\/[^\r\n]+)/);
          if (cw) cwd = cw[1].trim();
          else {
            const doc = contentStr.match(/Active Document:\s*([a-zA-Z]:\\[^\r\n(]+|\/[^\r\n(]+)/);
            if (doc) cwd = path.dirname(doc[1].trim());
          }
        }
      }

      if (e.type === 'USER_INPUT') {
        const text = cleanAgUserPrompt(contentStr);
        const imageCount = Array.isArray(e.media) ? e.media.length : 0;
        if (!text && !imageCount) continue;
        msgs.push({ role: 'user', text, ts, imageCount });
      } else if (e.type === 'PLANNER_RESPONSE') {
        const text = contentStr.trim();
        const tcs = Array.isArray(e.tool_calls) ? e.tool_calls : [];
        const edits = tcs.map((tc) => editFromToolUse({ name: tc?.name, args: tc?.args })).filter(Boolean);
        let askText = '';
        const askCall = tcs.find((tc) => tc && tc.name === 'ask_question');
        if (askCall && !text) {
          let qs = askCall.args?.questions || [];
          if (typeof qs === 'string') { try { qs = JSON.parse(qs); } catch (_) { qs = []; } }
          if (Array.isArray(qs) && qs.length) {
            askText = qs.map((q) => {
              const opts = Array.isArray(q.options) ? q.options.map((o) => `  - ${typeof o === 'string' ? o : o?.label}`).join('\n') : '';
              return `**${q.question || 'Question'}**${opts ? '\n' + opts : ''}`;
            }).join('\n\n');
          }
        }
        const finalText = text || askText;
        if (!finalText && !edits.length) continue;
        let last = msgs[msgs.length - 1];
        if (!last || last.role !== 'assistant') {
          last = { role: 'assistant', text: '', ts, edits: [] };
          msgs.push(last);
        }
        if (finalText) last.text = last.text ? last.text + '\n\n' + finalText : finalText;
        last.ts = ts || last.ts;
        for (const ed of edits) mergeEdit(last.edits, ed);
      } else if (e.type === 'ERROR_MESSAGE' && contentStr.trim()) {
        let last = msgs[msgs.length - 1];
        const errLine = `*(Error: ${contentStr.trim()})*`;
        if (!last || last.role !== 'assistant') {
          msgs.push({ role: 'assistant', text: errLine, ts, edits: [] });
        } else {
          last.text = last.text ? last.text + '\n\n' + errLine : errLine;
        }
      }
    }
  }

  // Fallback / supplement from SQLite steps if DB has newer steps than transcript.jsonl
  const watcher = ctx?.getWatcher?.();
  if (dbPath && fs.existsSync(dbPath) && watcher && typeof watcher.getSqlite === 'function') {
    const DatabaseSync = watcher.getSqlite();
    if (DatabaseSync) {
      let db;
      try {
        db = new DatabaseSync(dbPath, { readOnly: true });
        watcher.learnAntigravityEnums(db, filePath);
        const typeInt = (name) => [...(watcher.agTypeNames || [])].find(([, v]) => v === name)?.[0];
        const userT = typeInt('USER_INPUT');
        const planT = typeInt('PLANNER_RESPONSE');
        if (userT !== undefined || planT !== undefined) {
          const rows = db.prepare('SELECT idx, step_type, step_payload FROM steps WHERE idx > ? ORDER BY idx ASC').all(maxStepSeen);
          for (const r of rows) {
            const tName = watcher.agTypeNames.get(r.step_type);
            if (tName === 'USER_INPUT') {
              const txt = cleanAgUserPrompt(watcher.extractBlobText(r.step_payload));
              if (txt) msgs.push({ role: 'user', text: txt, ts: Date.now(), imageCount: 0 });
            } else if (tName === 'PLANNER_RESPONSE') {
              const txt = watcher.extractBlobText(r.step_payload);
              if (txt) {
                let last = msgs[msgs.length - 1];
                if (!last || last.role !== 'assistant') {
                  last = { role: 'assistant', text: '', ts: Date.now(), edits: [] };
                  msgs.push(last);
                }
                last.text = last.text ? last.text + '\n\n' + txt : txt;
              }
            }
          }
        }
      } catch (_) {} finally {
        try { db && db.close(); } catch (_) {}
      }
    }
  }

  for (const m of msgs) {
    if (m.role === 'assistant' && !m.text && m.edits?.length) m.text = '*(edited files — see below)*';
  }
  const out = msgs.slice(-max);
  out.cwd = cwd;
  return out;
}

// ---------------------------------------------------------------------------
// Session paths (watcher sessions + ones found by search)
// ---------------------------------------------------------------------------
const extraPaths = new Map(); // sessionId -> transcript path
function pathForSession(id) {
  const s = ctx?.getWatcher?.()?.sessions?.get(id);
  if (s?.filePath && fs.existsSync(s.filePath)) return s.filePath;
  const p = extraPaths.get(id);
  if (p && fs.existsSync(p)) return p;
  if (typeof id === 'string' && id.startsWith('antigravity_')) {
    const uuid = id.slice('antigravity_'.length);
    for (const dirName of ['antigravity', 'antigravity-ide', 'antigravity-cli']) {
      const candidate = path.join(os.homedir(), '.gemini', dirName, 'brain', uuid, '.system_generated', 'logs', 'transcript.jsonl');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function readSessionHistory(id, opts = {}) {
  const s = ctx?.getWatcher?.()?.sessions?.get(id);
  const p = pathForSession(id);
  const isAg = (s && s.source === 'antigravity') || (typeof id === 'string' && id.startsWith('antigravity_'));
  if (isAg) {
    let dbPath = s?.dbPath || null;
    if (!dbPath && typeof id === 'string' && id.startsWith('antigravity_')) {
      const uuid = id.slice('antigravity_'.length);
      for (const dirName of ['antigravity', 'antigravity-ide', 'antigravity-cli']) {
        const cand = path.join(os.homedir(), '.gemini', dirName, 'conversations', `${uuid}.db`);
        if (fs.existsSync(cand)) { dbPath = cand; break; }
      }
    }
    if (!p && !dbPath) return null;
    const msgs = readAntigravityHistory(p, { ...opts, dbPath });
    if (!msgs.cwd && s?.cwd) msgs.cwd = s.cwd;
    return msgs;
  }
  if (!p) return null;
  const msgs = readClaudeHistory(p, opts);
  if (!msgs.cwd && s?.cwd) msgs.cwd = s.cwd;
  return msgs;
}

// ---------------------------------------------------------------------------
// Search across all Claude Code & Antigravity transcripts
// ---------------------------------------------------------------------------
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const AG_ROOTS = ['antigravity', 'antigravity-ide', 'antigravity-cli'].map((name) =>
  path.join(os.homedir(), '.gemini', name)
);
const SEARCH_MAX_FILES = 400;
const SEARCH_MAX_DAYS = 60;
const SEARCH_MAX_BYTES = 24 * 1024 * 1024;

async function listTranscripts() {
  const out = [];
  const cutoff = Date.now() - SEARCH_MAX_DAYS * 86400000;
  try {
    const dirs = await fs.promises.readdir(PROJECTS_DIR, { withFileTypes: true });
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const dir = path.join(PROJECTS_DIR, d.name);
      let files = [];
      try { files = await fs.promises.readdir(dir); } catch (_) { continue; }
      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue;
        const p = path.join(dir, f);
        try {
          const st = await fs.promises.stat(p);
          if (st.mtimeMs >= cutoff) out.push({ source: 'claude', path: p, mtime: st.mtimeMs, size: st.size, dirName: d.name });
        } catch (_) {}
      }
    }
  } catch (_) {}

  for (const root of AG_ROOTS) {
    const brainDir = path.join(root, 'brain');
    let dirs = [];
    try { dirs = await fs.promises.readdir(brainDir, { withFileTypes: true }); } catch (_) { continue; }
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const p = path.join(brainDir, d.name, '.system_generated', 'logs', 'transcript.jsonl');
      try {
        const st = await fs.promises.stat(p);
        if (st.mtimeMs >= cutoff) {
          out.push({ source: 'antigravity', path: p, mtime: st.mtimeMs, size: st.size, uuid: d.name, root });
        }
      } catch (_) {}
    }
  }

  out.sort((a, b) => b.mtime - a.mtime);
  return out.slice(0, SEARCH_MAX_FILES);
}

function snippetAround(text, q, radius = 70) {
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return text.slice(0, radius * 2);
  const s = Math.max(0, i - radius);
  const e = Math.min(text.length, i + q.length + radius);
  return (s > 0 ? '…' : '') + text.slice(s, e).replace(/\s+/g, ' ') + (e < text.length ? '…' : '');
}

async function searchTranscripts(query) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const hits = [];
  const watcher = ctx?.getWatcher?.();

  for (const f of await listTranscripts()) {
    if (hits.length >= 40) break;
    let raw;
    try {
      if (f.size > SEARCH_MAX_BYTES) {
        const fd = await fs.promises.open(f.path, 'r');
        const buf = Buffer.alloc(SEARCH_MAX_BYTES);
        await fd.read(buf, 0, SEARCH_MAX_BYTES, f.size - SEARCH_MAX_BYTES);
        await fd.close();
        raw = buf.toString('utf-8');
      } else raw = await fs.promises.readFile(f.path, 'utf-8');
    } catch (_) { continue; }
    if (!raw.toLowerCase().includes(q)) continue;

    if (f.source === 'antigravity') {
      const uuid = f.uuid;
      const id = 'antigravity_' + uuid;
      const summaries = watcher ? watcher.readAgSummaries(path.join(f.root, 'conversation_summaries.db')) : new Map();
      const sum = summaries.get(uuid);
      if (sum?.isSubagent) continue;
      let cwd = sum?.cwd || '', title = sum?.title || '', perFile = 0;
      const lines = raw.split('\n');
      for (let i = lines.length - 1; i >= 0 && perFile < 3; i--) {
        const line = lines[i];
        if (!line.toLowerCase().includes(q)) continue;
        let e;
        try { e = JSON.parse(line); } catch (_) { continue; }
        if (e.type !== 'USER_INPUT' && e.type !== 'PLANNER_RESPONSE') continue;
        const contentStr = typeof e.content === 'string' ? e.content : '';
        const text = e.type === 'USER_INPUT' ? cleanAgUserPrompt(contentStr) : contentStr.trim();
        if (!text || !text.toLowerCase().includes(q)) continue;
        const role = e.type === 'USER_INPUT' ? 'user' : 'assistant';
        hits.push({
          id, uuid, source: 'antigravity', path: f.path, role,
          ts: Date.parse(e.created_at) || f.mtime,
          snippet: snippetAround(text, q),
        });
        perFile++;
      }
      if (!cwd) {
        for (const line of lines) {
          const m = line.match(/Active Workspaces:\\n-\s*([a-zA-Z]:\\\\[^\\"\r\n]+|\/[^\\"\r\n]+)/);
          if (m) { cwd = m[1].replace(/\\\\/g, '\\').trim(); break; }
        }
      }
      const project = cwd ? path.basename(cwd) : 'Antigravity';
      for (const h of hits) if (h.path === f.path) { h.cwd = cwd; h.project = project; h.title = title; }
      extraPaths.set(id, f.path);
      continue;
    }

    const uuid = path.basename(f.path, '.jsonl');
    const id = 'claude_' + uuid;
    let cwd = '', title = '', perFile = 0;
    const lines = raw.split('\n');
    for (let i = lines.length - 1; i >= 0 && perFile < 3; i--) { // newest first
      const line = lines[i];
      if (!cwd && line.includes('"cwd"')) { try { cwd = JSON.parse(line).cwd || ''; } catch (_) {} }
      if (!title && line.includes('"ai-title"')) { try { const t = JSON.parse(line); title = t.aiTitle || t.title || ''; } catch (_) {} }
      if (!line.toLowerCase().includes(q)) continue;
      let e;
      try { e = JSON.parse(line); } catch (_) { continue; }
      if (e.isSidechain || e.isMeta || (e.type !== 'user' && e.type !== 'assistant')) continue;
      const content = e.message?.content;
      if (Array.isArray(content) && content.some((b) => b && b.type === 'tool_result')) continue;
      const text = textOfContent(content);
      if (!text.toLowerCase().includes(q) || /^<(local-command-|command-name|system-reminder)/.test(text.trim())) continue;
      hits.push({ id, uuid, source: 'claude', path: f.path, role: e.type, ts: Date.parse(e.timestamp) || f.mtime, snippet: snippetAround(text, q) });
      perFile++;
    }
    if (!cwd) { for (const line of lines) { if (line.includes('"cwd"')) { try { cwd = JSON.parse(line).cwd || ''; } catch (_) {} if (cwd) break; } } }
    const project = cwd ? path.basename(cwd) : f.dirName.replace(/^[a-zA-Z]--Users-[^-]+-(Desktop-)?/, '');
    for (const h of hits) if (h.path === f.path) { h.cwd = cwd; h.project = project; h.title = title; }
    extraPaths.set(id, f.path);
  }
  return hits.slice(0, 40);
}

// ---------------------------------------------------------------------------
// "Done" notifications + today's digest
// ---------------------------------------------------------------------------
const runningSince = new Map(); // sessionId -> ms
const prevStatus = new Map();
const todayKey = () => new Date().toISOString().slice(0, 10);

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function lastTurnEdits(sessionOrId) {
  try {
    const id = typeof sessionOrId === 'string' ? sessionOrId : sessionOrId?.id;
    const msgs = readSessionHistory(id, { tailBytes: 1024 * 1024, max: 4 });
    if (!msgs || !msgs.length) return [];
    const last = msgs[msgs.length - 1];
    return last && last.role === 'assistant' ? (last.edits || []) : [];
  } catch (_) { return []; }
}

function recordFinished(s, durationMs) {
  const daily = getSetting('daily', {});
  const k = todayKey();
  const d = daily[k] || { finished: 0, byProject: {}, ms: 0 };
  d.finished++;
  d.ms += durationMs || 0;
  d.byProject[s.project || '?'] = (d.byProject[s.project || '?'] || 0) + 1;
  daily[k] = d;
  for (const key of Object.keys(daily).sort().slice(0, -14)) delete daily[key]; // keep 2 weeks
  setSetting('daily', daily);
}

function onSync(sessions) {
  const finished = [];
  for (const s of sessions) {
    const prev = prevStatus.get(s.id);
    prevStatus.set(s.id, s.status);
    if (s.status === 'running' && prev !== 'running') runningSince.set(s.id, Date.now());
    if (prev === 'running' && s.status === 'idle' && !s.stale) finished.push(s);
  }
  for (const s of finished) {
    const dur = Date.now() - (runningSince.get(s.id) || Date.now());
    runningSince.delete(s.id);
    recordFinished(s, dur);
    if (!getSetting('notify', true)) continue;
    const win = ctx.getWin();
    // You are already looking at it → no toast
    if (win && win.isVisible() && win.isFocused() && ctx.viewingSessionId === s.id) continue;
    const edits = lastTurnEdits(s.id);
    const parts = [];
    if (edits.length) parts.push(`${edits.length} file${edits.length > 1 ? 's' : ''} changed`);
    if (dur > 1500) parts.push(fmtDuration(dur));
    const defaultAgent = s.source === 'antigravity' ? 'Antigravity' : 'Claude';
    showToast({
      title: `${s.project || defaultAgent} finished${s.state === 'attention' ? ' — needs your reply' : ''}`,
      body: [s.sessionTitle, parts.join(' · ')].filter(Boolean).join('\n'),
      sessionId: s.id,
    });
  }
}

function showToast({ title, body, sessionId }) {
  if (!Notification.isSupported()) return;
  try {
    const n = new Notification({ title, body, silent: true });
    n.on('click', () => {
      ctx.showHud();
      const win = ctx.getWin();
      if (sessionId && win && !win.isDestroyed()) win.webContents.send('open-session', { sessionId });
    });
    n.show();
  } catch (e) { console.error('[notify]', e.message); }
}

function digestText() {
  const d = getSetting('daily', {})[todayKey()];
  const sessions = [...(ctx.getWatcher()?.sessions?.values() || [])];
  const waiting = sessions.filter((s) => s.unread || s.state === 'attention').length;
  const running = sessions.filter((s) => s.status === 'running').length;
  const lines = [];
  lines.push(d ? `${d.finished} task${d.finished === 1 ? '' : 's'} finished today (${fmtDuration(d.ms)} of agent time)` : 'No tasks finished yet today');
  if (d) {
    const top = Object.entries(d.byProject).sort((a, b) => b[1] - a[1]).slice(0, 5);
    lines.push(top.map(([p, n]) => `${p} ${n}`).join(' · '));
  }
  lines.push(`${running} running · ${waiting} waiting for you`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Stop a HUD-sent reply
// ---------------------------------------------------------------------------
const children = new Map(); // sessionId -> { child, stopped }
function trackChild(sessionId, child) {
  const rec = { child, stopped: false };
  children.set(sessionId, rec);
  // forget it a moment after it ends (main.js asks wasStopped() in its own close handler)
  child.on('close', () => setTimeout(() => { for (const [k, v] of children) if (v === rec) children.delete(k); }, 2000));
  return rec;
}
function aliasChild(oldId, newId) { const r = children.get(oldId); if (r) children.set(newId, r); }
function wasStopped(sessionId) { return !!children.get(sessionId)?.stopped; }
function stopReply(sessionId) {
  const rec = children.get(sessionId);
  if (!rec || !rec.child.pid) return false;
  rec.stopped = true;
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(rec.child.pid), '/T', '/F'], () => {});
  else try { rec.child.kill('SIGTERM'); } catch (_) {}
  return true;
}

// ---------------------------------------------------------------------------
// Per-session cost (Claude Code writes a running total in "cost-state")
// ---------------------------------------------------------------------------
const costCache = new Map(); // id -> { mtime, cost }
function sessionCost(id) {
  const p = pathForSession(id);
  if (!p) return null;
  try {
    const st = fs.statSync(p);
    const c = costCache.get(id);
    if (c && c.mtime === st.mtimeMs) return c.cost;
    const size = st.size, len = Math.min(size, 3 * 1024 * 1024);
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    const raw = buf.toString('utf-8');
    let cost = null;
    const i = raw.lastIndexOf('"cost-state"');
    if (i >= 0) {
      const s = raw.lastIndexOf('\n', i) + 1;
      const e = raw.indexOf('\n', i);
      try { const o = JSON.parse(raw.slice(s, e < 0 ? undefined : e)); if (typeof o.totalCostUSD === 'number') cost = o.totalCostUSD; } catch (_) {}
    }
    costCache.set(id, { mtime: st.mtimeMs, cost });
    return cost;
  } catch (_) { return null; }
}

// ---------------------------------------------------------------------------
// Voice typing: Windows' own dictation (Win+H) into the focused input box
// ---------------------------------------------------------------------------
function startVoiceTyping() {
  if (process.platform !== 'win32') return false;
  const ps = `
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class K { [DllImport("user32.dll")] public static extern void keybd_event(byte b, byte s, uint f, UIntPtr e); }
'@
[K]::keybd_event(0x5B,0,0,[UIntPtr]::Zero); [K]::keybd_event(0x48,0,0,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 40
[K]::keybd_event(0x48,0,2,[UIntPtr]::Zero); [K]::keybd_event(0x5B,0,2,[UIntPtr]::Zero)`;
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true }, () => {});
  return true;
}

// ---------------------------------------------------------------------------
// Open a file in VS Code (falls back to the default app)
// ---------------------------------------------------------------------------
async function openFile(p) {
  if (!p || !path.isAbsolute(p) || !fs.existsSync(p)) return 'missing';
  try {
    await shell.openExternal('vscode://file/' + encodeURI(p.replace(/\\/g, '/')));
    return 'vscode';
  } catch (_) {
    const err = await shell.openPath(p);
    return err ? 'error' : 'default';
  }
}

// ---------------------------------------------------------------------------
// Git: current branch, changes, ahead/behind, and the git user for a folder
// ---------------------------------------------------------------------------
const gitCache = new Map(); // cwd -> { at, info }
function git(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, ...args], { windowsHide: true, timeout: 4000, maxBuffer: 1024 * 1024 },
      (err, stdout) => resolve(err ? null : String(stdout).trim()));
  });
}
async function gitInfo(cwd) {
  if (!cwd || typeof cwd !== 'string' || !path.isAbsolute(cwd) || !fs.existsSync(cwd)) return null;
  const c = gitCache.get(cwd);
  if (c && Date.now() - c.at < 4000) return c.info;
  let info = null;
  const top = await git(cwd, ['rev-parse', '--show-toplevel']);
  if (top) {
    // "## main...origin/main [ahead 1, behind 2]" + one line per changed file
    const [status, name, email] = await Promise.all([
      git(cwd, ['status', '--porcelain=v1', '--branch', '--untracked-files=normal']),
      git(cwd, ['config', 'user.name']),
      git(cwd, ['config', 'user.email']),
    ]);
    const lines = (status || '').split(/\r?\n/).filter(Boolean);
    const head = lines[0] && lines[0].startsWith('## ') ? lines.shift().slice(3) : '';
    let branch = head, upstream = '', ahead = 0, behind = 0, detached = false;
    const m = head.match(/^(.+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$/);
    if (m) {
      branch = m[1];
      upstream = m[2] || '';
      const ab = m[3] || '';
      ahead = Number((ab.match(/ahead (\d+)/) || [])[1] || 0);
      behind = Number((ab.match(/behind (\d+)/) || [])[1] || 0);
    }
    if (/^HEAD \(no branch\)$/.test(branch) || branch === 'HEAD') {
      detached = true;
      branch = (await git(cwd, ['rev-parse', '--short', 'HEAD'])) || 'HEAD';
    }
    if (/^No commits yet on /.test(branch)) branch = branch.replace(/^No commits yet on /, '');
    const staged = lines.filter((l) => l[0] !== ' ' && l[0] !== '?').length;
    const untracked = lines.filter((l) => l.startsWith('??')).length;
    info = {
      repo: path.basename(top), branch, upstream, ahead, behind, detached,
      changed: lines.length, staged, untracked,
      userName: name || '', userEmail: email || '',
    };
  }
  gitCache.set(cwd, { at: Date.now(), info });
  return info;
}

// ---------------------------------------------------------------------------
// Register IPC
// ---------------------------------------------------------------------------
function register(c) {
  ctx = { viewingSessionId: null, ...c };
  const { ipcMain, app } = c;

  ipcMain.handle('store-get-all', () => store);
  ipcMain.on('store-get-sync', (e) => { e.returnValue = store; }); // preload hands this to the page at load, so the theme needs no flash
  ipcMain.on('store-set', (_e, { key, value }) => setSetting(key, value));

  ipcMain.handle('search-transcripts', (_e, q) => searchTranscripts(q).catch(() => []));
  ipcMain.handle('open-file', (_e, p) => openFile(p));
  ipcMain.handle('stop-reply', (_e, id) => stopReply(id));
  ipcMain.handle('voice-typing', () => startVoiceTyping());
  ipcMain.handle('get-digest', () => digestText());
  ipcMain.handle('get-session-costs', (_e, ids) => {
    const out = {};
    for (const id of (ids || []).slice(0, 200)) { const v = sessionCost(id); if (v != null) out[id] = v; }
    return out;
  });
  ipcMain.on('viewing-session', (_e, id) => { ctx.viewingSessionId = id || null; });
  ipcMain.handle('export-conversation', async (_e, { name, markdown }) => {
    const safe = String(name || 'conversation').replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-').slice(0, 80);
    const r = await dialog.showSaveDialog(ctx.getWin(), {
      title: 'Export conversation',
      defaultPath: path.join(app.getPath('documents'), `${safe}.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, String(markdown || ''), 'utf-8');
    return r.filePath;
  });

  // Remote Control: continue a conversation from claude.ai/code or the Claude
  // mobile app, or via Antigravity's Remote Control (`agy --remote-control`).
  ipcMain.handle('remote-control', (_e, { mode, cwd, uuid, name, source, appDataDir } = {}) => {
    const dir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
    const safeName = String(name || path.basename(dir) || 'HUD').replace(/[^\w .\-()]/g, '').trim().slice(0, 60) || 'HUD';

    if (source === 'antigravity') {
      const agy = c.findAgyBinary && c.findAgyBinary();
      if (!agy || !fs.existsSync(agy)) return { ok: false, error: 'Antigravity CLI (agy) was not found on this PC.' };
      const dataDir = String(appDataDir || 'antigravity').replace(/[^\w\-]/g, '') || 'antigravity';
      const args = [`--app_data_dir=${dataDir}`];
      if (mode === 'folder') {
        args.push('remote-control', 'start');
      } else {
        if (uuid) {
          if (!/^[0-9a-f-]{8,64}$/i.test(uuid)) return { ok: false, error: 'Bad session id' };
          args.push('--conversation', uuid);
        }
        args.push('--remote-control');
      }
      try {
        if (process.platform === 'win32') {
          const cmdLine = `/d /c start "Antigravity Remote Control - ${safeName}" "${agy}" ${args.join(' ')}`;
          const child = require('child_process').spawn('cmd.exe', [cmdLine], {
            cwd: dir, detached: true, windowsVerbatimArguments: true, stdio: 'ignore', windowsHide: false,
          });
          child.unref();
        } else {
          const child = require('child_process').spawn(agy, args, { cwd: dir, detached: true, stdio: 'ignore' });
          child.unref();
        }
        return { ok: true, name: safeName };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    const bin = c.findClaudeBinary && c.findClaudeBinary();
    if (!bin || !fs.existsSync(bin)) return { ok: false, error: 'Claude Code was not found on this PC.' };
    const args = [];
    if (mode === 'folder') {
      args.push('remote-control', '--name', `"${safeName}"`);
    } else {
      if (uuid) {
        if (!/^[0-9a-f-]{8,64}$/i.test(uuid)) return { ok: false, error: 'Bad session id' };
        args.push('--resume', uuid);
      }
      args.push('--remote-control', `"${safeName}"`);
    }
    try {
      if (process.platform === 'win32') {
        // `start` gives Claude its own console window
        const cmdLine = `/d /c start "Claude Remote Control - ${safeName}" "${bin}" ${args.join(' ')}`;
        const child = require('child_process').spawn('cmd.exe', [cmdLine], {
          cwd: dir, detached: true, windowsVerbatimArguments: true, stdio: 'ignore', windowsHide: false,
        });
        child.unref();
      } else {
        const child = require('child_process').spawn(bin, args.map((a) => a.replace(/^"|"$/g, '')), { cwd: dir, detached: true, stdio: 'ignore' });
        child.unref();
      }
      return { ok: true, name: safeName };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Open a session's workspace folder in Explorer (folders that exist only)
  ipcMain.handle('open-folder', async (_e, dir) => {
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) return false;
    try { if (!fs.statSync(dir).isDirectory()) return false; } catch (_) { return false; }
    return !(await shell.openPath(dir));
  });

  // New chat ▾ → "Choose folder…": native folder picker. Returns '' on cancel.
  ipcMain.handle('pick-folder', async (_e, startDir) => {
    const win = ctx.getWin && ctx.getWin();
    const opts = { title: 'Choose a folder for the new chat', properties: ['openDirectory', 'createDirectory'] };
    if (typeof startDir === 'string' && path.isAbsolute(startDir) && fs.existsSync(startDir)) opts.defaultPath = startDir;
    try {
      const r = win && !win.isDestroyed() ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      return r.canceled || !r.filePaths?.length ? '' : r.filePaths[0];
    } catch (_) { return ''; }
  });
  // Does this folder still exist? (recent-folder list)
  ipcMain.handle('folder-exists', (_e, dir) => {
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) return false;
    try { return fs.statSync(dir).isDirectory(); } catch (_) { return false; }
  });

  // Git info for a session's folder (read-only git commands, cached a few seconds)
  ipcMain.handle('git-info', (_e, cwd) => gitInfo(cwd));

  // Global hotkey: bring the HUD up and put the cursor in the input box
  const HOTKEY = 'CommandOrControl+Alt+Space';
  try {
    globalShortcut.register(HOTKEY, () => {
      ctx.showHud();
      const win = ctx.getWin();
      if (win && !win.isDestroyed()) win.webContents.send('focus-input');
    });
  } catch (e) { console.error('[hotkey]', e.message); }
  app.on('will-quit', () => globalShortcut.unregisterAll());

  if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'com.ovly.claude-hud' : process.execPath);
}

module.exports = {
  register, onSync, readClaudeHistory, readAntigravityHistory, readSessionHistory, pathForSession,
  getSetting, setSetting, trackChild, aliasChild, wasStopped, editFromToolUse, mergeEdit,
};
