require('./logpatch');
const { app, BrowserWindow } = require('electron');
const path = require('path');
app.disableHardwareAcceleration(); app.setPath('userData', require('os').tmpdir() + '/ovly-ui-test-ud10');
const STYLES = process.argv[2] ? [process.argv[2]] : ['Work', 'Pip-Boy', 'Classic'];
let pass = 0, fail = 0;
const check = (n, ok, i = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${i ? ' — ' + i : ''}`); };
const session = () => { const now = Date.now(); return { id: 'claude_s2', sessionUuid: 's2', source: 'claude', project: 'ovly-claude', cwd: 'C:/w', status: 'idle', state: 'waiting', statusLabel: 'Idle', title: 'ovly-claude', sessionTitle: 'Flow', detail: 'x', fullContent: 'Done.', model: 'claude-opus-5-5', mtime: now, lastTurnTs: now }; };
process.on('unhandledRejection', (e) => { console.log('FAIL  unexpected error —', e && e.message); app.exit(1); });
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 1000, height: 700, show: false, frame: false, useContentSize: true, webPreferences: { preload: path.join(__dirname, 'preload-table.js'), contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } });
  w.webContents.on('console-message', (e) => { if (e.level === 'error' && !/available/.test(e.message)) console.log('[page]', e.message); });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (c) => w.webContents.executeJavaScript(c).catch((e) => 'ERR ' + e.message);
  w.loadFile(path.join(__dirname, '../../ui/index.html')); await new Promise((r) => w.webContents.once('did-finish-load', r)); await wait(2200);
  await js(`window.__cbs.onSessionsSync(${JSON.stringify([session()])}); document.head.insertAdjacentHTML('beforeend','<style>*{transition:none!important;animation:none!important}</style>'); 1`);
  for (const st of STYLES) {
    await js(`[...document.querySelectorAll('.style-pills .theme-pill')].find(x => /^${st}/.test(x.textContent))?.click(); 1`); await wait(500);
    await js(`showDetailView(sessionsList[0]); 1`); await wait(1200);
    const tag = `[${st}] `;
    const t = (expr) => js(`(() => { const t = document.querySelector('.chat-bubble.assistant .bubble-content table'); ${expr} })()`);
    check(tag + 'a table is drawn', (await js(`document.querySelectorAll('.chat-bubble.assistant .bubble-content table').length`)) === 2);
    check(tag + 'cells have a visible border', await t(`const c = getComputedStyle(t.querySelector('td')); return parseFloat(c.borderTopWidth) >= 1 && c.borderTopStyle === 'solid' && c.borderTopColor !== 'rgba(0, 0, 0, 0)';`));
    check(tag + 'the header row is set apart (tinted background)', await t(`return getComputedStyle(t.querySelector('th')).backgroundColor !== 'rgba(0, 0, 0, 0)';`));
    check(tag + 'cells have room (padding)', await t(`return parseFloat(getComputedStyle(t.querySelector('td')).paddingLeft) >= 8;`));
    check(tag + 'a price like $0.00 is not broken across lines', await t(`const td = [...t.querySelectorAll('td')].find((x) => x.textContent === '$0.00'); const r = document.createRange(); r.selectNodeContents(td); return r.getClientRects().length === 1;`));
    check(tag + 'the Cost column is right-aligned, Speed centred', await t(`const row = t.querySelectorAll('tbody tr')[0].children; return getComputedStyle(row[2]).textAlign === 'right' && getComputedStyle(row[1]).textAlign === 'center';`));
    check(tag + 'rows are shaded alternately', await t(`const r = t.querySelectorAll('tbody tr'); return getComputedStyle(r[1].children[0]).backgroundColor !== getComputedStyle(r[0].children[0]).backgroundColor;`));
    check(tag + 'a very wide table scrolls inside the message, not outside it', await js(`(() => { const t = document.querySelectorAll('.chat-bubble.assistant .bubble-content table')[1]; const b = t.closest('.chat-bubble').getBoundingClientRect(); return getComputedStyle(t).overflowX === 'auto' && t.scrollWidth > t.clientWidth && t.getBoundingClientRect().right <= b.right + 1; })()`));
    if (process.argv[2]) require('fs').writeFileSync(path.join(__dirname, 'shot-' + st + '.png'), (await w.webContents.capturePage()).toPNG());
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  app.exit(fail ? 1 : 0);
});
