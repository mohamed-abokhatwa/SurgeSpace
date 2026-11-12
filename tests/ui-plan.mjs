// Network from a plan drawing in the interface: a DXF with pipe layers, symbols and level texts is dropped into
// Model from documents; the pipe layer and symbols are recognised, the plan is read into a network, the ends are
// set (the reservoir symbol is the source, two ends get demands), the model is built and checked, the air valve
// plan tested, an air vessel sized at the pump, and the model opened with both.
//   npm run build:demo && node tests/ui-plan.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const shots = process.env.SHOTS;
const port = 4396;
const srv = spawn('npx', ['vite', 'preview', '--outDir', 'dist-demo', '--port', String(port), '--strictPort'], { stdio: 'ignore', shell: process.platform === 'win32' });
let pass = 0, fail = 0;
const t = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };
try {
  await new Promise((r) => setTimeout(r, 3000));
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 920 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.addInitScript(() => { try { localStorage.setItem('surgespace.tour', 'seen'); } catch { /* */ } });
  await p.goto(`http://localhost:${port}/`);
  await p.waitForSelector('.statusbar', { timeout: 20000 });
  await p.waitForTimeout(600);
  await p.locator('.start-go').click().catch(() => {});
  await p.waitForTimeout(300);
  // an evaluation, as a new user would start one (the free plan has no sizing or surge tests of the plan)
  await p.locator('.menu-btn', { hasText: /^Tools$/ }).click();
  await p.locator('.menu-item', { hasText: 'Licence…' }).click();
  await p.getByText('Start 14-day evaluation').click({ timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(600);
  for (let i = 0; i < 3 && await p.locator('.modal-back').count(); i++) { await p.locator('.modal-back button[aria-label=Close]').first().click().catch(() => p.keyboard.press('Escape')); await p.waitForTimeout(200); }
  await p.locator('.menu-btn', { hasText: /^AI$/ }).click();
  await p.locator('.menu-item', { hasText: 'Model from documents…' }).first().click();
  await p.waitForSelector('.intake');
  await p.locator('.intake .drop input[type=file]').setInputFiles([join(here, 'fixtures', 'plan.dxf')]);
  await p.waitForSelector('.doc-card');
  t('DXF summarised (symbol types and texts)', (await p.locator('.doc-card').textContent()).includes('7 symbol types'));
  // straight to Build: with a plan, the long section and levels are not required
  await p.locator('.istep', { hasText: 'Missing data' }).click();
  t('with a plan drawing nothing is marked as needed', await p.locator('.gap.critical').count() === 0, `${await p.locator('.gap').count()} questions`);
  await p.locator('.istep', { hasText: 'Build and check' }).click();
  await p.waitForSelector('.plan-build');
  t('network mode chosen for a plan without a long section', await p.locator('.build-mode button.on').textContent() === 'Network from the plan drawing (DXF)');
  const checked = await p.locator('.layer-list input:checked').count();
  t('pipe layer recognised (roads left out)', checked === 1 && (await p.locator('.layer-list label', { has: p.locator('input:checked') }).textContent()).includes('W-PIPE-MAIN'));
  const kinds = await p.locator('.plan-build tbody select').evaluateAll((els) => els.map((e) => e.value));
  t('symbols recognised from their names', kinds.join(',') === 'reservoir,pump,airValve,airValve,valve,washout,ignore', kinds.join(','));
  await p.getByRole('button', { name: 'Read the plan' }).click();
  await p.waitForSelector('.plan-preview svg');
  const ends = await p.locator('.plan-build table').nth(1).locator('tbody tr').count();
  t('plan read: network drawn, open ends listed', ends === 4, `${ends} ends; ${(await p.locator('.plan-preview .small').textContent()).slice(0, 140)}`);
  const rows = p.locator('.plan-build table').nth(1).locator('tbody tr');
  const roleOf = async (i) => rows.nth(i).locator('select').inputValue();
  t('the reservoir symbol is taken as the source', (await roleOf(0)) === 'source');
  // demands at the other three ends
  for (let i = 1; i < ends; i++) { await rows.nth(i).locator('select').selectOption('demand'); await rows.nth(i).locator('input').fill('40'); }
  await rows.nth(0).locator('input').fill('104'); // sump 5.5 m above the pipe: enough suction head for the trip
  if (shots) await p.screenshot({ path: `${shots}/plan-1-read.png` });
  await p.getByRole('button', { name: 'Build the model' }).click();
  await p.waitForSelector('.plan-build .verify', { timeout: 15000 });
  const ver = await p.locator('.plan-build .vrow').allTextContents();
  t('built and checked (steady state solves; the high branch end is flagged)', ver[0].startsWith('✓') && ver.some((v) => v.startsWith('!') && /lowest -?\d/.test(v)), ver.map((v) => v.slice(0, 50)).join(' | '));
  await p.locator('.intake-next').click();
  await p.waitForSelector('.intake-protect tbody tr', { timeout: 20000 });
  t('air valve plan on the network (locations by node or pipe)', await p.locator('.intake-protect tbody tr').count() >= 5);
  await p.getByRole('button', { name: 'Test the plan in surge runs' }).click();
  await p.waitForSelector('.test-cmp', { timeout: 60000 });
  t('plan tested in surge runs', /With the plan/.test(await p.locator('.test-cmp').textContent()));
  await p.getByRole('button', { name: 'Size the air vessel' }).click();
  await p.waitForSelector('.vessel-res', { timeout: 90000 });
  const vres = await p.locator('.vessel-res').textContent();
  t('air vessel sized at the pump discharge with the plan in place', /✓ [\d.]+ m³/.test(vres), vres.slice(0, 90));
  if (shots) await p.screenshot({ path: `${shots}/plan-2-protection.png`, fullPage: true });
  await p.getByRole('button', { name: 'Open the model with the tested plan' }).click();
  await p.waitForSelector('.intake', { state: 'detached', timeout: 5000 });
  await p.waitForFunction(() => !document.querySelector('.run-screen'), null, { timeout: 30000 });
  await p.waitForTimeout(800);
  const status = await p.locator('.statusbar').textContent();
  t('model opened with the pump and run', /1 pump/.test(status) && /Run OK/.test(status), status.slice(0, 140));
  t('no page errors', errs.length === 0, errs.join(' | ').slice(0, 300));
  if (shots) await p.screenshot({ path: `${shots}/plan-3-open.png` });
  await b.close();
} catch (e) {
  console.log('FAIL', e.message); fail++;
} finally {
  srv.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
