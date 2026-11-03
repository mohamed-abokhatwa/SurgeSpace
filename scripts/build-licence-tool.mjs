// Builds tools/licence-tool.html: one self-contained file that works offline.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'fs';
const r = await build({ entryPoints: ['tools/licence-tool/main.ts'], bundle: true, format: 'iife', minify: true, write: false, target: 'es2022' });
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync('tools/licence-tool/template.html', 'utf8').replace('/*APP*/', () => js);
writeFileSync('tools/licence-tool.html', html);
console.log(`tools/licence-tool.html ${(html.length / 1024).toFixed(0)} KB`);
