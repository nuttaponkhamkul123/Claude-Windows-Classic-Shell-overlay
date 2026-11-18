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
