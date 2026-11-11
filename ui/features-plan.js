// "Plan first" for Claude chats:
//   📝 Plan (toolbar switch) → your message runs in plan mode: Claude reads and
//   plans but changes nothing — the HUD runs it on the plan model (default Opus).
//   When the plan is ready → a "Plan ready" card: Approve / Revise / Cancel.
//   Approve → the planning turn ends, then the HUD asks Claude to implement it
//   in normal mode (auto-accept edits) on the execute model (default Sonnet).
(function () {
  const api = window.electronAPI;
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const IMPLEMENT_MSG = 'The plan is approved. Go ahead and implement it now.';
  const APPROVED_NOTE = 'The user approved this plan in the HUD. Do not start implementing in this turn: ' +
    'reply with one short line confirming, then stop. The implementation will be requested in the next message.';
  const CANCEL_NOTE = 'The user rejected this plan. Stop here and wait for further instructions.';
  const reviseNote = (fb) => `The user wants changes to the plan: ${fb}\n\nRevise the plan and present it again with ExitPlanMode.`;

  // Models the HUD picks itself in the plan-first flow (saved settings override)
  window.fxPlanModels = { plan: 'opus', exec: 'sonnet' };
  const cap = (m) => String(m || '').replace(/^./, (c) => c.toUpperCase());
  (api.storeGetAll ? api.storeGetAll() : Promise.resolve({})).then((st) => {
    if (st && typeof st.planModel === 'string' && st.planModel) window.fxPlanModels.plan = st.planModel;
    if (st && typeof st.execModel === 'string' && st.execModel) window.fxPlanModels.exec = st.execModel;
  }).catch(() => {});

  const pendingPlans = new Map(); // sessionId -> permission request (ExitPlanMode)
  const planTurns = new Set();    // sessions whose current run is a plan-mode run
  const planShown = new Set();    // plan-mode runs that already showed a plan card
  const pendingExecute = new Set(); // approved → send IMPLEMENT_MSG when the turn ends

  const isClaude = (s) => s && s.source === 'claude';
  const isSupported = (s) => s && (s.source === 'claude' || s.source === 'antigravity');
  const planner = (s = currentActiveSession) => (s && s.source === 'antigravity' ? 'Antigravity' : cap(window.fxPlanModels.plan));
  const executor = (s = currentActiveSession) => (s && s.source === 'antigravity' ? 'Antigravity' : cap(window.fxPlanModels.exec));
  const agentName = (s = currentActiveSession) => (s && s.source === 'antigravity' ? 'Antigravity' : 'Claude');

  // ---------------- 📝 Plan switch ----------------
  const toolbar = document.querySelector('.reply-toolbar');
  const anchor = document.querySelector('.rt-voice') || document.getElementById('btnSnip') || document.getElementById('btnSlash');
  const btnPlan = el('button', 'rt-btn rt-text rt-plan', '📝 Plan');
  btnPlan.title = 'Plan first: the agent plans without changing anything, you approve, then it carries the plan out.';
  if (toolbar && anchor) anchor.after(btnPlan);
  const defaultPlaceholder = replyTextarea.placeholder;

  function syncPlanButton() {
    const s = currentActiveSession;
    const show = isSupported(s);
    btnPlan.style.display = show ? '' : 'none';
    const on = show && !!getReplyOptions(s).plan;
    btnPlan.classList.toggle('active', on);
    replyTextarea.placeholder = on
      ? `Plan first is ON — describe the task; ${planner(s)} will plan it without changing anything…`
      : defaultPlaceholder;
  }
  btnPlan.addEventListener('click', () => {
    const s = currentActiveSession;
    if (!isSupported(s)) return;
    const opts = getReplyOptions(s);
    opts.plan = !opts.plan;
    syncPlanButton();
    addSystemNote(opts.plan
      ? `Plan first is on: your next messages make a plan only. ${planner(s)} plans, then carries it out after you approve.`
      : `Plan first is off: ${agentName(s)} works on your messages directly again.`);
    replyTextarea.focus();
  });

  // ---------------- Plan ready card ----------------
  function cardFor(sessionId) {
    return chatStream.querySelector(`.plan-card[data-session="${CSS.escape(sessionId)}"]`);
  }

  function renderPlanCard(req) {
    const s = currentActiveSession;
    if (!s || s.id !== req.sessionId) return;
    cardFor(req.sessionId)?.remove();
    const card = el('div', 'plan-card');
    card.dataset.session = req.sessionId;
    const head = el('div', 'plan-head');
    head.append(el('span', 'plan-ico', '📋'), el('span', 'plan-title', 'Plan ready — review it'));
    const body = el('div', 'plan-body');
    const plan = String(req.input?.plan || `*(${agentName(s)} did not include the plan text — see its message above.)*`);
    body.innerHTML = window.marked ? window.marked.parse(plan) : '';
    if (!window.marked) body.textContent = plan;

    const actions = el('div', 'plan-actions');
    const approve = el('button', 'plan-btn primary', `✓ Approve — ${executor(s)} carries it out`);
    const revise = el('button', 'plan-btn', '✎ Revise');
    const cancel = el('button', 'plan-btn', '✕ Cancel');
    actions.append(approve, revise, cancel);

    const reviseBox = el('div', 'plan-revise');
    reviseBox.style.display = 'none';
    const fb = el('textarea', 'plan-feedback');
    fb.placeholder = 'What should change in the plan?';
    const sendFb = el('button', 'plan-btn primary', `Send to ${agentName(s)}`);
    reviseBox.append(fb, sendFb);

    const status = el('div', 'plan-status');
    card.append(head, body, actions, reviseBox, status);
    const stream = document.getElementById('streamingBubble');
    if (stream) chatStream.insertBefore(card, stream); else chatStream.appendChild(card);
    chatStream.scrollTop = chatStream.scrollHeight;

    const done = (text, cls) => {
      actions.remove();
      reviseBox.remove();
      status.textContent = text;
      card.classList.add(cls || 'resolved');
    };

    approve.addEventListener('click', () => {
      if (!pendingPlans.has(req.sessionId)) return done('This plan request has expired.', 'expired');
      api.respondPermission(req.id, 'deny', APPROVED_NOTE);
      pendingPlans.delete(req.sessionId);
      getReplyOptions(s).plan = false; // the next message is the real work
      syncPlanButton();
      pendingExecute.add(req.sessionId);
      done(`✓ Approved — ${executor(s)} will start as soon as the planning step closes.`, 'approved');
    });
    revise.addEventListener('click', () => {
      reviseBox.style.display = reviseBox.style.display === 'none' ? '' : 'none';
      if (reviseBox.style.display === '') fb.focus();
    });
    sendFb.addEventListener('click', () => {
      const t = fb.value.trim();
      if (!t) { fb.focus(); return; }
      if (!pendingPlans.has(req.sessionId)) return done('This plan request has expired.', 'expired');
      api.respondPermission(req.id, 'deny', reviseNote(t));
      pendingPlans.delete(req.sessionId);
      done(`✎ Sent your changes — Claude is revising the plan: “${t.slice(0, 120)}”`, 'revising');
    });
    fb.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendFb.click(); }
      e.stopPropagation();
    });
    cancel.addEventListener('click', () => {
      if (pendingPlans.has(req.sessionId)) api.respondPermission(req.id, 'deny', CANCEL_NOTE);
      pendingPlans.delete(req.sessionId);
      done('✕ Plan cancelled. Nothing was changed.', 'cancelled');
    });
  }

  // Claude finished a plan (it asks to use ExitPlanMode) — app.js hands it here
  window.handlePlanRequest = function (req) {
    pendingPlans.set(req.sessionId, req);
    planShown.add(req.sessionId);
    try { window.soundSynth.playAttention(); } catch (_) {}
    if (currentActiveSession?.id === req.sessionId) renderPlanCard(req);
    else replyStatusMsg.textContent = '📋 A plan is ready for your review — open that chat';
  };

  api.onPermissionExpired?.(({ id }) => {
    for (const [sid, req] of pendingPlans) {
      if (req.id !== id) continue;
      pendingPlans.delete(sid);
      const card = cardFor(sid);
      if (card && !card.classList.contains('approved')) {
        card.querySelector('.plan-actions')?.remove();
        card.querySelector('.plan-revise')?.remove();
        card.querySelector('.plan-status').textContent = 'This plan request is no longer active.';
        card.classList.add('expired');
      }
    }
  });

  // ---------------- turn start / end ----------------
  function sendImplement(sessionId) {
    const s = sessionsList.find((x) => x.id === sessionId) || (currentActiveSession?.id === sessionId ? currentActiveSession : null);
    if (!s) return;
    const o = getReplyOptions(s);
    o.plan = false;
    if (isClaude(s)) o.oneShotModel = window.fxPlanModels.exec; // Claude: this one message runs on the execute model
    if (currentActiveSession?.id === sessionId) {
      const keep = replyTextarea.value;
      replyTextarea.value = IMPLEMENT_MSG;
      submitReply();
      if (keep && !replyTextarea.value) replyTextarea.value = keep;
    } else {
      const userMsg = { role: 'user', text: IMPLEMENT_MSG, time: 'Just now' };
      if (!sessionChatHistory.has(sessionId)) sessionChatHistory.set(sessionId, []);
      sessionChatHistory.get(sessionId).push(userMsg);
      liveActivity.set(sessionId, { act: { kind: 'sending', since: Date.now() }, at: Date.now() });
      api.sendReply({ text: IMPLEMENT_MSG, session: s, options: takeReplyOptions(s) });
    }
  }

  // Plan finished without ExitPlanMode (Claude / Antigravity just wrote the plan): offer the same choice
  function renderPlanBar(sessionId) {
    if (currentActiveSession?.id !== sessionId || cardFor(sessionId)) return;
    const s = currentActiveSession;
    const card = el('div', 'plan-card plan-bar');
    card.dataset.session = sessionId;
    const head = el('div', 'plan-head');
    head.append(el('span', 'plan-ico', '📋'), el('span', 'plan-title', `${agentName(s)} finished planning — the plan is in its reply above`));
    const actions = el('div', 'plan-actions');
    const approve = el('button', 'plan-btn primary', `✓ Approve — ${executor(s)} carries it out`);
    const keep = el('button', 'plan-btn', '✎ Keep planning');
    actions.append(approve, keep);
    const status = el('div', 'plan-status');
    card.append(head, actions, status);
    chatStream.appendChild(card);
    chatStream.scrollTop = chatStream.scrollHeight;
    approve.addEventListener('click', () => {
      actions.remove();
      status.textContent = `✓ Approved — ${executor(s)} is starting.`;
      card.classList.add('approved');
      sendImplement(sessionId);
    });
    keep.addEventListener('click', () => {
      actions.remove();
      status.textContent = 'Type what should change — Plan first stays on.';
      replyTextarea.focus();
    });
  }

  api.onReplyStatus?.(({ sessionId, status }) => {
    const s = sessionsList.find((x) => x.id === sessionId) || (currentActiveSession?.id === sessionId ? currentActiveSession : null);
    if (status === 'running') {
      if (s && isSupported(s) && getReplyOptions(s).plan) { planTurns.add(sessionId); planShown.delete(sessionId); }
      return;
    }
    if (status !== 'idle') return;
    if (pendingExecute.has(sessionId)) {
      pendingExecute.delete(sessionId);
      planTurns.delete(sessionId);
      setTimeout(() => sendImplement(sessionId), 700); // let the HUD settle into "idle" first
      return;
    }
    if (planTurns.has(sessionId)) {
      planTurns.delete(sessionId);
      if (!planShown.has(sessionId) && !pendingPlans.has(sessionId)) setTimeout(() => renderPlanBar(sessionId), 300);
    }
  });

  // New chat got its real id → carry plan state over
  api.onReplyRekey?.(({ oldId, newId }) => {
    for (const set of [planTurns, planShown, pendingExecute]) if (set.has(oldId)) { set.delete(oldId); set.add(newId); }
    if (pendingPlans.has(oldId)) { pendingPlans.set(newId, pendingPlans.get(oldId)); pendingPlans.delete(oldId); }
  });

  // Opening a chat → show its plan card again if one is waiting; keep the switch in sync
  let lastId = null;
  setInterval(() => {
    const s = currentActiveSession;
    const id = s && detailView.classList.contains('active') ? s.id : null;
    if (id !== lastId) {
      lastId = id;
      if (id && pendingPlans.has(id) && !cardFor(id)) renderPlanCard(pendingPlans.get(id));
    }
    syncPlanButton();
  }, 500);
})();
