// The harness preload with a chat of three questions and answers (the first answer has a link).
require('./preload.js');
const api = window.electronAPI;
const T = Date.now();
api.getSessionHistory = async () => [
  { role: 'user', text: 'How do I reset my password?', ts: T - 600000 },
  { role: 'assistant', text: 'Open **Settings**, then see [the guide](https://example.com/guide).\n\nSecond paragraph.', ts: T - 590000 },
  { role: 'user', text: 'What about two-factor codes?', ts: T - 300000 },
  { role: 'assistant', text: 'Use a recovery code from your account page.', ts: T - 290000 },
  { role: 'user', text: 'Thanks. Can you summarise?', ts: T - 60000 },
  { role: 'assistant', text: 'Reset in Settings; use a recovery code if you lose the 2FA device.', ts: T - 50000 },
];
window.__stored = {};
api.storeSet = (k, v) => { window.__stored[k] = v; };
