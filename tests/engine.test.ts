// Run with: npx tsx tests/engine.test.ts
import { solveSteady } from '../src/engine/steady';
import { runTransient, selectTimeStep } from '../src/engine/transient';
import { G, area, defaultSettings, type Network } from '../src/engine/types';

let pass = 0;
let fail = 0;
const near = (name: string, got: number, want: number, tol: number) => {
  const ok = Math.abs(got - want) <= Math.abs(want) * tol;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${got.toFixed(4)} vs ${want.toFixed(4)} (tol ${(tol * 100).toFixed(1)}%)`);
};
const check = (name: string, ok: boolean, info = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${info}`);
};

// ── 1. Joukowsky: reservoir – pipe – valve – reservoir, near-instant closure ─────────────
const rpv = (closure: number, friction = 0.0015): Network => ({
  name: 'RPV',
  nodes: [
    { id: 'R1', kind: 'reservoir', x: 0, y: 0, elev: 0, head: 100 },
    { id: 'V1', kind: 'junction', x: 1000, y: 0, elev: 0 },
    { id: 'V2', kind: 'junction', x: 1001, y: 0, elev: 0 },
    { id: 'R2', kind: 'reservoir', x: 1002, y: 0, elev: 0, head: 95 },
  ],
  pipes: [{ id: 'P1', from: 'R1', to: 'V1', length: 1000, diameter: 0.5, roughness: friction, wavespeed: 1000 }],
  pumps: [],
  valves: [{ id: 'VLV', from: 'V1', to: 'V2', diameter: 0.5, k0: 0.2, opening: 1 }],
  event: { kind: 'valveClose', targets: ['VLV'], start: 0.1, duration: closure, exponent: 1 },
  settings: { ...defaultSettings(), duration: 12, unsteadyFriction: false, gasFraction: 1e-12 },
});
// add a short downstream pipe so V2 is not floating
const rpvNet = (closure: number) => {
  const n = rpv(closure);
  n.pipes.push({ id: 'P2', from: 'V2', to: 'R2', length: 10, diameter: 0.5, roughness: 0.0015, wavespeed: 1000 });
  return n;
};
{
  const net = rpvNet(0.002);
  const st = solveSteady(net);
  check('steady converged', st.converged, `(${st.iterations} it)`);
  const q0 = st.flows.get('P1')!;
  const v0 = q0 / area(0.5);
  const r = runTransient(net, { steady: st, frames: 12001 });
  const h0 = st.heads.get('V1')!;
  let first = -Infinity;
  for (let k = 0; k < r.times.length; k++) if (r.times[k] > 0.1 && r.times[k] < 0.15) first = Math.max(first, r.nodeHead['V1'][k]);
  near('Joukowsky jump a·V0/g at the valve (first wave)', first - h0, (1000 * v0) / G, 0.005);
  let packed = -Infinity;
  for (let k = 0; k < r.times.length; k++) if (r.times[k] > 0.1 && r.times[k] < 2.1) packed = Math.max(packed, r.nodeHead['V1'][k]);
  check('line packing adds about the friction head before 2L/a', packed - first > 3 && packed - first < 7, `(+${(packed - first).toFixed(2)} m)`);
  const env = r.envelopes.find((e) => e.id === 'P1')!;
  check('column separation detected at the valve after the wave reflects', env.cavMax[env.cavMax.length - 1] > 1e-5, `(cavity ${(env.cavMax[env.cavMax.length - 1] * 1000).toFixed(2)} L)`);
  check('cavity collapse gives a peak above Joukowsky (known physics)', r.nodeMax['V1'] - h0 > (1000 * v0) / G, `(${(r.nodeMax['V1'] - h0).toFixed(1)} m)`);
  check('wave-speed adjustment ≤ 0.5 %', r.maxAdjust <= 0.005, `(${(r.maxAdjust * 100).toFixed(3)} %, dt ${r.dt.toExponential(3)} s)`);
  // period: first return of the head below steady at the valve ≈ 2L/a after closure
  const hv = r.nodeHead['V1'];
  let tDrop = -1;
  for (let k = 1; k < hv.length; k++) if (r.times[k] > 0.3 && hv[k] < h0) { tDrop = r.times[k]; break; }
  near('pressure reverses at 2L/a after closure', tDrop - 0.1, 2.0, 0.03);
  console.log(`   V0 = ${v0.toFixed(3)} m/s, runtime ${r.runtimeMs.toFixed(0)} ms, ${r.reaches} reaches, ${r.steps} steps`);
}

