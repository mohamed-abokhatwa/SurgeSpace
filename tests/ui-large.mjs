// Large model in the interface: a 3,000-pipe grid is opened, drawn, panned, edited, run and undone, with timings and
// memory. Not a pass/fail on speed alone: limits are generous so it flags only real regressions.
//   npm run build:demo && node tests/ui-large.mjs [grid size, default 40 → 3,122 pipes]
// Uses the demo build (licence rules inside the app) and starts an evaluation, since the Free plan runs only small
// models of your own.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const n = Number(process.argv[2] ?? 40);
const nodes = [{ id: 'R', kind: 'reservoir', x: -100, y: 0, elev: 0, head: 80 }], pipes = [];
for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) nodes.push({ id: `N${i}_${j}`, kind: 'junction', x: i * 100, y: j * 100, elev: (i + j) % 7, demand: 0.0005 });
let k = 0;
for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
  if (i + 1 < n) pipes.push({ id: `P${k++}`, from: `N${i}_${j}`, to: `N${i + 1}_${j}`, length: 100, diameter: 0.2, roughness: 0.1, wavespeed: 1000 });
  if (j + 1 < n) pipes.push({ id: `P${k++}`, from: `N${i}_${j}`, to: `N${i}_${j + 1}`, length: 100, diameter: 0.15, roughness: 0.1, wavespeed: 1000 });
}
pipes.push({ id: 'MAIN', from: 'R', to: 'N0_0', length: 500, diameter: 1.0, roughness: 0.1, wavespeed: 1000 });
nodes.push({ id: 'VX', kind: 'junction', x: n * 100, y: n * 100, elev: 0 }, { id: 'OUT', kind: 'reservoir', x: n * 100 + 10, y: n * 100, elev: 0, head: 0 });
pipes.push({ id: 'PV', from: `N${n - 1}_${n - 1}`, to: 'VX', length: 50, diameter: 0.2, roughness: 0.1, wavespeed: 1000 });
const net = { name: 'Large grid', nodes, pipes, pumps: [], valves: [{ id: 'V', from: 'VX', to: 'OUT', diameter: 0.2, k0: 10, opening: 0.3 }], event: { kind: 'valveClose', targets: ['V'], start: 0.5, duration: 1 }, settings: { friction: 'DW', duration: 3, frames: 100 }, fileVersion: 3 };

const port = 4393;
const srv = spawn('npx', ['vite', 'preview', '--outDir', 'dist-demo', '--port', String(port), '--strictPort'], { stdio: 'ignore', shell: process.platform === 'win32' });
let pass = 0, fail = 0;
const t = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };
const ms = (t0) => Math.round(performance.now() - t0);
try {
  await new Promise((r) => setTimeout(r, 3000));
  const b = await chromium.launch({ args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.addInitScript((s) => { if (!localStorage.getItem('large-test')) { localStorage.setItem('surgespace.autosave', s); localStorage.setItem('large-test', '1'); } }, JSON.stringify(net));
  await p.goto(`http://localhost:${port}/`);
  await p.waitForSelector('.statusbar', { timeout: 20000 });
  await p.waitForTimeout(1500);
  const heap = () => p.evaluate(() => { globalThis.gc?.(); return (performance.memory?.usedJSHeapSize ?? 0) / 1048576; });
  const h0 = await heap();
  let t0 = performance.now();
  await p.locator('.menu-btn', { hasText: /^File$/ }).click();
  await p.locator('.menu-item', { hasText: 'Recover autosaved model' }).click();
  await p.waitForFunction((np) => document.querySelector('.statusbar')?.textContent?.includes(`${np} pipes`), pipes.length, { timeout: 60000 });
  const tOpen = ms(t0);
  t(`opens and draws ${pipes.length.toLocaleString('en')} pipes`, tOpen < 15000, `${tOpen} ms`);
  const canvas = p.locator('svg.canvas, .canvas svg, svg').first();
  const box = await canvas.boundingBox();
  t0 = performance.now();
  for (let i = 0; i < 10; i++) { await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.wheel(0, i % 2 ? 300 : -300); await p.waitForTimeout(16); }
  const tZoom = ms(t0);
  t('zooms smoothly (10 wheel steps)', tZoom < 8000, `${tZoom} ms, ${(tZoom / 10).toFixed(0)} ms per step`);
  const h1 = await heap();
  // ten edits (select all, then move with the keyboard) and ten undos
  t0 = performance.now();
  await p.mouse.click(box.x + 5, box.y + box.height - 5);
  await p.keyboard.press('Control+a');
  await p.waitForTimeout(300);
  const tSel = ms(t0);
  t('select all', tSel < 8000, `${tSel} ms`);
  // ten edits of every pipe at once (typing in the multi-edit diameter field), then ten undos
  const dia = p.locator('label.field', { hasText: /^Diameter/ }).locator('input').first();
  t0 = performance.now();
  for (let i = 0; i < 10; i++) { await dia.click(); await dia.press('Control+a'); await p.keyboard.type(String(200 + i * 10)); await p.keyboard.press('Tab'); }
  const tEdit = ms(t0);
  t0 = performance.now();
  for (let i = 0; i < 10; i++) { await p.keyboard.press('Control+z'); await p.waitForTimeout(30); }
  const tUndo = ms(t0);
  await p.waitForTimeout(500);
  const h2 = await heap();
  const after = await p.evaluate(() => document.querySelector('.statusbar')?.textContent ?? '');
  t('ten edits of all 3,000 pipes, then undos', tEdit < 20000 && after.includes(`${pipes.length} pipes`), `typing: ${tEdit} ms for 10 values; undo: ${tUndo} ms for 10 steps`);
  t('undo history memory stays modest', h2 - h1 < 400, `heap ${h0.toFixed(0)} → ${h1.toFixed(0)} MB after opening → ${h2.toFixed(0)} MB after 10 edits + undos`);
  // data sheet of every pipe
  t0 = performance.now();
  await p.locator('.dtab', { hasText: 'Data sheets' }).first().click();
  await p.waitForTimeout(500);
  const tSheet = ms(t0);
  t('data sheets open', tSheet < 8000, `${tSheet} ms`);
  // start an evaluation (demo licence server in the app), then the surge run
  await p.locator('.menu-btn', { hasText: /^Analysis$/ }).click();
  await p.locator('.menu-item', { hasText: 'Run surge' }).first().click();
  const trial = p.getByRole('button', { name: 'Start 14-day evaluation' });
  if (await trial.isVisible({ timeout: 5000 }).catch(() => false)) { await trial.click(); await p.waitForTimeout(800); await p.keyboard.press('Escape'); await p.locator('.modal-back').click({ position: { x: 5, y: 5 } }).catch(() => {}); }
  t0 = performance.now();
  await p.locator('.menu-btn', { hasText: /^Analysis$/ }).click();
  await p.locator('.menu-item', { hasText: 'Run surge' }).first().click();
  await p.waitForFunction(() => (document.querySelector('.statusbar')?.textContent ?? '').includes('Run OK'), null, { timeout: 240000 });
  const tRun = ms(t0);
  t('surge run completes and draws the results', tRun < 240000, `${tRun} ms`);
  t('no script errors', !errs.length, errs.slice(0, 3).join(' | '));
  await b.close();
} catch (e) { t('large-model test ran', false, e.message.split('\n')[0]); } finally { srv.kill(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
