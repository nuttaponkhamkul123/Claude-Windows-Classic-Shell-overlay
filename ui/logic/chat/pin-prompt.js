// Pinned prompt (sticky section header): when your message is pushed up out of view by the
// agent's reply, a copy of it stays pinned at the top of the chat. Scroll up into an older
// answer and the bar shows the message that answer is for.
// Click the pinned bar to jump back to the message.
// Self-contained: only watches #chatStream, no other HUD code depends on it.
(function () {
  const chat = document.getElementById('chatStream');
  if (!chat || !chat.parentElement) return;
  const host = chat.parentElement; // .convo-main
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

  const bar = document.createElement('div');
  bar.id = 'pinnedPrompt';
  bar.className = 'pinned-prompt';
  bar.title = 'Your latest message — click to jump to it';
  bar.innerHTML = '<span class="pp-label">You said:</span><span class="pp-text"></span><span class="pp-images"></span>';
  bar.style.display = 'none';
  host.appendChild(bar);
  const textEl = bar.querySelector('.pp-text');
  const imgEl = bar.querySelector('.pp-images');

  let target = null; // the latest .chat-bubble.user element
  let raf = 0;

  // Settings › Chat: on (default) = the bar follows your scrolling; off = it always shows your latest message
  const api = window.electronAPI;
  let follow = !(api && api.settings && api.settings.pinFollowScroll === false);
  window.pinFollowOn = () => follow;
  window.setPinFollow = (v) => {
    follow = !!v;
    api?.storeSet?.('pinFollowScroll', follow);
    document.getElementById('btnPinFollow')?.classList.toggle('active', follow);
    schedule();
  };
  document.getElementById('btnPinFollow')?.classList.toggle('active', follow); // the Settings row (made earlier, in features.js)

  // The message whose answer you are reading: your last message that has scrolled
  // up past the top of the chat box (sticky section header). null = none has.
  // (With "follow" off: only your latest message, once it has scrolled up.)
  function currentUserBubble(top) {
    const all = chat.querySelectorAll('.chat-bubble.user');
    for (let i = all.length - 1; i >= (follow ? 0 : all.length - 1); i--) {
      if (all[i].getBoundingClientRect().bottom < top + 4) return all[i];
    }
    return null;
  }

  function fillFrom(bubble) {
    const content = bubble.querySelector('.bubble-content');
    let text = (content ? content.textContent : '').trim();
    if (content?.querySelector('.explain-pill')) {
      // "Explain …" pills: show their short labels, not the hidden full prompt
      const c = content.cloneNode(true);
      c.querySelectorAll('.ep-detail').forEach((n) => n.remove());
      c.querySelectorAll('.explain-pill').forEach((n) => { n.textContent = ' ' + [...n.children].filter((x) => !x.classList.contains('ep-meta')).map((x) => x.textContent).join(' ') + ' '; });
      text = c.textContent.replace(/\s+/g, ' ').trim();
    }
    const nImg = bubble.querySelectorAll('.chat-bubble-image').length;
    const nFile = bubble.querySelectorAll('.bubble-file').length;
    textEl.textContent = text || (nImg ? '(image)' : nFile ? '(file)' : '');
    const extras = [];
    if (nImg) extras.push(`🖼 ${nImg}`);
    if (nFile) extras.push(`📄 ${nFile}`);
    imgEl.textContent = extras.join('  ');
  }

  function update() {
    raf = 0;
    const detailOpen = chat.offsetParent !== null; // hidden when the list view is shown
    const chatRect = chat.getBoundingClientRect();
    target = detailOpen ? currentUserBubble(chatRect.top) : null;
    if (!target) { bar.style.display = 'none'; return; }

    fillFrom(target);
    const all = chat.querySelectorAll('.chat-bubble.user');
    bar.title = target === all[all.length - 1] ? 'Your latest message — click to jump to it' : 'The message this answer is for — click to jump to it';
    // Overlay the top edge of the chat box (inside its border)
    const hostRect = host.getBoundingClientRect();
    bar.style.top = `${chatRect.top - hostRect.top + 1}px`;
    bar.style.left = `${chatRect.left - hostRect.left + 1}px`;
    bar.style.width = `${chat.clientWidth}px`;
    bar.style.display = '';
  }

  function schedule() { if (!raf) raf = requestAnimationFrame(update); }

  chat.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  new MutationObserver(schedule).observe(chat, { childList: true, subtree: true, characterData: true });
  // The chat box moves when the info bar / context meter show or hide
  if (window.ResizeObserver) new ResizeObserver(schedule).observe(chat);

  bar.addEventListener('click', () => {
    if (!target) return;
    const delta = target.getBoundingClientRect().top - chat.getBoundingClientRect().top;
    chat.scrollTo({ top: Math.max(0, chat.scrollTop + delta - 6), behavior: 'smooth' });
  });

  schedule();
})();
