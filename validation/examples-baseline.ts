// Results baseline for every built-in example: steady heads, surge envelopes, device extremes, and the daily run of
// the town example. Any engine change that moves a result by more than the tolerance fails here, so changes to the
// numbers are always deliberate.  Update after an intended change:  npx tsx validation/examples-baseline.ts --update
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { EXAMPLES } from '../src/engine/cases';
import { solveSteady } from '../src/engine/steady';
import { runTransient } from '../src/engine/transient';
import { runEPS } from '../src/engine/eps';

const FILE = new URL('./data/examples-baseline.json', import.meta.url);
const TOL = 1e-3; // m (heads) and relative 1e-4 for flows / volumes
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
type Rec = Record<string, number>;
const out: Record<string, Rec> = {};
for (const ex of EXAMPLES) {
  const net = ex.make();
  const t0 = performance.now();
  const st = solveSteady(net);
  const rec: Rec = {};
  for (const [id, h] of st.heads) rec[`steady.head.${id}`] = r4(h);
  for (const [id, q] of st.flows) rec[`steady.flow.${id}`] = r4(q * 1000);
  if (net.event.kind !== 'none' || (net.extraEvents ?? []).length) {
    const r = runTransient(net, { steady: st });
    for (const e of r.envelopes) { rec[`env.max.${e.id}`] = r4(Math.max(...Array.from(e.hMax))); rec[`env.min.${e.id}`] = r4(Math.min(...Array.from(e.hMin))); }
    for (const [id, v] of Object.entries(r.vessels)) { rec[`vessel.maxGas.${id}`] = r4(v.maxGas); rec[`vessel.minGas.${id}`] = r4(v.minGas); }
    for (const [id, v] of Object.entries(r.tanks)) { rec[`tank.max.${id}`] = r4(v.maxLevel); rec[`tank.min.${id}`] = r4(v.minLevel); }
    for (const [id, v] of Object.entries(r.pumps)) rec[`pump.minSpeed.${id}`] = r4(Math.min(...Array.from(v.speed)));
  }
  if (net.eps || net.patterns?.length) {
    const e = runEPS(net);
    for (const [id, lv] of Object.entries(e.level)) { rec[`eps.levelMax.${id}`] = r4(Math.max(...lv)); rec[`eps.levelMin.${id}`] = r4(Math.min(...lv)); }
    const p = Object.values(e.pressure).flatMap((a) => Array.from(a as ArrayLike<number>));
    rec['eps.pMin'] = r4(Math.min(...p)); rec['eps.pMax'] = r4(Math.max(...p));
  }
  out[ex.id] = rec;
  console.log(`${ex.id.padEnd(12)} ${Object.keys(rec).length} values, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}
if (process.argv.includes('--update') || !existsSync(FILE)) {
  writeFileSync(FILE, JSON.stringify(out, null, 1));
  console.log('baseline written');
  process.exit(0);
}
const base = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, Rec>;
let bad = 0, n = 0;
for (const [ex, rec] of Object.entries(base)) {
  for (const [k, v] of Object.entries(rec)) {
    n++;
    const now = out[ex]?.[k];
    const tol = k.includes('flow') || k.includes('Gas') ? Math.max(TOL, Math.abs(v) * 1e-4) : TOL;
    if (now === undefined || !(Math.abs(now - v) <= tol)) { bad++; if (bad <= 25) console.log(`CHANGED ${ex} ${k}: ${v} → ${now}`); }
  }
  for (const k of Object.keys(out[ex] ?? {})) if (!(k in rec)) { bad++; if (bad <= 25) console.log(`NEW ${ex} ${k}`); }
}
console.log(bad ? `\n${bad} of ${n} baseline values changed` : `\nall ${n} baseline values unchanged`);
process.exit(bad ? 1 : 0);
