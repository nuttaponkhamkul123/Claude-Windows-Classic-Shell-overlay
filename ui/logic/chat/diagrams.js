// Diagrams in chat: a ```mermaid code block in a reply is drawn as a diagram.
// Ask Claude e.g. "show the flow of this app as a mermaid diagram". Drawing is
// local (no extra tokens); the ~3.5 MB library is only loaded the first time a
// diagram appears.
//   window.renderDiagrams(container) — called from attachCodeCopyHandlers (app.js)
(function () {
  const CACHE_MAX = 50;
  const cache = new Map(); // `${theme}\n${source}` -> { svg, id }   (oldest first, trimmed to CACHE_MAX)
  let loading = null;
  let mermaidTheme = '';
  let n = 0;

  // Light Windows themes (Classic → Windows 7 / XP) have white chat boxes
  const isLight = () => {
    const b = document.body.classList;
    return (b.contains('theme-aero') && !b.contains('theme-vista')) || b.contains('theme-xp');
  };

  function loadMermaid() {
    if (window.mermaid) return Promise.resolve(window.mermaid);
    if (!loading) {
      loading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'lib/mermaid.min.js';
        s.onload = () => resolve(window.mermaid);
        s.onerror = () => { loading = null; reject(new Error('could not load lib/mermaid.min.js')); };
        document.head.appendChild(s);
      });
    }
    return loading;
  }
  function useTheme(m, theme) {
    if (theme === mermaidTheme) return;
    m.initialize({ startOnLoad: false, theme, securityLevel: 'strict', fontFamily: 'inherit' });
    mermaidTheme = theme;
  }

  // Each copy on screen gets its own ids — the SVG's styles and arrowheads refer
  // to them, and two copies with the same ids is invalid (and can mis-draw).
  const withId = (entry) => {
    const id = 'md-diagram-' + (++n);
    return entry.svg.split(entry.id).join(id);
  };
  function remember(key, entry) {
    cache.delete(key);
    cache.set(key, entry);
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }
  // Mermaid leaves a temporary element in the page when it fails ("d" + id, or the id itself)
  function cleanupLeftovers(id) {
    for (const x of [id, 'd' + id]) {
      const el = document.getElementById(x);
      if (el && !el.closest('.md-diagram, .md-viewer')) el.remove();
    }
  }

  function button(label, title, onClick) {
    const b = document.createElement('button');
    b.className = 'md-diagram-btn';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(b); });
    return b;
  }

  // ---- full-window viewer: its own layer on <body>, so no chat container can trap it ----
  function openViewer(entry, src) {
    closeViewer();
    const v = document.createElement('div');
    v.className = 'md-viewer' + (isLight() ? ' light' : '');
    v.setAttribute('role', 'dialog');
    v.setAttribute('aria-label', 'Diagram');
    const bar = document.createElement('div');
    bar.className = 'md-diagram-bar';
    bar.append(
      button('Copy', 'Copy the Mermaid source', (b) => {
        window.electronAPI?.copyToClipboard?.(src);
        b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1000);
      }),
      button('Close', 'Close (Esc)', closeViewer),
    );
    const view = document.createElement('div');
    view.className = 'md-viewer-view';
    view.innerHTML = withId(entry);
    v.append(bar, view);
    v.addEventListener('click', (e) => { if (e.target === v) closeViewer(); });
    document.body.appendChild(v);
  }
  function closeViewer() { document.querySelector('.md-viewer')?.remove(); }
  // One Esc handler for every diagram (no per-diagram listeners to leak). It only
  // acts while a viewer is open, and then Esc stops here — nothing else reacts to it.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !document.querySelector('.md-viewer')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    closeViewer();
  }, true);

  function build(pre, src) {
    const box = document.createElement('div');
    box.className = 'md-diagram' + (isLight() ? ' light' : '');
    const view = document.createElement('div');
    view.className = 'md-diagram-view';
    view.textContent = 'Drawing diagram…';
    const code = document.createElement('pre');
    code.className = 'md-diagram-code';
    code.textContent = src;
    code.hidden = true;
    let drawn = null; // { svg, id } once drawn
    const expand = button('Expand', 'Show the diagram full-window (Esc to close)', () => { if (drawn) openViewer(drawn, src); });
    expand.disabled = true;
    const bar = document.createElement('div');
    bar.className = 'md-diagram-bar';
    bar.append(
      expand,
      button('Code', 'Show / hide the Mermaid source', () => { code.hidden = !code.hidden; }),
      button('Copy', 'Copy the Mermaid source', (b) => {
        window.electronAPI?.copyToClipboard?.(src);
        b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1000);
      }),
    );
    box.append(bar, view, code);
    pre.replaceWith(box);

    const theme = isLight() ? 'default' : 'dark';
    const key = `${theme}\n${src}`;
    const show = (entry) => {
      drawn = entry;
      view.innerHTML = withId(entry);
      expand.disabled = false;
    };
    if (cache.has(key)) { const e = cache.get(key); remember(key, e); show(e); return; }
    const id = 'md-diagram-' + (++n);
    loadMermaid()
      .then((m) => { useTheme(m, theme); return m.render(id, src); })
      .then(({ svg }) => { const entry = { svg, id }; remember(key, entry); show(entry); })
      .catch((err) => {
        // not valid Mermaid: fall back to the plain code
        view.textContent = '⚠ Could not draw this diagram: ' + String(err?.message || err).split('\n')[0];
        view.classList.add('md-diagram-error');
        code.hidden = false;
        cleanupLeftovers(id);
      });
  }

  window.renderDiagrams = function (container) {
    container.querySelectorAll('pre > code.language-mermaid').forEach((c) => build(c.parentElement, c.textContent.trim()));
  };

  const css = document.createElement('style');
  css.textContent = `
    .chat-bubble:has(.md-diagram) { width: 100%; max-width: 100%; box-sizing: border-box; }
    .bubble-content:has(.md-diagram) { width: 100%; }
    .md-diagram { margin: 8px 0; border: 1px solid rgba(127,127,127,.35); border-radius: 8px; background: #15171c; overflow: hidden; }
    .md-diagram-bar { display: flex; justify-content: flex-end; gap: 4px; padding: 4px 6px; border-bottom: 1px solid rgba(127,127,127,.2); }
    .md-diagram-btn { font: inherit; font-size: 11px; padding: 1px 8px; border-radius: 4px; border: 1px solid rgba(127,127,127,.4);
      background: transparent; color: #c9ccd3; cursor: pointer; }
    .md-diagram-btn:hover:not(:disabled) { background: rgba(255,255,255,.08); }
    .md-diagram-btn:disabled { opacity: .4; cursor: default; }
    .md-diagram-view { padding: 10px; overflow: auto; color: #8b919c; font-size: 12px; text-align: center; }
    .md-diagram-view svg { width: 100%; max-width: 100% !important; height: auto; max-height: 420px; }
    .md-diagram-error { color: #f0b74a; text-align: left; }
    .md-diagram-code { margin: 0; border-radius: 0; max-height: 300px; overflow: auto; }

    /* full-window viewer (on <body>, above everything) */
    .md-viewer { position: fixed; inset: 12px; z-index: 10040; display: flex; flex-direction: column;
      background: #15171c; border: 1px solid rgba(127,127,127,.35); border-radius: 10px;
      box-shadow: 0 16px 48px rgba(0,0,0,.6); animation: md-viewer-in .18s cubic-bezier(.2,.7,.2,1) both; }
    .md-viewer-view { flex: 1; min-height: 0; padding: 16px; overflow: auto; display: flex; align-items: center; justify-content: center; }
    .md-viewer-view svg { width: 100%; height: 100%; max-width: 100% !important; }
    @keyframes md-viewer-in { from { opacity: 0; transform: scale(.98); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .md-viewer { animation: none; } }

    /* light Windows themes: white card, dark buttons */
    .md-diagram.light, .md-viewer.light { background: #ffffff; border-color: #c4ddf2; }
    .md-diagram.light .md-diagram-btn, .md-viewer.light .md-diagram-btn { color: #1e395b; border-color: #b6c8dc; }
    .md-diagram.light .md-diagram-btn:hover:not(:disabled), .md-viewer.light .md-diagram-btn:hover { background: #eef5fd; }
    .md-diagram.light .md-diagram-view { color: #5a6b7d; }
    .md-diagram.light .md-diagram-error { color: #a15c00; }
  `;
  document.head.appendChild(css);
})();
