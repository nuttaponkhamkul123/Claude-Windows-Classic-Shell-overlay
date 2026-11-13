// Vault builder mode: "🔨 Build" in the list toolbar (or right-click a room → Builder
// mode) turns it on; then drag any piece of furniture, or the window, sideways to a new
// spot in its room.
// Robots fade and let clicks through so they don't get in the way. A piece can't be
// dropped on top of another (it turns red and goes back). Esc or Build again turns it off.
// Moves are remembered per room (furniture-shop.js moveRoomFurniture).
(function () {
  const DRAG_START_PX = 4;
  const MIN_GAP_PX = 50;  // pieces are 64px wide: this much apart, they don't overlap much
  let on = false;
  let drag = null;        // { f, room, piece, key, x0, fromX, started, pct, blocked }
  let pendingRender = null;
  let suppressClick = false;

  const btn = document.createElement('button');
  btn.id = 'lbBuild';
  btn.className = 'tb-btn tb-build';
  btn.textContent = '🔨 Build';
  btn.title = 'Builder mode: drag furniture to move it (Esc to finish)';
  (document.getElementById('lbNotes') || document.getElementById('lbView'))?.after(btn);

  function setBuilder(v) {
    on = !!v && document.body.classList.contains('list-grid');
    document.body.classList.toggle('vault-builder', on);
    btn.classList.toggle('active', on);
    btn.textContent = on ? '✓ Done building' : '🔨 Build';
    if (!on && drag) cancel();
  }
  window.setVaultBuilder = setBuilder;
  window.isVaultBuilder = () => on;
  btn.addEventListener('click', (e) => { e.stopPropagation(); setBuilder(!on); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && on) setBuilder(false); });
  // opening a chat or leaving the Vault view ends it
  const offWhenGone = () => { if (on && (!document.body.classList.contains('list-grid') || document.body.classList.contains('vault-focus'))) setBuilder(false); };
  new MutationObserver(offWhenGone).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  // hold the redraw while a piece is in your hand
  const renderBeforeBuild = renderSessionCards;
  renderSessionCards = function (...args) {
    if (drag?.started) { pendingRender = args; return; }
    return renderBeforeBuild.apply(this, args);
  };

  const pieceFor = (room, f) => {
    const g = room.vaultGroup;
    if (!g) return null;
    const list = roomFurnitureState(g.windowKey, g.seed);
    const x = parseFloat(f.style.left);
    return list.filter((p) => p.kind === f.dataset.kind).sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0] || null;
  };

  listView.addEventListener('pointerdown', (e) => {
    if (!on || e.button !== 0) return;
    // the window: slides along the back wall (behind the furniture, so no overlap check)
    const w = e.target.closest('.vault-window');
    const wRoom = w?.closest('.vault-room');
    if (w && wRoom?.vaultGroup) {
      e.preventDefault();
      e.stopPropagation();
      drag = { f: w, room: wRoom, piece: null, isWindow: true, key: wRoom.vaultGroup.windowKey, x0: e.clientX, fromX: parseFloat(w.style.left), started: false };
      return;
    }
    const f = e.target.closest('.vault-furn');
    const room = f?.closest('.vault-room');
    if (!f || !room) return;
    const piece = pieceFor(room, f);
    if (!piece) return;
    e.preventDefault();
    e.stopPropagation();
    drag = { f, room, piece, key: room.vaultGroup.windowKey, x0: e.clientX, fromX: piece.x, started: false };
  }, true);

  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.started) {
      if (Math.abs(e.clientX - drag.x0) < DRAG_START_PX) return;
      drag.started = true;
      try { drag.f.setPointerCapture(e.pointerId); } catch (_) {}
      drag.f.classList.add('furn-dragging');
      document.body.classList.add('vault-grabbing');
    }
    const r = drag.room.querySelector('.vault-wall').getBoundingClientRect();
    const pct = Math.max(6, Math.min(94, drag.fromX + ((e.clientX - drag.x0) / r.width) * 100));
    drag.pct = Math.round(pct * 10) / 10;
    drag.f.style.left = `${drag.pct}%`;
    if (drag.isWindow) return;
    const gap = (MIN_GAP_PX / r.width) * 100;
    const others = roomFurnitureState(drag.key, drag.room.vaultGroup.seed).filter((p) => p !== drag.piece);
    drag.blocked = others.some((p) => Math.abs(p.x - drag.pct) < gap);
    drag.f.classList.toggle('furn-blocked', drag.blocked);
  });

  function finish(moveTo) {
    const d = drag;
    drag = null;
    document.body.classList.remove('vault-grabbing');
    if (!d?.started) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    d.f.classList.remove('furn-dragging', 'furn-blocked');
    if (moveTo != null) {
      if (d.isWindow) setWindowSpot(d.key, moveTo);
      else moveRoomFurniture(d.key, d.piece, moveTo);
      d.f.classList.add('furn-landed');
    } else {
      d.f.style.left = `${d.fromX}%`; // back where it was
      d.f.classList.add('furn-nope');
    }
    setTimeout(() => {
      const args = pendingRender;
      pendingRender = null;
      renderSessionCards(...(args || [true]));
    }, 300);
  }
  const cancel = () => finish(null);
  const drop = () => {
    if (!drag) return;
    if (!drag.started) { drag = null; return; }
    finish(drag.blocked || drag.pct == null ? null : drag.pct);
  };
  window.addEventListener('pointerup', drop);
  window.addEventListener('pointercancel', cancel);

  // the click that ends a drag doesn't do anything else
  listView.addEventListener('click', (e) => {
    if (!suppressClick && !(on && e.target.closest('.vault-furn, .vault-window'))) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
})();
