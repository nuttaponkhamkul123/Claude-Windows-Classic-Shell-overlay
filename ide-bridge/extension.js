// AI HUD bridge — shows other extensions' pick lists and text boxes in the AI HUD.
//
// Every extension in the IDE runs in one process and gets the editor API by
// require('vscode'). When this module loads it wraps Node's module loader, so each
// extension that loads the API afterwards gets window.showQuickPick and
// window.showInputBox wrapped: if the HUD is running, the question goes to the HUD
// (main/ipc/ide-pick.js in the AI HUD repo) and its answer comes back as if you had
// picked it in the IDE. If the HUD isn't running (or says no), the normal pop-up shows.
//
// Nothing in the other extensions is changed. Extensions that loaded before this one
// can't be wrapped — it activates on startup ("*") to come first; "Reload Window"
// fixes the order if needed. Custom pickers (createQuickPick) aren't bridged.

const Module = require('module');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const BRIDGE_FILE = process.env.HUD_BRIDGE_FILE || path.join(os.homedir(), '.ovly-claude', 'ide-bridge.json');
const PATCHED = Symbol.for('hudBridge.patched');
const SELF_DIR = __dirname.toLowerCase();
const SEPARATOR = -1; // QuickPickItemKind.Separator
const ERROR_SEVERITY = 3; // InputBoxValidationSeverity.Error

const bridged = new Map(); // extension id -> name (for the log command)
const log = [];
const note = (msg) => { log.push(`${new Date().toLocaleTimeString()}  ${msg}`); if (log.length > 300) log.shift(); };

// ---- which extension is this? (walk up to its package.json) ---------------
const infoCache = new Map();
function extensionInfo(filename) {
  let dir = path.dirname(filename);
  for (let i = 0; i < 12; i++) {
    if (infoCache.has(dir)) return infoCache.get(dir);
    const pj = path.join(dir, 'package.json');
    try {
      const p = JSON.parse(fs.readFileSync(pj, 'utf8'));
      if (p.engines && p.engines.vscode) {
        const info = { id: `${p.publisher || 'unknown'}.${p.name}`, name: localName(p, dir) };
        infoCache.set(dir, info);
        return info;
      }
    } catch (_) {}
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return { id: 'unknown', name: 'An extension' };
}
// displayName may be a %placeholder% resolved from package.nls.json
function localName(p, dir) {
  const d = p.displayName || p.name;
  const m = /^%(.+)%$/.exec(d || '');
  if (!m) return d;
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.nls.json'), 'utf8'))[m[1]] || p.name; } catch (_) { return p.name; }
}

// ---- talk to the HUD -----------------------------------------------------------
function hudEndpoint() {
  try {
    const b = JSON.parse(fs.readFileSync(BRIDGE_FILE, 'utf8'));
    if (!b.port || !b.token) return null;
    if (b.pid) { try { process.kill(b.pid, 0); } catch (e) { if (e.code === 'ESRCH') return null; } } // HUD gone
    return b;
  } catch (_) {
    return null;
  }
}

// → the HUD's answer, or null when the HUD can't take it (then the IDE pop-up is used)
function askHud(payload, cancelToken) {
  const hud = hudEndpoint();
  if (!hud) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    const body = JSON.stringify(payload);
    const req = http.request({
      host: '127.0.0.1', port: hud.port, path: '/ide-pick', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'x-hud-token': hud.token },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) return finish(null);
        try { finish(JSON.parse(data)); } catch (_) { finish(null); }
      });
    });
    req.on('error', () => finish(settled ? undefined : null));
    if (cancelToken && typeof cancelToken.onCancellationRequested === 'function') {
      cancelToken.onCancellationRequested(() => { finish({ cancelled: true }); req.destroy(); });
    }
    req.end(body);
  });
}

