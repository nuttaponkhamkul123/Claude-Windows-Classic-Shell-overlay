// Vault view: how the robots behave. Idle life (wander, sit, sip, glance), walking at
// a pace matched to the legs, going to the furniture for their task and using it,
// carry tasks, and the 300ms loop that drives it all.

const IDLE_POSES = ['stand', 'stand', 'read', 'type', 'think', 'search', 'done'];
const IDLE_EMOTES = {
  stand: ['☕', '🎵', ''],
  read: ['📖', ''],
  type: ['⌨', ''],
  think: ['💡', ''],
  search: ['🔍', ''],
  done: ['👋', '✨'],
  walk: [''],
};
// Walking pace in screen pixels, so a wide room is not crossed faster than a narrow one.
// 26 px/s matches the leg cycle in features.css (0.8s, ±24°): about 10px of ground per
// step, so the feet stay planted instead of sliding.
const WALK_PX_PER_SEC = 26;
const TURN_MS = 0; // turning round is instant (no pause before setting off)
const MIN_STAY_MS = 3000; // once at a piece, work there at least this long before heading elsewhere
function vaultRoomWidth() {
  // rooms span the list's width; on the very first draw there is no room to measure yet
  return document.querySelector('#listView .vault-room')?.clientWidth ||
    Math.max(0, (document.getElementById('sessionsContainer')?.clientWidth || 0) - 2) || 420;
}
function walkSecs(distPct) {
  return Math.max(0.7, (Math.abs(distPct) / 100) * vaultRoomWidth() / WALK_PX_PER_SEC);
}
// `left` moves linearly, matching the step cycle
function walkTransition(secs, delayMs = 0) {
  return `left ${secs.toFixed(2)}s linear ${delayMs}ms`;
}
const vaultDwellerAI = new Map(); // sessionId -> { x, face, pose, emote, dur, stopAt, nextAt }

function getIdleDwellerState(session, idx, totalCount) {
  const now = Date.now();
  let st = vaultDwellerAI.get(session.id);
  if (!st) {
    const h = sessionHash(session);
    const pose = IDLE_POSES[(h + idx) % IDLE_POSES.length];
    const baseX = totalCount === 1 ? 48 : Math.round(16 + (idx / Math.max(1, totalCount - 1)) * 68);
    st = {
      x: Math.max(12, Math.min(88, baseX + ((h % 13) - 6))),
      face: (h % 2) ? 1 : -1,
      pose,
      emote: '',
      dur: 0,
      stopAt: 0,
      nextAt: now + 1200 + (h % 5) * 900,
    };
    vaultDwellerAI.set(session.id, st);
  }
  return st;
}

// What an idle robot does at each piece of furniture (dx: px from the piece's centre,
// for the sofa that's the seat; otherwise the usual stance beside it)
const IDLE_AT = {
  rechargePod: { pose: 'sit', emote: '☕', dx: -8 },
  diffDesk: { pose: 'think', emote: '☕' },
  whiteboard: { pose: 'think', emote: '💡' },
  ctxTank: { pose: 'read', emote: '📖' },
  promptTerm: { pose: 'stand', emote: '👀' },
  gpuRack: { pose: 'stand', emote: '' },
  mcpDock: { pose: 'stand', emote: '' },
  vectorPods: { pose: 'search', emote: '' },
  forgeCore: { pose: 'stand', emote: '🔥' },
  // the room's window (window-art.js): stand right under it, back to you, and look out
  window: { pose: 'gaze', emote: '👀', dx: 0 },
};

// decor pieces (furniture-art.js): what idle robots do there
for (const [k, d] of Object.entries(typeof DECOR_IDLE !== 'undefined' ? DECOR_IDLE : {})) {
  IDLE_AT[k] = { pose: d.pose, emote: d.emote, ...(d.dx != null ? { dx: d.dx } : {}) };
}

function startIdleWalk(st, targetX, now, plan = null) {
  const dur = +walkSecs(Math.abs(targetX - st.x)).toFixed(2);
  st.face = targetX >= st.x ? 1 : -1;
  st.fromX = st.x;            // remembered so a redraw mid-walk puts it part-way, not at the end
  st.walkT0 = now + TURN_MS;
  st.x = targetX;
  st.pose = 'walk';
  st.dur = dur;
  st.turnMs = TURN_MS;
  st.stopAt = now + TURN_MS + dur * 1000;
  st.emote = '';
  st.plan = plan;             // what to do on arrival (sit, sip, read…)
  st.useKind = null;          // left whatever it was using
  st.nextAt = st.stopAt;
}

