// Rigid-column engine: surge tank mass oscillation against the closed-form answer, and agreement with the wave
// engine on a slow event.
import { runTransient } from '../src/engine/transient';
import { solveSteady } from '../src/engine/steady';
import { risingMain } from '../src/engine/cases';
import { defaultSettings, type Network } from '../src/engine/types';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };

// reservoir → 2 km tunnel → surge tank → valve to atmosphere-like outlet reservoir; the valve closes in 2 s
const L = 2000, D = 1.5, Ds = 8, Q0 = 3;
const tunnel = (engine: 'wave' | 'rigid'): Network => ({
  name: 'surge tank', nodes: [
    { id: 'R', kind: 'reservoir', x: 0, y: 0, elev: 50, head: 100 },
    { id: 'ST', kind: 'junction', x: 2000, y: 0, elev: 40, tank: { diameter: Ds, bottomElev: 40, topElev: 140, connDiameter: 3, kIn: 0, kOut: 0 } },
    { id: 'V', kind: 'junction', x: 2050, y: 0, elev: 0 },
    { id: 'OUT', kind: 'reservoir', x: 2100, y: 0, elev: 0, head: 0 },
  ],
  pipes: [
    { id: 'T', from: 'R', to: 'ST', length: L, diameter: D, roughness: 0.0001, wavespeed: 1200 },
    { id: 'PS', from: 'ST', to: 'V', length: 50, diameter: 1.2, roughness: 0.0001, wavespeed: 1200 },
  ],
  pumps: [],
  valves: [{ id: 'VL', from: 'V', to: 'OUT', diameter: 1.2, k0: 0, opening: 1 }],
  event: { kind: 'valveClose', targets: ['VL'], start: 1, duration: 2 },
  settings: { ...defaultSettings(), duration: 200, unsteadyFriction: false, engine },
});
// make the steady flow Q0: set the valve loss to pass Q0 under the available head
{
  const net = tunnel('rigid');
  // find k0 that gives Q0
  let lo = 0.01, hi = 1e4;
  for (let k = 0; k < 80; k++) { const m = Math.sqrt(lo * hi); net.valves[0].k0 = m; const q = solveSteady(net).flows.get('VL')!; if (q > Q0) lo = m; else hi = m; }
  const k0 = net.valves[0].k0;
  const r = runTransient(net, { steady: solveSteady(net), frames: 2000 });
  const lv = Array.from(r.tanks.ST.level), tt = Array.from(r.times);
  const z0 = lv[0];
  const A = Math.PI / 4 * D * D, As = Math.PI / 4 * Ds * Ds, V0 = Q0 / A;
  const Z = V0 * Math.sqrt((L * A) / (9.80665 * As)), T = 2 * Math.PI * Math.sqrt((L * As) / (9.80665 * A));
  const up = Math.max(...lv) - z0;
  const kPeak = lv.indexOf(Math.max(...lv));
  // with tunnel friction hf (k = hf/Z) the rise above the reservoir is Z(1 − 2k/3 + k²/9) (Jaeger, small k)
  const k = (100 - z0) / Z;
  const above = Math.max(...lv) - 100, expect = Z * (1 - (2 * k) / 3 + (k * k) / 9);
  t('surge tank upsurge above the reservoir (Jaeger, with friction)', Math.abs(above - expect) / Z < 0.05, `${above.toFixed(2)} m vs ${expect.toFixed(2)} m; Z = ${Z.toFixed(2)} m, k = ${k.toFixed(2)}`);
  t('first peak about a quarter period after closure', Math.abs(tt[kPeak] - 2 - T / 4) / (T / 4) < 0.25, `${(tt[kPeak] - 2).toFixed(1)} s vs ${(T / 4).toFixed(1)} s friction-free`);
  const w = tunnel('wave'); w.valves[0].k0 = k0;
  const rw = runTransient(w, { steady: solveSteady(w), frames: 2000 });
  const upW = Math.max(...Array.from(rw.tanks.ST.level)) - z0;
  t('wave engine gives the same mass oscillation', Math.abs(upW - up) / up < 0.05, `${upW.toFixed(2)} m vs ${up.toFixed(2)} m`);
  const lw = Array.from(rw.tanks.ST.level), tw = Array.from(rw.times);
  t('wave engine peaks at the same time', Math.abs(tw[lw.indexOf(Math.max(...lw))] - tt[kPeak]) < 2, `${tw[lw.indexOf(Math.max(...lw))].toFixed(1)} s vs ${tt[kPeak].toFixed(1)} s`);
  t('rigid run is fast', r.runtimeMs < 3000, `${r.runtimeMs.toFixed(0)} ms for ${r.steps} steps`);
}
{
  // a rising main with a vessel: rigid columns give a plausible run-down (no wave peaks) and finite results
  const net = risingMain(true);
  net.settings = { ...net.settings, engine: 'rigid' };
  const r = runTransient(net, { steady: solveSteady(net) });
  const sp = Array.from(r.pumps.PU1.speed);
  t('rigid engine: pump runs down after a trip', sp[sp.length - 1] < 0.5 && sp[0] > 0.99, `final speed ${(sp[sp.length - 1] * 100).toFixed(0)} %`);
  t('rigid engine: vessel gives water', r.vessels['PS-D'].maxGas > r.vessels['PS-D'].initialGas);
  t('rigid engine: results are finite and say what the engine leaves out', r.envelopes.every((e) => Array.from(e.hMax).every(Number.isFinite)) && r.warnings[0].includes('Rigid-column'));
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
