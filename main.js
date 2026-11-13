const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, clipboard, ClipboardItem } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');
const http = require('http');
const crypto = require('crypto');
const MultiAISessionWatcher = require('./watcher');
const features = require('./features-main');

app.commandLine.appendSwitch('disable-gpu-cache');
app.setPath('userData', path.join(os.tmpdir(), 'ovly-claude-cache-' + Date.now()));

let mainWindow = null;
let tray = null;
let watcher = null;
let isAlwaysOnTop = true;

const DEFAULT_WIDTH = 480;
const COMPACT_HEIGHT = 74;
let currentWidth = DEFAULT_WIDTH;
let currentExpandedHeight = 520;

const ANTIGRAVITY_BIN = 'C:\\Users\\nuttapon\\AppData\\Local\\Programs\\Antigravity IDE\\bin\\antigravity-ide.cmd';

// Saved window {x, y, width, height}, only if it still lands on a connected screen
function savedWindow() {
  const w = features.getSetting('window', null);
  if (!w || ![w.x, w.y, w.width, w.height].every(Number.isFinite)) return null;
  const onScreen = screen.getAllDisplays().some(({ workArea: a }) => w.x + 60 > a.x && w.x < a.x + a.width - 60 && w.y >= a.y - 10 && w.y < a.y + a.height - 60);
  return onScreen ? w : null;
}
let saveWindowTimer = null;
function saveWindowSoon() {
  clearTimeout(saveWindowTimer);
  saveWindowTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed() || dockState.docked || boundsAnim) return; // never save the mini tab
    const [x, y] = mainWindow.getPosition();
    features.setSetting('window', { x, y, width: currentWidth, height: currentExpandedHeight });
  }, 400);
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth } = primaryDisplay.workAreaSize;
  const saved = savedWindow();
  if (saved) {
    currentWidth = Math.min(1400, Math.max(360, Math.round(saved.width)));
    currentExpandedHeight = Math.min(1200, Math.max(240, Math.round(saved.height)));
  }

  mainWindow = new BrowserWindow({
    width: currentWidth,
    height: currentExpandedHeight,
    minWidth: 360,
    minHeight: 240,
    maxWidth: 1400,
    maxHeight: 1200,
    x: saved ? Math.round(saved.x) : screenWidth - DEFAULT_WIDTH - 25,
    y: saved ? Math.round(saved.y) : 30,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    hasShadow: false,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const indexHtmlPath = path.join(__dirname, 'ui', 'index.html');
  mainWindow.loadFile(indexHtmlPath);
  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  // Never let a clicked link (file://, https://, etc.) navigate the HUD window away from index.html
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url) features.openFile(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const normUrl = String(url || '').replace(/\\/g, '/').toLowerCase();
    if (normUrl.endsWith('/ui/index.html')) return;
    event.preventDefault();
    if (url) features.openFile(url);
  });

  mainWindow.on('resize', () => {
    if (!mainWindow || dockState.docked || boundsAnim) return; // don't remember mini/animation sizes
    if (!isWindowExpanded) { const [w] = mainWindow.getSize(); currentWidth = w; return; } // collapsed height isn't the expanded height
    const [w, h] = mainWindow.getSize();
    currentWidth = w;
    if (h > COMPACT_HEIGHT + 30) {
      currentExpandedHeight = h;
    }
    saveWindowSoon();
  });
  mainWindow.on('move', saveWindowSoon);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('Multi-AI Overlay HUD (Claude & Antigravity)');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Reset Size & Position',
      click: () => {
        if (!mainWindow) return;
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width: screenWidth } = primaryDisplay.workAreaSize;
        if (dockState.docked) {
          dockState = { docked: false, side: null, restore: null };
          mainWindow.setResizable(true);
          mainWindow.setMinimumSize(...MIN_FULL_SIZE);
          sendDockState();
        }
        currentWidth = DEFAULT_WIDTH;
        mainWindow.setSize(DEFAULT_WIDTH, COMPACT_HEIGHT);
        mainWindow.setPosition(screenWidth - DEFAULT_WIDTH - 25, 30);
        mainWindow.show();
      },
    },
    {
      label: 'Toggle Always On Top',
      type: 'checkbox',
      checked: isAlwaysOnTop,
      click: (item) => {
        isAlwaysOnTop = item.checked;
        if (mainWindow) {
          mainWindow.setAlwaysOnTop(isAlwaysOnTop, 'screen-saver');
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.focus();
    } else {
      mainWindow.show();
    }
  });
}

// Everything the main/ipc/* modules are allowed to reach. Passing it explicitly
// keeps the handler modules free of imports from this file (no require cycle).
const appCtx = {
  getWin: () => mainWindow,
  getWatcher: () => watcher,
  window: {
    isDocked: () => dockState.docked,
    undock: () => undock(),
  },
  appState: {
    get dragTimer() { return dragTimer; },
    get boundsAnim() { return boundsAnim; },
    lastNudgeAt: 0,
    shakeTimer: null,
  },
};

app.whenReady().then(() => {
  createWindow();
  createTray();
  startPermissionServer();

  watcher = new MultiAISessionWatcher();
  const skillInstaller = require('./skill-install-main');
  skillInstaller.register({ getWin: () => mainWindow });
  app.on('will-quit', () => skillInstaller.cleanup());
  const notes = require('./main/notes');
  notes.register({ getWin: () => mainWindow });
  app.on('will-quit', () => notes.cleanup());
  require('./main/hot-reload').register({ getWin: () => mainWindow, getNotesWin: notes.getWin });

  // Channels that no longer need window/dock state.
  const { createRegistry } = require('./main/ipc');
  const ipc = createRegistry(appCtx);
  require('./main/ipc/clipboard').register(ipc);
  require('./main/ipc/snap').register(ipc);
  require('./main/ipc/permissions').register(ipc, appCtx, permState);

  features.register({
    app, ipcMain,
    getWin: () => mainWindow,
    getWatcher: () => watcher,
    findClaudeBinary,
    findAgyBinary,
    showHud: () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (dockState.docked) undock();
      mainWindow.show();
      mainWindow.focus();
    },
  });

  const agEnabled = () => features.getSetting('showAntigravity', true) !== false;
  const visibleSessions = (sessions) => (agEnabled() ? sessions : sessions.filter((s) => s.source !== 'antigravity'));

  watcher.on('sync', (sessions) => {
    const list = visibleSessions(sessions);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sessions-sync', list);
    }
    detectFinishedSessions(list);
    features.onSync(list); // done notifications + today's digest
  });

  watcher.on('alert', (session) => {
    if (!agEnabled() && session?.source === 'antigravity') return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('session-alert', session);
    }
  });

  watcher.start();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Collapsed height = title bar + the running-sessions strip under it
let isWindowExpanded = true; // always expanded
let compactExtra = 0;
const compactHeight = () => COMPACT_HEIGHT + compactExtra;

ipcMain.on('resize-window', (_event, expanded) => {
  isWindowExpanded = !!expanded;
  if (!mainWindow || dockState.docked) return; // mini tab keeps its size; renderer re-syncs on undock
  const targetHeight = expanded ? currentExpandedHeight : compactHeight();
  mainWindow.setSize(currentWidth, targetHeight);
});

// Renderer reports how tall the running-sessions strip is (0 = none running)
ipcMain.on('set-compact-extra', (_event, px) => {
  const next = Math.max(0, Math.min(400, Math.round(Number(px) || 0)));
  if (next === compactExtra) return;
  compactExtra = next;
  if (mainWindow && !mainWindow.isDestroyed() && !isWindowExpanded && !dockState.docked && !dragTimer) {
    mainWindow.setSize(currentWidth, compactHeight());
  }
});

ipcMain.on('set-window-size', (_event, { width, height }) => {
  if (!mainWindow || dockState.docked) return;
  currentWidth = Math.round(width);
  if (height > COMPACT_HEIGHT + 30) {
    currentExpandedHeight = Math.round(height);
  }
  mainWindow.setSize(Math.round(width), Math.round(height));
});

ipcMain.handle('get-window-size', () => {
  return mainWindow ? mainWindow.getSize() : [currentWidth, COMPACT_HEIGHT];
});

ipcMain.on('minimize-window', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});

ipcMain.on('close-window', () => {
  app.quit();
});

