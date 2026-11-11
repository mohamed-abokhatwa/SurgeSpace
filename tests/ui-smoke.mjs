// Click-through smoke test of the built app (CI): every main menu, panel and dialog opens without a script error,
// a surge run and a daily-operation run complete, and the Arabic interface switches to right to left.
//   npm run build && node tests/ui-smoke.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const port = 4391;
const srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore', shell: process.platform === 'win32' });
let pass = 0, fail = 0;
const t = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };
try {
  await new Promise((r) => setTimeout(r, 3000));
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(`http://localhost:${port}/`);
  await p.waitForSelector('.statusbar', { timeout: 20000 });
  await p.waitForFunction(() => document.querySelector('.statusbar')?.textContent?.includes('Run OK'), null, { timeout: 30000 });
  t('example runs on start', true);
  for (const m of ['File', 'Edit', 'View', 'Model', 'Analysis', 'Results', 'Tools', 'AI', 'Help']) {
    await p.locator('.menu-btn', { hasText: new RegExp(`^${m}$`) }).click();
    const n = await p.locator('.menu-item').count();
    await p.keyboard.press('Escape'); await p.mouse.click(5, 300);
    t(`menu ${m} opens`, n > 2, `${n} items`);
  }
  for (const tab of ['Profile', 'Graphs', 'Design checks', 'Data sheets', 'Cases', 'Protection sizing', 'Uncertainty', 'Daily operation', 'Live data', 'Run log']) {
    await p.locator('.dtab', { hasText: tab }).first().click(); await p.waitForTimeout(150);
  }
  for (const tab of ['Operations', 'Library', 'Explorer']) { await p.locator('.ptab', { hasText: tab }).first().click(); await p.waitForTimeout(100); }
  await p.locator('.ptab', { hasText: 'Copilot' }).click(); await p.waitForTimeout(150);
  t('dock tabs and panes open', !errs.length, errs.join(' | '));
  const dialogs = [['Analysis', 'Model Health Check'], ['Analysis', 'Run Setup'], ['Tools', 'Catalogues'], ['Tools', 'Script console'], ['View', 'Map and terrain'], ['AI', 'AI accounts'], ['Edit', 'Find element'], ['Help', 'Quick start']];
  for (const [m, item] of dialogs) {
    await p.locator('.menu-btn', { hasText: new RegExp(`^${m}$`) }).click();
    await p.locator('.menu-item', { hasText: item }).first().click();
    await p.waitForTimeout(200);
    const open = await p.locator('.modal').count();
    await p.keyboard.press('Escape'); await p.waitForTimeout(100);
    t(`dialog ${item}`, open > 0);
  }
  // new model wizard: four steps, then build (without the follow-up run)
  await p.locator('.menu-btn', { hasText: /^File$/ }).click();
  await p.locator('.menu-item', { hasText: 'New model wizard' }).click();
  for (let k = 0; k < 3; k++) { await p.getByRole('button', { name: 'Next' }).click(); await p.waitForTimeout(80); }
  await p.locator('.modal input[type=checkbox]').uncheck();
  await p.getByRole('button', { name: 'Build the model' }).click();
  await p.waitForTimeout(800);
  t('wizard builds a model', (await p.locator('.modal').count()) === 0 && (await p.locator('text=Model built by the wizard').count()) > 0);
  // daily operation on the Town example
  await p.locator('.menu-btn', { hasText: /^File$/ }).click();
  await p.locator('.menu-item', { hasText: 'Open example' }).hover();
  await p.locator('.menu-item', { hasText: 'Town supply' }).click();
  await p.waitForTimeout(1500);
  await p.locator('.dtab', { hasText: 'Daily operation' }).click();
  await p.getByRole('button', { name: /^Run \d+ h$/ }).click();
  await p.waitForSelector('text=Tank levels', { timeout: 60000 });
  t('daily operation runs', true);
  await p.evaluate(() => localStorage.setItem('surgespace.lang', 'ar'));
  await p.reload(); await p.waitForTimeout(2500);
  t('Arabic interface is right to left', (await p.evaluate(() => document.documentElement.dir)) === 'rtl');
  t('no script errors', !errs.length, errs.join(' | '));
  await b.close();
} catch (e) { t('smoke test ran', false, e.message); } finally { srv.kill(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
