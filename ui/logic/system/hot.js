// Hot reload, renderer side (main/hot-reload.js decides what changed):
//   hot:css           → re-load just those stylesheets in place
//   hot:before-reload → remember the open chat + unsent text, restored after the refresh
//   hot:update-ready  → "Update ready — Restart" bar for main-process changes
(function () {
  const api = window.electronAPI;
  if (!api || !api.onHotCss) return;
  const KEY = 'hud:hot-restore';

  // ---- CSS: swap the <link> without a reload (new one loads first → no flash) ----
  api.onHotCss((files) => {
    for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
      const baseHref = (link.getAttribute('href') || '').split('?')[0];
      const name = baseHref.split('/').pop();
      if (!files.includes(name)) continue;
      const fresh = link.cloneNode();
      fresh.href = `${baseHref}?t=${Date.now()}`;
      fresh.addEventListener('load', () => link.remove(), { once: true });
      link.after(fresh);
    }
  });

  // ---- page refresh: keep your place ----
  api.onHotBeforeReload(() => {
    try {
      const box = document.getElementById('replyTextarea');
      const stream = document.getElementById('chatStream');
      sessionStorage.setItem(KEY, JSON.stringify({
        chat: (typeof currentActiveSession !== 'undefined' && currentActiveSession && !currentActiveSession.draft) ? currentActiveSession.id : null,
        focus: document.body.classList.contains('vault-focus'), // chat was open beside its robot
        draft: box ? box.value : '',
        atBottom: stream ? stream.scrollHeight - stream.scrollTop - stream.clientHeight < 80 : true,
      }));
    } catch (_) {}
  });

  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (_) {}
  sessionStorage.removeItem(KEY);
  if (saved) {
    const started = Date.now();
    const restore = () => {
      const list = typeof sessionsList !== 'undefined' ? sessionsList : [];
      if (saved.chat && !list.length && Date.now() - started < 6000) { setTimeout(restore, 150); return; }
      const s = saved.chat && list.find((x) => x.id === saved.chat);
      if (s && saved.focus && typeof openVaultFocus === 'function') {
        // reopen beside its robot; the robots may need a moment to be drawn
        if (!openVaultFocus(s)) {
          if (Date.now() - started < 6000) { setTimeout(restore, 150); return; }
          showDetailView(s);
        }
      } else if (s && typeof showDetailView === 'function') showDetailView(s);
      const box = document.getElementById('replyTextarea');
      if (box && saved.draft) { box.value = saved.draft; box.dispatchEvent(new Event('input', { bubbles: true })); }
      if (saved.atBottom) {
        const stream = document.getElementById('chatStream');
        if (stream) setTimeout(() => { stream.scrollTop = stream.scrollHeight; }, 300);
      }
      flash('↻ Reloaded with your latest changes');
    };
    restore();
  }

  // ---- main-process change: ask, never restart on our own ----
  let bar = null;
  const setHotFlag = (on) => {
    document.body.classList.toggle('has-hot-update', !!on);
    if (typeof updateMiniAvatar === 'function') updateMiniAvatar();
  };
  api.onHotUpdateReady((files) => {
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'hot-bar';
      bar.innerHTML = '<span class="hot-ico">⟳</span><span class="hot-text"></span><span class="hot-actions"><button class="hot-go">Restart</button><button class="hot-later" title="Hide until the next change">Later</button></span>';
      bar.querySelector('.hot-go').addEventListener('click', () => {
        bar.remove(); bar = null;
        setHotFlag(false);
        document.getElementById('btnRestartApp')?.click(); // asks first if a reply is still running
      });
      bar.querySelector('.hot-later').addEventListener('click', () => {
        bar.remove(); bar = null;
        setHotFlag(false);
      });
      document.body.appendChild(bar);
    }
    setHotFlag(true);
    const names = [...new Set(files.map((f) => f.split('/').pop()))];
    const t = bar.querySelector('.hot-text');
    t.textContent = `Update ready: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''} changed. Restart to apply.`;
    t.title = files.join('\n');
  });

  function flash(text) {
    const n = document.createElement('div');
    n.className = 'hot-toast';
    n.textContent = text;
    document.body.appendChild(n);
    setTimeout(() => n.classList.add('out'), 1600);
    setTimeout(() => n.remove(), 2100);
  }
})();

// Model / effort text in the input toolbar: click → the Model ▾ menu
document.getElementById('convoModel')?.addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('tbModel')?.click();
});