ipcMain.handle('toggle-pin', () => {
  if (!mainWindow) return isAlwaysOnTop;
  isAlwaysOnTop = !isAlwaysOnTop;
  mainWindow.setAlwaysOnTop(isAlwaysOnTop, 'screen-saver');
  return isAlwaysOnTop;
});

ipcMain.handle('get-initial-sessions', () => {
  const all = watcher ? watcher.getAllSessions() : [];
  return features.getSetting('showAntigravity', true) === false
    ? all.filter((s) => s.source !== 'antigravity')
    : all;
});

ipcMain.handle('get-session-history', (_event, sessionId) => {
  try {
    return features.readSessionHistory(sessionId);
  } catch (e) {
    console.error('[history] failed:', e.message);
    return null;
  }
});

// Settings → Restart app: start a fresh copy, then quit this one
ipcMain.on('restart-app', () => {
  app.relaunch();
  app.exit(0);
});

ipcMain.on('dismiss-session', (_event, sessionId) => {
  if (watcher) {
    watcher.dismiss(sessionId);
  }
});

function findClaudeBinary() {
  const homedir = os.homedir();
  const extDirs = [
    path.join(homedir, '.antigravity-ide', 'extensions'),
    path.join(homedir, '.vscode', 'extensions')
  ];

  for (const dir of extDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const matches = fs.readdirSync(dir)
        .filter(d => d.startsWith('anthropic.claude-code-'))
        .sort()
        .reverse();
      for (const m of matches) {
        const binPath = path.join(dir, m, 'resources', 'native-binary', 'claude.exe');
        if (fs.existsSync(binPath)) return binPath;
      }
    } catch (e) {}
  }
  return 'claude';
}

// ===========================================================================
// ===========================================================================
// Tool approvals for replies sent from the HUD (like the VS Code extension).
// `claude -p` cannot show a permission prompt, so we register mcp/permission.js
// as --permission-prompt-tool. It POSTs each request to main/ipc/permissions.js,
// which shows it in the HUD and answers with the user's choice.
// ===========================================================================
const permissions = require('./main/ipc/permissions');
const permState = permissions.createState();
const sessionAliases = permState.sessionAliases;
const PERM_TOKEN = permissions.PERM_TOKEN;
const answerPermission = (id, decision) => permissions.answerPermission(permState, id, decision);
const getPermPort = () => permState.permPort;
function startPermissionServer() {
  permissions.startPermissionServer(appCtx, permState);
}

// Extra `claude` args for a HUD reply: approval tool + per-reply overrides.
// Returns { args, tempFiles } — temp files are removed when the process exits.
function buildClaudeExtraArgs(sessionId, options = {}) {
  const args = [];
  const tempFiles = [];
  const tmp = (name, obj) => {
    const file = path.join(os.tmpdir(), `ovly-${name}-${crypto.randomBytes(6).toString('hex')}.json`);
    fs.writeFileSync(file, JSON.stringify(obj));
    tempFiles.push(file);
    return file;
  };

  if (getPermPort()) {
    const mcpConfig = {
      mcpServers: {
        ovly_hud: {
          type: 'stdio',
          command: process.execPath,
          args: [path.join(__dirname, 'mcp', 'permission.js')],
          env: {
            ELECTRON_RUN_AS_NODE: '1',
            HUD_PERM_URL: `http://127.0.0.1:${getPermPort()}/permission`,
            HUD_PERM_TOKEN: PERM_TOKEN,
            HUD_SESSION_ID: sessionId || '',
          },
        },
      },
    };
    // --mcp-config ADDS to the user's own MCP servers (no --strict-mcp-config)
    args.push('--mcp-config', tmp('mcp', mcpConfig));
    args.push('--permission-prompt-tool', 'mcp__ovly_hud__approve');
  }
  if (options.model) args.push('--model', options.model);
  if (options.effort) args.push('--settings', tmp('settings', { effortLevel: options.effort }));
  return { args, tempFiles };
}

// ===========================================================================
// MCP server status (`claude mcp list` & `agy mcp list`) and slash-command discovery
// ===========================================================================
const mcpListCache = new Map(); // cacheKey -> { at, result }

ipcMain.handle('mcp-list', (_event, { cwd, refresh, source } = {}) => {
  const dir = (cwd && fs.existsSync(cwd)) ? cwd : os.homedir();
  const isAg = source === 'antigravity';
  const cacheKey = `${isAg ? 'ag' : 'claude'}:${dir}`;
  const cached = mcpListCache.get(cacheKey);
  if (!refresh && cached && Date.now() - cached.at < 60 * 1000) return cached.result;

  if (isAg) {
    const agy = findAgyBinary();
    if (!agy) return { servers: [], error: 'Antigravity CLI (agy) not found' };
    return new Promise((resolve) => {
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      execFile(agy, ['--app_data_dir=antigravity', 'mcp', 'list'], { cwd: dir, env, windowsHide: true, timeout: 30000 }, (err, stdout, stderr) => {
        const out = String(stdout || '') + String(stderr || '');
        const servers = [];
        for (const raw of out.split(/\r?\n/)) {
          const line = raw.trim();
          if (!line || /^NAME\s+TYPE\s+STATUS/i.test(line) || /^[-=]+$/.test(line) || /^No MCP servers/i.test(line)) continue;
          const m = line.match(/^(\S+)\s+(stdio|http|sse)\s+(enabled|disabled|connected|failed|error)\s*(.*)$/i);
          if (!m) continue;
          const rawStatus = m[3].toLowerCase();
          const status = (rawStatus === 'enabled' || rawStatus === 'connected') ? 'connected'
            : (rawStatus === 'failed' || rawStatus === 'error') ? 'failed' : 'unknown';
          servers.push({
            name: m[1],
            detail: `${m[2]} · ${m[4].trim()}`,
            status,
            statusText: rawStatus,
          });
        }
        const result = { servers, raw: servers.length ? '' : out.trim().slice(0, 600) };
        mcpListCache.set(cacheKey, { at: Date.now(), result });
        resolve(result);
      });
    });
  }

  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    let out = '';
    let child;
    try {
      child = spawn(findClaudeBinary(), ['mcp', 'list'], { cwd: dir, env, windowsHide: true });
    } catch (err) {
      return resolve({ servers: [], error: err.message });
    }
    const timer = setTimeout(() => { try { child.kill(); } catch (e) {} }, 60 * 1000);
    child.stdout.on('data', (c) => (out += c.toString('utf-8')));
    child.stderr.on('data', (c) => (out += c.toString('utf-8')));
    child.on('error', (err) => { clearTimeout(timer); resolve({ servers: [], error: err.message }); });
    child.on('close', () => {
      clearTimeout(timer);
      // Lines look like:  "name: <command or url> - ✓ Connected"
      const servers = [];
      for (const raw of out.split(/\r?\n/)) {
        const line = raw.trim();
        const m = line.match(/^(.+?):\s+(.*)\s+-\s+(.+)$/);
        if (!m) continue;
        const statusText = m[3].trim();
        const status = /connected/i.test(statusText) && !/fail|not/i.test(statusText) ? 'connected'
          : /auth/i.test(statusText) ? 'auth'
          : /fail|error|✗/i.test(statusText) ? 'failed' : 'unknown';
        servers.push({ name: m[1].trim(), detail: m[2].trim(), status, statusText: statusText.replace(/^[✓✗⚠!]\s*/, '') });
      }
      const result = { servers, raw: servers.length ? '' : out.trim().slice(0, 600) };
      mcpListCache.set(cacheKey, { at: Date.now(), result });
      resolve(result);
    });
  });
});

// Add / remove MCP servers with the claude or agy CLI (argument arrays, no shell).
function runClaude(args, cwd) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    require('child_process').execFile(findClaudeBinary(), args, { cwd, env, windowsHide: true, timeout: 60000 }, (err, stdout, stderr) => {
      mcpListCache.clear();
      resolve({ ok: !err, message: ((stdout || '') + (stderr || '') || (err && err.message) || '').trim().slice(0, 400) });
    });
  });
}
function runAgyMcp(args, cwd) {
  return new Promise((resolve) => {
    const agy = findAgyBinary();
    if (!agy) return resolve({ ok: false, message: 'Antigravity CLI (agy) not found.' });
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    execFile(agy, ['--app_data_dir=antigravity', 'mcp', ...args], { cwd, env, windowsHide: true, timeout: 60000 }, (err, stdout, stderr) => {
      mcpListCache.clear();
      resolve({ ok: !err, message: ((stdout || '') + (stderr || '') || (err && err.message) || '').trim().slice(0, 400) });
    });
  });
}
const mcpDir = (cwd) => (cwd && fs.existsSync(cwd) ? cwd : os.homedir());

