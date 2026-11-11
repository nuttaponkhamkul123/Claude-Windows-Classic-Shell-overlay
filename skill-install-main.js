'use strict';
// Skill installer (main process).
//   source  →  scan (download / unpack to a temp folder, find SKILL.md folders)
//           →  preview in the HUD (name, description, scripts it contains)
//           →  install into ~/.claude/skills (all projects) or <folder>/.claude/skills.
// Sources: a GitHub / GitLab repo (owner/repo, or a https URL, optionally /tree/<branch>/<subfolder>),
// a folder on this PC, or a .zip file. Nothing is installed until the user confirms.
const { ipcMain, dialog } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const MAX_FILES = 400;
const MAX_BYTES = 8 * 1024 * 1024;
const SCAN_DEPTH = 4;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.github']);
const SCRIPT_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.py', '.sh', '.bash', '.ps1', '.bat', '.cmd', '.vbs', '.exe', '.dll']);
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const scans = new Map(); // token -> { tmp, found: [{ name, dir }], at }

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 90000, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, ...opts }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message || '').toString().trim().split('\n').slice(-2).join(' ') || 'failed'));
      else resolve(stdout);
    });
  });
}

function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {} }
function newTmp() {
  const d = path.join(os.tmpdir(), 'ovly-skill-' + crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function sweep() {
  const old = Date.now() - 30 * 60 * 1000;
  for (const [t, s] of scans) if (s.at < old) { rmrf(s.tmp); scans.delete(t); }
}

// "owner/repo", "https://github.com/o/r", ".../o/r.git", ".../o/r/tree/<branch>/<sub/folder>"
function parseRepo(src) {
  let s = String(src || '').trim();
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) s = 'https://github.com/' + s;
  const m = /^https:\/\/(github\.com|gitlab\.com)\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.+?))?)?\/?$/.exec(s);
  if (!m) return null;
  const sub = (m[5] || '').split('/').filter((p) => p && p !== '..' && p !== '.').join('/');
  return { url: `https://${m[1]}/${m[2]}/${m[3]}.git`, branch: m[4] || '', sub, repo: m[3] };
}

