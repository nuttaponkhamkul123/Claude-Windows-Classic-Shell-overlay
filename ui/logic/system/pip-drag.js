// Shelter style: more places to grab the window. Shelter has no title bar, and with the new screen layout the
// toolbars are mostly buttons, so there was hardly any bare space to drag. This adds:
//   • a thin strip along the very top edge of the window,
//   • the chat's top line (outside the title and git text, which are clickable), the name/folder line,
//     the All / You / Claude row, the list's filter row and its footer hint.
// They use the same drag as the title bar did (app.js makeHudDraggable → main.js), so docking to a screen
// edge and magnetic snapping still work. Buttons and links inside these areas never start a drag.
(function () {
  const make = window.makeHudDraggable;
  if (!make) return;
  const card = document.querySelector('.overlay-card');
  if (card) {
    const strip = document.createElement('div');
    strip.className = 'pip-dragstrip';
    strip.title = 'Drag to move the window';
    card.appendChild(strip);
    make(strip, '');
  }
  const SKIP = 'button, input, textarea, a, select, .pip-head-title, .pip-hgit, .convo-workspace, #convoName, [class*="panel"], [class*="menu"]';
  for (const sel of ['.pip-head', '.convo-contact', '.pip-subtabs', '.tabs-bar', '.popup-footer']) make(document.querySelector(sel), SKIP);
})();
