// Viscoelastic (PE) pipe: creep damps the pressure waves and stretches their period; with zero creep the run is
// identical to the elastic one.
import { solveSteady } from '../src/engine/steady';
import { runTransient } from '../src/engine/transient';
import { defaultSettings, type Network } from '../src/engine/types';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };
const make = (ve?: { J: number[]; tau: number[] }): Network => ({
  name: 'PE pipe', nodes: [
    { id: 'R', kind: 'reservoir', x: 0, y: 0, elev: 0, head: 45 },
    { id: 'V', kind: 'junction', x: 270, y: 0, elev: 0 },
    { id: 'O', kind: 'reservoir', x: 275, y: 0, elev: 0, head: 0 },
  ],
  pipes: [{ id: 'P', from: 'R', to: 'V', length: 277, diameter: 0.0506, roughness: 0.01, wavespeed: 395, wall: 6.2, material: 'HDPE', ...(ve ? { viscoelastic: ve } : {}) }],
  pumps: [], valves: [{ id: 'VL', from: 'V', to: 'O', diameter: 0.05, k0: 400, opening: 1 }],
  event: { kind: 'valveClose', targets: ['VL'], start: 0.2, duration: 0.01 },
  settings: { ...defaultSettings(), duration: 20, unsteadyFriction: false, gasFraction: 1e-9 },
});
const run = (n: Network) => runTransient(n, { steady: solveSteady(n), frames: 4000 });
const el = run(make()), z = run(make({ J: [0], tau: [0.05] }));
const vH = (r: ReturnType<typeof run>) => Array.from(r.nodeHead.V);
t('zero creep = elastic run', Math.max(...vH(el).map((h, i) => Math.abs(h - vH(z)[i]))) < 1e-9);
// indicative HDPE creep (literature order of magnitude; calibrate to the real pipe)
const ve = run(make({ J: [0.1, 0.1, 0.09], tau: [0.05, 0.5, 1.5] }));
const peaks = (r: ReturnType<typeof run>, from: number, to: number) => Math.max(...vH(r).filter((_, i) => r.times[i] >= from && r.times[i] < to));
const T = 4 * 277 / 395;
const late = (r: ReturnType<typeof run>) => peaks(r, 4 * T, 6 * T) - vH(r)[0];
t('creep damps the waves', late(ve) < 0.8 * late(el), `rise after 2 periods: ${late(ve).toFixed(2)} m vs ${late(el).toFixed(2)} m elastic`);
const first = (r: ReturnType<typeof run>) => peaks(r, 0, 1.5 * T);
t('first peak close to Joukowsky in both', Math.abs(first(ve) - first(el)) / (first(el) - vH(el)[0]) < 0.25, `${first(ve).toFixed(1)} vs ${first(el).toFixed(1)} m`);
// period: zero crossings of the head deviation
const period = (r: ReturnType<typeof run>) => { const h = vH(r), h0 = h[h.length - 1]; const xs: number[] = []; for (let i = 1; i < h.length; i++) if ((h[i - 1] - h0) > 0 && (h[i] - h0) <= 0 && r.times[i] > 0.3) xs.push(r.times[i]); return xs.length > 2 ? (xs[xs.length - 1] - xs[0]) / (xs.length - 1) : NaN; };
t('creep lengthens the wave period', period(ve) > period(el), `${period(ve).toFixed(3)} s vs ${period(el).toFixed(3)} s`);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
