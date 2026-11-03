// Compares SurgeSpace's steady state with EPANET 2.2 (via WNTR) on real networks.
// Demands and pump on/off states are taken from EPANET's own t = 0 solution, so the comparison isolates the solver.
import { readFileSync } from 'fs';
import { parseInp } from '../src/engine/inp';
import { solveSteady } from '../src/engine/steady';
import { G, area } from '../src/engine/types';

const LIB = '/tmp/tsvenv/lib/python3.13/site-packages/wntr/library/networks/';
const ref = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const name of ['Net3', 'ky4', 'Net6']) {
  const r = ref[name];
  const { network: net } = parseInp(readFileSync(LIB + name + '.inp', 'utf8'), name);
  for (const n of net.nodes) if (n.kind === 'junction') n.demand = r.demand[n.id] ?? 0;
  for (const p of net.pumps) p.on = r.status[p.id] !== 0;
  for (const p of net.pipes) if (r.status[p.id] === 0) p.closed = true;
  // PRVs: EPANET decides their setting; hold the loss EPANET found (equivalent at t = 0)
  for (const v of net.valves) {
    const q = Math.abs(r.flow[v.id] ?? 0);
    const dh = Math.abs((r.head[v.from] ?? 0) - (r.head[v.to] ?? 0));
    const A = area(v.diameter);
    if (q > 1e-6) { v.k0 = Math.max((dh * 2 * G * A * A) / (q * q), 1e-3); v.opening = 1; } else v.opening = 0;
  }
  const t0 = performance.now();
  const st = solveSteady(net);
  const ms = performance.now() - t0;
  const diffs: { id: string; d: number }[] = [];
  for (const n of net.nodes) {
    if (n.kind === 'reservoir') continue;
    const e = r.head[n.id];
    if (e === undefined) continue;
    diffs.push({ id: n.id, d: st.heads.get(n.id)! - e });
  }
  const abs = diffs.map((x) => Math.abs(x.d)).sort((a, b) => a - b);
  const mean = abs.reduce((s, v) => s + v, 0) / abs.length;
  const p95 = abs[Math.floor(abs.length * 0.95)];
  const worst = diffs.reduce((w, x) => (Math.abs(x.d) > Math.abs(w.d) ? x : w), diffs[0]);
  // flows in pipes
  const qd = net.pipes.filter((p) => !p.closed).map((p) => Math.abs((st.flows.get(p.id) ?? 0) - (r.flow[p.id] ?? 0)));
  const qref = net.pipes.filter((p) => !p.closed).map((p) => Math.abs(r.flow[p.id] ?? 0));
  const qRel = qd.reduce((s, v) => s + v, 0) / Math.max(qref.reduce((s, v) => s + v, 0), 1e-9);
  console.log(`${name}: ${diffs.length} junctions, ${net.pipes.length} pipes, ${net.pumps.length} pumps — converged ${st.converged} in ${st.iterations} it, ${ms.toFixed(0)} ms`);
  console.log(`   head difference vs EPANET: mean ${mean.toFixed(3)} m, 95th pct ${p95.toFixed(3)} m, worst ${worst.d.toFixed(3)} m at ${worst.id}; flow difference ${(qRel * 100).toFixed(2)} % of total`);
}
