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
{
  // variable-area surge tank: a wide chamber above the steady level cuts the upsurge (both engines)
  for (const engine of ['rigid', 'wave'] as const) {
    const a = tunnel(engine), b = tunnel(engine);
    a.valves[0].k0 = b.valves[0].k0 = 20;
    const z0 = solveSteady(a).heads.get('ST')!;
    b.nodes[1] = { ...b.nodes[1], tank: { ...b.nodes[1].tank!, areaCurve: [[40, Math.PI / 4 * 64], [z0 + 0.5, Math.PI / 4 * 64], [z0 + 1, 4 * Math.PI / 4 * 64], [140, 4 * Math.PI / 4 * 64]] } };
    const up = (n: Network) => { const r = runTransient(n, { steady: solveSteady(n), frames: 1500 }); return Math.max(...Array.from(r.tanks.ST.level)) - z0; };
    const u1 = up(a), u2 = up(b);
    t(`${engine}: chamber (4 × area above the steady level) reduces the upsurge`, u2 < 0.7 * u1, `${u2.toFixed(2)} m vs ${u1.toFixed(2)} m`);
  }
}
{
  // differential (Johnson) surge tank: riser DN3 inside an 8 m chamber
  //   big ports → behaves as a plain tank of the full area; tiny ports → behaves as a plain tank of the riser area;
  //   realistic ports → the port loss damps the oscillation: upsurge below the plain tank, riser ahead of the chamber
  const mids: number[] = [];
  for (const engine of ['rigid', 'wave'] as const) {
    const plain = (dia: number) => { const n = tunnel(engine); n.valves[0].k0 = 20; n.nodes[1] = { ...n.nodes[1], tank: { ...n.nodes[1].tank!, diameter: dia } }; return n; };
    const diff = (port: number) => { const n = plain(8); n.nodes[1] = { ...n.nodes[1], tank: { ...n.nodes[1].tank!, differential: { riserDiameter: 3, portArea: port } } }; return n; };
    const run = (n: Network) => runTransient(n, { steady: solveSteady(n), frames: 1500 });
    const z0 = solveSteady(plain(8)).heads.get('ST')!;
    const up = (r: ReturnType<typeof run>) => Math.max(...Array.from(r.tanks.ST.level)) - z0;
    const full = up(run(plain(8))), riser = up(run(plain(3)));
    const rBig = run(diff(50)), rTiny = run(diff(1e-4)), rMid = run(diff(0.6));
    t(`${engine}: differential tank with large ports = plain tank of the full area`, Math.abs(up(rBig) - full) / full < 0.05, `${up(rBig).toFixed(2)} m vs ${full.toFixed(2)} m`);
    t(`${engine}: differential tank with closed ports = plain tank of the riser area`, Math.abs(up(rTiny) - riser) / riser < 0.05, `${up(rTiny).toFixed(2)} m vs ${riser.toFixed(2)} m`);
    const m = up(rMid);
    t(`${engine}: differential tank with ports: port loss cuts the upsurge`, m < full && m < riser, `${m.toFixed(2)} m (plain ${full.toFixed(2)}, riser alone ${riser.toFixed(2)})`);
    mids.push(m);
    const ch = rMid.tanks.ST.chamber!;
    t(`${engine}: riser rises above the chamber`, Math.max(...Array.from(rMid.tanks.ST.level)) > ch.maxLevel + 0.1, `riser ${Math.max(...Array.from(rMid.tanks.ST.level)).toFixed(2)} m, chamber ${ch.maxLevel.toFixed(2)} m`);
  }
  t('differential tank: engines agree', Math.abs(mids[0] - mids[1]) / mids[0] < 0.02, `${mids[0].toFixed(2)} m vs ${mids[1].toFixed(2)} m`);
}
{
  // the sparse solve (used above 300 unknowns) gives the same answer as the dense one, and lifts the size limit
  const net = risingMain(true);
  net.settings = { ...net.settings, engine: 'rigid' };
  const st = solveSteady(net);
  const a = runTransient(net, { steady: st }), b = runTransient(net, { steady: st, sparse: true } as never);
  let d = 0; for (const k of Object.keys(a.nodeHead)) for (let i = 0; i < a.nodeHead[k].length; i++) d = Math.max(d, Math.abs(a.nodeHead[k][i] - b.nodeHead[k][i]));
  t('sparse and dense Newton solves agree', d < 1e-4, `${d.toExponential(1)} m`);
  // a 760-pipe grid (about 1,500 unknowns) runs
  const n = 20, nodes: Network['nodes'] = [{ id: 'R', kind: 'reservoir', x: -100, y: 0, elev: 0, head: 80 }], pipes: Network['pipes'] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) nodes.push({ id: `N${i}_${j}`, kind: 'junction', x: i * 100, y: j * 100, elev: (i + j) % 7, demand: 0.0005 });
  let k = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i + 1 < n) pipes.push({ id: `P${k++}`, from: `N${i}_${j}`, to: `N${i + 1}_${j}`, length: 100, diameter: 0.2, roughness: 0.1, wavespeed: 1000 });
    if (j + 1 < n) pipes.push({ id: `P${k++}`, from: `N${i}_${j}`, to: `N${i}_${j + 1}`, length: 100, diameter: 0.15, roughness: 0.1, wavespeed: 1000 });
  }
  pipes.push({ id: 'MAIN', from: 'R', to: 'N0_0', length: 500, diameter: 1.0, roughness: 0.1, wavespeed: 1000 });
  nodes.push({ id: 'VX', kind: 'junction', x: n * 100, y: n * 100, elev: 0 }, { id: 'OUT', kind: 'reservoir', x: n * 100 + 10, y: n * 100, elev: 0, head: 0 });
  pipes.push({ id: 'PV', from: `N${n - 1}_${n - 1}`, to: 'VX', length: 50, diameter: 0.2, roughness: 0.1, wavespeed: 1000 });
  const grid: Network = { name: 'grid', nodes, pipes, pumps: [], valves: [{ id: 'V', from: 'VX', to: 'OUT', diameter: 0.2, k0: 10, opening: 0.3 }], event: { kind: 'valveClose', targets: ['V'], start: 1, duration: 20 }, settings: { ...defaultSettings(), duration: 30, engine: 'rigid' } };
  const gs = solveSteady(grid);
  const r = runTransient(grid, { steady: gs, frames: 30 });
  const hv = Array.from(r.nodeHead.VX);
  t('rigid engine runs a 760-pipe grid (sparse solve)', hv.every(Number.isFinite) && hv[hv.length - 1] > hv[0], `${pipes.length} pipes, ${r.runtimeMs.toFixed(0)} ms, valve head ${hv[0].toFixed(1)} → ${hv[hv.length - 1].toFixed(1)} m`);
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
