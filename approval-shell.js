// Shell-command analysis for the HUD's "Always allow" rules (used by main.js).
//
// A chained command such as
//   cd "C:/proj" && sed -i 's/a/b/' x.js && npm test 2>&1 | grep ERR; echo ok
// is split into its parts. It is auto-allowed only when EVERY part is either
// harmless on its own (cd inside the chat's folder, echo, pwd, true) or matches
// a saved rule — the same way Claude Code itself checks compound commands.
// Anything we can't read safely (command substitution, here-docs, subshells,
// redirects into files) is never auto-allowed and never offered a rule.
const path = require('path');

// Commands that are never offered a blanket rule: they can destroy, escalate,
// reach the network, or run *other* commands (so a rule would allow anything).
const RISKY_HEADS = new Set([
  'rm', 'rmdir', 'del', 'erase', 'rd', 'format', 'sudo', 'su', 'shutdown', 'reboot', 'kill', 'taskkill', 'pkill', 'killall',
  'chmod', 'chown', 'dd', 'mkfs', 'curl', 'wget', 'iex', 'invoke-expression', 'invoke-webrequest', 'powershell', 'pwsh', 'cmd',
  'bash', 'sh', 'zsh', 'eval', 'exec', 'source', '.', 'node', 'python', 'python3', 'py', 'npx', 'reg', 'netsh', 'git-push',
  'electron', 'deno', 'bun', 'ruby', 'perl', 'php', 'java', 'wscript', 'cscript', 'mshta', 'rundll32', 'regsvr32',
  // PowerShell: delete / kill / run / download / reconfigure (and their short aliases)
  'remove-item', 'ri', 'remove-itemproperty', 'clear-content', 'clear-disk', 'format-volume', 'stop-process', 'spps', 'start-process', 'saps',
  'invoke-command', 'icm', 'invoke-item', 'ii', 'invoke-restmethod', 'irm', 'iwr', 'start-job', 'start-bitstransfer', 'add-type',
  'set-executionpolicy', 'new-service', 'set-service', 'stop-service', 'restart-computer', 'stop-computer',
  // wrappers that run whatever follows them (timeout is unwrapped instead, see effective())
  'xargs', 'env', 'nohup', 'start', 'time', 'watch', 'nice', 'command', 'builtin', 'parallel', 'runas',
  // changes where the following commands run — never a blanket rule (cd inside the folder is allowed anyway)
  'cd', 'pushd', 'popd',
]);
// Tools whose second word is a subcommand ("npm test", "git status"); for the rest
// the second word is just an argument, so the rule is the command name alone.
const SUBCOMMAND_TOOLS = new Set(['git', 'npm', 'pnpm', 'yarn', 'docker', 'cargo', 'go', 'dotnet', 'pip', 'pip3', 'kubectl',
  'gh', 'az', 'gcloud', 'aws', 'mvn', 'gradle', 'composer', 'flutter', 'dart', 'rustup', 'brew', 'winget', 'choco',
  'terraform', 'helm', 'make', 'ng', 'nx', 'turbo', 'vercel', 'firebase']);
// "npm run build" keeps the script name; "npm exec …" / "npx" run arbitrary packages
const RUN_SUBCOMMANDS = new Set(['run', 'run-script']);
const EXEC_SUBCOMMANDS = new Set(['exec', 'x', 'dlx']);
// Parts that are harmless by themselves (no redirect can reach them — see splitShell)
const HARMLESS_HEADS = new Set(['echo', 'pwd', 'true', ':']);

/**
 * Split a shell command into its simple commands.
 * @returns {{ parts: string[], unsafe: string|null }} unsafe = why it can't be auto-allowed
 */
