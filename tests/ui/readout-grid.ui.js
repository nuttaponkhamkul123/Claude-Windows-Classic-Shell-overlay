// The readout panel on the right of the chat screen (Pip-Boy / Shelter): every entry is a cell of a grid with the same
// tinted background as the "Idle" bar; the long ones take the whole row.
require('./logpatch');
const { app, BrowserWindow } = require('electron');
const path = require('path');
app.disableHardwareAcceleration(); app.setPath('userData', require('os').tmpdir() + '/ovly-ui-test-ud20');
let pass = 0, fail = 0;
const check = (n, ok, i = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${i ? ' — ' + i : ''}`); };
const session = () => { const now = Date.now(); return { id: 'claude_s2', sessionUuid: 's2', source: 'claude', project: 'ovly-claude', cwd: 'C:/w', status: 'idle', state: 'waiting', statusLabel: 'Idle', title: 'ovly-claude', sessionTitle: 'Flow', detail: 'x', fullContent: 'Done.', model: 'claude-opus-5-5', mtime: now, lastTurnTs: now, context: { used: 80000, window: 200000 } }; };
process.on('unhandledRejection', (e) => { console.log('FAIL  unexpected error —', e && e.message); app.exit(1); });
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 1000, height: 700, show: false, frame: false, useContentSize: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } });
  w.webContents.on('console-message', (e) => { if (e.level === 'error' && !/available/.test(e.message)) console.log('[page]', e.message); });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (c) => w.webContents.executeJavaScript(c).catch((e) => 'ERR ' + e.message);
  w.loadFile(path.join(__dirname, '../../ui/index.html')); await new Promise((r) => w.webContents.once('did-finish-load', r)); await wait(2200);
  await js(`window.__cbs.onSessionsSync(${JSON.stringify([session()])}); 1`);
  await js(`[...document.querySelectorAll('.style-pills .theme-pill')].find(x => /^Pip-Boy/.test(x.textContent))?.click(); 1`); await wait(500);
  await js(`showDetailView(sessionsList[0]); 1`); await wait(1800);

  const cells = await js(`[...document.querySelectorAll('.pip-stats .pip-row')].map((r) => { const b = r.getBoundingClientRect(); const cs = getComputedStyle(r); const v = r.querySelector('.pip-v').getBoundingClientRect(); return { k: r.dataset.k, x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), bg: cs.backgroundColor + ' ' + cs.backgroundImage, vx: Math.round(v.left), pad: parseFloat(cs.paddingLeft) }; })`);
  const stats = await js(`(() => { const r = document.querySelector('.pip-stats').getBoundingClientRect(); return { x: Math.round(r.left), w: Math.round(r.width), d: getComputedStyle(document.querySelector('.pip-stats')).display }; })()`);
  const idle = await js(`getComputedStyle(document.querySelector('.pip-seg')).backgroundColor`);
  check('the panel is a grid', stats.d === 'grid', stats.d);
  check('every entry has its own cell, named for the CSS', cells.length >= 6 && cells.every((c) => !!c.k), cells.map((c) => c.k).join(','));
  check('every cell has a tinted background (the same amber tint family as the Idle bar)', cells.every((c) => /rgba\(255, 159, 28, 0\.\d+\)|linear-gradient/.test(c.bg)) && /rgba\(255, 159, 28/.test(idle), idle);
  const status = cells.find((c) => c.k === 'status'), model = cells.find((c) => c.k === 'model');
  check('two cells side by side (Status | Model)', Math.abs(status.y - model.y) < 3 && model.x > status.x + 20, JSON.stringify([status.x, model.x]));
  const cost = cells.find((c) => c.k === 'cost'), today = cells.find((c) => c.k === 'today');
  check('Cost | Today share a row too', Math.abs(cost.y - today.y) < 3 && today.x > cost.x + 20);
  const ctx = cells.find((c) => c.k === 'context');
  check('Context takes the whole row, like a gauge', ctx.w > status.w * 1.8 && /linear-gradient/.test(ctx.bg), `${ctx.w} vs ${status.w}`);
  check('Branch, Changes and Hand off take the whole row as well', ['branch', 'changes', 'hand-off'].every((k) => { const c = cells.find((x) => x.k === k); return c && c.w > status.w * 1.8; }));
  check('cells do not touch (a small gap) and none sticks out of the panel', cells.every((c) => c.x >= stats.x - 1 && c.x + c.w <= stats.x + stats.w + 1) && model.x - (status.x + status.w) >= 3);
  check('values are left-aligned in their cell (name over value)', cells.every((c) => Math.abs(c.vx - (c.x + c.pad)) < 3));
  check('the name is small and dim, the value bigger', await js(`(() => { const r = document.querySelector('.pip-stats .pip-row'); const k = parseFloat(getComputedStyle(r.querySelector('.pip-k')).fontSize), v = parseFloat(getComputedStyle(r.querySelector('.pip-v')).fontSize); return k < v; })()`));
  check('the picture stays on top across the whole width', await js(`(() => { const p = document.querySelector('.pip-stats .pip-picture').getBoundingClientRect(), s = document.querySelector('.pip-stats').getBoundingClientRect(); return p.top <= s.top + 2 && p.width > s.width * 0.9; })()`));
  check('a clickable cell (Changes) reacts: it is a link', await js(`document.querySelector('.pip-row[data-k="changes"]').classList.contains('link')`));

  // the top line: only the chat's name (the rest moved into the panel)
  const headText = await js(`document.querySelector('.pip-head').textContent`);
  check('the top line has only the chat name, no branch / model / context / cost boxes', (await js(`document.querySelectorAll('.pip-head .pip-hbox').length`)) === 1 && (await js(`document.querySelectorAll('.pip-head .pip-hseg').length`)) === 0 && /Flow/.test(headText) && !/opus|master|\$/i.test(headText), headText);
  check('the panel has what the top line used to show: Model, Context, Cost, Branch, Changes', ['model', 'context', 'cost', 'branch', 'changes'].every((k) => cells.some((c) => c.k === k)));
  check('Branch is clickable now, as the git box on the top line was', await js(`document.querySelector('.pip-row[data-k="branch"]').classList.contains('link')`));
  await js(`window.__gitClicks = 0; document.querySelector('.git-box').addEventListener('click', () => { window.__gitClicks++; }); document.querySelector('.pip-row[data-k="branch"]').click(); 1`);
  check('clicking Branch does what clicking the git box does (opens the git panel)', (await js('window.__gitClicks')) === 1);
  check('the chat name is still there to click and rename', await js(`!!document.querySelector('.pip-head-title')`));

  console.log(`\n${pass} passed, ${fail} failed`);
  app.exit(fail ? 1 : 0);
});
