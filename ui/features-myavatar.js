// "My Status" picture on the contact list: click it to use your own image, or a
// robot in any colour (with the default outfit from the dress-up panel).
// The choice is remembered and also used as "your" picture in conversations.
(function () {
  const api = window.electronAPI;
  const ava = document.querySelector('#listView .msn-ava');
  if (!ava) return;
  const dpUserImg = document.querySelector('#dpUser .dp-img');
  const defaultAvaHtml = ava.innerHTML;
  const defaultDpHtml = dpUserImg ? dpUserImg.innerHTML : '';


  let choice = null; // { type: 'image', data } | { type: 'robot', hue } | null

  async function robotUrl(hue) {
    if (typeof getRobotColorUrl !== 'function') return null;
    const outfit = typeof window.robotOutfitFor === 'function' ? window.robotOutfitFor({ id: 'me' }) : null;
    return getRobotColorUrl(hue, outfit);
  }

  function paint(target, html, src) {
    target.classList.remove('has-photo');
    if (!src) { target.innerHTML = html; return; }
    target.textContent = '';
    const img = el('img', 'my-avatar-img');
    img.alt = '';
    img.draggable = false;
    img.src = src;
    target.appendChild(img);
    target.classList.add('has-photo');
  }

  async function apply() {
    let src = null;
    if (choice && choice.type === 'image') src = choice.data;
    else if (choice && choice.type === 'robot') src = await robotUrl(choice.hue);
    paint(ava, defaultAvaHtml, src);
    if (dpUserImg) paint(dpUserImg, defaultDpHtml, src);
  }

  function save(next) {
    choice = next;
    try { if (api.storeSet) api.storeSet('myAvatar', next); } catch (_) {}
    apply();
  }

  // read a picked file, crop to a centred square, shrink to 128px
  function fileToAvatar(file) {
    return new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => {
        const im = new Image();
        im.onload = () => {
          const s = Math.min(im.naturalWidth, im.naturalHeight);
          const c = document.createElement('canvas');
          c.width = c.height = 128;
          c.getContext('2d').drawImage(im, (im.naturalWidth - s) / 2, (im.naturalHeight - s) / 2, s, s, 0, 0, 128, 128);
          resolve(c.toDataURL('image/jpeg', 0.9));
        };
        im.onerror = () => resolve(null);
        im.src = fr.result;
      };
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(file);
    });
  }

  // ---------- menu ----------
  const menu = el('div', 'my-ava-menu');
  menu.style.display = 'none';
  document.body.appendChild(menu);
  menu.addEventListener('click', (e) => e.stopPropagation());
  const close = () => { menu.style.display = 'none'; };
  document.addEventListener('click', (e) => {
    if (menu.style.display !== 'none' && !menu.contains(e.target) && !ava.contains(e.target)) close();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  const file = el('input');
  file.type = 'file';
  file.accept = 'image/*';
  file.style.display = 'none';
  document.body.appendChild(file);
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    file.value = '';
    if (!f) return;
    const data = await fileToAvatar(f);
    if (data) save({ type: 'image', data });
  });

  function build() {
    menu.textContent = '';
    menu.appendChild(el('div', 'mam-head', 'My picture'));
    const pick = el('button', 'mam-row', '🖼  Choose a picture…');
    pick.addEventListener('click', () => { close(); file.click(); });
    menu.appendChild(pick);

    menu.appendChild(el('div', 'mam-sub', '🤖  Use a robot'));
    const sw = el('div', 'mam-swatches');
    for (let h = 0; h < 360; h += 30) {
      const on = choice && choice.type === 'robot' && choice.hue === h;
      const b = el('button', 'mam-sw' + (on ? ' on' : ''));
      b.style.background = `hsl(${(210 + h) % 360} 70% 52%)`;
      b.title = 'Robot colour';
      b.addEventListener('click', () => { save({ type: 'robot', hue: h }); build(); });
      sw.appendChild(b);
    }
    menu.appendChild(sw);

    const reset = el('button', 'mam-row', '↺  Default');
    reset.addEventListener('click', () => { save(null); close(); });
    menu.appendChild(reset);
  }

  ava.classList.add('my-ava-trigger');
  ava.title = 'Click to change your picture';
  ava.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.style.display !== 'none') { close(); return; }
    build();
    const r = ava.getBoundingClientRect();
    menu.style.left = Math.max(4, r.left) + 'px';
    menu.style.top = (r.bottom + 4) + 'px';
    menu.style.display = 'block';
  });

  // load the saved choice
  (api.storeGetAll ? api.storeGetAll() : Promise.resolve({}))
    .then((st) => { choice = (st && st.myAvatar) || null; if (choice) apply(); })
    .catch(() => {});
})();

// Personal status message under the name ("‹Type a personal message›"), remembered
(function () {
  const api = window.electronAPI;
  const input = document.getElementById('msnMsg');
  if (!input) return;
  (api.storeGetAll ? api.storeGetAll() : Promise.resolve({}))
    .then((st) => { if (st && typeof st.myStatusMsg === 'string') input.value = st.myStatusMsg; })
    .catch(() => {});
  const save = () => { try { if (api.storeSet) api.storeSet('myStatusMsg', input.value.trim()); } catch (_) {} };
  input.addEventListener('change', save);
  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') input.blur();
  });
})();
