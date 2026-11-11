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

// "timeout 60 npm test" only adds a time limit → judge "npm test"
function effective(part) {
  const words = String(part || '').trim().split(/\s+/);
  if (baseName(words[0] || '') !== 'timeout') return String(part || '').trim();
  let i = 1;
  while (i < words.length && words[i].startsWith('-')) {
    if (/^(-s|--signal|-k|--kill-after)$/.test(words[i])) i++;   // option with a value
    i++;
  }
  i++; // the duration
  const inner = words.slice(i).join(' ');
  return inner || String(part || '').trim();
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
  if (!SUBCOMMAND_TOOLS.has(base) || !plain(words[1])) return words[0];
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

module.exports = { splitShell, suggestPrefix, isHarmless, analyse, prefixMatches, effective };
