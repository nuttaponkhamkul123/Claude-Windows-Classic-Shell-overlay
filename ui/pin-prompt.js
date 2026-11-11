// Pinned prompt: when your latest message is pushed up out of view by the
// agent's reply, a copy of it stays pinned at the top of the chat.
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

  function latestUserBubble() {
    const all = chat.querySelectorAll('.chat-bubble.user');
    return all.length ? all[all.length - 1] : null;
  }

  function fillFrom(bubble) {
    const content = bubble.querySelector('.bubble-content');
    const text = (content ? content.textContent : '').trim();
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
    target = detailOpen ? latestUserBubble() : null;
    if (!target) { bar.style.display = 'none'; return; }

    // Pinned once the message's bottom has scrolled above the visible top
    const chatRect = chat.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    const pushedOut = r.bottom < chatRect.top + 4;
    if (!pushedOut) { bar.style.display = 'none'; return; }

    fillFrom(target);
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
