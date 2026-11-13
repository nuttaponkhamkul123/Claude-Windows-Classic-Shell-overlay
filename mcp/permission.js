#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Tiny stdio MCP server used as Claude Code's --permission-prompt-tool.
//
// When a reply is sent from the HUD, main.js runs:
//   claude -p ... --mcp-config <file> --permission-prompt-tool mcp__ovly_hud__approve
// Whenever Claude needs permission for a tool (Bash, MCP tools, ...), the CLI
// calls our `approve` tool. We forward the request to the HUD over a local,
// token-protected HTTP endpoint, wait for the user to click Allow / Deny, and
// return the decision in the format Claude Code expects:
//   {"behavior":"allow","updatedInput":{...}}  or  {"behavior":"deny","message":"..."}
//
// No dependencies: speaks newline-delimited JSON-RPC 2.0 on stdin/stdout.
// Run by Electron's binary with ELECTRON_RUN_AS_NODE=1.
// ---------------------------------------------------------------------------
const http = require('http');
const readline = require('readline');

const HUD_URL = process.env.HUD_PERM_URL || '';
const HUD_TOKEN = process.env.HUD_PERM_TOKEN || '';
const HUD_SESSION_ID = process.env.HUD_SESSION_ID || '';

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function askHud(payload) {
  return new Promise((resolve) => {
    if (!HUD_URL) return resolve({ behavior: 'deny', message: 'HUD is not available to approve this tool.' });
    const body = JSON.stringify(payload);
    const req = http.request(HUD_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-HUD-Token': HUD_TOKEN,
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve({ behavior: 'deny', message: 'Invalid response from HUD.' }); }
      });
    });
    req.on('error', (err) => resolve({ behavior: 'deny', message: `Could not reach HUD: ${err.message}` }));
    req.write(body);
    req.end();
  });
}

const TOOL = {
  name: 'approve',
  description: 'Asks the user in the Ovly HUD whether Claude may use a tool.',
  inputSchema: {
    type: 'object',
    properties: {
      tool_name: { type: 'string' },
      input: { type: 'object' },
      tool_use_id: { type: 'string' },
    },
    required: ['tool_name', 'input'],
  },
};

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;

  switch (method) {
    case 'initialize':
      return send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'ovly-hud', version: '1.0.0' },
        },
      });
    case 'ping':
      return send({ jsonrpc: '2.0', id, result: {} });
    case 'tools/list':
      return send({ jsonrpc: '2.0', id, result: { tools: [TOOL] } });
    case 'tools/call': {
      const args = params?.arguments || {};
      const toolInput = args.input && typeof args.input === 'object' ? args.input : {};
      const decision = await askHud({
        sessionId: HUD_SESSION_ID,
        toolName: args.tool_name || 'unknown',
        input: toolInput,
        toolUseId: args.tool_use_id || '',
      });
      const result = decision && decision.behavior === 'allow'
        ? { behavior: 'allow', updatedInput: toolInput }
        : { behavior: 'deny', message: (decision && decision.message) || 'Denied by user in the HUD.' };
      return send({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(result) }] },
      });
    }
    default:
      // Notifications (no id) are ignored; unknown requests get an error.
      if (isRequest) {
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
      }
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch (e) { return; }
  handle(msg).catch((err) => {
    if (msg && msg.id !== undefined) {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: err.message } });
    }
  });
});
rl.on('close', () => process.exit(0));
