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
