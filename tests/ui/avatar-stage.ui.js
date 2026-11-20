// Avatar stage (laid out like the Pip-Boy STATS screen): click the robot picture → it slowly walks to the middle of the
// chat screen, bars appear around it, a strip of little pictures offers what to put on, every choice shows at once and
// is saved, Esc / Done sends it back.
require('./logpatch');
const { app, BrowserWindow } = require('electron');
const path = require('path');
app.disableHardwareAcceleration(); app.setPath('userData', require('os').tmpdir() + '/ovly-ui-test-ud18');
const SHOT = process.argv[2];
let pass = 0, fail = 0;
const check = (n, ok, i = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${i ? ' — ' + i : ''}`); };
const session = () => { const now = Date.now(); return { id: 'claude_s2', sessionUuid: 's2', source: 'claude', project: 'ovly-claude', cwd: 'C:/w', status: 'idle', state: 'waiting', statusLabel: 'Idle', title: 'ovly-claude', sessionTitle: 'Flow', detail: 'x', fullContent: 'Done.', model: 'claude-opus-5-5', mtime: now, lastTurnTs: now, context: { used: 80000, window: 200000 } }; };
process.on('unhandledRejection', (e) => { console.log('FAIL  unexpected error —', e && e.message); app.exit(1); });
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: +process.env.AV_W || 1000, height: 700, show: false, frame: false, useContentSize: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } });
  w.webContents.on('console-message', (e) => { if (e.level === 'error' && !/available/.test(e.message)) console.log('[page]', e.message); });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (c) => w.webContents.executeJavaScript(c).catch((e) => 'ERR ' + e.message);
  w.loadFile(path.join(__dirname, '../../ui/index.html')); await new Promise((r) => w.webContents.once('did-finish-load', r)); await wait(2200);
  await js(`window.__cbs.onSessionsSync(${JSON.stringify([session()])}); 1`);
  await js(`[...document.querySelectorAll('.style-pills .theme-pill')].find(x => /^Pip-Boy/.test(x.textContent))?.click(); 1`); await wait(500);
  await js(`showDetailView(sessionsList[0]); 1`); await wait(1500);
  const rect = (sel) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; })()`);
  const actorSvg = () => js(`document.querySelector('.av-actor svg')?.outerHTML || ''`);
  const opacity = (sel) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? parseFloat(getComputedStyle(e).opacity) : -1; })()`);
  const saved = () => js(`JSON.stringify(window.robotOutfits['claude_s2'] === undefined ? 'none' : window.robotOutfits['claude_s2'])`);
  const opt = (title) => js(`[...document.querySelectorAll('.av-opt')].find((b) => b.title === ${JSON.stringify(title)}).click(); 1`);
  const tab = (txt) => js(`[...document.querySelectorAll('.av-tab')].find((b) => b.textContent === ${JSON.stringify(txt)}).click(); 1`);
  const onTab = () => js(`document.querySelector('.av-tab.on').textContent`);
  const key = (k) => js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true })); 1`);
  const SHIRT = /M16\.6,19\.8L20,24L23\.4,19\.8/;

  // ---- the walk ----
  const start = await rect('.pip-picture svg');
  check('the picture is on the readout panel (right side) to begin with', !!start && start.x > 600, JSON.stringify(start));
  await js(`document.querySelector('.pip-picture').click(); 1`);
  await wait(450);
  check('clicking the picture opens the stage', await js(`window.avatarStageOpen() && !!document.querySelector('.av-stage')`));
  check('the panel picture is hidden while its copy walks', (await js(`getComputedStyle(document.querySelector('.pip-picture')).visibility`)) === 'hidden');
  const mid = await rect('.av-actor');
  const slot = await rect('.av-slot');
  const total = Math.hypot(slot.x - start.x, slot.y - start.y);
  const frac = Math.hypot(mid.x - start.x, mid.y - start.y) / total;
  check('after 0.45 s it is on its way (not jumped, not arrived)', frac > 0.03 && frac < 0.9, `${Math.round(frac * 100)}% of the way`);
  check('the bars, strip and tabs are not shown yet while it walks', (await opacity('.av-tabs')) < 0.5 && (await opacity('.av-strip')) < 0.5);
  await wait(1500);
  const end = await rect('.av-actor');
  check('it arrives on the spot in the middle of the stage', Math.abs(end.x - slot.x) < 3 && Math.abs(end.y - slot.y) < 3 && end.h > start.h * 1.6, `${Math.round(end.h)}px tall (was ${Math.round(start.h)})`);
  const stage = await rect('.av-stage');
  check('and that spot is the middle of the chat screen', Math.abs(slot.x - stage.x) < 6, `slot ${Math.round(slot.x)} vs stage ${Math.round(stage.x)}`);
  check('everything has faded in', (await opacity('.av-tabs')) > 0.9 && (await opacity('.av-marks')) > 0.9 && (await opacity('.av-strip')) > 0.9 && (await opacity('.av-status')) > 0.9);
  check('four tabs along the top: Hat, Glasses, Clothes, Colour', (await js(`[...document.querySelectorAll('.av-tab')].map((e) => e.textContent).join('|')`)) === 'Hat|Glasses|Clothes|Colour');
  check('bars around the figure: 4 you can use, 3 plain', (await js(`document.querySelectorAll('button.av-mark').length`)) === 4 && (await js(`document.querySelectorAll('div.av-mark.plain').length`)) === 3);
  const figure = await rect('.av-slot');
  const marks = await js(`[...document.querySelectorAll('.av-mark')].map((m) => { const r = m.querySelector('.av-bar').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, cat: m.textContent }; })`);
  const above = marks.find((m) => /^Hat/.test(m.cat)), faceL = marks.find((m) => /^Glasses/.test(m.cat)), bodyL = marks.find((m) => /^Clothes/.test(m.cat));
  check('the hat bar is above the head, the glasses and clothes bars sit to the left of the figure', above.y < figure.y - figure.h * 0.4 && Math.abs(above.x - figure.x) < 14 && faceL.x < figure.x - figure.w * 0.5 && bodyL.x < figure.x - figure.w * 0.5 && faceL.y < bodyL.y, JSON.stringify({ above: [Math.round(above.x), Math.round(above.y)], figure: [Math.round(figure.x), Math.round(figure.y)] }));
  check('the name is under the figure', (await js(`document.querySelector('.av-name').textContent`)) === 'Flow');
  check('the status bar shows the model, the context and the cost', /opus 5\.5/i.test(await js(`document.querySelectorAll('.av-seg')[0].textContent`)) && /40%/.test(await js(`document.querySelector('.av-seg-mid').textContent`)));
  if (SHOT) require('fs').writeFileSync(path.join(__dirname, 'shot-stage.png'), (await w.webContents.capturePage()).toPNG());

  // ---- customise ----
  check('it starts in the default shirt (nothing saved yet)', SHIRT.test(await actorSvg()) && (await saved()) === '"none"');
  check('the strip offers None and all 13 hats, as little pictures', (await js(`document.querySelectorAll('.av-opt').length`)) === 14 && (await js(`document.querySelectorAll('.av-opt svg').length`)) === 13);
  await opt('Crown'); await wait(100);
  check('Crown: shown on the avatar at once and saved', /#f2c230/.test(await actorSvg()) && JSON.parse(await saved()).hat === 'crown');
  check('its bar says Hat · Crown and is the lit one', /Hat · Crown/.test(await js(`document.querySelector('button.av-mark.on').textContent`)));
  await js(`document.querySelectorAll('.av-swatch')[5].click(); 1`); await wait(100);
  const hc = JSON.parse(await saved()).hatColor;
  check('a colour swatch recolours it (and is saved)', /^#[0-9a-f]{6}$/i.test(hc) && hc.toLowerCase() === (await js(`window.ROBOT_OUTFIT_CATALOG.swatches[5]`)).toLowerCase());
  await key('ArrowDown'); await wait(60);
  check('down arrow goes to the next tab (Glasses)', (await onTab()) === 'Glasses');
  await key('ArrowRight'); await wait(80);
  check('right arrow puts on the first glasses', JSON.parse(await saved()).glasses === 'round' && /cx="14\.8" cy="9" r="4\.4"/.test(await actorSvg()));
  await key('ArrowRight'); await wait(80);
  check('right again picks the next ones', JSON.parse(await saved()).glasses === 'shades');
  await key('ArrowLeft'); await key('ArrowLeft'); await wait(80);
  check('left twice takes them off again', JSON.parse(await saved()).glasses === undefined);
  await js(`document.querySelectorAll('button.av-mark')[2].click(); 1`); await wait(60);
  check('clicking the clothes bar opens the Clothes tab', (await onTab()) === 'Clothes');
  await opt('Hoodie'); await wait(100);
  check('Hoodie is drawn (the default shirt is gone)', JSON.parse(await saved()).clothes === 'hoodie' && !SHIRT.test(await actorSvg()));
  await tab('Colour'); await wait(60);
  check('Colour: Auto and 12 body colours as little pictures', (await js(`document.querySelectorAll('.av-opt').length`)) === 13);
  await js(`document.querySelectorAll('.av-opt')[5].click(); 1`); await wait(100);
  check('picking one sets this chat\'s colour (and its bar says Custom)', await js(`window.hasRobotHue('claude_s2')`) && /Custom/.test(await js(`document.querySelector('button.av-mark.on').textContent`)));
  await opt('Auto: the colour this chat gets by itself'); await wait(80);
  check('Auto gives the automatic colour back', !(await js(`window.hasRobotHue('claude_s2')`)));

  // ---- the keys at the top ----
  await js(`[...document.querySelectorAll('.av-btn')].find((b) => b.textContent === 'Amber').click(); 1`); await wait(100);
  check('Amber shows the avatar in the screen colour (and again for true colours)', await js(`document.querySelector('.av-actor').classList.contains('mono')`));
  await js(`[...document.querySelectorAll('.av-btn')].find((b) => b.textContent === 'Amber').click(); 1`);
  await js(`[...document.querySelectorAll('.av-btn')].find((b) => b.textContent === 'Take off').click(); 1`); await wait(100);
  check('Take off: nothing on (saved as an empty outfit, not the default shirt)', (await saved()) === '{}' && !/#f2c230/.test(await actorSvg()) && !SHIRT.test(await actorSvg()));
  await tab('Hat'); await opt('Beanie'); await wait(80);
  await js(`[...document.querySelectorAll('.av-btn')].find((b) => b.textContent === 'All robots').click(); 1`); await wait(100);
  check('All robots: saved for every robot, this chat follows it', (await js(`window.robotOutfits['*'] && window.robotOutfits['*'].hat`)) === 'beanie' && (await saved()) === '"none"' && /All robots/.test(await js(`document.querySelector('.av-scope').textContent`)));
  await opt('Crown'); await wait(80);

  // ---- back to the panel ----
  await key('Escape');
  await wait(450);
  const back = await rect('.av-actor');
  check('Esc: it walks back (slowly, not at once)', !!back && back.h < end.h && back.h > start.h);
  check('the stage is still there while it walks', await js(`window.avatarStageOpen()`));
  await wait(1300);
  check('then the stage is gone and the panel picture is back', !(await js(`window.avatarStageOpen() || !!document.querySelector('.av-stage, .av-actor')`)) && (await js(`getComputedStyle(document.querySelector('.pip-picture')).visibility`)) === 'visible');
  await wait(800);
  check('and the panel picture wears the new look', /#f2c230/.test(await js(`document.querySelector('.pip-picture svg').outerHTML`)));

  // Done button, and opening again
  await js(`document.querySelector('.pip-picture').click(); 1`); await wait(1700);
  await js(`[...document.querySelectorAll('.av-btn')].find((b) => b.textContent === 'Done').click(); 1`); await wait(1500);
  check('Done closes it too', !(await js(`window.avatarStageOpen()`)));

  console.log(`\n${pass} passed, ${fail} failed`);
  app.exit(fail ? 1 : 0);
});
