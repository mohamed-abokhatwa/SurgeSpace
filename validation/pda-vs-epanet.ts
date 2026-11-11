// Emitters (leakage) and pressure-driven demand against EPANET 2.2 (through WNTR), over Net1's 24-hour run.
//   npx tsx validation/pda-vs-epanet.ts      references: validation/data/Net1emit.json, Net1pda.json
import { readFileSync } from 'node:fs';
import { parseInp } from '../src/engine/inp';
import { runEPS } from '../src/engine/eps';

const dir = new URL('./data/', import.meta.url);
type Ref = { times: number[]; head: Record<string, number[]>; demand: Record<string, number[]>; flow: Record<string, number[]> };
export function comparePDA(name: string) {
  const net = parseInp(readFileSync(new URL(`${name}.inp`, dir), 'utf8')).network;
  net.eps = { ...net.eps!, quality: 'none' };
  const ref = JSON.parse(readFileSync(new URL(`${name}.json`, dir), 'utf8')) as Ref;
  const r = runEPS(net);
  let dH = 0, dD = 0, dQ = 0, worst = '';
  const tanks = new Set(net.nodes.filter((n) => n.storage || n.kind === 'reservoir').map((n) => n.id));
  ref.times.forEach((t, k) => {
    const i = r.times.findIndex((x) => Math.abs(x - t) < 1);
    if (i < 0) return;
    for (const [id, v] of Object.entries(ref.head)) { const d = Math.abs(r.head[id][i] - v[k]); if (d > dH) { dH = d; worst = `${id} at ${t / 3600} h`; } }
    for (const [id, v] of Object.entries(ref.demand)) if (!tanks.has(id)) dD = Math.max(dD, Math.abs(r.demand[id][i] - v[k]));
    for (const [id, v] of Object.entries(ref.flow)) if (r.flow[id]) dQ = Math.max(dQ, Math.abs(r.flow[id][i] - v[k]));
  });
  const totRef = ref.times.map((_, k) => Object.entries(ref.demand).filter(([id]) => !tanks.has(id)).reduce((s, [, v]) => s + v[k], 0));
  return { dH, dD: dD * 1000, dQ: dQ * 1000, worst, meanDemand: (totRef.reduce((a, b) => a + b, 0) / totRef.length) * 1000 };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  for (const n of ['Net1emit', 'Net1pda']) {
    const c = comparePDA(n);
    console.log(`${n}: heads within ${c.dH.toFixed(4)} m (worst ${c.worst}), demands within ${c.dD.toFixed(3)} L/s (mean total ${c.meanDemand.toFixed(1)} L/s), flows within ${c.dQ.toFixed(3)} L/s`);
  }
}
