// SurgeSpace against Bentley HAMMER (engine 08.11.06.113) on the BWSN-1 network ("Tnet3" in the TSNet repository,
// which ships the HAMMER project and its text report). Event, from the HAMMER database: PUMP-172's speed is forced
// linearly from 100 % to 0 over 2 s; wave speed 1200 m/s in every pipe; 20 s; steady friction.
// Compared: steady heads, and the maximum and minimum head HAMMER reports at every pipe end.
// Usage: npx tsx validation/vs-hammer-tnet3.ts <Tnet3.inp> <HAMMER .hut report> <EPANET t=0 state .json>
import { readFileSync } from 'fs';
import { parseInp } from '../src/engine/inp';
import { runTransient } from '../src/engine/transient';

const [inpPath, hutPath, t0Path] = process.argv.slice(2);
const FT = 0.3048;
const hut = readFileSync(hutPath, 'utf8').split(/\r?\n/);
const cells = (l: string) => l.split('|').slice(1, -1).map((c) => c.trim());

// HAMMER tables: pipe order (PIPE INFORMATION), initial conditions (same order), extreme heads (SUMMARY)
const section = (title: string, stop: RegExp) => {
  const i = hut.findIndex((l) => l.includes(title));
  const out: string[][] = [];
  for (let k = i + 1; k < hut.length && !stop.test(hut[k]); k++) {
    const c = cells(hut[k]);
    if (c.length >= 5 && c[0] && !/LABEL|POINT|NODE|^-/.test(c[0]) && !/^\(/.test(c[1])) out.push(c);
  }
  return out;
};
const pipeInfo = section('PIPE INFORMATION', /INITIAL PIPE CONDITIONS/);
const initial = section('INITIAL PIPE CONDITIONS', /HAMMER Engine|List of end points/);
const summary = section('SUMMARY FOR', /Maximum pressure in entire network/);
const h0Hammer = new Map<string, number>(); // "PIPE:NODE" → initial head, m
pipeInfo.forEach((p, k) => {
  const r = initial[k];
  if (!r) return;
  h0Hammer.set(`${p[0]}:${r[0]}`, +r[1] * FT);
  h0Hammer.set(`${p[0]}:${r[2]}`, +r[3] * FT);
});
const ext = summary.map((c) => ({ key: c[0], pipe: c[0].split(':')[0], node: c[0].split(':')[1], maxH: +c[3] * FT, minH: +c[4] * FT }));

// SurgeSpace model from the same network
const { network: net } = parseInp(readFileSync(inpPath, 'utf8'), 'Tnet3');
const e = JSON.parse(readFileSync(t0Path, 'utf8')).epanet;
for (const n of net.nodes) {
  if (n.kind === 'junction') n.demand = e.demand[n.id] ?? n.demand;
  else if (e.head[n.id] !== undefined) n.head = e.head[n.id];
}
for (const p of net.pumps) p.on = e.status[p.id] !== 0;
for (const p of net.pipes) { p.wavespeed = 1200; if (e.status[p.id] === 0) p.closed = true; }
net.event = { kind: 'pumpTrip', pumpMode: 'ramp', targets: ['PUMP-172'], start: 0, duration: 2 };
net.settings = { ...net.settings, duration: 20, unsteadyFriction: false };
// HAMMER_LIKE=1 repeats the run the way HAMMER did it: time step 0.002 s and wave speeds stretched up to 50 %
const hammerLike = process.env.HAMMER_LIKE === '1';
if (hammerLike) net.settings = { ...net.settings, maxAdjust: 10, rigidTravel: 1e-9 };
const t0 = performance.now();
const res = runTransient(net, { constantFriction: true, frames: 400, fixedDt: hammerLike ? 0.002 : undefined });
const ms = performance.now() - t0;
if (!res.ok) throw new Error('run failed');

const pipeById = new Map(net.pipes.map((p) => [p.id, p]));
const endNode = (pipe: string, label: string) => {
  const p = pipeById.get(pipe);
  if (!p) return null;
  if (label === p.from || label === p.to) return label;
  // HAMMER draws valves and pumps as nodes; in EPANET they are links, so take the pipe's other end
  const other = ext.find((x) => x.pipe === pipe && x.node !== label)?.node;
  return other === p.from ? p.to : other === p.to ? p.from : null;
};

const rows: { key: string; h0H: number; h0S: number; maxH: number; maxS: number; minH: number; minS: number }[] = [];
for (const x of ext) {
  const nid = endNode(x.pipe, x.node);
  if (!nid || res.nodeMax[nid] === undefined) continue;
  rows.push({ key: x.key, h0H: h0Hammer.get(x.key) ?? NaN, h0S: res.steady.heads[nid], maxH: x.maxH, maxS: res.nodeMax[nid], minH: x.minH, minS: res.nodeMin[nid] });
}
const stat = (v: number[]) => { const a = v.map(Math.abs).sort((p, q) => p - q); return { mean: a.reduce((s, y) => s + y, 0) / a.length, p95: a[Math.floor(a.length * 0.95)], max: a[a.length - 1] }; };
const dSteady = stat(rows.map((r) => r.h0S - r.h0H).filter(Number.isFinite));
const dMax = stat(rows.map((r) => r.maxS - r.maxH));
const dMin = stat(rows.map((r) => r.minS - r.minH));
// surge sizes (HAMMER) to judge relative differences
const rise = rows.map((r) => r.maxH - r.h0H).filter(Number.isFinite);
const drop = rows.map((r) => r.h0H - r.minH).filter(Number.isFinite);
const big = (a: number[]) => Math.max(...a);
const top = (key: 'maxH' | 'minH', sign: number) => rows.reduce((b, r) => (sign * r[key] > sign * b[key] ? r : b), rows[0]);

console.log(`Network: ${net.nodes.length} nodes, ${net.pipes.length} pipes, ${net.pumps.length} pumps, ${net.valves.length} valves; ${rows.length} pipe ends compared`);
console.log(`SurgeSpace: dt ${res.dt.toExponential(3)} s, ${res.reaches} reaches, wave speeds changed by at most ${(res.maxAdjust * 100).toFixed(2)} %, ${(ms / 1000).toFixed(1)} s`);
console.log(`HAMMER:    dt 0.002 s (user-set), wave speed adjustment limit 50 %; its log warns the adjustments "deviate excessively"`);
console.log(`steady head      : mean |diff| ${dSteady.mean.toFixed(2)} m, 95th pct ${dSteady.p95.toFixed(2)} m, worst ${dSteady.max.toFixed(2)} m`);
console.log(`maximum head     : mean |diff| ${dMax.mean.toFixed(2)} m, 95th pct ${dMax.p95.toFixed(2)} m, worst ${dMax.max.toFixed(2)} m   (largest rise in HAMMER ${big(rise).toFixed(1)} m)`);
console.log(`minimum head     : mean |diff| ${dMin.mean.toFixed(2)} m, 95th pct ${dMin.p95.toFixed(2)} m, worst ${dMin.max.toFixed(2)} m   (largest drop in HAMMER ${big(drop).toFixed(1)} m)`);
const within = (d: number) => {
  const ok = rows.filter((r) => Math.abs(r.maxS - r.maxH) <= d && Math.abs(r.minS - r.minH) <= d).length;
  return `${((ok / rows.length) * 100).toFixed(0)} %`;
};
console.log(`pipe ends where both max and min agree within 1 m: ${within(1)}, within 2 m: ${within(2)}, within 3 m: ${within(3)}, within 5 m: ${within(5)}`);
const hiH = top('maxH', 1), loH = top('minH', -1);
console.log(`network max head : HAMMER ${hiH.maxH.toFixed(2)} m at ${hiH.key}; SurgeSpace there ${hiH.maxS.toFixed(2)} m`);
console.log(`network min head : HAMMER ${loH.minH.toFixed(2)} m at ${loH.key}; SurgeSpace there ${loH.minS.toFixed(2)} m`);
if (process.env.LIST) {
  rows.sort((a, b) => Math.abs(b.maxS - b.maxH) + Math.abs(b.minS - b.minH) - Math.abs(a.maxS - a.maxH) - Math.abs(a.minS - a.minH));
  for (const r of rows.slice(0, Number(process.env.LIST))) console.log(`${r.key.padEnd(26)} h0 ${r.h0H.toFixed(1)}/${r.h0S.toFixed(1)}  max ${r.maxH.toFixed(1)}/${r.maxS.toFixed(1)}  min ${r.minH.toFixed(1)}/${r.minS.toFixed(1)}`);
}
if (process.env.PUMP) {
  const p = res.pumps['PUMP-172'];
  const k = p.flow.findIndex((q) => q <= 1e-6);
  console.log(`PUMP-172 flow reaches zero at ${k >= 0 ? res.times[k].toFixed(3) : 'never'} s (HAMMER: check valve closes at 0.46 s); speed then ${k >= 0 ? (p.speed[k] * 100).toFixed(0) : '-'} %`);
}
