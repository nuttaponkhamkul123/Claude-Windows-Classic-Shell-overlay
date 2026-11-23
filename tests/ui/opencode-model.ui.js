// New OpenCode chat: the Model chip lists OpenCode's own models, and picking one sets it for the next reply.
// When OpenCode can't give its models, Claude's names (opus, sonnet…) are not offered and you're told why.
require('./logpatch');
const { app, BrowserWindow } = require('electron');
const path = require('path');
app.disableHardwareAcceleration(); app.setPath('userData', require('os').tmpdir() + '/ovly-ui-test-ocmodel');
let pass = 0, fail = 0;
const check = (n, ok, i = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${i ? ' — ' + i : ''}`); };
process.on('unhandledRejection', (e) => { console.log('FAIL  unexpected error —', e && e.message); app.exit(1); });
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 700, height: 700, show: false, frame: false, useContentSize: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (c) => w.webContents.executeJavaScript(c).catch((e) => 'ERR ' + e.message);
  w.loadFile(path.join(__dirname, '../../ui/index.html')); await new Promise((r) => w.webContents.once('did-finish-load', r)); await wait(2200);
  await js(`window.__cbs.onSessionsSync([]); 1`);
  const openMenu = async () => { await js(`document.getElementById('convoModel').dispatchEvent(new MouseEvent('click', { bubbles: true })); 1`); await wait(500); };
  const items = () => js(`[...document.querySelectorAll('#slashMenu .slash-item .slash-name')].map((x) => x.textContent)`);

  // 1. OpenCode answers with its models
  await js(`window.electronAPI.listModels = async () => [{ id: 'gpt-5', modelID: 'gpt-5', providerID: 'openai', name: 'GPT-5' }, { id: 'qwen3', modelID: 'qwen3', providerID: 'ollama', name: 'Qwen 3' }]; 1`);
  await js(`startNewChat(null, 'opencode', 'C:/w-a'); 1`); await wait(600);
  check('a new OpenCode chat shows the Model chip', await js(`getComputedStyle(document.getElementById('convoModel')).display !== 'none'`));
  await openMenu();
  const list = await items();
  check('the menu lists OpenCode’s models', Array.isArray(list) && list.includes('openai/gpt-5') && list.includes('ollama/qwen3'), JSON.stringify(list));
  await js(`[...document.querySelectorAll('#slashMenu .slash-item')].find((x) => /gpt-5/.test(x.textContent)).dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); 1`); await wait(300);
  check('picking one sets it for the next reply', (await js(`getReplyOptions(currentActiveSession).model`)) === 'openai/gpt-5');
  check('the "Next reply" chip shows it', /openai\/gpt-5/.test(await js(`document.getElementById('replyOptions')?.textContent || document.querySelector('.reply-option-chip')?.textContent || ''`)));

  // 2. OpenCode can't give its models (service not answering)
  await js(`window.electronAPI.listModels = async () => []; 1`);
  await js(`startNewChat(null, 'opencode', 'C:/w-b'); 1`); await wait(600);
  await openMenu();
  const fallback = await items();
  check('Claude’s model names are not offered for OpenCode', Array.isArray(fallback) && !fallback.includes('opus') && !fallback.includes('sonnet'), JSON.stringify(fallback));
  check('you are told why the list is empty', /OpenCode’s models/.test(await js(`document.getElementById('chatStream').textContent`)));

  console.log(`\n${pass} passed, ${fail} failed`);
  app.exit(fail ? 1 : 0);
});
