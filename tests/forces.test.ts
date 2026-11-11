// Pipe forces: a fast closure gives F = ρ·a·V·A on a straight pipe while the wave runs along it.
import { pipeForces } from '../src/engine/analysis';
import { solveSteady } from '../src/engine/steady';
import { runTransient } from '../src/engine/transient';
import { defaultSettings, type Network } from '../src/engine/types';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };
const net: Network = {
  name: 'force', nodes: [
    { id: 'R', kind: 'reservoir', x: 0, y: 0, elev: 0, head: 50 },
    { id: 'V', kind: 'junction', x: 1000, y: 0, elev: 0 },
    { id: 'O', kind: 'reservoir', x: 1010, y: 0, elev: 0, head: 0 },
  ],
  pipes: [{ id: 'P', from: 'R', to: 'V', length: 1000, diameter: 0.3, roughness: 0.01, wavespeed: 1000 }],
  pumps: [], valves: [{ id: 'VL', from: 'V', to: 'O', diameter: 0.3, k0: 60, opening: 1 }],
  event: { kind: 'valveClose', targets: ['VL'], start: 0.5, duration: 0.02 },
  settings: { ...defaultSettings(), duration: 4, unsteadyFriction: false, frames: 2000 },
};
const s = solveSteady(net);
const r = runTransient(net, { steady: s, frames: 2000 });
const f = pipeForces(net, r)[0];
const A = Math.PI / 4 * 0.09, V = s.flows.get('VL')! / A;
const expect = 998.2 * 1000 * V * A / 1000; // kN (ρ a V A)
t('fast closure: force on the straight pipe ≈ ρ·a·V·A', Math.abs(f.maxDelta - expect) / expect < 0.12, `${f.maxDelta.toFixed(1)} kN vs ${expect.toFixed(1)} kN, at ${f.tMax.toFixed(2)} s`);
t('steady force is small (friction only)', Math.abs(f.steadyForce) < 0.2 * expect, `${f.steadyForce.toFixed(2)} kN`);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
