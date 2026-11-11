// Variable-speed pumps: the steady speed meets the pressure set point, and the PI drive restores it after a
// demand step during the surge run.
import { solveSteady } from '../src/engine/steady';
import { runTransient } from '../src/engine/transient';
import { defaultSettings, type Network } from '../src/engine/types';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };
const make = (vsd: boolean): Network => ({
  name: 'booster', nodes: [
    { id: 'R', kind: 'reservoir', x: 0, y: 0, elev: 10, head: 12 },
    { id: 'S', kind: 'junction', x: 10, y: 0, elev: 10 },
    { id: 'D', kind: 'junction', x: 20, y: 0, elev: 10 },
    { id: 'N', kind: 'junction', x: 500, y: 0, elev: 15, demand: 0.03 },
    { id: 'OUT', kind: 'reservoir', x: 510, y: 0, elev: 0, head: 0 },
  ],
  pipes: [
    { id: 'P0', from: 'R', to: 'S', length: 10, diameter: 0.3, roughness: 0.1, wavespeed: 1000 },
    { id: 'P1', from: 'D', to: 'N', length: 500, diameter: 0.25, roughness: 0.1, wavespeed: 1000 },
  ],
  pumps: [{ id: 'B', from: 'S', to: 'D', curve: [[0, 60], [0.05, 48], [0.08, 30]], efficiency: 0.75, speed: 2950, inertia: 0.8, checkValve: true, on: true, ...(vsd ? { vsd: { node: 'N', setPressure: 30, kp: 0.01, ti: 3, rampTime: 8 } } : {}) }],
  valves: [{ id: 'V', from: 'N', to: 'OUT', diameter: 0.1, k0: 2, opening: 0.0 }],
  event: { kind: 'valveOpen', targets: ['V'], start: 2, duration: 3, finalOpening: 0.25 },
  settings: { ...defaultSettings(), duration: 60 },
});
const net = make(true);
const s = solveSteady(net);
const pN = s.heads.get('N')! - 15;
t('steady: drive speed meets the set pressure', Math.abs(pN - 30) < 0.01 && s.speeds!.get('B')! < 1, `${pN.toFixed(3)} m at ${(s.speeds!.get('B')! * 100).toFixed(1)} % speed`);
const r = runTransient(net, { steady: s, frames: 600 });
const fixed = make(false);
fixed.pumps[0].curve = fixed.pumps[0].curve.map(([q, h]) => [q * s.speeds!.get('B')!, h * s.speeds!.get('B')! ** 2]);
const rf = runTransient(fixed, { steady: solveSteady(fixed), frames: 600 });
const end = (x: typeof r) => x.nodeHead.N[x.times.length - 1] - 15;
const sp = Array.from(r.pumps.B.speed);
t('surge run starts at the steady speed', Math.abs(sp[0] - s.speeds!.get('B')!) < 1e-6);
t('drive speeds up after the demand step and restores the pressure', sp[sp.length - 1] > sp[0] + 0.02 && Math.abs(end(r) - 30) < 1.5, `end pressure ${end(r).toFixed(2)} m, speed ${(sp[0] * 100).toFixed(0)} → ${(sp[sp.length - 1] * 100).toFixed(0)} %`);
t('without the drive the pressure stays low', end(rf) < end(r) - 2, `${end(rf).toFixed(2)} m fixed speed`);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
