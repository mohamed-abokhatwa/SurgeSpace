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
  // start page: start cards and examples, then into the workspace
  t('start page opens with the examples', (await p.locator('.start .thumb-card').count()) >= 8 && (await p.locator('.start-card').count()) === 5);
  await p.locator('.start-go').click();
  await p.waitForTimeout(300);
  t('start page closes into the workspace', (await p.locator('.start').count()) === 0);
  // tour invitation and tour
  await p.getByRole('button', { name: 'Take the tour' }).click();
  let steps = 0;
  for (; steps < 10 && (await p.locator('.tour').count()); steps++) { await p.locator('.tour-card .btn.primary').click(); await p.waitForTimeout(380); }
  t('tour walks through every step', steps === 7, `${steps} steps`);
  // command palette: type part of a command and press Enter
  await p.keyboard.press('Control+k');
  await p.locator('.pal-in').fill('health');
  await p.keyboard.press('Enter');
  const health = await p.waitForSelector('.modal', { timeout: 5000 }).then(() => 1, () => 0);
  t('command palette finds and runs a command', health === 1);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.keyboard.press('Control+k');
  await p.locator('.pal-in').fill('HP2600');
  await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  t('command palette finds an element', (await p.evaluate(() => document.querySelector('.statusbar')?.textContent ?? '')).includes('1 selected'));
  // run screen with stages
  await p.locator('.rb.run').click();
  const rs = await p.waitForSelector('.run-screen', { timeout: 5000 }).then(() => 1, () => 0);
  await p.waitForFunction(() => !document.querySelector('.run-screen'), null, { timeout: 30000 });
  t('run screen shows the stages, then clears', rs === 1);
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
    const open = await p.waitForSelector('.modal', { timeout: 5000 }).then(() => 1, () => 0);
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
  t('start page in Arabic', (await p.evaluate(() => document.querySelector('.start')?.textContent ?? '')).includes('ابدأ مشروعًا'));
  await p.locator('.start-go').click(); await p.waitForTimeout(300);
  await p.locator('.dtab').nth(4).click(); await p.waitForTimeout(300);
  const arPanel = await p.evaluate(() => document.body.innerText.includes('حالة جديدة من الحالية') || document.body.innerText.includes('تشغيل كل الحالات'));
  t('panel contents are in Arabic', arPanel);
  await p.locator('.menu-btn').nth(2).click();
  await p.locator('.menu-item').filter({ hasText: /اللغة|Language/ }).first().hover();
  await p.locator('.menu-item', { hasText: 'English' }).first().click(); await p.waitForTimeout(300);
  t('switching back to English restores the panels', (await p.evaluate(() => document.documentElement.dir)) === 'ltr' && (await p.evaluate(() => document.body.innerText.includes('Run all cases and compare'))));
  t('no script errors', !errs.length, errs.join(' | '));
  await b.close();
} catch (e) { t('smoke test ran', false, e.message); } finally { srv.kill(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
