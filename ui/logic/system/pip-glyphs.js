// Shelter style: no colour emoji in the app's own buttons, menus and labels (they break the Pip-Boy screen).
// Each emoji is wrapped in <span class="pip-emo"> once; the Shelter CSS hides it, or shows a plain text glyph
// instead when the button would otherwise be empty (📎 → +, ⚡ → », …). Other styles still show the emoji,
// so switching style needs no restart. Claude's message text and the room artwork are not touched.
(function () {
  const AREAS = [
    '#listToolbar', '.tabs-bar', '.workspace-header', '.popup-footer', '.vault-plaque',
    '#detailView .convo-toolbar', '.convo-contact', '.reply-toolbar', '.pip-stats', '.pip-status', '.pip-head',
    '.bubble-meta', '.bubble-copy', '.edit-list', '.quick-replies', '.ask-card', '.convo-infobar', '.pinned-prompt',
    '.sk-dialog', '.mcp-panel', '.usage-panel', '.fx-menu', '.ctx-menu', '.finder-panel', '.dress-panel',
    '.my-ava-menu', '.furn-shop', '.gd-panel', '.perm-toast',
  ].join(', ');
  // never inside these (message text, typed text, artwork)
  const SKIP = '.bubble-content, textarea, input, svg, .vault-wall, .pip-emo';
  // plain text symbols that already look right on the screen: leave them alone
  const KEEP = new Set(['▶', '↗', '✂', '✦', '✓', '↶', '⧉', '⛶', '■', '⏻', '↻', '⇋', '▸', '▾', '▴', '◂', '‹', '›', '✕', '✔']);
  // what to show instead, when the emoji is the whole label (an icon-only button)
  const GLYPH = { '📎': '+', '⚡': '»', '🎤': '◉', '📋': '⧉', '👤': '@', '🔄': '↻', '🔍': '⌕', '⚙': '≡', '📌': '·', '📝': '·' };
  const EMOJI = /(\p{Extended_Pictographic}️?(?:‍\p{Extended_Pictographic}️?)*)(\s?)/gu;

  function wrapText(node) {
    const t = node.textContent;
    EMOJI.lastIndex = 0;
    if (!EMOJI.test(t)) return;
    EMOJI.lastIndex = 0;
    const host = node.parentElement;
    const own = (host.textContent || '').replace(EMOJI, '').trim(); // label left once the emoji are gone
    const frag = document.createDocumentFragment();
    let last = 0, m, changed = false;
    while ((m = EMOJI.exec(t))) {
      const e = m[1].replace(/️/g, '');
      if (KEEP.has(e)) continue;
      changed = true;
      if (m.index > last) frag.appendChild(document.createTextNode(t.slice(last, m.index)));
      const s = document.createElement('span');
      s.className = 'pip-emo';
      s.textContent = m[0];
      if (!own && GLYPH[e]) s.dataset.g = GLYPH[e];
      frag.appendChild(s);
      last = m.index + m[0].length;
    }
    if (!changed) return;
    if (last < t.length) frag.appendChild(document.createTextNode(t.slice(last)));
    node.replaceWith(frag);
  }

  // the input's hint text has a 📎 too (a placeholder can't hold a span, so swap the text and keep the original)
  const box = document.getElementById('replyTextarea');
  function placeholder(shelter) {
    if (!box) return;
    if (box.dataset.ph == null) box.dataset.ph = box.placeholder;
    const want = shelter ? box.dataset.ph.replace(EMOJI, '').replace(/·\s*,\s*/g, '· ') : box.dataset.ph;
    if (box.placeholder !== want) box.placeholder = want;
  }

  function scan() {
    const shelter = document.body.classList.contains('style-shelter');
    placeholder(shelter);
    if (!shelter) return;
    document.querySelectorAll(AREAS).forEach((area) => {
      const walker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.parentElement && !n.parentElement.closest(SKIP) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
      });
      const found = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) found.push(n);
      found.forEach(wrapText);
    });
  }
  setInterval(scan, 400);
})();
