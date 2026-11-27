// Syntax colours for code (lib/highlight.min.js, offline, ~35 common languages).
//   window.highlightCode(container) — every <pre><code> in the chat (yours and Claude's)
//   window.highlightLine(text, lang) — one line, for the Changes panel; returns HTML or null
// Colours are in styles/features.css (.hljs-*).
(function () {
  const hljs = window.hljs;
  if (!hljs) return;

  const ALIAS = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    py: 'python', rb: 'ruby', rs: 'rust', sh: 'bash', zsh: 'bash', shell: 'bash', console: 'bash', ps1: 'powershell',
    md: 'markdown', yml: 'yaml', htm: 'xml', html: 'xml', svg: 'xml', vue: 'xml', cs: 'csharp', 'c#': 'csharp',
    'c++': 'cpp', h: 'c', hpp: 'cpp', kt: 'kotlin', golang: 'go', jsonc: 'json', toml: 'ini', patch: 'diff',
  };
  const AUTO = ['javascript', 'typescript', 'python', 'bash', 'json', 'css', 'xml', 'csharp', 'java', 'go', 'rust', 'sql', 'yaml', 'diff'];
  const known = (lang) => {
    if (!lang) return '';
    const l = ALIAS[lang.toLowerCase()] || lang.toLowerCase();
    return hljs.getLanguage(l) ? l : '';
  };
  const langFromClass = (el) => ((el.className || '').match(/language-([\w+#.-]+)/) || [])[1] || '';

  window.highlightCode = function (container) {
    container.querySelectorAll('pre > code').forEach((code) => {
      if (code.dataset.hl) return;
      const cls = langFromClass(code);
      if (cls === 'mermaid') return; // drawn as a diagram
      code.dataset.hl = '1';
      const text = code.textContent;
      if (!text.trim() || text.length > 200000) return;
      try {
        const lang = known(cls);
        let res = null;
        if (lang) res = hljs.highlight(text, { language: lang, ignoreIllegals: true });
        else if (!cls && text.length < 20000) {
          res = hljs.highlightAuto(text, AUTO);
          if (res.relevance < 5) res = null; // not sure what it is → leave it plain
        }
        if (res) { code.innerHTML = res.value; code.classList.add('hljs'); }
      } catch (_) {}
    });
  };

  // A one-line shell command, split for reading: a new line before each && || | ; that is
  // outside quotes and brackets. Commands that already have line breaks are left as they are.
  window.formatCommand = function (cmd) {
    cmd = String(cmd || '').trim();
    if (!cmd || cmd.includes('\n') || cmd.length < 60) return cmd;
    let out = '', q = '', depth = 0;
    for (let i = 0; i < cmd.length; i++) {
      const c = cmd[i], two = cmd.slice(i, i + 2);
      if (q) { out += c; if (c === q && cmd[i - 1] !== '\\') q = ''; continue; }
      if (c === '"' || c === "'") { q = c; out += c; continue; }
      if (c === '(' || c === '{' || c === '[') depth++;
      if ((c === ')' || c === '}' || c === ']') && depth) depth--;
      if (!depth && (two === '&&' || two === '||')) { out = out.trimEnd() + '\n  ' + two; i++; continue; }
      if (!depth && c === '|') { out = out.trimEnd() + '\n  |'; continue; }
      if (!depth && c === ';') { out = out.trimEnd() + ';\n'; while (cmd[i + 1] === ' ') i++; continue; }
      out += c;
    }
    return out.replace(/\n {2}(&&|\|\||\|) */g, '\n  $1 ');
  };

  // <pre><code> with the formatted, coloured command (lang: 'bash' or 'powershell')
  window.commandBlock = function (cmd, lang) {
    const pre = document.createElement('pre');
    pre.className = 'step-cmd';
    const code = document.createElement('code');
    const text = window.formatCommand(cmd);
    code.textContent = text;
    try { if (text.length < 50000) { code.innerHTML = hljs.highlight(text, { language: known(lang) || 'bash', ignoreIllegals: true }).value; code.classList.add('hljs'); } } catch (_) {}
    pre.appendChild(code);
    return pre;
  };

  // A step row that ran a command: click it to show the full command (formatted, coloured,
  // with Copy) in the box returned, which goes right after the row.
  window.addCommandToggle = function (row, st, isOpen, onToggle) {
    row.classList.add('has-cmd');
    row.title = 'Click to see the full command';
    const box = document.createElement('div');
    box.className = 'step-cmd-box';
    const show = (open) => {
      box.style.display = open ? '' : 'none';
      row.classList.toggle('open', open);
      if (!open || box.childElementCount) return;
      const copy = document.createElement('button');
      copy.className = 'step-cmd-copy';
      copy.textContent = 'Copy';
      copy.title = 'Copy the command as it was run';
      copy.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.electronAPI?.copyToClipboard) window.electronAPI.copyToClipboard(st.cmd); else navigator.clipboard?.writeText(st.cmd);
        copy.textContent = '✓ Copied';
        setTimeout(() => { copy.textContent = 'Copy'; }, 1200);
      });
      box.append(window.commandBlock(st.cmd, st.lang), copy);
    };
    show(!!isOpen);
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = box.style.display === 'none';
      show(open);
      if (onToggle) onToggle(open);
    });
    return box;
  };

  window.highlightLine = function (text, lang) {
    const l = known(lang);
    if (!l || !text || text.length > 2000) return null;
    try { return hljs.highlight(text, { language: l, ignoreIllegals: true }).value; } catch (_) { return null; }
  };
})();
