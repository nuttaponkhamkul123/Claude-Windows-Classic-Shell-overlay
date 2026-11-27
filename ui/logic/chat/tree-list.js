// Chat list: child chats (Chat Tree, main/chat-tree.js) sit UNDER their parent chat, indented with ↳,
// instead of on the same level. The parent row gets a ▾ N toggle to fold its children away (remembered).
// Runs after the list is drawn (wraps renderSessionCards, loaded after every other wrapper), so the rows
// themselves are the normal ones: click, approvals, pins and costs work as before.
(function () {
  const api = window.electronAPI;
  if (!api?.treeLinks || typeof renderSessionCards !== 'function') return;

  const FOLD_KEY = 'ovly.treeFolded';
  let links = [];   // [{ sid, parentSid, short, title, depth, createdAt }]
  let folded = new Set();
  try { folded = new Set(JSON.parse(localStorage.getItem(FOLD_KEY) || '[]')); } catch (_) {}
  const saveFolded = () => { try { localStorage.setItem(FOLD_KEY, JSON.stringify([...folded])); } catch (_) {} };

  const rowOf = (id) => document.getElementById('card-' + id);

  function arrange() {
    if (!links.length) return;
    for (const l of links.filter((x) => x.root)) {
      const t = rowOf(l.sid)?.querySelector('.row-title');
      if (t && /^Untitled session$/.test(t.textContent.trim())) { t.textContent = l.title; t.title = l.title + '\nTop chat of a Chat Tree'; }
    }
    const childLinks = links.filter((x) => !x.root);
    const kidsOf = new Map();
    for (const l of childLinks) {
      if (!kidsOf.has(l.parentSid)) kidsOf.set(l.parentSid, []);
      kidsOf.get(l.parentSid).push(l);
    }
    for (const list of kidsOf.values()) list.sort((a, b) => a.createdAt - b.createdAt);
    const isChild = new Set(childLinks.map((l) => l.sid));

    // label every child row, wherever it is
    for (const l of childLinks) {
      const row = rowOf(l.sid);
      if (!row) continue;
      row.classList.add('tree-child');
      row.style.setProperty('--tree-depth', String(Math.max(1, l.depth || 1)));
      const t = row.querySelector('.row-title');
      if (t && !t.dataset.treeTitled) {
        t.dataset.treeTitled = '1';
        t.textContent = '↳ ' + l.title;
        t.title = `${l.title}\nChild chat ${l.short} — runs under its parent chat`;
      }
    }

    // each top parent (a chat that is not itself a child): its children follow it, depth-first
    for (const [parentSid] of kidsOf) {
      if (isChild.has(parentSid)) continue;
      const top = rowOf(parentSid);
      if (!top) continue;
      const order = [];
      const walk = (sid, hiddenAbove) => {
        for (const k of kidsOf.get(sid) || []) {
          const row = rowOf(k.sid);
          if (!row) continue;
          order.push({ row, hide: hiddenAbove });
          walk(k.sid, hiddenAbove || folded.has(k.sid));
        }
      };
      walk(parentSid, folded.has(parentSid));
      let anchor = top;
      for (const { row, hide } of order) {
        if (anchor.nextElementSibling !== row) anchor.after(row);
        row.classList.toggle('tree-folded-away', hide);
        anchor = row;
      }
    }

    // ▾ N / ▸ N toggles on every row that has children in the list
    for (const [parentSid, list] of kidsOf) {
      const row = rowOf(parentSid);
      if (!row) continue;
      const n = list.filter((k) => rowOf(k.sid)).length;
      let tg = row.querySelector('.tree-fold');
      if (!n) { tg?.remove(); continue; }
      if (!tg) {
        tg = el('button', 'tree-fold');
        tg.addEventListener('click', (e) => {
          e.stopPropagation();
          if (folded.has(parentSid)) folded.delete(parentSid); else folded.add(parentSid);
          saveFolded();
          arrange();
        });
        const line = row.querySelector('.row-line1');
        (line || row).prepend(tg);
      }
      const shut = folded.has(parentSid);
      tg.textContent = `${shut ? '▸' : '▾'} ${n}`;
      tg.title = shut ? `Show its ${n} child chat${n > 1 ? 's' : ''}` : `Fold its ${n} child chat${n > 1 ? 's' : ''} away`;
      row.classList.add('tree-parent');
    }
  }

  const orig = renderSessionCards;
  // eslint-disable-next-line no-global-assign
  renderSessionCards = function (...args) {
    const out = orig.apply(this, args);
    try { arrange(); } catch (e) { console.error('[tree-list]', e); }
    return out;
  };

  async function refresh() {
    try { links = (await api.treeLinks()) || []; } catch (_) { links = []; }
    arrange();
  }
  let t = null;
  api.onTreeUpdate?.(() => { clearTimeout(t); t = setTimeout(refresh, 150); });
  window.refreshTreeList = refresh; // tests
  refresh();
})();
