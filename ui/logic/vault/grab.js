// Vault view: pick a robot up and put it somewhere else in its own room.
// Press and move → it's lifted off the floor and follows the pointer (sideways only,
// clamped to its room), swinging against the direction you pull it. Let go → it
// lands with a squash. Idle robots stay where they're dropped (a bit dizzy);
// working robots walk back to their task. A press without moving is still a click.
(function () {
  const DRAG_START_PX = 5;
  let drag = null;          // { el, sid, room, x0, y0, started, lastX, lastT, pct }
  let suppressClick = false;
  let pendingRender = null; // renderSessionCards args held back while a robot is in the air

  // The list redraws on every update; hold that back mid-drag so the robot isn't
  // pulled out of your hand, and redraw once it lands.
  const renderCardsBeforeGrab = renderSessionCards;
  renderSessionCards = function (...args) {
    if (drag?.started) { pendingRender = args; return; }
    return renderCardsBeforeGrab.apply(this, args);
  };

  const pctAt = (clientX) => {
    const r = drag.room.getBoundingClientRect();
    return Math.max(4, Math.min(96, ((clientX - r.left) / r.width) * 100));
  };

  listView.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || vaultFocus) return;
    const el = e.target.closest('.vault-walker');
    if (!el || e.target.closest('.vault-ask, .vault-info, button')) return;
    const room = el.closest('.vault-room');
    if (!room) return;
    drag = { el, sid: el.dataset.sid, room, x0: e.clientX, y0: e.clientY, started: false, lastX: e.clientX, lastT: performance.now() };
  });

  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < DRAG_START_PX) return;
      drag.started = true;
      const { el } = drag;
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      el.style.transition = 'none';
      el.style.left = `${pctAt(e.clientX)}%`; // stop any walk where it is
      el.classList.remove('is-walking', 'engage', 'plugged', 'carrying');
      el.removeAttribute('data-arrive');
      el.removeAttribute('data-engage');
      el.classList.add('is-grabbed');
      el.querySelector('.vault-emote')?.remove();
      el.querySelector('.act-bubble')?.remove();
      document.body.classList.add('vault-grabbing');
    }
    drag.pct = pctAt(e.clientX);
    drag.el.style.left = `${drag.pct}%`;
    // swing like a pendulum: pulled right → body trails to the left
    const now = performance.now();
    const vx = (e.clientX - drag.lastX) / Math.max(8, now - drag.lastT); // px per ms
    drag.lastX = e.clientX; drag.lastT = now;
    drag.el.style.setProperty('--tilt', `${Math.max(-28, Math.min(28, -vx * 22)).toFixed(1)}deg`);
    clearTimeout(drag.settle);
    const el = drag.el;
    drag.settle = setTimeout(() => el.style.setProperty('--tilt', '0deg'), 90);
  });

  const drop = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    document.body.classList.remove('vault-grabbing');
    if (!d.started) return; // a plain click: let it open the chat
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    clearTimeout(d.settle);
    const x = d.pct ?? parseFloat(d.el.style.left);
    const now = Date.now();
    const idle = vaultDwellerAI.get(d.sid);
    if (d.el.dataset.idle === '1' && idle) {
      Object.assign(idle, { x, fromX: x, pose: 'stand', dur: 0, stopAt: 0, turnMs: 0, plan: null, emote: '💫', nextAt: now + 2600 });
    } else {
      // working / waiting: put down here; a working robot heads back to its piece
      vaultWorkerAI.set(d.sid, { x, tx: x, t0: now, dur: 0, parked: true });
    }
    d.el.classList.remove('is-grabbed');
    d.el.style.removeProperty('--tilt');
    d.el.classList.add('vault-landed');
    setTimeout(() => {
      d.el.classList.remove('vault-landed');
      const args = pendingRender;
      pendingRender = null;
      renderSessionCards(...(args || [true]));
    }, 320);
  };
  window.addEventListener('pointerup', drop);
  window.addEventListener('pointercancel', drop);

  // the click that ends a drag must not open the chat
  listView.addEventListener('click', (e) => {
    if (!suppressClick || !e.target.closest('.vault-walker')) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
})();
