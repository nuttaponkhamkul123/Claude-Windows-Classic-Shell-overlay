// The harness preload plus a fake transcript for the Steps panel and the steps search.
require('./preload.js');
const api = window.electronAPI;
const t = (s) => Date.UTC(2026, 10, 18, 9, 0, s);
const steps = [
  { n: 1, ts: t(2), turn: 0, tool: 'Read', kind: 'read', verb: 'Read', target: 'auth.js', detail: 'C:/w/src/auth.js', file: 'C:/w/src/auth.js', ok: true, ms: 1000, result: 'file text' },
  { n: 2, ts: t(4), turn: 0, tool: 'Edit', kind: 'edit', verb: 'Edited', target: 'auth.js', detail: 'C:/w/src/auth.js', file: 'C:/w/src/auth.js', ok: true, ms: 800, result: 'updated' },
  { n: 3, ts: t(6), turn: 0, tool: 'Bash', kind: 'run', verb: 'Ran', target: 'npm test -- --silent', detail: 'Run the tests\nnpm test -- --silent', file: '', ok: false, ms: 3000, result: 'FAIL auth.test.js\n1 failed' },
  { n: 4, ts: t(12), turn: 1, tool: 'Grep', kind: 'search', verb: 'Searched for', target: 'TODO', detail: 'TODO\nin C:/w', file: '', ok: true, ms: 120, result: 'a.js:1: TODO' },
  { n: 5, ts: t(14), turn: 1, tool: 'Bash', kind: 'run', verb: 'Ran', target: 'sleep 99', detail: 'sleep 99', file: '', ok: null, ms: null, result: '' },
];
const turns = [{ i: 0, ts: t(1), prompt: 'Fix the login bug' }, { i: 1, ts: t(11), prompt: 'Now the README' }];
window.__stepCalls = [];
api.getSteps = (id) => { window.__stepCalls.push(['getSteps', id]); return Promise.resolve({ steps, turns, total: steps.length }); };
api.searchSteps = (q) => {
  window.__stepCalls.push(['searchSteps', q]);
  return Promise.resolve(/npm test/i.test(q) ? [{ id: 'claude_s2', uuid: 's2', source: 'claude', cwd: 'C:/work/ovly-claude', project: 'ovly-claude', title: 'Flow', ts: t(6), n: 3, tool: 'Bash', kind: 'run', verb: 'Ran', target: 'npm test', ok: false, snippet: 'Ran npm test -- --silent' }] : []);
};
api.copyToClipboard = (x) => { window.__stepCalls.push(['copy', x]); };
api.openFile = (p) => { window.__stepCalls.push(['openFile', p]); return Promise.resolve(true); };
