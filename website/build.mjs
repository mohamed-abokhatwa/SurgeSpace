// Builds surgespace.engspace.app into website/dist.
//   cd website && npm ci && node build.mjs
// Pages are fragments in src/pages (a JSON header in the first comment, then the body). The manuals come
// straight from ../docs, so the site and the repository never disagree. Screenshots are made by
// scripts/store-shots.mjs and resized into src/assets/shots.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, cpSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { marked } from 'marked';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, 'src'), out = join(here, 'dist'), docsDir = join(here, '..', 'docs');
const SITE = 'https://surgespace.engspace.app';
const STORE = 'https://apps.microsoft.com/detail/9NFRBFGTQBSK';
const VERSION = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version;

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(src, 'assets'), join(out, 'assets'), { recursive: true });
cpSync(join(src, 'root'), out, { recursive: true });
const hash = (f) => createHash('sha256').update(readFileSync(join(src, 'assets', f))).digest('hex').slice(0, 8);
const V = { css: hash('site.css'), js: hash('site.js'), hero: hash('hero.js') };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const crest = (s) => `<span class="crest"${s ? ` style="--s:${s}px"` : ''} aria-hidden="true"><span><svg viewBox="0 0 26 26"><path d="M2 15h4.5l2.6-10 4 16 2.6-9.5 2 3.5H24"/></svg></span></span>`;
const mark = (tag = 'a') => `<${tag} class="mark"${tag === 'a' ? ' href="index.html" aria-label="SurgeSpace home"' : ''}>${crest()}<span class="mname"><small>EngSpace</small><span>SurgeSpace</span></span></${tag}>`;

const NAV = [['features', 'features.html', 'Features'], ['ai', 'ai.html', 'From drawings'], ['proven', 'proven.html', 'Proven'], ['plans', 'plans.html', 'Plans'], ['docs', 'docs.html', 'Docs']];
const MENU = [
  ['Product', [['features.html', 'Features', 'every element, both engines, the protection'], ['ai.html', 'Model from your drawings', 'and the AI copilot, with your own account'], ['download.html', 'Download for Windows', 'Microsoft Store · what is new in 3.0'], ['plans.html', 'Plans', 'Free, evaluation, licensed']]],
  ['Engineering', [['proven.html', 'Proven', 'checked against EPANET, benchmarks, theory'], ['docs/theory.html', 'Theory and validation', 'the methods behind every number'], ['docs/manual.html', 'User manual', ''], ['docs/tutorials.html', 'Tutorials', '']]],
  ['Help', [['support.html', 'Support', 'questions, licences, a new computer'], ['docs/api.html', 'Command API', 'automation and the copilot commands'], ['privacy.html', 'Privacy', 'your models stay on your computer']]],
  ['Engineering Workspace', [['https://engspace.app', 'engspace.app', 'the company behind SurgeSpace'], ['mailto:support@engspace.app', 'support@engspace.app', ''], ['#', 'WhatsApp · the founder', '', 'data-wa hidden']]],
];

