// Extended-period simulation and water quality: small cases with known answers, then EPANET 2.2 on its
// three example networks (references in validation/data, made with WNTR).
import { runEPS, patternFactor, snapshot, tankVolume, networkAt } from '../src/engine/eps';
import { compare } from '../validation/eps-vs-epanet';
import { defaultSettings, type Network } from '../src/engine/types';
import { solveSteady } from '../src/engine/steady';
import { parseInp, toInp } from '../src/engine/inp';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };

const base = (): Network => ({
  name: 'tank fill', nodes: [
    { id: 'R', kind: 'reservoir', x: 0, y: 0, elev: 100, head: 100 },
    { id: 'J', kind: 'junction', x: 500, y: 0, elev: 50, demand: 0.01, pattern: 'P' },
    { id: 'T', kind: 'reservoir', x: 1000, y: 0, elev: 60, head: 70, storage: { initLevel: 10, minLevel: 1, maxLevel: 30, diameter: 10 } },
  ],
  pipes: [
    { id: 'P1', from: 'R', to: 'J', length: 1000, diameter: 0.3, roughness: 0.1, wavespeed: 1000 },
    { id: 'P2', from: 'J', to: 'T', length: 1000, diameter: 0.3, roughness: 0.1, wavespeed: 1000 },
  ],
  pumps: [], valves: [], event: { kind: 'none', targets: [], start: 0 }, settings: defaultSettings(),
  patterns: [{ id: 'P', factors: [1, 2, 0.5] }],
  eps: { duration: 6 * 3600, hydStep: 3600, quality: 'age', qualStep: 60 },
});

{
  const net = base();
  const r = runEPS(net);
  t('report every hour', r.times.length === 7 && r.times[6] === 6 * 3600, r.times.map((x) => x / 3600).join(','));
  // mass balance on the tank: volume change = time-integral of the inflow (constant over each hour here)
  let ok = true;
  for (let k = 0; k < 6; k++) {
    const dv = r.volume.T[k + 1] - r.volume.T[k];
    const inflow = r.flow.P2[k] * 3600;
    if (r.level.T[k + 1] < 30 - 1e-6 && Math.abs(dv - inflow) > 1e-6 * Math.max(1, Math.abs(inflow))) ok = false;
  }
  t('tank volume follows the inflow exactly', ok, r.level.T.map((x) => x.toFixed(2)).join(' '));
  t('tank rises while the source is higher', r.level.T[1] > r.level.T[0]);
  t('demand follows its pattern', Math.abs(r.demand.J[1] - 0.02) < 1e-12 && Math.abs(r.demand.J[2] - 0.005) < 1e-12, r.demand.J.slice(0, 3).join(','));
  t('pattern repeats', patternFactor(net, 'P', 3 * 3600) === 1 && patternFactor(net, 'P', 4 * 3600 + 10) === 2);
  t('snapshot sets tank head from its level', snapshot(net, { t: 0, levels: new Map([['T', 12]]), linkOpen: new Map(), setting: new Map() }).nodes[2].head === 72);
  t('cylinder volume', Math.abs(tankVolume(net.nodes[2].storage!, 2) - Math.PI * 25 * 2) < 1e-9);
}
{
  // tank reaches its top: it stops filling, and the step is cut at the moment it is full
  const net = base();
  net.nodes[2].storage = { initLevel: 28, minLevel: 1, maxLevel: 30, diameter: 5 };
  const r = runEPS(net);
  t('full tank stops at the top level', Math.max(...r.level.T) <= 30 + 1e-9 && Math.abs(r.level.T[6] - 30) < 1e-9 && r.log.some((l) => l.text.includes('full')), r.log.map((l) => `${(l.t / 3600).toFixed(2)} ${l.text}`).join('; '));
  t('no flow into a full tank', Math.abs(r.flow.P2[6]) < 1e-6);
}
{
  // level control: pipe closes when the tank is above 15 m and opens below 12 m
  const net = base();
  net.nodes[2].storage = { initLevel: 10, minLevel: 1, maxLevel: 30, diameter: 5 };
  net.nodes[1].demand = 0;
  net.controls = [{ link: 'P2', status: 'closed', node: 'T', op: 'above', value: 15 }];
  const r = runEPS(net);
  const top = Math.max(...r.level.T);
  t('level control closes the pipe at its level', Math.abs(top - 15) < 1e-3 && r.status.P2[6] === 0, `top ${top.toFixed(3)} m`);
}
{
  // water age at the end of a single pipe = travel time, once the old water has been flushed
  const net: Network = {
    name: 'age', nodes: [
      { id: 'R', kind: 'reservoir', x: 0, y: 0, elev: 50, head: 50 },
      { id: 'J', kind: 'junction', x: 1000, y: 0, elev: 0, demand: 0.02 },
    ],
    pipes: [{ id: 'P', from: 'R', to: 'J', length: 1000, diameter: 0.2, roughness: 0.1, wavespeed: 1000 }],
    pumps: [], valves: [], event: { kind: 'none', targets: [], start: 0 }, settings: defaultSettings(),
    eps: { duration: 10 * 3600, hydStep: 3600, quality: 'age', qualStep: 30, tolerance: 1e-5 },
  };
  const r = runEPS(net);
  const travel = (Math.PI / 4 * 0.04 * 1000) / 0.02 / 3600; // h
  t('age at the pipe end = travel time', Math.abs(r.quality!.J[10] - travel) < 0.01, `${r.quality!.J[10].toFixed(3)} h vs ${travel.toFixed(3)} h`);
  net.eps = { ...net.eps!, quality: 'chemical', bulk: -1 };
  net.nodes[0].quality = 1;
  const c = runEPS(net);
  const exact = Math.exp(-1 * travel / 24);
  t('first-order decay over the travel time', Math.abs(c.quality!.J[10] - exact) < 0.002, `${c.quality!.J[10].toFixed(4)} vs ${exact.toFixed(4)} mg/L`);
  net.eps = { ...net.eps!, quality: 'trace', traceNode: 'R' };
  const tr = runEPS(net);
  t('trace: all water from the source', Math.abs(tr.quality!.J[10] - 100) < 1e-6 && tr.quality!.J[0] === 0);
}
{
  // steady solve unchanged for a network without EPS data
  const net = base();
  delete net.eps;
  const s = solveSteady(net);
  t('steady state still solves', s.converged);
}

