// Git worktrees for Chat Tree children that edit files (main/chat-tree.js).
// A writing child works in its own worktree on its own branch, so two chats never edit the same files at once:
//   create  → ~/.ovly-claude/worktrees/<repo>-<label>, branch ovly-tree/<label>, made from HEAD
//   commit  → when the child finishes, its changes are committed on that branch (if it didn't itself)
//   merge   → into the parent's folder (git merge --no-ff); on a conflict the merge is undone and the files listed
//   remove  → the worktree folder goes; the branch is kept unless it was merged (so no work is lost)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCmd } = require('./proc');

const WT_ROOT = path.join(os.homedir(), '.ovly-claude', 'worktrees');
const git = (cwd, args, timeout = 60000) => runCmd('git', ['-c', 'core.quotepath=false', ...args], { cwd, timeout });
const lines = (s) => String(s || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

// Cheap, synchronous: is this folder inside a git work tree? (walks up looking for .git)
function inRepo(dir) {
  try {
    let d = path.resolve(String(dir || ''));
    for (let i = 0; i < 40 && d; i++) {
      if (fs.existsSync(path.join(d, '.git'))) return true;
      const up = path.dirname(d);
      if (up === d) break;
      d = up;
    }
  } catch (_) {}
  return false;
}

async function repoTop(cwd) {
  const r = await git(cwd, ['rev-parse', '--show-toplevel']);
  return r.ok ? path.resolve(r.out.trim()) : '';
}

async function createWorktree(cwd, label, root = WT_ROOT) {
  const top = await repoTop(cwd);
  if (!top) return { ok: false, why: 'not a git repository' };
  const head = await git(top, ['rev-parse', 'HEAD']);
  if (!head.ok) return { ok: false, why: 'the repository has no commits yet' };
  const safe = String(label).replace(/[^\w.-]+/g, '-').slice(0, 40);
  const branch = `ovly-tree/${safe}`;
  const dir = path.join(root, `${path.basename(top)}-${safe}`);
  fs.mkdirSync(root, { recursive: true });
  const r = await git(top, ['worktree', 'add', '-b', branch, dir, 'HEAD']);
  if (!r.ok) return { ok: false, why: (r.err || 'git worktree add failed').split('\n')[0] };
  // keep the same sub-folder the parent works in
  const rel = path.relative(top, path.resolve(cwd));
  const childCwd = rel && !rel.startsWith('..') ? path.join(dir, rel) : dir;
  return { ok: true, dir, cwd: childCwd, branch, base: head.out.trim(), top };
}

// Commit whatever the child left uncommitted. Uses a fallback identity only if git has none.
async function commitAll(dir, message) {
  const st = await git(dir, ['status', '--porcelain']);
  if (!st.ok || !st.out.trim()) return { committed: false };
  await git(dir, ['add', '-A']);
  const who = (await git(dir, ['config', 'user.email'])).out.trim() ? [] : ['-c', 'user.name=Ovly Chat Tree', '-c', 'user.email=chat-tree@ovly.local'];
  const r = await runCmd('git', [...who, 'commit', '-m', message], { cwd: dir, timeout: 60000 });
  return { committed: r.ok, why: r.ok ? '' : r.err.split('\n')[0] };
}

// What the branch adds on top of where it started: commits, files, +/−.
async function summary(dir, base, branch) {
  const count = Number((await git(dir, ['rev-list', '--count', `${base}..${branch}`])).out.trim()) || 0;
  const files = lines((await git(dir, ['diff', '--name-only', `${base}...${branch}`])).out);
  const stat = (await git(dir, ['diff', '--shortstat', `${base}...${branch}`])).out.trim();
  return { commits: count, files, stat };
}

// Merge the child's branch into the folder the parent works in.
async function merge(targetCwd, branch, message) {
  const r = await git(targetCwd, ['merge', '--no-ff', '--no-edit', '-m', message, branch], 120000);
  if (r.ok) return { ok: true };
  const conflicts = lines((await git(targetCwd, ['diff', '--name-only', '--diff-filter=U'])).out);
  if (conflicts.length) {
    await git(targetCwd, ['merge', '--abort']);
    return { ok: false, conflicts, why: `conflicts in ${conflicts.join(', ')} — the merge was undone` };
  }
  return { ok: false, conflicts: [], why: (r.err || r.out || 'git merge failed').split('\n').find((l) => l.trim()) || 'git merge failed' };
}

async function removeWorktree(top, dir, branch, deleteBranch) {
  if (dir) await git(top, ['worktree', 'remove', '--force', dir]);
  if (dir && fs.existsSync(dir)) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} await git(top, ['worktree', 'prune']); }
  if (deleteBranch && branch) await git(top, ['branch', '-D', branch]);
}

module.exports = { WT_ROOT, inRepo, repoTop, createWorktree, commitAll, summary, merge, removeWorktree };
