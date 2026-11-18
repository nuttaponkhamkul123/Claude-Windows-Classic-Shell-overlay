// Vault layout. "Normal" stacks every room full width. "Free" puts rooms on a 4-column grid where each
// room is a SHAPE made of blocks (bar, box, L, T, step…), dug out of the rock. See docs/design/room-shapes.html.
//
// How a shaped room is drawn: its robots, furniture and window live on the room's main floor (its longest
// run of blocks); the other blocks are extra rooms of the same colour, joined by ladders.
// Right-click a room → "Edit layout…": drag a room to move it, pick a shape, R / F to rotate / flip,
// click rock next to it to dig, right-click one of its blocks to fill it in.
//
// Saved as the `vaultLayout` setting: { mode: 'normal' | 'free', rooms: { <room key>: { cells: [[col,row], …] } } }
// app.js calls arrange() before drawing the rooms, place() for each one, and afterRender() at the end.
(function () {
  const api = window.electronAPI;
  const COLS = 4, MAX_ROWS = 14;
  const SHAPES = {
    bar4:  { name: 'Bar 4', cells: [[0,0],[1,0],[2,0],[3,0]] },
    bar2:  { name: 'Bar 2', cells: [[0,0],[1,0]] },
    block: { name: 'Block', cells: [[0,0]] },
    box:   { name: 'Box', cells: [[0,0],[1,0],[0,1],[1,1]] },
    L:     { name: 'L', cells: [[0,0],[0,1],[1,1],[2,1]] },
    revL:  { name: 'Rev. L', cells: [[2,0],[0,1],[1,1],[2,1]] },
    T:     { name: 'T', cells: [[0,0],[1,0],[2,0],[1,1]] },
    step:  { name: 'Step', cells: [[0,0],[1,0],[1,1],[2,1]] },
  };

  // ---------- saved state ----------
  const validCells = (c) => Array.isArray(c) && c.length > 0 && c.length <= 16 &&
    c.every((p) => Array.isArray(p) && Number.isInteger(p[0]) && Number.isInteger(p[1]) && p[0] >= 0 && p[0] < COLS && p[1] >= 0 && p[1] < MAX_ROWS);
  let state = { mode: 'normal', rooms: {} };
  try {
    const s = api.settings?.vaultLayout;
    if (s && typeof s === 'object') {
      state.mode = s.mode === 'free' ? 'free' : 'normal';
      for (const [k, v] of Object.entries(s.rooms || {})) if (validCells(v?.cells)) state.rooms[k] = { cells: v.cells.map((p) => [p[0], p[1]]) };
    }
  } catch (_) { /* keep the default */ }
  let saveTimer = null;
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => api.storeSet?.('vaultLayout', state), 150); };
  const redraw = () => { if (typeof renderSessionCards === 'function') renderSessionCards(true); };
  const isHidden = (k) => typeof hiddenRooms !== 'undefined' && hiddenRooms.has(k);
  // Free only applies where the Vault is on screen. Work, Pip-Boy and the List view show plain rows, not rooms:
  // there the saved Free layout must stay out of the way (it used to hide the rows and show the room).
  const free = () => state.mode === 'free' && document.body.classList.contains('list-grid');

  // ---------- geometry (cells are [col, row]) ----------
  const ck = (c, r) => c + ',' + r;
  function owner(except) {
    const m = new Map();
    for (const [key, rm] of Object.entries(state.rooms)) {
      if (key === except || isHidden(key)) continue;
      for (const [c, r] of rm.cells) m.set(ck(c, r), key);
    }
    return m;
  }
  function connected(cells) {
    if (!cells.length) return false;
    const set = new Set(cells.map(([c, r]) => ck(c, r))), seen = new Set([ck(...cells[0])]), q = [cells[0]];
    while (q.length) {
      const [c, r] = q.pop();
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = ck(c + dc, r + dr);
        if (set.has(k) && !seen.has(k)) { seen.add(k); q.push([c + dc, r + dr]); }
      }
    }
    return seen.size === set.size;
  }
  // may these cells be this room's? (inside the grid, free of other rooms, in one piece)
  function fits(cells, key) {
    const own = owner(key);
    return validCells(cells) && cells.every(([c, r]) => !own.has(ck(c, r))) && connected(cells);
  }
  const norm = (cells) => { const mc = Math.min(...cells.map((x) => x[0])), mr = Math.min(...cells.map((x) => x[1])); return cells.map(([c, r]) => [c - mc, r - mr]); };
  const rotate = (cells) => norm(cells.map(([c, r]) => [-r, c]));   // 90° clockwise
  const flip = (cells) => norm(cells.map(([c, r]) => [-c, r]));     // L ↔ reversed L
  const shift = (cells, dc, dr) => cells.map(([c, r]) => [c + dc, r + dr]);
  const origin = (cells) => [Math.min(...cells.map((x) => x[0])), Math.min(...cells.map((x) => x[1]))];

  // the room's main floor: its longest run of blocks in one row (lowest row wins a tie)
  function split(cells) {
    let best = null;
    for (const r of [...new Set(cells.map((x) => x[1]))]) {
      const cs = cells.filter((x) => x[1] === r).map((x) => x[0]).sort((a, b) => a - b);
      let start = cs[0];
      for (let i = 1; i <= cs.length; i++) {
        if (i === cs.length || cs[i] !== cs[i - 1] + 1) {
          const run = { r, c0: start, len: cs[i - 1] - start + 1 };
          if (!best || run.len > best.len || (run.len === best.len && run.r > best.r)) best = run;
          start = cs[i];
        }
      }
    }
    const annex = cells.filter(([c, r]) => !(r === best.r && c >= best.c0 && c < best.c0 + best.len));
    return { run: best, annex };
  }

  // a new room: a Bar 2 in the first free spot
  function ensure(key) {
    if (state.rooms[key] && !isHidden(key)) return state.rooms[key].cells;
    const own = owner(key);
    let cells = null;
    for (let r = 0; r < MAX_ROWS && !cells; r++) {
      for (let c = 0; c <= COLS - 2 && !cells; c++) if (!own.has(ck(c, r)) && !own.has(ck(c + 1, r))) cells = [[c, r], [c + 1, r]];
    }
    state.rooms[key] = { cells: cells || [[0, MAX_ROWS - 1]] };
    save();
    return state.rooms[key].cells;
  }

  // ---------- drawing hooks (called from app.js / features.js) ----------
  function arrange(groups) {
    document.body.classList.toggle('vault-free', free());
    return groups;
  }
  function place(groupEl, key) {
    if (!free() || groupEl.classList.contains('vault-hidden')) return;
    const room = groupEl.querySelector(':scope > .vault-room');
    if (!room) return;
    const cells = ensure(key);
    const { run, annex } = split(cells);
    groupEl.classList.add('free-room');
    groupEl.dataset.lkey = key;
    room.dataset.lkey = key;
    room.dataset.run = String(run.len);
    room.style.gridColumn = `${run.c0 + 1} / span ${run.len}`;
    room.style.gridRow = String(run.r + 1);
    // chats that don't fit: the drawer sits inside the room (top right) so it can't push the grid around
    const drawer = groupEl.querySelector(':scope > .vault-drawer');
    if (drawer) room.appendChild(drawer);
    const here = new Set(cells.map(([c, r]) => ck(c, r)));
    const typeClass = (room.className.match(/room-\w+/) || ['room-lounge'])[0];
    for (const [c, r] of annex) {
      const a = document.createElement('div');
      a.className = `vault-annex ${typeClass}` +
        (here.has(ck(c, r - 1)) ? ' ladder-up' : ' wt') + (here.has(ck(c, r + 1)) ? ' deck' : '') +
        (here.has(ck(c - 1, r)) ? '' : ' wl') + (here.has(ck(c + 1, r)) ? '' : ' wr');
      a.dataset.lkey = key;
      a.style.gridColumn = String(c + 1);
      a.style.gridRow = String(r + 1);
      a.vaultGroup = room.vaultGroup;
      a.innerHTML = '<i class="va-floor"></i>' + (here.has(ck(c, r - 1)) ? '<i class="va-ladder"></i>' : '');
      groupEl.appendChild(a);
    }
  }
  function afterRender() {
    const box = document.getElementById('sessionsContainer');
    if (!box) return;
    if (!free()) { box.style.gridTemplateRows = ''; return; }
    let rows = 3;
    box.querySelectorAll('[data-lkey]').forEach((el) => {
      const cells = state.rooms[el.dataset.lkey]?.cells;
      if (cells) rows = Math.max(rows, 1 + Math.max(...cells.map((p) => p[1])));
    });
    box.style.gridTemplateRows = `repeat(${editing ? rows + 1 : rows}, 88px)`;
    box.querySelectorAll('.sel').forEach((el) => el.classList.remove('sel'));
    if (editing && sel) box.querySelectorAll('[data-lkey]').forEach((el) => { if (el.dataset.lkey === sel && !el.classList.contains('workspace-group')) el.classList.add('sel'); });
    drawGhost();
  }

  // ---------- edit mode ----------
  let editing = false, sel = null, placing = null, ghostAt = null, drag = null;
  const box = () => document.getElementById('sessionsContainer');
  let bar = null, statusEl = null;
  const say = (msg, bad) => { if (statusEl) { statusEl.textContent = msg || ''; statusEl.classList.toggle('bad', !!bad); } };

  function cellAt(e) {
    const el = box(), rc = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const x = e.clientX - rc.left - parseFloat(cs.paddingLeft || 0) - el.clientLeft;
    const y = e.clientY - rc.top - parseFloat(cs.paddingTop || 0) - el.clientTop;
    const cw = (el.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0)) / COLS;
    return [Math.floor(x / cw), Math.floor(y / 88)];
  }
  const ownerAt = (c, r) => owner().get(ck(c, r)) || null;

  function drawGhost() {
    const el = box();
    el.querySelectorAll('.vault-ghost').forEach((g) => g.remove());
    if (!editing || !ghostAt) return;
    const base = placing ? placing : drag?.moved ? state.rooms[drag.key].cells : null;
    if (!base) return;
    const at = placing ? shift(placing, ghostAt[0], ghostAt[1])
      : shift(drag.cells, ghostAt[0] - drag.from[0], ghostAt[1] - drag.from[1]);
    const ok = fits(at, sel);
    for (const [c, r] of at) {
      const d = document.createElement('div');
      d.className = 'vault-ghost' + (ok ? '' : ' bad');
      d.style.gridColumn = String(c + 1); d.style.gridRow = String(r + 1);
      el.appendChild(d);
    }
    say(ok ? (placing ? 'Click to place it here' : 'Let go to move it here') : 'Can\'t go here: it overlaps a room or the edge', !ok);
  }
  function apply(key, cells) { state.rooms[key] = { cells }; save(); redraw(); }

  // change the selected room's shape, keeping its top-left corner where it is if it fits (else nearby)
  function reshape(cells) {
    const [c0, r0] = origin(state.rooms[sel].cells);
    // the nearest spot where it fits (its own corner first)
    const spots = [];
    for (let r = 0; r < MAX_ROWS; r++) for (let c = 0; c < COLS; c++) spots.push([c, r, Math.abs(c - c0) + Math.abs(r - r0)]);
    spots.sort((a, b) => a[2] - b[2]);
    for (const [c, r] of spots) {
      const at = shift(cells, c, r);
      if (fits(at, sel)) { apply(sel, at); say(''); return true; }
    }
    return false;
  }
  function pickShape(id) {
    if (!sel) return say('Click a room first', true);
    const cells = SHAPES[id].cells;
    if (reshape(cells)) return;
    placing = cells; ghostAt = null;
    say('No room for it there. Click where it should go (Esc to cancel)', true);
  }
  function transform(fn) {
    if (!sel) return say('Click a room first', true);
    if (!reshape(fn(state.rooms[sel].cells))) say('No room to turn it here', true);
  }

  function onDown(e) {
    if (!editing || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const [c, r] = cellAt(e), who = ownerAt(c, r);
    if (placing) {
      if (sel && fits(shift(placing, c, r), sel)) { apply(sel, shift(placing, c, r)); placing = null; say(''); }
      return;
    }
    if (who) {
      sel = who;
      drag = { key: who, cells: state.rooms[who].cells.map((p) => p.slice()), from: [c, r], moved: false };
      afterRender();
      return;
    }
    // rock: dig a block next to the selected room
    if (sel && state.rooms[sel]) {
      const mine = state.rooms[sel].cells;
      const next = [...mine, [c, r]];
      if (mine.some(([a, b]) => Math.abs(a - c) + Math.abs(b - r) === 1)) {
        if (fits(next, sel)) apply(sel, next); else say('Can\'t dig there', true);
      } else say('Dig next to the selected room, or click a room to select it');
    }
  }
  function onMove(e) {
    if (!editing) return;
    const [c, r] = cellAt(e);
    if (!ghostAt || ghostAt[0] !== c || ghostAt[1] !== r) {
      ghostAt = [c, r];
      if (drag && (c !== drag.from[0] || r !== drag.from[1])) drag.moved = true;
      if (placing || drag?.moved) drawGhost();
    }
  }
  function onUp(e) {
    if (!editing || !drag) return;
    const d = drag; drag = null;
    if (d.moved && ghostAt) {
      const at = shift(d.cells, ghostAt[0] - d.from[0], ghostAt[1] - d.from[1]);
      if (fits(at, d.key)) { apply(d.key, at); say(''); return; }
    }
    drawGhost(); say('');
  }
  function onContext(e) {
    if (!editing) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const [c, r] = cellAt(e);
    if (!sel || ownerAt(c, r) !== sel) return;
    const rest = state.rooms[sel].cells.filter(([a, b]) => !(a === c && b === r));
    if (rest.length && connected(rest)) apply(sel, rest);
    else say(rest.length ? 'Can\'t remove that block: the room would split in two' : 'A room needs at least one block', true);
  }
  function onKey(e) {
    if (!editing || /^(input|textarea|select)$/i.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') { if (placing) { placing = null; ghostAt = null; drawGhost(); say(''); } else exit(); }
    else if (k === 'r') transform(rotate);
    else if (k === 'f') transform(flip);
    else return;
    e.preventDefault(); e.stopPropagation();
  }

  function shapeButton(id) {
    const b = document.createElement('button');
    b.className = 'vl-shape'; b.title = SHAPES[id].name;
    const cells = SHAPES[id].cells, w = Math.max(...cells.map((x) => x[0])) + 1, h = Math.max(...cells.map((x) => x[1])) + 1;
    b.innerHTML = `<span class="vl-mini" style="grid-template-columns:repeat(${w},9px);grid-template-rows:repeat(${h},7px)">` +
      cells.map(([c, r]) => `<i style="grid-column:${c + 1};grid-row:${r + 1}"></i>`).join('') + '</span>';
    b.addEventListener('click', (e) => { e.stopPropagation(); pickShape(id); });
    return b;
  }
  function buildBar() {
    bar = document.createElement('div');
    bar.id = 'vaultLayoutBar'; bar.className = 'vault-layout-bar';
    const row = document.createElement('div'); row.className = 'vl-row';
    const lbl = document.createElement('span'); lbl.className = 'vl-label'; lbl.textContent = 'Layout';
    row.appendChild(lbl);
    for (const id of Object.keys(SHAPES)) row.appendChild(shapeButton(id));
    const btn = (text, title, fn, cls = '') => {
      const b = document.createElement('button'); b.className = 'vl-btn ' + cls; b.textContent = text; b.title = title;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); return b;
    };
    row.append(btn('↻', 'Rotate the selected room (R)', () => transform(rotate)), btn('⇋', 'Flip it (F)', () => transform(flip)),
      btn('Reset', 'Put every room back as a Bar 2 in the first free spot', () => { state.rooms = {}; sel = null; save(); redraw(); }),
      btn('Done', 'Finish (Esc)', exit, 'primary'));
    statusEl = document.createElement('div'); statusEl.className = 'vl-status';
    const hint = document.createElement('div'); hint.className = 'vl-hint';
    hint.textContent = 'Click a room, then drag it, pick a shape, or click rock beside it to dig. Right-click one of its blocks to fill it in.';
    bar.append(row, hint, statusEl);
    return bar;
  }

  function enter(key) {
    if (!free()) { state.mode = 'free'; save(); }
    editing = true; sel = key || null; placing = null; drag = null; ghostAt = null;
    document.body.classList.add('vault-layout-edit');
    document.body.classList.remove('vault-focus');
    const el = box();
    if (!bar) buildBar();
    el.parentNode.insertBefore(bar, el);
    redraw();
  }
  function exit() {
    editing = false; sel = null; placing = null; drag = null; ghostAt = null;
    document.body.classList.remove('vault-layout-edit');
    bar?.remove();
    redraw();
  }
  function setMode(mode) { if (editing && mode !== 'free') exit(); state.mode = mode === 'free' ? 'free' : 'normal'; save(); redraw(); }

  const lv = document.getElementById('listView');
  if (lv) {
    lv.addEventListener('pointerdown', onDown, true);
    lv.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    lv.addEventListener('contextmenu', onContext, true);
    lv.addEventListener('dblclick', (e) => { if (editing) { e.preventDefault(); e.stopPropagation(); } }, true);
    lv.addEventListener('click', (e) => { if (editing && !e.target.closest('.vault-layout-bar')) { e.preventDefault(); e.stopPropagation(); } }, true);
  }
  document.addEventListener('keydown', onKey, true);

  if (free()) setTimeout(redraw, 0); // saved as Free: draw it that way from the start
  // switching between the Vault and the plain list (View button, Style): draw it the right way at once
  let hadGrid = document.body.classList.contains('list-grid');
  new MutationObserver(() => {
    const has = document.body.classList.contains('list-grid');
    if (has !== hadGrid) { hadGrid = has; if (state.mode === 'free') redraw(); }
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  window.vaultLayout = { arrange, place, afterRender, setMode, enter, exit, mode: () => state.mode, editing: () => editing,
    // for tests
    _split: split, _fits: fits, _state: () => state };
})();
