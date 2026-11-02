// SurgeLite transient engine: method of characteristics on exact geometry.
//
// What it does better than a plain fixed-grid MOC:
//  • Exact geometry: the time step is chosen so every pipe's wave speed is adjusted by less than
//    `settings.maxAdjust` (default 0.5 %); pipe lengths are never changed.
//  • Column separation by the discrete gas cavity model (DGCM, Wylie 1984; Bergant & Simpson),
//    solved in closed form at every computational section — no spurious vapour-pressure spikes.
//  • Unsteady friction (Brunone–Vítkovský form with Vardy's shear decay coefficient).
//  • Implicit device boundaries: pump run-down with inertia and non-return valve, surge vessel
//    (polytropic gas, separate in/out losses), air valve (Wylie–Streeter air-flow model),
//    pressure relief valve, pressure-dependent demands.
import { frictionF, omegaRated, pipeR, pumpCurve, pumpHeadAt, pumpQuadratic, pumpTorqueQuadratic, solveDense, type PumpCurve } from './hydraulics';
import { solveSteady, type SteadyResult } from './steady';
import { G, HB, HV, RHO, area, type Network, type NetNode } from './types';

const RAIR = 287.1;
const TAIR = 293.15;
const CD_AIR = 0.6;

export interface PipeEnvelope {
  id: string;
  s: Float64Array; // positions of computational points, m
  z: Float64Array; // elevations
  hSteady: Float64Array;
  hMax: Float64Array;
  hMin: Float64Array;
  cavMax: Float64Array; // largest cavity volume seen at each point, m³
  tMax: Float64Array; // time of maximum head
  tMin: Float64Array;
}

export interface TransientResult {
  ok: true;
  dt: number;
  steps: number;
  reaches: number;
  maxAdjust: number;
  pipeAdjust: Record<string, number>;
  /** Pipes modelled as rigid columns (too short to carry a wave at this time step). */
  rigidPipes: string[];
  times: Float64Array; // frame times
  nodeHead: Record<string, Float32Array>; // per frame
  frameSamples: Record<string, Float64Array>; // sample positions per pipe for animation
  frameHeads: Record<string, Float32Array>; // frames × samples, row-major
  /** Mid-pipe flow per frame, m³/s (positive from → to), for flow animation. */
  frameFlows: Record<string, Float32Array>;
  envelopes: PipeEnvelope[];
  nodeMax: Record<string, number>;
  nodeMin: Record<string, number>;
  vessels: Record<string, { gas: Float32Array; flow: Float32Array; minGas: number; maxGas: number; volume: number; emptied: boolean }>;
  pumps: Record<string, { speed: Float32Array; flow: Float32Array; reverseFlow: boolean }>;
  airValves: Record<string, { air: Float32Array; maxAir: number }>;
  valves: Record<string, { opening: Float32Array }>;
  steady: { heads: Record<string, number>; flows: Record<string, number> };
  warnings: string[];
  runtimeMs: number;
}

export interface RunOptions {
  /** Multiply all wave speeds (uncertainty runs). */
  waveFactor?: number;
  /** Multiply valve stroke times. */
  strokeFactor?: number;
  /** Multiply pump inertias. */
  inertiaFactor?: number;
  /** Frames kept for animation. */
  frames?: number;
  /** Skip per-frame storage (sizing loops only need envelopes). */
  envelopeOnly?: boolean;
  steady?: SteadyResult;
  /** Upper limit on the time step (convergence studies). */
  dtMax?: number;
  /** Keep each pipe's friction factor at its steady value (for comparison with codes that do this). */
  constantFriction?: boolean;
  /** Force this time step and round every pipe to whole reaches, as fixed-step codes do (comparison runs only). */
  fixedDt?: number;
  /** Turn column separation off: heads may fall below vapour pressure (for comparison with codes without a cavity model). */
  noCavitation?: boolean;
}

/** Pick the largest time step that keeps every pipe's wave-speed adjustment under the tolerance. */
export function selectTimeStep(
  travel: number[],
  maxAdjust: number,
  maxReaches: number,
  dtMax: number,
): { dt: number; N: number[]; err: number } {
  const tmin = Math.min(...travel);
  let best = { dt: tmin, N: travel.map((t) => Math.max(1, Math.round(t / tmin))), err: Infinity };
  const n0 = Math.max(1, Math.ceil(tmin / dtMax));
  for (let n = n0; n < n0 + 20000; n++) {
    const dt = tmin / n;
    let reaches = 0;
    let err = 0;
    const N = travel.map((t) => {
      const k = Math.max(1, Math.round(t / dt));
      reaches += k;
      err = Math.max(err, Math.abs(t / (k * dt) - 1));
      return k;
    });
    if (reaches > maxReaches) break;
    if (err < best.err) best = { dt, N, err };
    if (err <= maxAdjust) return { dt, N, err };
  }
  return best;
}

/** Vardy's shear decay coefficient → Brunone k = √C* / 2. */
function brunoneK(re: number): number {
  const cstar = re < 2300 ? 0.00476 : 7.41 / re ** Math.log10(14.3 / re ** 0.05);
  return Math.sqrt(cstar) / 2;
}

interface PipeState {
  N: number;
  dx: number;
  a: number;
  B: number;
  A: number;
  D: number;
  rough: number;
  minorPerReach: number;
  kUF: number;
  z: Float64Array;
  C3: Float64Array; // DGCM gas constant per point
  H: Float64Array;
  Qu: Float64Array;
  Qd: Float64Array;
  Qm1: Float64Array; // mean flow at previous step (unsteady friction)
  V: Float64Array; // cavity volume per interior point
  fR: Float64Array; // reach resistance per point (quasi-steady friction, refreshed every few steps)
  Hn: Float64Array;
  Qun: Float64Array;
  Qdn: Float64Array;
  from: number;
  to: number;
  CP: number; // characteristic arriving at the `to` node
  CM: number; // characteristic arriving at the `from` node
  env: PipeEnvelope;
  samples: Int32Array;
  pipeIndex: number;
}

