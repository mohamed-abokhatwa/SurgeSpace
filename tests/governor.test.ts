// Turbine speed governor: after a load rejection the PI governor closes the gates as the unit speeds up.
import { EXAMPLES } from '../src/engine/cases';
import { turbineSpeeds } from '../src/engine/analysis';
import { solveSteady } from '../src/engine/steady';
import { runTransient } from '../src/engine/transient';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };
const base = EXAMPLES.find((x) => x.id === 'hydro')!.make();
const tv = base.valves.find((v) => v.turbine)!;
const ev = [base.event, ...(base.extraEvents ?? [])].find((e) => e.targets.includes(tv.id))!;
const run = (n: typeof base) => { const r = runTransient(n, { steady: solveSteady(n), frames: 600 }); return { r, ts: turbineSpeeds(n, r).find((x) => x.id === tv.id)! }; };
const plain = run(base);
const slow = { ...base, valves: base.valves.map((v) => (v.id === tv.id ? { ...v, turbine: { ...v.turbine!, governor: { kp: 4, ti: 3, closeTime: (ev.duration ?? 8) } } } : v)) };
const gov = run(slow);
const op = Array.from(gov.r.valves[tv.id].opening);
t('governor run gives a speed history', !!gov.r.valves[tv.id].speed && gov.ts.maxSpeed > 1.01, `max speed ${(gov.ts.maxSpeed * 100).toFixed(1)} % (prescribed closure ${(plain.ts.maxSpeed * 100).toFixed(1)} %)`);
t('gates close after the rejection', op[op.length - 1] < op[0] * 0.5, `opening ${op[0].toFixed(2)} → ${op[op.length - 1].toFixed(2)}`);
t('overspeed stays bounded', gov.ts.maxSpeed < 1.8);
// runner characteristic: speed tracked in the loop; flow chokes (low-Ns Francis) or rises (Kaplan) as it speeds up
const withChar = (kind: 'francisLow' | 'kaplan' | 'pelton', gv = false) => ({ ...base, valves: base.valves.map((v) => (v.id === tv.id ? { ...v, turbine: { ...v.turbine!, characteristic: { kind }, ...(gv ? { governor: { kp: 4, ti: 3, closeTime: ev.duration ?? 8 } } : {}) } } : v)) });
const fr = run(withChar('francisLow')), kp = run(withChar('kaplan')), pe = run(withChar('pelton'));
const q0 = fr.r.valves[tv.id].flow[0];
t('characteristic: steady state unchanged', Math.abs(q0 - plain.r.valves[tv.id].flow[0]) < 1e-9 && Math.abs(fr.r.valves[tv.id].opening[0] - plain.r.valves[tv.id].opening[0]) < 1e-9);
t('characteristic: speed history from the loop, rises on rejection', !!fr.r.valves[tv.id].speed && fr.ts.maxSpeed > 1.05, `Francis ${(fr.ts.maxSpeed * 100).toFixed(1)} %, Kaplan ${(kp.ts.maxSpeed * 100).toFixed(1)} %, Pelton ${(pe.ts.maxSpeed * 100).toFixed(1)} %`);
const maxH = (x: typeof fr) => Math.max(...Array.from(x.r.nodeHead[tv.from]));
t('low-Ns Francis chokes the flow as it speeds up: higher pressure rise than a Pelton-like (speed-independent) runner', maxH(fr) > maxH(pe) + 0.05, `${maxH(fr).toFixed(2)} m vs ${maxH(pe).toFixed(2)} m`);
t('Kaplan passes more flow as it speeds up: lower pressure rise than the Pelton-like runner', maxH(kp) < maxH(pe) - 0.05, `${maxH(kp).toFixed(2)} m vs ${maxH(pe).toFixed(2)} m`);
const fg = run(withChar('francisLow', true));
t('characteristic with governor: gates close and the overspeed stays bounded', fg.ts.maxSpeed < 1.8 && fg.ts.maxSpeed > 1.01, `${(fg.ts.maxSpeed * 100).toFixed(1)} %`);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
