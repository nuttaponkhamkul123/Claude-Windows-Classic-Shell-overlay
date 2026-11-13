#!/usr/bin/env node
// ---------------------------------------------------------------------------
// "Pinner": a tiny stdio MCP server that lets any Claude Code chat pin a
// Markdown note to the Ovly HUD's Notes panel.
//
//   claude mcp add --scope user ovly-pinner -- node <this file>
//
// Tools
//   pin_note           { title, content, tags? }  -> saves a .md note
//   list_pinned_notes  {}                         -> what is pinned
//   unpin_note         { id }                     -> moves a note to .unpinned/
//
// Notes are plain files in ~/.ovly-claude/notes/ (front matter + Markdown), so
// pinning works even when the HUD is closed; the HUD watches that folder.
// No dependencies: newline-delimited JSON-RPC 2.0 on stdin/stdout.
// ---------------------------------------------------------------------------
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const NOTES_DIR = path.join(os.homedir(), '.ovly-claude', 'notes');
const TRASH_DIR = path.join(NOTES_DIR, '.unpinned');
const MAX_CONTENT = 200 * 1024;
const MAX_TITLE = 120;
const ID_RE = /^[0-9]{8}-[0-9]{6}-[a-z0-9-]{1,60}$/;

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const text = (t, isError) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

function slugify(s) {
  const slug = String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  return slug || 'note';
}
const pad = (n) => String(n).padStart(2, '0');
function stamp(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
// YAML-safe single-line value
const yamlStr = (s) => JSON.stringify(String(s).replace(/[\r\n]+/g, ' '));

function readFront(file) {
  try {
    const head = fs.readFileSync(file, 'utf8').slice(0, 2000);
    const m = head.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const out = {};
    if (m) {
      for (const line of m[1].split(/\r?\n/)) {
        const kv = line.match(/^(\w+):\s*(.*)$/);
        if (!kv) continue;
        try { out[kv[1]] = JSON.parse(kv[2]); } catch (_) { out[kv[1]] = kv[2]; }
      }
    }
    return out;
  } catch (_) { return {}; }
}

function pinNote(args) {
  const title = String(args.title || '').trim().slice(0, MAX_TITLE);
  const content = String(args.content || '');
  if (!title) return text('A title is required.', true);
  if (!content.trim()) return text('The note content is empty.', true);
  if (Buffer.byteLength(content) > MAX_CONTENT) return text(`The note is too big (max ${MAX_CONTENT / 1024} KB).`, true);
  const tags = Array.isArray(args.tags) ? args.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 10) : [];
  const now = new Date();
  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const id = `${stamp(now)}-${slugify(title)}`;
  const front = [
    '---',
    `title: ${yamlStr(title)}`,
    `project: ${yamlStr(path.basename(cwd))}`,
    `cwd: ${yamlStr(cwd)}`,
    `pinned: ${yamlStr(now.toISOString())}`,
    tags.length ? `tags: ${JSON.stringify(tags)}` : null,
    '---',
    '',
  ].filter((l) => l !== null).join('\n');
  fs.mkdirSync(NOTES_DIR, { recursive: true });
  const file = path.join(NOTES_DIR, `${id}.md`);
  fs.writeFileSync(file, front + content.replace(/\r\n/g, '\n') + (content.endsWith('\n') ? '' : '\n'), 'utf8');
  return text(`Pinned "${title}" to the HUD Notes panel.\nid: ${id}\nfile: ${file}`);
}

function listNotes() {
  let files = [];
  try { files = fs.readdirSync(NOTES_DIR).filter((f) => f.endsWith('.md')); } catch (_) {}
  if (!files.length) return text('No pinned notes.');
  files.sort().reverse();
  const lines = files.slice(0, 100).map((f) => {
    const fm = readFront(path.join(NOTES_DIR, f));
    return `- ${f.replace(/\.md$/, '')} | ${fm.title || '(untitled)'} | ${fm.project || ''} | ${fm.pinned || ''}`;
  });
  return text(`${files.length} pinned note(s), newest first (id | title | project | pinned):\n${lines.join('\n')}`);
}

function unpinNote(args) {
  const id = String(args.id || '').replace(/\.md$/, '');
  if (!ID_RE.test(id)) return text('Unknown note id. Use list_pinned_notes to see the ids.', true);
  const file = path.join(NOTES_DIR, `${id}.md`);
  if (!fs.existsSync(file)) return text(`No pinned note with id ${id}.`, true);
  fs.mkdirSync(TRASH_DIR, { recursive: true });
  fs.renameSync(file, path.join(TRASH_DIR, `${id}.md`));
  return text(`Unpinned ${id} (moved to ${TRASH_DIR}).`);
}

const TOOLS = [
  {
    name: 'pin_note',
    description:
      "Pin a Markdown note to the user's Ovly HUD Notes panel (a side panel next to their chat). " +
      'Use it when the user asks to pin, save or keep something as a note (a summary, checklist, command, decision, snippet). ' +
      'Write the note as clean, self-contained Markdown; do not repeat the title as a heading.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short title shown on the note card (max 120 characters).' },
        content: { type: 'string', description: 'The note body in Markdown.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags.' },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'list_pinned_notes',
    description: "List the notes pinned in the user's Ovly HUD (id, title, project, time), newest first.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'unpin_note',
    description: 'Unpin a note from the Ovly HUD Notes panel by its id (from list_pinned_notes). The file is kept in a .unpinned folder.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
];

function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  switch (method) {
    case 'initialize':
      return send({
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: params?.protocolVersion || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'ovly-pinner', version: '1.0.0' },
        },
      });
    case 'ping':
      return send({ jsonrpc: '2.0', id, result: {} });
    case 'tools/list':
      return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    case 'tools/call': {
      const name = params?.name;
      const args = params?.arguments || {};
      let result;
      try {
        if (name === 'pin_note') result = pinNote(args);
        else if (name === 'list_pinned_notes') result = listNotes();
        else if (name === 'unpin_note') result = unpinNote(args);
        else result = text(`Unknown tool: ${name}`, true);
      } catch (e) {
        result = text(`Could not do that: ${e.message}`, true);
      }
      return send({ jsonrpc: '2.0', id, result });
    }
    default:
      if (isRequest) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch (_) { return; }
  try { handle(msg); } catch (e) {
    if (msg && msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: e.message } });
  }
});
rl.on('close', () => process.exit(0));