function readFrontmatter(file) {
  try {
    const head = fs.readFileSync(file, 'utf8').slice(0, 6000);
    const fm = head.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
    const get = (k) => {
      if (!fm) return '';
      const r = fm[1].match(new RegExp('^' + k + ':\\s*(.+)$', 'm'));
      return r ? r[1].trim().replace(/^["']|["']$/g, '') : '';
    };
    let description = get('description');
    if (!description) {
      const first = head.replace(/^---[\s\S]*?\n---\s*\r?\n/, '').split('\n').find((l) => l.trim());
      description = (first || '').replace(/^#+\s*/, '').trim().slice(0, 160);
    }
    return { name: get('name'), description };
  } catch (_) { return { name: '', description: '' }; }
}

// every folder holding a SKILL.md (a repo may carry several skills)
function findSkillDirs(root) {
  const out = [];
  const walk = (dir, depth) => {
    if (fs.existsSync(path.join(dir, 'SKILL.md'))) { out.push(dir); return; } // skills don't nest
    if (depth >= SCAN_DEPTH) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      if (e.isSymbolicLink() || !e.isDirectory() || SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

// files of one skill folder: { count, bytes, scripts, unsafe }
function inspectSkill(dir) {
  const info = { count: 0, bytes: 0, scripts: [], unsafe: '' };
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      if (info.unsafe) return;
      if (e.name === '.git') continue;
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) { info.unsafe = 'contains a symbolic link'; return; }
      if (e.isDirectory()) { walk(p); continue; }
      info.count++;
      try { info.bytes += fs.statSync(p).size; } catch (_) {}
      if (SCRIPT_EXT.has(path.extname(e.name).toLowerCase())) info.scripts.push(path.relative(dir, p).replace(/\\/g, '/'));
      if (info.count > MAX_FILES) { info.unsafe = `more than ${MAX_FILES} files`; return; }
      if (info.bytes > MAX_BYTES) { info.unsafe = 'larger than 8 MB'; return; }
    }
  };
  walk(dir);
  return info;
}

const rootFor = (scope, cwd, target = 'claude') => {
  const isAg = target === 'antigravity';
  if (scope === 'project') {
    if (!cwd || !fs.existsSync(cwd)) return null;
    return isAg ? path.join(cwd, '.agents', 'skills') : path.join(cwd, '.claude', 'skills');
  }
  return isAg
    ? path.join(os.homedir(), '.gemini', 'config', 'skills')
    : path.join(os.homedir(), '.claude', 'skills');
};

const rootsForTarget = (scope, cwd, target = 'both') => {
  const sc = scope === 'project' ? 'project' : 'user';
  if (target === 'claude') return [rootFor(sc, cwd, 'claude')].filter(Boolean);
  if (target === 'antigravity') return [rootFor(sc, cwd, 'antigravity')].filter(Boolean);
  return [rootFor(sc, cwd, 'claude'), rootFor(sc, cwd, 'antigravity')].filter(Boolean);
};

function register({ getWin }) {
  ipcMain.handle('skill-install:pick', async (_e, { kind } = {}) => {
    const win = getWin && getWin();
    const res = await dialog.showOpenDialog(win || undefined, kind === 'zip'
      ? { title: 'Choose a skill .zip', properties: ['openFile'], filters: [{ name: 'Zip archive', extensions: ['zip'] }] }
      : { title: 'Choose a skill folder (or a folder of skills)', properties: ['openDirectory'] });
    return res.canceled ? '' : (res.filePaths[0] || '');
  });

  ipcMain.handle('skill-install:scan', async (_e, { source } = {}) => {
    sweep();
    const src = String(source || '').trim();
    if (!src) return { ok: false, error: 'Enter a GitHub address, or choose a folder or .zip.' };
    const tmp = newTmp();
    let root = tmp;
    try {
      const repo = parseRepo(src);
      if (repo) {
        const dest = path.join(tmp, 'repo');
        const args = ['clone', '--depth', '1', '--single-branch', '--no-tags'];
        if (repo.branch) args.push('--branch', repo.branch);
        args.push(repo.url, dest);
        await run('git', args);
        root = repo.sub ? path.join(dest, repo.sub) : dest;
        if (!path.resolve(root).startsWith(path.resolve(dest))) throw new Error('Invalid folder in the address.');
      } else if (/^[a-z]+:\/\//i.test(src)) {
        throw new Error('Only github.com and gitlab.com https addresses are supported. You can also download a .zip and choose it.');
      } else if (/\.zip$/i.test(src) && fs.existsSync(src) && fs.statSync(src).isFile()) {
        const dest = path.join(tmp, 'zip');
        fs.mkdirSync(dest);
        // Windows 10+ ships bsdtar (reads .zip). Use it by full path: a GNU tar earlier in PATH
        // (e.g. from Git) reads "C:\x.zip" as host:file. A bare file name + cwd avoids that too.
        const sysTar = path.join(process.env.SystemRoot || 'C:\Windows', 'System32', 'tar.exe');
        await run(fs.existsSync(sysTar) ? sysTar : 'tar', ['-xf', path.basename(src), '-C', dest], { cwd: path.dirname(src) });
        root = dest;
      } else if (fs.existsSync(src) && fs.statSync(src).isDirectory()) {
        const dest = path.join(tmp, 'folder');
        fs.cpSync(src, dest, { recursive: true, filter: (p) => !SKIP_DIRS.has(path.basename(p)) && !fs.lstatSync(p).isSymbolicLink() });
        root = dest;
      } else {
        throw new Error('Not a GitHub address, .zip file or folder that exists.');
      }
      if (!fs.existsSync(root)) throw new Error('That folder is not in the repository.');

      const found = [];
      for (const dir of findSkillDirs(root)) {
        const fm = readFrontmatter(path.join(dir, 'SKILL.md'));
        let name = fm.name || path.basename(dir);
        if (dir === root && !fm.name) name = (repo && repo.repo) || path.basename(src).replace(/\.zip$/i, '');
        const ins = inspectSkill(dir);
        found.push({ name, valid: NAME_RE.test(name), dir, description: fm.description, ...ins });
      }
      if (!found.length) throw new Error('No SKILL.md found there — this does not look like a skill.');
      const token = crypto.randomBytes(8).toString('hex');
      scans.set(token, { tmp, found, at: Date.now() });
      const claudeHome = rootFor('user', null, 'claude');
      const agHome = rootFor('user', null, 'antigravity');
      const exists = (n) =>
        fs.existsSync(path.join(claudeHome, n, 'SKILL.md')) ||
        fs.existsSync(path.join(agHome, n, 'SKILL.md'));
      return {
        ok: true, token,
        found: found.map((f) => ({
          name: f.name, description: f.description, files: f.count, kb: Math.max(1, Math.round(f.bytes / 1024)),
          scripts: f.scripts.slice(0, 8), moreScripts: Math.max(0, f.scripts.length - 8),
          problem: !f.valid ? 'invalid name' : f.unsafe, installedUser: f.valid && exists(f.name),
        })),
      };
    } catch (err) {
      rmrf(tmp);
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('skill-install:install', (_e, { token, names, scope, cwd, overwrite, target = 'both' } = {}) => {
    const scan = scans.get(token);
    if (!scan) return { ok: false, error: 'That scan expired — scan again.' };
    const bases = rootsForTarget(scope === 'project' ? 'project' : 'user', cwd, target);
    if (!bases.length) return { ok: false, error: 'Open a chat in a folder first to install for that folder.' };
    const installed = [], errors = [];
    for (const f of scan.found) {
      if (!Array.isArray(names) || !names.includes(f.name)) continue;
      if (!f.valid || f.unsafe) { errors.push(`${f.name}: ${f.unsafe || 'invalid name'}`); continue; }
      let okAny = false;
      for (const base of bases) {
        const dest = path.join(base, f.name);
        try {
          if (fs.existsSync(dest)) {
            if (!overwrite) { errors.push(`${f.name}: already installed in ${base}`); continue; }
            rmrf(dest);
          }
          fs.mkdirSync(base, { recursive: true });
          fs.cpSync(f.dir, dest, { recursive: true, filter: (p) => path.basename(p) !== '.git' && !fs.lstatSync(p).isSymbolicLink() });
          okAny = true;
        } catch (err) { errors.push(`${f.name}: ${err.message}`); }
      }
      if (okAny) installed.push(f.name);
    }
    if (!errors.length) { rmrf(scan.tmp); scans.delete(token); }
    return { ok: installed.length > 0, installed, errors, where: bases.join(' & ') };
  });

  ipcMain.handle('skill-install:cancel', (_e, { token } = {}) => {
    const s = scans.get(token);
    if (s) { rmrf(s.tmp); scans.delete(token); }
    return true;
  });

  ipcMain.handle('skill-install:list', (_e, { cwd } = {}) => {
    const out = [];
    for (const target of ['claude', 'antigravity']) {
      for (const scope of ['user', 'project']) {
        const base = rootFor(scope, cwd, target);
        if (!base) continue;
        let entries = [];
        try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch (_) { continue; }
        for (const e of entries) {
          const file = path.join(base, e.name, 'SKILL.md');
          if (e.isDirectory() && fs.existsSync(file)) {
            out.push({ name: e.name, scope, target, description: readFrontmatter(file).description });
          }
        }
      }
    }
    return out;
  });

  ipcMain.handle('skill-install:remove', (_e, { name, scope, cwd, target = 'claude' } = {}) => {
    if (!NAME_RE.test(String(name || ''))) return { ok: false, error: 'Invalid name.' };
    const base = rootFor(scope === 'project' ? 'project' : 'user', cwd, target);
    if (!base) return { ok: false, error: 'No folder.' };
    const dir = path.join(base, name);
    if (!path.resolve(dir).startsWith(path.resolve(base) + path.sep) || !fs.existsSync(path.join(dir, 'SKILL.md'))) return { ok: false, error: 'Skill not found.' };
    rmrf(dir);
    return { ok: !fs.existsSync(dir) };
  });
}

function cleanup() { for (const s of scans.values()) rmrf(s.tmp); scans.clear(); }

module.exports = { register, cleanup, parseRepo, findSkillDirs, inspectSkill };
