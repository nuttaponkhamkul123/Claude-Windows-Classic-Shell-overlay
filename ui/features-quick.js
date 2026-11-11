// Quick-reply buttons: when the open chat is waiting for your input and the
// agent's last message is a yes/no question, show  [✓ Yes] [✕ No]  above the
// input box. One click sends the answer.
(function () {
  const box = document.querySelector('.reply-box');
  if (!box) return;
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const bar = el('div', 'quick-replies');
  bar.style.display = 'none';
  box.before(bar);

  // Questions that start like a yes/no question, or say so
  const YES_NO_START = /^(would|do|does|did|should|shall|can|could|is|are|was|were|will|have|has|may|might|want|ready|ok(ay)?)\b/i;
  const YES_NO_WORDS = /\b(yes\s*\/\s*no|yes or no|y\s*\/\s*n)\b/i;

  function lastQuestion() {
    const bubbles = chatStream.querySelectorAll('.chat-bubble.assistant');
    const last = bubbles[bubbles.length - 1];
    if (!last || last.id === 'streamingBubble') return '';
    const text = (last.querySelector('.bubble-content')?.textContent || '').trim();
    return text;
  }

  // The final sentence ends with "?" and reads like a yes/no question
  function isYesNoQuestion(text) {
    const t = text.replace(/[*_`>#]/g, '').trim();
    if (YES_NO_WORDS.test(t.slice(-300))) return true; // says "(yes/no)" itself
    if (!t.endsWith('?')) return false;
    // last sentence = after the previous . ! ? or line break
    const body = t.slice(0, -1);
    const cut = Math.max(body.lastIndexOf('. '), body.lastIndexOf('! '), body.lastIndexOf('? '), body.lastIndexOf('\n'));
    const sentence = body.slice(cut + 1).trim();
    if (!YES_NO_START.test(sentence)) return false;
    // "A or B?" choices are not yes/no (keep it for the user to type)
    return !/\bor\b/i.test(sentence) || /\bor not\b/i.test(sentence);
  }

  // ---- Multiple choice: a numbered / lettered list followed (or preceded) by a question ----
  const optBar = el('div', 'quick-replies option-replies');
  optBar.style.display = 'none';
  box.before(optBar);

  // "Option title — explanation" -> "Option title"
  function shortLabel(item) {
    const strong = item.querySelector('strong, b');
    let t = (strong && item.textContent.trim().startsWith(strong.textContent.trim().slice(0, 6))
      ? strong.textContent : item.textContent).replace(/\s+/g, ' ').trim();
    t = t.split(/\s[—–-]\s|:\s|\.\s/)[0].trim().replace(/[.:]$/, '');
    return t.length > 44 ? t.slice(0, 43) + '…' : t;
  }

  // Returns [{ mark, label, full }] or null
  function parseOptions() {
    const bubbles = chatStream.querySelectorAll('.chat-bubble.assistant');
    const last = bubbles[bubbles.length - 1];
    if (!last || last.id === 'streamingBubble') return null;
    const content = last.querySelector('.bubble-content');
    if (!content) return null;
    const kids = [...content.children];
    const isQuestion = (n) => n && /\?\s*$/.test((n.textContent || '').replace(/[*_`]/g, '').trim());
    // the list is the last <ol>/<ul> that sits within 2 blocks of the end of the message
    let idx = -1;
    for (let i = kids.length - 1; i >= Math.max(0, kids.length - 3); i--) {
      if (/^(OL|UL)$/.test(kids[i].tagName)) { idx = i; break; }
    }
    if (idx < 0) return null;
    const after = kids.slice(idx + 1);
    const before = kids[idx - 1];
    const asks = after.length ? isQuestion(after[after.length - 1]) : isQuestion(before);
    if (!asks) return null;
    const items = [...kids[idx].children].filter((n) => n.tagName === 'LI');
    if (items.length < 2 || items.length > 8) return null;
    const ordered = kids[idx].tagName === 'OL';
    // a bullet list is only a choice if it says so ("which", "pick", "choose", "or")
    if (!ordered) {
      const q = (after.length ? after[after.length - 1] : before).textContent.toLowerCase();
      if (!/\b(which|pick|choose|select|prefer|option|or)\b/.test(q)) return null;
    }
    return items.map((li, i) => ({
      mark: ordered ? String(i + 1) : '',
      label: shortLabel(li),
      full: li.textContent.replace(/\s+/g, ' ').trim()
    }));
  }

  let shownKey = '';
  function send(answer) {
    bar.style.display = 'none';
    optBar.style.display = 'none';
    shownKey = 'sent';
    replyTextarea.value = answer;
    submitReply();
  }

  function showOptions(opts) {
    optBar.innerHTML = '';
    optBar.appendChild(el('span', 'qr-lead', 'Pick one (Ctrl+click for several):'));
    const chosen = new Set();
    const sendBtn = el('button', 'qr-btn primary', 'Send');
    sendBtn.style.display = 'none';
    const answerFor = (o) => (o.mark ? `${o.mark}. ${o.label}` : o.label);
    const buttons = opts.map((o) => {
      const b = el('button', 'qr-btn', o.mark ? `${o.mark} · ${o.label}` : o.label);
      b.title = o.full;
      b.addEventListener('click', (e) => {
        if (e.ctrlKey || e.shiftKey || chosen.size) {
          chosen.has(o) ? chosen.delete(o) : chosen.add(o);
          b.classList.toggle('picked', chosen.has(o));
          sendBtn.style.display = chosen.size ? '' : 'none';
          sendBtn.textContent = `Send ${chosen.size}`;
          return;
        }
        send(answerFor(o));
      });
      return b;
    });
    sendBtn.addEventListener('click', () => {
      const picked = opts.filter((o) => chosen.has(o));
      if (picked.length) send(picked.map(answerFor).join('\n'));
    });
    optBar.append(...buttons, sendBtn);
    optBar.style.display = '';
  }

  function update() {
    const s = currentActiveSession;
    const open = s && detailView.classList.contains('active');
    const waiting = open && (s.unread || s.state === 'attention') && s.status !== 'running' &&
      !document.getElementById('streamingBubble');
    if (!waiting) { bar.style.display = 'none'; optBar.style.display = 'none'; shownKey = ''; return; }
    const q = lastQuestion();
    const key = `${s.id}|${s.lastRecordId}|${q.length}`;
    if (key === shownKey) return;
    if (!q || !isYesNoQuestion(q)) {
      bar.style.display = 'none';
      shownKey = key;
      const opts = q ? parseOptions() : null;
      if (opts) showOptions(opts); else optBar.style.display = 'none';
      return;
    }
    optBar.style.display = 'none';
    shownKey = key;
    bar.innerHTML = '';
    bar.appendChild(el('span', 'qr-lead', 'Quick reply:'));
    const yes = el('button', 'qr-btn primary', '✓ Yes');
    const no = el('button', 'qr-btn', '✕ No');
    yes.title = 'Send "Yes"';
    no.title = 'Send "No"';
    yes.addEventListener('click', () => send('Yes'));
    no.addEventListener('click', () => send('No'));
    bar.append(yes, no);
    bar.style.display = '';
  }
  setInterval(update, 500);
})();
