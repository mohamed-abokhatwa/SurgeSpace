// Large-network performance check: an n × n grid (2n(n−1)+3 pipes) with a valve closure.
//   npx tsx validation/large-network.ts 71   (≈ 10,000 pipes)
import { solveSteady } from '../src/engine/steady';
import { runTransient } from '../src/engine/transient';
import { defaultSettings, type Network } from '../src/engine/types';
const n = Number(process.argv[2] ?? 70);
const nodes: Network['nodes'] = [{ id: 'R', kind: 'reservoir', x: -100, y: 0, elev: 0, head: 80 }];
const pipes: Network['pipes'] = [];
for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) nodes.push({ id: `N${i}_${j}`, kind: 'junction', x: i * 100, y: j * 100, elev: (i + j) % 7, demand: 0.0005 });
let k = 0;
for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
  if (i + 1 < n) pipes.push({ id: `P${k++}`, from: `N${i}_${j}`, to: `N${i + 1}_${j}`, length: 100 + ((i * 7 + j * 3) % 40), diameter: 0.15 + 0.05 * ((i + j) % 3), roughness: 0.1, wavespeed: 1000 });
  if (j + 1 < n) pipes.push({ id: `P${k++}`, from: `N${i}_${j}`, to: `N${i}_${j + 1}`, length: 100 + ((i * 5 + j * 11) % 40), diameter: 0.15, roughness: 0.1, wavespeed: 1000 });
}
pipes.push({ id: 'MAIN', from: 'R', to: 'N0_0', length: 500, diameter: 1.0, roughness: 0.1, wavespeed: 1000 });
nodes.push({ id: 'VX', kind: 'junction', x: n * 100, y: n * 100, elev: 0 }, { id: 'OUT', kind: 'reservoir', x: n * 100 + 10, y: n * 100, elev: 0, head: 0 });
pipes.push({ id: 'PV', from: `N${n - 1}_${n - 1}`, to: 'VX', length: 50, diameter: 0.2, roughness: 0.1, wavespeed: 1000 });
const net: Network = { name: 'grid', nodes, pipes, pumps: [], valves: [{ id: 'V', from: 'VX', to: 'OUT', diameter: 0.2, k0: 10, opening: 0.3 }], event: { kind: 'valveClose', targets: ['V'], start: 1, duration: 2 }, settings: { ...defaultSettings(), duration: 20 } };
let t0 = performance.now(); const s = solveSteady(net); const ts = performance.now() - t0;
t0 = performance.now(); const r = runTransient(net, { steady: s, frames: 200 }); const tt = performance.now() - t0;
console.log(`${pipes.length} pipes: steady ${ts.toFixed(0)} ms (${s.iterations} it, ${s.converged}), transient ${tt.toFixed(0)} ms, dt ${r.dt.toExponential(2)}, reaches ${r.reaches}, maxAdjust ${(r.maxAdjust*100).toFixed(2)}%`);
// the rigid-column engine on the same grid (sparse Newton solve in the node heads)
if (process.argv.includes('--rigid')) {
  t0 = performance.now();
  const rr = runTransient({ ...net, settings: { ...net.settings, engine: 'rigid', duration: 20 } }, { steady: s, frames: 50 });
  console.log(`rigid-column engine: ${(performance.now() - t0).toFixed(0)} ms for ${rr.steps} steps (${(rr.runtimeMs / rr.steps).toFixed(1)} ms per step)`);
}