{
  // export to EPANET and read back: the extended-period results are the same
  const net = parseInp(readFileSync(new URL('../validation/data/Net1.inp', import.meta.url), 'utf8')).network;
  const back = parseInp(toInp(net)).network;
  const a = runEPS(net), b = runEPS(back);
  const dl = Math.max(...a.level['2'].map((x, i) => Math.abs(x - b.level['2'][i])));
  const dq = Math.max(...a.quality!['22'].map((x, i) => Math.abs(x - b.quality!['22'][i])));
  t('EPANET export keeps tanks, patterns, controls and quality', dl < 1e-3 && dq < 1e-3 && back.controls?.length === 2, `level ${dl.toExponential(1)} m, quality ${dq.toExponential(1)}`);
}

{
  // a surge run can start from any time of the day
  const net = base();
  const at = networkAt(net, 2 * 3600);
  const r = runEPS(net);
  t('model at 2:00 has the tank level and demand of 2:00', Math.abs((at.nodes[2].head ?? 0) - (60 + r.level.T[2])) < 1e-9 && Math.abs((at.nodes[1].demand ?? 0) - r.demand.J[2]) < 1e-12);
}

// EPANET 2.2 on its example networks
const lim = { head: 0.05, tankHead: 0.05, flowLps: 1 };
for (const [name, qLim, ageLim] of [['Net1', 0.01, 0.01], ['Net2', 0.01, 0.01], ['Net3', 1, 0.5]] as const) {
  const o = compare(name, false);
  t(`${name}: heads and flows match EPANET`, o.head < lim.head && o.tankHead < lim.tankHead && o.flowLps < lim.flowLps, `head ${o.head.toFixed(3)} m, tanks ${o.tankHead.toFixed(3)} m, flow ${o.flowLps.toFixed(2)} L/s`);
  t(`${name}: quality matches EPANET (95 % of values)`, o.quality < qLim, `${o.quality.toFixed(3)}`);
  t(`${name}: water age matches EPANET (95 % of values)`, o.age < ageLim, `${o.age.toFixed(3)} h`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
