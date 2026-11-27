// HTML preview inside the HUD: a "▶ Preview" button next to any .html / .htm file
//   - in a reply (a link or `code` path to an .html file),
//   - in the "Edited N files" list under a reply,
//   - in the Changes panel's file header.
// Clicking it shows the page right there, in a frame under the file (click again or ✕ to close).
// Nothing opens a browser or a new window. The frame is sandboxed (scripts run, but the page has no
// access to the HUD, cannot open popups, submit forms or navigate the HUD); web links clicked inside
// it go to the normal browser (main.js, will-frame-navigate). The look is in styles/features.css (.hp-*).
//   window.htmlPreview.isHtml(path)
//   window.htmlPreview.toggle(button, path, insert(box), onClose?)
//   window.decorateHtmlLinks(container)   — called from attachCodeCopyHandlers (app.js)
(function () {
  const api = window.electronAPI;
  const IS_HTML = /\.html?(?:#L\d+.*|:\d+(?::\d+)?)?$/i;
  const isHtml = (p) => IS_HTML.test(String(p || '').trim());
  const cwdNow = () => (typeof currentActiveSession !== 'undefined' && currentActiveSession && currentActiveSession.cwd) || '';
  const SAY = { missing: 'File not found on disk', 'not-html': 'Not an HTML file' };

  function makeBox(info, close) {
    const box = el('div', 'hp-box');
    const bar = el('div', 'hp-bar');
    const name = el('span', 'hp-name', info.path.split(/[\\/]/).pop());
    name.title = info.path;
    const reload = el('button', 'hp-btn', '⟳');
    reload.title = 'Reload (after the file changed)';
    const tall = el('button', 'hp-btn', '⤢');
    tall.title = 'Taller / shorter';
    const x = el('button', 'hp-btn', '✕');
    x.title = 'Close the preview';
    bar.append(el('span', 'hp-tag', 'PREVIEW'), name, reload, tall, x);

    const frame = document.createElement('iframe');
    frame.className = 'hp-frame';
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.title = 'Preview of ' + info.path;
    frame.src = info.url;

    reload.addEventListener('click', (e) => { e.stopPropagation(); frame.src = info.url + '?t=' + Date.now(); });
    tall.addEventListener('click', (e) => { e.stopPropagation(); box.classList.toggle('tall'); });
    x.addEventListener('click', (e) => { e.stopPropagation(); close(); });
    box.addEventListener('click', (e) => e.stopPropagation()); // don't fold the row / card it sits in
    box.append(bar, frame);
    return box;
  }

  // One preview per button: first click opens it (insert(box) places it), the next click closes it.
  async function toggle(btn, rawPath, insert, onClose) {
    if (btn._hpBox) { btn._hpClose(); return; }
    if (btn._hpBusy) return;
    btn._hpBusy = true;
    let info;
    try { info = await api?.htmlPreviewUrl?.(rawPath, cwdNow()); } catch (_) { info = null; }
    btn._hpBusy = false;
    if (!info || !info.url) {
      const err = el('div', 'hp-err', '⚠ ' + (SAY[info && info.error] || 'Could not preview this file'));
      insert(err);
      setTimeout(() => err.remove(), 3000);
      return;
    }
    const close = () => {
      btn._hpBox?.remove();
      btn._hpBox = null;
      btn.classList.remove('on');
      onClose?.();
    };
    btn._hpClose = close;
    btn._hpBox = makeBox(info, close);
    btn.classList.add('on');
    insert(btn._hpBox);
  }

  // Replies: links and `inline code` that name an .html file get a small Preview button after them.
  const PATHISH = /^[^\s<>"|*?]+\.html?(?:#L\d+.*|:\d+(?::\d+)?)?$/i;
  function placeAfter(node) {
    return (box) => {
      const cell = node.closest('li, td, th');
      if (cell) { cell.appendChild(box); return; }
      const blk = node.closest('p, h1, h2, h3, h4, h5, h6, blockquote');
      if (blk) blk.after(box); else node.parentElement.appendChild(box);
    };
  }
  function addChip(node, rawPath) {
    if (node.dataset.hp) return;
    node.dataset.hp = '1';
    const chip = el('button', 'hp-chip', '▶ Preview');
    chip.title = 'Show this page here';
    chip.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggle(chip, rawPath, placeAfter(node)); });
    node.after(chip);
  }
  window.decorateHtmlLinks = function (container) {
    const roots = container.matches?.('.bubble-content') ? [container] : container.querySelectorAll('.bubble-content');
    for (const root of roots) {
      for (const a of root.querySelectorAll('a[href]')) {
        const href = a.getAttribute('href') || '';
        if (/^(https?:|mailto:|conversation:|#)/i.test(href)) continue;
        let p = href;
        if (!/^file:/i.test(p)) { try { p = decodeURI(p); } catch (_) {} } // [x](my%20page.html)
        if (isHtml(p)) addChip(a, p);
      }
      for (const c of root.querySelectorAll('code')) {
        if (c.closest('pre, a')) continue;
        const t = c.textContent.trim();
        if (PATHISH.test(t)) addChip(c, t);
      }
    }
  };

  window.htmlPreview = { isHtml, toggle };
})();
