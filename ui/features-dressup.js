// Dress-up panel: click the agent's picture in a conversation to give that chat's
// robot a hat, glasses and clothes (each with a colour). "Use for all robots"
// saves it as the default for every chat that has no outfit of its own.
// The art and saving live in robot-outfits.js.
(function () {
  const dp = document.getElementById('dpAgent');
  const CAT = window.ROBOT_OUTFIT_CATALOG;
  if (!dp || !CAT || typeof window.setRobotOutfit !== 'function') return;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const KINDS = [['hat', 'Hat'], ['glasses', 'Glasses'], ['clothes', 'Clothes']];

  dp.classList.add('dress-trigger');
  dp.addEventListener('mouseenter', () => { dp.title = 'Click to dress up this robot'; });

  const panel = el('div', 'dress-panel');
  panel.style.display = 'none';
  document.body.appendChild(panel);
  panel.addEventListener('click', (e) => e.stopPropagation());

  let session = null;     // the chat being dressed
  let outfit = {};        // working copy
  let previewUrl = null;
  let previewSeq = 0;

  function close() {
    panel.style.display = 'none';
    session = null;
  }
  document.addEventListener('click', (e) => {
    if (panel.style.display !== 'none' && !panel.contains(e.target) && !dp.contains(e.target)) close();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel.style.display !== 'none') close(); });

  function currentOutfitOf(s) {
    return { ...(window.robotOutfitFor(s) || {}) };
  }

  function apply() {
    if (!session) return;
    window.setRobotOutfit(session.id, outfit);
    renderPreview();
  }

  async function renderPreview() {
    const img = panel.querySelector('.dress-preview img');
    if (!img || !session) return;
    const seq = ++previewSeq;
    const svg = await getRobotFullSvg(robotHueFor(session), outfit);
    if (!svg || seq !== previewSeq) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    img.src = previewUrl;
  }

  function render() {
    panel.innerHTML = '';
    const head = el('div', 'dress-head');
    head.append(el('span', 'dress-title', `Dress up · ${typeof agentLabel === 'function' ? agentLabel(session.source, session.id) : 'Robot'}`));
    const x = el('button', 'dress-close', '✕');
    x.title = 'Close (Esc)';
    x.addEventListener('click', close);
    head.append(x);

    const body = el('div', 'dress-body');
    const prev = el('div', 'dress-preview');
    const img = el('img');
    img.alt = '';
    img.draggable = false;
    prev.append(img);

    const opts = el('div', 'dress-options');
    for (const [kind, label] of KINDS) {
      const sec = el('div', 'dress-section');
      sec.append(el('div', 'dress-label', label));
      const row = el('div', 'dress-items');
      const pick = (id) => {
        if (id) {
          outfit[kind] = id;
          if (!outfit[kind + 'Color']) outfit[kind + 'Color'] = CAT[kind].find((i) => i.id === id).color;
        } else {
          delete outfit[kind];
          delete outfit[kind + 'Color'];
        }
        apply();
        render();
      };
      const none = el('button', 'dress-item' + (outfit[kind] ? '' : ' selected'), 'None');
      none.addEventListener('click', () => pick(null));
      row.append(none);
      for (const it of CAT[kind]) {
        const b = el('button', 'dress-item' + (outfit[kind] === it.id ? ' selected' : ''));
        b.append(el('span', 'dress-ico', it.icon), el('span', null, it.label));
        b.title = it.label;
        b.addEventListener('click', () => pick(it.id));
        row.append(b);
      }
      sec.append(row);
      if (outfit[kind]) {
        const sw = el('div', 'dress-swatches');
        const cur = (outfit[kind + 'Color'] || '').toLowerCase();
        for (const c of CAT.swatches) {
          const s = el('button', 'dress-swatch' + (cur === c ? ' selected' : ''));
          s.style.background = c;
          s.title = c;
          s.addEventListener('click', () => { outfit[kind + 'Color'] = c; apply(); render(); });
          sw.append(s);
        }
        sec.append(sw);
      }
      opts.append(sec);
    }
    body.append(prev, opts);

    const foot = el('div', 'dress-foot');
    const own = Object.prototype.hasOwnProperty.call(window.robotOutfits, session.id);
    foot.append(el('span', 'dress-hint', own ? 'This chat only' : (window.robotOutfits['*'] ? 'Using the outfit for all robots' : 'This chat only')));
    const all = el('button', 'dress-btn', 'Use for all robots');
    all.title = 'Every chat without its own outfit wears this';
    all.addEventListener('click', () => {
      window.setRobotOutfit('*', outfit);
      window.setRobotOutfit(session.id, null); // follow the shared one from now on
      render();
    });
    const reset = el('button', 'dress-btn', 'Take off');
    reset.title = 'Remove everything from this robot';
    reset.addEventListener('click', () => { outfit = {}; apply(); render(); });
    foot.append(all, reset);

    panel.append(head, body, foot);
    renderPreview();
  }

  function place() {
    const r = dp.getBoundingClientRect();
    const w = panel.offsetWidth, h = panel.offsetHeight;
    let left = r.right + 8, top = r.top;
    if (left + w > window.innerWidth - 6) left = Math.max(6, window.innerWidth - w - 6);
    if (top + h > window.innerHeight - 6) top = Math.max(6, window.innerHeight - h - 6);
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
  }

  dp.addEventListener('click', (e) => {
    e.stopPropagation();
    const s = currentActiveSession;
    if (!s) return;
    if (panel.style.display !== 'none' && session && session.id === s.id) { close(); return; }
    session = s;
    outfit = currentOutfitOf(s);
    render();
    panel.style.display = '';
    place();
  });
  window.addEventListener('resize', () => { if (panel.style.display !== 'none') place(); });
})();
