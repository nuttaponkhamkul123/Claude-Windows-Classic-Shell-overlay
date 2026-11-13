// Vault view: draws one workspace room (furniture, robots, hover cards, approvals,
// helpers) plus the drawer for chats that don't fit.

// Sleeping robots: idle (nothing running, nothing waiting for you) for 2+ days
const VAULT_SLEEP_MS = 2 * 24 * 60 * 60 * 1000;
function sessionLastActive(s) {
  return s.mtime > 0 ? s.mtime : (Date.parse(s.timestamp) || Date.now());
}
function isAsleep(s, now = Date.now()) {
  if (typeof vaultSleepOn !== 'undefined' && !vaultSleepOn) return false;
  if (typeof vaultPinnedId !== 'undefined' && vaultPinnedId === s.id) return false; // its chat is open: awake
  if (s.draft || s.status === 'running' || s.unread || s.state === 'attention') return false;
  if (typeof pendingApprovals !== 'undefined' && [...pendingApprovals.values()].some((r) => r.sessionId === s.id)) return false;
  return now - sessionLastActive(s) > VAULT_SLEEP_MS;
}
// "Just replied": a chat goes from working to done → its robot says the first line
// of the reply for a few seconds
const vaultPrevStatus = new Map(); // session id -> 'running' | 'idle'
const vaultSaying = new Map();     // session id -> { text, until }
const VAULT_SAY_MS = 9000;

