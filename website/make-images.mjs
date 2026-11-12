// Renders the favicons and the social card (og-card.jpg, 1200×630) with the site's own fonts and colours.
// Uses the repository's Playwright:  cd website && node make-images.mjs
// The outputs are committed in src/assets/img and src/root; run again only when the brand or the hero changes.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(here, '..', 'package.json'))('playwright');
const a = (p) => 'file://' + join(here, 'src', 'assets', p);
const svg = readFileSync(join(here, 'src', 'assets', 'img', 'favicon.svg'), 'utf8');

const b = await chromium.launch();
// icons
for (const [size, out] of [[32, 'assets/img/favicon-32.png'], [180, 'assets/img/apple-touch-icon.png'], [48, 'assets/_fav48.png']]) {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  const pad = size >= 180 ? 14 : 0;
  await p.setContent(`<html><body style="margin:0;background:${size >= 180 ? '#050A13' : 'transparent'};display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px">${svg.replace('<svg ', `<svg width="${size - 2 * pad}" height="${size - 2 * pad}" `)}</body></html>`);
  await p.screenshot({ path: join(here, 'src', out), omitBackground: size < 180 });
  await p.close();
}
// favicon.ico (ImageMagick)
execFileSync('convert', [join(here, 'src/assets/_fav48.png'), '-define', 'icon:auto-resize=48,32,16', join(here, 'src/root/favicon.ico')]);
rmSync(join(here, 'src/assets/_fav48.png'));
// social card
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
const tmp = join(here, 'src', 'assets', '_card.html');
writeFileSync(tmp, `<!doctype html><html><head><style>
@font-face{font-family:C;src:url(${a('fonts/cormorant-garamond-latin-wght-normal.woff2')})}
@font-face{font-family:C;font-style:italic;src:url(${a('fonts/cormorant-garamond-latin-wght-italic.woff2')})}
@font-face{font-family:J;src:url(${a('fonts/jost-latin-wght-normal.woff2')})}
body{margin:0;width:1200px;height:630px;overflow:hidden;font-family:J;color:#F1EEE6;
  background:radial-gradient(900px 520px at 8% -10%,rgba(28,66,124,.75),rgba(0,0,0,0) 60%),radial-gradient(700px 420px at 105% 0%,rgba(255,138,51,.12),rgba(0,0,0,0) 55%),#050A13}
.f{position:absolute;inset:26px;border:1px solid rgba(210,184,121,.28);border-radius:26px}
.l{position:absolute;left:72px;top:70px;width:560px}
.m{display:flex;align-items:center;gap:16px}
.m svg{width:62px;height:62px}
.m small{display:block;font-size:12px;letter-spacing:.3em;color:#D2B879}
.m b{display:block;font-family:C;font-weight:600;font-size:36px;line-height:1.05}
h1{font-family:C;font-weight:500;font-size:64px;line-height:1.02;margin:54px 0 0}
h1 em{font-style:italic;background:linear-gradient(135deg,#F6E9C4,#D9BF84 30%,#A98A4F 55%,#E7D3A0 78%,#BFA064);-webkit-background-clip:text;color:transparent}
p{font-size:21px;line-height:1.5;color:#C3CAD6;margin:24px 0 0}
.e{position:absolute;left:72px;bottom:66px;font-size:13px;letter-spacing:.26em;text-transform:uppercase;color:#D2B879;display:flex;align-items:center;gap:12px}
.e:before{content:"";width:6px;height:6px;background:#D2B879;transform:rotate(45deg)}
.s{position:absolute;right:-60px;top:110px;width:600px;border-radius:14px;padding:1px;background:linear-gradient(180deg,rgba(210,184,121,.6),rgba(210,184,121,.15));box-shadow:0 40px 80px rgba(0,0,0,.8)}
.s img{display:block;width:100%;border-radius:13px}
</style></head><body><div class="f"></div>
<div class="l"><div class="m">${svg}<span><small>ENGSPACE</small><b>SurgeSpace</b></span></div>
<h1>See every pressure wave <em>before</em> your pipeline does.</h1>
<p>Water hammer and surge analysis — with an AI that builds the model from your drawings.</p></div>
<div class="e">surgespace.engspace.app</div>
<div class="s"><img src="${a('shots/02-network-surge-1600.webp')}"></div>
</body></html>`);
await p.goto('file://' + tmp, { waitUntil: 'load' });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(300);
await p.screenshot({ path: join(here, 'src', 'assets', 'img', 'og-card.jpg'), type: 'jpeg', quality: 88 });
rmSync(tmp);
await b.close();
console.log('images written');
