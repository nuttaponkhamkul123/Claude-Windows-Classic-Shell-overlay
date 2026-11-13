// Vault rooms: add your own furniture, or take pieces out.
// Right-click a room → 🪑 Furniture… opens a picker: the pieces in the room (✕ to
// remove) and every piece you can add (both looks where there are two). A new piece
// appears with a puff in the free spot nearest where you right-clicked.
// Remembered per room in the settings ("roomFurniture"):
//   room key -> { added: [{ kind, x, variant }], removed: [x of a starting piece] }
// Pieces you added are yours: robots use them, but a working robot never swaps them
// out for the piece its task needs (robots.js furnitureFor).

const FURN_LABELS = {
  diffDesk: 'Code desk', gpuRack: 'GPU rack', promptTerm: 'Terminal', whiteboard: 'Whiteboard',
  vectorPods: 'Vector pods', mcpDock: 'MCP dock', forgeCore: 'Forge', rechargePod: 'Sofa', ctxTank: 'Context tank',
  coffeeBar: 'Coffee bar', bookshelf: 'Bookshelf', arcade: 'Arcade', plantWall: 'Plants', bunk: 'Bunk bed',
  waterCooler: 'Water cooler', printer3d: '3D printer',
};
const roomFurnEdits = Object.assign({}, window.electronAPI?.settings?.roomFurniture || {});
const saveFurnEdits = () => window.electronAPI?.storeSet?.('roomFurniture', roomFurnEdits);
const isKnownPiece = (kind) => !!(AI_FURNITURE[kind] || (typeof AI_DECOR !== 'undefined' && AI_DECOR[kind]));
const isDecorPiece = (kind) => typeof AI_DECOR !== 'undefined' && !!AI_DECOR[kind];

// Called by roomFurnitureState when a room's furniture is first set up
function applyRoomFurnitureEdits(key, list) {
  for (const p of list) p.origX = p.x; // starting pieces are known by where they started
  const e = roomFurnEdits[key];
  if (!e) return;
  const removed = e.removed || [];
  for (let i = list.length - 1; i >= 0; i--) if (removed.includes(list[i].x)) list.splice(i, 1);
  // moved in builder mode (builder.js)
  for (const p of list) if (e.moved && e.moved[p.origX] != null) p.x = e.moved[p.origX];
  for (const a of e.added || []) {
    if (!isKnownPiece(a.kind)) continue;
    // a starting piece in that spot makes way
    for (let i = list.length - 1; i >= 0; i--) if (!list[i].user && Math.abs(list[i].x - a.x) < 12) list.splice(i, 1);
    list.push({ kind: a.kind, x: a.x, variant: a.variant || 0, decor: isDecorPiece(a.kind), user: true, spawned: false, needsPuff: false, lastUsed: 0 });
  }
}

function freeFurnSlots(list) {
  return FURN_SLOTS.filter((x) => list.every((p) => Math.abs(p.x - x) >= 12));
}

function addRoomFurniture(key, seed, kind, variant, nearPct) {
  const list = roomFurnitureState(key, seed);
  const free = freeFurnSlots(list).sort((a, b) => Math.abs(a - nearPct) - Math.abs(b - nearPct));
  if (!free.length) return false;
  const x = free[0];
  list.push({ kind, x, variant, decor: isDecorPiece(kind), user: true, spawned: false, needsPuff: true, lastUsed: 0 });
  const e = roomFurnEdits[key] || (roomFurnEdits[key] = { added: [], removed: [] });
  (e.added || (e.added = [])).push({ kind, x, variant });
  saveFurnEdits();
  return true;
}

function removeRoomFurniture(key, seed, piece) {
  const list = roomFurnitureState(key, seed);
  const i = list.indexOf(piece);
  if (i < 0) return;
  list.splice(i, 1);
  const e = roomFurnEdits[key] || (roomFurnEdits[key] = { added: [], removed: [] });
  if (piece.user) e.added = (e.added || []).filter((a) => !(a.x === piece.x && a.kind === piece.kind));
  else {
    const at = piece.origX ?? piece.x;
    (e.removed || (e.removed = [])).push(at);
    if (e.moved) delete e.moved[at];
  }
  saveFurnEdits();
}

// Builder mode: a piece dragged to a new spot (x in % of the room)
function moveRoomFurniture(key, piece, x) {
  const oldX = piece.x;
  piece.x = x;
  if (piece.spawned) return; // a task piece that popped in for a moment: not remembered
  const e = roomFurnEdits[key] || (roomFurnEdits[key] = { added: [], removed: [] });
  if (piece.user) {
    const a = (e.added || []).find((a) => a.x === oldX && a.kind === piece.kind);
    if (a) a.x = x;
  } else {
    (e.moved || (e.moved = {}))[piece.origX ?? oldX] = x;
  }
  saveFurnEdits();
}

