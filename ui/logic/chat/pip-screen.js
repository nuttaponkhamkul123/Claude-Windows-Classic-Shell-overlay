// Shelter chat screen, laid out like the amber Pip-Boy 3000A screen (see theme-shelter-pip.css):
//   a top line with the session title set into it and stat boxes (git · model · context · cost) ·
//   filter tabs (All / You / Claude) · transcript as a list on the left · a readout panel on the right ·
//   a status bar above the input (what Claude is doing + Stop) · the toolbar as tabs on a line at the bottom.
// (The working line with the robot, above the input, is hidden.)
// The panel and bar only show in the Shelter style; in the other styles this file's elements are hidden
// and the wrapper around the transcript has no effect (display: contents).
// All numbers come from what the chat header already shows, so nothing new is fetched.
(function () {
  const q0 = (s) => document.querySelector(s);
  const stream = document.getElementById('chatStream');
  const reply = document.querySelector('.reply-section');
  if (!stream || !reply) return;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // transcript + readout side by side
  const body = el('div', 'pip-body');
  stream.parentNode.insertBefore(body, stream);
  body.appendChild(stream);
  // scan lines over the screen: their own layer, so the panel's ::before/::after stay free
  // (focus mode draws its speech-bubble pointer with them)
  const scan = el('div', 'pip-scan');
  document.getElementById('detailView')?.appendChild(scan);

  // CRT effect on the chat screen (Settings → "CRT screen effect", on by default; Shelter only):
  // curved-glass vignette, a slow refresh band, a faint flicker and a power-on when a chat opens.
  const api = window.electronAPI;
  let crtOn = api?.settings?.crtEffect !== false;
  const applyCrt = () => document.body.classList.toggle('pip-crt', crtOn);
  applyCrt();
  const restartRow = document.getElementById('btnShowAg') || document.getElementById('btnRestartApp');
  if (restartRow) {
    const row = el('button', 'set-row pip-crt-row');
    row.id = 'btnCrt';
    row.title = 'Scan lines, curved-glass edges, a slow refresh band and a soft flicker on the chat screen (Shelter style)';
    row.append(el('span', 'set-ico', '📺'), el('span', 'set-label', 'CRT screen effect'), el('span', 'set-check'));
    row.classList.toggle('active', crtOn);
    row.addEventListener('click', () => {
      crtOn = !crtOn;
      api?.storeSet?.('crtEffect', crtOn);
      row.classList.toggle('active', crtOn);
      applyCrt();
    });
    restartRow.after(row);
  }
  // power-on: replay a short "tube warming up" each time a chat screen opens
  const dv = document.getElementById('detailView');
  if (dv) {
    let wasActive = dv.classList.contains('active');
    new MutationObserver(() => {
      const now = dv.classList.contains('active');
      if (now && !wasActive && crtOn) { dv.classList.remove('pip-crt-on'); void dv.offsetWidth; dv.classList.add('pip-crt-on'); }
      wasActive = now;
    }).observe(dv, { attributes: true, attributeFilter: ['class'] });
    dv.addEventListener('animationend', (e) => { if (e.animationName === 'pip-crt-power') dv.classList.remove('pip-crt-on'); });
    // a narrow chat panel (a chat open beside the Vault in a small window): the CSS switches to a tighter layout
    // (two rows of tabs, a wrapping input toolbar, no model box on the top line)
    const NARROW = 430;
    new ResizeObserver(() => {
      const narrow = dv.clientWidth > 0 && dv.clientWidth < NARROW;
      if (dv.classList.contains('pip-narrow') !== narrow) dv.classList.toggle('pip-narrow', narrow);
    }).observe(dv);
  }
  const stats = el('aside', 'pip-stats');
  body.appendChild(stats);

  // filter tabs above the transcript
  const subs = el('div', 'pip-subtabs');
  const FILTERS = [['all', 'All'], ['you', 'You'], ['claude', 'Claude']];
  for (const [id, label] of FILTERS) {
    const b = el('button', 'pip-subtab' + (id === 'all' ? ' on' : ''), label);
    b.addEventListener('click', () => {
      stream.dataset.pipFilter = id;
      subs.querySelectorAll('.pip-subtab').forEach((x) => x.classList.toggle('on', x === b));
    });
    subs.appendChild(b);
  }
  body.before(subs);
  stream.dataset.pipFilter = 'all';

  // toolbar → screen tabs: a CHAT tab (the current screen), plain labels, the ‹ and ⛶ keys as round badges
  const tb = q0('#detailView .convo-toolbar');
  const chatTab = el('button', 'tb-btn pip-current', 'Chat');
  chatTab.title = 'This chat';
  chatTab.addEventListener('click', () => document.getElementById('replyTextarea')?.focus());
  if (tb) { const back = tb.querySelector('.xb-close'); if (back) back.after(chatTab); else tb.prepend(chatTab); }
  function relabel() {
    if (!tb) return;
    tb.querySelectorAll(':scope > .tb-btn').forEach((b) => {
      if (b.hidden || b.style.display === 'none') return;
      let t = '';
      b.childNodes.forEach((n) => {
        if (n.nodeType === 3) t += n.textContent;
        else if (n.nodeType === 1 && !/pip-lbl|notes-badge/.test(n.className)) t += n.textContent;
      });
      const badge = b.classList.contains('xb-close') || b.id === 'tbMax';
      // plain words only: no emoji, no ▾ carets
      t = (badge ? t : t.replace(/[▾▴▸‹⛶]|\p{Extended_Pictographic}|️/gu, '')).replace(/\s+/g, ' ').trim();
      let l = b.querySelector(':scope > .pip-lbl');
      if (!l) { l = document.createElement('span'); l.className = 'pip-lbl'; b.appendChild(l); }
      if (b.id === 'tbMax') t = '⛶';
      if (l.textContent !== t) l.textContent = t;
    });
  }

  // top line: the session title set into the line, then stat boxes, like STATS · LVL · HP · AP · XP
  const head = el('div', 'pip-head');
  const hTitle = el('span', 'pip-head-title');
  // the title is the session's name (the one you gave it); click it to rename, like the name in the old header
  hTitle.addEventListener('click', () => q('#convoName')?.click());
  const hGit = el('button', 'pip-hseg pip-hgit'), hModel = el('span', 'pip-hseg'), hCtx = el('span', 'pip-hseg'), hCost = el('span', 'pip-hseg');
  hGit.title = 'Git changes (opens the changes panel)';
  hGit.addEventListener('click', () => q('.git-box')?.click());
  const first = el('span', 'pip-hbox pip-hbox-first');
  first.append(hTitle, hGit);
  const box = (seg) => { const b = el('span', 'pip-hbox'); b.appendChild(seg); return b; };
  head.append(first, box(hModel), box(hCtx), box(hCost));
  document.getElementById('detailView')?.prepend(head);

  // The small status text in the input's toolbar ("⚡ Sent to Claude! Thinking…", "✓ Claude replied") repeats what the
  // bar above the input shows, so in this style it is hidden while it is only progress. Warnings and notes
  // ("⚠ That folder no longer exists", "Added to your message…") are marked differently and stay.
  const msgEl = document.getElementById('replyStatusMsg');
  if (msgEl) {
    const PROGRESS = /^\s*(⚡|⏳\s*Queued|✓.*(replied|Sent to))/; // ("Queued": the queue card above the input says it)
    const mark = () => { const p = PROGRESS.test(msgEl.textContent || ''); if (msgEl.classList.contains('pip-progress') !== p) msgEl.classList.toggle('pip-progress', p); };
    new MutationObserver(mark).observe(msgEl, { childList: true, characterData: true, subtree: true });
    mark();
  }

  // status bar above the input: what Claude is doing right now · Stop.
  // (The working line with the robot, above the input, is hidden in this layout; its text and Stop live here.)
  const bar = el('div', 'pip-status');
  const segNow = el('span', 'pip-seg wide');
  const segStop = el('button', 'pip-seg pip-stop', '■ Stop');
  segStop.hidden = true;
  segStop.title = 'Stop this reply';
  segStop.addEventListener('click', () => q('#activityRow .activity-stop')?.click());
  bar.append(segNow, segStop);
  // sits directly on top of the input box (where the old working line was)
  const inputBox = reply.querySelector('.queue-bar') || reply.querySelector('.reply-box'); // above the queue card, if there is one
  if (inputBox) inputBox.before(bar); else reply.after(bar);
  const setText = (e, t) => { if (e.textContent !== t) e.textContent = t; };

  function updateBar(r) {
    const get = (k) => r.find((x) => x.k === k)?.v || '';
    const act = q('#activityRow');
    const busy = !!act && act.style.display !== 'none';
    // the session's name if you renamed it, else its title ("Claude" / "Antigravity" alone says nothing)
    const nameEl = q('#convoName');
    const named = nameEl && !nameEl.querySelector('input') ? text('#convoName') : '';
    const title = named && !/^(claude|antigravity)$/i.test(named) ? named : (text('#convoPersonal') || named || 'Chat');
    setText(hTitle, title);
    hTitle.title = ['Click to rename', q('#convoPersonal')?.title].filter(Boolean).join('\n');
    const branch = get('Branch'), changes = get('Changes');
    setText(hGit, branch ? [branch, changes].filter(Boolean).join(' · ') : '');
    hGit.hidden = !branch;
    setText(hModel, get('Model'));
    setText(hCtx, get('Context'));
    hCtx.title = 'Context used';
    setText(hCost, get('Cost'));
    setText(segNow, busy ? [text('#activityVerb'), text('#activityMeta'), text('#activityTarget')].filter(Boolean).join(' · ') || get('Status') : get('Status'));
    segNow.classList.toggle('busy', busy);
    segStop.hidden = !(busy && act.querySelector('.activity-stop'));
  }

  const q = (sel) => document.querySelector(sel);
  const text = (sel) => (q(sel)?.textContent || '').replace(/\s+/g, ' ').trim();
  let lastKey = '', pictureFor = '';
  const picture = el('div', 'pip-picture');

  function rows(s) {
    const used = s.context?.used || 0, win = s.context?.window || 0;
    const chip = text('.cost-chip');
    const cost = (chip.match(/\$[\d.,]+/) || [''])[0];
    const today = (chip.match(/([\d.]+\s?[KMB]?)\s+tokens today/i) || [])[1] || '';
    const model = text('.rt-model').replace(/[▾▴]/g, '').trim();
    const dirty = text('.git-dirty') || text('.git-clean');
    const out = [];
    out.push({ k: 'Status', v: text('#convoStatus').replace(/[()]/g, '') || '—' });
    if (model) out.push({ k: 'Model', v: model });
    if (win && used) out.push({ k: 'Context', v: `${fmtTokens(used)} / ${fmtTokens(win)}`, pct: Math.min(100, Math.round((used / win) * 100)), warn: used >= 150000 });
    if (cost) out.push({ k: 'Cost', v: cost });
    if (today) out.push({ k: 'Today', v: today });
    const branch = text('.git-branch');
    if (branch) out.push({ k: 'Branch', v: branch });
    if (dirty) out.push({ k: 'Changes', v: dirty, click: () => q('.git-box')?.click() });
    const qn = Number(q('.queue-bar')?.dataset.count || 0);
    if (qn) out.push({ k: 'Queue', v: `${qn} waiting`, click: () => q('.queue-head')?.click() });
    if (q('.handoff-btn')) out.push({ k: 'Hand off', v: '↗', click: () => q('.handoff-btn')?.click(), hot: q('.handoff-btn').classList.contains('hot') });
    return out;
  }

  function update() {
    const s = typeof currentActiveSession !== 'undefined' ? currentActiveSession : null;
    if (!s || !document.body.classList.contains('style-shelter') || !q('#detailView.active')) return;
    relabel();
    const r = rows(s);
    updateBar(r);
    const key = JSON.stringify(r.map((x) => [x.k, x.v, x.pct, x.hot])) + '|' + s.id;
    if (key === lastKey) return;
    lastKey = key;

    // the picture: the agent robot, drawn in the screen's green by CSS
    if (pictureFor !== s.id) {
      pictureFor = s.id;
      picture.innerHTML = typeof window.buildRunnerSvg === 'function'
        ? window.buildRunnerSvg(typeof robotHueFor === 'function' ? robotHueFor(s) : 120, null, 'stand') : '';
    }
    stats.textContent = '';
    stats.appendChild(picture);
    for (const x of r) {
      const row = el('div', 'pip-row' + (x.pct != null ? ' pct' : '') + (x.warn ? ' warn' : '') + (x.click ? ' link' : '') + (x.hot ? ' hot' : ''));
      if (x.pct != null) row.style.setProperty('--p', x.pct + '%');
      row.append(el('span', 'pip-k', x.k), el('b', 'pip-v', x.v));
      if (x.click) row.addEventListener('click', x.click);
      stats.appendChild(row);
    }
  }
  setInterval(update, 500);
})();
