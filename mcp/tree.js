#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Chat Tree tools for Claude chats run by the HUD (main.js adds this server with --mcp-config).
// Each call is forwarded to the HUD's local, token-protected endpoint (main/chat-tree.js), which
// starts / messages child chats and routes their results back to the parent.
//
//   child_start  child_send  child_status  child_stop      (any chat: command child chats)
//   report_to_parent  ask_parent                           (child chats: talk to the parent)
//
// No dependencies: newline-delimited JSON-RPC 2.0 on stdin/stdout. Run with ELECTRON_RUN_AS_NODE=1.
// ---------------------------------------------------------------------------
const http = require('http');
const readline = require('readline');

const URL_ = process.env.HUD_TREE_URL || '';
const TOKEN = process.env.HUD_PERM_TOKEN || '';
const SESSION = process.env.HUD_SESSION_ID || '';

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');

const TOOLS = [
  {
    name: 'child_start',
    description: 'Start a child chat (a separate Claude chat the user can see in the HUD Chat Tree) to work on one part of a bigger job in parallel. ' +
      'It only sees the task you give it (unless context is "full"), so make the task self-contained: goal, files, what to report. ' +
      'Its result comes back to you automatically as a new message when it finishes — you do not need to wait or poll; end your turn if you have nothing else to do. ' +
      'Use for independent parts (investigate X, write tests for Y, update docs). Do not use for small things you can do yourself.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short name shown on the node, e.g. "Write tests for the guard"' },
        task: { type: 'string', description: 'The full, self-contained task for the child' },
        model: { type: 'string', enum: ['haiku', 'sonnet', 'opus'], description: 'Optional. haiku for simple lookups, sonnet for most work.' },
        context: { type: 'string', enum: ['brief', 'full'], description: 'brief (default, cheap): only the task. full: the child starts with a copy of this whole chat (costs more).' },
        readOnly: { type: 'boolean', description: 'true = the child may look but not edit files (good for investigation).' },
        isolate: { type: 'boolean', description: 'Default true: a child that edits files works in its own git worktree, and you merge its branch with child_merge. false = it edits your folder directly.' },
      },
      required: ['title', 'task'],
    },
  },
  {
    name: 'child_send',
    description: 'Send a message to one of your child chats: a follow-up task, or the answer to a question it asked you. Its reply comes back automatically.',
    inputSchema: {
      type: 'object',
      properties: { child: { type: 'string', description: 'The child id, e.g. "c3"' }, task: { type: 'string' } },
      required: ['child', 'task'],
    },
  },
  {
    name: 'child_status',
    description: 'List your child chats with what each is doing, and the tree budget.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'child_stop',
    description: 'Stop one of your child chats (and its own children).',
    inputSchema: { type: 'object', properties: { child: { type: 'string' } }, required: ['child'] },
  },
  {
    name: 'child_merge',
    description: 'Merge a finished child\'s work into your folder. Children that edit files work in their own git worktree on their own branch; ' +
      'their result tells you the branch and files. Check the result first. On a conflict nothing is changed and you get the conflicting files.',
    inputSchema: { type: 'object', properties: { child: { type: 'string', description: 'The child id, e.g. "c3"' } }, required: ['child'] },
  },
  {
    name: 'report_to_parent',
    description: 'Only for child chats: hand your result to the parent chat that gave you the task. Call it once when the task is done, then end your turn.',
    inputSchema: {
      type: 'object',
      properties: {
        result: { type: 'string', description: 'Short and concrete: the answer / what you did' },
        files: { type: 'array', items: { type: 'string' }, description: 'Files you changed' },
        openQuestions: { type: 'string' },
      },
      required: ['result'],
    },
  },
  {
    name: 'ask_parent',
    description: 'Only for child chats: ask the parent chat one question you need answered to go on. Then end your turn; the answer arrives as a new message.',
    inputSchema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
  },
];

function callHud(tool, args) {
  return new Promise((resolve) => {
    if (!URL_) return resolve({ ok: false, text: 'The HUD Chat Tree is not available.' });
    const body = JSON.stringify({ sessionId: SESSION, tool, args });
    const req = http.request(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-HUD-Token': TOKEN },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (_) { resolve({ ok: false, text: 'Bad answer from the HUD.' }); } });
    });
    req.on('error', (e) => resolve({ ok: false, text: 'Could not reach the HUD: ' + e.message }));
    req.write(body);
    req.end();
  });
}

async function handle(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'ovly-tree', version: '1.0.0' } } });
    case 'ping':
      return send({ jsonrpc: '2.0', id, result: {} });
    case 'tools/list':
      return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    case 'tools/call': {
      const name = params?.name;
      if (!TOOLS.some((t) => t.name === name)) return send({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool ' + name } });
      const out = await callHud(name, params?.arguments || {});
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String(out.text || '') }], ...(out.ok ? {} : { isError: true }) } });
    }
    default:
      if (id !== undefined && id !== null) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch (_) { return; }
  handle(msg).catch((err) => { if (msg && msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: err.message } }); });
});
rl.on('close', () => process.exit(0));
