// Safe Markdown: everything that goes through marked.parse() is cleaned first.
//
// Why: Claude's replies are turned into HTML and put into the page. A reply can carry raw HTML
// (for example after Claude read a web page or file that contains instructions), and the page has
// a powerful window.electronAPI (approve tools, commit, push, install skills…). marked does not
// clean its output, so `<img src=x onerror=…>` in a reply ran as code.
//
// This wraps marked.parse (loaded just before this file) so EVERY caller gets clean output,
// including ones added later. It keeps what Markdown produces (headings, lists, tables, code,
// links, task-list boxes, images) and drops the rest. A strict Content-Security-Policy in
// index.html is the second layer.
(function () {
  if (!window.marked || window.marked.__safe) return;

  const KEEP = new Set(['A', 'P', 'BR', 'HR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'STRONG', 'B', 'EM', 'I', 'DEL', 'S',
    'CODE', 'PRE', 'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'IMG', 'INPUT', 'SPAN', 'DIV', 'SUP', 'SUB', 'KBD', 'DETAILS', 'SUMMARY']);
  // removed together with everything inside them
  const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE', 'FORM', 'SVG', 'MATH',
    'TEMPLATE', 'NOSCRIPT', 'TEXTAREA', 'SELECT', 'BUTTON', 'AUDIO', 'VIDEO', 'SOURCE', 'CANVAS', 'APPLET']);

  // scheme of a URL as a browser reads it: control characters and spaces inside are ignored ("java\tscript:")
  const scheme = (v) => (/^([a-z][a-z0-9+.-]*):/.exec(String(v).replace(/[\u0000- \u007f-\u009f]+/g, '').toLowerCase()) || [])[1] || '';

  function cleanAttributes(el) {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase();
      let ok = false;
      if (n === 'class') ok = /^[\w\- ]*$/.test(a.value);          // language-js, hljs…
      else if (n === 'title' || n === 'alt') ok = true;
      else if (n === 'align') ok = /^(left|right|center)$/i.test(a.value);
      else if (n === 'href' && el.tagName === 'A') ok = !/^(javascript|data|vbscript)$/.test(scheme(a.value)); // file paths and conversation:// links stay
      else if (n === 'src' && el.tagName === 'IMG') ok = /^data:image\//i.test(a.value.trim());               // remote images: see below
      else if (el.tagName === 'INPUT') ok = (n === 'type' && a.value === 'checkbox') || n === 'checked' || n === 'disabled';
      else if ((n === 'start' && el.tagName === 'OL') || ((n === 'colspan' || n === 'rowspan') && /^T[DH]$/.test(el.tagName))) ok = /^\d{1,3}$/.test(a.value);
      if (!ok) el.removeAttribute(a.name);
    }
    if (el.tagName === 'INPUT') { el.setAttribute('type', 'checkbox'); el.setAttribute('disabled', ''); }
    if (el.tagName === 'A' && el.hasAttribute('href')) el.setAttribute('rel', 'noopener noreferrer');
  }

  function walk(parent) {
    for (const el of [...parent.children]) {
      if (DROP.has(el.tagName.toUpperCase())) { el.remove(); continue; }
      if (!KEEP.has(el.tagName)) { walk(el); el.replaceWith(...el.childNodes); continue; } // unknown tag: keep its text
      // A remote image would load by itself and could carry chat text in its URL → show a link instead
      if (el.tagName === 'IMG') {
        const src = el.getAttribute('src') || '';
        if (!/^data:image\//i.test(src)) {
          const url = src.trim();
          const link = document.createElement('a');
          link.textContent = el.getAttribute('alt') || url || 'image';
          if (/^https?:/i.test(url)) { link.setAttribute('href', url); link.setAttribute('rel', 'noopener noreferrer'); link.title = url; }
          el.replaceWith(link);
          continue;
        }
      }
      cleanAttributes(el);
      walk(el);
    }
  }

  function clean(html) {
    // a DOMParser document is inert: nothing runs, no image loads, no handler is even compiled while we look at it
    const doc = new DOMParser().parseFromString(`<body>${html}`, 'text/html');
    walk(doc.body);
    return doc.body.innerHTML;
  }

  // marked's own `parse` is a read-only getter, so it cannot be overwritten (a plain assignment is silently
  // ignored). Put a thin object in front of it instead: everything else (setOptions, …) falls through.
  const real = window.marked;
  const safe = Object.create(real);
  Object.defineProperty(safe, 'parse', {
    value: (...args) => {
      const out = real.parse(...args);
      return typeof out === 'string' ? clean(out) : out; // (async mode is not used here)
    },
  });
  Object.defineProperty(safe, '__safe', { value: true });
  window.marked = safe;
  window.cleanMarkdownHtml = clean;
})();
