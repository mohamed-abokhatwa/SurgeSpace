// SurgeSpace against Bentley HAMMER on "Tnet0" (TSNet repository, which ships the HAMMER project and report):
// reservoir at 750 m → 1200 m of DN600 → 2400 m of DN1200 → valve discharging 0.05 m³/s to atmosphere,
// which closes over 2 s. Wave speed 1200 m/s, 60 s. HAMMER's reported extremes are typed in below.
import { runTransient } from '../src/engine/transient';
import { area, defaultSettings, G, type Network } from '../src/engine/types';

const Q0 = 0.05, dV = 0.158, H0 = 749.9;
const k0 = (2 * G * H0 * area(dV) ** 2) / (Q0 * Q0);
const net: Network = {
  name: 'Tnet0',
  nodes: [
    { id: '1', kind: 'reservoir', x: 0, y: 0, elev: 0, head: 750 },
    { id: '2', kind: 'junction', x: 1152, y: 10, elev: 0, demand: 0 },
    { id: '3', kind: 'junction', x: 2613, y: 10, elev: 0, demand: 0 },
    { id: 'ATM', kind: 'reservoir', x: 2700, y: 10, elev: 0, head: 0 },
  ],
  pipes: [
    { id: '1', from: '1', to: '2', length: 1200, diameter: 0.6, roughness: 0.02, wavespeed: 1200 },
    { id: '2', from: '2', to: '3', length: 2400, diameter: 1.2, roughness: 0.02, wavespeed: 1200 },
  ],
  pumps: [],
  valves: [{ id: 'D2A', from: '3', to: 'ATM', diameter: dV, k0, opening: 1, law: 'area' }],
  event: { kind: 'valveClose', targets: ['D2A'], start: 0, duration: 2, exponent: 1, finalOpening: 0 },
  settings: { ...defaultSettings(), duration: 60, unsteadyFriction: false },
};
const res = runTransient(net, { constantFriction: true, frames: 600 });
if (!res.ok) throw new Error('run failed');
const hammer = { '2': { max: 759.3, min: 740.6 }, '3': { max: 761.8, min: 738.3 } } as const;
console.log(`SurgeSpace dt ${res.dt.toExponential(3)} s, wave-speed change ${(res.maxAdjust * 100).toFixed(2)} %; steady flow ${(res.steady.flows['D2A'] * 1000).toFixed(1)} L/s`);
for (const id of ['2', '3'] as const) {
  console.log(`node ${id}: max head HAMMER ${hammer[id].max.toFixed(1)} / SurgeSpace ${res.nodeMax[id].toFixed(1)} m · min head HAMMER ${hammer[id].min.toFixed(1)} / SurgeSpace ${res.nodeMin[id].toFixed(1)} m`);
}
