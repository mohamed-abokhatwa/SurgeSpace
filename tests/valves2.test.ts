// Pressure-breaker, general-purpose and throttle control valves against EPANET 2.2 (WNTR reference), and
// the surge run keeps their steady losses.
import { readFileSync } from 'node:fs';
import { parseInp } from '../src/engine/inp';
import { solveSteady } from '../src/engine/steady';
import { runTransient } from '../src/engine/transient';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };
const dir = new URL('../validation/data/', import.meta.url);
const net = parseInp(readFileSync(new URL('valves2.inp', dir), 'utf8')).network;
const ref = JSON.parse(readFileSync(new URL('valves2.epanet.json', dir), 'utf8')) as { head: Record<string, number>; flow: Record<string, number> };
const s = solveSteady(net);
let dh = 0, dq = 0;
for (const [id, h] of Object.entries(ref.head)) dh = Math.max(dh, Math.abs(s.heads.get(id)! - h));
for (const [id, q] of Object.entries(ref.flow)) dq = Math.max(dq, Math.abs((s.flows.get(id) ?? 0) - q));
t('PBV, GPV and TCV: heads match EPANET', dh < 0.02, `${dh.toFixed(4)} m`);
t('PBV, GPV and TCV: flows match EPANET', dq < 1e-4, `${(dq * 1000).toFixed(3)} L/s`);
t('PBV holds its head drop', Math.abs(s.heads.get('J1')! - s.heads.get('J2')! - 15) < 1e-3);
net.event = { kind: 'none', targets: [], start: 0 };
net.settings = { ...net.settings, duration: 5 };
const r = runTransient(net, { steady: s, frames: 50 });
const drift = Math.max(...net.nodes.map((n) => Math.abs(r.nodeHead[n.id][r.times.length - 1] - s.heads.get(n.id)!)));
t('surge run with no operation stays at the steady state', drift < 0.05, `${drift.toFixed(4)} m`);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
