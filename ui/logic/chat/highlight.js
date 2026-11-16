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

  window.highlightLine = function (text, lang) {
    const l = known(lang);
    if (!l || !text || text.length > 2000) return null;
    try { return hljs.highlight(text, { language: l, ignoreIllegals: true }).value; } catch (_) { return null; }
  };
})();
