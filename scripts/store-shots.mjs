// Microsoft Store screenshots (1920×1080) for SurgeSpace 3.0, taken from the demo build.
//   npm run build:demo && node scripts/store-shots.mjs store/images/v3
// The AI steps use a stand-in AI server inside the browser (no account needed), as in the interface tests.
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? join(here, '..', 'store', 'images', 'v3');
mkdirSync(out, { recursive: true });
const tmp = join(tmpdir(), `ss-shots-${process.pid}`); mkdirSync(tmp, { recursive: true });
const ky4 = join(tmp, 'KY4 distribution plan.dxf');
execFileSync('npx', ['tsx', join(here, '..', 'validation', 'write-plan-dxf.ts'), join(here, '..', 'validation', 'data', 'ky4.inp'), ky4, 'ft'], { stdio: 'ignore', shell: process.platform === 'win32' });
const port = 4401;
const srv = spawn('npx', ['vite', 'preview', '--outDir', 'dist-demo', '--port', String(port), '--strictPort'], { stdio: 'ignore', shell: process.platform === 'win32' });
const F = (o) => Object.entries(o).map(([name, value]) => ({ name, value: String(value) }));
const answer = {
  summary: 'Long section of the rising main PS-1 to Hill Tank, CH 0–5000, DN600 DI K9 PN25',
  items: [
    ...[[0, 100, 0.137], [1200, 115, 0.328], [2600, 140, 0.55], [3800, 120, 0.741], [5000, 130, 0.932]].map(([c, z, x]) => ({ type: 'profilePoint', fields: F({ chainage_m: c, level_m: z, ground_m: z + 1.5 }), box: [x - 0.03, 0.76, x + 0.03, 0.8], confidence: 0.95 })),
    { type: 'pipe', label: 'Main', fields: F({ diameter_mm: 600, material: 'Ductile iron K9', class_bar: 25 }), box: [0.03, 0.08, 0.42, 0.105], confidence: 0.9 },
    { type: 'design', fields: F({ design_flow_lps: 320 }), box: [0.42, 0.08, 0.6, 0.105], confidence: 0.9 },
    { type: 'reservoir', label: 'Sump', fields: F({ level_m: 98, chainage_m: 0 }), box: [0.03, 0.64, 0.11, 0.67], confidence: 0.85 },
    { type: 'tank', label: 'Hill tank', fields: F({ level_m: 134, chainage_m: 5000 }), box: [0.88, 0.34, 0.97, 0.37], confidence: 0.85 },
    { type: 'pump', fields: F({ count: 2, duty_flow_lps: 160, duty_head_m: 47, speed_rpm: 1480, inertia_kgm2: 9.5 }), box: [0.03, 0.9, 0.38, 0.93], confidence: 0.9 },
    { type: 'airValve', label: 'ARV', fields: F({ chainage_m: 1950, diameter_mm: 100, kind: 'double' }), box: [0.42, 0.39, 0.56, 0.42], confidence: 0.8 },
    { type: 'washout', label: 'WO', fields: F({ chainage_m: 3800, diameter_mm: 150 }), box: [0.7, 0.66, 0.8, 0.69], confidence: 0.55 },
  ],
};
const shots = [];
try {
  await new Promise((r) => setTimeout(r, 3000));
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await p.route('https://api.anthropic.com/**', async (route) => {
    const body = route.request().postDataJSON();
    const isDoc = (body.tools ?? []).some((t) => t.name === 'record_evidence');
    const content = isDoc ? [{ type: 'tool_use', id: 'tu', name: 'record_evidence', input: answer }] : [{ type: 'text', text: 'The pump trip drops the pressure to vapour along the rising main between CH 1,900 and 2,800 m: the high point at CH 2,600 is above the falling hydraulic grade line, and a vapour cavity of about 16 L forms there and collapses at 19 s.\n\nRecommended: an air vessel of 4.5 m³ at the pump discharge (sized for you in Protection sizing) and anti-slam air valves at the high points. Every change can be undone.' }];
    if (body.stream) {
      // the copilot streams: answer as Anthropic's server-sent events
      const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
      const text = content[0].text ?? '';
      const sse = ev('message_start', { message: { id: 'm', type: 'message', role: 'assistant', model: body.model, content: [], usage: { input_tokens: 10, output_tokens: 1 } } })
        + ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
        + ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } })
        + ev('content_block_stop', { index: 0 })
        + ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 50 } })
        + ev('message_stop', {});
      await route.fulfill({ status: 200, contentType: 'text/event-stream', headers: { 'access-control-allow-origin': '*' }, body: sse });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: body.model, content, stop_reason: isDoc ? 'tool_use' : 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } }) });
  });
  await p.addInitScript(() => { try { localStorage.setItem('surgespace.tour', 'seen'); } catch { /* */ } });
  const shot = async (name, caption) => { await p.waitForTimeout(700); await p.screenshot({ path: join(out, name) }); shots.push([name, caption]); console.log(name); };
  const menu = async (m, item, sub) => { await p.locator('.menu-btn', { hasText: new RegExp(`^${m}$`) }).click(); if (sub) { await p.locator('.menu-item', { hasText: item }).hover(); await p.locator('.menu-item', { hasText: sub }).first().click(); } else await p.locator('.menu-item', { hasText: item }).first().click(); };
  await p.goto(`http://localhost:${port}/`);
  await p.waitForSelector('.start', { timeout: 20000 });
  await p.waitForTimeout(1200);
  await shot('01-start-page.png', 'Start with a new model, the wizard, your recent projects, or build a model from your drawings with AI');
  await p.locator('.start-go').click();
  await p.waitForTimeout(300);
  await menu('Tools', 'Licence…');
  await p.getByText('Start 14-day evaluation').click({ timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(600);
  for (let i = 0; i < 3 && await p.locator('.modal-back').count(); i++) { await p.locator('.modal-back button[aria-label=Close]').first().click().catch(() => p.keyboard.press('Escape')); await p.waitForTimeout(200); }
  // an AI account (the stand-in server answers for it)
  await menu('AI', 'AI accounts…');
  await p.waitForSelector('.modal');
  if (await p.getByText('+ Add an account').count()) await p.getByText('+ Add an account').click();
  await p.locator('.modal input[type=password]').fill('stand-in-key');
  await p.getByText('Save account').click();
  await p.waitForTimeout(500);
  await p.locator('.modal input[type=checkbox]').last().check();
  await p.locator('.modal .modal-head button[aria-label=Close]').click();

  // 2. the surge on a looped network
  await menu('File', 'Open example', 'Looped network');
  await p.waitForTimeout(1200);
  await p.keyboard.press('F5');
  await p.waitForFunction(() => !document.querySelector('.run-screen') && (document.querySelector('.statusbar')?.textContent ?? '').includes('Run OK'), null, { timeout: 120000 });
  await p.locator('.seg-btn', { hasText: /^Surge$/ }).first().click().catch(() => {});
  // play the surge for a moment and pause on the waves
  await p.locator('.canvas-wrap').click({ position: { x: 40, y: 40 } }).catch(() => {});
  await p.keyboard.press('Space'); await p.waitForTimeout(2600); await p.keyboard.press('Space');
  await p.mouse.move(5, 1075);
  await shot('02-network-surge.png', 'Watch the pressure waves travel through the network after the pumps trip, with vapour cavities shown where they form');

  // 3. waterfall on the rising main
  await menu('File', 'Open example', 'Rising main');
  await p.waitForTimeout(1200);
  await p.keyboard.press('F5');
  await p.waitForFunction(() => !document.querySelector('.run-screen') && (document.querySelector('.statusbar')?.textContent ?? '').includes('Run OK'), null, { timeout: 120000 });
  await p.locator('.dtab', { hasText: 'Profile' }).click().catch(() => {});
  await p.getByRole('button', { name: 'Waterfall (3D)' }).click().catch(() => {});
  await shot('03-waterfall.png', 'Pressure along the main over time in the waterfall view, with the long section and envelopes');

  // 4. copilot
  await p.locator('.ptab', { hasText: 'Copilot' }).click();
  await p.waitForSelector('.copilot-body textarea', { timeout: 20000 });
  await p.locator('.copilot-body textarea').fill('Why does the pressure fall to vapour, and how do I protect this main?');
  await p.locator('.copilot-body button', { hasText: /^Send$/ }).click();
  await p.waitForSelector('.copilot-body .msg.assistant', { timeout: 20000 });
  await shot('04-ai-copilot.png', 'An AI copilot with your own AI account: it reads the model, runs the engines and explains the results');

  // 5–7. model from documents
  await menu('AI', 'Model from documents…');
  await p.waitForSelector('.intake');
  await p.locator('.intake .drop input[type=file]').setInputFiles([join(here, '..', 'tests', 'fixtures', 'long-section.pdf'), join(here, '..', 'tests', 'fixtures', 'pump-curve.png')]);
  await p.waitForFunction(() => document.querySelectorAll('.doc-card').length === 2 && !document.querySelector('.intake-busy'), null, { timeout: 30000 });
  await p.getByRole('button', { name: /Read with AI/ }).click();
  await p.waitForSelector('.intake-review', { timeout: 30000 });
  await p.locator('.ev-row', { hasText: 'chainage_m = 1950' }).click().catch(() => {});
  await shot('05-documents-review.png', 'Build the model from your drawings: every value the AI reads is shown where it came from, for you to check');
  await p.getByText('Accept all with confidence ≥ 70 %').click();
  await p.locator('.istep', { hasText: 'Build and check' }).click();
  await p.getByRole('button', { name: 'Build the model' }).click();
  await p.waitForSelector('.verify', { timeout: 20000 });
  await shot('06-documents-build.png', 'Every value traced to its document, missing data asked for, and the model checked against the drawings');
  await p.locator('.istep', { hasText: 'Protection' }).click();
  await p.waitForSelector('.intake-protect tbody tr', { timeout: 30000 });
  await p.getByRole('button', { name: 'Test the plan in surge runs' }).click();
  await p.waitForSelector('.test-cmp', { timeout: 120000 });
  await p.getByRole('button', { name: 'Size the air vessel' }).click();
  await p.waitForSelector('.vessel-res', { timeout: 180000 });
  await p.evaluate(() => document.querySelector('.test-cmp')?.scrollIntoView({ block: 'center' }));
  await shot('07-air-valve-plan.png', 'Air valve plan by AWWA M51 practice, tested in surge runs, and the air vessel sized for you');
  await p.locator('.intake-head button[aria-label=Close]').click();

  // 8. network from a plan drawing
  await menu('AI', 'Model from documents…');
  await p.waitForSelector('.intake');
  await p.locator('.istep', { hasText: 'Documents' }).click();
  await p.waitForSelector('.intake .drop');
  await p.locator('.intake .doc-act button[aria-label=Remove]').first().click().catch(() => {});
  await p.locator('.intake .doc-act button[aria-label=Remove]').first().click().catch(() => {});
  await p.locator('.intake .drop input[type=file]').setInputFiles([ky4]);
  await p.waitForSelector('.doc-card');
  await p.locator('.istep', { hasText: 'Build and check' }).click();
  await p.locator('.build-mode button', { hasText: 'plan drawing' }).click().catch(() => {});
  await p.getByRole('button', { name: 'Read the plan' }).click();
  await p.waitForSelector('.plan-preview svg', { timeout: 60000 });
  await shot('08-plan-drawing.png', 'Read a whole network from a CAD plan: pipes, bends, levels, sizes, pumps, tanks and air valves');
  await p.locator('.intake-head button[aria-label=Close]').click();

  // 9. daily operation
  await menu('File', 'Open example', 'Town supply');
  await p.waitForTimeout(1500);
  await p.locator('.dtab', { hasText: 'Daily operation' }).click();
  await p.getByRole('button', { name: /^Run \d+ h$/ }).click();
  await p.waitForSelector('text=Tank levels', { timeout: 90000 });
  await shot('09-daily-operation.png', 'Daily operation: tank levels, pump switching, pressures through the day and water quality');

  // 10. Arabic, right to left, with results
  await p.evaluate(() => localStorage.setItem('surgespace.lang', 'ar'));
  await p.reload();
  await p.waitForSelector('.start', { timeout: 20000 });
  await p.waitForTimeout(800);
  await p.locator('.start-go').click();
  await p.waitForTimeout(400);
  await p.keyboard.press('F5');
  await p.waitForFunction(() => !document.querySelector('.run-screen') && /OK|نجح|تم/.test(document.querySelector('.statusbar')?.textContent ?? ''), null, { timeout: 120000 }).catch(() => {});
  await p.waitForTimeout(1500);
  await p.mouse.move(5, 1075);
  await shot('10-arabic.png', 'English or Arabic, with the interface, panels and report right to left');
  await p.evaluate(() => localStorage.setItem('surgespace.lang', 'en'));
  await b.close();
} catch (e) {
  console.error('FAILED', e.message);
  process.exitCode = 1;
} finally {
  srv.kill();
  console.log(JSON.stringify(shots, null, 1));
}
