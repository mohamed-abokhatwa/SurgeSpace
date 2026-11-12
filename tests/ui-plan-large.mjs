// A real distribution network as a plan drawing in the interface: KY4 (959 junctions, 1,156 pipes with bends, drawn
// in feet with sizes in inches, tanks, a reservoir, pumps, hydrants, roads and contours) is read, its sources taken
// from the TWL texts, a network demand spread, built and checked, the air valve plan on the mains tested in surge
// runs in the background, and the model opened and run.
//   npm run build:demo && node tests/ui-plan-large.mjs
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const shots = process.env.SHOTS;
const tmp = join(tmpdir(), `ss-ky4-${process.pid}`); mkdirSync(tmp, { recursive: true });
const dxf = join(tmp, 'KY4 distribution plan.dxf');
execFileSync('npx', ['tsx', join(here, '..', 'validation', 'write-plan-dxf.ts'), join(here, '..', 'validation', 'data', 'ky4.inp'), dxf, 'ft'], { stdio: 'inherit', shell: process.platform === 'win32' });
const port = 4399;
const srv = spawn('npx', ['vite', 'preview', '--outDir', 'dist-demo', '--port', String(port), '--strictPort'], { stdio: 'ignore', shell: process.platform === 'win32' });
let pass = 0, fail = 0;
const t = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };
const ms = (t0) => Math.round(performance.now() - t0);
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
  await p.locator('.menu-btn', { hasText: /^Tools$/ }).click();
  await p.locator('.menu-item', { hasText: 'Licence…' }).click();
  await p.getByText('Start 14-day evaluation').click({ timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(600);
  for (let i = 0; i < 3 && await p.locator('.modal-back').count(); i++) { await p.locator('.modal-back button[aria-label=Close]').first().click().catch(() => p.keyboard.press('Escape')); await p.waitForTimeout(200); }
  await p.locator('.menu-btn', { hasText: /^AI$/ }).click();
  await p.locator('.menu-item', { hasText: 'Model from documents…' }).first().click();
  await p.waitForSelector('.intake');
  let t0 = performance.now();
  await p.locator('.intake .drop input[type=file]').setInputFiles([dxf]);
  await p.waitForSelector('.doc-card', { timeout: 30000 });
  t('large DXF opened', true, `${ms(t0)} ms`);
  await p.locator('.istep', { hasText: 'Build and check' }).click();
  await p.waitForSelector('.plan-build');
  t('units recognised as feet', await p.locator('.plan-build select').first().inputValue() === 'ft');
  t0 = performance.now();
  await p.getByRole('button', { name: 'Read the plan' }).click();
  await p.waitForSelector('.plan-preview svg', { timeout: 60000 });
  const read = ms(t0);
  const notes = await p.locator('.plan-preview .small').textContent();
  t('plan read: about a thousand pipes, levels and sizes from the texts', /1\d{3} pipes/.test(notes) && /Levels from the drawing texts/.test(notes), `${read} ms; ${notes.slice(0, 160)}`);
  const srcCount = await p.locator('.plan-build table').nth(1).locator('tbody select').evaluateAll((els) => els.filter((e) => e.value === 'source').length);
  t('the tanks and the reservoir are sources at their TWL', srcCount === 5, `${srcCount} sources`);
  await p.locator('input[aria-label="Total demand"]').fill('65');
  if (shots) await p.screenshot({ path: `${shots}/large-1-read.png` });
  t0 = performance.now();
  await p.getByRole('button', { name: 'Build the model' }).click();
  await p.waitForSelector('.plan-build .verify', { timeout: 60000 });
  const ver = await p.locator('.plan-build .vrow').allTextContents();
  t('built and checked', ver[0].startsWith('✓'), `${ms(t0)} ms; ${ver.map((v) => v.slice(0, 48)).join(' | ')}`);
  await p.locator('.intake-next').click();
  t0 = performance.now();
  await p.waitForSelector('.intake-protect tbody tr', { timeout: 60000 });
  const n = await p.locator('.intake-protect tbody tr').count();
  t('air valve plan on the mains from DN250', n > 3, `${n} locations, ${ms(t0)} ms`);
  t0 = performance.now();
  await p.getByRole('button', { name: 'Test the plan in surge runs' }).click();
  await p.waitForSelector('.test-cmp', { timeout: 400000 });
  t('plan tested in surge runs in the background, the page stays responsive', await p.evaluate(() => new Promise((r) => { const a = performance.now(); setTimeout(() => r(performance.now() - a < 500), 50); })), `${(ms(t0) / 1000).toFixed(0)} s`);
  if (shots) await p.screenshot({ path: `${shots}/large-2-protect.png` });
  await p.getByRole('button', { name: 'Open the model with the tested plan' }).click();
  await p.waitForSelector('.intake', { state: 'detached', timeout: 10000 });
  await p.waitForFunction(() => !document.querySelector('.run-screen'), null, { timeout: 400000 });
  await p.waitForTimeout(1000);
  const status = await p.locator('.statusbar').textContent();
  t('model opened and run', /Run OK/.test(status), status.slice(0, 120));
  if (shots) await p.screenshot({ path: `${shots}/large-3-open.png` });
  t('no page errors', errs.length === 0, errs.join(' | ').slice(0, 300));
  await b.close();
} catch (e) {
  console.log('FAIL', e.message); fail++;
} finally {
  srv.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
