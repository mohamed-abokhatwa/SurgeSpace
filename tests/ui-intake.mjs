// Model from documents, end to end in the interface: a long-section drawing (vector PDF) and a pump-curve CSV are
// dropped in; the CSV is read without AI; the PDF page goes to the AI provider (here a local stand-in for the
// Anthropic API that checks what it is sent and answers with record_evidence); the items are reviewed against the
// page, the missing data answered, the model built and checked, the air valve plan tested in surge runs and the
// model opened.  npm run build:demo && node tests/ui-intake.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const shots = process.env.SHOTS;
const port = 4394;
const srv = spawn('npx', ['vite', 'preview', '--outDir', 'dist-demo', '--port', String(port), '--strictPort'], { stdio: 'ignore', shell: process.platform === 'win32' });
let pass = 0, fail = 0;
const t = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };
const tmp = join(tmpdir(), `ss-intake-${process.pid}`); mkdirSync(tmp, { recursive: true });
const csv = join(tmp, 'pump-curve.csv');
writeFileSync(csv, 'Flow (L/s),Head (m)\n0,62\n80,57\n160,47\n220,35\n');

// what the stand-in AI answers for the long-section page: what an engineer reads on it
const F = (o) => Object.entries(o).map(([name, value]) => ({ name, value: String(value) }));
const answer = {
  summary: 'Long section of the rising main PS-1 to Hill Tank, CH 0–5000, DN600 DI K9 PN25',
  items: [
    ...[[0, 100], [1200, 115], [2600, 140], [3800, 120], [5000, 130]].map(([c, z], i) => ({ type: 'profilePoint', fields: F({ chainage_m: c, level_m: z, ground_m: z + 1.5 }), box: [0.07 + i * 0.2, 0.75, 0.12 + i * 0.2, 0.79], confidence: 0.95 })),
    { type: 'pipe', label: 'Main', fields: F({ diameter_mm: 600, material: 'Ductile iron K9', class_bar: 25 }), box: [0.03, 0.07, 0.6, 0.1], confidence: 0.9 },
    { type: 'design', fields: F({ design_flow_lps: 320 }), box: [0.3, 0.07, 0.6, 0.1], confidence: 0.9 },
    { type: 'reservoir', label: 'Sump', fields: F({ level_m: 98, chainage_m: 0 }), box: [0.02, 0.6, 0.1, 0.64], confidence: 0.85 },
    { type: 'tank', label: 'Hill tank', fields: F({ level_m: 134, chainage_m: 5000 }), box: [0.88, 0.2, 0.98, 0.25], confidence: 0.85 },
    { type: 'pump', fields: F({ count: 2, duty_flow_lps: 160, duty_head_m: 47, speed_rpm: 1480, standby: 1 }), box: [0.03, 0.9, 0.4, 0.94], confidence: 0.9 },
    { type: 'airValve', label: 'ARV', fields: F({ chainage_m: 1950, diameter_mm: 100, kind: 'double' }), box: [0.4, 0.4, 0.52, 0.45], confidence: 0.8 },
    { type: 'washout', label: 'WO', fields: F({ chainage_m: 3800, diameter_mm: 150 }), box: [0.7, 0.62, 0.8, 0.66], confidence: 0.55 },
  ],
};