type Element =
  | { kind: 'pump'; idx: number; ids: string[]; m: number; curve: PumpCurve; i: number; j: number; Q: number; alpha: number; alphaSet: number; tripped: boolean; on: boolean; closed: boolean; check: boolean; T: number; I: number; w: number; a: number; b: number; c: number; ta: number; tb: number; tc: number }
  | { kind: 'valve'; idx: number; i: number; j: number; Q: number; open: number; closed: boolean; check: boolean; kq: number }
  | { kind: 'rigid'; idx: number; i: number; j: number; Q: number; Qold: number; closed: boolean; check: false; inert: number; pipe: number };

export function runTransient(net: Network, opt: RunOptions = {}): TransientResult {
  const t0 = performance.now();
  const warnings: string[] = [];
  const st = net.settings;
  const steady = opt.steady ?? solveSteady(net);
  // constant-power pumps have no physical curve: use EPANET's one-point curve through the steady duty
  if (net.pumps.some((p) => p.power)) {
    net = { ...net, pumps: net.pumps.map((p) => {
      if (!p.power) return p;
      const q = Math.max(steady.flows.get(p.id) ?? 0, 1e-4);
      return { ...p, power: undefined, curve: [[q, (p.power * 1000) / (RHO * G * q)]] as [number, number][] };
    }) };
    warnings.push('Constant-power pumps were given a curve through their steady duty point for the transient.');
  }
  warnings.push(...steady.warnings);
  const nodes = net.nodes;
  const nIdx = new Map(nodes.map((n, i) => [n.id, i]));
  const NN = nodes.length;
  const ev = net.event;

  // ── time step and geometry ─────────────────────────────────────────────
  const waveF = opt.waveFactor ?? 1;
  const livePipes = net.pipes.filter((p) => !p.closed);
  const allTravel = livePipes.map((p) => p.length / (p.wavespeed * waveF));
  // very short pipes carry no meaningful wave: model them as rigid columns instead of distorting wave speeds
  const rigidT = st.rigidTravel > 0 ? st.rigidTravel : Math.min(0.02, 0.05 * Math.max(...allTravel, 0));
  const openPipes = livePipes.filter((_, k) => allTravel[k] >= rigidT || livePipes.length === 1);
  const rigidPipes = livePipes.filter((p) => !openPipes.includes(p));
  if (openPipes.length === 0) throw new Error('All pipes are shorter than the rigid-column limit; lower it in the settings.');
  const travel = openPipes.map((p) => p.length / (p.wavespeed * waveF));
  const stroke = (ev.duration ?? 0) * (opt.strokeFactor ?? 1);
  let dtMax = opt.dtMax ?? 0.05;
  if ((ev.kind === 'valveClose' || ev.kind === 'valveOpen') && stroke > 0) dtMax = Math.min(dtMax, Math.max(stroke / 20, 1e-3));
  const sel = opt.fixedDt
    ? (() => {
        const fdt = opt.fixedDt!;
        const N = travel.map((t) => Math.max(1, Math.round(t / fdt)));
        return { dt: fdt, N, err: Math.max(...travel.map((t, k) => Math.abs(t / (N[k] * fdt) - 1))) };
      })()
    : selectTimeStep(travel, st.maxAdjust, st.maxReaches, dtMax);
  const dt = sel.dt;
  if (sel.err > st.maxAdjust)
    warnings.push(`Wave speeds adjusted by up to ${(sel.err * 100).toFixed(2)} % (limit ${(st.maxAdjust * 100).toFixed(2)} %) within the ${st.maxReaches.toLocaleString()}-reach budget. Shorten very short pipes or raise the budget for exact geometry.`);
  const steps = Math.ceil(st.duration / dt);
  const pipeAdjust: Record<string, number> = {};

  const alpha0 = Math.max(st.gasFraction, 1e-12);
  const nodeC3 = new Float64Array(NN);
  const pipes: PipeState[] = openPipes.map((p, k) => {
    const N = sel.N[k];
    const a = p.length / (N * dt);
    pipeAdjust[p.id] = a / (p.wavespeed * waveF) - 1;
    const A = area(p.diameter);
    const dx = p.length / N;
    const from = nIdx.get(p.from)!;
    const to = nIdx.get(p.to)!;
    const z = new Float64Array(N + 1);
    const prof = [{ s: 0, z: nodes[from].elev }, ...(p.profile ?? []).filter((q) => q.s > 0 && q.s < p.length).sort((u, v) => u.s - v.s), { s: p.length, z: nodes[to].elev }];
    for (let i = 0; i <= N; i++) {
      const s = i * dx;
      let m = 0;
      while (m < prof.length - 2 && prof[m + 1].s < s) m++;
      const r = (s - prof[m].s) / Math.max(prof[m + 1].s - prof[m].s, 1e-9);
      z[i] = prof[m].z + r * (prof[m + 1].z - prof[m].z);
    }
    const C3 = new Float64Array(N + 1);
    for (let i = 1; i < N; i++) C3[i] = alpha0 * A * dx * HB;
    nodeC3[from] += alpha0 * A * (dx / 2) * HB;
    nodeC3[to] += alpha0 * A * (dx / 2) * HB;
    const q0 = steady.flows.get(p.id) ?? 0;
    const re = (Math.abs(q0) / A) * p.diameter / 1.004e-6;
    const h1 = steady.heads.get(p.from)!;
    const h2 = steady.heads.get(p.to)!;
    const H = new Float64Array(N + 1);
    for (let i = 0; i <= N; i++) H[i] = h1 + ((h2 - h1) * i) / N;
    const Qa = new Float64Array(N + 1).fill(q0);
    const nSamp = Math.min(N + 1, 25);
    const samples = new Int32Array(nSamp);
    for (let k2 = 0; k2 < nSamp; k2++) samples[k2] = Math.round((k2 * N) / (nSamp - 1));
    const s = new Float64Array(N + 1);
    for (let i = 0; i <= N; i++) s[i] = i * dx;
    return {
      N, dx, a, B: a / (G * A), A, D: p.diameter, rough: p.roughness,
      minorPerReach: (p.minorLoss ?? 0) / (2 * G * A * A) / N,
      kUF: st.unsteadyFriction && q0 !== 0 ? brunoneK(Math.max(re, 1)) : 0,
      z, C3, H, Qu: Qa.slice(), Qd: Qa.slice(), Qm1: Qa.slice(), V: new Float64Array(N + 1),
      fR: new Float64Array(N + 1).fill((frictionF(p, q0, st.friction) * dx) / (2 * G * p.diameter * A * A) + (p.minorLoss ?? 0) / (2 * G * A * A) / N),
      Hn: new Float64Array(N + 1), Qun: new Float64Array(N + 1), Qdn: new Float64Array(N + 1),
      from, to, CP: 0, CM: 0,
      env: { id: p.id, s, z, hSteady: H.slice(), hMax: H.slice(), hMin: H.slice(), cavMax: new Float64Array(N + 1), tMax: new Float64Array(N + 1), tMin: new Float64Array(N + 1) },
      samples, pipeIndex: net.pipes.indexOf(p),
    };
  });

  // ── nodes and devices ──────────────────────────────────────────────────
  const Hn = new Float64Array(NN);
  const Hprev = new Float64Array(NN);
  nodes.forEach((n, i) => (Hprev[i] = Hn[i] = steady.heads.get(n.id)!));
  const isRes = nodes.map((n) => n.kind === 'reservoir');
  const demK = new Float64Array(NN); // orifice coefficient (pressure-dependent) or constant demand
  const demConst = new Float64Array(NN);
  nodes.forEach((n, i) => {
    const d = n.kind === 'reservoir' ? 0 : n.demand ?? 0;
    const p0 = Hprev[i] - n.elev;
    if (st.pressureDependentDemand && d > 0 && p0 > 0.5) demK[i] = d / Math.sqrt(p0);
    else demConst[i] = d;
  });
  const nodeV = new Float64Array(NN); // node cavity (gas) volume
  // surge vessels
  const vessels = nodes.map((n, i) => {
    if (!n.vessel || n.kind === 'reservoir') return null;
    const v = n.vessel;
    const Dv = Math.cbrt((2 * v.volume) / Math.PI); // vertical cylinder, height = 2 D
    const As = (Math.PI / 4) * Dv * Dv;
    const zl0 = n.elev + (v.volume - v.gasVolume) / As;
    const pAbs0 = Hprev[i] - zl0 + HB; // gas absolute head
    if (pAbs0 <= 0) warnings.push(`Surge vessel at ${n.id}: steady pressure is below vacuum; check its elevation.`);
    const Ac = area(v.connDiameter);
    return {
      node: i, cfg: v, As, Ac,
      C: Math.max(pAbs0, 0.5) * v.gasVolume ** v.n,
      Vg: v.gasVolume, Qs: 0, emptied: false,
      minGas: v.gasVolume, maxGas: v.gasVolume,
      rin: v.kIn / (2 * G * Ac * Ac), rout: v.kOut / (2 * G * Ac * Ac),
    };
  });
  const airv = nodes.map((n) => (n.airValve && n.kind !== 'reservoir' ? { m: 0, V: 0, Ain: area(n.airValve.inDiameter), Aout: area(n.airValve.outDiameter), maxAir: 0 } : null));

  // ── elements (pumps, valves) and clusters ──────────────────────────────
  const elements: Element[] = [];
  // identical pumps in parallel are merged into one exact equivalent element (m units)
  const pumpGroups = new Map<string, number[]>();
  net.pumps.forEach((p, k) => {
    const trip = ev.kind === 'pumpTrip' && ev.targets.includes(p.id);
    const key = JSON.stringify([p.from, p.to, p.curve, p.efficiency, p.speed, p.inertia, p.checkValve, p.on, trip]);
    pumpGroups.set(key, [...(pumpGroups.get(key) ?? []), k]);
    if (trip && !p.on) warnings.push(`Pump ${p.id} is set to trip but is not running.`);
  });
  for (const ks of pumpGroups.values()) {
    const p = net.pumps[ks[0]];
    const m = ks.length;
    const { a, b, c } = pumpQuadratic(p);
    const tq = pumpTorqueQuadratic(p);
    const q = ks.reduce((sum, k) => sum + (steady.flows.get(net.pumps[k].id) ?? 0), 0);
    const e: Extract<Element, { kind: 'pump' }> = {
      kind: 'pump', idx: ks[0], ids: ks.map((k) => net.pumps[k].id), m, curve: pumpCurve(p), i: nIdx.get(p.from)!, j: nIdx.get(p.to)!, Q: q, alpha: p.on ? 1 : 0, alphaSet: 1, tripped: false, on: p.on,
      closed: !p.on || q <= 0, check: p.checkValve, T: 0, I: p.inertia * (opt.inertiaFactor ?? 1), w: omegaRated(p),
      a, b: b / m, c: c / (m * m), ta: tq.ta, tb: tq.tb / m, tc: tq.tc / (m * m),
    };
    e.T = e.ta * e.alpha ** 2 + e.tb * e.alpha * e.Q + e.tc * e.Q * e.Q;
    elements.push(e);
  }
  net.valves.forEach((v, k) => {
    const A = area(v.diameter);
    elements.push({ kind: 'valve', idx: k, i: nIdx.get(v.from)!, j: nIdx.get(v.to)!, Q: steady.flows.get(v.id) ?? 0, open: v.opening, closed: v.opening <= 0, check: !!v.check, kq: v.k0 / (2 * G * A * A) });
  });
  rigidPipes.forEach((p) => {
    const k = net.pipes.indexOf(p);
    const q = steady.flows.get(p.id) ?? 0;
    elements.push({ kind: 'rigid', idx: k, i: nIdx.get(p.from)!, j: nIdx.get(p.to)!, Q: q, Qold: q, closed: false, check: false, inert: p.length / (G * area(p.diameter)), pipe: k });
  });
  const rigidR = (e: Extract<Element, { kind: 'rigid' }>, Q: number) => pipeR(net.pipes[e.pipe], Q, st.friction);
  const inCluster = new Int32Array(NN).fill(-1);
  const clusters: { nodes: number[]; els: number[] }[] = [];
  {
    const parent = nodes.map((_, i) => i);
    const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    elements.forEach((e) => (parent[find(e.i)] = find(e.j)));
    const map = new Map<number, number>();
    elements.forEach((e, k) => {
      const r = find(e.i);
      if (!map.has(r)) {
        map.set(r, clusters.length);
        clusters.push({ nodes: [], els: [] });
      }
      clusters[map.get(r)!].els.push(k);
    });
    nodes.forEach((_, i) => {
      const r = find(i);
      if (map.has(r)) {
        clusters[map.get(r)!].nodes.push(i);
        inCluster[i] = map.get(r)!;
      }
    });
  }

  // ── storage ────────────────────────────────────────────────────────────
  const frames = opt.envelopeOnly ? 0 : Math.min(opt.frames ?? 500, steps + 1);
  const every = frames ? Math.max(1, Math.floor(steps / (frames - 1))) : Infinity;
  const nFrames = frames ? Math.floor(steps / every) + 1 : 0;
  const times = new Float64Array(nFrames);
  const nodeHead: Record<string, Float32Array> = {};
  nodes.forEach((n) => (nodeHead[n.id] = new Float32Array(nFrames)));
  const frameSamples: Record<string, Float64Array> = {};
  const frameHeads: Record<string, Float32Array> = {};
  const frameFlows: Record<string, Float32Array> = {};
  pipes.forEach((p) => {
    frameFlows[p.env.id] = new Float32Array(nFrames);
    const id = p.env.id;
    frameSamples[id] = Float64Array.from(p.samples, (i) => i * p.dx);
    frameHeads[id] = new Float32Array(nFrames * p.samples.length);
  });
  const rigidEnv = rigidPipes.map((p) => {
    const i = nIdx.get(p.from)!, j = nIdx.get(p.to)!;
    const s2 = Float64Array.from([0, p.length]);
    const z2 = Float64Array.from([nodes[i].elev, nodes[j].elev]);
    const h2 = Float64Array.from([Hn[i], Hn[j]]);
    frameSamples[p.id] = s2;
    frameHeads[p.id] = new Float32Array(nFrames * 2);
    frameFlows[p.id] = new Float32Array(nFrames);
    return { i, j, env: { id: p.id, s: s2, z: z2, hSteady: h2.slice(), hMax: h2.slice(), hMin: h2.slice(), cavMax: new Float64Array(2), tMax: new Float64Array(2), tMin: new Float64Array(2) } as PipeEnvelope };
  });
  const vesselOut: TransientResult['vessels'] = {};
  vessels.forEach((v) => v && (vesselOut[nodes[v.node].id] = { gas: new Float32Array(nFrames), flow: new Float32Array(nFrames), minGas: v.Vg, maxGas: v.Vg, volume: v.cfg.volume, emptied: false }));
  const pumpOut: TransientResult['pumps'] = {};
  elements.forEach((e) => e.kind === 'pump' && e.ids.forEach((id) => (pumpOut[id] = { speed: new Float32Array(nFrames), flow: new Float32Array(nFrames), reverseFlow: false })));
  const airOut: TransientResult['airValves'] = {};
  airv.forEach((a, i) => a && (airOut[nodes[i].id] = { air: new Float32Array(nFrames), maxAir: 0 }));
  const valveOut: TransientResult['valves'] = {};
  elements.forEach((e) => e.kind === 'valve' && (valveOut[net.valves[e.idx].id] = { opening: new Float32Array(nFrames) }));
  const nodeMax = new Float64Array(NN).fill(-Infinity);
  const nodeMin = new Float64Array(NN).fill(Infinity);

  // Standard gate-valve table: 1/K relative to fully open, at 0, 10, … 100 % stroke (as used by TSNet and textbooks)
  const GATE = [0, 0.0167, 0.0313, 0.0556, 0.1, 0.17, 0.333, 0.625, 1.25, 2.5, 5].map((v) => v / 5);
  const gateArea = (stroke01: number) => {
    const x = Math.max(0, Math.min(1, stroke01)) * 10;
    const i = Math.min(9, Math.floor(x));
    return Math.sqrt(GATE[i] + (GATE[i + 1] - GATE[i]) * (x - i));
  };
  const valveOpening = (e: Extract<Element, { kind: 'valve' }>, t: number) => {
    const v = net.valves[e.idx];
    const law = (s01: number) => (v.law === 'gate' ? gateArea(s01) : s01);
    if ((ev.kind !== 'valveClose' && ev.kind !== 'valveOpen') || !ev.targets.includes(v.id) || t <= ev.start) return law(v.opening);
    const tf = ev.finalOpening ?? (ev.kind === 'valveClose' ? 0 : 1);
    const s = stroke > 0 ? Math.min((t - ev.start) / stroke, 1) : 1;
    return law(tf + (v.opening - tf) * (1 - s) ** (ev.exponent ?? 1));
  };

  // ── node residual pieces ───────────────────────────────────────────────
  const Sc = new Float64Array(NN);
  const Sb = new Float64Array(NN);
  // with column separation off, the vapour limit is moved far below any real head
  const HBc = opt.noCavitation ? HB + 1e5 : HB;
  const vapourH = (i: number) => nodes[i].elev - HBc + HV;
  /** Net inflow to node i from everything except elements, at head H (and the device states it implies). */
  const nodeFlow = (i: number, H: number, qext = 0): number => {
    const n = nodes[i];
    let q = Sc[i] - Sb[i] * H + qext;
    const p = H - n.elev;
    q -= demConst[i] + (demK[i] > 0 ? demK[i] * Math.sqrt(Math.max(p, 0)) : 0);
    if (n.relief && p > n.relief.setHead) q -= n.relief.capacity * Math.sqrt((p - n.relief.setHead) / 10);
    const vs = vessels[i];
    if (vs) q -= vesselFlow(vs, H);
    const av = airv[i];
    if (av) q += airCavityRate(av, H, n);
    else q += (gasVolume(nodeC3[i], H, n.elev) - nodeV[i]) / dt;
    return q;
  };
  function gasVolume(C3: number, H: number, z: number) {
    const y = H - z + HBc - HV;
    return y > 1e-14 ? C3 / y : C3 / 1e-14;
  }
  function vesselFlow(vs: NonNullable<(typeof vessels)[number]>, H: number) {
    // flow into the vessel that balances node head with vessel liquid head + connection loss
    const f = (Qs: number) => {
      let Vg = vs.Vg - (dt * (Qs + vs.Qs)) / 2;
      if (Vg >= vs.cfg.volume) Vg = vs.cfg.volume;
      if (Vg < 1e-6) Vg = 1e-6;
      const zl = nodes[vs.node].elev + (vs.cfg.volume - Vg) / vs.As;
      const hv = zl + vs.C / Vg ** vs.cfg.n - HB;
      return H - hv - (Qs >= 0 ? vs.rin : vs.rout) * Qs * Math.abs(Qs);
    };
    let lo = -50, hi = 50;
    // outflow cannot exceed what is left in the vessel
    const qMinEmpty = (-2 * (vs.cfg.volume - vs.Vg)) / dt - vs.Qs;
    if (lo < qMinEmpty) lo = qMinEmpty;
    let flo = f(lo), fhi = f(hi);
    if (flo <= 0) return lo; // empty: no more outflow possible
    if (fhi >= 0) return hi;
    let q = vs.Qs;
    if (q <= lo || q >= hi) q = (lo + hi) / 2;
    for (let k = 0; k < 60; k++) {
      const fq = f(q);
      if (Math.abs(fq) < 1e-10) break;
      if (fq > 0) { lo = q; flo = fq; } else { hi = q; fhi = fq; }
      const h = 1e-6 * Math.max(1, Math.abs(q));
      const d = (f(q + h) - fq) / h;
      let qn = d < 0 ? q - fq / d : (lo + hi) / 2;
      if (!(qn > lo && qn < hi)) qn = (lo + hi) / 2;
      if (Math.abs(qn - q) < 1e-12) { q = qn; break; }
      q = qn;
    }
    return q;
  }
  function airMassRate(p: number, m: number, av: NonNullable<(typeof airv)[number]>) {
    const pa = RHO * G * HB;
    const rhoa = pa / (RAIR * TAIR);
    if (p < pa) {
      if (p > 0.528 * pa) return CD_AIR * av.Ain * Math.sqrt(Math.max(7 * pa * rhoa * ((p / pa) ** 1.4286 - (p / pa) ** 1.714), 0));
      return (CD_AIR * av.Ain * 0.686 * pa) / Math.sqrt(RAIR * TAIR);
    }
    if (m <= 0) return 0;
    if (p < 1.893 * pa) return -CD_AIR * av.Aout * p * Math.sqrt(7 / (RAIR * TAIR)) * Math.sqrt(Math.max((pa / p) ** 1.4286 - (pa / p) ** 1.714, 0));
    return (-CD_AIR * av.Aout * 0.686 * p) / Math.sqrt(RAIR * TAIR);
  }
  function airState(av: NonNullable<(typeof airv)[number]>, H: number, n: NetNode) {
    const p = Math.max(RHO * G * (H - n.elev + HB), 500);
    const m = Math.max(av.m + dt * airMassRate(p, av.m, av), 0);
    const V = m > 0 ? (m * RAIR * TAIR) / p : 0;
    return { m, V };
  }
  function airCavityRate(av: NonNullable<(typeof airv)[number]>, H: number, n: NetNode) {
    return (airState(av, H, n).V - av.V) / dt;
  }

  /** Scalar node solve: nodeFlow(H) is monotone decreasing; safeguarded Newton. */
  const solveNode = (i: number, qext = 0): number => {
    const n = nodes[i];
    let lo = vapourH(i) + 1e-13;
    let hi = Math.max(Hprev[i], lo) + 50;
    while (nodeFlow(i, hi, qext) > 0 && hi < 1e6) hi += Math.max(100, hi - lo);
    let H = Math.min(Math.max(Hprev[i], lo + 1e-9), hi);
    for (let k = 0; k < 80; k++) {
      const f = nodeFlow(i, H, qext);
      if (Math.abs(f) < 1e-11) break;
      if (f > 0) lo = H; else hi = H;
      const h = 1e-5;
      const d = (nodeFlow(i, H + h, qext) - f) / h;
      let Hn2 = d < 0 ? H - f / d : (lo + hi) / 2;
      if (!(Hn2 > lo && Hn2 < hi)) Hn2 = (lo + hi) / 2;
      if (Math.abs(Hn2 - H) < 1e-9) { H = Hn2; break; }
      H = Hn2;
      void n;
    }
    return H;
  };

  /** Closed-form DGCM solve for a plain node (no devices, constant demand). */
  const plainNode = (i: number) => !nodes[i].relief && !vessels[i] && !airv[i] && demK[i] === 0;
  const dgcm = (sb: number, sc: number, qext: number, z: number, C3: number, Vold: number) => {
    const E = Vold + dt * (sb * (z - HBc + HV) - sc - qext);
    const disc = Math.sqrt(E * E + 4 * dt * sb * C3);
    const y = E > 0 ? (2 * C3) / (E + disc) : (-E + disc) / (2 * dt * sb);
    return { H: y + z - HBc + HV, V: C3 / Math.max(y, 1e-12) };
  };

  // element helpers
  const elFlowAt = (e: Element, Hi: number, Hj: number, Q: number, alpha: number): number => {
    if (e.closed) return Q; // residual Q = 0
    if (e.kind === 'valve') return e.kq * Q * Math.abs(Q) - e.open * e.open * (Hi - Hj);
    if (e.kind === 'rigid') return (e.inert * (Q - e.Qold)) / dt + rigidR(e, Q) * Q * Math.abs(Q) - (Hi - Hj);
    return Hj - Hi - pumpHeadAt(e.curve, Q / e.m, alpha);
  };


  /** Robust solve for a cluster with one element between two nodes: bracketed search on the element flow. */
  const solveSingle = (e: Element) => {
    const headAt = (i: number, qext: number) => (isRes[i] ? Hn[i] : solveNode(i, qext));
    const alphaOf = (Q: number) => {
      if (e.kind !== 'pump') return 0;
      if (!e.tripped) return e.on ? e.alphaSet : 0;
      const k = dt / (2 * e.I * e.w);
      const A = k * e.ta, B = 1 + k * e.tb * Q, C = k * e.tc * Q * Q - e.alpha + k * e.T;
      let al = Math.abs(A) < 1e-14 ? -C / B : (-B + Math.sqrt(Math.max(B * B - 4 * A * C, 0))) / (2 * A);
      if (!Number.isFinite(al) || al < 0) al = 0;
      return al;
    };
    const forcedShut = e.kind === 'valve' ? e.open <= 0 : e.kind === 'pump' ? !e.on : false;
    const finish = (Q: number, shut: boolean) => {
      if (!isRes[e.i]) Hn[e.i] = headAt(e.i, -Q);
      if (!isRes[e.j]) Hn[e.j] = headAt(e.j, Q);
      e.Q = Q;
      e.closed = shut;
      if (e.kind === 'pump') e.alpha = alphaOf(Q);
    };
    if (forcedShut) return finish(0, true);
    const res = (Q: number) => {
      const Hi = headAt(e.i, -Q);
      const Hj = headAt(e.j, Q);
      if (e.kind === 'valve') return e.kq * Q * Math.abs(Q) - e.open * e.open * (Hi - Hj);
      if (e.kind === 'rigid') return (e.inert * (Q - e.Qold)) / dt + rigidR(e, Q) * Q * Math.abs(Q) - (Hi - Hj);
      return Hj - Hi - pumpHeadAt(e.curve, Q / e.m, alphaOf(Q));
    };
    const hasCheck = e.check;
    if (hasCheck && res(0) >= 0) return finish(0, true); // non-return valve shut: flow would reverse
    // bracket the root (res is increasing in Q)
    let q0 = hasCheck ? Math.max(e.Q, 1e-9) : e.Q;
    let f0 = res(q0);
    let step = Math.max(Math.abs(q0) * 0.05, 1e-4);
    let lo = q0, hi = q0, flo = f0, fhi = f0;
    if (f0 > 0) {
      for (let k = 0; k < 80 && flo > 0; k++) {
        hi = lo; fhi = flo;
        lo = lo - step; step *= 2;
        if (hasCheck && lo < 0) lo = 0;
        flo = res(lo);
        if (hasCheck && lo === 0) break;
      }
      if (hasCheck && flo >= 0) return finish(0, true);
    } else {
      for (let k = 0; k < 80 && fhi < 0; k++) {
        lo = hi; flo = fhi;
        hi = hi + step; step *= 2;
        fhi = res(hi);
      }
    }
    // Illinois false position with bisection fallback
    let side = 0;
    let q = q0;
    for (let k = 0; k < 100; k++) {
      q = (lo * fhi - hi * flo) / (fhi - flo);
      if (!(q > Math.min(lo, hi) && q < Math.max(lo, hi))) q = 0.5 * (lo + hi);
      const f = res(q);
      if (Math.abs(f) < 1e-10 || Math.abs(hi - lo) < 1e-12 * Math.max(1, Math.abs(q))) break;
      if (f < 0) {
        lo = q; flo = f;
        if (side === -1) fhi /= 2;
        side = -1;
      } else {
        hi = q; fhi = f;
        if (side === 1) flo /= 2;
        side = 1;
      }
    }
    finish(q, false);
  };

  const solveCluster = (c: { nodes: number[]; els: number[] }) => {
    if (c.els.length === 1) return solveSingle(elements[c.els[0]]);
    for (let attempt = 0; attempt < 6; attempt++) {
      const free = c.nodes.filter((i) => !isRes[i]);
      const els = c.els.map((k) => elements[k]);
      const speedVars = els.filter((e) => e.kind === 'pump' && e.tripped) as Extract<Element, { kind: 'pump' }>[];
      const nv = free.length + els.length + speedVars.length;
      const x = new Array(nv);
      free.forEach((i, k) => (x[k] = Hprev[i]));
      els.forEach((e, k) => (x[free.length + k] = e.Q));
      speedVars.forEach((e, k) => (x[free.length + els.length + k] = e.alpha));
      const headOf = (i: number, v: number[]) => (isRes[i] ? Hn[i] : v[free.indexOf(i)]);
      const resid = (v: number[]) => {
        const r = new Array(nv).fill(0);
        free.forEach((i, k) => (r[k] = nodeFlow(i, Math.max(v[k], vapourH(i) + 1e-13))));
        els.forEach((e, k) => {
          const q = v[free.length + k];
          const fi = free.indexOf(e.i);
          const fj = free.indexOf(e.j);
          if (fi >= 0) r[fi] -= q;
          if (fj >= 0) r[fj] += q;
          const sv = e.kind === 'pump' && e.tripped ? speedVars.indexOf(e) : -1;
          const alpha = e.kind === 'pump' ? (sv >= 0 ? v[free.length + els.length + sv] : e.on ? e.alphaSet : 0) : 0;
          r[free.length + k] = elFlowAt(e, headOf(e.i, v), headOf(e.j, v), q, alpha);
        });
        speedVars.forEach((e, k) => {
          const a = v[free.length + els.length + k];
          const q = v[free.length + els.indexOf(e)];
          const T = e.ta * a * a + e.tb * a * q + e.tc * q * q;
          r[free.length + els.length + k] = a - e.alpha + (dt * (T + e.T)) / (2 * e.I * e.w);
        });
        return r;
      };
      for (let it = 0; it < 60; it++) {
        const r = resid(x);
        const norm = Math.max(...r.map(Math.abs));
        if (norm < 1e-9) break;
        const J = Array.from({ length: nv }, () => new Array(nv).fill(0));
        for (let k = 0; k < nv; k++) {
          const h = 1e-6 * Math.max(1, Math.abs(x[k]));
          const xp = x.slice();
          xp[k] += h;
          const rp = resid(xp);
          for (let m = 0; m < nv; m++) J[m][k] = (rp[m] - r[m]) / h;
        }
        const dxv = solveDense(J, r.map((v) => -v));
        let lam = 1;
        for (let ls = 0; ls < 12; ls++) {
          const xn = x.map((v, k) => v + lam * dxv[k]);
          free.forEach((i, k) => (xn[k] = Math.max(xn[k], vapourH(i) + 1e-13)));
          speedVars.forEach((_, k) => (xn[free.length + els.length + k] = Math.max(xn[free.length + els.length + k], 0)));
          const rn = resid(xn);
          if (Math.max(...rn.map(Math.abs)) < norm || ls === 11) {
            for (let k = 0; k < nv; k++) x[k] = xn[k];
            break;
          }
          lam /= 2;
        }
      }
      // status changes (non-return valves)
      let changed = false;
      els.forEach((e, k) => {
        const q = x[free.length + k];
        const hasCheck = e.check;
        if (!hasCheck) return;
        const Hi = headOf(e.i, x);
        const Hj = headOf(e.j, x);
        if (!e.closed && q < -1e-9) {
          e.closed = true;
          changed = true;
        } else if (e.closed) {
          const sv = e.kind === 'pump' && e.tripped ? speedVars.indexOf(e) : -1;
          const alpha = e.kind === 'pump' ? (sv >= 0 ? x[free.length + els.length + sv] : e.on ? e.alphaSet : 0) : 0;
          const lift = e.kind === 'pump' ? pumpHeadAt(e.curve, 0, alpha) : 0;
          if (Hi + lift > Hj + 1e-6 && (e.kind === 'valve' ? e.open > 0 : alpha > 0.01)) {
            e.closed = false;
            changed = true;
          }
        }
      });
      if (!changed || attempt === 5) {
        free.forEach((i, k) => (Hn[i] = x[k]));
        els.forEach((e, k) => (e.Q = e.closed ? 0 : x[free.length + k]));
        speedVars.forEach((e, k) => {
          e.alpha = x[free.length + els.length + k];
        });
        return;
      }
    }
  };

  // ── time loop ──────────────────────────────────────────────────────────
  let frame = 0;
  const record = (t: number) => {
    if (!frames) return;
    times[frame] = t;
    nodes.forEach((n, i) => (nodeHead[n.id][frame] = Hn[i]));
    pipes.forEach((p) => {
      const arr = frameHeads[p.env.id];
      const ns = p.samples.length;
      for (let k = 0; k < ns; k++) arr[frame * ns + k] = p.H[p.samples[k]];
      const mid = p.samples[ns >> 1];
      frameFlows[p.env.id][frame] = (p.Qu[mid] + p.Qd[mid]) / 2;
    });
    rigidEnv.forEach((r) => {
      const arr = frameHeads[r.env.id];
      arr[frame * 2] = Hn[r.i];
      arr[frame * 2 + 1] = Hn[r.j];
    });
    vessels.forEach((v) => {
      if (!v) return;
      const o = vesselOut[nodes[v.node].id];
      o.gas[frame] = v.Vg;
      o.flow[frame] = v.Qs;
    });
    elements.forEach((e) => {
      if (e.kind === 'pump') {
        for (const id of e.ids) {
          pumpOut[id].speed[frame] = e.alpha;
          pumpOut[id].flow[frame] = e.Q / e.m;
        }
      } else if (e.kind === 'valve') valveOut[net.valves[e.idx].id].opening[frame] = e.open;
      else if (e.kind === 'rigid') frameFlows[net.pipes[e.pipe].id][frame] = e.Q;
    });
    airv.forEach((a, i) => a && (airOut[nodes[i].id].air[frame] = a.V));
    frame++;
  };
  record(0);

  let huBuf = new Float64Array(16);
  for (let step = 1; step <= steps; step++) {
    const t = step * dt;
    // events
    elements.forEach((e) => {
      if (e.kind === 'pump' && ev.kind === 'pumpTrip' && ev.targets.includes(e.ids[0]) && t >= ev.start && e.on) {
        if (ev.pumpMode === 'ramp') {
          // controlled stop: speed forced linearly to zero over the ramp time
          const T = Math.max((ev.duration ?? 0) * (opt.strokeFactor ?? 1), 1e-9);
          e.alphaSet = Math.max(0, 1 - (t - ev.start) / T);
          e.alpha = e.alphaSet;
        } else if (!e.tripped) e.tripped = true;
      }
      if (e.kind === 'valve') {
        e.open = valveOpening(e, t);
        if (e.open <= 0) e.closed = true;
        else if (e.closed && !e.check) e.closed = false;
      }
    });
    Sc.fill(0);
    Sb.fill(0);
    // interior points + characteristics toward the nodes
    for (const p of pipes) {
      const { N, B, H, Qu, Qd, Qm1, A, dx } = p;
      if (step % 8 === 1 && !opt.constantFriction) {
        const pipe = net.pipes[p.pipeIndex];
        const c = dx / (2 * G * p.D * A * A);
        for (let i = 0; i <= N; i++) p.fR[i] = frictionF(pipe, 0.5 * (Qu[i] + Qd[i]), st.friction) * c + p.minorPerReach;
      }
      const fR = p.fR;
      const kU = p.kUF > 0 ? (p.kUF * dx) / (G * A) : 0;
      // unsteady friction head term at every point, computed once per step
      const hu = huBuf.length >= N + 1 ? huBuf : (huBuf = new Float64Array(N + 1));
      if (kU > 0) {
        for (let i = 0; i <= N; i++) {
          const qm = 0.5 * (Qu[i] + Qd[i]);
          const ia = i > 0 ? i - 1 : 0, ib = i < N ? i + 1 : N;
          const dqdx = (0.5 * (Qu[ib] + Qd[ib]) - 0.5 * (Qu[ia] + Qd[ia])) / ((ib - ia) * dx);
          hu[i] = kU * ((qm - Qm1[i]) / dt + p.a * (qm > 0 ? 1 : qm < 0 ? -1 : 0) * Math.abs(dqdx));
        }
      } else hu.fill(0, 0, N + 1);
      const sb = 2 / B, dtsb = dt * sb, z = p.z, C3a = p.C3, V = p.V, Hn2 = p.Hn, Qun = p.Qun, Qdn = p.Qdn;
      const offs = -HBc + HV;
      for (let i = 1; i < N; i++) {
        const qa = Qd[i - 1], qb = Qu[i + 1];
        const CP = H[i - 1] + B * qa - fR[i - 1] * qa * Math.abs(qa) - hu[i - 1];
        const CM = H[i + 1] - B * qb + fR[i + 1] * qb * Math.abs(qb) + hu[i + 1];
        // discrete gas cavity model, closed form (ψ = 1)
        const C3 = C3a[i];
        const E = V[i] + dt * (sb * (z[i] + offs) - (CP + CM) / B);
        const disc = Math.sqrt(E * E + 4 * dtsb * C3);
        const y = E > 0 ? (2 * C3) / (E + disc) : (-E + disc) / (2 * dtsb);
        const Hh = y + z[i] + offs;
        Hn2[i] = Hh;
        V[i] = C3 / (y > 1e-12 ? y : 1e-12);
        Qun[i] = (CP - Hh) / B;
        Qdn[i] = (Hh - CM) / B;
      }
      const qa = Qd[N - 1];
      p.CP = H[N - 1] + B * qa - fR[N - 1] * qa * Math.abs(qa) - hu[N - 1];
      const qb = Qu[1];
      p.CM = H[1] - B * qb + fR[1] * qb * Math.abs(qb) + hu[1];
      Sc[p.to] += p.CP / B;
      Sb[p.to] += 1 / B;
      Sc[p.from] += p.CM / B;
      Sb[p.from] += 1 / B;
    }
    // node heads
    for (let i = 0; i < NN; i++) {
      if (isRes[i]) Hn[i] = Hprev[i];
    }
    clusters.forEach((c) => solveCluster(c));
    for (let i = 0; i < NN; i++) {
      if (isRes[i] || inCluster[i] >= 0) continue;
      if (Sb[i] === 0) { Hn[i] = Hprev[i]; continue; }
      if (plainNode(i)) {
        const r = dgcm(Sb[i], Sc[i], -demConst[i], nodes[i].elev, nodeC3[i], nodeV[i]);
        Hn[i] = r.H;
      } else Hn[i] = solveNode(i);
    }
    // commit device states at the solved heads
    for (let i = 0; i < NN; i++) {
      if (isRes[i]) continue;
      const H = Hn[i];
      const vs = vessels[i];
      if (vs) {
        const q = vesselFlow(vs, H);
        let Vg = vs.Vg - (dt * (q + vs.Qs)) / 2;
        if (Vg >= vs.cfg.volume * 0.999) { vs.emptied = true; Vg = Math.min(Vg, vs.cfg.volume); }
        vs.Vg = Math.max(Vg, 1e-6);
        vs.Qs = q;
        vs.minGas = Math.min(vs.minGas, vs.Vg);
        vs.maxGas = Math.max(vs.maxGas, vs.Vg);
      }
      const av = airv[i];
      if (av) {
        const s2 = airState(av, H, nodes[i]);
        av.m = s2.m;
        av.V = s2.V;
        av.maxAir = Math.max(av.maxAir, av.V);
      } else nodeV[i] = gasVolume(nodeC3[i], H, nodes[i].elev);
      nodeMax[i] = Math.max(nodeMax[i], H);
      nodeMin[i] = Math.min(nodeMin[i], H);
    }
    elements.forEach((e) => {
      if (e.kind === 'rigid') e.Qold = e.Q;
      if (e.kind === 'pump') {
        e.T = e.ta * e.alpha ** 2 + e.tb * e.alpha * e.Q + e.tc * e.Q * e.Q;
        if (e.Q < -1e-6) e.ids.forEach((id) => (pumpOut[id].reverseFlow = true));
      }
    });
    // pipe end points and swap
    for (const p of pipes) {
      const { N, B } = p;
      const Ht = Hn[p.to];
      p.Hn[N] = Ht;
      p.Qun[N] = p.Qdn[N] = (p.CP - Ht) / B;
      const Hf = Hn[p.from];
      p.Hn[0] = Hf;
      p.Qun[0] = p.Qdn[0] = (Hf - p.CM) / B;
      for (let i = 0; i <= N; i++) p.Qm1[i] = 0.5 * (p.Qu[i] + p.Qd[i]);
      [p.H, p.Hn] = [p.Hn, p.H];
      [p.Qu, p.Qun] = [p.Qun, p.Qu];
      [p.Qd, p.Qdn] = [p.Qdn, p.Qd];
      const env = p.env;
      for (let i = 0; i <= N; i++) {
        const h = p.H[i];
        if (h > env.hMax[i]) { env.hMax[i] = h; env.tMax[i] = t; }
        if (h < env.hMin[i]) { env.hMin[i] = h; env.tMin[i] = t; }
        if (p.V[i] > env.cavMax[i]) env.cavMax[i] = p.V[i];
      }
      // node cavities shown at pipe ends
      const vF = airv[p.from] ? 0 : nodeV[p.from];
      const vT = airv[p.to] ? 0 : nodeV[p.to];
      if (vF > env.cavMax[0]) env.cavMax[0] = vF;
      if (vT > env.cavMax[N]) env.cavMax[N] = vT;
    }
    for (const r of rigidEnv) {
      const e = r.env;
      for (const [k, node] of [[0, r.i], [1, r.j]] as const) {
        const h = Hn[node];
        if (h > e.hMax[k]) { e.hMax[k] = h; e.tMax[k] = t; }
        if (h < e.hMin[k]) { e.hMin[k] = h; e.tMin[k] = t; }
        const v = airv[node] ? 0 : nodeV[node];
        if (v > e.cavMax[k]) e.cavMax[k] = v;
      }
    }
    Hprev.set(Hn);
    if (frames && step % every === 0 && frame < nFrames) record(t);
    if (!Number.isFinite(Hn[0]) || Hn.some((h) => !Number.isFinite(h))) {
      warnings.push(`The solution became unstable at t = ${t.toFixed(3)} s. Check device data (vessel size, pump curve, inertia).`);
      break;
    }
  }

  vessels.forEach((v) => {
    if (!v) return;
    const o = vesselOut[nodes[v.node].id];
    o.minGas = v.minGas;
    o.maxGas = v.maxGas;
    o.emptied = v.emptied;
    if (v.emptied) warnings.push(`Surge vessel at ${nodes[v.node].id} emptied: it is too small or its initial water volume too low.`);
  });
  airv.forEach((a, i) => a && (airOut[nodes[i].id].maxAir = a.maxAir));
  Object.entries(pumpOut).forEach(([id, o]) => {
    if (o.reverseFlow) warnings.push(`Pump ${id} ran with reverse flow (no non-return valve). Results after flow reversal need full four-quadrant pump data.`);
  });
  const nodeMaxR: Record<string, number> = {};
  const nodeMinR: Record<string, number> = {};
  nodes.forEach((n, i) => {
    nodeMaxR[n.id] = Math.max(nodeMax[i], Hprev[i]);
    nodeMinR[n.id] = Math.min(nodeMin[i], Hprev[i]);
  });
  return {
    ok: true,
    dt,
    steps,
    reaches: sel.N.reduce((s, v) => s + v, 0),
    maxAdjust: sel.err,
    pipeAdjust,
    times,
    nodeHead,
    frameSamples,
    frameHeads,
    frameFlows,
    envelopes: [...pipes.map((p) => p.env), ...rigidEnv.map((r) => r.env)],
    rigidPipes: rigidPipes.map((p) => p.id),
    nodeMax: nodeMaxR,
    nodeMin: nodeMinR,
    vessels: vesselOut,
    pumps: pumpOut,
    airValves: airOut,
    valves: valveOut,
    steady: { heads: Object.fromEntries(steady.heads), flows: Object.fromEntries(steady.flows) },
    warnings,
    runtimeMs: performance.now() - t0,
  };
}
