// Steps: what Claude actually did in a chat, read from its transcript. One step = one tool call
// (read a file, edit, run a command, search, …), with the time, whether it worked, how long it took and
// the start of its output. Used by the chat's Steps panel and by the steps search.
//
//   parseClaudeSteps(lines) / parseAgSteps(lines)  → { steps, turns }
//   stepText(step)                                → one lowercase string to search in
//
// A step: { n, ts, turn, tool, kind, verb, target, detail, file, ok, ms, result }
//   kind:  edit | run | read | search | web | agent | other
//   ok:    true / false / null (no result yet, or the log does not say)
// A turn: { i, ts, prompt }  (what you asked; the steps after it belong to it)

const MAX_STEPS = 600;      // newest kept
const DETAIL_MAX = 2000;
const RESULT_MAX = 600;

const clip = (v, n) => { const s = String(v == null ? '' : v); return s.length > n ? s.slice(0, n) + '…' : s; };
const one = (v, n = 90) => { const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const base = (p) => String(p || '').split(/[\\/]/).pop();

const KIND = [
  [/^(Edit|MultiEdit|Write|NotebookEdit|edit_file|write_file|replace_file_content|multi_replace_file_content)$/, 'edit'],
  [/^(Bash|PowerShell|run_command|command_status)$/, 'run'],
  [/^(Read|view_file|read_file|view_file_outline|view_code_item|list_dir|LS)$/, 'read'],
  [/^(Grep|Glob|grep_search|find_by_name)$/, 'search'],
  [/^(WebSearch|WebFetch|search_web|read_url_content)$/, 'web'],
  [/^(Task|Agent|invoke_subagent|swarm)$/, 'agent'],
];
const kindOf = (tool) => { for (const [re, k] of KIND) if (re.test(tool)) return k; return /^browser_/i.test(tool) ? 'web' : 'other'; };

// Tool call → what a person reads: { verb, target, detail, file }
function describe(tool, i) {
  i = i && typeof i === 'object' ? i : {};
  const file = i.file_path || i.notebook_path || i.path || i.Path || i.TargetFile || i.AbsolutePath || i.File || '';
  const m = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (m) return { verb: `Used ${m[1]} › ${m[2]}`, target: one(i.query || i.url || i.path || i.name || ''), detail: clip(JSON.stringify(i), DETAIL_MAX), file: '' };
  switch (tool) {
    case 'Bash': case 'PowerShell': case 'run_command': {
      const cmd = i.command || i.CommandLine || '';
      return { verb: 'Ran', target: one(cmd), detail: clip((i.description ? i.description + '\n' : '') + cmd, DETAIL_MAX), file: '' };
    }
    case 'Read': case 'view_file': case 'read_file': case 'view_file_outline': case 'view_code_item':
      return { verb: 'Read', target: base(file), detail: file, file };
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': case 'edit_file': case 'replace_file_content': case 'multi_replace_file_content':
      return { verb: 'Edited', target: base(file), detail: file, file };
    case 'Write': case 'write_file':
      return { verb: 'Wrote', target: base(file), detail: file, file };
    case 'Grep': case 'grep_search':
      return { verb: 'Searched for', target: one(i.pattern || i.Query), detail: clip(`${i.pattern || i.Query || ''}${i.path || i.SearchPath ? '\nin ' + (i.path || i.SearchPath) : ''}`, DETAIL_MAX), file: '' };
    case 'Glob': case 'find_by_name':
      return { verb: 'Looked for files', target: one(i.pattern || i.Pattern), detail: clip(i.pattern || i.Pattern || '', DETAIL_MAX), file: '' };
    case 'list_dir': case 'LS':
      return { verb: 'Listed', target: base(i.path || i.DirectoryPath), detail: i.path || i.DirectoryPath || '', file: '' };
    case 'WebSearch': case 'search_web':
      return { verb: 'Searched the web for', target: one(i.query), detail: clip(i.query, DETAIL_MAX), file: '' };
    case 'WebFetch': case 'read_url_content': {
      const u = i.url || i.Url || '';
      let host = u; try { host = new URL(u).host; } catch (_) {}
      return { verb: 'Read a web page', target: host, detail: clip(u, DETAIL_MAX), file: '' };
    }
    case 'Task': case 'Agent': case 'invoke_subagent': case 'swarm':
      return { verb: 'Sub-agent', target: one(i.description || i.Role || i.prompt || i.brief, 80), detail: clip(i.prompt || i.Prompt || i.description || '', DETAIL_MAX), file: '' };
    case 'TodoWrite': case 'task_boundary':
      return { verb: 'Updated its task list', target: '', detail: '', file: '' };
    case 'Skill': return { verb: 'Used a skill', target: i.skill || '', detail: '', file: '' };
    default:
      return { verb: `Used ${tool}`, target: one(i.query || i.url || i.path || i.name || ''), detail: clip(JSON.stringify(i), DETAIL_MAX), file: '' };
  }
}

function resultText(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter((b) => b && b.type === 'text' && b.text).map((b) => b.text).join('\n');
  return '';
}
const isPromptText = (t) => t && !/^<(local-command-|command-name|command-message|command-args|system-reminder|bash-|user-memory)/.test(t.trim());

function parseClaudeSteps(lines) {
  const steps = [];
  const turns = [];
  const byId = new Map();
  for (const line of lines) {
    if (!line || !line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch (_) { continue; }
    if (e.isSidechain || (e.type !== 'user' && e.type !== 'assistant')) continue;
    const ts = Date.parse(e.timestamp) || 0;
    const content = e.message && e.message.content;
    if (e.type === 'user') {
      if (Array.isArray(content) && content.some((b) => b && b.type === 'tool_result')) {
        for (const b of content) {
          if (!b || b.type !== 'tool_result') continue;
          const s = byId.get(b.tool_use_id);
          if (!s) continue;
          s.ok = b.is_error ? false : true;
          if (ts && s.ts) s.ms = Math.max(0, ts - s.ts);
          s.result = clip(resultText(b.content).replace(/\u001b\[[0-9;]*m/g, ''), RESULT_MAX);
        }
        continue;
      }
      if (e.isMeta || e.isCompactSummary) continue;
      const text = (typeof content === 'string' ? content : Array.isArray(content) ? content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n') : '')
        .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
      if (!isPromptText(text)) continue;
      turns.push({ i: turns.length, ts, prompt: one(text, 160) });
    } else if (Array.isArray(content)) {
      for (const b of content) {
        if (!b || b.type !== 'tool_use' || !b.name) continue;
        const d = describe(b.name, b.input);
        const s = { n: steps.length + 1, ts, turn: turns.length - 1, tool: b.name, kind: kindOf(b.name), ...d, ok: null, ms: null, result: '' };
        steps.push(s);
        if (b.id) byId.set(b.id, s);
      }
    }
  }
  return { steps, turns };
}

// Antigravity: PLANNER_RESPONSE lines carry tool_calls ({ name, args }); results are not logged per call
function parseAgSteps(lines) {
  const steps = [];
  const turns = [];
  const unwrap = (v) => { if (typeof v !== 'string') return v; const t = v.trim(); if (t.length > 1 && t[0] === '"' && t[t.length - 1] === '"') { try { return JSON.parse(t); } catch (_) {} } return v; };
  for (const line of lines) {
    if (!line || !line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch (_) { continue; }
    const ts = Date.parse(e.created_at) || 0;
    if (e.type === 'USER_INPUT') {
      const raw = typeof e.content === 'string' ? e.content : '';
      const m = raw.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
      turns.push({ i: turns.length, ts, prompt: one(m ? m[1] : raw, 160) });
    } else if (e.type === 'PLANNER_RESPONSE' && Array.isArray(e.tool_calls)) {
      for (const tc of e.tool_calls) {
        if (!tc || !tc.name) continue;
        const args = {};
        for (const [k, v] of Object.entries(tc.args || {})) args[k] = unwrap(v);
        const d = describe(tc.name, args);
        steps.push({ n: steps.length + 1, ts, turn: turns.length - 1, tool: tc.name, kind: kindOf(tc.name), ...d, ok: null, ms: null, result: '' });
      }
    }
  }
  return { steps, turns };
}

// newest MAX_STEPS steps (renumbered from 1 would break "step 12 of this chat", so keep the original numbers)
function finish({ steps, turns }) {
  const total = steps.length;
  return { steps: steps.slice(-MAX_STEPS), turns, total };
}

// everything a step can be found by
function stepText(s) {
  return `${s.tool} ${s.verb} ${s.target} ${s.detail} ${s.file}`.toLowerCase();
}

module.exports = { parseClaudeSteps, parseAgSteps, finish, stepText, describe, kindOf, MAX_STEPS };
