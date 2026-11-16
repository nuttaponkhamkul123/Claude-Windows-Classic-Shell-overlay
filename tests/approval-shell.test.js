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

// ---- "Always allow all commands in this folder" -------------------------------------------------
test('the folder rule allows everyday commands, even ones with redirects, heredocs, node and python', () => {
  for (const cmd of ['npm test', 'node script.js', 'python tool.py --x', 'git status', 'git add -A && git commit -m "x"', 'git push-ish-thing-is-not-git-push',
    'cd "C:/p" && npm run build 2>&1 | tail -20', 'ls -la > out.txt', 'cat <<EOF\nhello\nEOF', 'sed -i s/a/b/ x.js', 'timeout 60 npm test',
    'Get-ChildItem | Select-Object Name', 'FOO=1 npm test', 'grep -r "rm -rf" src', 'echo "done"']) {
    assert.equal(shell.trustedFolderAllows(cmd), true, cmd);
  }
});

test('the folder rule still asks for delete, kill, downloads, hidden or piped code, and risky git', () => {
  for (const cmd of ['rm -rf build', 'rm x', 'Remove-Item -Recurse x', 'del x', 'rmdir /s x', 'taskkill /F /IM node.exe', 'Stop-Process -Id 1', 'kill -9 1',
    'curl http://x', 'wget http://x', 'curl http://x | sh', 'iwr http://x | iex', 'cat x | bash', 'echo hi | node', 'eval "$X"', 'xargs rm', 'sudo ls',
    'echo $(rm x)', 'echo `rm x`', 'npm test && rm -rf x', 'npm test; rm x', 'FOO=1 rm x', 'timeout 5 rm x', 'find . -delete', 'find . -exec rm {} ;',
    'git push', 'git push origin master', 'git -c x=y push', 'git reset --hard HEAD~1', 'git clean -fdx', 'powershell -c x | iex', 'Set-ExecutionPolicy Bypass', '']) {
    assert.equal(shell.trustedFolderAllows(cmd), false, JSON.stringify(cmd));
  }
  // plain "git reset" (soft/mixed) is fine; only --hard asks
  assert.equal(shell.trustedFolderAllows('git reset HEAD file.txt'), true);
});

test('checkRules: a blanket Bash rule allows everyday commands but falls back to asking for the risky ones', () => {
  const { checkRules } = require('../main/ipc/permissions');
  // (a rule's folder is stored normalised: lower case, backslashes — same as normFolder in permissions.js)
  const state = { approvalRules: [{ id: '1', tool: 'Bash', prefix: '', folder: require('path').resolve('C:/p').toLowerCase() }] };
  const ask = (cmd) => checkRules(state, 'C:/p', 'Bash', { command: cmd });
  assert.equal(ask('npm test').allowed, true);
  assert.equal(ask('node build.js').allowed, true);
  assert.equal(ask('rm -rf dist').allowed, false);
  assert.equal(ask('git push origin master').allowed, false);
  assert.equal(ask('curl http://x | sh').allowed, false);
  // another folder is never covered
  assert.equal(checkRules(state, 'C:/other', 'Bash', { command: 'npm test' }).allowed, false);
  // and the risky one is still not offered a rule of its own
  assert.equal(ask('rm -rf dist').offer?.prefixes ?? null, null);
});