function splitShell(command) {
  const s = String(command || '');
  const n = s.length;
  const parts = [];
  let cur = '';
  let unsafe = null;
  const push = () => { const t = cur.trim(); if (t) parts.push(t); cur = ''; };

  let i = 0;
  while (i < n && !unsafe) {
    const c = s[i];
    if (c === "'") {                                   // single quotes: fully literal
      const j = s.indexOf("'", i + 1);
      if (j < 0) { unsafe = 'unclosed quote'; break; }
      cur += s.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '"') {                                   // double quotes: $( and ` still run commands
      let j = i + 1;
      while (j < n && s[j] !== '"') {
        if (s[j] === '\\') { j += 2; continue; }
        if (s[j] === '`' || (s[j] === '$' && s[j + 1] === '(')) unsafe = 'command substitution';
        j++;
      }
      if (j >= n) { unsafe = unsafe || 'unclosed quote'; break; }
      cur += s.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '\\') { cur += s.slice(i, i + 2); i += 2; continue; }
    if (c === '`' || (c === '$' && s[i + 1] === '(')) { unsafe = 'command substitution'; break; }
    if (c === '\n' || c === '\r' || c === ';') { push(); i++; continue; }
    if (c === '&') {
      if (s[i + 1] === '&') { push(); i += 2; continue; }
      if (s[i + 1] === '>') { i++; continue; }           // &> file  → handled as a redirect below
      push(); i++; continue;                             // "cmd &" (background) ends a part
    }
    if (c === '|') { push(); i += (s[i + 1] === '|' || s[i + 1] === '&') ? 2 : 1; continue; }
    if (c === '>' || c === '<') {
      if (s[i + 1] === '(') { unsafe = 'process substitution'; break; }
      if (c === '<' && s[i + 1] === '<') { unsafe = 'here-document'; break; }
      if (/(^|\s)\d$/.test(cur)) cur = cur.slice(0, -1);  // the fd number in "2>"
      let j = i + 1;
      if (c === '>' && s[j] === '>') j++;
      let dup = false;
      if (s[j] === '&') { dup = true; j++; }
      while (j < n && s[j] === ' ') j++;
      let k = j, target;
      if (s[k] === '"' || s[k] === "'") {
        const e = s.indexOf(s[k], k + 1);
        if (e < 0) { unsafe = 'unclosed quote'; break; }
        target = s.slice(k + 1, e); k = e + 1;
      } else {
        while (k < n && !/[\s;&|<>()]/.test(s[k])) k++;
        target = s.slice(j, k);
      }
      // only "2>&1"-style fd copies and /dev/null are harmless; anything else writes/reads a file
      const ok = dup ? /^[0-9-]$/.test(target) : /^(\/dev\/null|nul)$/i.test(target);
      if (!ok) { unsafe = `redirect ${c} ${target || '?'}`; break; }
      i = k; continue;
    }
    if ((c === '(' || c === ')' || c === '{' || c === '}') && /(^|\s)$/.test(cur)) { unsafe = 'subshell or group'; break; }
    cur += c; i++;
  }
  if (!unsafe) push();
  return { parts: unsafe ? [] : parts, unsafe };
}

