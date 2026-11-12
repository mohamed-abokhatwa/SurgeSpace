# surgespace.engspace.app

The SurgeSpace website. Same design concept as engspace.app (Cormorant Garamond and Jost, champagne-gold foil,
cut-diamond ornaments) on SurgeSpace's navy with the orange surge accent.

- `src/pages/*.html` — page bodies; the first line is a JSON header (title, description, nav). `{{p}}` is the path
  prefix, `{{store}}` the Microsoft Store link, `{{version}}` the app version from `../package.json`.
- `src/assets/` — `site.css`, `site.js`, `hero.js` (the live method-of-characteristics trace on the home page),
  fonts (OFL), screenshots (`shots/`, WebP made from `store/images/v3`), icons and the social card.
- `build.mjs` — wraps every page in the shared masthead and footer, turns `../docs` (manual, tutorials, theory, API)
  into pages, writes `sitemap.xml`, `robots.txt` and `CNAME` into `dist/`.
- `check.mjs` — every link and asset resolves, no page errors, no sideways scroll on a phone, the hero runs
  (in CI, `tests.yml` ui job).
- `make-images.mjs` — favicons and `og-card.jpg`.

```
cd website && npm ci && node build.mjs && node check.mjs
```

Publishing: `.github/workflows/pages.yml` deploys `dist/` with GitHub Pages on every push to `main` that touches the
site or the docs. DNS: Cloudflare record `CNAME surgespace → mohamed-abokhatwa.github.io` (proxied), SSL mode Full.