ipcMain.handle('mcp-add', (_e, { transport, name, target, args, scope, cwd, source } = {}) => {
  if (!/^[\w.-]{1,64}$/.test(String(name || ''))) return { ok: false, message: 'Name: letters, numbers, . _ - only.' };
  const tgt = String(target || '').trim();
  if (!tgt) return { ok: false, message: 'Enter a URL or command.' };
  const sc = ['user', 'project', 'local'].includes(scope) ? scope : 'user';
  const t = ['stdio', 'http', 'sse'].includes(transport) ? transport : 'stdio';
  if (t !== 'stdio' && !/^https?:\/\//i.test(tgt)) return { ok: false, message: 'An http/sse server needs an http(s):// URL.' };
  if (source === 'antigravity') {
    const agType = t === 'stdio' ? 'stdio' : 'http';
    const a = ['add', '-t', agType, name, tgt];
    if (agType === 'stdio') a.push(...String(args || '').split(/\s+/).filter(Boolean));
    return runAgyMcp(a, mcpDir(cwd));
  }
  const a = ['mcp', 'add', '--transport', t, '--scope', sc, name];
  if (t === 'stdio') a.push('--', tgt, ...String(args || '').split(/\s+/).filter(Boolean)); else a.push(tgt);
  return runClaude(a, mcpDir(cwd));
});

ipcMain.handle('mcp-remove', (_e, { name, cwd, source } = {}) => {
  if (!/^[\w.-]{1,64}$/.test(String(name || ''))) return { ok: false, message: 'Invalid name.' };
  if (source === 'antigravity') return runAgyMcp(['remove', name], mcpDir(cwd));
  return runClaude(['mcp', 'remove', name], mcpDir(cwd));
});

// Sign-in / reconnect only exists inside an interactive session: open one (type /mcp there).
ipcMain.handle('mcp-signin', (_e, { cwd, source } = {}) => {
  try {
    if (source === 'antigravity') {
      const agy = findAgyBinary();
      if (!agy) return { ok: false, message: 'Antigravity CLI (agy) not found.' };
      require('child_process').spawn('cmd.exe', [`/d /c start "Antigravity CLI" "${agy}" --app_data_dir=antigravity`], {
        cwd: mcpDir(cwd), detached: true, windowsVerbatimArguments: true, stdio: 'ignore',
      }).unref();
      return { ok: true };
    }
    require('child_process').spawn('cmd.exe', ['/d /c start "Claude Code - type /mcp" "' + findClaudeBinary() + '"'], {
      cwd: mcpDir(cwd), detached: true, windowsVerbatimArguments: true, stdio: 'ignore',
    }).unref();
    return { ok: true };
  } catch (err) { return { ok: false, message: err.message }; }
});

// Custom commands (~/.claude/commands, <cwd>/.claude/commands) and skills
// (~/.claude/skills, <cwd>/.claude/skills, <cwd>/.agents/skills, ~/.gemini/config/skills, ~/.gemini/antigravity/builtin/skills).
function readDescription(file) {
  try {
    const head = fs.readFileSync(file, 'utf-8').slice(0, 4000);
    const fm = head.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
    if (fm) {
      const d = fm[1].match(/^description:\s*(.+)$/m);
      if (d) return d[1].trim().replace(/^["']|["']$/g, '');
    }
    const firstLine = head.replace(/^---[\s\S]*?\r?\n---\s*\r?\n/, '').split(/\r?\n/).find((l) => l.trim());
    return (firstLine || '').replace(/^#+\s*/, '').trim().slice(0, 120);
  } catch (e) { return ''; }
}

ipcMain.handle('list-slash-commands', (_event, { cwd, source } = {}) => {
  const results = [];
  const seen = new Set();
  const add = (item) => { if (!seen.has(item.name)) { seen.add(item.name); results.push(item); } };

  const scanCommandsDir = (cmdDir, scope) => {
    const walk = (d, prefix) => {
      let entries = [];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
      for (const e of entries) {
        if (e.isDirectory()) walk(path.join(d, e.name), prefix ? `${prefix}:${e.name}` : e.name);
        else if (e.name.endsWith('.md')) {
          const base = e.name.slice(0, -3);
          add({ name: prefix ? `${prefix}:${base}` : base, description: readDescription(path.join(d, e.name)), kind: 'command', scope });
        }
      }
    };
    walk(cmdDir, '');
  };

  const scanSkillsDir = (skillDir, scope) => {
    let skills = [];
    try { skills = fs.readdirSync(skillDir, { withFileTypes: true }); } catch (e) { return; }
    for (const s of skills) {
      const file = path.join(skillDir, s.name, 'SKILL.md');
      if (s.isDirectory() && fs.existsSync(file)) {
        add({ name: s.name, description: readDescription(file), kind: 'skill', scope });
      }
    }
  };

  if (source === 'antigravity') {
    if (cwd && fs.existsSync(cwd)) {
      scanSkillsDir(path.join(cwd, '.agents', 'skills'), 'project');
      scanSkillsDir(path.join(cwd, '.agent', 'skills'), 'project');
      scanCommandsDir(path.join(cwd, '.agents', 'workflows'), 'project');
      scanCommandsDir(path.join(cwd, '.agent', 'workflows'), 'project');
      scanSkillsDir(path.join(cwd, '.claude', 'skills'), 'project');
    }
    scanSkillsDir(path.join(os.homedir(), '.gemini', 'config', 'skills'), 'user');
    scanSkillsDir(path.join(os.homedir(), '.gemini', 'antigravity', 'skills'), 'user');
    scanSkillsDir(path.join(os.homedir(), '.gemini', 'antigravity', 'builtin', 'skills'), 'builtin');
    scanSkillsDir(path.join(os.homedir(), '.claude', 'skills'), 'user');
    return results;
  }

  const roots = [];
  if (cwd && fs.existsSync(cwd)) roots.push({ dir: path.join(cwd, '.claude'), scope: 'project' });
  roots.push({ dir: path.join(os.homedir(), '.claude'), scope: 'user' });

  for (const { dir, scope } of roots) {
    scanCommandsDir(path.join(dir, 'commands'), scope);
    scanSkillsDir(path.join(dir, 'skills'), scope);
  }
  return results;
});

// Usage stats (tokens / cost) from local Claude Code + Antigravity logs
const { getUsage, getPlanLimits } = require('./usage');
let usageInFlight = null;
ipcMain.handle('get-usage', async (_event, { refresh } = {}) => {
  if (!usageInFlight) {
    usageInFlight = Promise.all([getUsage(), getPlanLimits(!!refresh)])
      .then(([usage, planLimits]) => ({ ...usage, planLimits }))
      .finally(() => { usageInFlight = null; });
  }
  try { return await usageInFlight; }
  catch (e) { return { error: e.message }; }
});

// Robot avatar SVG source (renderer crops it into a headshot).
// Only robot_*.svg files from the app folder can be read.
ipcMain.handle('read-robot-svg', (_event, name) => {
  if (typeof name !== 'string' || !/^robot_[\w-]+\.svg$/.test(name)) return null;
  try { return fs.readFileSync(path.join(__dirname, name), 'utf-8'); }
  catch (e) { return null; }
});

// ===========================================================================
// Antigravity CLI (`agy`) — official way to send to a conversation:
//   agy -p "<prompt>" --conversation <id> --output-format stream-json
// ===========================================================================
function findAgyBinary() {
  const candidates = [
    path.join(os.homedir(), '.gemini', 'bin', 'agy.exe'),
    path.join(os.homedir(), '.gemini', 'bin', 'agy'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

// Models Antigravity can use (`agy models` → "id<TAB>Display name" lines), cached 10 min
let agyModelsCache = null;
ipcMain.handle('agy-models', () => {
  if (agyModelsCache && Date.now() - agyModelsCache.at < 10 * 60 * 1000) return agyModelsCache.list;
  const bin = findAgyBinary();
  if (!bin) return [];
  return new Promise((resolve) => {
    execFile(bin, ['--app_data_dir=antigravity', 'models'], { windowsHide: true, timeout: 30000 }, (err, stdout) => {
      const list = String(stdout || '').split(/\r?\n/)
        .map((l) => l.split('\t'))
        .filter((p) => p.length >= 2 && /^[\w.\-]+$/.test(p[0].trim()))
        .map(([id, name]) => ({ id: id.trim(), name: name.trim() }));
      if (list.length) agyModelsCache = { at: Date.now(), list };
      resolve(list);
    });
  });
});

// Pull readable text out of one stream-json line, whatever its exact shape
function agyLineText(obj) {
  if (!obj || typeof obj !== 'object') return '';
  const fromContent = (c) => {
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map((b) => (typeof b === 'string' ? b : b?.text || '')).join('');
    return '';
  };
  return fromContent(obj.message?.content) || fromContent(obj.content) ||
    (typeof obj.text === 'string' ? obj.text : '') ||
    (typeof obj.delta?.text === 'string' ? obj.delta.text : '') || '';
}

function sendViaAgy(agyBin, { text, images = [], session, sessionId, options = {} }) {
  // New chat (a HUD draft): run without --conversation so agy starts a fresh
  // one; its id arrives in the first "init" event (see reply-rekey below).
  const isNewChat = !!(options.newSession || session?.draft);
  const startedAsId = sessionId;
  let convId = isNewChat ? '' : String(sessionId || '').replace(/^antigravity_/, '');
  const cwd = (session?.cwd && fs.existsSync(session.cwd)) ? session.cwd : os.homedir();
  const appDataDir = String(session?.appDataDir || 'antigravity').replace(/[^\w\-]/g, '') || 'antigravity';
  const send = (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, { sessionId, ...payload });
  };

  // Images: save to a temp file and reference it in the prompt
  let prompt = text || '';
  const imageFiles = [];
  for (const image of images) {
    const m = image.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!m) continue;
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1].replace(/[^a-z0-9]/gi, '') || 'png';
    const f = path.join(os.tmpdir(), `ovly-image-${crypto.randomBytes(5).toString('hex')}.${ext}`);
    try { fs.writeFileSync(f, Buffer.from(m[2], 'base64')); imageFiles.push(f); } catch (e) {}
  }
  if (imageFiles.length) prompt = `${prompt}\n\n${imageFiles.map((f) => `[Attached image: ${f}]`).join('\n')}`.trim();
  if (!prompt) return;

  if (watcher && sessionId) watcher.setSessionRunning(sessionId, 'Running (Thinking...)', text || 'Sent an image');
  send('reply-status', { status: 'running', statusLabel: 'Running (Thinking...)', message: '⚡ Sent to Antigravity (agy)…' });

  // By default `agy` uses its own data folder (~/.gemini/antigravity-cli), which
  // doesn't contain the editor's conversations → "trajectory not found".
  // Point it at the editor's folder, or use `--mode plan` / `--mode auto` when requested.
  const agMode = options.plan ? 'plan' : (options.autoApprove ? 'auto' : 'accept-edits');
  const args = [`--app_data_dir=${appDataDir}`, '-p', prompt, '--output-format', 'stream-json', '--mode', agMode];
  if (convId) args.push('--conversation', convId);
  // Model / effort picked in the HUD (Model ▾ / Effort) for this reply
  if (typeof options.model === 'string' && /^[\w.\-]{1,80}$/.test(options.model)) args.push('--model', options.model);
  if (['low', 'medium', 'high', 'xhigh', 'max'].includes(options.effort)) args.push('--effort', options.effort);

  let child;
  try {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    child = spawn(agyBin, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    if (watcher && sessionId) watcher.cancelRunning(sessionId);
    send('reply-status', { status: 'idle', statusLabel: 'Idle', message: `⚠ Couldn't start agy: ${err.message}` });
    return;
  }
  features.trackChild(sessionId, child);

  const sentAt = Date.now();
  let buf = '';
  let stderr = '';
  let rawOut = ''; // kept (capped) to spot why a turn stopped, e.g. a denied command
  const stepText = new Map(); // agent_response step_index -> text written in that step
  const runEdits = [];
  const seenEditSteps = new Set();
  let accumulated = '';
  let finalResult = '';
  let resultStatus = '';
  let resultError = '';
  let activity = { kind: 'thinking' };
  child.stdout.on('data', (chunk) => {
    const s = chunk.toString('utf-8');
    if (rawOut.length < 400000) rawOut += s;
    buf += s;
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch (e) { continue; }

      // New chat: Antigravity named the conversation → this window becomes it
      const newConv = obj.conversation_id || obj.step_update?.conversation_id || obj.result?.conversation_id;
      if (isNewChat && !convId && typeof newConv === 'string' && /^[0-9a-f-]{8,64}$/i.test(newConv)) {
        convId = newConv;
        const newId = 'antigravity_' + newConv;
        features.aliasChild(startedAsId, newId);
        sessionAliases.set(startedAsId, newId);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('reply-rekey', { oldId: startedAsId, newId, sessionUuid: newConv });
        }
        sessionId = newId; // later stream / status updates go to the new id
        if (watcher) watcher.check();
      }

      if (obj.event === 'step_update' && obj.step_update) {
        const su = obj.step_update;
        if (su.step_type === 'agent_response') {
          if (typeof su.text_delta === 'string' && su.text_delta) {
            stepText.set(su.step_index, (stepText.get(su.step_index) || '') + su.text_delta);
            accumulated = [...stepText.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t.trim()).filter(Boolean).join('\n\n');
            activity = { kind: 'writing' };
          } else if (su.state === 'ACTIVE') {
            activity = { kind: 'thinking' };
          }
        } else if (su.step_type === 'tool') {
          const tName = su.tool_name || su.tool_info?.name || 'tool';
          const tParams = su.tool_info?.parameters || su.tool_info?.args || {};
          if (!seenEditSteps.has(su.step_index)) {
            const ed = features.editFromToolUse({ name: tName, args: tParams });
            if (ed) {
              seenEditSteps.add(su.step_index);
              features.mergeEdit(runEdits, ed);
            }
          }
          activity = su.state === 'ACTIVE'
            ? { kind: 'tool', tool: tName, input: tParams }
            : { kind: 'thinking' };
        }
      } else if (obj.event === 'result' && obj.result) {
        const r = obj.result;
        if (typeof r.response === 'string') finalResult = r.response.trim();
        resultStatus = String(r.status || '');
        resultError = typeof r.error === 'string' ? r.error : (r.error ? JSON.stringify(r.error) : '');
      } else {
        // Older agy versions: plain text in a few known places
        if (typeof obj.result === 'string') finalResult = obj.result;
        const t = agyLineText(obj);
        if (t) accumulated = t;
      }

      send('reply-stream', {
        status: 'running',
        statusLabel: activity.kind === 'tool' ? `Running: ${activity.tool}` : activity.kind === 'writing' ? 'Running (Generating...)' : 'Running (Thinking...)',
        text: accumulated, // '' until Antigravity writes its answer
        activity,
      });
    }
    if (watcher) watcher.check();
  });
  child.stderr.on('data', (c) => { stderr += c.toString('utf-8'); });

  let finished = false;
  const finish = (code, errMsg) => {
    if (finished) return; // 'error' and 'close' can both fire
    finished = true;
    imageFiles.forEach((f) => fs.unlink(f, () => {}));
    const stopped = features.wasStopped(sessionId);
    const ok = code === 0 && !errMsg && (!resultStatus || resultStatus === 'SUCCESS');
    if (!errMsg && resultStatus && resultStatus !== 'SUCCESS') {
      errMsg = `${resultStatus}${resultError ? `: ${resultError}` : ''}`;
    }

    // Did the agent stop because a command needed approval?
    // Only check the very last transcript step of this turn (type === 'GENERIC' && status === 'ERROR')
    // so assistant replies quoting error text never trigger a false match.
    // Also collect any file edits logged in the transcript for this turn.
    let deniedCmd = '';
    const tPath = convId
      ? path.join(os.homedir(), '.gemini', appDataDir, 'brain', convId, '.system_generated', 'logs', 'transcript.jsonl')
      : '';
    try {
      if (tPath && fs.existsSync(tPath)) {
        const st = fs.statSync(tPath);
        const len = Math.min(st.size, 65536);
        const fd = fs.openSync(tPath, 'r');
        const b = Buffer.alloc(len);
        fs.readSync(fd, b, 0, len, st.size - len);
        fs.closeSync(fd);
        const tailLines = b.toString('utf-8').split('\n').filter(Boolean);
        let lastTurnEntry = null;
        for (const l of tailLines) {
          let e;
          try { e = JSON.parse(l); } catch (_) { continue; }
          if ((Date.parse(e.created_at) || 0) < sentAt - 5000) continue;
          lastTurnEntry = e;
          if (e.type === 'PLANNER_RESPONSE' && Array.isArray(e.tool_calls)) {
            for (const tc of e.tool_calls) {
              const ed = features.editFromToolUse({ name: tc?.name, args: tc?.args });
              if (ed) features.mergeEdit(runEdits, ed);
            }
          }
        }
        if (!stopped && lastTurnEntry && lastTurnEntry.type === 'GENERIC' && lastTurnEntry.status === 'ERROR') {
          const errStr = String(lastTurnEntry.error || lastTurnEntry.content || '').replace(/\\n/g, '\n').replace(/\\"/g, '"');
          const m = errStr.match(/user denied permission to run command:\s*\n?([^\n]+)/i);
          if (m) deniedCmd = m[1].trim().slice(0, 300);
        }
      }
    } catch (e) {}

    const fromLog = watcher && convId && tPath ? watcher.latestAgReply(tPath) : null;
    const logReply = fromLog && fromLog.ts >= sentAt - 5000 && fromLog.step >= fromLog.userStep ? fromLog.text : '';
    let replyText = finalResult || accumulated || logReply || '';
    if (deniedCmd) {
      replyText = `${replyText ? replyText + '\n\n' : ''}**Stopped:** Antigravity wanted to run this command, which needs your approval in Antigravity:\n\n\`\`\`powershell\n${deniedCmd}\n\`\`\`\n\nApprove it in the Antigravity window, or ask it to continue without running commands.`;
    }

    // The process is gone, so this turn is over — even if the transcript ends
    // on "tool finished" (which would otherwise read as still running).
    if (watcher && sessionId) {
      watcher.markTurnEnded(
        sessionId,
        stopped ? 'Idle (Stopped)' : deniedCmd ? 'Idle (Command needs approval)' : ok ? 'Idle (Ready)' : 'Idle (Error)',
        deniedCmd ? `Approve in Antigravity: ${deniedCmd}` : ''
      );
    }

    const firstErr = (errMsg || stderr).split(/\r?\n/).find((l) => l.trim()) || `exit code ${code}`;
    let message = stopped
      ? 'Stopped'
      : deniedCmd
        ? '⚠ Command needs approval in Antigravity'
        : ok
          ? '✓ Antigravity replied'
          : `⚠ Antigravity (agy) failed: ${firstErr.slice(0, 160)}`;

    if (!replyText && runEdits.length) replyText = '*(edited files — see below)*';
    send('reply-status', {
      status: 'idle',
      statusLabel: stopped ? 'Idle (Stopped)' : deniedCmd ? 'Idle (Command needs approval)' : ok ? 'Idle (Ready)' : 'Idle',
      text: replyText,
      edits: runEdits,
      code: stopped ? 0 : code,
      message,
    });
    if (!ok && !stopped) console.error('[Main] agy failed:', code, stderr.slice(0, 2000));
  };
  child.on('error', (err) => finish(-1, err.message));
  child.on('close', (code) => finish(code));
}

// Send reply directly to Claude Code (--resume) or Antigravity IDE (chat subcommand)
// Non-image attachments → paths on disk that the agent can open. Files picked
// or dropped from Explorer keep their real path; pasted ones are saved to temp.
function resolveAttachedFiles(files) {
  const out = [];
  for (const f of Array.isArray(files) ? files : []) {
    if (f?.path && fs.existsSync(f.path)) { out.push(f.path); continue; }
    const m = typeof f?.data === 'string' && f.data.match(/^data:[^;,]*(?:;[^,]*)?;base64,(.*)$/);
    if (!m) continue;
    const safe = String(f.name || 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 80) || 'file';
    const p = path.join(os.tmpdir(), `ovly-${crypto.randomBytes(4).toString('hex')}-${safe}`);
    try { fs.writeFileSync(p, Buffer.from(m[1], 'base64')); out.push(p); } catch (e) {}
  }
  return out;
}

ipcMain.on('send-reply', async (_event, { text, image, images, files, session, copyOnly, options = {} }) => {
  const imageList = (Array.isArray(images) && images.length ? images : (image ? [image] : []))
    .filter((d) => typeof d === 'string' && d.startsWith('data:image/'));
  image = imageList[0] || null;
  const filePaths = resolveAttachedFiles(files);
  if (filePaths.length) {
    text = `${text || 'Please look at the attached file' + (filePaths.length > 1 ? 's' : '') + '.'}\n\n` +
      `Attached file${filePaths.length > 1 ? 's' : ''}:\n${filePaths.map((p) => `- ${p}`).join('\n')}`;
  }
  if (!text && !image) return;

  // 1. Always write to system clipboard as backup
  try {
    if (image) {
      const nImg = nativeImage.createFromDataURL(image);
      if (!nImg.isEmpty()) {
        clipboard.writeImage(nImg);
      } else if (typeof ClipboardItem !== 'undefined') {
        const base64Data = image.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
        const imgBuffer = Buffer.from(base64Data, 'base64');
        const imgBlob = new Blob([imgBuffer], { type: 'image/png' });
        await clipboard.write([new ClipboardItem({ 'image/png': imgBlob })]);
      }
    } else if (text) {
      clipboard.writeText(text);
    }
  } catch (err) {
    console.error('[Main] Clipboard error:', err.message);
    if (text) {
      try { clipboard.writeText(text); } catch (e) {}
    }
  }

  if (copyOnly) return;

  const source = session?.source || 'claude';
  let sessionId = session?.id || '';
  const startedAsId = sessionId; // a New-chat draft id until Claude names the session
  const isNewChat = !!options.newSession;

  // 2. Direct execution for Claude Code sessions
  if (source === 'claude') {
    const claudeBin = findClaudeBinary();
    const sessionUuid = isNewChat ? '' : (session?.sessionUuid || sessionId.replace(/^claude_/, ''));
    const projectCwd = (session?.cwd && fs.existsSync(session.cwd)) ? session.cwd : process.cwd();

    if (watcher && sessionId) {
      watcher.setSessionRunning(sessionId, 'Running (Thinking...)', text || 'Analyzing attached image...');
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('reply-status', {
        sessionId,
        status: 'running',
        statusLabel: 'Running (Thinking...)',
        message: '⚡ Sent to Claude! Thinking...'
      });
    }

    const content = [];
    for (const img of imageList) {
      const match = img.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (!match) continue;
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: match[1], data: match[2] }
      });
    }
    content.push({
      type: 'text',
      text: text || (imageList.length > 1 ? 'Please analyze the attached images.' : 'Please analyze the attached image.')
    });

    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--input-format', 'stream-json',
      '--permission-mode', options.plan ? 'plan' : 'acceptEdits',
      // `claude -p` cannot ask interactive questions: the question tool just waits a few
      // seconds, then answers itself with "The user did not answer" and Claude carries on
      // alone. So switch it off here — Claude asks in plain text and stops instead,
      // which the HUD shows as "needs input" (+ Yes / No buttons).
      '--disallowedTools', 'AskUserQuestion',
      '--append-system-prompt',
      'You are replying inside a small chat window, not a terminal: interactive question tools are not available. ' +
      'When you need the user to decide something, ask it in plain text at the end of your reply (for a yes/no ' +
      'question, make it the very last sentence), list any options briefly, and then stop and wait for the answer. ' +
      'Never carry on assuming an answer to a question you just asked.'
    ];

    // options.newSession (from /clear) starts a fresh conversation in the same folder
    if (sessionUuid && !sessionUuid.startsWith('test_') && !options.newSession) {
      args.push('--resume', sessionUuid);
    }

    // Tool approvals in the HUD + /model, /effort overrides
    const extra = buildClaudeExtraArgs(sessionId, options);
    args.push(...extra.args);
    const cleanupTemp = () => extra.tempFiles.forEach((f) => fs.unlink(f, () => {}));

    try {
      const cleanEnv = { ...process.env };
      delete cleanEnv.ELECTRON_RUN_AS_NODE;

      const child = spawn(claudeBin, args, {
        cwd: projectCwd,
        env: cleanEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });

      features.trackChild(sessionId, child);
      const runEdits = []; // files this reply edited (shown under the reply)
      let stdoutBuf = '';
      let accumulatedText = '';
      let currentStatusLabel = 'Running (Thinking...)';

      child.stdout.on('data', (chunk) => {
        stdoutBuf += chunk.toString('utf-8');
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            // New chat: the first event carries the new session's id → tell the
            // HUD so the open conversation becomes that session.
            if (isNewChat && sessionId === startedAsId && obj.session_id) {
              const newId = 'claude_' + obj.session_id;
              sessionAliases.set(startedAsId, newId);
              sessionId = newId;
              features.aliasChild(startedAsId, newId);
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('reply-rekey', { oldId: startedAsId, newId, sessionUuid: obj.session_id });
              }
            }
            if (obj.type === 'system' && obj.subtype === 'thinking_tokens') {
              currentStatusLabel = 'Running (Thinking...)';
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('reply-stream', {
                  sessionId,
                  status: 'running',
                  statusLabel: currentStatusLabel,
                  text: accumulatedText, // '' = nothing written yet (the HUD shows an activity line)
                  activity: { kind: 'thinking' }
                });
              }
            } else if (obj.type === 'assistant' && obj.message?.content) {
              const blocks = Array.isArray(obj.message.content) ? obj.message.content : [];
              let streamActivity = { kind: 'writing' };
              for (const b of blocks) {
                if (b.type === 'text' && b.text) {
                  accumulatedText = b.text;
                  currentStatusLabel = 'Running (Generating...)';
                  streamActivity = { kind: 'writing' };
                } else if (b.type === 'tool_use') {
                  const ed = features.editFromToolUse(b);
                  if (ed) features.mergeEdit(runEdits, ed);
                  currentStatusLabel = `Running: ${b.name || 'Tool'}`;
                  streamActivity = { kind: 'tool', tool: b.name || 'Tool', input: b.input || {} };
                  if (watcher && sessionId) {
                    watcher.setSessionRunning(sessionId, currentStatusLabel);
                  }
                }
              }

              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('reply-stream', {
                  sessionId,
                  status: 'running',
                  statusLabel: currentStatusLabel,
                  text: accumulatedText,
                  activity: streamActivity
                });
              }
            }
          } catch (e) {}
        }

        if (watcher) watcher.check();
      });

      child.stderr.on('data', (chunk) => {
        console.error('[Claude STDERR]', chunk.toString('utf-8'));
      });

      child.on('error', cleanupTemp);
      child.on('close', (code) => {
        cleanupTemp();
        // Any approval prompts from this run can no longer be answered
        for (const [pid, p] of permState.pendingPermissions) {
          if (p.sessionId === sessionId || p.sessionId === startedAsId) {
            answerPermission(pid, { behavior: 'deny', message: 'Claude process ended.' });
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('permission-expired', { id: pid });
          }
        }
        if (watcher) watcher.check();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('reply-status', {
            sessionId,
            status: 'idle',
            statusLabel: 'Idle (Ready)',
            text: accumulatedText,
            edits: runEdits,
            code,
            message: features.wasStopped(sessionId) ? '■ Stopped' : code === 0 ? '✓ Claude replied!' : `Claude exited (${code})`
          });
        }
      });

      const userPayload = JSON.stringify({
        type: 'user',
        session_id: sessionUuid || '',
        message: {
          role: 'user',
          content
        },
        parent_tool_use_id: null
      }) + '\n';

      child.stdin.write(userPayload);
      child.stdin.end();
    } catch (err) {
      console.error('[Main] Failed to spawn Claude:', err);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('reply-status', {
          sessionId,
          status: 'idle',
          statusLabel: 'Idle',
          message: '⚠ Error: ' + err.message
        });
      }
    }
    return;
  }

  // 3a. Antigravity via its official CLI (`agy`): resume the conversation by ID
  //     and run one prompt — same model as `claude -p --resume`. No keystrokes.
  const agyBin = findAgyBinary();
  if (agyBin) {
    sendViaAgy(agyBin, { text, images: imageList, session, sessionId, options });
    return;
  }

  // 3b. Fallback (agy not installed): Focus Antigravity IDE window, paste via Win32 keybd_event (with proper Ctrl hold timing), and press Enter
  if (watcher && sessionId) {
    watcher.setSessionRunning(sessionId, 'Running (Thinking...)', text || 'Sent image to Antigravity');
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.blur();
    mainWindow.webContents.send('reply-status', {
      sessionId,
      status: 'running',
      statusLabel: 'Running (Thinking...)',
      message: '⚡ Pasting & submitting to Antigravity IDE...'
    });
  }

  const projectHint = (session?.project && session.project !== 'Antigravity')
    ? String(session.project).replace(/'/g, "''")
    : '';

  const buildAntigravityPsScript = (mode) => `
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Threading;

public class Win32Input {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr lpdwProcessId);

  [DllImport("kernel32.dll")]
  public static extern uint GetCurrentThreadId();

  [DllImport("user32.dll")]
  public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

  [DllImport("user32.dll")]
  public static extern bool BringWindowToTop(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

  // Find an Antigravity window by its PROCESS ("Antigravity IDE.exe"), not by
  // title text (titles vary: "file - project - Antigravity", etc.). Prefer the
  // window whose title contains the session's project name.
  public static IntPtr FindAntigravityWindow(string hint) {
    IntPtr bestMatch = IntPtr.Zero;
    IntPtr firstMatch = IntPtr.Zero;
    EnumWindows((hWnd, lParam) => {
      if (!IsWindowVisible(hWnd)) return true;
      var sb = new StringBuilder(512);
      GetWindowText(hWnd, sb, 512);
      string title = sb.ToString();
      if (string.IsNullOrEmpty(title)) return true;

      bool isAntigravity = false;
      try {
        uint pid;
        GetWindowThreadProcessId(hWnd, out pid);
        string name = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName;
        isAntigravity = name.IndexOf("Antigravity", StringComparison.OrdinalIgnoreCase) >= 0;
      } catch { }
      if (!isAntigravity && title.IndexOf("Antigravity", StringComparison.OrdinalIgnoreCase) >= 0) {
        isAntigravity = true; // fallback: title match
      }
      if (!isAntigravity) return true;

      if (!string.IsNullOrEmpty(hint) && title.IndexOf(hint, StringComparison.OrdinalIgnoreCase) >= 0) {
        bestMatch = hWnd;
      }
      if (firstMatch == IntPtr.Zero) firstMatch = hWnd;
      return true;
    }, IntPtr.Zero);
    return bestMatch != IntPtr.Zero ? bestMatch : firstMatch;
  }

  // Ctrl+L = "antigravity.toggleChatFocus" (Open Chat with Agent). It only fires
  // when the agent input is NOT focused, and moves focus into it — so the paste
  // lands in the agent box, never in the code editor.
  public static void FocusAgentInput() {
    const byte VK_CONTROL = 0x11;
    const byte VK_L = 0x4C;
    const uint KEYEVENTF_KEYUP = 0x0002;
    keybd_event(VK_CONTROL, 0, 0, UIntPtr.Zero);
    Thread.Sleep(40);
    keybd_event(VK_L, 0, 0, UIntPtr.Zero);
    Thread.Sleep(40);
    keybd_event(VK_L, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    Thread.Sleep(40);
    keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
  }

  public static bool FocusWindow(IntPtr hWnd) {
    if (hWnd == IntPtr.Zero) return false;
    const byte VK_MENU = 0x12;
    const uint KEYEVENTF_KEYUP = 0x0002;
    if (IsIconic(hWnd)) {
      ShowWindow(hWnd, 9);
    }
    IntPtr fg = GetForegroundWindow();
    uint fgThread = GetWindowThreadProcessId(fg, IntPtr.Zero);
    uint curThread = GetCurrentThreadId();
    bool attached = false;
    if (fgThread != 0 && fgThread != curThread) {
      attached = AttachThreadInput(curThread, fgThread, true);
    }
    keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    BringWindowToTop(hWnd);
    bool res = SetForegroundWindow(hWnd);
    if (attached) {
      AttachThreadInput(curThread, fgThread, false);
    }
    return res;
  }

  public static void PasteOnly() {
    const byte VK_CONTROL = 0x11;
    const byte VK_V = 0x56;
    const uint KEYEVENTF_KEYUP = 0x0002;
    keybd_event(VK_CONTROL, 0, 0, UIntPtr.Zero);
    Thread.Sleep(45);
    keybd_event(VK_V, 0, 0, UIntPtr.Zero);
    Thread.Sleep(45);
    keybd_event(VK_V, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    Thread.Sleep(45);
    keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
  }

  public static void SubmitOnly() {
    const byte VK_RETURN = 0x0D;
    const uint KEYEVENTF_KEYUP = 0x0002;
    keybd_event(VK_RETURN, 0, 0, UIntPtr.Zero);
    Thread.Sleep(45);
    keybd_event(VK_RETURN, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
  }

  public static void PasteAndSubmit() {
    PasteOnly();
    Thread.Sleep(160);
    SubmitOnly();
  }
}
'@

$hwnd = [Win32Input]::FindAntigravityWindow('${projectHint}')
if ($hwnd -eq [IntPtr]::Zero) {
  Write-Output 'NOT_FOUND'
  exit 0
}
[Win32Input]::FocusWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 250
if ('${mode}' -ne 'submitOnly') {
  # Put the cursor in the agent's input box (not the editor) before pasting
  [Win32Input]::FocusAgentInput()
  Start-Sleep -Milliseconds 300
}
if ('${mode}' -eq 'pasteOnly') {
  [Win32Input]::PasteOnly()
} else {
  [Win32Input]::PasteAndSubmit()
}
Write-Output 'SENT'
`;

  const runPsEncoded = (script, cb) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 30000 }, cb);
  };

  // Tell the HUD what happened (window missing / PowerShell error / sent)
  const reportAntigravity = (err, stdout) => {
    const out = String(stdout || '');
    let message = '✓ Sent to Antigravity';
    let failed = false;
    if (err) { failed = true; message = `⚠ Couldn't send to Antigravity: ${err.message.split('\n')[0]}`; }
    else if (out.includes('NOT_FOUND')) { failed = true; message = '⚠ Antigravity isn’t open — start it, then send again'; }
    if (failed && watcher && sessionId) watcher.cancelRunning(sessionId);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('reply-status', {
        sessionId,
        status: failed ? 'idle' : 'running',
        statusLabel: failed ? 'Idle' : 'Running (Thinking...)',
        message,
      });
      if (isAlwaysOnTop) setTimeout(() => mainWindow.setAlwaysOnTop(true, 'screen-saver'), 300);
    }
  };

  if (image && text) {
    // Image is already in the clipboard (step 1): focus agent input + paste image,
    // then put the text in the clipboard and paste + submit (input stays focused).
    runPsEncoded(buildAntigravityPsScript('pasteOnly'), (err, stdout) => {
      if (err || String(stdout).includes('NOT_FOUND')) return reportAntigravity(err, stdout);
      setTimeout(() => {
        try { clipboard.writeText(text); } catch (e) {}
        runPsEncoded(buildAntigravityPsScript('submitOnly'), reportAntigravity);
      }, 250);
    });
  } else {
    runPsEncoded(buildAntigravityPsScript('pasteAndSubmit'), reportAntigravity);
  }
});

