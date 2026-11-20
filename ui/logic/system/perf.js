// Performance panel: what the app costs right now. A slide-over (like Steps and Notes). While it is open it asks for
// a sample every 2 seconds: every Electron process (memory, CPU), this window's JS heap / page size / long tasks /
// running timers, and the main process (Node heap, event-loop delay, how long the session watcher's check takes).
// Nothing is sampled while it is closed. Open it from Settings → Performance (or Ctrl+Alt+P); "Copy report" puts
// the numbers on the clipboard as text.
//   window.openPerf()   window.closePerf()
(function () {
  const api = window.electronAPI;
  if (!api?.perfSample) return;

  const mk = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const f0 = (n) => Math.round(n).toLocaleString('en-US');
  const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
  const f2 = (n) => (Math.round(n * 100) / 100).toFixed(2);

  // long tasks (the page was blocked for 50 ms or more): kept for the last 5 minutes
  const longTasks = [];
  try {
    new PerformanceObserver((list) => {
      const now = Date.now();
      for (const e of list.getEntries()) longTasks.push({ at: now, ms: e.duration });
      while (longTasks.length && now - longTasks[0].at > 300000) longTasks.shift();
    }).observe({ entryTypes: ['longtask'] });
  } catch (_) { /* not available: the row says so */ }

  // ---- skeleton ----
  const backdrop = mk('div', 'pf-backdrop');
  const panel = mk('aside', 'pf-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Performance');
  panel.tabIndex = -1;
  const head = mk('header', 'pf-head');
  const titleBox = mk('div', 'pf-titlebox');
  const title = mk('div', 'pf-title', 'Performance');
  const sub = mk('div', 'pf-sub', 'Measuring…');
  titleBox.append(title, sub);
  const btnCopy = mk('button', 'pf-btn', 'Copy report');
  btnCopy.title = 'Copy these numbers as text';
  const btnReset = mk('button', 'pf-btn', 'Reset peaks');
  btnReset.title = 'Forget the highest values and the graph';
  const btnClose = mk('button', 'pf-btn pf-icon', '✕');
  btnClose.title = 'Close (Esc)';
  head.append(titleBox, btnCopy, btnReset, btnClose);
  const body = mk('div', 'pf-body');
  panel.append(head, body);
  document.body.append(backdrop, panel);

  // ---- state ----
  const hist = []; // { mem, cpu }
  let last = null;
  let peakMem = 0;
  let seq = 0;
  const isOpen = () => document.body.classList.contains('pf-open');

  function spark(values, color) {
    const W = 220, H = 36;
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'pf-spark');
    if (values.length > 1) {
      const max = Math.max(...values, 1), min = Math.min(...values, 0);
      const pts = values.map((v, i) => `${(i / (values.length - 1)) * W},${H - 2 - ((v - min) / (max - min || 1)) * (H - 4)}`).join(' ');
      const line = document.createElementNS(svgNS, 'polyline');
      line.setAttribute('points', pts);
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', '1.6');
      svg.appendChild(line);
    }
    return svg;
  }

  // this page's own numbers
  function pageStats() {
    const mem = performance.memory || null;
    const timers = [...(window.__timers ? window.__timers.values() : [])];
    const bySrc = new Map();
    for (const t of timers) {
      const k = t.src + ' @ ' + t.ms;
      bySrc.set(k, (bySrc.get(k) || 0) + 1);
    }
    const now = Date.now();
    const lt = longTasks.filter((x) => now - x.at <= 60000);
    return {
      heapUsedMB: mem ? mem.usedJSHeapSize / 1048576 : null,
      heapTotalMB: mem ? mem.totalJSHeapSize / 1048576 : null,
      heapLimitMB: mem ? mem.jsHeapSizeLimit / 1048576 : null,
      domNodes: document.getElementsByTagName('*').length,
      bubbles: document.querySelectorAll('#chatStream .chat-bubble').length,
      sessions: typeof sessionsList !== 'undefined' ? sessionsList.length : 0,
      timers: timers.length,
      timerList: [...bySrc.entries()].map(([k, n]) => { const [src, ms] = k.split(' @ '); return { src, ms: Number(ms), n }; })
        .sort((a, b) => (a.ms || 1e9) - (b.ms || 1e9)),
      longCount: lt.length,
      longMax: lt.reduce((m, x) => Math.max(m, x.ms), 0),
      longSupported: typeof PerformanceObserver !== 'undefined' && (PerformanceObserver.supportedEntryTypes || []).includes('longtask'),
    };
  }

  function row(label, value, hint, warn) {
    const r = mk('div', 'pf-row' + (warn ? ' warn' : ''));
    r.append(mk('span', 'pf-k', label), mk('span', 'pf-v', value));
    if (hint) r.title = hint;
    return r;
  }
  function section(name) { return mk('div', 'pf-sec', name); }

  function draw() {
    const s = last;
    body.textContent = '';
    if (!s) { body.appendChild(mk('div', 'pf-empty', 'Measuring…')); return; }
    const totalMem = s.processes.reduce((n, p) => n + p.workingMB, 0);
    const totalCpu = s.processes.reduce((n, p) => n + p.cpu, 0);
    const pg = s.page;
    sub.textContent = `${f0(totalMem)} MB in ${s.processes.length} processes · CPU ${f1(totalCpu)}% · peak ${f0(peakMem)} MB`;

    // graph
    const g = mk('div', 'pf-graphs');
    const gm = mk('div', 'pf-graph'); gm.append(mk('div', 'pf-glabel', `Memory (all processes), last ${hist.length * 2}s`), spark(hist.map((h) => h.mem), 'currentColor'));
    const gc = mk('div', 'pf-graph'); gc.append(mk('div', 'pf-glabel', 'CPU (all processes)'), spark(hist.map((h) => h.cpu), 'currentColor'));
    g.append(gm, gc);
    body.appendChild(g);

    // processes
    body.appendChild(section('Processes'));
    const t = mk('div', 'pf-table');
    const hd = mk('div', 'pf-tr pf-th');
    hd.append(mk('span', 'pf-c-name', 'Process'), mk('span', 'pf-c-type', 'Type'), mk('span', 'pf-c-num', 'Memory'), mk('span', 'pf-c-num', 'CPU'));
    t.appendChild(hd);
    for (const p of [...s.processes].sort((a, b) => b.workingMB - a.workingMB)) {
      const r = mk('div', 'pf-tr');
      r.title = `pid ${p.pid} · private ${f0(p.privateMB)} MB`;
      r.append(mk('span', 'pf-c-name', p.name), mk('span', 'pf-c-type', p.type), mk('span', 'pf-c-num', `${f0(p.workingMB)} MB`), mk('span', 'pf-c-num', `${f1(p.cpu)}%`));
      t.appendChild(r);
    }
    body.appendChild(t);

    // this window
    body.appendChild(section('This window (the HUD page)'));
    body.appendChild(row('JS heap', pg.heapUsedMB == null ? 'n/a' : `${f1(pg.heapUsedMB)} MB of ${f1(pg.heapTotalMB)} MB`, 'Memory used by the page\'s JavaScript objects', pg.heapUsedMB > 300));
    body.appendChild(row('Page size', `${f0(pg.domNodes)} elements`, 'Every element on the page. Big pages are slower and use more memory.', pg.domNodes > 20000));
    body.appendChild(row('Chat', `${f0(pg.bubbles)} messages drawn · ${f0(pg.sessions)} chats listed`));
    body.appendChild(row('Long tasks (60 s)', pg.longSupported ? `${pg.longCount} · slowest ${f0(pg.longMax)} ms` : 'not available', 'Times the page was blocked for 50 ms or more (it feels laggy then)', pg.longMax > 200));
    body.appendChild(row('Timers running', String(pg.timers), 'setInterval timers created by the page. Each wakes up again and again.', pg.timers > 40));
    const tl = mk('div', 'pf-timers');
    for (const x of pg.timerList.slice(0, 12)) tl.appendChild(mk('div', 'pf-timer', `${x.n > 1 ? x.n + ' × ' : ''}every ${x.ms >= 1000 ? f1(x.ms / 1000) + ' s' : x.ms + ' ms'} — ${x.src}`));
    if (pg.timerList.length > 12) tl.appendChild(mk('div', 'pf-timer', `… and ${pg.timerList.length - 12} more`));
    body.appendChild(tl);

    // main process
    body.appendChild(section('Main process'));
    body.appendChild(row('Node heap', `${f1(s.main.heapUsedMB)} MB of ${f1(s.main.heapTotalMB)} MB · total ${f0(s.main.rssMB)} MB`, undefined, s.main.heapUsedMB > 300));
    body.appendChild(row('Event loop delay', `avg ${f2(s.loop.meanMs)} ms · 99% ${f2(s.loop.p99Ms)} ms · worst ${f1(s.loop.maxMs)} ms`, 'How late the main process runs its work. High numbers mean it is busy and the app stutters.', s.loop.p99Ms > 50));
    body.appendChild(row('Session watcher', `${f1(s.watcher.perSec)} checks/s · avg ${f2(s.watcher.avgMs)} ms · worst ${f1(s.watcher.maxMs)} ms · ${s.watcher.sessions} chats`, 'It looks at every transcript file about every 0.8 s', s.watcher.avgMs > 20));
    body.appendChild(row('Running for', `${f0(s.uptimeSec / 60)} min`));
  }

  function report() {
    const s = last;
    if (!s) return 'No sample yet.';
    const pg = s.page;
    const lines = [`HUD performance report, ${new Date().toLocaleString()}`, ''];
    lines.push(`Total memory ${f0(s.processes.reduce((n, p) => n + p.workingMB, 0))} MB (peak ${f0(peakMem)} MB) in ${s.processes.length} processes, CPU ${f1(s.processes.reduce((n, p) => n + p.cpu, 0))}%`, '');
    for (const p of [...s.processes].sort((a, b) => b.workingMB - a.workingMB)) lines.push(`  ${p.name.padEnd(18)} ${p.type.padEnd(10)} ${f0(p.workingMB).padStart(5)} MB  CPU ${f1(p.cpu)}%`);
    lines.push('', `HUD page: heap ${pg.heapUsedMB == null ? 'n/a' : f1(pg.heapUsedMB) + ' MB'}, ${f0(pg.domNodes)} elements, ${pg.bubbles} messages, ${pg.timers} timers, long tasks (60 s) ${pg.longCount} (slowest ${f0(pg.longMax)} ms)`);
    for (const x of pg.timerList.slice(0, 12)) lines.push(`  ${x.n} × every ${x.ms} ms — ${x.src}`);
    lines.push('', `Main: Node heap ${f1(s.main.heapUsedMB)} MB, loop delay avg ${f2(s.loop.meanMs)} / p99 ${f2(s.loop.p99Ms)} / max ${f1(s.loop.maxMs)} ms, watcher ${f1(s.watcher.perSec)}/s avg ${f2(s.watcher.avgMs)} ms max ${f1(s.watcher.maxMs)} ms (${s.watcher.sessions} chats)`);
    return lines.join('\n');
  }

  async function tick() {
    if (!isOpen()) return;
    const my = ++seq;
    let s = null;
    try { s = await api.perfSample(); } catch (_) {}
    if (my !== seq || !isOpen() || !s) return;
    s.page = pageStats();
    last = s;
    const mem = s.processes.reduce((n, p) => n + p.workingMB, 0);
    const cpu = s.processes.reduce((n, p) => n + p.cpu, 0);
    peakMem = Math.max(peakMem, mem);
    hist.push({ mem, cpu });
    if (hist.length > 60) hist.shift();
    draw();
  }

  function setOpen(on) {
    document.body.classList.toggle('pf-open', on);
    if (on) { last = null; draw(); tick(); } else { seq++; }
  }
  window.openPerf = () => setOpen(true);
  window.closePerf = () => setOpen(false);

  backdrop.addEventListener('click', () => setOpen(false));
  btnClose.addEventListener('click', () => setOpen(false));
  btnReset.addEventListener('click', () => { hist.length = 0; peakMem = last ? last.processes.reduce((n, p) => n + p.workingMB, 0) : 0; longTasks.length = 0; draw(); });
  btnCopy.addEventListener('click', () => { api.copyToClipboard?.(report()); btnCopy.textContent = 'Copied'; setTimeout(() => { btnCopy.textContent = 'Copy report'; }, 1200); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) setOpen(false);
    else if (e.altKey && e.ctrlKey && (e.key === 'p' || e.key === 'P')) { e.preventDefault(); setOpen(!isOpen()); }
  }, true);
  window.__perfReport = report; // (used by the test)
  uiInterval(tick, 2000);
})();