function shell({ title, description, nav = '', body, path, prefix = '', heroJs = false, ogImage = 'assets/img/og-card.jpg', noindex = false }) {
  const p = prefix; // '' for root pages, '../' for docs pages
  const fix = (h) => (/^(https?:|mailto:|#)/.test(h) ? h : p + h);
  const navLinks = NAV.map(([k, h, t]) => `<a href="${fix(h)}"${k === nav ? ' class="on" aria-current="page"' : ''}>${t}</a>`).join('');
  const menu = MENU.map(([b, items]) => `<div class="mm-col"><b>${b}</b>${items.map(([h, t, s, extra]) => `<a href="${fix(h)}"${extra ? ' ' + extra : ''}${/^https?:/.test(h) ? ' target="_blank" rel="noopener"' : ''}>${t}${s ? `<small>${s}</small>` : ''}</a>`).join('')}</div>`).join('');
  const url = SITE + '/' + (path === 'index.html' ? '' : path);
  const fullTitle = title.includes('SurgeSpace') ? title : `${title} · SurgeSpace`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#050A13">
<script>document.documentElement.className+=' js'</script>
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? '<meta name="robots" content="noindex">\n' : ''}<link rel="canonical" href="${url}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${SITE}/${ogImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:type" content="website">
<meta property="og:site_name" content="SurgeSpace · Engineering Workspace">
<meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${SITE}/${ogImage}">
<link rel="icon" type="image/svg+xml" href="${p}assets/img/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="${p}assets/img/favicon-32.png">
<link rel="apple-touch-icon" href="${p}assets/img/apple-touch-icon.png">
<link rel="preload" href="${p}assets/fonts/cormorant-garamond-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${p}assets/fonts/jost-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${p}assets/site.css?v=${V.css}">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<nav id="nav" aria-label="Main"><div class="wrap nav-in">
  ${mark().replace('href="index.html"', `href="${p}index.html"`)}
  <div class="nav-links">${navLinks}</div>
  <a class="btn btn-primary btn-sm navtry" href="${p}download.html">Download</a>
  <button class="menubtn" id="menubtn" aria-label="Menu" aria-expanded="false" aria-controls="mmenu"><span></span><span></span><span></span></button>
</div></nav>
<div class="mmenu" id="mmenu"><div class="wrap"><div class="mm-cols">${menu}</div></div></div>
<main id="main">
${body.replaceAll('{{p}}', p).replaceAll('{{store}}', STORE).replaceAll('{{version}}', VERSION)}
</main>
<footer><div class="wrap">
  <div class="f-in">
    <div class="f-brand">
      <span class="mark">${crest(46)}<span class="mname"><small>EngSpace</small><span>SurgeSpace</span></span></span>
      <p>Pressure surge and network analysis for pipelines, pumping stations, hydropower and water networks — with an AI that builds the model from your drawings. Made by Engineering Workspace.</p>
    </div>
    <div class="f-col"><b>Product</b>
      <a class="lead" href="${p}download.html">Download for Windows</a>
      <a href="${p}features.html">Features</a>
      <a href="${p}ai.html">Model from your drawings</a>
      <a href="${p}plans.html">Plans</a>
      <a href="${p}download.html#new">What is new in ${VERSION.replace(/\.0$/, '')}</a>
    </div>
    <div class="f-col"><b>Engineering</b>
      <a href="${p}proven.html">Proven</a>
      <a href="${p}docs/theory.html">Theory and validation</a>
      <a href="${p}docs/manual.html">User manual</a>
      <a href="${p}docs/tutorials.html">Tutorials</a>
      <a href="${p}docs/api.html">Command API</a>
    </div>
    <div class="f-col"><b>Contact</b>
      <a href="mailto:support@engspace.app">support@engspace.app</a>
      <a data-wa hidden>WhatsApp · the founder</a>
      <a href="${p}support.html">Support</a>
      <a href="https://engspace.app" target="_blank" rel="noopener">Engineering Workspace</a>
    </div>
  </div>
  <div class="f-bottom">
    <div>&#169; <span id="yr">2026</span> Engineering Root Solutions (ERS) &#183; CR 7054208009 &#183; Kingdom of Saudi Arabia &#183; all rights reserved. SurgeSpace ${VERSION}.</div>
    <div class="f-legal"><a href="${p}support.html">Support</a><a href="${p}privacy.html">Privacy</a><a href="https://engspace.app" target="_blank" rel="noopener">engspace.app</a></div>
  </div>
</div></footer>
<script src="${p}assets/site.js?v=${V.js}" defer></script>
${heroJs ? `<script src="${p}assets/hero.js?v=${V.hero}" defer></script>\n` : ''}</body>
</html>
`;
}

// ——— the pages ———
const pages = [];
for (const f of readdirSync(join(src, 'pages')).filter((x) => x.endsWith('.html')).sort()) {
  const raw = readFileSync(join(src, 'pages', f), 'utf8');
  const m = /^<!--(\{[\s\S]*?\})-->\n?/.exec(raw);
  if (!m) throw new Error(`${f}: missing the JSON header`);
  const meta = JSON.parse(m[1]);
  writeFileSync(join(out, f), shell({ ...meta, body: raw.slice(m[0].length), path: f }));
  if (!meta.noindex) pages.push(f);
}

// ——— the manuals, from ../docs ———
const DOCS = [
  ['manual', 'USER-MANUAL.md', 'User manual', 'How to use SurgeSpace: the workspace, building a model, elements, surge analysis, daily operation, live data, reports, the AI copilot and automation.'],
  ['tutorials', 'TUTORIALS.md', 'Tutorials', 'Step-by-step SurgeSpace tutorials: a pump trip on a rising main and its protection, a valve closure, daily operation and water quality, and GIS to report with the copilot.'],
  ['theory', 'THEORY-AND-VALIDATION.md', 'Theory and validation', 'The methods behind SurgeSpace (steady state, method of characteristics with column separation, rigid column, extended period) and every validation check.'],
  ['api', 'API.md', 'Command API', 'The SurgeSpace command layer: every command the interface, scripts and the AI copilot use to build, edit, run and read models.'],
];
mkdirSync(join(out, 'docs'), { recursive: true });
const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
for (const [name, file, title, description] of DOCS) {
  const md = readFileSync(join(docsDir, file), 'utf8');
  const toc = [];
  const used = new Set();
  const renderer = new marked.Renderer();
  renderer.heading = function ({ tokens, depth }) {
    const text = this.parser.parseInline(tokens);
    let id = slug(text) || 'section'; while (used.has(id)) id += '-x'; used.add(id);
    if (depth === 2) toc.push([id, text.replace(/<[^>]+>/g, '')]);
    return `<h${depth} id="${id}">${text}${depth > 1 && depth < 4 ? `<a class="anchor" href="#${id}" aria-label="Link to this section">#</a>` : ''}</h${depth}>\n`;
  };
  renderer.link = function ({ href, title: t, tokens }) {
    const text = this.parser.parseInline(tokens);
    // links between the manuals stay on the site; other repository files go to GitHub
    const map = { 'USER-MANUAL.md': 'manual.html', 'TUTORIALS.md': 'tutorials.html', 'THEORY-AND-VALIDATION.md': 'theory.html', 'API.md': 'api.html' };
    let h = href || '';
    const base = h.split('#')[0].split('/').pop();
    if (map[base]) h = map[base] + (h.includes('#') ? '#' + h.split('#')[1] : '');
    else if (!/^(https?:|mailto:|#)/.test(h)) h = 'https://github.com/mohamed-abokhatwa/SurgeSpace/blob/main/' + (h.startsWith('../') ? h.replace(/^(\.\.\/)+/, '') : 'docs/' + h.replace(/^\.\//, ''));
    const ext = /^https?:/.test(h);
    return `<a href="${h}"${t ? ` title="${esc(t)}"` : ''}${ext ? ' target="_blank" rel="noopener"' : ''}>${text}</a>`;
  };
  const html = marked.parse(md, { renderer, gfm: true });
  const tocHtml = toc.length > 1 ? `<aside class="toc" aria-label="On this page"><b>On this page</b>${toc.map(([id, t]) => `<a href="#${id}">${t}</a>`).join('')}</aside>` : '<aside class="toc"></aside>';
  const body = `<header class="phero"><div class="wrap">
  <div class="crumb"><a href="{{p}}index.html">SurgeSpace</a><i></i><a href="{{p}}docs.html">Docs</a><i></i><span>${title}</span></div>
  <h1>${title}</h1>
  <p class="sub">${description}</p>
</div></header>
<section style="padding-top:40px"><div class="wrap doclay">${tocHtml}<article class="prose">${html}</article></div></section>`;
  writeFileSync(join(out, 'docs', name + '.html'), shell({ title, description, nav: 'docs', body, path: `docs/${name}.html`, prefix: '../' }));
  pages.push(`docs/${name}.html`);
}

// ——— sitemap, robots, CNAME ———
const today = new Date().toISOString().slice(0, 10);
writeFileSync(join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((p) => `  <url><loc>${SITE}/${p === 'index.html' ? '' : p}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`);
writeFileSync(join(out, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
writeFileSync(join(out, 'CNAME'), 'surgespace.engspace.app\n');
writeFileSync(join(out, '.nojekyll'), '');

const size = (d) => readdirSync(d).reduce((s, f) => { const p = join(d, f); const st = statSync(p); return s + (st.isDirectory() ? size(p) : st.size); }, 0);
console.log(`built ${pages.length} pages into website/dist (${(size(out) / 1e6).toFixed(2)} MB)`);
