// Compares SurgeSpace transients with TSNet (open-source MOC, Univ. of Texas) on a real EPANET network.
// Both codes run the same .inp file: a gate valve inserted in the busiest main is closed linearly over 2 s.
// TSNet's adjusted wave speeds are used in SurgeSpace too, and friction is held at steady values as TSNet does,
// so any difference comes from the solvers themselves.
// Usage: npx tsx validation/transient-vs-tsnet.ts <name>_valve.inp <name>_tsnet.json
import { readFileSync } from 'fs';
import { parseInp } from '../src/engine/inp';
import { runTransient } from '../src/engine/transient';

const [inpPath, refPath] = process.argv.slice(2);
const ref = JSON.parse(readFileSync(refPath, 'utf8')) as {
  t: number[]; dt: number; pipe: string; wavev: Record<string, number>; f: Record<string, number>; heads: Record<string, number[]>;
  epanet?: { demand: Record<string, number>; head: Record<string, number>; flow: Record<string, number>; status: Record<string, number> };
};
const { network: net } = parseInp(readFileSync(inpPath, 'utf8'), 'ref');
for (const p of net.pipes) p.wavespeed = ref.wavev[p.id] ?? 1200;
// start from EPANET's own t = 0 state (hour-0 demand pattern, controls), as TSNet does
if (ref.epanet) {
  const e = ref.epanet;
  for (const n of net.nodes) {
    if (n.kind === 'junction') n.demand = e.demand[n.id] ?? n.demand;
    else if (e.head[n.id] !== undefined) n.head = e.head[n.id];
  }
  for (const p of net.pumps) p.on = e.status[p.id] !== 0;
  // TSNet pumps have no non-return valve: reverse flow follows the head curve
  if (process.env.NRV !== "1") for (const p of net.pumps) p.checkValve = false;
  for (const p of net.pipes) if (e.status[p.id] === 0) p.closed = true;
}
const v = net.valves.find((x) => x.id === 'VTEST');
if (!v) throw new Error('VTEST valve missing');
v.law = 'gate';
v.k0 = 0.2;
const tEnd = ref.t[ref.t.length - 1];
net.event = { kind: 'valveClose', targets: ['VTEST'], start: 1, duration: 2, exponent: 1, finalOpening: 0 };
net.settings = { ...net.settings, duration: tEnd, unsteadyFriction: false, pressureDependentDemand: true };
const frames = Math.round(tEnd / 0.01);
const t0 = performance.now();
const res = runTransient(net, { constantFriction: true, noCavitation: true, frames });
const ms = performance.now() - t0;
if (!res.ok) throw new Error('run failed');
console.log(`${net.nodes.length} nodes, ${net.pipes.length} pipes, ${net.pumps.length} pumps, ${net.valves.length} valves`);
console.log(`SurgeSpace: dt ${res.dt.toExponential(3)} s, ${res.reaches} reaches, max wave-speed adjustment ${(res.maxAdjust * 100).toFixed(2)} %, ${ms.toFixed(0)} ms`);
console.log(`TSNet:     dt ${ref.dt.toExponential(3)} s`);
if (res.rigidPipes.length) console.log(`rigid pipes: ${res.rigidPipes.length}`);

const interp = (ts: Float64Array, ys: Float32Array, t: number) => {
  if (t <= ts[0]) return ys[0];
  let lo = 0, hi = ts.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ts[m] <= t) lo = m; else hi = m; }
  const w = (t - ts[lo]) / (ts[hi] - ts[lo] || 1);
  return ys[lo] + (ys[hi] - ys[lo]) * w;
};
const rows: string[] = [];
let worstPeak = 0, rmsAll = 0, nAll = 0;
for (const [id, hRef] of Object.entries(ref.heads)) {
  const mine = res.nodeHead[id];
  if (!mine) { rows.push(`${id}: missing in SurgeSpace`); continue; }
  const h0r = hRef[0];
  const h0m = mine[0];
  let amp = 0, se = 0, maxR = -Infinity, maxM = -Infinity, minR = Infinity, minM = Infinity;
  for (let k = 0; k < ref.t.length; k++) {
    const dr = hRef[k] - h0r;
    const dm = interp(res.times, mine, ref.t[k]) - h0m;
    amp = Math.max(amp, Math.abs(dr));
    se += (dm - dr) ** 2;
    maxR = Math.max(maxR, dr); maxM = Math.max(maxM, dm);
    minR = Math.min(minR, dr); minM = Math.min(minM, dm);
  }
  const rms = Math.sqrt(se / ref.t.length);
  const peakErr = Math.max(Math.abs(maxM - maxR), Math.abs(minM - minR));
  worstPeak = Math.max(worstPeak, peakErr / Math.max(amp, 1e-6));
  rmsAll += (rms / Math.max(amp, 1e-6)) ** 2; nAll++;
  rows.push(`${id.padEnd(6)} steady ${h0r.toFixed(2).padStart(7)} vs ${h0m.toFixed(2).padStart(7)} m | rise ${maxR.toFixed(2).padStart(7)} vs ${maxM.toFixed(2).padStart(7)} | drop ${minR.toFixed(2).padStart(7)} vs ${minM.toFixed(2).padStart(7)} | RMS ${rms.toFixed(2)} m (${((rms / amp) * 100).toFixed(1)} % of surge)`);
}
console.log('node   steady head TSNet vs SurgeSpace | surge rise (m) | surge drop (m) | RMS difference over the run');
rows.forEach((r) => console.log(r));
console.log(`worst peak difference ${(worstPeak * 100).toFixed(1)} % of that node's surge; mean RMS ${(Math.sqrt(rmsAll / nAll) * 100).toFixed(1)} %`);
if (process.env.TRACE) {
  const id = process.env.TRACE;
  const hr = ref.heads[id];
  for (let t = Number(process.env.T0 ?? 0); t <= Number(process.env.T1 ?? 8); t += Number(process.env.DT ?? 0.25)) {
    const k = Math.min(ref.t.length - 1, Math.round(t / ref.dt));
    console.log(t.toFixed(2).padStart(5), (hr[k] - hr[0]).toFixed(1).padStart(8), (interp(res.times, res.nodeHead[id], ref.t[k]) - res.nodeHead[id][0]).toFixed(1).padStart(8), (res.valves.VTEST.opening[Math.round(ref.t[k] / (res.times[1] - res.times[0]))] ?? NaN).toFixed(3));
  }
}