// ---- the wrapped API -----------------------------------------------------------
function patchApi(api, info) {
  const w = api && api.window;
  if (!w || w[PATCHED] || typeof w.showQuickPick !== 'function') return;
  const origPick = w.showQuickPick;
  const origInput = w.showInputBox;
  const enabled = () => {
    try { return api.workspace.getConfiguration('hudBridge').get('enabled', true) !== false; } catch (_) { return true; }
  };

  const showQuickPick = async function (items, options, token) {
    if (!enabled()) return origPick.call(this, items, options, token);
    const list = await Promise.resolve(items);
    if (!Array.isArray(list) || (token && token.isCancellationRequested)) return origPick.call(this, list, options, token);
    const sent = list.map((it) => (typeof it === 'string' ? { label: it } : {
      label: it.label, description: it.description, detail: it.detail, picked: it.picked, separator: it.kind === SEPARATOR,
    }));
    const r = await askHud({
      kind: 'pick', source: info, title: options && options.title, placeHolder: options && options.placeHolder,
      items: sent, canPickMany: !!(options && options.canPickMany),
    }, token);
    if (r === null) return origPick.call(this, list, options, token);
    note(`${info.name}: pick list answered in the HUD${r.cancelled ? ' (cancelled)' : ''}`);
    if (!r || r.cancelled) return undefined;
    if (options && options.canPickMany) return (r.indices || []).map((i) => list[i]).filter((x) => x !== undefined);
    return list[r.index];
  };

  const showInputBox = async function (options, token) {
    if (typeof origInput !== 'function') return undefined;
    if (!enabled()) return origInput.call(this, options, token);
    let value = (options && options.value) || '';
    let message = '';
    for (;;) {
      const r = await askHud({
        kind: 'input', source: info, title: options && options.title, prompt: options && options.prompt,
        placeHolder: options && options.placeHolder, value, password: !!(options && options.password), validationMessage: message,
      }, token);
      if (r === null) return origInput.call(this, { ...(options || {}), value }, token);
      if (!r || r.cancelled) { note(`${info.name}: text box cancelled in the HUD`); return undefined; }
      // the extension may check what was typed; an error sends it back to you with the message
      if (options && typeof options.validateInput === 'function') {
        const v = await Promise.resolve(options.validateInput(r.value));
        const msg = !v ? '' : typeof v === 'string' ? v : (v.severity === undefined || v.severity >= ERROR_SEVERITY ? v.message : '');
        if (msg) { value = r.value; message = msg; continue; }
      }
      note(`${info.name}: text box answered in the HUD`);
      return r.value;
    }
  };

  try {
    w.showQuickPick = showQuickPick;
    if (typeof origInput === 'function') w.showInputBox = showInputBox;
    Object.defineProperty(w, PATCHED, { value: true });
    bridged.set(info.id, info.name);
    note(`bridged ${info.name} (${info.id})`);
  } catch (e) {
    note(`could not bridge ${info.name}: ${e.message}`);
  }
}

// ---- hook every extension's require('vscode') from now on -------------------
const origLoad = Module._load;
Module._load = function (request, parent) {
  const result = origLoad.apply(this, arguments);
  if (request === 'vscode' && parent && parent.filename && !parent.filename.toLowerCase().startsWith(SELF_DIR)) {
    try { patchApi(result, extensionInfo(parent.filename)); } catch (e) { note(`hook error: ${e.message}`); }
  }
  return result;
};
note('AI HUD bridge loaded');

function activate(context) {
  const vscode = require('vscode');
  context.subscriptions.push(vscode.commands.registerCommand('hudBridge.showLog', async () => {
    const hud = hudEndpoint();
    const lines = [
      `AI HUD: ${hud ? `running (port ${hud.port})` : 'not running — pop-ups show in the IDE'}`,
      `Bridged extensions (${bridged.size}): ${[...bridged.values()].join(', ') || 'none yet'}`,
      'Extensions that started before the bridge are not bridged; "Developer: Reload Window" fixes that.',
      '', ...log,
    ];
    const doc = await vscode.workspace.openTextDocument({ content: lines.join('\n'), language: 'log' });
    vscode.window.showTextDocument(doc, { preview: true });
  }));
}

function deactivate() {}

module.exports = { activate, deactivate, _test: { patchApi, extensionInfo, bridged, log } };
