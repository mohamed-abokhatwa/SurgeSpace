// Records (or compares against) the results of every built-in example: node max/min heads, vessel gas range,
// air valve air volume. Used to prove that engine changes leave existing models unchanged.
// Usage: npx tsx validation/baseline.ts save <file> | npx tsx validation/baseline.ts compare <file>
import { readFileSync, writeFileSync } from 'fs';
import { EXAMPLES } from '../src/engine/cases';
import { runTransient } from '../src/engine/transient';

const [mode, file] = process.argv.slice(2);
const out: Record<string, Record<string, number>> = {};
for (const ex of EXAMPLES) {
  const net = ex.make();
  if (ex.id === 'bwsn1') net.settings.duration = 6;
  const r = runTransient(net, { frames: 50 });
  const rec: Record<string, number> = {};
  for (const id in r.nodeMax) { rec[`max:${id}`] = r.nodeMax[id]; rec[`min:${id}`] = r.nodeMin[id]; }
  for (const id in r.vessels) { rec[`gasMin:${id}`] = r.vessels[id].minGas; rec[`gasMax:${id}`] = r.vessels[id].maxGas; }
  for (const id in r.airValves) rec[`air:${id}`] = r.airValves[id].maxAir;
  out[ex.id] = rec;
}
if (mode === 'save') { writeFileSync(file, JSON.stringify(out)); console.log('saved', Object.keys(out).join(', ')); }
else {
  const base = JSON.parse(readFileSync(file, 'utf8'));
  let worst = 0, where = '', n = 0;
  for (const ex in base) for (const k in base[ex]) {
    const a = base[ex][k], b = out[ex]?.[k];
    const d = Math.abs((b ?? NaN) - a);
    n++;
    if (!(d <= worst)) { worst = d; where = `${ex} ${k}: ${a} → ${b}`; }
  }
  console.log(`${n} values compared; largest difference ${worst.toExponential(2)} (${where || 'none'})`);
  process.exit(worst < 1e-9 ? 0 : 1);
}
