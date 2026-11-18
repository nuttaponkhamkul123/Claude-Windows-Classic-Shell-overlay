// The harness preload plus fake pinned notes (the real ones come from main/notes.js).
require('./preload.js');
const api = window.electronAPI;
const note = (id, title, project, body, tags = []) => ({ id, title, project, cwd: 'C:/w/' + project, pinned: new Date().toISOString(), tags, body });
let notes = [
  note('20261118-090000-newest', 'Deploy steps', 'alpha', '## Steps\n\n- build\n- **push**\n\n<script>window.__pwned = 1</script><img src=x onerror="window.__pwned = 2">\n\n`npm run build`', ['deploy']),
  note('20261118-080000-older', 'DB setup', 'alpha', 'Use DATABASE_URL from .env'),
  note('20261118-070000-other', 'Release notes', 'beta', 'v1.2 shipped'),
];
const cbs = {};
window.__notesCalls = [];
window.__notesEmit = (kind, v) => cbs[kind] && cbs[kind](v);
window.__setNotes = (n) => { notes = n; };
api.notesList = () => Promise.resolve(notes);
api.notesState = () => Promise.resolve({ count: notes.length });
api.onNotesState = (f) => { cbs.state = f; };
api.onNotesChanged = (f) => { cbs.changed = f; };
api.onNotesNew = (f) => { cbs.new = f; };
api.notesCopy = (id) => { window.__notesCalls.push(['copy', id]); return Promise.resolve(true); };
api.notesOpenFile = (id) => { window.__notesCalls.push(['open', id]); return Promise.resolve(true); };
api.notesOpenFolder = () => { window.__notesCalls.push(['folder']); return Promise.resolve(true); };
api.notesUnpin = (id) => { window.__notesCalls.push(['unpin', id]); notes = notes.filter((n) => n.id !== id); return Promise.resolve(true); };
