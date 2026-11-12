// Clipboard access. The renderer page is not allowed to read it directly.

const { clipboard } = require('electron');

function register(r) {
  // Right-click "Paste" in the HUD
  r.handle('read-clipboard', () => {
    const text = clipboard.readText();
    if (text) return { text };
    const img = clipboard.readImage();
    return img.isEmpty() ? {} : { image: img.toDataURL() };
  });

  r.on('copy-clipboard', (_ctx, _event, text) => {
    if (text) clipboard.writeText(text);
  });
}

module.exports = { register };