(function () {
  const panel = document.createElement('div');
  panel.className = 'furn-shop';
  panel.hidden = true;
  document.body.appendChild(panel);
  let ctx = null; // { g, pct, x, y }
  const close = () => { panel.hidden = true; ctx = null; };
  document.addEventListener('mousedown', (e) => { if (!panel.hidden && !panel.contains(e.target)) close(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) close(); });
  window.addEventListener('blur', close);

  const thumb = (kind, variant) => {
    const s = document.createElement('span');
    s.className = 'furn-thumb';
    s.innerHTML = `<svg viewBox="0 0 64 56">${furnitureArt(kind, variant)}</svg>`;
    return s;
  };
  // puff at a piece on screen (before it's removed from the room)
  const puffAt = (key, x) => {
    const room = [...document.querySelectorAll('#listView .vault-room')].find((r) => r.vaultGroup?.windowKey === key);
    const el = room && [...room.querySelectorAll('.vault-furn')].find((f) => Math.abs(parseFloat(f.style.left) - x) < 0.5);
    const r = el?.getBoundingClientRect();
    if (r?.width && typeof smokePuff === 'function' && !reducedMotion()) smokePuff(r.left + r.width / 2, r.bottom - 22, 44);
  };

  function render() {
    if (!ctx) return;
    const { g } = ctx;
    const list = roomFurnitureState(g.windowKey, g.seed);
    panel.textContent = '';

    const head = document.createElement('div');
    head.className = 'furn-shop-head';
    const title = document.createElement('span');
    title.textContent = `🪑 Furniture · ${g.name || 'Room'}`;
    const x = document.createElement('button');
    x.className = 'furn-shop-x';
    x.textContent = '✕';
    x.title = 'Close (Esc)';
    x.addEventListener('click', close);
    head.append(title, x);
    panel.appendChild(head);

    // in this room (task pieces that popped in for a moment aren't listed)
    const here = list.filter((p) => !p.spawned).sort((a, b) => a.x - b.x);
    const sub1 = document.createElement('div');
    sub1.className = 'furn-shop-sub';
    sub1.textContent = 'In this room';
    panel.appendChild(sub1);
    const row = document.createElement('div');
    row.className = 'furn-shop-here';
    if (!here.length) {
      const none = document.createElement('span');
      none.className = 'furn-shop-note';
      none.textContent = 'Empty room';
      row.appendChild(none);
    }
    for (const p of here) {
      const b = document.createElement('button');
      b.className = `furn-tile small${p.user ? ' mine' : ''}`;
      b.title = `${FURN_LABELS[p.kind] || p.kind}${p.user ? ' (added by you)' : ''}\nClick to remove`;
      b.appendChild(thumb(p.kind, p.variant));
      const rm = document.createElement('i');
      rm.textContent = '✕';
      b.appendChild(rm);
      b.addEventListener('click', () => {
        puffAt(g.windowKey, p.x);
        removeRoomFurniture(g.windowKey, g.seed, p);
        renderSessionCards(true);
        render();
      });
      row.appendChild(b);
    }
    panel.appendChild(row);

    // add
    const full = !freeFurnSlots(list).length;
    const sub2 = document.createElement('div');
    sub2.className = 'furn-shop-sub';
    sub2.textContent = full ? 'Add · room is full, remove a piece first' : 'Add (click a piece)';
    panel.appendChild(sub2);
    const grid = document.createElement('div');
    grid.className = 'furn-shop-grid';
    const kinds = [];
    for (const k of Object.keys(AI_FURNITURE)) {
      kinds.push([k, 0]);
      if (typeof AI_FURNITURE_ALT !== 'undefined' && AI_FURNITURE_ALT[k]) kinds.push([k, 1]);
    }
    if (typeof AI_DECOR !== 'undefined') for (const k of Object.keys(AI_DECOR)) kinds.push([k, 0]);
    for (const [k, v] of kinds) {
      const b = document.createElement('button');
      b.className = 'furn-tile';
      b.disabled = full;
      const label = FURN_LABELS[k] || k;
      b.title = v ? `${label} (other look)` : label;
      b.appendChild(thumb(k, v));
      const n = document.createElement('span');
      n.className = 'furn-name';
      n.textContent = v ? `${label} ²` : label;
      b.appendChild(n);
      b.addEventListener('click', () => {
        if (!addRoomFurniture(g.windowKey, g.seed, k, v, ctx.pct)) return;
        renderSessionCards(true);
        render();
      });
      grid.appendChild(b);
    }
    panel.appendChild(grid);
  }

  window.openFurnitureShop = function (g, pct, x, y) {
    ctx = { g, pct };
    panel.hidden = false;
    render();
    const w = panel.offsetWidth, h = panel.offsetHeight;
    panel.style.left = Math.max(4, Math.min(x, innerWidth - w - 4)) + 'px';
    panel.style.top = Math.max(4, Math.min(y, innerHeight - h - 4)) + 'px';
  };
})();
