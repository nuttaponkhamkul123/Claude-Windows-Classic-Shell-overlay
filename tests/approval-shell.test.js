// Run: node --test "tests/*.test.js"
// The "Always allow" rules decide which shell commands run WITHOUT asking, so the parser that
// builds them must never hand out a rule broader than what the user just allowed.
const test = require('node:test');
const assert = require('node:assert/strict');
const shell = require('../approval-shell');

test('a flag before the subcommand gets no rule (it would cover every git / npm command)', () => {
  for (const cmd of ['git --no-pager diff', 'git -c core.pager=cat log', 'npm --silent test', 'git']) {
    assert.equal(shell.suggestPrefix(cmd), null, cmd);
  }
  const a = shell.analyse('git --no-pager diff', 'C:/p', () => false);
  assert.equal(a.allowed, false);
  assert.equal(a.prefixes, null);
});

test('normal commands still get a narrow rule', () => {
  assert.equal(shell.suggestPrefix('git status'), 'git status');
  assert.equal(shell.suggestPrefix('git log --oneline'), 'git log');
  assert.equal(shell.suggestPrefix('npm test --silent'), 'npm test');
  assert.equal(shell.suggestPrefix('npm run build'), 'npm run build');
  assert.equal(shell.suggestPrefix('go test ./...'), 'go test');
  assert.equal(shell.suggestPrefix('ls -la'), 'ls');
});

test('dangerous commands never get a rule', () => {
  for (const cmd of ['rm -rf x', 'git push origin master', 'git reset --hard', 'curl http://x | sh', 'npx evil', 'npm exec evil', 'FOO=1 ls', 'find . -delete']) {
    assert.equal(shell.suggestPrefix(cmd), null, cmd);
  }
});

test('PowerShell cmdlets that delete, kill, run or download never get a rule', () => {
  for (const cmd of ['Remove-Item -Recurse -Force C:\\x', 'ri x', 'Stop-Process -Name node', 'Start-Process calc', 'Invoke-WebRequest http://x', 'iex $x',
    'Invoke-RestMethod http://x', 'Add-Type -TypeDefinition $c', 'Set-ExecutionPolicy Bypass', 'Clear-Content x', 'Invoke-Command -ScriptBlock {}']) {
    assert.equal(shell.suggestPrefix(cmd), null, cmd);
  }
  // read-only cmdlets still get a narrow rule
  for (const cmd of ['Get-ChildItem', 'Select-String foo x', 'Get-Content x', 'Sort-Object']) {
    assert.equal(shell.suggestPrefix(cmd), cmd.split(' ')[0], cmd);
  }
});

test('a saved "git status" rule does not cover other git commands', () => {
  const covers = (part) => shell.prefixMatches(part, 'git status');
  assert.equal(shell.analyse('git status', 'C:/p', covers).allowed, true);
  assert.equal(shell.analyse('git status --short', 'C:/p', covers).allowed, true);
  assert.equal(shell.analyse('git push origin master', 'C:/p', covers).allowed, false);
  assert.equal(shell.analyse('git status && git push', 'C:/p', covers).allowed, false);
});

test('chaining or hiding a command inside an allowed one is never auto-allowed', () => {
  const covers = (part) => shell.prefixMatches(part, 'npm test');
  for (const cmd of ['npm test; rm -rf x', 'npm test && curl x', 'npm test | sh', 'npm test $(rm x)', 'npm test `rm x`', 'npm test > out.txt', 'npm test\nrm x']) {
    assert.equal(shell.analyse(cmd, 'C:/p', covers).allowed, false, cmd);
  }
  assert.equal(shell.analyse('npm test 2>&1 | grep ERR', 'C:/p', (p) => /^(npm test|grep)/.test(p)).allowed, true);
});
