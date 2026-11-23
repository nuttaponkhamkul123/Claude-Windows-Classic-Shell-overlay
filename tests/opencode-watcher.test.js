// Run: node --test "tests/*.test.js"
// Pure helpers of the OpenCode source: no service, no network, no home folder.
const test = require('node:test');
const assert = require('node:assert/strict');

const OpencodeWatcher = require('../opencode-watcher');
const { hudId, apiId, endsWithQuestion, assistantText, toolSummary } = OpencodeWatcher;

test('ids are prefixed for the HUD and stripped for the API', () => {
  assert.equal(hudId('ses_abc'), 'opencode_ses_abc');
  assert.equal(apiId('opencode_ses_abc'), 'ses_abc');
  assert.equal(apiId('claude_123'), 'claude_123'); // other sources untouched
  assert.equal(apiId(undefined), undefined);
});

test('an unanswered question at the end asks for attention', () => {
  assert.equal(endsWithQuestion('Which one should I use?'), true);
  assert.equal(endsWithQuestion('Ship it (yes/no)'), true);
  assert.equal(endsWithQuestion('Here is the diff.\n\nLooks good.'), false);
  assert.equal(endsWithQuestion(''), false);
});

test('assistant text keeps text and failed tools, drops reasoning', () => {
  const msg = { content: [
    { type: 'reasoning', text: 'secret chain of thought' },
    { type: 'text', text: 'Hello' },
    { type: 'tool', name: 'Read', state: { status: 'success' } },
    { type: 'tool', name: 'Bash', state: { status: 'error' } },
  ] };
  assert.equal(assistantText(msg), 'Hello\n\n_Bash failed_');
  assert.equal(assistantText(null), '');
});

test('tool summary shows the useful part of the input', () => {
  assert.equal(toolSummary('Bash', { command: 'npm test' }), 'Bash: npm test');
  assert.equal(toolSummary('Read', { filePath: '/a/b/c.ts' }), 'Read: /a/b/c.ts');
  assert.equal(toolSummary('Read', {}), 'Read');
  assert.equal(toolSummary('Read', null), 'Read');
});

test('buildSession maps OpenCode session info into a HUD session', () => {
  const w = new OpencodeWatcher();
  const id = hudId('ses_42');
  w.raw.set(id, {
    id: 'ses_42',
    agent: 'build',
    model: { id: 'gpt-5', providerID: 'openai', variant: 'high' },
    tokens: { input: 10, output: 5 },
    cost: 0.021,
    location: { directory: '/work/ovly' },
    title: 'Fix the login bug',
    time: { created: 1000, updated: 2000 },
  });
  w.live.set(id, {
    running: false, text: 'Which option do you want?', tool: '', detail: '',
    startedAt: 0, failed: false, toolNames: new Map(),
  });

  const s = w.buildSession(id);
  assert.equal(s.id, id);
  assert.equal(s.sessionUuid, 'ses_42');
  assert.equal(s.source, 'opencode');
  assert.equal(s.project, 'ovly');
  assert.equal(s.cwd, '/work/ovly');
  assert.equal(s.model, 'gpt-5');
  assert.equal(s.effort, 'high');
  assert.equal(s.cost, 0.021);
  assert.equal(s.status, 'idle');
  assert.equal(s.state, 'attention');
  assert.equal(s.isQuestion, true);
  assert.equal(s.unread, true);
  assert.match(s.title, /Question/);
  assert.match(s.detail, /Which option/);
  assert.equal(s.context, null);
});

test('an idle event finalises the stream after the session is refreshed', () => {
  const w = new OpencodeWatcher();
  const id = hudId('ses_x');
  w.raw.set(id, {
    id: 'ses_x', title: 'Choose', location: { directory: '/work' },
    time: { created: 1, updated: 2 },
  });
  w.live.set(id, {
    running: true, text: 'Which one?', tool: '', detail: '',
    startedAt: 1, failed: false, toolNames: new Map(),
  });
  const seen = [];
  w.on('update', () => seen.push('update'));
  w.on('stream', (e) => seen.push(e));

  w.handleEvent({ type: 'session.idle', data: { sessionID: 'ses_x' } });
  assert.equal(seen[0], 'update'); // refresh first
  assert.equal(seen[1].done, true);
  assert.equal(seen[1].statusLabel, 'Idle (Question)');
  assert.equal(w.sessions.get(id).status, 'idle');
});

test('history returns oldest-first messages with a cwd property', async () => {
  const w = new OpencodeWatcher();
  w.call = async (_method, p) => {
    if (p.endsWith('/message')) return { data: [
      { type: 'assistant', time: { created: 30 }, content: [{ type: 'text', text: 'Done' }] },
      { type: 'user', time: { created: 20 }, text: 'Go', files: [{ name: 'a.png' }] },
      { type: 'assistant', time: { created: 10 }, content: [{ type: 'text', text: 'Hi' }] },
    ] };
    return { data: { location: { directory: '/work/ovly' } } };
  };
  const msgs = await w.history('opencode_ses_42');
  assert.deepEqual(msgs.map((m) => m.role), ['assistant', 'user', 'assistant']);
  assert.deepEqual(msgs.map((m) => m.text), ['Hi', 'Go', 'Done']);
  assert.equal(msgs[1].imageCount, 1);
  assert.equal(msgs.cwd, '/work/ovly');
});

test('models and commands are normalised for the slash menu', async () => {
  const w = new OpencodeWatcher();
  w.call = async (_method, p) => {
    if (p.startsWith('/api/model')) return { data: [
      { id: 'anthropic/claude-sonnet-4', modelID: 'claude-sonnet-4', providerID: 'anthropic', name: 'Sonnet', enabled: true },
      { id: 'hidden', modelID: 'hidden', providerID: 'x', enabled: false },
    ] };
    if (p.startsWith('/api/command')) return { data: [{ name: 'review', description: 'Review changes' }] };
    return { data: [{ name: 'demo', description: 'A skill' }] };
  };
  assert.deepEqual(await w.models('/work'), [
    { id: 'claude-sonnet-4', modelID: 'claude-sonnet-4', providerID: 'anthropic', name: 'Sonnet', description: 'Sonnet' },
  ]);
  const cmds = await w.commands('/work');
  assert.deepEqual(cmds.map((c) => [c.name, c.scope]), [['review', 'opencode'], ['demo', 'opencode']]);
});

test('model refs can be resolved by full ref or model id', async () => {
  const w = new OpencodeWatcher();
  w.models = async () => [
    { id: 'claude-sonnet-4', modelID: 'claude-sonnet-4', providerID: 'anthropic', name: 'Sonnet' },
  ];
  assert.deepEqual(await w.resolveModel('anthropic/claude-sonnet-4', '/work'),
    { id: 'claude-sonnet-4', providerID: 'anthropic' });
  assert.deepEqual(await w.resolveModel('Sonnet', '/work'),
    { id: 'claude-sonnet-4', providerID: 'anthropic' });
  assert.equal(await w.resolveModel('default', '/work'), null);
  assert.equal(await w.resolveModel('nope', '/work'), null);
});
