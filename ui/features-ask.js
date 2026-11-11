// Claude's multiple-choice question tool (AskUserQuestion) → a real question card
// in the chat: one button per option, an "Other…" box and Skip. Your pick goes back
// to Claude as the tool's answer, so it continues in the same turn.
// (Same mechanism as the Plan-ready card in features-plan.js: deny + a message.)
(function () {
  const api = window.electronAPI;

  const pendingAsks = new Map(); // sessionId -> permission request (AskUserQuestion) or Antigravity pendingQuestion
  const answeredAgAsks = new Set(); // ag_ask_* ids already answered in this HUD session

  const questionsOf = (req) => (Array.isArray(req.input?.questions) ? req.input.questions : []);
  const labelOf = (o) => String(o && typeof o === 'object' ? o.label ?? '' : o ?? '');
  const agentName = (s) => (s && s.source === 'antigravity' ? 'Antigravity' : 'Claude');

  function cardFor(sessionId) {
    return chatStream.querySelector(`.ask-card[data-session="${CSS.escape(sessionId)}"]`);
  }

  function renderAskCard(req) {
    const s = currentActiveSession;
    if (!s || s.id !== req.sessionId) return;
    cardFor(req.sessionId)?.remove();

    const aName = agentName(s);
    const qs = questionsOf(req);
    const card = el('div', 'ask-card');
    card.dataset.session = req.sessionId;
    const head = el('div', 'ask-head');
    head.append(el('span', 'ask-ico', '❓'), el('span', 'ask-title', qs.length > 1 ? `${aName} has questions for you` : `${aName} has a question for you`));
    card.appendChild(head);

    if (!qs.length) {
      card.appendChild(el('div', 'ask-q', `${aName} asked a question (see its message above).`));
    }

    // One block per question; picks[i] = Set of chosen labels, others[i] = text input
    const picks = qs.map(() => new Set());
    const others = [];
    const quick = qs.length === 1 && !qs[0].multiSelect; // single question, single choice → click sends

    const collect = () => qs.map((q, i) => {
      const typed = (others[i]?.value || '').trim();
      return { question: q.question || q.header || `Question ${i + 1}`, answer: typed || [...picks[i]].join(', ') };
    });

    const finish = (note, summary, cls) => {
      if (req.isReplyQuestion) {
        answeredAgAsks.add(req.id);
        pendingAsks.delete(req.sessionId);
        card.querySelectorAll('.ask-actions, .ask-opts, .ask-other').forEach((n) => n.remove());
        const st = card.querySelector('.ask-status') || card.appendChild(el('div', 'ask-status'));
        st.textContent = summary;
        card.classList.add(cls);
        if (currentActiveSession?.id === req.sessionId) {
          const keep = replyTextarea.value;
          replyTextarea.value = note;
          submitReply();
          if (keep && !replyTextarea.value) replyTextarea.value = keep;
        } else {
          api.sendReply({ text: note, session: s, options: typeof takeReplyOptions === 'function' ? takeReplyOptions(s) : {} });
        }
        return;
      }
      api.respondPermission(req.id, 'deny', note);
      pendingAsks.delete(req.sessionId);
      card.querySelectorAll('.ask-actions, .ask-opts, .ask-other').forEach((n) => n.remove());
      const st = card.querySelector('.ask-status') || card.appendChild(el('div', 'ask-status'));
      st.textContent = summary;
      card.classList.add(cls);
    };

    const send = () => {
      if (!pendingAsks.has(req.sessionId)) return;
      const answers = collect();
      if (answers.some((a) => !a.answer)) {
        const miss = card.querySelector('.ask-status') || card.appendChild(el('div', 'ask-status'));
        miss.textContent = 'Pick an option (or type your own) for every question first.';
        return;
      }
      const note = req.isReplyQuestion
        ? (answers.length === 1 ? answers[0].answer : answers.map((a) => `- ${a.question}: ${a.answer}`).join('\n'))
        : ('The user answered in the HUD:\n' + answers.map((a) => `- ${a.question}: ${a.answer}`).join('\n') +
          '\n\nTreat this as the answer to your question and continue.');
      finish(note, '✓ You answered: ' + answers.map((a) => a.answer).join(' · '), 'answered');
    };

    qs.forEach((q, i) => {
      const block = el('div', 'ask-block');
      if (q.header) block.appendChild(el('span', 'ask-tag', String(q.header)));
      block.appendChild(el('div', 'ask-q', String(q.question || '')));
      const opts = el('div', 'ask-opts');
      for (const o of Array.isArray(q.options) ? q.options : []) {
        const label = labelOf(o);
        const b = el('button', 'ask-opt', label);
        if (o && o.description) { b.title = o.description; b.appendChild(el('span', 'ask-opt-desc', String(o.description))); }
        b.addEventListener('click', () => {
          if (quick) { picks[i] = new Set([label]); send(); return; }
          if (q.multiSelect) {
            if (picks[i].has(label)) picks[i].delete(label); else picks[i].add(label);
          } else {
            picks[i] = new Set([label]);
            opts.querySelectorAll('.ask-opt').forEach((x) => x.classList.remove('picked'));
          }
          b.classList.toggle('picked', picks[i].has(label));
        });
        opts.appendChild(b);
      }
      block.appendChild(opts);
      const other = el('div', 'ask-other');
      const inp = el('input', 'ask-input');
      inp.placeholder = 'Other — type your own answer…';
      inp.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { picks[i] = new Set(); send(); }
      });
      other.appendChild(inp);
      others[i] = inp;
      block.appendChild(other);
      card.appendChild(block);
    });

    const actions = el('div', 'ask-actions');
    if (!quick) { const sendBtn = el('button', 'ask-btn primary', 'Send answer'); sendBtn.addEventListener('click', send); actions.appendChild(sendBtn); }
    else {
      const sendBtn = el('button', 'ask-btn', 'Send typed answer');
      sendBtn.addEventListener('click', () => { picks[0] = new Set(); send(); });
      actions.appendChild(sendBtn);
    }
    const skip = el('button', 'ask-btn', 'Skip');
    skip.title = `Let ${aName} continue without an answer`;
    skip.addEventListener('click', () => {
      if (!pendingAsks.has(req.sessionId)) return;
      finish('Continue with your best judgement and state what you assumed.', `Skipped — ${aName} continues on its own.`, 'cancelled');
    });
    actions.appendChild(skip);
    card.appendChild(actions);

    const stream = document.getElementById('streamingBubble');
    if (stream) chatStream.insertBefore(card, stream); else chatStream.appendChild(card);
    chatStream.scrollTop = chatStream.scrollHeight;
  }

  // app.js hands every AskUserQuestion permission request to us
  window.handleQuestionRequest = function (req) {
    pendingAsks.set(req.sessionId, req);
    try { window.soundSynth.playAttention(); } catch (_) {}
    if (currentActiveSession?.id === req.sessionId) renderAskCard(req);
    else replyStatusMsg.textContent = '❓ A question is waiting for you — open that chat';
  };

  api.onPermissionExpired?.(({ id }) => {
    for (const [sid, req] of pendingAsks) {
      if (req.id !== id) continue;
      pendingAsks.delete(sid);
      const card = cardFor(sid);
      if (card && !card.classList.contains('answered')) {
        card.querySelectorAll('.ask-actions, .ask-opts, .ask-other').forEach((n) => n.remove());
        const st = card.querySelector('.ask-status') || card.appendChild(el('div', 'ask-status'));
        st.textContent = 'This question is no longer active (the run ended).';
        card.classList.add('expired');
      }
    }
  });

  // New chat got its real id → carry the pending question over
  api.onReplyRekey?.(({ oldId, newId }) => {
    if (pendingAsks.has(oldId)) { pendingAsks.set(newId, pendingAsks.get(oldId)); pendingAsks.delete(oldId); }
  });

  // Opening a chat (or Antigravity calling ask_question) → show its waiting question
  let lastId = null;
  setInterval(() => {
    const s = currentActiveSession;
    const id = s && detailView.classList.contains('active') ? s.id : null;
    if (s && s.pendingQuestion && s.pendingQuestion.id && !answeredAgAsks.has(s.pendingQuestion.id)) {
      const existing = pendingAsks.get(s.id);
      if (!existing || existing.id !== s.pendingQuestion.id) {
        pendingAsks.set(s.id, {
          id: s.pendingQuestion.id,
          sessionId: s.id,
          isReplyQuestion: true,
          input: { questions: s.pendingQuestion.questions },
        });
      }
    } else if (s && pendingAsks.get(s.id)?.isReplyQuestion && !s.pendingQuestion) {
      pendingAsks.delete(s.id);
      cardFor(s.id)?.remove();
    }
    if (id !== lastId) {
      lastId = id;
      if (id && pendingAsks.has(id) && !cardFor(id)) renderAskCard(pendingAsks.get(id));
    } else if (id && pendingAsks.has(id) && !cardFor(id)) {
      renderAskCard(pendingAsks.get(id));
    }
  }, 500);
})();
