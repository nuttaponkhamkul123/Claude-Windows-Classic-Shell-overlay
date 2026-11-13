// Vault view → chat: the zoom, and focus mode (chat panel beside the clicked robot).

// Vault view → chat as one zoom: the room scales up toward the robot you clicked
// and dissolves while the chat grows out of that spot. Back plays it in reverse
// (see showListView). Falls back to a plain switch with reduced motion.
var vaultZoomBusy = false; // var: showListView can run before this line during startup
var vaultZoomFrom = null; // session id whose robot opened the chat

// ---- Focus mode (HUD at least 400px wide): the rooms stay, zoomed so the robot sits
// big in a strip on the left; the chat slides in as a panel on the right with a
// pointer at the robot. Other robots in the strip can be clicked to switch chats.
var vaultFocus = null;          // { id, t: {x, y, s}, settleAt } while a chat is open beside its robot
var vaultFocusOpening = false;  // showDetailView called by focus mode itself
const FOCUS_SCALE = 2.1;
function focusRobotEl(id) {
  return listView.querySelector(`.vault-walker[data-sid="${CSS.escape(id)}"] .vault-bot`);
}
// Move/scale the list so the focused robot lands in the middle of the left strip
function alignFocus(animate) {
  if (!vaultFocus) return;
  const bot = focusRobotEl(vaultFocus.id);
  if (!bot) return;
  const pb = popupBody.getBoundingClientRect();
  const strip = Math.max(110, Math.min(170, pb.width * 0.3));
  const tx = pb.left + strip / 2, ty = pb.top + Math.min(pb.height * 0.42, 190);
  const m = new DOMMatrixReadOnly(getComputedStyle(listView).transform); // as drawn right now (may be mid-slide)
  const cur = { x: m.e, y: m.f, s: m.a || 1 };
  const lv = listView.getBoundingClientRect();   // includes the current transform (origin 0 0)
  const r = bot.getBoundingClientRect();
  const px = (r.left + r.width / 2 - lv.left) / cur.s, py = (r.top + r.height / 2 - lv.top) / cur.s;
  const x0 = lv.left - cur.x, y0 = lv.top - cur.y;  // untransformed top-left
  const t = { x: tx - x0 - FOCUS_SCALE * px, y: ty - y0 - FOCUS_SCALE * py, s: FOCUS_SCALE };
  vaultFocus.t = t;
  listView.style.transition = animate ? 'transform .5s cubic-bezier(.3,.7,.2,1)' : 'none';
  listView.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.s})`;
  if (animate) vaultFocus.settleAt = Date.now() + 520;
  popupBody.style.setProperty('--focus-strip', `${strip}px`);
  popupBody.style.setProperty('--focus-tail', `${ty - pb.top}px`);
}
function openVaultFocus(session) {
  if (!document.body.classList.contains('list-grid') || popupBody.getBoundingClientRect().width < 400) return false;
  if (!focusRobotEl(session.id)) return false; // chips in the drawer: no robot to point at
  const switching = !!vaultFocus;
  vaultFocus = { id: session.id };
  vaultFocusOpening = true;
  try { showDetailView(session); } finally { vaultFocusOpening = false; }
  document.body.classList.add('vault-focus');
  listView.querySelectorAll('.vault-walker.is-focus').forEach((w) => w.classList.remove('is-focus'));
  focusRobotEl(session.id).closest('.vault-walker').classList.add('is-focus');
  alignFocus(!reducedMotion());
  if (reducedMotion()) return true;
  detailView.animate(switching
    ? [{ opacity: 0.35 }, { opacity: 1 }]
    : [{ transform: 'translateX(55%)', opacity: 0 }, { transform: 'none', opacity: 1 }],
  { duration: switching ? 220 : 440, delay: switching ? 0 : 90, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
  return true;
}
// Leave focus mode. animate=false when another part of the HUD takes over the view.
function closeVaultFocus(animate = true) {
  if (!vaultFocus) return false;
  const leftId = vaultFocus.id;
  vaultFocus = null;
  // a request still waiting: put its bubble back in the room (it was left out while the chat was open)
  if (typeof pendingApprovals !== 'undefined' && [...pendingApprovals.values()].some((r) => r.sessionId === leftId)) renderSessionCards(true);
  document.body.classList.remove('vault-focus');
  listView.querySelectorAll('.vault-walker.is-focus').forEach((w) => w.classList.remove('is-focus'));
  listView.style.transition = animate && !reducedMotion() ? 'transform .42s cubic-bezier(.3,.7,.2,1)' : 'none';
  listView.style.transform = '';
  setTimeout(() => { if (!vaultFocus) listView.style.transition = ''; }, 450);
  return true;
}
// Clicking the rooms beside the chat panel closes the chat (zooms back out).
// Robots and drawer chips still switch chats. Capture phase, so the click doesn't
// also collapse a workspace or open something underneath.
listView.addEventListener('click', (e) => {
  if (!vaultFocus || e.target.closest('.vault-walker, .vault-chip')) return;
  e.preventDefault();
  e.stopPropagation();
  showListView();
}, true);

// The list re-renders on every update: keep the robot under the pointer
const renderCardsBeforeFocus = renderSessionCards;
renderSessionCards = function (...args) {
  const out = renderCardsBeforeFocus.apply(this, args);
  if (vaultFocus) {
    const wait = Math.max(0, (vaultFocus.settleAt || 0) - Date.now());
    setTimeout(() => {
      if (!vaultFocus) return;
      focusRobotEl(vaultFocus.id)?.closest('.vault-walker').classList.add('is-focus');
      alignFocus(false);
    }, wait);
  }
  return out;
};

function zoomIntoChat(session, fromEl) {
  if (vaultZoomBusy) return;
  // already chatting with this robot (focus mode): clicking it opens dress-up
  if (vaultFocus?.id === session.id && fromEl?.classList.contains('vault-walker') && window.openDressUp) {
    window.openDressUp(fromEl);
    return;
  }
  if (openVaultFocus(session)) return;
  const room = fromEl?.closest('.vault-room') || fromEl?.closest('.vault-drawer')?.previousElementSibling || null;
  const r = fromEl?.getBoundingClientRect();
  if (!room || !r || !r.width || reducedMotion()) { vaultZoomFrom = session.id; showDetailView(session); return; }
  vaultZoomBusy = true;
  vaultZoomFrom = session.id;
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;

  // a frozen copy of the room on top, so it can keep zooming after the view switches
  const rr = room.getBoundingClientRect();
  const ghost = room.cloneNode(true);
  ghost.classList.add('vault-zoom-ghost');
  Object.assign(ghost.style, { left: rr.left + 'px', top: rr.top + 'px', width: rr.width + 'px', height: rr.height + 'px' });
  ghost.style.transformOrigin = `${cx - rr.left}px ${cy - rr.top}px`;
  ghost.querySelector(`.vault-walker[data-sid="${CSS.escape(session.id)}"]`)?.classList.add('zoom-target');
  document.body.appendChild(ghost);

  showDetailView(session);

  const dv = detailView.getBoundingClientRect();
  const x = cx - dv.left, y = cy - dv.top;
  const R = Math.hypot(Math.max(x, dv.width - x), Math.max(y, dv.height - y));
  const reveal = detailView.animate([
    { clipPath: `circle(14px at ${x}px ${y}px)`, opacity: 0.6 },
    { clipPath: `circle(${R}px at ${x}px ${y}px)`, opacity: 1 },
  ], { duration: 460, delay: 70, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'backwards' });
  ghost.animate([
    { transform: 'scale(1)', opacity: 1 },
    { transform: 'scale(1.9)', opacity: 1, offset: 0.45 },
    { transform: 'scale(3.2)', opacity: 0 },
  ], { duration: 480, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' });
  const finish = () => { ghost.remove(); vaultZoomBusy = false; };
  reveal.onfinish = finish;
  reveal.oncancel = finish;
  setTimeout(finish, 900); // never leave the overlay behind
}

// Back from a chat that was opened from a robot: the list zooms out from that robot
function zoomOutToRobot() {
  const id = vaultZoomFrom;
  vaultZoomFrom = null;
  if (!id || reducedMotion() || !document.body.classList.contains('list-grid')) return;
  const bot = listView.querySelector(`.vault-walker[data-sid="${CSS.escape(id)}"]`) ||
    listView.querySelector(`.vault-chip[data-sid="${CSS.escape(id)}"]`);
  const r = bot?.getBoundingClientRect();
  const lv = listView.getBoundingClientRect();
  if (!r || !r.width || !lv.width) return;
  listView.style.transformOrigin = `${r.left + r.width / 2 - lv.left}px ${r.top + r.height / 2 - lv.top}px`;
  listView.animate([
    { transform: 'scale(2.6)', opacity: 0 },
    { transform: 'scale(1.25)', opacity: 1, offset: 0.55 },
    { transform: 'scale(1)', opacity: 1 },
  ], { duration: 420, easing: 'cubic-bezier(.2,.7,.2,1)' }).onfinish = () => { listView.style.transformOrigin = ''; };
  bot.classList.add('zoom-landed');
  setTimeout(() => bot.classList.remove('zoom-landed'), 900);
}
