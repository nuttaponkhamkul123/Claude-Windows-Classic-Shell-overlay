// Compact contact list: one short line per session (☰ button at the end of the
// All / Running / Idle / Needs Input tabs). The choice is remembered.
(function () {
  const api = window.electronAPI;
  const tabs = document.querySelector('#listView .tabs-bar') || document.querySelector('.tabs-bar');
  if (!tabs) return;

  const btn = document.createElement('button');
  btn.className = 'fx-compact-btn';
  btn.textContent = '☰';
  tabs.appendChild(btn); // not a ".tab-btn": those are filters

  function apply(on) {
    document.body.classList.toggle('list-compact', on);
    btn.classList.toggle('active', on);
    btn.title = on ? 'Compact list — click for the detailed list' : 'Detailed list — click for a compact one-line list';
  }

  let compact = false;
  apply(false);
  (api.storeGetAll ? api.storeGetAll() : Promise.resolve({}))
    .then((st) => { compact = !!(st && st.compactList); apply(compact); })
    .catch(() => {});

  btn.addEventListener('click', () => {
    compact = !compact;
    apply(compact);
    api.storeSet?.('compactList', compact);
  });
})();