// occupied: % positions other robots are standing at — idle robots don't pick a spot
// on top of someone. pieces: free furniture in the room [{ kind, x }] to go and use.
function stepIdleDweller(st, occupied = [], pieces = []) {
  const now = Date.now();
  if (st.pose === 'walk' && now >= st.stopAt) {
    // Arrived: do what it came for, or just stand
    const p = st.plan;
    st.plan = null;
    st.dur = 0;
    st.stopAt = 0;
    if (p) {
      Object.assign(st, { pose: p.pose, face: p.face, emote: p.emote || '', useKind: p.kind || null, useX: p.at ?? null });
      st.nextAt = now + 6000 + Math.random() * 6000;
    } else {
      st.pose = 'stand';
      st.nextAt = now + 900 + Math.random() * 1400;
    }
    return;
  }
  const free = (x) => occupied.every((o) => Math.abs(o - x) >= 7);
  const roll = Math.random();
  const roomW = vaultRoomWidth();
  if (roll < 0.5 && pieces.length) {
    // go and use a piece of furniture nobody is at
    const options = pieces.map((f) => {
      const cfg = IDLE_AT[f.kind] || { pose: 'stand', emote: '' };
      const side = cfg.dx != null ? 0 : (Math.random() < 0.5 ? -1 : 1);
      const px = cfg.dx != null ? cfg.dx : side * (STANCE_PX[f.kind] || 24);
      const x = Math.max(4, Math.min(96, f.x + (px / roomW) * 100));
      const face = cfg.dx != null ? 1 : -side; // face the piece (sofa: sit facing out to the right)
      return { x, plan: { pose: cfg.pose, emote: f.emote || cfg.emote, face, kind: f.kind, at: f.x } };
    }).filter((o) => free(o.x) && Math.abs(o.x - st.x) > 1);
    if (options.length) {
      const o = options[Math.floor(Math.random() * options.length)];
      startIdleWalk(st, o.x, now, o.plan);
      return;
    }
  }
  if (roll < 0.75) {
    let targetX = st.x;
    for (let tries = 0; tries < 8; tries++) {
      const t = Math.round(12 + Math.random() * 76);
      if (free(t)) { targetX = t; break; }
    }
    if (Math.abs(targetX - st.x) < 2) { st.nextAt = now + 1500; return; } // nowhere free: wait
    startIdleWalk(st, targetX, now);
  } else {
    // a moment in place: stand, stretch (arms up) or think
    const acts = ['stand', 'stand', 'done', 'think'];
    st.pose = acts[Math.floor(Math.random() * acts.length)];
    st.useKind = null;
    st.face = Math.random() < 0.5 ? 1 : -1;
    st.dur = 0;
    st.turnMs = 0;
    st.stopAt = 0;
    const pool = IDLE_EMOTES[st.pose] || [''];
    st.emote = Math.random() < 0.45 ? pool[Math.floor(Math.random() * pool.length)] : '';
    st.nextAt = now + 3500 + Math.random() * 3500;
  }
}

// ---- Working robots go to the furniture for their task -------------------------
// Each workspace keeps a stable set of furniture (seeded, not tied to the "lead"
// robot). A working robot walks from where it is to the piece for its current step
// and uses it there. If the room has no such piece, it appears with a smoke puff;
// pieces that appeared that way poof away after a minute unused.
const TASK_FURNITURE = { hammer: 'promptTerm', type: 'diffDesk', read: 'ctxTank', search: 'vectorPods', web: 'mcpDock', think: 'whiteboard', run: 'gpuRack' };
const TASK_POSE_AT = { run: 'type' }; // "working" with no specific tool: operating the GPU rack
// How far from a piece's centre a robot stands to use it (px): close enough that its
// hands reach the keyboard / screen / panel, overlapping the piece's edge a little
const STANCE_PX = { diffDesk: 20, promptTerm: 24, gpuRack: 22, ctxTank: 20, vectorPods: 24, mcpDock: 22, whiteboard: 26, forgeCore: 26, rechargePod: 26 };
for (const [k, d] of Object.entries(typeof DECOR_IDLE !== 'undefined' ? DECOR_IDLE : {})) if (d.stance) STANCE_PX[k] = d.stance;
const FURN_SLOTS = [12, 25, 38, 51, 64, 77, 88];
const vaultRoomFurniture = new Map(); // room key -> [{ kind, x, spawned, needsPuff, lastUsed }]
const vaultWorkerAI = new Map();      // session id -> { x, tx, t0, dur, kind, side }

