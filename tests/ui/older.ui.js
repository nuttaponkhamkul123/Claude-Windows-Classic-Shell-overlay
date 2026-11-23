// "Older chats": the key under the chat list opens past chats; each style draws it in its own look.
// node_modules/.bin/electron tests/ui/older.ui.js Pip-Boy   → also saves tests/ui/shot-older-Pip-Boy.png
require('./logpatch');
const { app, BrowserWindow } = require('electron');
const path = require('path');
app.disableHardwareAcceleration(); app.setPath('userData', require('os').tmpdir() + '/ovly-ui-test-older');
const STYLES = process.argv[2] ? [process.argv[2]] : ['Work', 'Pip-Boy', 'Classic'];
let pass = 0, fail = 0;
const check = (n, ok, i = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${i ? ' — ' + i : ''}`); };
process.on('unhandledRejection', (e) => { console.log('FAIL  unexpected error —', e && e.message); app.exit(1); });
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 520, height: 640, show: false, frame: false, useContentSize: true, webPreferences: { preload: path.join(__dirname, 'preload-older.js'), contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (c) => w.webContents.executeJavaScript(c).catch((e) => 'ERR ' + e.message);
  w.loadFile(path.join(__dirname, '../../ui/index.html')); await new Promise((r) => w.webContents.once('did-finish-load', r)); await wait(2200);
  await js(`window.__cbs.onSessionsSync([]); document.head.insertAdjacentHTML('beforeend','<style>*{transition:none!important;animation:none!important}</style>'); 1`);
  for (const st of STYLES) {
    const tag = `[${st}] `;
    await js(`[...document.querySelectorAll('.style-pills .theme-pill')].find(x => /^${st}/.test(x.textContent))?.click(); 1`); await wait(500);
    await js(`showListView?.(); 1`); await wait(300);
    check(tag + 'the Older chats key is shown', await js(`!!document.querySelector('.fx-older-btn')?.offsetParent`));
    await js(`document.querySelector('.fx-older-btn').click(); 1`); await wait(400);
    check(tag + 'it lists the past chats', (await js(`document.querySelectorAll('.fx-results .fx-hit').length`)) === 3);
    check(tag + 'the key now goes back', /Back/.test(await js(`document.querySelector('.fx-older-btn').textContent`)));
    if (st === 'Pip-Boy') {
      const amber = 'rgb(255, 159, 28)';
      check(tag + 'rows are see-through on the screen, not white cards', (await js(`getComputedStyle(document.querySelector('.fx-hit')).backgroundColor`)) === 'rgba(0, 0, 0, 0)');
      check(tag + 'titles are amber', (await js(`getComputedStyle(document.querySelector('.fx-hit-title')).color`)) === amber);
      check(tag + 'the key is amber with no emoji', (await js(`getComputedStyle(document.querySelector('.fx-older-btn')).color`)) === amber &&
        (await js(`getComputedStyle(document.querySelector('.fx-older-ico')).display`)) === 'none');
    }
    if (process.argv[2]) require('fs').writeFileSync(path.join(__dirname, 'shot-older-' + st + '.png'), (await w.webContents.capturePage()).toPNG());
    if (process.argv[2]) { await js(`document.querySelector('.fx-older-btn').click(); 1`); await wait(300); require('fs').writeFileSync(path.join(__dirname, 'shot-older-' + st + '-closed.png'), (await w.webContents.capturePage()).toPNG()); await js(`document.querySelector('.fx-older-btn').click(); 1`); await wait(300); }
    await js(`document.querySelector('.fx-older-btn').click(); 1`); await wait(200);
    check(tag + 'going back shows the current chats again', (await js(`document.querySelector('.fx-results').style.display`)) === 'none');
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  app.exit(fail ? 1 : 0);
});
