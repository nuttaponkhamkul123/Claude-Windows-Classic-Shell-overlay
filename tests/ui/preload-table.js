// The harness preload with a chat that has two Markdown tables (a small one, and a very wide one).
require('./preload.js');
const small = 'Here is a comparison of the three options:\n\n| Option | Speed | Cost | Notes |\n|--------|:-----:|-----:|-------|\n| A: queue | Fast | $0.00 | Keeps order, survives restart |\n| B: mini bar | Instant | $0.00 | Always on top |\n| C: steps | Medium | $0.12 | Searches every chat |\n\nPick **A** if you want the simplest one.';
const cols = Array.from({ length: 14 }, (_, i) => 'Column number ' + (i + 1));
const wide = '\n\n| ' + cols.join(' | ') + ' |\n|' + cols.map(() => '---').join('|') + '|\n| ' + cols.map((_, i) => 'value-' + (i + 1) + '-long-text').join(' | ') + ' |';
window.electronAPI.getSessionHistory = async () => [
  { role: 'user', text: 'compare the options in a table', ts: Date.now() - 120000 },
  { role: 'assistant', text: small + wide, ts: Date.now() - 60000 },
];