// ── 2. Slow closure (> 2L/a) must give a much smaller rise than Joukowsky ────────────────
{
  const net = rpvNet(20);
  const st = solveSteady(net);
  const r = runTransient(net, { steady: st });
  const v0 = st.flows.get('P1')! / area(0.5);
  const rise = r.nodeMax['V1'] - st.heads.get('V1')!;
  check('slow closure rise < 40 % of Joukowsky', rise < 0.4 * ((1000 * v0) / G), `(${rise.toFixed(2)} m)`);
}

// ── 3. Time-step selection keeps adjustments small on mixed pipes ────────────────────────
{
  const travel = [1234.5 / 1100, 87.3 / 950, 2890 / 1210, 15.2 / 1000, 640 / 400];
  const s = selectTimeStep(travel, 0.005, 60000, 0.05);
  check('mixed pipes: max adjustment ≤ 0.5 %', s.err <= 0.005, `(${(s.err * 100).toFixed(3)} %, ${s.N.reduce((a, b) => a + b)} reaches)`);
}


// ── 4. Network physics: wave transmission at a three-pipe junction (exact theory) ─────────
// A wave ΔH0 arriving along pipe 2 transmits ΔHt = 2(A2/a2) / Σ(Ai/ai) · ΔH0 into the junction.
{
  const net: Network = {
    name: 'junction',
    nodes: [
      { id: 'R1', kind: 'reservoir', x: 0, y: 0, elev: 0, head: 80 },
      { id: 'J', kind: 'junction', x: 1, y: 0, elev: 0 },
      { id: 'VU', kind: 'junction', x: 2, y: 0, elev: 0 },
      { id: 'VD', kind: 'junction', x: 3, y: 0, elev: 0 },
      { id: 'R2', kind: 'reservoir', x: 4, y: 0, elev: 0, head: 79.4 },
      { id: 'R3', kind: 'reservoir', x: 1, y: 1, elev: 0, head: 79.7 },
    ],
    pipes: [
      { id: 'P1', from: 'R1', to: 'J', length: 2000, diameter: 0.6, roughness: 0.0015, wavespeed: 1000 },
      { id: 'P2', from: 'J', to: 'VU', length: 3000, diameter: 0.4, roughness: 0.0015, wavespeed: 1200 },
      { id: 'P3', from: 'J', to: 'R3', length: 2500, diameter: 0.3, roughness: 0.0015, wavespeed: 900 },
      { id: 'P4', from: 'VD', to: 'R2', length: 50, diameter: 0.4, roughness: 0.0015, wavespeed: 1200 },
    ],
    pumps: [],
    valves: [{ id: 'V', from: 'VU', to: 'VD', diameter: 0.4, k0: 0.2, opening: 1 }],
    event: { kind: 'valveClose', targets: ['V'], start: 0.5, duration: 0.001 },
    settings: { ...defaultSettings(), duration: 4, unsteadyFriction: false, gasFraction: 1e-12 },
  };
  const st = solveSteady(net);
  const r = runTransient(net, { steady: st, frames: 4001, constantFriction: true });
  const k = (d: number, a: number) => area(d) / a;
  const dH0 = r.nodeMax['VU'] - st.heads.get('VU')!; // incident wave at the valve
  let jumpVU = -Infinity;
  for (let i = 0; i < r.times.length; i++) if (r.times[i] > 0.5 && r.times[i] < 0.6) jumpVU = Math.max(jumpVU, r.nodeHead['VU'][i]);
  const inc = jumpVU - st.heads.get('VU')!;
  const tArr = 0.5 + 3000 / 1200; // arrival at J
  let hJ = NaN;
  for (let i = 0; i < r.times.length; i++) if (r.times[i] > tArr + 0.05) { hJ = r.nodeHead['J'][i]; break; }
  const trans = hJ - st.heads.get('J')!;
  const want = (2 * k(0.4, 1200)) / (k(0.6, 1000) + k(0.4, 1200) + k(0.3, 900)) * inc;
  near('junction transmission coefficient (exact theory)', trans, want, 0.02);
  void dH0;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