// ---------------------------------------------------------------
// Manual window dragging (replaces CSS -webkit-app-region, which is
// unreliable on Windows for transparent frameless windows).
// The renderer only says start/stop; main follows the OS cursor, so the
// drag never "drops" when the mouse outruns the window.
// ---------------------------------------------------------------
//
// Magnetic edge docking:
//  • while dragging, the window is pulled flush onto the left/right screen
//    edge once it gets within SNAP_DIST px (the "magnet");
//  • releasing it there docks it: it springs into a small MINI_SIZE tab
//    stuck to that edge;
//  • clicking the tab (or dragging it off the edge) restores the full HUD.
// ---------------------------------------------------------------
const SNAP_DIST = 36;
const MINI_SIZE = 76;
const MIN_FULL_SIZE = [360, 64];

let dragTimer = null;
let dragInfo = null;          // { startCursor, moved }
let dockState = { docked: false, side: null, restore: null }; // restore = {width,height}
let boundsAnim = null;
let dockSwapTimer = null;
// Extra width of the mini tab while it shows Allow / Deny buttons next to the avatar
let miniExtra = 0;
const miniWidth = () => MINI_SIZE + miniExtra;

function sendDockState(phase) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('dock-state', {
      docked: dockState.docked,
      side: dockState.side,
      phase: phase || (dockState.docked ? 'docked' : 'open'),
    });
  }
}

