// Run: node --test "tests/*.test.js"
// The git actions behind the Changes panel: commit only what was picked, discard with a way back,
// push. Runs against a throw-away repo and remote in the temp folder, with its OWN home folder so
// your real ~/.ovly-claude (settings, discard backups) is never touched.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ovly-gittest-'));
const home = path.join(root, 'home');
fs.mkdirSync(home);
// must be set BEFORE features-main is loaded: it reads os.homedir() at load time
process.env.USERPROFILE = home;
process.env.HOME = home;
Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
const fm = require('../features-main.js');

const repo = path.join(root, 'repo');
const remote = path.join(root, 'remote.git');
const g = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), text); };
const read = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8').split('\r\n').join('\n'); // (autocrlf on Windows)
const exists = (rel) => fs.existsSync(path.join(repo, rel));
const pending = async () => (await fm.gitChanges(repo)).files.map((f) => `${f.kind[0]}:${f.path}`).sort().join(' ');

test.before(() => {
  fs.mkdirSync(repo);
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  execFileSync('git', ['init', '-q', '--bare', remote]);
  put('a.txt', 'one\n'); put('d.txt', 'gone\n'); put('e.txt', 'rename me\nrename me\nrename me\n'); put('sub/s.txt', 'sub\n');
  g('add', '-A'); g('commit', '-q', '-m', 'init'); g('remote', 'add', 'origin', remote);
  // one of every kind of change
  put('a.txt', 'one\ntwo\n');                                   // modified
  fs.rmSync(path.join(repo, 'd.txt'));                          // deleted
  g('mv', 'e.txt', 'f.txt');                                    // renamed (staged)
  put('new staged.txt', 'staged new\n'); g('add', 'new staged.txt'); // added, with a space in the name
  put('u.txt', 'untracked\n');                                  // untracked
  put('sub/deep/x.txt', 'deep untracked\n');                    // untracked, in a new folder
});
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('the list shows every kind of change', async () => {
  assert.equal(await pending(), 'a:new staged.txt d:d.txt m:a.txt r:f.txt u:sub/deep/x.txt u:u.txt');
});

test('commit takes exactly the picked files, whatever else is staged', async () => {
  const r = await fm.gitCommit(repo, ['a.txt', 'new staged.txt'], 'Add two things\n\n- a\n- b "quoted"');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.count, 2);
  assert.deepEqual(g('show', '--name-only', '--pretty=%s', 'HEAD').split('\n').filter(Boolean).sort(), ['Add two things', 'a.txt', 'new staged.txt']);
  assert.match(g('log', '-1', '--pretty=%B'), /- b "quoted"/); // multi-line message and quotes survive
  const left = await pending();
  assert.ok(left.includes('u:u.txt') && left.includes('d:d.txt') && left.includes('r:f.txt'), left); // the rest is still pending
});

test('commit refuses an empty message and files that are not changed', async () => {
  assert.ok((await fm.gitCommit(repo, ['u.txt'], '   ')).error);
  assert.ok((await fm.gitCommit(repo, ['../outside.txt'], 'x')).error);
  assert.ok((await fm.gitCommit(repo, [], 'x')).error);
});

test('push sets the upstream on the first push and the remote gets the commit', async () => {
  const r = await fm.gitPush(repo);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(execFileSync('git', ['-C', remote, 'log', '-1', '--pretty=%s', 'main'], { encoding: 'utf8' }).trim(), 'Add two things');
});

test('push refuses a GitHub account name that is not a plain user name', async () => {
  assert.ok((await fm.gitPush(repo, 'bad name!')).error);
  assert.ok((await fm.gitPush(repo, 'a;b')).error);
});

test('discard goes back to HEAD for every kind of change, then undo puts it all back', async () => {
  put('a.txt', 'one\ntwo\nthree\n'); // edit again so there is something to lose
  const d = await fm.gitDiscard(repo, ['a.txt', 'd.txt', 'f.txt', 'u.txt', 'sub/deep/x.txt']);
  assert.equal(d.ok, true, JSON.stringify(d));
  assert.equal(d.count, 5);
  assert.equal(read('a.txt'), 'one\ntwo\n');                    // modified → back to HEAD
  assert.ok(exists('d.txt'));                                   // deleted → restored
  assert.ok(exists('e.txt') && !exists('f.txt'));               // rename undone
  assert.ok(!exists('u.txt') && !exists('sub/deep/x.txt'));     // untracked → removed
  assert.equal(await pending(), '');                            // nothing left to commit
  // the backup is in THIS test's home folder, never in the real one
  assert.ok(fs.existsSync(path.join(home, '.ovly-claude', 'discarded', d.backup, 'changes.patch')));
  assert.ok(fs.existsSync(path.join(home, '.ovly-claude', 'discarded', d.backup, 'files', 'u.txt')));

  const u = await fm.gitUndoDiscard(repo, d.backup);
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.equal(read('a.txt'), 'one\ntwo\nthree\n');
  assert.equal(read('u.txt'), 'untracked\n');
  assert.equal(read('sub/deep/x.txt'), 'deep untracked\n');
  assert.ok(exists('f.txt') && !exists('e.txt'));               // (comes back as delete + new file, not as a staged rename)
  assert.equal(await pending(), 'd:d.txt d:e.txt m:a.txt u:f.txt u:sub/deep/x.txt u:u.txt');
  assert.ok(!fs.existsSync(path.join(home, '.ovly-claude', 'discarded', d.backup))); // backup used up
  assert.ok((await fm.gitUndoDiscard(repo, d.backup)).error);   // and cannot be replayed
});

test('with many untracked files only the first ones are counted, the rest still open', async () => {
  const dir = path.join(root, 'many');
  fs.mkdirSync(dir);
  execFileSync('git', ['init', '-q', dir]);
  execFileSync('git', ['-C', dir, 'commit', '-q', '--allow-empty', '-m', 'init']);
  for (let i = 0; i < 350; i++) fs.writeFileSync(path.join(dir, `f${String(i).padStart(3, '0')}.txt`), 'a\nb\n');
  fs.writeFileSync(path.join(dir, 'zz-bin.dat'), Buffer.from([1, 2, 0, 3]));
  const info = await fm.gitChanges(dir);
  assert.equal(info.files.length, 351);
  assert.equal(info.files.filter((f) => f.kind === 'untracked' && !f.uncounted && !f.binary).length, 300);
  const late = info.files.find((f) => f.uncounted);
  assert.ok(late, 'some files are left uncounted');
  assert.deepEqual((await fm.gitFileDiff(dir, late.path)).lines, ['+a', '+b']);        // still opens
  assert.deepEqual(await fm.gitFileDiff(dir, 'zz-bin.dat'), { binary: true });          // binary found when opened
  fs.writeFileSync(path.join(dir, 'brand-new.txt'), 'hi\n');                           // created after the list was cached
  assert.deepEqual((await fm.gitFileDiff(dir, 'brand-new.txt')).lines, ['+hi']);
});