function roomFurnitureState(key, seed) {
  let list = vaultRoomFurniture.get(key);
  if (list) return list;
  const pool = [...ROOM_FURNITURE_POOLS.lounge];
  let s = Math.abs(seed || 1);
  for (let i = pool.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const slots = [12, 38, 64, 88].filter((_, i) => !(i === 2 && (s % 4) === 0));
  // each piece in the room's own look (original or the alternate), stable per room
  list = slots.map((x, i) => ({ kind: pool[i], x, variant: (s >>> (i * 3 + 5)) & 1, spawned: false, needsPuff: false, lastUsed: 0 }));
  // the last spot: a decor piece for idle robots (coffee bar, bookshelf, arcade…)
  if (typeof DECOR_KINDS !== 'undefined' && DECOR_KINDS.length) {
    list[list.length - 1] = { ...list[list.length - 1], kind: DECOR_KINDS[(s >>> 11) % DECOR_KINDS.length], variant: 0, decor: true };
  }
  vaultRoomFurniture.set(key, list);
  return list;
}

// The piece for `kind` in this room, spawning it into a free spot if needed
function furnitureFor(list, kind, busy) {
  let f = list.find((p) => p.kind === kind);
  if (f) return f;
  const free = FURN_SLOTS.find((x) => list.every((p) => Math.abs(p.x - x) >= 12));
  if (free !== undefined) {
    f = { kind, x: free, variant: Math.random() < 0.5 ? 1 : 0, spawned: true, needsPuff: true, lastUsed: Date.now() };
    list.push(f);
    return f;
  }
  // room full: swap out a piece nobody is using (decor first)
  const spare = list.find((p) => !busy.has(p) && p.decor) || list.find((p) => !busy.has(p));
  if (!spare) return list[0];
  Object.assign(spare, { kind, variant: Math.random() < 0.5 ? 1 : 0, decor: false, spawned: true, needsPuff: true, lastUsed: Date.now() });
  return spare;
}

// Where a robot is right now (it may be part-way through a walk)
function workerPos(st, now = Date.now()) {
  if (!st.dur) return st.tx;
  const k = Math.max(0, Math.min(1, (now - st.t0) / (st.dur * 1000))); // t0 may be ahead (still turning)
  return st.x + (st.tx - st.x) * k;
}

function furnitureSvg(p) {
  return `<svg class="vault-furn${p.needsPuff ? ' furn-spawn' : ''}${p.inUse ? ' in-use' : ''}" data-kind="${p.kind}" style="left:${p.x}%" viewBox="0 0 64 56">${typeof furnitureArt === 'function' ? furnitureArt(p.kind, p.variant) : AI_FURNITURE[p.kind]}</svg>`;
}

// After the room is on screen: puff for pieces that just appeared or left
function puffRoomFurniture(room, events) {
  if (!events.length) return;
  requestAnimationFrame(() => {
    const wall = room.querySelector('.vault-wall')?.getBoundingClientRect();
    if (!wall || !wall.width || typeof smokePuff !== 'function') return;
    for (const x of events) smokePuff(wall.left + wall.width * x / 100, wall.bottom - 26, 44);
  });
}

setInterval(() => {
  if (!document.body.classList.contains('list-grid') || document.body.classList.contains('list-compact')) return;
  const now = Date.now();
  const drawBot = (el, s, pose) => {
    const bot = el.querySelector('.vault-bot');
    if (bot) bot.innerHTML = window.buildRunnerSvg(robotHueFor(s), window.robotOutfitFor?.(s) || null, pose);
  };
  const setPoseClass = (el, pose) => {
    el.dataset.pose = pose;
    for (const c of [...el.classList]) if (c.startsWith('pose-')) el.classList.remove(c);
    el.classList.add(`pose-${pose}`);
  };
  // Working robot reaches its furniture: stop, turn to face it…
  document.querySelectorAll('.vault-walker[data-working="1"][data-arrive]:not(.is-grabbed)').forEach((el) => {
    if (now < Number(el.dataset.arrive)) return;
    el.removeAttribute('data-arrive');
    const s = sessionsList.find((x) => x.id === el.dataset.sid);
    if (!s || !el.dataset.taskPose) return;
    el.classList.remove('is-walking');
    setPoseClass(el, 'stand');
    drawBot(el, s, 'stand');
    const bot = el.querySelector('.vault-bot');
    if (bot) bot.style.transform = `scaleX(${el.dataset.face || 1})`;
    el.dataset.engage = String(now + 320);
  });
  // …then reach in and start the task
  document.querySelectorAll('.vault-walker[data-working="1"][data-engage]:not(.is-grabbed)').forEach((el) => {
    if (now < Number(el.dataset.engage)) return;
    el.removeAttribute('data-engage');
    const s = sessionsList.find((x) => x.id === el.dataset.sid);
    const pose = el.dataset.taskPose;
    if (!s || !pose) return;
    setPoseClass(el, pose);
    drawBot(el, s, pose);
    el.classList.add('engage');
    if (el.dataset.kind === 'mcpDock') el.classList.add('plugged');
    el.classList.remove('carrying');
    el.closest('.vault-room')?.querySelector(`.vault-furn[data-kind="${el.dataset.kind}"]`)?.classList.add('in-use');
    setTimeout(() => el.classList.remove('engage'), 600);
    if (pose === 'think' && !el.querySelector('.act-bubble')) el.insertAdjacentHTML('beforeend', '<span class="act-bubble"><i></i><i></i><i></i></span>');
  });
  // standing idle robots glance at whoever walks past (turn toward them, then back)
  document.querySelectorAll('.vault-room').forEach((room) => {
    const walking = [...room.querySelectorAll('.vault-walker.is-walking')].map((w) => { const b = w.getBoundingClientRect(); return { w, x: b.left + b.width / 2 }; });
    room.querySelectorAll('.vault-walker[data-idle="1"]:not(.is-walking):not(.is-grabbed)').forEach((el) => {
      const st = vaultDwellerAI.get(el.dataset.sid);
      const bot = el.querySelector('.vault-bot');
      if (!st || !bot || st.pose === 'sit' || st.pose === 'walk') return;
      const b = el.getBoundingClientRect();
      const cx = b.left + b.width / 2;
      const near = walking.filter((o) => o.w !== el && Math.abs(o.x - cx) < 70).sort((a, c) => Math.abs(a.x - cx) - Math.abs(c.x - cx))[0];
      const face = near ? (near.x >= cx ? 1 : -1) : st.face;
      bot.style.transform = `scaleX(${face})`;
    });
  });
  document.querySelectorAll('.vault-walker[data-idle="1"]:not(.is-grabbed)').forEach((el) => {
    const sid = el.dataset.sid;
    const s = sessionsList.find((x) => x.id === sid);
    if (!s) return;
    const st = vaultDwellerAI.get(sid);
    if (!st || now < st.nextAt || vaultFocus?.id === sid) return;
    // where the other robots are (and are heading), and which furniture is free to use
    const room = el.closest('.vault-room');
    const occupied = [...(room?.querySelectorAll('.vault-walker') || [])].filter((w) => w !== el)
      .map((w) => { const o = vaultDwellerAI.get(w.dataset.sid); return o && w.dataset.idle ? o.x : parseFloat(w.style.left); })
      .filter((v) => !Number.isNaN(v));
    const pieces = [...(room?.querySelectorAll('.vault-furn:not(.in-use), .vault-window') || [])]
      .map((f) => ({ kind: f.dataset.kind, x: parseFloat(f.style.left), emote: f.dataset.emote })).filter((f) => f.kind && !Number.isNaN(f.x));
    const wasUsing = st.useKind ? { kind: st.useKind, at: st.useX } : null;
    stepIdleDweller(st, occupied, pieces);
    const pieceAt = (u) => [...(room?.querySelectorAll(`.vault-furn[data-kind="${u.kind}"]`) || [])]
      .sort((a, b) => Math.abs(parseFloat(a.style.left) - u.at) - Math.abs(parseFloat(b.style.left) - u.at))[0];
    if (wasUsing && st.useKind !== wasUsing.kind) {
      // powers down, unless a working robot is using it
      const busyWorker = room?.querySelector(`.vault-walker[data-working="1"][data-kind="${wasUsing.kind}"]:not(.is-walking)`);
      if (!busyWorker) pieceAt(wasUsing)?.classList.remove('in-use');
    }
    if (st.useKind && st.pose !== 'walk') pieceAt({ kind: st.useKind, at: st.useX })?.classList.add('in-use');
    const prevPose = el.dataset.pose;
    setPoseClass(el, st.pose);
    el.classList.toggle('is-walking', st.pose === 'walk');
    el.style.transition = st.dur ? walkTransition(st.dur, st.turnMs || 0) : '';
    el.style.left = `${st.x}%`;
    const bot = el.querySelector('.vault-bot');
    if (bot) {
      bot.style.transform = `scaleX(${st.face})`;
      if (prevPose !== st.pose && typeof window.buildRunnerSvg === 'function') {
        const hue = typeof robotHueFor === 'function' ? robotHueFor(s) : 0;
        const outfit = typeof window.robotOutfitFor === 'function' ? window.robotOutfitFor(s) : null;
        bot.innerHTML = window.buildRunnerSvg(hue, outfit, st.pose);
      }
    }
    let bub = el.querySelector('.act-bubble');
    if (st.pose === 'think') {
      if (!bub) { bub = document.createElement('span'); bub.className = 'act-bubble'; bub.innerHTML = '<i></i><i></i><i></i>'; el.appendChild(bub); }
    } else if (bub) {
      bub.remove();
    }
    let em = el.querySelector('.vault-emote');
    if (st.emote) {
      if (!em) { em = document.createElement('span'); em.className = 'vault-emote'; el.appendChild(em); }
      em.textContent = st.emote;
    } else if (em) {
      em.remove();
    }
  });
}, 300);
