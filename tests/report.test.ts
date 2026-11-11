// Report generation: every example produces a complete report whose key numbers match the results.
import { designChecks } from '../src/engine/analysis';
import { EXAMPLES } from '../src/engine/cases';
import { runTransient } from '../src/engine/transient';
import { solveSteady } from '../src/engine/steady';
import { buildReport } from '../src/report/report';
import { writeFileSync } from 'node:fs';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };
const out = process.argv[2];
for (const ex of EXAMPLES) {
  const net = ex.make();
  net.report = { projectNo: 'P-001', client: 'Test <client> & co', preparedBy: 'A. Engineer' };
  const r = runTransient(net, { frames: 400 });
  const checks = designChecks(net, r);
  const html = buildReport(net, r, checks, { version: 'test' });
  const sections = ['1. Summary of findings', '2. Model and method', '3. Input data', '4. Results by node', '5. Results by pipe', '7. Design checks', '8. Time histories'];
  const missing = sections.filter((s) => !html.includes(s));
  // highest pressure in the report = highest pressure in the envelopes
  let pMax = -Infinity;
  for (const e of r.envelopes) for (let i = 0; i < e.s.length; i++) pMax = Math.max(pMax, e.hMax[i] - e.z[i]);
  const every = net.pipes.every((p) => html.includes(`<td>${p.id}</td>`)) && net.nodes.every((n) => html.includes(`<td>${n.id}</td>`));
  t(`${ex.id}: report complete (${(html.length / 1024).toFixed(0)} kB)`, !missing.length && html.includes(`Highest pressure</td><td>${pMax.toFixed(1)} m`) && every && html.includes('Test &lt;client&gt; &amp; co') && !html.includes('NaN') && !html.includes('undefined'), missing.join(', '));
  if (out && ex.id === EXAMPLES[1].id) writeFileSync(out, html);
}
{
  // Arabic edition: right to left, headings and table headers in Arabic, numbers unchanged
  const net = EXAMPLES[0].make();
  const r = runTransient(net, { steady: solveSteady(net), frames: 100 });
  const en = buildReport(net, r, designChecks(net, r), { version: 't', lang: 'en' });
  const ar = buildReport(net, r, designChecks(net, r), { version: 't', lang: 'ar' });
  const nums = (h: string) => (h.match(/<td>[^<]*?\d+\.\d+/g) ?? []).length;
  t('Arabic report: RTL, Arabic headings, same numbers', ar.includes('dir="rtl"') && ar.includes('١. ملخص النتائج') && ar.includes('أعلى ضغط') && !/<th>(Pipe|Node|From|To)<\/th>/.test(ar) && nums(ar) === nums(en));
}
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
