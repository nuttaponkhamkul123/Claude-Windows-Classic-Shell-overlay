// Avatar stage, laid out like the Pip-Boy STATS screen (Fallout 3 / 4): click the robot picture on the chat screen's
// readout panel and it slowly walks to the middle of the chat screen and grows. Around the figure sit short bars
// (HAT above the head, GLASSES at the face, CLOTHES at the body, COLOUR at the feet, plus two plain ones for the look
// of it), the chat's name sits under it, a strip of small pictures along the bottom shows what you can put on, and a
// status bar under that shows the model, how full the chat is, and what it cost. Every choice shows on the avatar at
// once and is saved (robot-outfits.js: setRobotOutfit / setRobotHue). DONE, Esc, or a click on the empty screen sends
// it slowly back to the panel.
//   Keys: ← → pick the previous / next, ↑ ↓ change category, Esc close
//   window.openAvatarStage()   window.closeAvatarStage()   window.avatarStageOpen()
(function () {
  const CAT = window.ROBOT_OUTFIT_CATALOG;
  if (!CAT || typeof window.buildRunnerSvg !== 'function' || typeof window.setRobotOutfit !== 'function') return;

  const mk = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const CATS = [['hat', 'Hat'], ['glasses', 'Glasses'], ['clothes', 'Clothes'], ['body', 'Colour']];
  const MOVE_MS = 1300;      // the walk to the middle, slow on purpose
  const BACK_MS = 950;
  const EASE = 'cubic-bezier(.45, .05, .2, 1)';
  // which part of the 40 x 52 picture each category's little pictures show
  const CROP = { hat: '6 -19 28 34', glasses: '7 -1 26 24', clothes: '9 14 22 22', body: '6 -3 28 26' };
  const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dur = (ms) => (reduced() ? 1 : ms);

  let st = null; // { root, actor, session, outfit, cat, moving, mono, ro, cost }

  const bodyBox = () => document.querySelector('#detailView .pip-body');
  const picture = () => document.querySelector('#detailView .pip-picture');
  const hueOf = (s) => (typeof robotHueFor === 'function' ? robotHueFor(s) : 120);
  const labelOf = (kind, id) => { const it = (CAT[kind] || []).find((x) => x.id === id); return it ? it.label : 'None'; };
  const hasHue = () => !!(window.hasRobotHue && window.hasRobotHue(st.session.id));

  function svgFor() { return window.buildRunnerSvg(hueOf(st.session), st.outfit, 'front'); }
  function paintActor() { const sway = st.actor && st.actor.querySelector('.av-sway'); if (sway) sway.innerHTML = svgFor(); }

  // ---- geometry: the stage covers the chat screen; the avatar's slot is the middle of the field ----
  function fit() {
    const b = bodyBox();
    if (!st || !b) return;
    const r = b.getBoundingClientRect();
    Object.assign(st.root.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    st.root.classList.toggle('av-narrow', r.width < 560);
    st.root.classList.toggle('av-short', r.height < 300);
  }
  const slotRect = () => st.root.querySelector('.av-slot').getBoundingClientRect();
  function placeActor(rect) {
    Object.assign(st.actor.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' });
  }

  // ---- the bars around the figure ----
  // x / y are fractions of the avatar's box (negative / above 1 = outside it); side = which way the label reads
  const MARKS = [
    { cat: 'hat', x: 0.5, y: -0.045, side: 'r', bar: 'h' },
    { cat: 'glasses', x: -0.12, y: 0.2, side: 'l', bar: 'h' },
    { cat: 'clothes', x: -0.12, y: 0.55, side: 'l', bar: 'h' },
    { cat: 'body', x: 1.12, y: 0.86, side: 'r', bar: 'h' },
    { cat: null, x: 1.12, y: 0.2, side: 'r', bar: 'h' },     // plain ones, as on the real screen
    { cat: null, x: 1.12, y: 0.55, side: 'r', bar: 'h' },
    { cat: null, x: 0.5, y: 1.04, side: 'r', bar: 'h' },
  ];
  function drawMarks() {
    const field = st.root.querySelector('.av-field');
    const layer = field.querySelector('.av-marks');
    layer.textContent = '';
    const f = field.getBoundingClientRect(), s = slotRect();
    for (const m of MARKS) {
      const cx = s.left - f.left + s.width * m.x, cy = s.top - f.top + s.height * m.y;
      const el = mk(m.cat ? 'button' : 'div', 'av-mark' + (m.cat ? '' : ' plain') + (m.cat && st.cat === m.cat ? ' on' : '') + ' side-' + m.side);
      el.style.left = cx + 'px';
      el.style.top = cy + 'px';
      if (m.x === 0.5) el.classList.add('center');
      el.append(mk('i', 'av-bar'));
      if (m.cat) {
        const val = m.cat === 'body' ? (hasHue() ? 'Custom' : 'Auto') : labelOf(m.cat, st.outfit[m.cat]);
        el.append(mk('span', 'av-mlabel', `${CATS.find(([k]) => k === m.cat)[1]} · ${val}`));
        el.title = 'Choose ' + CATS.find(([k]) => k === m.cat)[1].toLowerCase();
        el.addEventListener('click', () => setCat(m.cat));
      }
      layer.appendChild(el);
    }
  }

  // ---- top line: the categories as tabs, and the keys ----
  function drawTabs() {
    const t = st.root.querySelector('.av-tabs');
    t.textContent = '';
    t.appendChild(mk('span', 'av-title', 'Avatar'));
    const row = mk('div', 'av-tabrow');
    for (const [k, label] of CATS) {
      const b = mk('button', 'av-tab' + (st.cat === k ? ' on' : ''), label);
      b.addEventListener('click', () => setCat(k));
      row.appendChild(b);
    }
    t.appendChild(row);
    const keys = mk('div', 'av-keys');
    const takeOff = mk('button', 'av-btn', 'Take off');
    takeOff.title = 'Remove the hat, glasses and clothes';
    takeOff.addEventListener('click', () => { st.outfit = {}; apply(); });
    const all = mk('button', 'av-btn', 'All robots');
    all.title = 'Every chat without its own outfit wears this one';
    all.addEventListener('click', () => {
      window.setRobotOutfit('*', { ...st.outfit });
      window.setRobotOutfit(st.session.id, null); // follow the shared one from now on
      drawName();
    });
    const mono = mk('button', 'av-btn' + (st.mono ? ' lit' : ''), 'Amber');
    mono.title = 'Show the avatar in the screen\'s amber, like the real thing';
    mono.addEventListener('click', () => { st.mono = !st.mono; st.actor.classList.toggle('mono', st.mono); mono.classList.toggle('lit', st.mono); });
    const done = mk('button', 'av-btn primary', 'Done');
    done.addEventListener('click', close);
    keys.append(takeOff, all, mono, done);
    t.appendChild(keys);
  }

  function drawName() {
    const own = Object.prototype.hasOwnProperty.call(window.robotOutfits || {}, st.session.id);
    const shared = !own && window.robotOutfits && window.robotOutfits['*'];
    const name = st.session.sessionTitle || st.session.project || 'Robot';
    st.root.querySelector('.av-name').textContent = name;
    st.root.querySelector('.av-scope').textContent = shared ? 'All robots' : 'This chat only';
  }

  // ---- the strip of little pictures along the bottom: what you can put on in this category ----
  function thumb(kind, id) {
    const col = (st.outfit[kind + 'Color'] || (CAT[kind] && CAT[kind].find((i) => i.id === id)?.color)) || '#3faa4a';
    const o = kind === 'body' ? null : { [kind]: id, [kind + 'Color']: col };
    let svg = window.buildRunnerSvg(kind === 'body' ? id : hueOf(st.session), o, 'front');
    svg = svg.replace('viewBox="0 -5 40 52"', `viewBox="${CROP[kind]}"`);
    return svg;
  }
  function drawStrip() {
    const strip = st.root.querySelector('.av-strip');
    const sw = st.root.querySelector('.av-swatches');
    strip.textContent = '';
    sw.textContent = '';
    const k = st.cat;
    const box = (cls, svgOrText, label, on, fn) => {
      const b = mk('button', 'av-opt' + (on ? ' on' : '') + (cls ? ' ' + cls : ''));
      if (svgOrText.startsWith('<svg')) b.innerHTML = svgOrText; else b.appendChild(mk('span', 'av-none', svgOrText));
      b.title = label;
      b.addEventListener('click', fn);
      strip.appendChild(b);
      return b;
    };
    if (k === 'body') {
      box('', '—', 'Auto: the colour this chat gets by itself', !hasHue(), () => { window.setRobotHue(st.session.id, null); paintActor(); refresh(); });
      for (let h = 0; h < 360; h += 30) {
        box('', thumb('body', h), 'Body colour', hasHue() && hueOf(st.session) === h, () => { window.setRobotHue(st.session.id, h); paintActor(); refresh(); });
      }
    } else {
      box('', '—', 'None', !st.outfit[k], () => pick(k, null));
      for (const it of CAT[k]) box('', thumb(k, it.id), it.label, st.outfit[k] === it.id, () => pick(k, it.id));
      if (st.outfit[k]) {
        const cur = (st.outfit[k + 'Color'] || '').toLowerCase();
        for (const c of CAT.swatches) {
          const s = mk('button', 'av-swatch' + (cur === c ? ' on' : ''));
          s.style.background = c;
          s.title = c;
          s.addEventListener('click', () => { st.outfit[k + 'Color'] = c; apply(); });
          sw.appendChild(s);
        }
      }
    }
    strip.querySelector('.on')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }

  // ---- the bar at the very bottom: model | how full the chat is | cost ----
  function drawStatus() {
    const s = st.session;
    const bar = st.root.querySelector('.av-status');
    bar.textContent = '';
    const model = String(s.model || '').replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/-/g, ' ');
    const ctx = s.context && s.context.window ? Math.min(100, Math.round(100 * s.context.used / s.context.window)) : null;
    const left = mk('span', 'av-seg', model || 'Model');
    const mid = mk('span', 'av-seg av-seg-mid');
    mid.append(mk('span', null, 'Context'), (() => { const b = mk('span', 'av-meter'); const f = mk('i'); f.style.width = (ctx == null ? 0 : ctx) + '%'; b.appendChild(f); return b; })(), mk('span', null, ctx == null ? '' : ctx + '%'));
    const right = mk('span', 'av-seg', st.cost == null ? '' : '$' + (st.cost < 10 ? st.cost.toFixed(2) : st.cost.toFixed(0)));
    bar.append(left, mid, right);
  }

  // ---- changing things ----
  function refresh() { drawTabs(); drawMarks(); drawStrip(); drawName(); }
  function apply() {
    window.setRobotOutfit(st.session.id, { ...st.outfit });
    paintActor();
    refresh();
  }
  function pick(kind, id) {
    if (id) {
      st.outfit[kind] = id;
      if (!st.outfit[kind + 'Color']) st.outfit[kind + 'Color'] = CAT[kind].find((i) => i.id === id).color;
    } else { delete st.outfit[kind]; delete st.outfit[kind + 'Color']; }
    apply();
  }
  function setCat(k) { st.cat = k; refresh(); }
  function stepItem(dir) {
    const k = st.cat;
    if (k === 'body') {
      const hues = [null]; for (let h = 0; h < 360; h += 30) hues.push(h);
      const i = Math.max(0, hues.indexOf(hasHue() ? hueOf(st.session) : null));
      const next = hues[(i + dir + hues.length) % hues.length];
      window.setRobotHue(st.session.id, next); paintActor(); refresh();
      return;
    }
    const ids = [null, ...CAT[k].map((i) => i.id)];
    const i = Math.max(0, ids.indexOf(st.outfit[k] || null));
    pick(k, ids[(i + dir + ids.length) % ids.length]);
  }

  function onKey(e) {
    if (!st || st.moving) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); stepItem(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); stepItem(-1); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const i = CATS.findIndex(([k]) => k === st.cat);
      setCat(CATS[(i + (e.key === 'ArrowDown' ? 1 : CATS.length - 1)) % CATS.length][0]);
    }
  }

  // ---- open: the picture walks to the middle ----
  function open() {
    const s = typeof currentActiveSession !== 'undefined' ? currentActiveSession : null;
    const pic = picture(), body = bodyBox();
    if (st || !s || !pic || !body || !document.body.classList.contains('style-shelter')) return;
    const from = (pic.querySelector('svg') || pic).getBoundingClientRect();
    st = { session: s, outfit: { ...(window.robotOutfitShown ? window.robotOutfitShown(s) : {}) }, cat: 'hat', moving: true, mono: false, root: null, actor: null, ro: null, cost: null };

    const root = mk('div', 'av-stage');
    st.root = root;
    const field = mk('div', 'av-field');
    const slot = mk('div', 'av-slot');
    const marks = mk('div', 'av-marks');
    const caption = mk('div', 'av-caption');
    caption.append(mk('span', 'av-name'), mk('span', 'av-scope'));
    const swatches = mk('div', 'av-swatches');
    field.append(marks, slot, caption, swatches);
    root.append(mk('div', 'av-tabs'), field, mk('div', 'av-strip'), mk('div', 'av-status'));
    root.addEventListener('click', (e) => { if (e.target === root || e.target === field || e.target === slot) close(); });
    document.body.appendChild(root);

    const actor = mk('div', 'av-actor');
    actor.appendChild(mk('div', 'av-sway'));
    st.actor = actor;
    document.body.appendChild(actor);
    fit();
    refresh();
    drawStatus();
    paintActor();
    const to = slotRect();
    placeActor(to);
    pic.style.visibility = 'hidden';
    if (window.electronAPI && window.electronAPI.getSessionCosts) {
      window.electronAPI.getSessionCosts([s.id]).then((c) => { if (st && st.session === s && c && typeof c[s.id] === 'number') { st.cost = c[s.id]; drawStatus(); } }).catch(() => {});
    }

    // the same picture as on the panel (amber) turns into its true colours while it walks; the screen lights up behind it
    actor.style.transformOrigin = '0 0';
    actor.classList.add('amber');
    const fromT = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width || 1}, ${from.height / to.height || 1})`;
    requestAnimationFrame(() => { root.classList.add('on'); actor.classList.remove('amber'); });
    const anim = actor.animate([{ transform: fromT }, { transform: 'none' }], { duration: dur(MOVE_MS), easing: EASE, fill: 'both' });
    const arrived = () => {
      if (!st) return;
      st.moving = false;
      drawMarks();                    // the bars are placed around the avatar where it now stands
      root.classList.add('ready');    // bars, strip and status fade in
      actor.classList.add('idle');    // a slow sway
    };
    anim.finished.then(arrived, arrived);

    st.ro = new ResizeObserver(() => onResize());
    st.ro.observe(body);
    window.addEventListener('resize', onResize);
    document.addEventListener('keydown', onKey, true);
  }
  function onResize() { if (st && !st.moving) { fit(); placeActor(slotRect()); drawMarks(); } }

  // ---- close: it walks back to the panel ----
  function close() {
    if (!st || st.moving) return;
    const cur = st;
    cur.moving = true;
    cur.root.classList.remove('ready');
    cur.actor.classList.remove('idle', 'mono');
    cur.actor.classList.add('amber');
    const pic = picture();
    const finish = () => {
      if (pic) pic.style.visibility = '';
      cur.actor.remove(); cur.root.remove();
      cur.ro && cur.ro.disconnect();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('keydown', onKey, true);
      if (st === cur) st = null;
    };
    if (!pic || !pic.isConnected) { finish(); return; }
    const to = (pic.querySelector('svg') || pic).getBoundingClientRect();
    const here = cur.actor.getBoundingClientRect();
    cur.root.classList.remove('on');
    cur.actor.getAnimations().forEach((a) => a.cancel());
    const toT = `translate(${to.left - here.left}px, ${to.top - here.top}px) scale(${to.width / here.width || 1}, ${to.height / here.height || 1})`;
    const anim = cur.actor.animate([{ transform: 'none' }, { transform: toT }], { duration: dur(BACK_MS), easing: EASE, fill: 'both' });
    anim.finished.then(finish, finish);
  }

  window.openAvatarStage = open;
  window.closeAvatarStage = close;
  window.avatarStageOpen = () => !!st;

  document.addEventListener('click', (e) => {
    const p = e.target.closest && e.target.closest('#detailView .pip-picture');
    if (p) open();
  });
  document.addEventListener('mouseover', (e) => {
    const p = e.target.closest && e.target.closest('#detailView .pip-picture');
    if (p && !p.title) p.title = 'Click to customise the avatar';
  });
  // leaving the chat closes the stage at once (nothing to walk back to)
  uiInterval(() => {
    if (!st || st.moving) return;
    const s = typeof currentActiveSession !== 'undefined' ? currentActiveSession : null;
    if (!s || s.id !== st.session.id || !document.querySelector('#detailView.active')) {
      const pic = picture(); if (pic) pic.style.visibility = '';
      st.actor.remove(); st.root.remove(); st.ro && st.ro.disconnect();
      window.removeEventListener('resize', onResize); document.removeEventListener('keydown', onKey, true);
      st = null;
    } else drawStatus();
  }, 2000);
})();
