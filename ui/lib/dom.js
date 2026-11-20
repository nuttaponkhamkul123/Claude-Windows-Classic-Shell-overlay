// Interval bookkeeping for the Performance panel: which setInterval timers are running, how often, and where they
// were started. Costs a stack read when a timer is created, nothing while it runs.
(function () {
  const timers = (window.__timers = new Map());
  const rawSet = window.setInterval.bind(window);
  const rawClear = window.clearInterval.bind(window);
  const where = () => {
    const lines = String(new Error().stack || '').split('\n').slice(2);
    for (const l of lines) {
      if (/[\\/]dom\.js/.test(l)) continue; // skip uiInterval itself
      const m = /([\w.-]+\.js):(\d+)/.exec(l);
      if (m) return m[1] + ':' + m[2];
    }
    return '?';
  };
  window.setInterval = function (fn, ms, ...rest) {
    const id = rawSet(fn, ms, ...rest);
    timers.set(id, { ms: Number(ms) || 0, src: where(), hidden: false });
    return id;
  };
  window.clearInterval = function (id) { timers.delete(id); return rawClear(id); };
})();

// Shared DOM helpers. Loaded before every other ui script.
// Feature modules used to keep private copies of these; this is the single source.
window.el = function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

window.$ = function $(id) {
  return document.getElementById(id);
};

// A setInterval for screen-only work (redrawing labels, animations). It skips its turn while the window is
// hidden or minimised, so the app uses almost no CPU in the background. Timers that DO real work
// (sending queued messages, cost refresh, watching sessions) keep using plain setInterval.
window.uiInterval = function uiInterval(fn, ms) {
  return setInterval(() => { if (!document.hidden) fn(); }, ms);
};
