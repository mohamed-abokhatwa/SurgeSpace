// Control valves (PRV, PSV, FCV) in the steady state against EPANET 2.2 (run through WNTR).
//   npx tsx validation/control-valves-vs-epanet.ts
// Reference: validation/data/control-valves.epanet.json, made from validation/data/control-valves.inp with
//   wntr.sim.EpanetSimulator (heads and flows at time 0).
import { readFileSync } from 'node:fs';
import { parseInp } from '../src/engine/inp';
import { solveSteady } from '../src/engine/steady';

const dir = new URL('./data/', import.meta.url);
const net = parseInp(readFileSync(new URL('control-valves.inp', dir), 'utf8')).network;
const ref = JSON.parse(readFileSync(new URL('control-valves.epanet.json', dir), 'utf8')) as { head: Record<string, number>; flow: Record<string, number> };
const r = solveSteady(net);
let worstH = 0, worstQ = 0;
console.log('node   SurgeSpace   EPANET   diff (m)');
for (const [id, h] of Object.entries(ref.head)) {
  const d = r.heads.get(id)! - h;
  worstH = Math.max(worstH, Math.abs(d));
  console.log(`${id.padEnd(5)} ${r.heads.get(id)!.toFixed(4).padStart(10)} ${h.toFixed(4).padStart(9)} ${d.toFixed(4).padStart(9)}`);
}
for (const [id, q] of Object.entries(ref.flow)) worstQ = Math.max(worstQ, Math.abs((r.flows.get(id) ?? 0) - q));
for (const v of net.valves) console.log(`${v.id} ${v.control?.type}: opening ${(r.openings.get(v.id)! * 100).toFixed(2)} % of full area`);
console.log(`worst head difference ${worstH.toFixed(4)} m, worst flow difference ${(worstQ * 1000).toFixed(4)} L/s`);
console.log(r.warnings.join('\n'));
if (worstH > 0.02 || worstQ > 1e-4) process.exit(1);
