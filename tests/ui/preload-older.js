// The harness preload with three past chats for the "Older chats" list.
require('./preload.js');
const day = 86400000;
window.electronAPI.listPastChats = async () => [
  { id: 'claude_p1', uuid: 'p1', source: 'claude', cwd: 'C:/w/ovly-claude', project: 'ovly-claude', title: 'Add a mini bar', snippet: 'can we add a thin always-on-top bar?', ts: Date.now() - 3 * day },
  { id: 'claude_p2', uuid: 'p2', source: 'claude', cwd: 'C:/w/api', project: 'api', title: 'Fix login timeout', snippet: 'login times out after 30s', ts: Date.now() - 9 * day },
  { id: 'claude_p3', uuid: 'p3', source: 'claude', cwd: 'C:/w/docs', project: 'docs', title: 'Write the README', snippet: 'Write the README', ts: Date.now() - 20 * day },
];
