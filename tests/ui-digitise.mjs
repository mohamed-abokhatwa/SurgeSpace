// Two ways in without AI, in the interface: a pump curve read off a raster graph by hand (two points per axis, then
// clicks along the curve), and a network built from Excel-style node and link schedules — then planned and opened.
//   npm run build:demo && node tests/ui-digitise.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const shots = process.env.SHOTS;
const port = 4397;
const srv = spawn('npx', ['vite', 'preview', '--outDir', 'dist-demo', '--port', String(port), '--strictPort'], { stdio: 'ignore', shell: process.platform === 'win32' });
let pass = 0, fail = 0;
const t = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };
const fx = JSON.parse(readFileSync(join(here, 'fixtures', 'pump-curve.json'), 'utf8'));
// a small branched network as schedules: a reservoir, a pump, a main with branches
const tmp = join(tmpdir(), `ss-dig-${process.pid}`); mkdirSync(tmp, { recursive: true });
const nodes = [['ID', 'Type', 'X', 'Y', 'Elevation', 'Water level', 'Demand (L/s)'], ['R1', 'Reservoir', 0, 0, 95, 98, ''], ['S1', 'Junction', 20, 0, 95, '', 0], ['J1', 'Junction', 40, 0, 95, '', 0],
  ['J2', 'Junction', 800, 0, 118, '', 15], ['J3', 'Junction', 1600, 100, 131, '', 20], ['J4', 'Junction', 1600, 800, 122, '', 25], ['J5', 'Junction', 2400, 100, 126, '', 30], ['T1', 'Tank', 2400, 900, 140, 146, '']];
const links = [['ID', 'Type', 'From', 'To', 'Length', 'Diameter', 'Roughness'], ['P1', 'Pipe', 'R1', 'S1', 20, 400, 0.1], ['PU1', 'Pump', 'S1', 'J1', '', '', ''], ['P2', 'Pipe', 'J1', 'J2', 780, 400, 0.1],
  ['P3', 'Pipe', 'J2', 'J3', 810, 350, 0.1], ['P4', 'Pipe', 'J3', 'J4', 700, 200, 0.1], ['P5', 'Pipe', 'J3', 'J5', 800, 300, 0.1], ['P6', 'Pipe', 'J5', 'T1', 800, 300, 0.1]];
writeFileSync(join(tmp, 'nodes.csv'), nodes.map((r) => r.join(',')).join('\n'));
writeFileSync(join(tmp, 'links.csv'), links.map((r) => r.join(',')).join('\n'));
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
  await p.locator('.intake .drop input[type=file]').setInputFiles([join(here, 'fixtures', 'pump-curve.png'), join(tmp, 'nodes.csv'), join(tmp, 'links.csv')]);
  await p.waitForFunction(() => document.querySelectorAll('.doc-card').length === 3 && !document.querySelector('.intake-busy'), null, { timeout: 15000 });
  const cards = await p.locator('.doc-card').allTextContents();
  t('schedules read without AI', cards[1].includes('8 items') && cards[2].includes('7 items'), cards.map((c) => c.slice(0, 60)).join(' | '));

  // digitise the curve
  await p.locator('.istep', { hasText: 'Review' }).click();
  await p.waitForSelector('.intake-review');
  await p.getByRole('button', { name: 'Digitise a pump curve' }).click();
  await p.waitForSelector('.dz-layer');
  await p.locator('.dz-panel select').first().selectOption('m3h');
  const box0 = await p.locator('.dz-layer').boundingBox();
  const at = async ([x, y]) => { const box = await p.locator('.dz-layer').boundingBox(); await p.mouse.click(box.x + x * box.width, box.y + y * box.height); return box; };
  for (const [k, v] of [['x1', 0], ['x2', 1000], ['y1', 0], ['y2', 80]]) { await at(fx.axisPoints[k]); await p.locator('.dz-val').fill(String(v)); await p.keyboard.press('Enter'); }
  let moved = 0;
  for (const c of fx.curve) { const bx = await at(c.at); moved = Math.max(moved, Math.abs(bx.y - box0.y)); }
  t('the graph stays still while digitising', moved < 1, `moved ${moved.toFixed(1)} px`);
  if (shots) await p.screenshot({ path: `${shots}/dig-1-curve.png` });
  await p.getByRole('button', { name: /Add 7 points/ }).click();
  const rows = await p.locator('.ev-row', { hasText: 'flow_lps' }).allTextContents();
  let worst = 0;
  fx.curve.forEach((c, i) => {
    const m = /flow_lps = ([\d.]+); head_m = ([\d.]+)/.exec(rows[i] ?? '');
    if (!m) { worst = Infinity; return; }
    worst = Math.max(worst, Math.abs(Number(m[1]) - c.q_m3h / 3.6), Math.abs(Number(m[2]) - c.h_m));
  });
  t('curve read off the graph: 7 points, flow in m³/h converted to L/s, within 1.5 units of the true curve', rows.length === 7 && worst < 1.5, `largest error ${worst.toFixed(2)}`);

  // network from the schedules
  await p.locator('.istep', { hasText: 'Build and check' }).click();
  await p.waitForSelector('.build-mode');
  t('schedules mode offered and chosen', (await p.locator('.build-mode button.on').textContent()).includes('schedules'));
  await p.getByRole('button', { name: 'Build the network' }).click();
  await p.waitForSelector('.plan-preview svg');
  const roles = await p.locator('.plan-build table').nth(1).locator('tbody select').evaluateAll((els) => els.map((e) => e.value));
  t('reservoir and tank from the schedule are sources', roles.filter((r) => r === 'source').length === 2, roles.join(','));
  await p.getByRole('button', { name: 'Build the model' }).click();
  await p.waitForSelector('.plan-build .verify', { timeout: 15000 });
  const ver = await p.locator('.plan-build .vrow').allTextContents();
  t('built and checked: steady state solves with the digitised pump curve', ver[0].startsWith('✓'), ver.map((v) => v.slice(0, 50)).join(' | '));
  if (shots) await p.screenshot({ path: `${shots}/dig-2-built.png` });
  await p.locator('.intake-next').click();
  await p.waitForSelector('.intake-protect tbody tr', { timeout: 20000 });
  await p.getByRole('button', { name: 'Open the model' }).click();
  await p.waitForSelector('.intake', { state: 'detached', timeout: 5000 });
  await p.waitForFunction(() => !document.querySelector('.run-screen'), null, { timeout: 60000 });
  await p.waitForTimeout(800);
  const status = await p.locator('.statusbar').textContent();
  t('model opened and run', /Run OK/.test(status), status.slice(0, 120));
  t('no page errors', errs.length === 0, errs.join(' | ').slice(0, 300));
  await b.close();
} catch (e) {
  console.log('FAIL', e.message); fail++;
} finally {
  srv.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