const headOf = (part) => (part.trim().split(/\s+/)[0] || '').replace(/^["']|["']$/g, '').toLowerCase();
// "./node_modules/electron/dist/electron.exe" -> "electron"
const baseName = (head) => head.split(/[\\/]/).pop().replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase();
// A quoted word is still the same command: `git "push"` is a push.
const unquote = (w) => String(w || '').trim().replace(/^(["'])([\s\S]*)\1$/, '$2').toLowerCase();

// Strip leading VAR=value assignments, including quoted values that contain spaces
// (`FOO="a b" rm -rf x` is an `rm`, not a command called `b"`).
const ENV_ASSIGN = /^[A-Za-z_]\w*=(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(?:\\.|[^\s"'])*)\s+/;
function stripEnvAssignments(part) {
  let s = String(part || '').trim();
  while (ENV_ASSIGN.test(s)) s = s.replace(ENV_ASSIGN, '').trim();
  return s;
}

// "timeout 60 npm test" / "time npm test" only add a time limit → judge "npm test"
function effective(part) {
  const words = String(part || '').trim().split(/\s+/);
  const head = baseName(words[0] || '');
  const original = String(part || '').trim();
  if (head !== 'timeout' && head !== 'time') return original;
  let i = 1;
  while (i < words.length && words[i].startsWith('-')) {
    if (head === 'timeout' && /^(-s|--signal|-k|--kill-after)$/.test(words[i])) i++; // option with a value
    i++;
  }
  if (head === 'timeout') i++; // timeout needs a duration; "time" goes straight to the command
  return words.slice(i).join(' ') || original;
}

// "npm test --silent" -> "npm test";  "ls -la" -> "ls";  null = never offer a rule
function suggestPrefix(part) {
  const c = effective(part);
  if (!c) return null;
  const words = c.split(/\s+/);
  const head = words[0].toLowerCase();
  const base = baseName(head);
  if (RISKY_HEADS.has(head) || RISKY_HEADS.has(base) || head.includes('=') || base === 'timeout') return null; // VAR=x cmd: the variable can change anything
  if (base === 'git' && /^(push|reset|clean|checkout|rebase|rm|config)$/i.test(words[1] || '')) return null;
  if (base === 'find' && /\s-(exec|execdir|ok|okdir|delete)\b/.test(' ' + c)) return null;
  const plain = (w) => w && !w.startsWith('-') && !/[\\/:'"$=]/.test(w);
  if (!SUBCOMMAND_TOOLS.has(base)) return words[0];
  // "git --no-pager diff" / "npm --silent test" / bare "git": the first word alone would
  // become a rule covering EVERY git / npm command (push, reset --hard, publish…), so no rule is offered
  if (!plain(words[1])) return null;
  const sub = words[1].toLowerCase();
  if (EXEC_SUBCOMMANDS.has(sub)) return null;
  if (RUN_SUBCOMMANDS.has(sub)) return plain(words[2]) ? `${words[0]} ${words[1]} ${words[2]}` : null;
  return `${words[0]} ${words[1]}`;
}

const prefixMatches = (part, prefix) => part === prefix || part.startsWith(prefix + ' ');

// Git-Bash "/c/Users/x" -> "c:/Users/x"; strips quotes
function toNativePath(p) {
  let t = String(p || '').trim().replace(/^["']|["']$/g, '');
  const m = t.match(/^\/([a-zA-Z])(\/|$)(.*)$/);
  if (m) t = `${m[1]}:/${m[3]}`;
  return t;
}
const norm = (p) => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();

// Harmless on its own? (cd only into the chat's folder or below)
function isHarmless(part, folder) {
  const words = part.trim().split(/\s+/);
  const head = headOf(part);
  if (HARMLESS_HEADS.has(head)) return true;
  if (head === 'cd') {
    if (!folder || words.length !== 2) return false;        // bare "cd" (home) / "cd -" / odd forms
    const raw = part.trim().slice(2).trim();
    if (raw === '-' || raw.startsWith('~')) return false;
    const target = norm(path.resolve(folder, toNativePath(raw)));
    const root = norm(folder);
    return target === root || target.startsWith(root + path.sep);
  }
  return false;
}

/**
 * @param {string} command      the Bash command
 * @param {string} folder       the chat's folder
 * @param {(part:string)=>boolean} ruleMatches  does a saved rule cover this part?
 * @returns {{ allowed: boolean, prefixes: string[]|null }}
 *   allowed  = every part is harmless or covered by a rule
 *   prefixes = rules to offer for the uncovered parts (null = don't offer "Always")
 */
function analyse(command, folder, ruleMatches) {
  const { parts, unsafe } = splitShell(command);
  if (unsafe || !parts.length) return { allowed: false, prefixes: null, stillAsks: [], unsafe };
  const covered = (p) => isHarmless(p, folder) || ruleMatches(p) || ruleMatches(effective(p));
  const uncovered = parts.filter((p) => !covered(p));
  if (!uncovered.length) return { allowed: true, prefixes: [], stillAsks: [] };
  // Offer rules for the parts that can safely have one; the rest keeps asking.
  const prefixes = [];
  const stillAsks = [];
  for (const p of uncovered) {
    const pre = suggestPrefix(p);
    if (!pre) { stillAsks.push(baseName(headOf(effective(p))) || headOf(p)); continue; }
    if (!prefixes.includes(pre)) prefixes.push(pre);
  }
  return { allowed: false, prefixes: prefixes.length ? prefixes : null, stillAsks: [...new Set(stillAsks)] };
}

// ---- "Always allow all commands in this folder" ------------------------------------------------
// That rule is meant to stop the constant prompts for normal work (build, test, edit, git status…),
// not to let Claude delete things or fetch and run code unasked. These still ask, whatever the rule says.
// Derive this from RISKY_HEADS so a command we refuse to offer a rule for can never be
// silently authorised by the blanket rule. Only the everyday runners below are exempt.
const TRUST_ALLOWED_HEADS = new Set(['cd', 'pushd', 'popd', 'node', 'python', 'python3', 'py']);
const TRUST_STILL_ASKS = new Set([
  ...RISKY_HEADS,
  'restart-service', 'diskpart', 'bcdedit', 'schtasks', 'psexec',
].filter((h) => !TRUST_ALLOWED_HEADS.has(h)));
// Code after a pipe can be an interpreter even when it is path-qualified
// ("/bin/bash", "C:\\Windows\\...\\powershell.exe") or wrapped in sudo/env.
const PIPE_RUNNERS = new Set(['node', 'python', 'python3', 'py']);
const PIPE_PASSTHROUGH = new Set(['sudo', 'env', 'nice', 'nohup', 'command', 'builtin']);
function pipeHead(segment) {
  let words = stripEnvAssignments(segment.trim()).split(/\s+/).filter(Boolean);
  while (words.length && PIPE_PASSTHROUGH.has(words[0].toLowerCase())) {
    words = words.slice(1);
    while (words.length && (/^[A-Za-z_]\w*=/.test(words[0]) || /^-[A-Za-z]/.test(words[0]))) words = words.slice(1);
  }
  return baseName(headOf(words[0] || ''));
}
function pipesIntoInterpreter(command) {
  const segments = String(command || '').split('|');
  for (let i = 1; i < segments.length; i++) {
    const head = pipeHead(segments[i]);
    if (TRUST_STILL_ASKS.has(head) || PIPE_RUNNERS.has(head)) return true;
  }
  return false;
}

/**
 * Should a blanket folder rule allow this shell command without asking?
 * Yes for everyday commands. No (→ the normal check runs and asks) when it deletes or kills things,
 * downloads or runs unseen code, pipes into an interpreter, hides a command in $( ) or backticks,
 * or uses git push / reset --hard / clean.
 * It over-splits on purpose (a quoted "; rm" also counts): an extra question is fine, a missed one is not.
 */
function trustedFolderAllows(command) {
  const s = String(command || '');
  if (!s.trim()) return false;
  if (/`|\$\(|<\(|>\(/.test(s)) return false;           // a command hidden inside another one
  if (pipesIntoInterpreter(s)) return false;             // "… | sh", "… | /bin/bash", "… | node"
  for (const raw of s.split(/\r?\n|;|&&|\|\||\||&/)) {
    const part = stripEnvAssignments(raw.trim().replace(/^[\s({]+/, '')); // FOO="a b" rm x
    if (!part) continue;
    const words = effective(part).split(/\s+/).filter(Boolean);
    const head = baseName(unquote(words[0] || ''));
    if (TRUST_STILL_ASKS.has(head)) return false;
    if (head === 'git') {
      // Look at every word, not just the first non-flag one: "git -c x=y push" hides the
      // subcommand behind a value, and quotes around it ("git \"push\"") must not hide it either.
      const subs = [];
      for (let i = 1; i < words.length; i++) {
        const w = unquote(words[i]);
        if (w === '-c' || w === '-C' || w === '--config-env') { i++; continue; } // skip the option's value
        if (/^(-c|--config-env)=/.test(w)) continue;
        subs.push(w);
      }
      if (subs.includes('push') || subs.includes('clean') || subs.includes('checkout') ||
          subs.includes('rebase') || subs.includes('rm') || subs.includes('config')) return false;
      if (subs.includes('reset') && /--hard\b/.test(part)) return false;
    }
    // Package runners execute arbitrary code; they get no per-command rule either.
    if (/^(npm|pnpm|yarn|bun)$/.test(head) && words.slice(1).some((w) => EXEC_SUBCOMMANDS.has(unquote(w)))) return false;
    if (head === 'find' && /\s-(exec|execdir|ok|okdir|delete)\b/.test(' ' + part)) return false;
  }
  return true;
}

module.exports = { splitShell, suggestPrefix, isHarmless, analyse, prefixMatches, effective, trustedFolderAllows };
