// Runs the page-level tests in a hidden Electron window: node tests/ui/run.js   (npm run test:ui)
// Each *.ui.js file prints PASS/FAIL lines and exits non-zero if something failed.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const electron = require('electron');
let failed = 0;
for (const f of fs.readdirSync(__dirname).filter((n) => n.endsWith('.ui.js'))) {
  console.log(`\n== ${f}`);
  const r = spawnSync(electron, [path.join(__dirname, f)], { encoding: 'utf8', env: { ...process.env, OVLY_UI_TEST: '1' } });
  if (r.status !== 0) { failed++; console.log(`FAILED (exit ${r.status})`); }
  else console.log('ok');
  const log = path.join(__dirname, 'log.txt');
  if (fs.existsSync(log)) { process.stdout.write(fs.readFileSync(log, 'utf8')); fs.unlinkSync(log); }
}
process.exit(failed ? 1 : 0);
