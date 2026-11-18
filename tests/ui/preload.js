const cbs = {};
const settings = { uiStyle: 'work', listView: 'grid' };
const listSlashCommands = async () => [
  { name: 'code-review', kind: 'skill', scope: 'user', description: 'Review the current diff for correctness bugs' },
  { name: 'simplify', kind: 'skill', scope: 'project', description: 'Review changed code for reuse and simplification' },
  { name: 'deploy', kind: 'command', scope: 'project', description: 'Build and deploy to staging' },
];
const gitInfo = async () => ({ branch: 'master', ahead: 2, behind: 0, changed: 7, untracked: 1, upstream: 'origin/master', userName: 'dev' });
const getSessionHistory = async () => [
  { role: 'user', text: 'fix the login bug', ts: Date.now() - 120000 },
  { role: 'assistant', text: 'Fixed — the token check compared the wrong field.', ts: Date.now() - 60000,
    edits: [{ path: 'C:/work/ovly-claude/src/auth.js', added: 12, removed: 3 }, { path: 'C:/work/ovly-claude/test/auth.test.js', added: 20, removed: 0 }] },
];
const rulesList = async () => [];
const getSessionCosts = async (ids) => Object.fromEntries(ids.map((i) => [i, 0.84]));
const getUsage = async () => { window.__plan = (window.__plan || 0) + 1; return { claude: { today: { tokens: 1200000 } } }; }; // counts calls to the heavy, network-using one
const getUsageToday = async () => { window.__todayCalls = (window.__todayCalls || 0) + 1; return { tokens: 1200000 }; };
const fm = require('../../features-main.js');
const REPO = require('path').resolve(__dirname, '../..').split(require('path').sep).join('/');
const gitChanges = () => fm.gitChanges(REPO);
const gitFileDiff = (_cwd, rel) => fm.gitFileDiff(REPO, rel);
// git actions are STUBBED (the real repo must never be touched by a UI test)
const calls = (window.__calls = []);
const rec = (name, reply) => async (...a) => { calls.push([name, ...a]); return typeof reply === 'function' ? reply(...a) : reply; };
const gitCommit = rec('commit', (cwd, files) => ({ ok: true, sha: 'abc1234', count: files.length }));
const gitPush = rec('push', { ok: true, text: '' });
const gitDiscard = rec('discard', (cwd, files) => ({ ok: true, backup: 'bk1', count: files.length }));
const gitUndoDiscard = rec('undo', { ok: true, count: 1 });
const gitDraftMessage = rec('draft', { message: 'Add things\n\n- one\n- two' });
const storeGetAll = async () => ({ gitPushAccount: 'acme-dev' });
// handoff note: window.__hoMode = 'ok' (default) | 'err' | 'slow'
const handoffNote = async (id) => {
  calls.push(['handoff', id]);
  const mode = window.__hoMode || 'ok';
  await new Promise((r) => setTimeout(r, mode === 'slow' ? 1500 : 400));
  return mode === 'err' ? { error: 'Claude gave no answer' } : { note: '## Goal\nFix the login bug.\n\n## Next steps\n1. Add tests.' };
};
const api = new Proxy({ settings, listSlashCommands, gitInfo, getSessionHistory, rulesList, getSessionCosts, getUsage, getUsageToday, gitChanges, gitFileDiff,
  gitCommit, gitPush, gitDiscard, gitUndoDiscard, gitDraftMessage, handoffNote, storeGetAll }, {
  get(t, k) {
    if (k in t) return t[k];
    // like ipcRenderer.on: every listener is kept and called
    if (typeof k === 'string' && /^on[A-Z]/.test(k)) return (cb) => {
      const list = (cbs['_' + k] = cbs['_' + k] || []);
      list.push(cb);
      cbs[k] = (...a) => list.forEach((f) => f(...a));
    };
    return () => Promise.resolve(undefined);
  }
});
window.electronAPI = api;
window.__cbs = cbs;
