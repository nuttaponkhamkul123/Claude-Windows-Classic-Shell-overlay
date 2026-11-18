// Run: node --test "tests/*.test.js"
// Steps: tool calls read out of a transcript (what, did it work, how long) and the search across chats.
// Uses its OWN home folder, so your real ~/.claude and ~/.ovly-claude are never touched.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ovly-steps-'));
process.env.USERPROFILE = home; // before features-main is loaded: it reads the home folder at load time
process.env.HOME = home;
const steps = require('../main/steps.js');
const fm = require('../features-main.js');

const T = (s) => new Date(Date.UTC(2026, 10, 18, 9, 0, s)).toISOString();
const line = (o) => JSON.stringify(o);
const user = (s, text) => line({ type: 'user', timestamp: T(s), message: { content: text } });
const use = (s, id, name, input) => line({ type: 'assistant', timestamp: T(s), message: { content: [{ type: 'tool_use', id, name, input }] } });
const res = (s, id, content, isError) => line({ type: 'user', timestamp: T(s), message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: !!isError }] } });

const transcript = [
  line({ type: 'user', cwd: 'C:/work/demo', timestamp: T(0), message: { content: 'start' }, isMeta: true }),
  user(1, 'Fix the login bug'),
  use(2, 'a', 'Read', { file_path: 'C:/work/demo/src/auth.js' }),
  res(3, 'a', 'file text'),
  use(4, 'b', 'Edit', { file_path: 'C:/work/demo/src/auth.js', old_string: 'x', new_string: 'y' }),
  res(5, 'b', 'ok'),
  use(6, 'c', 'Bash', { command: 'npm test -- --silent', description: 'Run the tests' }),
  res(9, 'c', [{ type: 'text', text: 'FAIL auth.test.js\n1 failed' }], true),
  user(10, '<system-reminder>ignore me</system-reminder>'),
  user(11, 'Now the README'),
  use(12, 'd', 'Grep', { pattern: 'TODO', path: 'C:/work/demo' }),
  res(13, 'd', 'a.js:1: TODO'),
].join('\n');

test('tool calls become steps in order, grouped under what you asked', () => {
  const r = steps.parseClaudeSteps(transcript.split('\n'));
  assert.equal(r.steps.length, 4);
  assert.deepEqual(r.turns.map((t) => t.prompt), ['Fix the login bug', 'Now the README']);
  assert.deepEqual(r.steps.map((s) => s.turn), [0, 0, 0, 1]);
  assert.deepEqual(r.steps.map((s) => s.kind), ['read', 'edit', 'run', 'search']);
  assert.equal(r.steps[0].verb + ' ' + r.steps[0].target, 'Read auth.js');
  assert.equal(r.steps[2].target, 'npm test -- --silent');
});

test('each step knows if it worked, how long it took and what it printed', () => {
  const r = steps.parseClaudeSteps(transcript.split('\n'));
  assert.equal(r.steps[0].ok, true);
  assert.equal(r.steps[0].ms, 1000);
  assert.equal(r.steps[2].ok, false);
  assert.equal(r.steps[2].ms, 3000);
  assert.match(r.steps[2].result, /1 failed/);
  assert.match(r.steps[2].detail, /Run the tests/);
});

test('a call with no result yet has ok = null', () => {
  const r = steps.parseClaudeSteps([user(1, 'go'), use(2, 'z', 'Bash', { command: 'sleep 99' })]);
  assert.equal(r.steps[0].ok, null);
});

test('finish keeps only the newest steps but reports the total', () => {
  const many = { steps: Array.from({ length: steps.MAX_STEPS + 5 }, (_, i) => ({ n: i + 1 })), turns: [] };
  const r = steps.finish(many);
  assert.equal(r.steps.length, steps.MAX_STEPS);
  assert.equal(r.total, steps.MAX_STEPS + 5);
  assert.equal(r.steps[r.steps.length - 1].n, steps.MAX_STEPS + 5);
});

test('Antigravity tool calls are read too', () => {
  const lines = [
    line({ type: 'USER_INPUT', created_at: T(1), content: '<USER_REQUEST>do it</USER_REQUEST>' }),
    line({ type: 'PLANNER_RESPONSE', created_at: T(2), tool_calls: [{ name: 'run_command', args: { CommandLine: '"git status"' } }] }),
  ];
  const r = steps.parseAgSteps(lines);
  assert.equal(r.steps.length, 1);
  assert.equal(r.steps[0].target, 'git status');
  assert.equal(r.turns[0].prompt, 'do it');
});

test('search finds a command or a file across chats', async () => {
  const dir = path.join(home, '.claude', 'projects', 'C--work-demo');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'abc123.jsonl'), transcript);
  fs.writeFileSync(path.join(dir, 'other.jsonl'), [user(1, 'hi'), use(2, 'q', 'Bash', { command: 'ls' })].join('\n'));
  const byCmd = await fm.searchSteps('npm test');
  assert.equal(byCmd.length, 1);
  assert.equal(byCmd[0].id, 'claude_abc123');
  assert.equal(byCmd[0].kind, 'run');
  assert.equal(byCmd[0].ok, false);
  assert.equal(byCmd[0].project, 'demo');
  const byFile = await fm.searchSteps('auth.js');
  assert.equal(byFile.length, 2); // the read and the edit
  assert.deepEqual((await fm.searchSteps('nothing-like-this')), []);
  assert.deepEqual((await fm.searchSteps('a')), []); // too short
});
