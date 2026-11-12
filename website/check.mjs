// Checks the built site: every internal link and asset resolves, no page errors, no horizontal scroll on a phone,
// the hero trace runs. Run after the build:  node build.mjs && node check.mjs  [SHOTS=folder for screenshots]
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const req = createRequire(join(here, '..', 'package.json'));
const { chromium } = req('playwright');
const shots = process.env.SHOTS;
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain', '.ico': 'image/x-icon' };
const srv = createServer((q, r) => {
  let p = decodeURIComponent(new URL(q.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = normalize(join(dist, p));
  if (!f.startsWith(dist) || !existsSync(f) || statSync(f).isDirectory()) { r.writeHead(404, { 'content-type': 'text/html' }); r.end(readFileSync(join(dist, '404.html'))); return; }
  r.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream' }); r.end(readFileSync(f));
}).listen(4411);

let pass = 0, fail = 0;
const t = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };
const pages = [];
const walk = (d, rel = '') => readdirSync(d).forEach((f) => { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== 'assets') walk(p, rel + f + '/'); } else if (f.endsWith('.html')) pages.push(rel + f); });
walk(dist);

// static link check
const missing = [];
for (const pg of pages) {
  const html = readFileSync(join(dist, pg), 'utf8');
  const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g), ...html.matchAll(/srcset="([^"]+)"/g)].flatMap((m) => m[0].startsWith('srcset') ? m[1].split(',').map((s) => s.trim().split(' ')[0]) : [m[1]]);
  for (const r of refs) {
    if (/^(https?:|mailto:|data:|#|tel:)/.test(r)) continue;
    const [path, hash] = r.split('#');
    const base = path.startsWith('/') ? dist : join(dist, dirname(pg));
    const f = join(base, path.split('?')[0]);
    if (!existsSync(f)) { missing.push(`${pg} → ${r}`); continue; }
    if (hash && f.endsWith('.html') && !readFileSync(f, 'utf8').includes(`id="${hash}"`)) missing.push(`${pg} → ${r} (no #${hash})`);
  }
  for (const m of html.matchAll(/href="#([^"]+)"/g)) if (!html.includes(`id="${m[1]}"`)) missing.push(`${pg} → #${m[1]}`);
}
t(`every internal link and asset resolves (${pages.length} pages)`, missing.length === 0, missing.slice(0, 8).join(' | '));
t('no leftover template markers', pages.every((p) => !/\{\{\w+\}\}/.test(readFileSync(join(dist, p), 'utf8'))));
t('the forbidden product name never appears', pages.every((p) => !/hammer(?!\s)|\bHAMMER\b/.test(readFileSync(join(dist, p), 'utf8').replace(/water hammer/gi, ''))));

const b = await chromium.launch();
for (const [label, opts] of [['desktop', { viewport: { width: 1440, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]]) {
  const ctx = await b.newContext(opts);
  for (const pg of pages) {
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    p.on('requestfailed', (r) => errs.push('failed ' + r.url()));
    const res = await p.goto(`http://localhost:4411/${pg}`, { waitUntil: 'networkidle' });
    await p.evaluate(() => document.querySelectorAll('.reveal').forEach((e) => e.classList.add('in')));
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const ok = (res.status() === 200 || pg === '404.html') && errs.length === 0 && over <= 0;
    t(`${label} ${pg}`, ok, [errs.join(' | ').slice(0, 200), over > 0 ? `horizontal scroll ${over}px` : ''].filter(Boolean).join(' '));
    if (pg === 'index.html') {
      await p.locator('#trace').scrollIntoViewIfNeeded();
      await p.waitForTimeout(1500);
      const tt = await p.locator('#trace-t').textContent();
      t(`${label} hero trace runs`, /t = ([1-9]|1\d)\.\d s/.test(tt), tt);
    }
    if (shots && ['index.html', 'features.html', 'plans.html', 'download.html', 'docs/theory.html', 'ai.html', 'proven.html'].includes(pg)) {
      await p.screenshot({ path: `${shots}/${label}-${pg.replace('/', '-').replace('.html', '')}.png`, fullPage: label === 'phone' ? false : false });
    }
    await p.close();
  }
  await ctx.close();
}
// the menu opens and the tabs switch
{
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto('http://localhost:4411/index.html');
  await p.locator('#t-ai').click();
  t('showcase tabs switch', await p.locator('#p-ai').isVisible() && !(await p.locator('#p-surge').isVisible()));
  await p.locator('#p-ai img').click();
  t('screenshots open full size', await p.locator('.lb.on').isVisible());
  await p.keyboard.press('Escape');
  await p.locator('#menubtn').click();
  t('menu opens', await p.locator('#mmenu').isVisible());
  await p.close();
}
await b.close();
srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