function workAreaAt(point) {
  return screen.getDisplayNearestPoint(point).workArea;
}

// Animate window bounds.
// ease: 'sticky' (viscous magnetic pull + velvety settle), 'out' (cubic-out), 'back' (overshoot)
// anchor: 'left' | 'right' | null — keeps the docked edge glued to the screen edge with zero wobble
// followDrag: when true, x/y track dragInfo.livePos so dragging the mini bar out animates live under the cursor
function animateBounds(target, { duration = 320, ease = 'sticky', anchor = null, staggerHeight = false, followDrag = false } = {}) {
  if (!mainWindow) return;
  if (boundsAnim) clearInterval(boundsAnim);
  const from = mainWindow.getBounds();
  const start = performance.now();
  const stickyEase = (t) => {
    // Gentle magnetic ease-in for the first 15%, then smooth quartic settle
    if (t < 0.15) {
      const u = t / 0.15;
      return 0.05 * u * u;
    }
    const u = (t - 0.15) / 0.85;
    return 0.05 + 0.95 * (1 - Math.pow(1 - u, 3.6));
  };
  const easeFn = ease === 'back'
    ? (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
    : ease === 'sticky'
      ? stickyEase
      : (t) => 1 - Math.pow(1 - t, 3);

  const rightEdge = target.x + target.width;
  let lastTx = target.x;
  let lastTy = target.y;
  boundsAnim = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) { clearInterval(boundsAnim); boundsAnim = null; return; }
    const t = Math.min(1, (performance.now() - start) / duration);
    const k = easeFn(t);
    const kh = staggerHeight ? easeFn(Math.pow(t, 1.15)) : k;
    const lerp = (a, b, f = k) => Math.round(a + (b - a) * f);
    const width = Math.max(1, lerp(from.width, target.width, k));
    const height = Math.max(1, lerp(from.height, target.height, kh));
    if (followDrag && dragInfo?.livePos) {
      lastTx = dragInfo.livePos.x;
      lastTy = dragInfo.livePos.y;
    }
    const tx = lastTx;
    const ty = lastTy;
    let x = lerp(from.x, tx, k);
    if (!followDrag) {
      if (anchor === 'left') x = target.x;
      else if (anchor === 'right') x = rightEdge - width;
    }
    mainWindow.setBounds({
      x,
      y: lerp(from.y, ty, kh),
      width,
      height,
    });
    if (t >= 1) {
      clearInterval(boundsAnim);
      boundsAnim = null;
      mainWindow.setBounds({
        x: tx,
        y: ty,
        width: target.width,
        height: target.height,
      });
    }
  }, 8);
}