function buildWorkspaceVaultRoom(orderedSessions, groupMeta = {}) {
  if (typeof window.buildRunnerSvg !== 'function' || !orderedSessions.length) return null;
  const maxDwellers = 6;
  const sleeping = orderedSessions.filter((x) => isAsleep(x));
  const awake = orderedSessions.filter((x) => !sleeping.includes(x));
  const dwellers = awake.slice(0, maxDwellers);
  // its chat is open beside it (focus.js): its robot stays on the floor, not in the drawer
  const pinned = typeof vaultPinnedId !== 'undefined' ? awake.find((x) => x.id === vaultPinnedId) : null;
  if (pinned && !dwellers.includes(pinned)) dwellers[dwellers.length - 1] = pinned;
  const overflow = awake.length - dwellers.length;
  for (const x of orderedSessions) {
    const st = x.status === 'running' ? 'running' : 'idle';
    if (vaultPrevStatus.get(x.id) === 'running' && st === 'idle' && x.detail) {
      const line = String(x.detail).split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
      if (line) vaultSaying.set(x.id, { text: line.length > 90 ? line.slice(0, 88) + '…' : line, until: Date.now() + VAULT_SAY_MS });
    }
    vaultPrevStatus.set(x.id, st);
  }
  const metaOf = (s) => {
    const isAttn = s.unread || s.state === 'attention';
    const state = isAttn ? 'attention' : (s.status === 'running' ? 'running' : 'idle');
    const approval = typeof pendingApprovals !== 'undefined' ? [...pendingApprovals.values()].find((r) => r.sessionId === s.id) : null;
    return { s, state, approval, ...sessionVaultMeta(s, state) };
  };
  const items = dwellers.map(metaOf);
  const roomSeed = sessionHash({ id: groupMeta.name || orderedSessions[0].id });
  const roomKey = groupMeta.name || workspaceKey(orderedSessions[0]);
  const furn = roomFurnitureState(roomKey, roomSeed);
  const now = Date.now();

  // Working robots → the piece for their task, one spot per side of it
  const roomW = vaultRoomWidth();
  const busy = new Set();
  const spotsTaken = new Map(); // furniture -> robots placed there
  const work = new Map();       // session id -> { tx, face, pose }
  for (const d of items) {
    if (d.state !== 'running' || d.approval) continue; // waiting for your OK: stays put
    let kind = TASK_FURNITURE[d.pose] || 'gpuRack';
    let taskPose = TASK_POSE_AT[d.pose] || d.pose;
    // compacting the context: a coffee break on the sofa until it's done
    if (d.s.context?.compacting) { kind = 'rechargePod'; taskPose = 'stand'; }
    // committed: keep heading for / working at the current piece until it has arrived
    // and stayed MIN_STAY_MS, so quick steps don't make it U-turn on the way
    const cur = vaultWorkerAI.get(d.s.id);
    if (cur?.kind && cur.kind !== kind && now < (cur.commitUntil || 0)) { kind = cur.kind; taskPose = cur.taskPose; }
    const piece = furnitureFor(furn, kind, busy);
    busy.add(piece);
    piece.lastUsed = now;
    const n = spotsTaken.get(piece) || 0;
    spotsTaken.set(piece, n + 1);
    const side = n % 2 === 0 ? -1 : 1;                 // left of it first, then right
    // stand close enough to reach it (px from its centre), next robots further out
    const px = (STANCE_PX[piece.kind] || 24) + Math.floor(n / 2) * 20;
    const tx = Math.max(4, Math.min(96, piece.x + side * (px / roomW) * 100));
    work.set(d.s.id, { tx, face: -side, pose: taskPose, kind, piece });
  }
  // pieces that appeared for a task poof away after a minute unused
  const puffs = [];
  for (let i = furn.length - 1; i >= 0; i--) {
    const p = furn[i];
    if (p.spawned && !busy.has(p) && now - p.lastUsed > 60000) { puffs.push(p.x); furn.splice(i, 1); }
  }
  // a piece is "in use" once a robot has arrived at it (its screens, LEDs… come alive)
  for (const p of furn) p.inUse = false;
  for (const [sid, job] of work) {
    const st = vaultWorkerAI.get(sid);
    if (st && Math.abs(st.tx - job.tx) < 0.3 && now >= st.t0 + st.dur * 1000) job.piece.inUse = true;
  }
  // …and while an idle robot is using it (coffee, books, arcade…)
  for (const d of items) {
    const st = d.state === 'idle' ? vaultDwellerAI.get(d.s.id) : null;
    if (!st?.useKind || st.pose === 'walk') continue;
    const p = furn.filter((x) => x.kind === st.useKind).sort((a, b) => Math.abs(a.x - (st.useX ?? 0)) - Math.abs(b.x - (st.useX ?? 0)))[0];
    if (p) p.inUse = true;
  }
  const furnitureHtml = furn.map(furnitureSvg).join('');
  for (const p of furn) if (p.needsPuff) { puffs.push(p.x); p.needsPuff = false; }

  // One fixed room type (label + colour) per workspace, so the room doesn't flip
  // colour whenever the "lead" robot changes task. Needs-you = an alert glow on top.
  const STABLE_ROOMS = ['lab', 'forge', 'library', 'recon', 'comms', 'command'];
  const roomType = STABLE_ROOMS[roomSeed % STABLE_ROOMS.length];
  const anyAttn = items.some((d) => d.state === 'attention' || d.approval);
  const room = document.createElement('div');
  room.className = `vault-room vault-stage room-${roomType}${anyAttn ? ' room-alert-on' : ''}`;
  // for the room's right-click menu and double-click (room-actions.js)
  room.vaultGroup = { key: groupMeta.key || roomKey, cwd: groupMeta.cwd || '', name: groupMeta.name || '', sessions: orderedSessions, windowKey: roomKey, seed: roomSeed };
  // a window on the back wall, behind the furniture (window-art.js)
  const windowHtml = typeof buildVaultWindowHtml === 'function' ? buildVaultWindowHtml(roomKey, roomSeed, furn) : '';
  room.innerHTML =
    '<span class="vault-ceiling"></span>' +
    `<span class="vault-wall">${windowHtml}${furnitureHtml}</span>` +
    '<span class="vault-plaque"><span class="vault-ws-name"></span><span class="vault-ws-tag"></span></span>' +
    '<span class="vault-shaft left"></span>' +
    '<span class="vault-shaft right"></span>' +
    '<span class="vault-floor"></span>';
  room.querySelector('.vault-ws-name').textContent = groupMeta.name || orderedSessions[0].project || 'Workspace';
  const total = groupMeta.total ?? orderedSessions.length;
  const runningN = groupMeta.runningN ?? items.filter((d) => d.state === 'running').length;
  room.querySelector('.vault-ws-tag').textContent = `${VAULT_ROOMS[roomType].label} · ${runningN}/${total}`;

  items.forEach((d, idx) => {
    const hue = typeof robotHueFor === 'function' ? robotHueFor(d.s) : 0;
    const outfit = typeof window.robotOutfitFor === 'function' ? window.robotOutfitFor(d.s) : null;
    const hash = sessionHash(d.s);
    const isIdle = d.state === 'idle';
    const prevWork = vaultWorkerAI.get(d.s.id);
    const job = work.get(d.s.id);
    // a robot that just stopped working carries on from where it is
    if (!job && prevWork) {
      const at = workerPos(prevWork, now);
      if (isIdle) {
        const st = getIdleDwellerState(d.s, idx, items.length);
        Object.assign(st, { x: at, pose: 'stand', dur: 0, stopAt: 0, nextAt: now + 1500 });
      }
      vaultWorkerAI.set(d.s.id, { x: at, tx: at, t0: now, dur: 0, parked: true });
      if (isIdle) vaultWorkerAI.delete(d.s.id);
    }
    const ai = isIdle ? getIdleDwellerState(d.s, idx, items.length) : null;

    let pose = ai ? ai.pose : d.pose;
    let face = ai ? ai.face : ((hash % 2) ? 1 : -1);
    let slotPct = ai ? ai.x : (items.length === 1 ? 50 : Math.round(16 + (idx / (items.length - 1)) * 68));
    let walkTo = null; // { tx, secs } when the robot is still on its way
    let jobState = null; // { walking, st } for working robots
    if (ai && ai.pose === 'walk') {
      // idle robot mid-walk: draw it where it is now and let it carry on
      if (now >= ai.stopAt) {
        pose = 'stand';                                  // arrived between ticks
      } else {
        const t = Math.max(0, now - (ai.walkT0 || now));
        const k = ai.dur ? Math.min(1, t / (ai.dur * 1000)) : 1;
        const from = ai.fromX ?? ai.x;
        slotPct = from + (ai.x - from) * k;
        const delay = Math.max(0, (ai.walkT0 || now) - now);
        walkTo = { tx: ai.x, secs: (ai.stopAt - now - delay) / 1000, delay, turnTo: null };
      }
    }
    if (job) {
      let st = vaultWorkerAI.get(d.s.id);
      const from = st ? workerPos(st, now) : (vaultDwellerAI.get(d.s.id)?.x ?? slotPct);
      if (vaultFocus?.id === d.s.id) {
        st = { x: from, tx: from, t0: now, dur: 0 };     // talking to you: stay put
      } else if (!st || st.parked || (Math.abs(st.tx - job.tx) > 0.3 && !(st.carried && st.kind === job.kind))) {
        const far = Math.abs(job.tx - from) >= 0.5;
        const prevFace = st?.face ?? vaultDwellerAI.get(d.s.id)?.face ?? 1;
        // turn round first (TURN_MS), then walk
        const tired = (d.s.context?.pct || 0) >= 80;     // context nearly full: walks slower
        st = { x: from, tx: job.tx, t0: now + (far ? TURN_MS : 0), dur: far ? walkSecs(job.tx - from) / (tired ? 0.7 : 1) : 0,
          face: job.tx >= from ? 1 : -1, prevFace, fresh: far };
        st.commitUntil = st.t0 + st.dur * 1000 + MIN_STAY_MS;
      }
      st.kind = job.kind;
      st.taskPose = job.pose;
      // Reading: take a document from the tank, then carry it out to read (the tank powers down)
      if (job.kind === 'ctxTank' && !st.carried && vaultFocus?.id !== d.s.id && now >= st.t0 + st.dur * 1000 + 1400) {
        const away = Math.sign(st.tx - job.piece.x) || -1;  // keep going outward from the tank
        const tx2 = Math.max(4, Math.min(96, st.tx + away * (46 / roomW) * 100));
        const dur = walkSecs(tx2 - st.tx);
        st = { x: st.tx, tx: tx2, t0: now, dur, face: away, prevFace: job.face, fresh: true, carried: true,
          kind: job.kind, taskPose: job.pose, commitUntil: now + dur * 1000 + MIN_STAY_MS };
      }
      vaultWorkerAI.set(d.s.id, st);
      const at = workerPos(st, now);
      const left = st.dur ? st.t0 + st.dur * 1000 - now : 0;
      slotPct = at;
      if (left > 50) {
        pose = 'walk';
        face = st.fresh ? st.prevFace : st.face;          // a new walk starts facing the old way…
        const delay = Math.max(0, st.t0 - now);
        walkTo = { tx: st.tx, secs: Math.min(left, st.dur * 1000) / 1000, delay, turnTo: st.fresh ? st.face : null };
        st.fresh = false;                                 // …and turns once (below)
      } else {
        pose = job.pose;
        face = st.carried ? st.face : job.face;
      }
      jobState = { walking: left > 50, st };
    } else if ((d.state === 'attention' || d.approval) && vaultWorkerAI.has(d.s.id)) {
      slotPct = vaultWorkerAI.get(d.s.id).tx;  // needs you: stays at its last spot
    }

    if (d.approval) { pose = 'done'; walkTo = null; }      // hand up: waiting for your OK
    const dweller = document.createElement('div');
    dweller.className = `vault-walker pose-${pose}${d.state === 'attention' || d.approval ? ' is-attn' : ''}`;
    dweller.dataset.sid = d.s.id;
    if (vaultFocus?.id === d.s.id) dweller.classList.add('is-focus');
    dweller.dataset.pose = pose;
    if (isIdle) dweller.dataset.idle = '1';
    if (job) {
      dweller.dataset.working = '1';
      dweller.dataset.taskPose = job.pose;
      dweller.dataset.kind = job.kind;
      dweller.dataset.face = String(jobState?.st.carried ? jobState.st.face : job.face);
      if (jobState?.walking && jobState.st.carried) dweller.classList.add('carrying');   // 📄 in hand
      if (!jobState?.walking && job.kind === 'mcpDock') dweller.classList.add('plugged'); // cable into the dock
    }
    dweller.style.left = `${slotPct}%`;
    if (walkTo) {
      dweller.dataset.arrive = String(now + walkTo.delay + walkTo.secs * 1000);
      dweller.classList.add('is-walking');                // draws on top of anyone it passes
      // once the room is on screen: turn round, then walk
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (walkTo.turnTo != null) {
          const b = dweller.querySelector('.vault-bot');
          if (b) b.style.transform = `scaleX(${walkTo.turnTo})`;
        }
        dweller.style.transition = walkTransition(walkTo.secs, walkTo.delay);
        dweller.style.left = `${walkTo.tx}%`;
      }));
    }
    const title = d.s.sessionTitle || d.s.aiTitle || 'Untitled session';
    const actLabel = d.state === 'running' ? friendlyStatus(d.s, 'running') : (d.state === 'attention' ? 'Needs input' : 'Idle');
    const shortName = agentLabel(d.s.source, d.s.id);
    // hover card: name, chat, what it's doing, context gauge, cost so far
    const ctxPct = Math.round(d.s.context?.pct || 0);
    const cost = window.sessionCostFor?.(d.s.id);
    const card = document.createElement('span');
    card.className = 'vault-info';
    const step = d.s.context?.compacting ? 'Compacting the conversation (coffee break)'
      : d.state === 'running' ? (() => { const a = describeActivity(currentActivity(d.s), shortName); return a.target ? `${a.verb} ${a.target}` : a.verb; })()
        : actLabel;
    card.innerHTML = '<b class="vi-name"></b><span class="vi-title"></span><span class="vi-step"></span>' +
      (ctxPct ? `<span class="vi-ctx"><i style="width:${Math.min(100, ctxPct)}%"></i></span>` : '') + '<span class="vi-meta"></span>';
    card.querySelector('.vi-name').textContent = shortName;
    card.querySelector('.vi-title').textContent = title;
    card.querySelector('.vi-step').textContent = step;
    card.querySelector('.vi-meta').textContent = [ctxPct ? `Context ${ctxPct}%` : '', cost >= 0.005 ? `$${cost < 10 ? cost.toFixed(2) : cost.toFixed(0)} so far` : ''].filter(Boolean).join(' · ');
    if (ctxPct >= 80) card.classList.add('ctx-high');
    if (slotPct > 58) card.classList.add('to-left'); // open toward the middle of the room
    if (ctxPct >= 80) dweller.classList.add('tired');
    // a button: Tab to it, Enter/Space opens the chat, right-click = the row menu (features.js)
    dweller.tabIndex = 0;
    dweller.setAttribute('role', 'button');
    dweller.setAttribute('aria-label', `${shortName}: ${title}. ${actLabel}`);
    dweller.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); zoomIntoChat(d.s, dweller); }
    });
    dweller.innerHTML =
      `<span class="vault-bot" style="transform:scaleX(${face})">${window.buildRunnerSvg(hue, outfit, pose)}</span>` +
      (pose === 'think' ? '<span class="act-bubble"><i></i><i></i><i></i></span>' : '') +
      (ai && ai.emote ? `<span class="vault-emote">${ai.emote}</span>` : '') +
      (d.state === 'attention' || d.approval ? '<span class="vault-ping">!</span>' : '') +
      (d.s.context?.compacting ? '<span class="vault-emote">☕</span>' : '') +
      '<span class="vault-shadow"></span><span class="vault-name"></span>';
    dweller.querySelector('.vault-name').textContent = shortName;
    dweller.appendChild(card);
    // the approval bubble — not for the robot whose chat is open (the chat shows the request)
    if (d.approval && vaultFocus?.id !== d.s.id) dweller.appendChild(buildRoomApproval(d.approval, slotPct > 58));
    // just replied: a speech bubble with the first line, which pops away by itself
    const say = vaultSaying.get(d.s.id);
    if (say && say.until > now && !d.approval && vaultFocus?.id !== d.s.id) {
      const b = document.createElement('span');
      b.className = `vault-say${slotPct > 58 ? ' to-left' : ''}`;
      const t = document.createElement('span'); // the 2-line clamp sits on this inner span
      t.textContent = say.text;
      b.appendChild(t);
      b.title = 'Click the robot to open the chat';
      dweller.appendChild(b);
      setTimeout(() => { b.classList.add('bye'); setTimeout(() => b.remove(), 300); }, say.until - now);
    } else if (say && say.until <= now) {
      vaultSaying.delete(d.s.id);
    }
    // helpers (sub-agents) still working: small robots beside their lead, each doing its own step
    const helpers = (d.s.subagents || []).filter((a) => !a.finished).slice(0, 3);
    helpers.forEach((a, k) => {
      const hp = typeof activityPose === 'function' ? activityPose(a.tool ? { kind: 'tool', tool: a.tool } : { kind: 'thinking' }) : 'think';
      const h = document.createElement('span');
      h.className = `vault-helper pose-${hp}`;
      h.style.setProperty('--k', String(k));
      h.title = `${a.type}: ${a.task}${a.tool ? `\nNow: ${a.tool}${a.target ? ' ' + a.target : ''}` : '\nNow: thinking'}`;
      h.innerHTML = window.buildRunnerSvg(typeof teamHue === 'function' ? teamHue(a.type) : 120, null, hp);
      dweller.appendChild(h);
    });
    dweller.addEventListener('click', (e) => {
      e.stopPropagation();
      zoomIntoChat(d.s, dweller);
    });
    room.appendChild(dweller);
  });

  puffRoomFurniture(room, puffs);
  if (overflow <= 0 && !sleeping.length) return room;

  // Chats that don't fit on the floor: a drawer of small chips under the room,
  // so every chat can still be opened (click / Enter) and right-clicked.
  const out = document.createDocumentFragment();
  const drawer = document.createElement('div');
  drawer.className = 'vault-drawer';
  const lbl = document.createElement('span');
  lbl.className = 'vault-drawer-label';
  lbl.textContent = overflow > 0 ? `+${overflow} more:` : `💤 ${sleeping.length} asleep:`;
  drawer.appendChild(lbl);
  const chipsFor = [...awake.filter((x) => !dwellers.includes(x)), ...sleeping];
  for (const s of chipsFor) {
    const asleep = sleeping.includes(s);
    if (asleep && overflow > 0 && s === sleeping[0]) {
      const z = document.createElement('span');
      z.className = 'vault-drawer-label';
      z.textContent = `💤 ${sleeping.length} asleep:`;
      drawer.appendChild(z);
    }
    const isAttn = s.unread || s.state === 'attention';
    const chip = document.createElement('button');
    chip.className = `vault-chip${isAttn ? ' is-attn' : s.status === 'running' ? ' is-running' : ''}${asleep ? ' is-asleep' : ''}`;
    chip.dataset.sid = s.id;
    const hue = typeof robotHueFor === 'function' ? robotHueFor(s) : 0;
    const dot = document.createElement('i');
    dot.style.background = shiftHexHue('#62b6d8', hue);
    const name = document.createElement('span');
    const title = s.sessionTitle || s.aiTitle || agentLabel(s.source, s.id);
    name.textContent = title;
    const days = Math.floor((Date.now() - sessionLastActive(s)) / 86400000);
    chip.title = `${agentLabel(s.source, s.id)} — ${title}\n${asleep ? `Asleep · idle ${days} days (click to open it)` : isAttn ? 'Needs input' : s.status === 'running' ? friendlyStatus(s, 'running') : 'Idle'}`;
    chip.append(dot, name);
    chip.addEventListener('click', (e) => { e.stopPropagation(); zoomIntoChat(s, chip); });
    drawer.appendChild(chip);
  }
  out.append(room, drawer);
  return out;
}