try {
  await new Promise((r) => setTimeout(r, 3000));
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 920 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  let sent = null;
  await p.route('https://api.anthropic.com/**', async (route) => {
    const body = route.request().postDataJSON();
    sent = body;
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'tool_use', id: 'tu_1', name: 'record_evidence', input: answer }], stop_reason: 'tool_use', usage: { input_tokens: 4000, output_tokens: 600 } }) });
  });
  await p.goto(`http://localhost:${port}/`);
  await p.waitForSelector('.statusbar', { timeout: 20000 });
  await p.waitForTimeout(800);
  // evaluation (the free plan limits model size) and an AI account
  await p.locator('.start-go').click().catch(() => {});
  await p.waitForTimeout(300);
  // an evaluation, as a new user would start one (the free plan has no sizing or surge tests of the plan)
  await p.locator('.menu-btn', { hasText: /^Tools$/ }).click();
  await p.locator('.menu-item', { hasText: 'Licence…' }).click();
  await p.getByText('Start 14-day evaluation').click({ timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(600);
  for (let i = 0; i < 3 && await p.locator('.modal-back').count(); i++) { await p.locator('.modal-back button[aria-label=Close]').first().click().catch(() => p.keyboard.press('Escape')); await p.waitForTimeout(200); }

  // open from the start page card
  await p.locator('.menu-btn', { hasText: /^File$/ }).click();
  await p.locator('.menu-item', { hasText: 'Start page' }).first().click();
  await p.waitForSelector('.start');
  await p.getByText('Build from drawings with AI').click();
  await p.waitForSelector('.intake', { timeout: 5000 });
  t('workspace opens from the start page card', await p.locator('.intake .istep.on').textContent() === '1Documents');

  // drop in the PDF and the CSV
  await p.locator('.intake .drop input[type=file]').setInputFiles([join(here, 'fixtures', 'long-section.pdf'), csv]);
  await p.waitForSelector('.doc-card >> nth=1', { timeout: 15000 });
  await p.waitForFunction(() => document.querySelectorAll('.doc-card').length === 2 && !document.querySelector('.intake-busy'), null, { timeout: 15000 });
  const cards = await p.locator('.doc-card').allTextContents();
  t('PDF rendered (1 page) and CSV read without AI (4 pump curve points)', cards[0].includes('1 page') && cards[1].includes('4 items'), cards.map((c) => c.slice(0, 80)).join(' | '));
  t('page image shown as the thumbnail', await p.locator('.doc-thumb img').count() === 1);
  // no AI account yet: the workspace says so and offers to add one
  t('without an AI account, the drawing waits with a clear offer', await p.getByText('Drawings need an AI account to be read.').count() === 1);
  await p.getByText('Add an AI account').click();
  await p.waitForSelector('.modal');
  if (await p.getByText('+ Add an account').count()) await p.getByText('+ Add an account').click();
  await p.locator('.modal input[type=password]').fill('test-key-not-real');
  await p.getByText('Save account').click();
  await p.waitForTimeout(400);
  await p.locator('.modal input[type=checkbox]').last().check();
  await p.locator('.modal .modal-head button[aria-label=Close]').click();
  if (shots) await p.screenshot({ path: `${shots}/intake-1-documents.png` });

  // read with AI
  await p.getByRole('button', { name: /Read with AI/ }).click();
  await p.waitForSelector('.intake-review', { timeout: 20000 });
  const imgs = sent ? sent.messages[0].content.filter((c) => c.type === 'image').length : 0;
  const txt = sent ? sent.messages[0].content.filter((c) => c.type === 'text').map((c) => c.text).join('\n') : '';
  t('the AI is sent the page as images (whole + 4 quadrants) and the exact PDF text', imgs === 5 && txt.includes('1+950') && txt.includes('PIPE INVERT') && sent.tools?.[0]?.name === 'record_evidence', `${imgs} images`);
  t('the extraction prompt states the units and the box convention', sent?.system?.includes('chainage_m') && sent?.system?.includes('fractions of the WHOLE page'));
  const boxes = await p.locator('.page-view .ev-box').count();
  t('review: items drawn as boxes on the page', boxes === answer.items.length, `${boxes} boxes`);
  // select an item: its box is highlighted
  await p.locator('.ev-row', { hasText: 'chainage_m = 1950' }).click();
  t('selecting an item highlights its box', await p.locator('.ev-box.sel').count() === 1);
  // reject the low-confidence washout, accept the rest
  await p.locator('.ev-row', { hasText: 'chainage_m = 3800; diameter_mm = 150' }).locator('button[aria-label=Reject]').click();
  await p.getByText('Accept all with confidence ≥ 70 %').click();
  const acc = await p.locator('.ev-row.accepted').count(), rej = await p.locator('.ev-row.rejected').count();
  t('accept the confident items, reject one', acc === answer.items.length - 1 + 4 && rej === 1, `${acc} accepted, ${rej} rejected`);
  // edit one value
  await p.locator('.ev-row', { hasText: 'chainage_m = 1950' }).locator('button[aria-label=Edit]').click();
  await p.locator('.ev-edit textarea').fill('chainage_m = 1960; diameter_mm = 150; kind = double');
  await p.locator('.ev-edit').getByText('Save').click();
  t('edit a value in place', await p.locator('.ev-row', { hasText: 'chainage_m = 1960' }).count() === 1);
  if (shots) await p.screenshot({ path: `${shots}/intake-2-review.png` });

  // missing data
  await p.locator('.intake-next').click();
  await p.waitForSelector('.intake-gaps');
  const gaps = await p.locator('.gap').count();
  t('only the pump inertia is asked for (everything else came from the documents)', gaps === 1 && (await p.locator('.gap').first().textContent()).includes('inertia'), `${gaps} questions`);
  await p.locator('.gap .gap-num input').fill('9.5');
  if (shots) await p.screenshot({ path: `${shots}/intake-3-missing.png` });

  // build and check
  await p.locator('.intake-next').click();
  await p.waitForSelector('.intake-build');
  const trace = await p.locator('table.trace').textContent();
  t('basis traced: long section and flow from the drawing, inertia from the engineer', trace.includes('long-section.pdf, page 1') && trace.includes('320 L/s') && trace.includes('9.5 kg·m²') && trace.includes('entered by the engineer'));
  await p.getByRole('button', { name: 'Build the model' }).click();
  await p.waitForSelector('.verify', { timeout: 15000 });
  const ver = await p.locator('.vrow').allTextContents();
  t('model checked against the documents (flow within 10 %, the data-sheet pump curve agrees with the duty point, the high point above the tank level flagged)', ver.length === 5 && ver[0].startsWith('✓') && ver[1].startsWith('!') && ver[1].includes('CH2600') && ver.some((v) => v.startsWith('✓Pump curve')), ver.map((v) => v.slice(0, 60)).join(' | '));
  if (shots) await p.screenshot({ path: `${shots}/intake-4-build.png` });

  // protection
  await p.locator('.intake-next').click();
  await p.waitForSelector('.intake-protect table.grid-table tbody tr', { timeout: 20000 });
  const rows = await p.locator('.intake-protect tbody tr').count();
  t('air valve plan proposed and drawn on the long section', rows >= 5 && await p.locator('.ls-av.plan').count() >= 4, `${rows} locations`);
  await p.getByRole('button', { name: 'Test the plan in surge runs' }).click();
  await p.waitForSelector('.test-cmp', { timeout: 60000 });
  const cmp = await p.locator('.test-cmp').textContent();
  t('plan tested in surge runs: before and after shown', /Without the new air valves.*m.*With the plan/s.test(cmp), cmp.replace(/\s+/g, ' ').slice(0, 160));
  if (shots) await p.screenshot({ path: `${shots}/intake-5-protection.png` });
  await p.getByRole('button', { name: 'Open the model with the tested plan' }).click();
  await p.waitForSelector('.intake', { state: 'detached', timeout: 5000 });
  await p.waitForFunction(() => !document.querySelector('.run-screen'), null, { timeout: 30000 });
  await p.waitForTimeout(800);
  const status = await p.locator('.statusbar').textContent();
  t('model opened in the workspace and run', /PS-D|pipes/.test(status) && await p.locator('.toast').count() >= 0, status.slice(0, 120));
  // the session stays: reopening shows the same documents
  await p.locator('.menu-btn', { hasText: /^AI$/ }).click();
  await p.locator('.menu-item', { hasText: 'Model from documents…' }).first().click();
  await p.waitForSelector('.intake');
  t('the documents session is kept while the app is open', await p.locator('.intake .istep.on').textContent() === '4Build and check');
  if (shots) { await p.locator('.intake .istep').first().click(); await p.screenshot({ path: `${shots}/intake-6-reopen.png` }); }
  t('no page errors', errs.length === 0, errs.join(' | ').slice(0, 300));
  await b.close();
} catch (e) {
  console.log('FAIL', e.message); fail++;
} finally {
  srv.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