function clampY(y, height, wa) {
  return Math.min(Math.max(y, wa.y), wa.y + wa.height - height);
}

function dockToEdge(side) {
  if (!mainWindow) return;
  if (dockSwapTimer) { clearTimeout(dockSwapTimer); dockSwapTimer = null; }
  const b = mainWindow.getBounds();
  const wa = workAreaAt({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  dockState = { docked: false, side, restore: { width: b.width, height: b.height } };
  sendDockState('docking'); // fade & compress full HUD toward the edge first
  dockState.docked = true;
  mainWindow.setMinimumSize(1, 1);
  mainWindow.setResizable(false);
  const y = clampY(b.y, MINI_SIZE, wa);
  const x = side === 'left' ? wa.x : wa.x + wa.width - miniWidth();
  animateBounds({ x, y, width: miniWidth(), height: MINI_SIZE }, { duration: 340, ease: 'sticky', anchor: side, staggerHeight: true });
  dockSwapTimer = setTimeout(() => {
    dockSwapTimer = null;
    if (dockState.docked) sendDockState('docked');
  }, 135);
}

// Renderer: the mini tab needs `px` extra width (approval buttons) — grow/shrink
// it while keeping it stuck to its screen edge.
ipcMain.on('set-mini-extra', (_e, px) => {
  const v = Math.max(0, Math.min(320, Math.round(Number(px) || 0)));
  if (v === miniExtra) return;
  miniExtra = v;
  if (!mainWindow || mainWindow.isDestroyed() || !dockState.docked || dragTimer) return;
  const b = mainWindow.getBounds();
  const wa = workAreaAt({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  const x = dockState.side === 'left' ? wa.x : wa.x + wa.width - miniWidth();
  animateBounds({ x, y: b.y, width: miniWidth(), height: MINI_SIZE }, { duration: 160, ease: 'out' });
});

function undock({ keepPosition = false } = {}) {
  if (!mainWindow || !dockState.docked) return;
  if (dockSwapTimer) { clearTimeout(dockSwapTimer); dockSwapTimer = null; }
  const b = mainWindow.getBounds();
  const wa = workAreaAt({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  const { width, height } = dockState.restore || { width: currentWidth, height: COMPACT_HEIGHT };
  const side = dockState.side;
  dockState = { docked: false, side: null, restore: null };
  mainWindow.setResizable(true);
  mainWindow.setMinimumSize(...MIN_FULL_SIZE);
  // Grow out of the edge it was stuck to
  let x = keepPosition ? b.x : side === 'left' ? wa.x : side === 'right' ? wa.x + wa.width - width : b.x;
  x = Math.min(Math.max(x, wa.x), wa.x + wa.width - width);
  const y = clampY(b.y, Math.min(height, wa.height), wa);
  animateBounds({ x, y, width, height }, { duration: 300, ease: 'sticky', anchor: keepPosition ? null : side });
  dockSwapTimer = setTimeout(() => {
    dockSwapTimer = null;
    if (!dockState.docked && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('dock-state', { docked: false, side, phase: 'undocking' });
    }
  }, 45);
}

function stopWindowDrag() {
  if (dragTimer) {
    clearInterval(dragTimer);
    dragTimer = null;
  }
}

const DETACH_DIST = 48;

function detachMiniWhileDragging(p, wa) {
  if (!mainWindow || !dockState.docked || !dragInfo) return;
  if (dockSwapTimer) { clearTimeout(dockSwapTimer); dockSwapTimer = null; }
  const { width, height } = dockState.restore || { width: currentWidth, height: COMPACT_HEIGHT };
  const side = dockState.side;
  dockState = { docked: false, side: null, restore: null };
  mainWindow.setResizable(true);
  mainWindow.setMinimumSize(...MIN_FULL_SIZE);

  // Keep cursor anchored on the header pill as the mini bar blooms into the full HUD
  const oldW = dragInfo.width;
  dragInfo.offsetX = side === 'right'
    ? Math.max(24, Math.min(width - 24, width - (oldW - dragInfo.offsetX)))
    : Math.max(24, Math.min(width - 24, dragInfo.offsetX));
  dragInfo.offsetY = Math.min(dragInfo.offsetY, 48);
  dragInfo.width = width;
  dragInfo.height = height;

  let x = Math.min(Math.max(p.x - dragInfo.offsetX, wa.x), wa.x + wa.width - width);
  let y = Math.min(Math.max(p.y - dragInfo.offsetY, wa.y), wa.y + wa.height - Math.min(height, 64));
  dragInfo.livePos = { x, y };

  animateBounds({ x, y, width, height }, { duration: 300, ease: 'sticky', followDrag: true });
  dockSwapTimer = setTimeout(() => {
    dockSwapTimer = null;
    if (!dockState.docked && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('dock-state', { docked: false, side, phase: 'undocking' });
    }
  }, 40);
}

ipcMain.on('window-drag-start', () => {
  if (!mainWindow) return;
  stopWindowDrag();
  if (dockSwapTimer) { clearTimeout(dockSwapTimer); dockSwapTimer = null; }
  if (boundsAnim) { clearInterval(boundsAnim); boundsAnim = null; }
  const cursor = screen.getCursorScreenPoint();
  const bounds = mainWindow.getBounds();
  // Fixed size while dragging: avoids the Windows high-DPI "window grows while moving" bug
  dragInfo = {
    startCursor: cursor,
    moved: false,
    offsetX: cursor.x - bounds.x,
    offsetY: cursor.y - bounds.y,
    width: bounds.width,
    height: bounds.height,
    livePos: null,
  };

  dragTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return stopWindowDrag();
    const p = screen.getCursorScreenPoint();
    if (Math.abs(p.x - dragInfo.startCursor.x) + Math.abs(p.y - dragInfo.startCursor.y) > 4) {
      dragInfo.moved = true;
    }
    if (!dragInfo.moved) return;

    const wa = workAreaAt(p);
    let x = p.x - dragInfo.offsetX;
    let y = p.y - dragInfo.offsetY;

    if (dockState.docked) {
      const pull = dockState.side === 'left'
        ? x - wa.x
        : (wa.x + wa.width) - (x + dragInfo.width);
      if (pull > DETACH_DIST) {
        detachMiniWhileDragging(p, wa);
        return;
      }
      // Sticky resistance while peeling off the docked edge
      if (pull > 0) {
        const resist = Math.round(pull * 0.28);
        x = dockState.side === 'left'
          ? wa.x + resist
          : wa.x + wa.width - dragInfo.width - resist;
      } else {
        x = dockState.side === 'left' ? wa.x : wa.x + wa.width - dragInfo.width;
      }
    } else {
      // Magnet: pull flush onto the left/right edge when close
      if (Math.abs(x - wa.x) <= SNAP_DIST) x = wa.x;
      else if (Math.abs(x + dragInfo.width - (wa.x + wa.width)) <= SNAP_DIST) x = wa.x + wa.width - dragInfo.width;
    }

    // Keep the title bar on screen vertically
    y = Math.min(Math.max(y, wa.y), wa.y + wa.height - Math.min(dragInfo.height, 64));
    dragInfo.livePos = { x, y };
    if (!boundsAnim) {
      mainWindow.setBounds({ x, y, width: dragInfo.width, height: dragInfo.height });
    }
  }, 10);
});

ipcMain.on('window-drag-stop', () => {
  stopWindowDrag();
  if (!mainWindow || !dragInfo) return;
  const moved = dragInfo.moved;
  dragInfo = null;

  const b = mainWindow.getBounds();
  const wa = workAreaAt({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  const atLeft = b.x <= wa.x;
  const atRight = b.x + b.width >= wa.x + wa.width;

  if (dockState.docked) {
    if (!moved) return undock();                 // click on the mini tab → open
    if (atLeft || atRight) {                     // re-stuck (maybe the other edge)
      dockState.side = atLeft ? 'left' : 'right';
      sendDockState();
      const x = atLeft ? wa.x : wa.x + wa.width - miniWidth();
      animateBounds({ x, y: clampY(b.y, MINI_SIZE, wa), width: miniWidth(), height: MINI_SIZE }, { duration: 160 });
      return;
    }
    return undock({ keepPosition: true });       // pulled off the edge → full HUD where dropped
  }

  if (moved && (atLeft || atRight)) dockToEdge(atLeft ? 'left' : 'right');
});

ipcMain.on('undock-window', () => undock());

// ---------------------------------------------------------------
// MSN-style "nudge" when a session finishes (running → idle).
// Silent: the window shakes and the HUD glows — no sound.
// ---------------------------------------------------------------
const lastStatus = new Map(); // session id -> 'running' | 'idle'

function detectFinishedSessions(sessions) {
  const finished = [];
  for (const s of sessions) {
    const prev = lastStatus.get(s.id);
    lastStatus.set(s.id, s.status);
    // Ignore sessions that only went idle because of the no-activity timeout
    if (prev === 'running' && s.status === 'idle' && !s.stale) finished.push(s);
  }
  if (finished.length) nudge(finished);
}

// Window shake animation, "Test Nudge" and multi-monitor quick snip live in
// main/ipc/snap.js. Only the finished-session detection stays here.
const snap = require('./main/ipc/snap');
const nudge = (finished) => snap.nudge(appCtx, finished);


app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
