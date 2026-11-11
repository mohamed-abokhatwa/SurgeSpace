// Run every tests/*.test.ts (new test files are picked up automatically). Exit 1 if any fails.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = readdirSync(new URL('../tests', import.meta.url)).filter((f) => f.endsWith('.test.ts')).sort();
let bad = 0;
for (const f of files) {
  const t0 = Date.now();
  const r = spawnSync('npx', ['tsx', `tests/${f}`], { encoding: 'utf8', shell: process.platform === 'win32' });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  const summary = out.trim().split('\n').filter((l) => /passed, \d+ failed/.test(l)).pop() ?? '(no summary)';
  const ok = r.status === 0 && / 0 failed/.test(summary);
  if (!ok) { bad++; console.log(out.split('\n').filter((l) => l.startsWith('FAIL') || /Error/.test(l)).slice(0, 20).join('\n')); }
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${f.padEnd(24)} ${summary}  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
console.log(`\n${files.length - bad} of ${files.length} test files passed`);
process.exit(bad ? 1 : 0);
