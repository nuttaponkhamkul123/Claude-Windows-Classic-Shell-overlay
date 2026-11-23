// Git for the chat header's git box and the Changes panel: branch info, changed files and diffs
// (read-only), and the actions: commit, push, discard (with a backup and Undo), draft a commit message.
// Everything that changes anything is limited to files that really show up in gitChanges().
// features-main.js creates it with what it needs from there: createGit({ storeDir, setSetting, findClaudeBinary }).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { runCmd, stripNotice } = require('./proc');

module.exports = function createGit({ storeDir, setSetting, findClaudeBinary }) {
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

// Changed files for the git diff panel: every file that differs from HEAD
// (staged or not) plus untracked files, with +/− line counts. Read-only.
function gitBig(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, '-c', 'core.quotepath=false', ...args],
      { windowsHide: true, timeout: 8000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => resolve(err ? null : String(stdout)));
  });
}
const MAX_TEXT = 512 * 1024; // untracked files bigger than this aren't shown inline
const COUNT_MAX = 300;       // untracked files whose lines are counted for the list
async function gitChanges(cwd) {
  if (!cwd || typeof cwd !== 'string' || !path.isAbsolute(cwd) || !fs.existsSync(cwd)) return null;
  let counted = 0;
  const top = (await git(cwd, ['rev-parse', '--show-toplevel']))?.replace(/\//g, path.sep);
  if (!top) return null;
  const hasHead = !!(await git(top, ['rev-parse', '--verify', '--quiet', 'HEAD']));
  const [status, numstat] = await Promise.all([
    gitBig(top, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    gitBig(top, hasHead ? ['diff', 'HEAD', '--numstat', '-z', '-M'] : ['diff', '--cached', '--numstat', '-z']),
  ]);
  // numstat -z: "added\tremoved\tpath\0", renames: "added\tremoved\t\0old\0new\0"
  const counts = new Map();
  const ns = (numstat || '').split('\0');
  for (let i = 0; i < ns.length; i++) {
    const m = ns[i].match(/^(-|\d+)\t(-|\d+)\t(.*)$/s);
    if (!m) continue;
    let p = m[3];
    if (!p) { i += 2; p = ns[i]; } // rename: take the new path
    counts.set(p, { added: m[1] === '-' ? null : +m[1], removed: m[2] === '-' ? null : +m[2], binary: m[1] === '-' });
  }
  const files = [];
  const st = (status || '').split('\0');
  for (let i = 0; i < st.length; i++) {
    const e = st[i];
    if (!e || e.length < 4) continue;
    const x = e[0], y = e[1], p = e.slice(3);
    let from = '';
    if (x === 'R' || x === 'C') from = st[++i] || '';
    const kind = x === '?' ? 'untracked' : (x === 'D' || y === 'D') ? 'deleted'
      : (x === 'A') ? 'added' : (x === 'R') ? 'renamed' : 'modified';
    const c = counts.get(p) || {};
    let added = c.added ?? 0, removed = c.removed ?? 0, binary = !!c.binary, large = false, uncounted = false;
    if (kind === 'untracked') {
      // Untracked files have no git numbers, so their lines are counted here — but only for the first
      // COUNT_MAX of them, and without blocking the app (a project with no .gitignore can have thousands).
      // The rest show as "new"; opening one still shows its content.
      try {
        const full = path.join(top, p);
        const size = (await fs.promises.stat(full)).size;
        large = size > MAX_TEXT;
        if (!large) {
          if (counted < COUNT_MAX) {
            counted++;
            const buf = await fs.promises.readFile(full);
            if (buf.includes(0)) binary = true;
            else added = buf.toString('utf8').split(/\r?\n/).length - (buf.length && buf[buf.length - 1] === 10 ? 1 : 0);
          } else uncounted = true;
        }
      } catch (_) {}
    }
    files.push({ path: p, from, kind, staged: x !== ' ' && x !== '?', added, removed, binary, large, uncounted });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const info = { top, files };
  changesCache.set(cwd, { at: Date.now(), info });
  return info;
}
// The file list changes rarely compared with how fast you click through files, so opening a file's diff
// reuses a recent list instead of scanning the whole working tree again for every click.
const changesCache = new Map(); // cwd -> { at, info }
async function recentChanges(cwd, maxAgeMs) {
  const c = changesCache.get(cwd);
  return c && Date.now() - c.at < maxAgeMs ? c.info : gitChanges(cwd);
}
// Unified diff of one file vs HEAD (untracked: the whole file as added lines)
async function gitFileDiff(cwd, rel) {
  if (typeof rel !== 'string') return { error: 'Not a git repository' };
  let info = await recentChanges(cwd, 20000);
  let f = info && info.files.find((x) => x.path === rel);
  if (info && !f) { // not in the recent list: it may be new since then
    info = await gitChanges(cwd);
    f = info && info.files.find((x) => x.path === rel);
  }
  if (!info) return { error: 'Not a git repository' };
  if (!f) return { error: 'This file has no changes any more' };
  const full = path.resolve(info.top, rel);
  if (!full.toLowerCase().startsWith(info.top.toLowerCase() + path.sep)) return { error: 'Bad path' };
  if (f.binary) return { binary: true };
  if (f.kind === 'untracked') {
    try {
      if ((await fs.promises.stat(full)).size > MAX_TEXT) return { error: 'File is too big to show here' };
      const buf = await fs.promises.readFile(full);
      if (buf.includes(0)) return { binary: true }; // (uncounted files were never checked for this)
      return { lines: buf.toString('utf8').replace(/\r?\n$/, '').split(/\r?\n/).map((t) => '+' + t), untracked: true };
    } catch (err) { return { error: err.message }; }
  }
  const hasHead = !!(await git(info.top, ['rev-parse', '--verify', '--quiet', 'HEAD']));
  const args = hasHead ? ['diff', 'HEAD', '-M', '-U3', '--no-color', '--'] : ['diff', '--cached', '-U3', '--no-color', '--'];
  if (f.from) args.push(f.from);
  args.push(rel);
  const out = await gitBig(info.top, args);
  if (out == null) return { error: 'git diff failed' };
  if (/^Binary files /m.test(out)) return { binary: true };
  const lines = out.replace(/\r/g, '').split('\n');
  const start = lines.findIndex((l) => l.startsWith('@@'));
  return { lines: start < 0 ? [] : lines.slice(start).filter((l, i, a) => i < a.length - 1 || l) };
}

// ---------------------------------------------------------------------------
// Git actions from the changes panel: commit, push, discard (undoable), draft a message.
// Everything is limited to files that really show up in gitChanges().
// ---------------------------------------------------------------------------
const gitRun = (top, args, opts) => runCmd('git', ['-C', top, '-c', 'core.quotepath=false', ...args], opts);
const nulList = (paths) => paths.join('\0') + '\0';
const PATHSPEC = ['--pathspec-from-file=-', '--pathspec-file-nul'];

// The requested files, checked against what really has changes (renames bring their old name along)
async function pickChanged(cwd, rels) {
  const info = await gitChanges(cwd);
  if (!info) return { error: 'Not a git repository' };
  if (!Array.isArray(rels) || !rels.length) return { error: 'No files selected' };
  const want = new Set(rels.filter((r) => typeof r === 'string'));
  const files = info.files.filter((f) => want.has(f.path));
  if (!files.length) return { error: 'Those files have no changes any more' };
  const root = info.top.toLowerCase() + path.sep;
  for (const f of files) {
    if (!path.resolve(info.top, f.path).toLowerCase().startsWith(root)) return { error: 'Bad path' };
  }
  return { top: info.top, files, paths: [...new Set(files.flatMap((f) => [f.path, f.from].filter(Boolean)))] };
}

async function gitCommit(cwd, rels, message) {
  const msg = typeof message === 'string' ? message.trim() : '';
  if (!msg) return { error: 'Write a commit message first' };
  const sel = await pickChanged(cwd, rels);
  if (sel.error) return sel;
  const add = await gitRun(sel.top, ['add', '-A', ...PATHSPEC], { input: nulList(sel.paths) });
  if (!add.ok) return { error: add.err || 'git add failed' };
  // message through a file: no quoting problems with newlines or quotes
  const msgFile = path.join(os.tmpdir(), `ovly-commit-${Date.now().toString(36)}.txt`);
  try {
    fs.writeFileSync(msgFile, msg + '\n');
    // --only: commit exactly these files, whatever else happens to be staged
    const com = await gitRun(sel.top, ['commit', '--only', '-F', msgFile, ...PATHSPEC], { input: nulList(sel.paths), timeout: 120000 });
    if (!com.ok) return { error: (com.err || com.out || 'git commit failed').slice(-1500) };
  } finally { fs.unlink(msgFile, () => {}); }
  gitCache.clear(); changesCache.clear();
  return { ok: true, sha: (await git(sel.top, ['rev-parse', '--short', 'HEAD'])) || '', count: sel.files.length };
}

// Push the current branch. `account` (optional): a GitHub account known to `gh` — switched to for
// the push, then switched back (for machines with two accounts). Remembered for next time.
async function gitPush(cwd, account) {
  const top = (await git(cwd, ['rev-parse', '--show-toplevel']))?.replace(/\//g, path.sep);
  if (!top) return { error: 'Not a git repository' };
  let acct = '';
  if (typeof account === 'string') {
    acct = account.trim();
    if (acct && !/^[\w-]{1,39}$/.test(acct)) return { error: 'That is not a valid GitHub user name' };
    setSetting('gitPushAccount', acct);
  }
  const hasUpstream = !!(await git(top, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']));
  const push = hasUpstream ? ['push'] : ['push', '-u', 'origin', 'HEAD'];
  let back = '';
  if (acct) {
    const prev = (await runCmd('gh', ['api', 'user', '--jq', '.login'])).out.trim();
    if (prev.toLowerCase() !== acct.toLowerCase()) {
      const sw = await runCmd('gh', ['auth', 'switch', '-u', acct]);
      if (!sw.ok) return { error: `Could not switch to the GitHub account "${acct}": ${sw.err || 'is gh installed?'}` };
      back = prev;
    }
  }
  try {
    const r = await gitRun(top, acct ? ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', ...push] : push, { timeout: 120000 });
    gitCache.clear(); changesCache.clear();
    return r.ok ? { ok: true, text: (r.err || r.out).slice(-500) } : { error: (r.err || r.out || 'git push failed').slice(-1500) };
  } finally {
    if (back) await runCmd('gh', ['auth', 'switch', '-u', back]);
  }
}

// Discard = go back to HEAD for those files. Tracked changes are saved as a patch and
// untracked/new files are copied, BEFORE anything is touched, so it can be undone.
const BACKUPS = path.join(storeDir, 'discarded');
async function gitDiscard(cwd, rels) {
  const sel = await pickChanged(cwd, rels);
  if (sel.error) return sel;
  if (!(await git(sel.top, ['rev-parse', '--verify', '--quiet', 'HEAD']))) return { error: 'Nothing is committed yet, so there is nothing to go back to' };
  const toRestore = [], toRemove = [], toSave = [];
  for (const f of sel.files) {
    if (f.kind === 'untracked') toRemove.push(f.path);
    else if (f.kind === 'added') { toRemove.push(f.path); toSave.push(f.path); }
    else if (f.kind === 'renamed') { toRemove.push(f.path); toRestore.push(f.from); toSave.push(f.path, f.from); }
    else { toRestore.push(f.path); toSave.push(f.path); }
  }
  const id = Date.now().toString(36);
  const dir = path.join(BACKUPS, id);
  // A staged file may have no worktree copy (stage it, then delete it). `git diff HEAD` only
  // compares HEAD with the worktree, so it cannot see that content — put a temporary copy back
  // before making the patch, otherwise Undo would have nothing to restore.
  const stagedOnly = [];
  for (const f of sel.files) {
    if (f.kind === 'untracked' || fs.existsSync(path.join(sel.top, f.path))) continue;
    // Only staged content needs rescuing. A plain worktree deletion of an unmodified tracked
    // file must stay a deletion in the patch, so don't put HEAD's copy back for it.
    const staged = await gitRun(sel.top, ['diff', '--cached', '--name-only', '--', f.path]);
    if (staged.ok && staged.out.trim()) stagedOnly.push(f);
  }
  const scratch = stagedOnly.length ? fs.mkdtempSync(path.join(os.tmpdir(), 'ovly-staged-')) : '';
  const materialized = [];
  try {
    fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
    if (stagedOnly.length) {
      const prefix = scratch.replace(/\\/g, '/') + '/';
      for (const f of stagedOnly) {
        const r = await gitRun(sel.top, ['checkout-index', '-f', '--prefix=' + prefix, '--', f.path]);
        if (!r.ok) continue;
        const src = path.join(scratch, f.path);
        if (!fs.existsSync(src)) continue;
        const dest = path.join(sel.top, f.path);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        materialized.push(dest);
      }
    }
    if (toSave.length) {
      const d = await gitRun(sel.top, ['diff', 'HEAD', '--binary', '-M', '--no-color', '--', ...toSave], { timeout: 60000 });
      if (!d.ok) throw new Error(d.err || 'could not save a backup patch');
      fs.writeFileSync(path.join(dir, 'changes.patch'), d.out);
    }
    for (const rel of sel.files.filter((f) => f.kind === 'untracked').map((f) => f.path)) {
      const dest = path.join(dir, 'files', rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(sel.top, rel), dest);
    }
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ top: sel.top, at: Date.now(), count: sel.files.length }));
  } catch (err) {
    materialized.forEach((p) => fs.rmSync(p, { force: true }));
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
    return { error: `Backup failed, nothing was changed: ${err.message}` };
  }
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  if (toRestore.length) {
    const r = await gitRun(sel.top, ['restore', '--source=HEAD', '--staged', '--worktree', ...PATHSPEC], { input: nulList(toRestore) });
    if (!r.ok) return { error: r.err || 'git restore failed', backup: id };
  }
  if (toRemove.length) {
    await gitRun(sel.top, ['rm', '-f', '--cached', '--ignore-unmatch', '-q', ...PATHSPEC], { input: nulList(toRemove) });
    for (const rel of toRemove) fs.rmSync(path.join(sel.top, rel), { force: true });
  }
  gitCache.clear(); changesCache.clear();
  return { ok: true, backup: id, count: sel.files.length };
}
async function gitUndoDiscard(cwd, id) {
  if (typeof id !== 'string' || !/^[a-z0-9]{4,12}$/.test(id)) return { error: 'Bad backup id' };
  const dir = path.join(BACKUPS, id);
  let meta;
  try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); } catch (_) { return { error: 'That backup is gone' }; }
  const top = (await git(cwd, ['rev-parse', '--show-toplevel']))?.replace(/\//g, path.sep);
  if (!top || top.toLowerCase() !== String(meta.top).toLowerCase()) return { error: 'That backup belongs to another folder' };
  const walk = (d, rel = '') => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name), rel + e.name + '/') : [rel + e.name]);
  const filesDir = path.join(dir, 'files');
  const savedFiles = fs.existsSync(filesDir) ? walk(filesDir) : [];
  // Never throw away a backup because a file was recreated in the meantime. Check before
  // touching anything, so a failed undo can simply be retried once the path is free.
  const blocked = savedFiles.filter((rel) => {
    const dest = path.resolve(top, rel);
    return dest.toLowerCase().startsWith(path.resolve(top).toLowerCase() + path.sep) && fs.existsSync(dest);
  });
  if (blocked.length) {
    return { error: `${blocked.length} file${blocked.length === 1 ? '' : 's'} already in the folder (${blocked.slice(0, 3).join(', ')}). Remove them and undo again. Backup: ${dir}`, blocked };
  }
  const patch = path.join(dir, 'changes.patch');
  if (fs.existsSync(patch)) {
    const r = await gitRun(top, ['apply', '--binary', '--whitespace=nowarn', '-'], { input: fs.readFileSync(patch) });
    if (!r.ok) return { error: `Could not put the changes back: ${r.err}. Your backup is in ${dir}` };
  }
  for (const rel of savedFiles) {
    const dest = path.join(top, rel);
    if (!path.resolve(dest).toLowerCase().startsWith(path.resolve(top).toLowerCase() + path.sep)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(filesDir, rel), dest);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  gitCache.clear(); changesCache.clear();
  return { ok: true, count: meta.count };
}
// keep the backup folder small: drop anything older than a week
try {
  for (const d of fs.readdirSync(BACKUPS)) {
    const p = path.join(BACKUPS, d);
    if (Date.now() - fs.statSync(p).mtimeMs > 7 * 86400000) fs.rmSync(p, { recursive: true, force: true });
  }
} catch (_) { /* no backups yet */ }

// A commit message drafted by Claude (Haiku: cheap), from the selected files' diff.
// --no-session-persistence keeps it out of the chat list; --tools "" = no tool use; run from the temp folder so the
// project's CLAUDE.md and saved memory are not loaded into a note that should only use what it is given.
async function gitDraftMessage(cwd, rels) {
  const sel = await pickChanged(cwd, rels);
  if (sel.error) return sel;
  const bin = findClaudeBinary();
  if (!bin || !fs.existsSync(bin)) return { error: 'Claude Code was not found on this PC' };
  const hasHead = !!(await git(sel.top, ['rev-parse', '--verify', '--quiet', 'HEAD']));
  const tracked = sel.files.filter((f) => f.kind !== 'untracked').flatMap((f) => [f.path, f.from].filter(Boolean));
  const diffArgs = hasHead ? ['diff', 'HEAD'] : ['diff', '--cached'];
  const stat = tracked.length ? await gitBig(sel.top, [...diffArgs, '--stat', '-M', '--', ...tracked]) : '';
  let diff = tracked.length ? (await gitBig(sel.top, [...diffArgs, '-U2', '--no-color', '-M', '--', ...tracked])) || '' : '';
  const fresh = [];
  for (const f of sel.files.filter((x) => x.kind === 'untracked' && !x.binary && !x.large)) {
    try { fresh.push(`New file ${f.path}:\n` + fs.readFileSync(path.join(sel.top, f.path), 'utf8').split('\n').slice(0, 60).join('\n')); } catch (_) {}
  }
  const recent = (await git(sel.top, ['log', '-n', '8', '--pretty=%s'])) || '';
  let body = [stat, diff, ...fresh].filter(Boolean).join('\n\n');
  if (body.length > 40000) body = body.slice(0, 40000) + '\n… (cut)';
  const prompt =
    'Write a git commit message for the changes below.\n' +
    'Format: a subject line of at most 72 characters in the imperative mood, then a blank line, then 2–5 short bullet points ' +
    'saying what changed and why (skip the bullets if the change is tiny). Match the style of the recent commits.\n' +
    'Reply with the commit message only: no quotes, no code fences, no commentary.\n\n' +
    (recent ? `Recent commit subjects:\n${recent}\n\n` : '') + 'Changes:\n' + body;
  const r = await runCmd(bin, ['-p', '--model', 'haiku', '--no-session-persistence', '--tools', '', '--system-prompt', 'You write short, accurate developer notes from the text you are given. Use nothing but that text.'], { cwd: os.tmpdir(), input: prompt, timeout: 90000 });
  if (!r.ok || !r.out.trim()) return { error: (r.err || 'Claude gave no answer').slice(-300) };
  return { message: stripNotice(r.out.trim()).replace(/^```[a-z]*\n?|\n?```$/g, '').trim() };
}

  return { gitInfo, gitChanges, gitFileDiff, gitCommit, gitPush, gitDiscard, gitUndoDiscard, gitDraftMessage };
};
