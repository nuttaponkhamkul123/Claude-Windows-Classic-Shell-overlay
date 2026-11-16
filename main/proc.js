// Small helpers for running other programs from the main process.
const { spawn } = require('child_process');

// Run a program, optionally feeding it stdin. Never throws → { ok, out, err }
function runCmd(cmd, args, { cwd, input, timeout = 30000 } = {}) {
  return new Promise((resolve) => {
    let child, out = '', err = '', done = false, timer = null;
    const finish = (ok) => { if (done) return; done = true; clearTimeout(timer); resolve({ ok, out, err: err.trim() }); };
    try {
      const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
      delete env.ELECTRON_RUN_AS_NODE;
      child = spawn(cmd, args, { cwd, env, windowsHide: true });
    } catch (e) { err = e.message; return finish(false); }
    timer = setTimeout(() => { try { child.kill(); } catch (_) {} err += '\nTimed out'; finish(false); }, timeout);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { err += e.message; finish(false); });
    child.on('close', (code) => finish(code === 0));
    child.stdin.on('error', () => {});
    child.stdin.end(input == null ? undefined : input);
  });
}

// A fresh `claude -p` session can open (or end) with the organisation's weekly notice block. It is meant
// for you in the chat, not for a commit message or a handoff note, so cut it from generated text.
function stripNotice(text) {
  const i = text.indexOf('重要なお知らせ');
  if (i < 0) return text;
  const head = text.slice(0, i).replace(/[\s\-*【[]+$/, ''); // also drops the "---" and "**【" in front of it
  return head.trim() ? head : text; // (if the notice came first there is nothing safe to cut)
}

module.exports = { runCmd, stripNotice };
