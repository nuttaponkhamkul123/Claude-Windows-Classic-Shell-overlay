// IDE pickers in the HUD: the "HUD bridge" extension (ide-bridge/) running inside
// VS Code / Antigravity IDE sends every extension's showQuickPick / showInputBox
// here, and the HUD shows it as a Ctrl+P-style picker. The answer goes back on
// the same HTTP request.
//
// Discovery: on start we write ~/.ovly-claude/ide-bridge.json { port, token, pid }.
// Only programs that can read your home folder can use it (same as the approval
// rules file); every request must carry the token. The file is removed on quit,
// so with the HUD closed the bridge falls back to the IDE's own pop-up.
//
// POST /ide-pick  (header x-hud-token)
//   { kind: 'pick' | 'input', source: { id, name }, title, placeHolder, prompt,
//     items: [{ label, description, detail, picked, separator }], canPickMany,
//     value, password, validationMessage }
// → { cancelled: true } | { index } | { indices: [..] } | { value }

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const BRIDGE_FILE = process.env.HUD_BRIDGE_FILE || path.join(os.homedir(), '.ovly-claude', 'ide-bridge.json'); // (env: tests only)
const TOKEN = crypto.randomBytes(24).toString('hex');
const MAX_ITEMS = 5000;
const MAX_PENDING = 20; // open questions at once; more are refused so a flood cannot pile up

const pending = new Map(); // id -> { res, done }

function sendToWin(ctx, channel, payload) {
  const win = ctx.getWin();
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// Clean, size-limited copy of what the extension sent (it's shown in the UI)
function sanitise(p) {
  const str = (v, n = 500) => (v == null ? '' : String(v).slice(0, n));
  const items = Array.isArray(p.items) ? p.items.slice(0, MAX_ITEMS).map((it) => ({
    label: str(it && it.label, 300),
    description: str(it && it.description, 300),
    detail: str(it && it.detail, 500),
    picked: !!(it && it.picked),
    separator: !!(it && it.separator),
  })) : [];
  return {
    kind: p.kind === 'input' ? 'input' : 'pick',
    source: { id: str(p.source && p.source.id, 200), name: str(p.source && p.source.name, 200) },
    title: str(p.title), placeHolder: str(p.placeHolder), prompt: str(p.prompt, 1000),
    items, canPickMany: !!p.canPickMany,
    value: str(p.value, 5000), password: !!p.password, validationMessage: str(p.validationMessage, 1000),
  };
}

function answer(id, result) {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  try {
    p.res.writeHead(200, { 'Content-Type': 'application/json' });
    p.res.end(JSON.stringify(result || { cancelled: true }));
  } catch (err) {}
}

function start(ctx) {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/ide-pick' || req.headers['x-hud-token'] !== TOKEN) {
      res.writeHead(403);
      return res.end();
    }
    if (pending.size >= MAX_PENDING) { res.writeHead(429); return res.end(); }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 5e6) req.destroy(); });
    req.on('end', () => {
      let payload;
      try { payload = sanitise(JSON.parse(body)); } catch (err) { res.writeHead(400); return res.end(); }
      const win = ctx.getWin();
      if (!win || win.isDestroyed()) {
        // no window to ask in: let the IDE show its own pop-up
        res.writeHead(503);
        return res.end();
      }
      const id = crypto.randomBytes(8).toString('hex');
      pending.set(id, { res });
      // The extension gave up (its cancel token fired, or the IDE closed): close the picker
      res.on('close', () => {
        if (pending.has(id)) {
          pending.delete(id);
          sendToWin(ctx, 'ide-pick:cancel', { id });
        }
      });
      if (ctx.window.isDocked()) ctx.window.undock();
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus(); // you need to type into it
      win.webContents.send('ide-pick:show', { id, ...payload });
    });
  });
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    try {
      fs.mkdirSync(path.dirname(BRIDGE_FILE), { recursive: true });
      fs.writeFileSync(BRIDGE_FILE, JSON.stringify({ port, token: TOKEN, pid: process.pid }), { mode: 0o600 });
    } catch (err) {
      console.error('[ide-pick] could not write bridge file:', err.message);
    }
    console.log(`[Main] IDE picker endpoint on 127.0.0.1:${port}`);
  });
  return server;
}

// On quit: remove the bridge file (only if it's still ours) and cancel open pickers
function cleanup() {
  for (const id of [...pending.keys()]) answer(id, { cancelled: true });
  try {
    const cur = JSON.parse(fs.readFileSync(BRIDGE_FILE, 'utf8'));
    if (cur.pid === process.pid) fs.unlinkSync(BRIDGE_FILE);
  } catch (err) {}
}

function register(r) {
  r.on('ide-pick:answer', (_ctx, _event, { id, result }) => answer(id, result));
}

module.exports = { start, cleanup, register, BRIDGE_FILE };
