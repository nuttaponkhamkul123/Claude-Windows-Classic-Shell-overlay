// The robot picture on the chat screen's readout panel: it faces you (front view) and wears its outfit.
require('./logpatch');
const { app, BrowserWindow } = require('electron');
const path = require('path');
app.disableHardwareAcceleration(); app.setPath('userData', require('os').tmpdir() + '/ovly-ui-test-ud17');
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
  await js(`window.__cbs.onSessionsSync(${JSON.stringify([session()])}); document.head.insertAdjacentHTML('beforeend','<style>*{transition:none!important;animation:none!important}</style>'); 1`);
  await js(`[...document.querySelectorAll('.style-pills .theme-pill')].find(x => /^Pip-Boy/.test(x.textContent))?.click(); 1`); await wait(500);
  await js(`showDetailView(sessionsList[0]); 1`); await wait(1500);
  const svg = () => js(`document.querySelector('.pip-picture svg')?.outerHTML || ''`);

  let s = await svg();
  check('the picture is the front view (the robot faces you)', /runner-front/.test(s) && !/runner-back/.test(s));
  check('both eyes are drawn, side by side', ((s.match(/<ellipse[^>]*rx="3\.2" ry="4\.1"/g) || []).length) === 2);
  check('no outfit set: it wears the default shirt (collar and buttons), not bare', /M16\.6,19\.8L20,24L23\.4,19\.8/.test(s) && /#3faa4a/.test(s));

  // a saved outfit (dress-up) shows up
  await js(`window.setRobotOutfit('claude_s2', { hat: 'crown', hatColor: '#112233', clothes: 'hoodie', clothesColor: '#445566', glasses: 'round', glassesColor: '#778899' }); 1`);
  await wait(900);
  s = await svg();
  check('its saved hat, clothes and glasses are drawn', /#f2c230/.test(s) /* crown gold */ && /#112233/.test(s) && /#445566/.test(s) && /#778899/.test(s) && /cx="14\.8" cy="9" r="4\.4"/.test(s) && /cx="25\.2" cy="9" r="4\.4"/.test(s));
  check('and the default shirt is gone', !/#3faa4a/.test(s));

  // other outfits
  await js(`window.setRobotOutfit('claude_s2', { hat: 'headphones', hatColor: '#aa0000', clothes: 'suit', clothesColor: '#222244' }); 1`);
  await wait(900);
  s = await svg();
  check('headphones are drawn with a cup on each side, a suit gets its tie', /x="4\.6" y="6"/.test(s) && /x="28\.8" y="6"/.test(s) && /#222244/.test(s) && /M19\.2,21\.4H20\.8/.test(s));
  await js(`window.setRobotOutfit('claude_s2', null); 1`);
  await wait(900);
  s = await svg();
  check('with the outfit removed it goes back to the default shirt', /M16\.6,19\.8L20,24L23\.4,19\.8/.test(s));

  // every hat / clothes / glasses draws something and never throws
  const all = await js(`(() => { const out = []; const hats = ['tophat','cap','beanie','party','crown','headphones','hardhat','cowboy','wizard','chef','propeller','bow','halo'], cl = ['shirt','hoodie','suit','sweater','overalls','scarf'], gl = ['round','shades','nerd','hearts','monocle'];
    for (const h of hats) out.push(window.buildRunnerSvg(0, { hat: h }, 'front').length);
    for (const c of cl) out.push(window.buildRunnerSvg(0, { clothes: c }, 'front').length);
    for (const g of gl) out.push(window.buildRunnerSvg(0, { glasses: g }, 'front').length);
    return out; })()`);
  check('all 13 hats, 6 clothes and 5 glasses draw in the front view', Array.isArray(all) && all.length === 24 && all.every((n) => n > 800), JSON.stringify(all));
  check('the side view (used elsewhere) is unchanged', /r-arm-front/.test(await js(`window.buildRunnerSvg(0, null, 'run')`)) && /runner-back/.test(await js(`window.buildRunnerSvg(0, null, 'gaze')`)));

  console.log(`\n${pass} passed, ${fail} failed`);
  app.exit(fail ? 1 : 0);
});
