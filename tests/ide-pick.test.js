// Run: node --test "tests/*.test.js"
// The HUD's local endpoint for IDE pick lists: token required, no window → 503, answer goes back on the
// same request, and too many open questions are refused.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovly-idepick-'));
process.env.HUD_BRIDGE_FILE = path.join(dir, 'bridge.json'); // before the module is loaded
const idePick = require('../main/ipc/ide-pick.js');

const sent = [];
let hasWin = true;
const ctx = {
  getWin: () => (hasWin ? { isDestroyed: () => false, isMinimized: () => false, show() {}, focus() {}, webContents: { send: (c, p) => sent.push([c, p]) } } : null),
  window: { isDocked: () => false, undock() {} },
};
let server, bridge;
const post = (body, token) => new Promise((resolve) => {
  const data = JSON.stringify(body);
  const req = http.request({ host: '127.0.0.1', port: bridge.port, path: '/ide-pick', method: 'POST', headers: { 'x-hud-token': token, 'Content-Length': Buffer.byteLength(data) } }, (res) => {
    let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b }));
  });
  req.on('error', () => resolve({ status: 0 }));
  req.end(data);
});
const waitFor = async (fn) => { for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 20)); };

test.before(async () => {
  server = idePick.start(ctx);
  await waitFor(() => fs.existsSync(process.env.HUD_BRIDGE_FILE));
  bridge = JSON.parse(fs.readFileSync(process.env.HUD_BRIDGE_FILE, 'utf8'));
});
test.after(() => { idePick.cleanup(); server.close(); });

test('a wrong or missing token is refused', async () => {
  assert.equal((await post({ kind: 'pick' }, 'nope')).status, 403);
});
test('no window: 503, so the IDE shows its own pop-up', async () => {
  hasWin = false;
  assert.equal((await post({ kind: 'pick', items: [] }, bridge.token)).status, 503);
  hasWin = true;
});
test('the answer goes back on the same request', async () => {
  sent.length = 0;
  const p = post({ kind: 'pick', items: [{ label: 'a' }, { label: 'b' }] }, bridge.token);
  await waitFor(() => sent.length === 1);
  const reg = {}; idePick.register({ on: (n, f) => { reg[n] = f; } });
  reg['ide-pick:answer'](null, null, { id: sent[0][1].id, result: { index: 1 } });
  const r = await p;
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { index: 1 });
});
test('too many open questions are refused (429)', async () => {
  sent.length = 0;
  const open = [];
  for (let i = 0; i < 20; i++) open.push(post({ kind: 'input' }, bridge.token));
  await waitFor(() => sent.length === 20);
  assert.equal((await post({ kind: 'input' }, bridge.token)).status, 429);
  idePick.cleanup(); // cancels the open ones
  const res = await Promise.all(open);
  assert.ok(res.every((r) => r.status === 200));
});
