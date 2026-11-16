// Cost chip in the chat header, next to the context meter:
//   "$0.84 this chat · 1.2M tokens today"
// • this chat = Claude Code's own running total for the session (same number as the
//   cards in the list); an estimate if you are on a flat-fee plan.
// • today = tokens from the Usage panel's data (usage.js), refreshed once a minute.
// • Long chats get expensive: every message re-sends the whole context. Past
//   LONG_CHAT tokens the chip turns amber, and once, when a chat crosses the
//   line, a note suggests starting fresh.
(function () {
  const api = window.electronAPI;
  const box = document.getElementById('convoContext');
  if (!box || !api?.getSessionCosts) return;
  const LONG_CHAT = 150000;

  const chip = document.createElement('span');
  chip.className = 'cost-chip';
  chip.hidden = true;
  // its own line under the context meter (the meter row is narrow next to the git box);
  // handoff.js adds its button to the same row
  const row = document.createElement('div');
  row.className = 'cost-row';
  row.appendChild(chip);
  box.after(row);

  let cost = null;        // this chat, USD
  let costFor = '';       // session id `cost` belongs to
  let todayTokens = null;
  let todayAt = 0;
  let lastKey = '', lastFetch = 0;
  const lastUsed = new Map(); // session id -> context tokens last time we looked
  const fmtUsd = (c) => `$${c < 10 ? c.toFixed(2) : c.toFixed(0)}`;

  function draw() {
    const s = currentActiveSession;
    if (!s || s.source !== 'claude' || s.draft) { chip.hidden = true; return; }
    const used = s.context?.used || 0;
    const long = used >= LONG_CHAT;
    const parts = [];
    if (cost != null && costFor === s.id) parts.push(`${fmtUsd(cost)} this chat`);
    if (todayTokens != null) parts.push(`${fmtTokens(todayTokens)} tokens today`);
    if (!parts.length) { chip.hidden = true; return; }
    chip.hidden = false;
    chip.classList.toggle('warn', long);
    chip.textContent = (long ? '⚠ ' : '') + parts.join(' · ');
    chip.title = (long
      ? `Long chat (${fmtTokens(used)} tokens of context): every message re-sends all of it. ` +
        'Starting a new chat, or /compact, keeps it cheaper.\n\n'
      : '') +
      'This chat: Claude Code’s running cost estimate (a flat-fee plan does not pay per token).\n' +
      'Today: all Claude Code chats on this PC (see Usage for the breakdown).';
  }

  function checkLong(s) {
    const used = s.context?.used || 0;
    const before = lastUsed.get(s.id);
    lastUsed.set(s.id, used);
    if (before != null && before < LONG_CHAT && used >= LONG_CHAT) {
      addSystemNote(`This chat is now ${fmtTokens(used)} tokens long. Each new message re-sends all of it — ` +
        'a new chat (or /compact) would be cheaper. "Hand off ↗" (or /handoff) carries the key points over to a fresh chat.');
    }
  }

  async function refresh() {
    const s = currentActiveSession;
    if (!s || s.source !== 'claude' || s.draft) { draw(); return; }
    lastFetch = Date.now();
    try {
      const r = await api.getSessionCosts([s.id]);
      if (r && typeof r[s.id] === 'number') { cost = r[s.id]; costFor = s.id; }
      else if (costFor !== s.id) cost = null;
    } catch (_) { /* keep the old number */ }
    // Local-logs-only call (no network, no login token), and at most every 5 minutes: it re-reads the
    // day's transcripts, which takes about half a second.
    if (Date.now() - todayAt > 5 * 60000 && api.getUsageToday) {
      todayAt = Date.now();
      api.getUsageToday().then((u) => {
        if (typeof u?.tokens === 'number') { todayTokens = u.tokens; draw(); }
      }).catch(() => {});
    }
    draw();
  }

  // Watch the open chat: refetch when it switches or its transcript changes
  setInterval(() => {
    const s = currentActiveSession;
    if (!s) return;
    checkLong(s);
    const key = `${s.id}|${s.mtime}`;
    if (key !== lastKey && Date.now() - lastFetch > 2500) { lastKey = key; refresh(); }
    else draw();
  }, 1000);
})();
