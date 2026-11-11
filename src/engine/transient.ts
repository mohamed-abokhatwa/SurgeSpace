// SurgeSpace transient engine: method of characteristics on exact geometry.
//
// What it does better than a plain fixed-grid MOC:
//  • Exact geometry: the time step is chosen so every pipe's wave speed is adjusted by less than
//    `settings.maxAdjust` (default 0.5 %); pipe lengths are never changed.
//  • Column separation by the discrete gas cavity model (DGCM, Wylie 1984; Bergant & Simpson),
//    solved in closed form at every computational section — no spurious vapour-pressure spikes.
//  • Unsteady friction (Brunone–Vítkovský form with Vardy's shear decay coefficient).
//  • Implicit device boundaries: pump run-down with inertia and non-return valve; hydropneumatic tank
//    (vertical, horizontal or spherical; gas volume or bladder pre-charge; dip tube; connection inertia;
//    separate in/out losses or non-return valve with bypass); air valves (double-acting, three-stage
//    anti-slam, vacuum breaker, air release, manufacturer curves; Wylie–Streeter air flow); open surge
//    tank with overflow; one-way (feed) tank; surge anticipation valve; pressure relief valve;
//    pressure-dependent demands.
import { runRigid } from './rigid';
import { fourQuadrant, frictionF, omegaRated, pipeR, pumpCurve, pumpHeadAt, pumpQuadratic, pumpRatedQ, pumpTorqueQuadratic, solveDense, type FourQ, type PumpCurve } from './hydraulics';
import { solveSteady, type SteadyResult } from './steady';
import { G, HB, HV, NU, RHO, allEvents, applyFluid, area, type CheckValveSpec, type Network, type NetNode, type TransientEvent } from './types';
import { RAIR, TAIR, airValveMassRate, airValveModel, controlArea, dynamicReverseVelocity, interpTable, motorTorque, outletOpening, turbineFactors, prechargeGas, reliefFlow, savOpening, solveDecreasing, valveArea, vesselGeometry, waterDepthOf, waterVolumeAt } from './devices';
import { prepareNetwork } from './prepare';

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
  vessels: Record<string, { gas: Float32Array; flow: Float32Array; level: Float32Array; minGas: number; maxGas: number; volume: number; initialGas: number; emptied: boolean; minWater: number; bottom: number; top: number }>;
  /** Open surge tanks and one-way tanks: water surface elevation and flow into the tank (negative = out). */
  tanks: Record<string, { level: Float32Array; flow: Float32Array; minLevel: number; maxLevel: number; bottom: number; top: number; spilled: number; emptied: boolean; oneWay: boolean; chamber?: { level: Float32Array; minLevel: number; maxLevel: number } }>;
  /** Surge anticipation valves: opening (0–1) and discharge. */
  savs: Record<string, { opening: Float32Array; flow: Float32Array; opened: number; maxFlow: number }>;
  /** Pressure relief valves: discharge. */
  reliefs: Record<string, { flow: Float32Array; maxFlow: number; volume: number }>;
  pumps: Record<string, { speed: Float32Array; flow: Float32Array; reverseFlow: boolean }>;
  airValves: Record<string, { air: Float32Array; mass: Float32Array; maxAir: number }>;
  valves: Record<string, { opening: Float32Array; flow: Float32Array; speed?: Float32Array }>;
  /** Check valves (on pumps, valves and pipes), keyed by the pump, valve or pipe id. */
  checkValves: Record<string, { where: 'pump' | 'valve' | 'pipe'; mode: CheckValveSpec['mode']; flow: Float32Array; opening: Float32Array; closures: number; maxReverseVelocity: number; reverseVelocityAtClosure: number }>;
  /** Discharges to atmosphere / rupture disks. */
  outlets: Record<string, { flow: Float32Array; opening: Float32Array; openedAt: number; maxFlow: number; volume: number }>;
  /** Slams: check valves closing on reverse flow and air pockets closing at air valves. `joukowsky` is a·v/g for
   *  the velocity stopped; `rise` is the head jump the model computed at that node at closure (first 3 steps);
   *  `peak` is the highest head there in the following 2L/a (at most 2 s). */
  slams: { kind: 'checkValve' | 'airValve'; id: string; node: string; t: number; velocity: number; joukowsky: number; rise: number; peak: number; peakPressure: number }[];
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
  /** Viscoelastic creep: compliances (1/Pa), decay factors e^(−dt/τ), retarded strains per element and point,
   *  steady heads, and the stress per metre of head ρ g D / 2e. */
  ve?: { J: Float64Array; decay: Float64Array; eps: Float64Array; H0: Float64Array | null; fac: number; alpha: number };
}

/** State of a check valve that does not close ideally (delay / reverse velocity / dynamic characteristic). */
interface CvState {
  spec: CheckValveSpec;
  A: number; // bore area (per unit for merged pumps)
  kcv: number; // kOpen / (2 g A²)
  state: 'open' | 'closing' | 'closed';
  s: number; // disc opening during closure, 1 → 0
  tRev: number; // time the flow reversed (−1: forward)
  tStart: number; // time closure started
  vr: number; // reverse velocity that starts the closure
  ring: Float64Array; // recent velocities, for the deceleration
  nRing: number;
  vLast: number;
}

type Element =
  | { kind: 'pump'; idx: number; ids: string[]; m: number; curve: PumpCurve; i: number; j: number; Q: number; alpha: number; alphaSet: number; tripped: boolean; on: boolean; closed: boolean; check: boolean; cv?: CvState; T: number; I: number; w: number; a: number; b: number; c: number; ta: number; tb: number; tc: number; fq?: FourQ; motor?: { Tr: number; t0: number; on: boolean; T0: number }; vsd?: { node: number; z: number; set: number; kp: number; ti: number; min: number; max: number; rate: number; I: number; s0: number } }
  | { kind: 'valve'; idx: number; i: number; j: number; Q: number; open: number; base: number; closed: boolean; check: boolean; cv?: CvState; kq: number }
  | { kind: 'rigid'; idx: number; i: number; j: number; Q: number; Qold: number; closed: boolean; check: false; inert: number; pipe: number };

export function runTransient(net: Network, opt: RunOptions = {}): TransientResult {
  if (net.settings.engine === 'rigid') return runRigid(net, opt);
  const t0 = performance.now();
  const warnings: string[] = [];
  applyFluid(net.settings);
  net = prepareNetwork(net);
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
  // every operation of the run (main event + extra events); each element follows the first one that names it
  const evs = allEvents(net);
  const isValveEv = (e: TransientEvent) => e.kind === 'valveClose' || e.kind === 'valveOpen';
  const valveEv = new Map<string, TransientEvent>();
  const pumpEv = new Map<string, TransientEvent>();
  for (const e of evs) for (const id of e.targets) {
    if (isValveEv(e) && !valveEv.has(id)) valveEv.set(id, e);
    if (e.kind === 'pumpTrip' && !pumpEv.has(id)) pumpEv.set(id, e);
  }
  const curveOf = (e: TransientEvent) => (isValveEv(e) && e.curve && e.curve.length >= 2 ? [...e.curve].sort((a, b) => a[0] - b[0]).map(([tc, sc]) => [tc * (opt.strokeFactor ?? 1), sc] as [number, number]) : null);
  const evCurves = new Map(evs.map((e) => [e, curveOf(e)]));
  const strokeOfEv = (e: TransientEvent) => (e.duration ?? 0) * (opt.strokeFactor ?? 1);

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
  let dtMax = opt.dtMax ?? 0.05;
  for (const e of evs) {
    if (!isValveEv(e)) continue;
    const evCurve = evCurves.get(e);
    const stroke = strokeOfEv(e);
    if (evCurve) {
      const seg = Math.min(...evCurve.slice(1).map((c, k) => c[0] - evCurve[k][0]).filter((d) => d > 0), Infinity);
      if (Number.isFinite(seg)) dtMax = Math.min(dtMax, Math.max(seg / 20, 1e-3));
    } else if (stroke > 0) dtMax = Math.min(dtMax, Math.max(stroke / 20, 1e-3));
  }
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
    const re = (Math.abs(q0) / A) * p.diameter / NU;
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
      // free-gas volumes start at their equilibrium size at the steady pressure (no start-up disturbance)
      z, C3, H, Qu: Qa.slice(), Qd: Qa.slice(), Qm1: Qa.slice(), V: Float64Array.from(C3, (c, i) => { const y = H[i] - z[i] + (opt.noCavitation ? HB + 1e5 : HB) - HV; return y > 1e-9 ? c / y : 0; }),
      fR: new Float64Array(N + 1).fill((frictionF(p, q0, st.friction) * dx) / (2 * G * p.diameter * A * A) + (p.minorLoss ?? 0) / (2 * G * A * A) / N),
      Hn: new Float64Array(N + 1), Qun: new Float64Array(N + 1), Qdn: new Float64Array(N + 1),
      from, to, CP: 0, CM: 0,
      env: { id: p.id, s, z, hSteady: H.slice(), hMax: H.slice(), hMin: H.slice(), cavMax: new Float64Array(N + 1), tMax: new Float64Array(N + 1), tMin: new Float64Array(N + 1) },
      samples, pipeIndex: net.pipes.indexOf(p),
      ...(p.viscoelastic?.J.length && p.wall ? { ve: {
        J: Float64Array.from(p.viscoelastic.J, (j) => j * 1e-9),
        decay: Float64Array.from(p.viscoelastic.tau, (tau) => Math.exp(-dt / Math.max(tau, 1e-9))),
        eps: new Float64Array(p.viscoelastic.J.length * (N + 1)), H0: null, fac: (RHO * G * p.diameter) / (2 * p.wall / 1000),
        alpha: 2 * A * dx * ((RHO * G * p.diameter) / (2 * p.wall / 1000)) * p.viscoelastic.J.reduce((sum, j, k) => sum + j * 1e-9 * (1 - Math.exp(-dt / Math.max(p.viscoelastic!.tau[k] ?? 1, 1e-9))), 0),
      } } : {}),
    };
  });
  for (const p of net.pipes) if (p.viscoelastic?.J.length && !p.wall) warnings.push(`Pipe ${p.id}: viscoelastic data need the wall thickness; it was run as elastic.`);

  // ── nodes and devices ──────────────────────────────────────────────────
  const Hn = new Float64Array(NN);
  const Hprev = new Float64Array(NN);
  nodes.forEach((n, i) => (Hprev[i] = Hn[i] = steady.heads.get(n.id)!));
  const isRes = nodes.map((n) => n.kind === 'reservoir');
  // reservoirs with a time-varying head (tide, wave, upstream station): offset from the steady level
  const resSched = nodes.map((n) => (n.kind === 'reservoir' && n.headSchedule ? n.headSchedule : null));
  const resH0 = nodes.map((n) => n.head ?? n.elev);
  const demK = new Float64Array(NN); // orifice coefficient (pressure-dependent) or constant demand
  const demConst = new Float64Array(NN);
  nodes.forEach((n, i) => {
    const d = n.kind === 'reservoir' ? 0 : n.demand ?? 0;
    const p0 = Hprev[i] - n.elev;
    if (st.pressureDependentDemand && d > 0 && p0 > 0.5) demK[i] = d / Math.sqrt(p0);
    else demConst[i] = d;
  });
  const nodeV = new Float64Array(NN); // node cavity (gas) volume, starting at equilibrium with the steady head
  nodes.forEach((n, i) => { const y = Hprev[i] - n.elev + (opt.noCavitation ? HB + 1e5 : HB) - HV; nodeV[i] = y > 1e-9 ? nodeC3[i] / y : 0; });
  // hydropneumatic tanks (surge vessels)
  const vessels = nodes.map((n, i) => {
    if (!n.vessel || n.kind === 'reservoir') return null;
    const v = n.vessel;
    const geo = vesselGeometry(v);
    const bottom = v.bottomElev ?? n.elev;
    const Vt = v.volume;
    const gasHeadAt = (Vg: number) => Hprev[i] - (bottom + waterDepthOf(geo, Vt - Vg)) + HB; // absolute gas head
    let Vg0 = Math.min(Math.max(v.gasVolume, 1e-6), Vt);
    if (v.gasInput === 'precharge') {
      const pc = prechargeGas(Vt, v.prechargeHead ?? 0, gasHeadAt);
      Vg0 = pc.gas;
      if (!pc.holdsWater) warnings.push(`Air vessel at ${n.id}: the pre-charge pressure is at or above the operating pressure, so the tank holds no water. Lower the pre-charge.`);
    }
    const minWater = v.dipTubeHeight && v.dipTubeHeight > 0 ? waterVolumeAt(geo, v.dipTubeHeight) : 0;
    if (Vt - Vg0 < minWater) warnings.push(`Air vessel at ${n.id}: the initial water level is below the dip tube.`);
    const pAbs0 = gasHeadAt(Vg0);
    if (pAbs0 <= 0) warnings.push(`Surge vessel at ${n.id}: steady pressure is below vacuum; check its elevation.`);
    const Ac = area(v.connDiameter);
    const Ab = v.inlet === 'checkBypass' && v.bypassDiameter ? area(v.bypassDiameter) : 0;
    return {
      node: i, cfg: v, geo, bottom, Ac,
      C: Math.max(pAbs0, 0.5) * Vg0 ** v.n,
      Vg: Vg0, Vg0, Qs: 0, emptied: false,
      VgMax: Math.max(Vt - minWater, Vg0),
      minGas: Vg0, maxGas: Vg0,
      rin: Ab > 0 ? (v.bypassK ?? 1) / (2 * G * Ab * Ab) : v.kIn / (2 * G * Ac * Ac),
      rout: v.kOut / (2 * G * Ac * Ac),
      inert: (v.connLength ?? 0) / (G * Ac), // L/(gA): head per unit dQ/dt
    };
  });
  // open surge tanks and one-way (feed) tanks
  const tanks = nodes.map((n, i) => {
    if (!n.tank || n.kind === 'reservoir') return null;
    const t = n.tank;
    const As = area(t.diameter), Ac = area(t.connDiameter);
    let z0: number;
    if (t.oneWay) {
      z0 = t.initialLevel ?? t.bottomElev + 0.9 * (t.topElev - t.bottomElev);
      if (z0 >= Hprev[i]) warnings.push(`One-way tank at ${n.id}: its water level (${z0.toFixed(2)} m) is not below the steady head (${Hprev[i].toFixed(2)} m), so it would feed the pipe in steady state. Lower it.`);
    } else {
      z0 = Hprev[i];
      if (z0 > t.topElev) { warnings.push(`Standpipe at ${n.id}: the steady head (${z0.toFixed(2)} m) is above its top (${t.topElev} m); it would overflow continuously. Make it taller.`); }
      if (z0 < t.bottomElev) warnings.push(`Standpipe at ${n.id}: the steady head is below the tank bottom; the tank is empty.`);
      z0 = Math.max(t.bottomElev, Math.min(t.topElev, z0));
    }
    const curve = t.areaCurve && t.areaCurve.length >= 2 ? [...t.areaCurve].sort((p, q) => p[0] - q[0]) as [number, number][] : null;
    const d = t.differential && !t.oneWay ? t.differential : null;
    const Ar = d ? area(d.riserDiameter) : 0;
    // differential tank: the riser takes the place of the plain tank; the chamber is a second store behind the ports
    const areaAt = d ? () => Ar : (z: number) => (curve ? Math.max(interpTable(curve, z), 1e-6) : As);
    const diff = d ? { Ac: Math.max((curve ? interpTable(curve, z0) : As) - Ar, 1e-6), curve, Ar, zc: z0, Qp: 0, top: Math.min(d.riserTop ?? t.topElev, t.topElev), rp: 1 / (2 * G * (d.portCd ?? 0.6) ** 2 * Math.max(d.portArea, 1e-9) ** 2), minZ: z0, maxZ: z0 } : null;
    return { node: i, cfg: t, As: areaAt(z0), areaAt, z: z0, Qt: 0, minZ: z0, maxZ: z0, spilled: 0, emptied: false, oneWay: !!t.oneWay, rin: t.kIn / (2 * G * Ac * Ac), rout: t.kOut / (2 * G * Ac * Ac), diff };
  });
  // surge anticipation valves
  const savs = nodes.map((n, i) => (n.sav && n.kind !== 'reservoir' ? { node: i, cfg: n.sav, A: area(n.sav.diameter), cd: n.sav.cd ?? 0.6, tTrig: -1, open: 0, openUsed: 0, opened: 0, maxQ: 0, Q: 0 } : null));
  const reliefs = nodes.map((n, i) => (n.relief && n.kind !== 'reservoir' ? { node: i, cfg: n.relief, Q: 0, maxQ: 0, vol: 0 } : null));
  const airv = nodes.map((n) => (n.airValve && !n.airValve.treatAsJunction && n.kind !== 'reservoir' ? { m: 0, V: 0, model: airValveModel(n.airValve), maxAir: 0, hist: [0, 0, 0, 0] } : null));
  // discharges to atmosphere / rupture disks (closed in the steady state)
  const outlets = nodes.map((n, i) => {
    if (!n.outlet || n.kind === 'reservoir') return null;
    const o = n.outlet;
    if (o.trigger === 'pressure' && o.burstHead !== undefined && Hprev[i] - n.elev >= o.burstHead) warnings.push(`Burst disc at ${n.id}: the steady pressure is already above its bursting pressure.`);
    return { node: i, cfg: o, A: area(o.diameter), cd: o.cd ?? 0.6, tOpen: o.trigger === 'time' ? Math.max(o.time ?? 0, 0) : -1, open: 0, Q: 0, maxQ: 0, vol: 0 };
  });
  // pipes meeting each node (wave speed and area, for slam estimates)
  const nodePipes: { a: number; A: number; L: number }[][] = nodes.map(() => []);
  livePipes.forEach((p) => {
    const rec = { a: p.wavespeed * waveF, A: area(p.diameter), L: p.length };
    nodePipes[nIdx.get(p.from)!].push(rec);
    nodePipes[nIdx.get(p.to)!].push(rec);
  });
  const slams: TransientResult['slams'] = [];
  const pendingRise: { k: number; node: number; tEnd: number; h0: number; left: number }[] = [];
  const startSlam = (kind: 'checkValve' | 'airValve', id: string, node: number, t: number, velocity: number, aWave: number, h0: number) => {
    if (slams.filter((x) => x.id === id).length >= 50) return;
    const np = nodePipes[node];
    const L = np.length ? Math.min(...np.map((x) => x.L / x.a)) : 0.5;
    slams.push({ kind, id, node: nodes[node].id, t, velocity, joukowsky: (aWave * velocity) / G, rise: 0, peak: h0, peakPressure: h0 - nodes[node].elev });
    pendingRise.push({ k: slams.length - 1, node, tEnd: t + Math.min(Math.max(2 * L, 0.2), 2), h0, left: 3 });
  };
  const makeCv = (spec: CheckValveSpec | undefined, A: number): CvState | undefined => {
    if (!spec || spec.mode === 'ideal') return undefined;
    const nw = Math.max(2, Math.round(0.1 / dt));
    return { spec, A, kcv: (spec.kOpen ?? 1) / (2 * G * A * A), state: 'open', s: 1, tRev: -1, tStart: 0, vr: spec.mode === 'velocity' ? Math.max(spec.reverseVelocity ?? 0.3, 0) : 0, ring: new Float64Array(nw + 1), nRing: 0, vLast: 0 };
  };

  // ── elements (pumps, valves) and clusters ──────────────────────────────
  const elements: Element[] = [];
  /** Pump head per unit (m) and hydraulic torque per unit (N·m) for the element flow Q (all units) and speed ratio. */
  const pHead = (e: Extract<Element, { kind: 'pump' }>, Q: number, alpha: number) => (e.fq ? e.fq.head(Q / e.m, alpha) : pumpHeadAt(e.curve, Q / e.m, alpha));
  const pTorque = (e: Extract<Element, { kind: 'pump' }>, alpha: number, Q: number) => (e.fq ? e.fq.torque(Q / e.m, alpha) : e.ta * alpha * alpha + e.tb * alpha * Q + e.tc * Q * Q);
  /** Net retarding torque on the rotor: pump torque less the motor torque while a motor start is under way. */
  let tNow = 0;
  const dTorque = (e: Extract<Element, { kind: 'pump' }>, alpha: number, Q: number) => pTorque(e, alpha, Q) - (e.motor?.on ? e.m * motorTorque(net.pumps[e.idx].motor!, e.motor.Tr, alpha, tNow - e.motor.t0) : 0);
  const minAlpha = (e: Element) => (e.kind === 'pump' && e.fq ? -3 : 0);
  // identical pumps in parallel are merged into one exact equivalent element (m units)
  const pumpGroups = new Map<string, number[]>();
  net.pumps.forEach((p, k) => {
    const trip = pumpEv.has(p.id);
    const key = JSON.stringify([p.from, p.to, p.curve, p.efficiency, p.speed, p.inertia, p.checkValve, p.checkValve ? p.checkSpec ?? null : null, p.on, trip]);
    pumpGroups.set(key, [...(pumpGroups.get(key) ?? []), k]);
    if (trip && !p.on) warnings.push(`Pump ${p.id} is set to trip but is not running.`);
  });
  for (const ks of pumpGroups.values()) {
    const p = net.pumps[ks[0]];
    const m = ks.length;
    const s0 = steady.speeds?.get(p.id) ?? 1;
    const { a, b, c } = pumpQuadratic(p);
    const tq = pumpTorqueQuadratic(p);
    const q = ks.reduce((sum, k) => sum + (steady.flows.get(net.pumps[k].id) ?? 0), 0);
    const e: Extract<Element, { kind: 'pump' }> = {
      kind: 'pump', idx: ks[0], ids: ks.map((k) => net.pumps[k].id), m, curve: pumpCurve(p), i: nIdx.get(p.from)!, j: nIdx.get(p.to)!, Q: q, alpha: p.on ? s0 : 0, alphaSet: s0, tripped: false, on: p.on,
      closed: !p.on || q <= 0, check: p.checkValve && (!p.checkSpec || p.checkSpec.mode === 'ideal'),
      cv: p.checkValve ? makeCv(p.checkSpec, area(p.checkSpec?.diameter ?? net.pipes.find((x) => x.from === p.to || x.to === p.to)?.diameter ?? 0.3)) : undefined, T: 0, I: p.inertia * (opt.inertiaFactor ?? 1), w: omegaRated(p),
      a, b: b / m, c: c / (m * m), ta: tq.ta, tb: tq.tb / m, tc: tq.tc / (m * m),
      ...(p.fourQuadrant ? { fq: fourQuadrant(p) } : {}),
      ...(p.motor ? { motor: { Tr: tq.ta + tq.tb * pumpRatedQ(p) + tq.tc * pumpRatedQ(p) ** 2, t0: 0, on: false, T0: 0 } } : {}),
      ...(p.vsd && p.vsd.active !== false && nIdx.has(p.vsd.node) ? { vsd: { node: nIdx.get(p.vsd.node)!, z: nodes[nIdx.get(p.vsd.node)!].elev, set: p.vsd.setPressure, kp: p.vsd.kp ?? 0.02, ti: Math.max(p.vsd.ti ?? 5, 1e-3), min: p.vsd.minSpeed ?? 0.3, max: p.vsd.maxSpeed ?? 1.05, rate: 1 / Math.max(p.vsd.rampTime ?? 10, 1e-3), I: 0, s0 } } : {}),
    };
    e.T = pTorque(e, e.alpha, e.Q);
    if (e.cv && e.closed) e.cv.state = 'closed';
    elements.push(e);
  }
  net.valves.forEach((v, k) => {
    const A = area(v.diameter);
    const a0 = steady.openings?.get(v.id) ?? valveArea(v, v.opening);
    const q = steady.flows.get(v.id) ?? 0;
    const e: Extract<Element, { kind: 'valve' }> = { kind: 'valve', idx: k, i: nIdx.get(v.from)!, j: nIdx.get(v.to)!, Q: q, open: a0, base: a0, closed: a0 <= 0, check: !!v.check && (!v.checkSpec || v.checkSpec.mode === 'ideal'), cv: v.check ? makeCv(v.checkSpec, area(v.checkSpec?.diameter ?? v.diameter)) : undefined, kq: v.k0 / (2 * G * A * A) };
    if ((v.pbv !== undefined || v.gpv?.length) && Math.abs(q) > 1e-9 && a0 > 0) {
      // pressure-breaker / general-purpose valve: its steady head loss becomes a fixed restriction for the surge run
      const dh = Math.abs((steady.heads.get(v.from) ?? 0) - (steady.heads.get(v.to) ?? 0));
      e.kq = Math.max((a0 * a0 * dh) / (q * q), 1e-9);
    }
    if (e.cv && (e.closed || q <= 0)) { e.cv.state = 'closed'; e.closed = true; }
    elements.push(e);
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
  vessels.forEach((v) => v && (vesselOut[nodes[v.node].id] = { gas: new Float32Array(nFrames), flow: new Float32Array(nFrames), level: new Float32Array(nFrames), minGas: v.Vg, maxGas: v.Vg, volume: v.cfg.volume, initialGas: v.Vg0, emptied: false, minWater: v.cfg.volume - v.VgMax, bottom: v.bottom, top: v.bottom + v.geo.height }));
  const tankOut: TransientResult['tanks'] = {};
  tanks.forEach((t) => t && (tankOut[nodes[t.node].id] = { level: new Float32Array(nFrames), flow: new Float32Array(nFrames), minLevel: t.z, maxLevel: t.z, bottom: t.cfg.bottomElev, top: t.cfg.topElev, spilled: 0, emptied: false, oneWay: t.oneWay, ...(t.diff ? { chamber: { level: new Float32Array(nFrames), minLevel: t.z, maxLevel: t.z } } : {}) }));
  const savOut: TransientResult['savs'] = {};
  savs.forEach((v) => v && (savOut[nodes[v.node].id] = { opening: new Float32Array(nFrames), flow: new Float32Array(nFrames), opened: 0, maxFlow: 0 }));
  const reliefOut: TransientResult['reliefs'] = {};
  reliefs.forEach((r) => r && (reliefOut[nodes[r.node].id] = { flow: new Float32Array(nFrames), maxFlow: 0, volume: 0 }));
  const pumpOut: TransientResult['pumps'] = {};
  elements.forEach((e) => e.kind === 'pump' && e.ids.forEach((id) => (pumpOut[id] = { speed: new Float32Array(nFrames), flow: new Float32Array(nFrames), reverseFlow: false })));
  const airOut: TransientResult['airValves'] = {};
  airv.forEach((a, i) => a && (airOut[nodes[i].id] = { air: new Float32Array(nFrames), mass: new Float32Array(nFrames), maxAir: 0 }));
  const valveOut: TransientResult['valves'] = {};
  elements.forEach((e) => e.kind === 'valve' && (valveOut[net.valves[e.idx].id] = { opening: new Float32Array(nFrames), flow: new Float32Array(nFrames) }));
  // check valves: keyed by the pump, valve or pipe they belong to
  const cvOut: TransientResult['checkValves'] = {};
  const cvKey = (e: Element) => (e.kind === 'pump' ? e.ids : e.kind === 'valve' ? [net.valves[e.idx].owner ?? net.valves[e.idx].id] : []);
  elements.forEach((e) => {
    if (e.kind === 'rigid') return;
    const has = e.kind === 'pump' ? net.pumps[e.idx].checkValve : !!net.valves[e.idx].check;
    if (!has) return;
    const spec = e.kind === 'pump' ? net.pumps[e.idx].checkSpec : net.valves[e.idx].checkSpec;
    const where = e.kind === 'pump' ? 'pump' : net.valves[e.idx].owner ? 'pipe' : 'valve';
    for (const id of cvKey(e)) cvOut[id] = { where, mode: spec?.mode ?? 'ideal', flow: new Float32Array(nFrames), opening: new Float32Array(nFrames), closures: 0, maxReverseVelocity: 0, reverseVelocityAtClosure: 0 };
  });
  const outletOut: TransientResult['outlets'] = {};
  outlets.forEach((o) => o && (outletOut[nodes[o.node].id] = { flow: new Float32Array(nFrames), opening: new Float32Array(nFrames), openedAt: -1, maxFlow: 0, volume: 0 }));
  const nodeMax = new Float64Array(NN).fill(-Infinity);
  const nodeMin = new Float64Array(NN).fill(Infinity);

  const isValveTarget = (e: Extract<Element, { kind: 'valve' }>) => valveEv.has(net.valves[e.idx].id);
  /** Stroke that gives a relative area (control valves start from their steady opening). */
  const strokeOf = (v: Network['valves'][number], a: number) => {
    let lo = 0, hi = 1;
    for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (valveArea(v, m) < a) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
  const valveOpening = (e: Extract<Element, { kind: 'valve' }>, t: number) => {
    const v = net.valves[e.idx];
    const ev = valveEv.get(v.id);
    if (!ev || t <= ev.start) return e.base;
    const s0 = v.control ? strokeOf(v, e.base) : v.opening;
    const evCurve = evCurves.get(ev);
    const stroke = strokeOfEv(ev);
    if (evCurve) return valveArea(v, t - ev.start < evCurve[0][0] ? s0 : interpTable(evCurve, t - ev.start));
    const tf = ev.finalOpening ?? (ev.kind === 'valveClose' ? 0 : 1);
    const s = stroke > 0 ? Math.min((t - ev.start) / stroke, 1) : 1;
    return valveArea(v, tf + (s0 - tf) * (1 - s) ** (ev.exponent ?? 1));
  };
  // turbine speed governors: after a load rejection the gate stroke follows a PI controller on the speed
  const govern = new Map<number, { start: number; w: number; w0: number; I: number; stroke: number; kp: number; ti: number; rate: number; inertia: number; eff: number; ratedP: number }>();
  elements.forEach((e) => {
    if (e.kind !== 'valve') return;
    const v = net.valves[e.idx], tb = v.turbine;
    if (!tb?.governor || tb.characteristic) return;
    const ev = valveEv.get(v.id);
    if (!ev || (ev.turbineOp ?? (ev.kind === 'valveClose' ? 'rejection' : 'acceptance')) !== 'rejection') return;
    const w0 = (2 * Math.PI * tb.speed) / 60;
    govern.set(e.idx, { start: ev.start, w: w0, w0, I: 0, stroke: strokeOf(v, e.base), kp: tb.governor.kp ?? 3, ti: Math.max(tb.governor.ti ?? 5, 1e-3), rate: 1 / Math.max(tb.governor.closeTime, 1e-3), inertia: tb.inertia, eff: tb.efficiency, ratedP: RHO * G * tb.ratedFlow * tb.ratedHead * tb.efficiency });
  });
  const governorStep = (e: Extract<Element, { kind: 'valve' }>, g: NonNullable<ReturnType<typeof govern.get>>, _t: number) => {
    // runner speed from the power balance (generator disconnected: only windage and friction load remain)
    const ratio = g.w / g.w0;
    const eta = Math.max(0, 1 - ((ratio - 1) / 0.8) ** 2);
    const dH = Math.max(Hprev[e.i] - Hprev[e.j], 0);
    const P = RHO * G * Math.max(e.Q, 0) * dH * g.eff * eta;
    const Pw = 0.01 * g.ratedP * ratio ** 3;
    g.w = Math.max(0, g.w + (dt * (P - Pw)) / Math.max(g.inertia * g.w, 1e-6));
    // PI on the speed error closes the gates as the unit speeds up (rate limited)
    const err = g.w / g.w0 - 1;
    g.I += (err * dt) / g.ti;
    const target = Math.min(1, Math.max(0, strokeOf(net.valves[e.idx], e.base) - g.kp * (err + g.I)));
    g.stroke += Math.max(-g.rate * dt, Math.min(g.rate * dt, target - g.stroke));
    return valveArea(net.valves[e.idx], g.stroke);
  };
  // turbines with a runner characteristic: speed tracked in the loop, flow and efficiency from the unit speed
  const turbs = new Map<number, { start: number; rejected: boolean; w: number; w0: number; Hr: number; I: number; stroke: number; inertia: number; eff: number; ratedP: number; f0: number; gov?: { kp: number; ti: number; rate: number } }>();
  elements.forEach((e) => {
    if (e.kind !== 'valve') return;
    const v = net.valves[e.idx], tb = v.turbine;
    if (!tb?.characteristic) return;
    const ev = valveEv.get(v.id);
    const rejected = !!ev && (ev.turbineOp ?? (ev.kind === 'valveClose' ? 'rejection' : 'acceptance')) === 'rejection';
    const w0 = (2 * Math.PI * tb.speed) / 60;
    const dH0 = Math.max(Hprev[e.i] - Hprev[e.j], 1e-3);
    const f0 = turbineFactors(tb.characteristic, 1 / Math.sqrt(dH0 / tb.ratedHead)).flow;
    turbs.set(e.idx, { start: ev?.start ?? Infinity, rejected, w: w0, w0, Hr: tb.ratedHead, I: 0, stroke: strokeOf(v, e.base), inertia: tb.inertia, eff: tb.efficiency, ratedP: RHO * G * tb.ratedFlow * tb.ratedHead * tb.efficiency, f0,
      ...(tb.governor && rejected ? { gov: { kp: tb.governor.kp ?? 3, ti: Math.max(tb.governor.ti ?? 5, 1e-3), rate: 1 / Math.max(tb.governor.closeTime, 1e-3) } } : {}) });
  });
  const turbineStep = (e: Extract<Element, { kind: 'valve' }>, u: NonNullable<ReturnType<typeof turbs.get>>, t: number) => {
    const tb = net.valves[e.idx].turbine!;
    const dH = Math.max(Hprev[e.i] - Hprev[e.j], 1e-3);
    const ratio = u.w / u.w0;
    const fac = turbineFactors(tb.characteristic!, ratio / Math.sqrt(dH / u.Hr));
    if (u.rejected && t >= u.start) {
      // generator off the grid: the runner accelerates on the hydraulic power less windage and friction
      const P = RHO * G * Math.max(e.Q, 0) * dH * u.eff * fac.eff;
      const Pw = 0.01 * u.ratedP * ratio ** 3;
      u.w = Math.max(0, u.w + (dt * (P - Pw)) / Math.max(u.inertia * u.w, 1e-6));
    }
    let gate: number;
    if (u.gov && t >= u.start) {
      const err = u.w / u.w0 - 1;
      u.I += (err * dt) / u.gov.ti;
      const target = Math.min(1, Math.max(0, strokeOf(net.valves[e.idx], e.base) - u.gov.kp * (err + u.I)));
      u.stroke += Math.max(-u.gov.rate * dt, Math.min(u.gov.rate * dt, target - u.stroke));
      gate = valveArea(net.valves[e.idx], u.stroke);
    } else gate = isValveTarget(e) ? valveOpening(e, t) : e.base;
    return Math.max(0, (gate * fac.flow) / u.f0);
  };
  /** Active control valve: the opening moves toward the one that meets the set point, with its response time
   *  and stroke-speed limit. */
  const controlStep = (e: Extract<Element, { kind: 'valve' }>) => {
    const c = net.valves[e.idx].control!;
    const zi = nodes[e.i].elev, zj = nodes[e.j].elev;
    const target = c.type === 'PRV' ? controlArea(e.kq, e.Q, Hprev[e.i] - (c.set + zj))
      : c.type === 'PSV' ? controlArea(e.kq, e.Q, c.set + zi - Hprev[e.j])
      : controlArea(e.kq, c.set, Hprev[e.i] - Hprev[e.j]);
    const tau = Math.max(c.responseTime ?? 3, 1e-6);
    let d = (target - e.open) * (1 - Math.exp(-dt / tau));
    const lim = dt / Math.max(c.strokeTime ?? 20, 1e-6);
    d = Math.max(-lim, Math.min(lim, d));
    return Math.max(0, Math.min(1, e.open + d));
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
    if (n.relief) q -= reliefFlow(n.relief, p);
    const sv = savs[i];
    if (sv && sv.open > 0) q -= sv.cd * sv.A * sv.open * Math.sqrt(2 * G * Math.max(p, 0));
    const vs = vessels[i];
    if (vs) q -= vesselFlow(vs, H);
    const tk = tanks[i];
    if (tk) q -= tankFlow(tk, H);
    const ou = outlets[i];
    if (ou && ou.open > 0) q -= ou.cd * ou.A * ou.open * Math.sqrt(2 * G * Math.max(p, 0));
    const av = airv[i];
    if (av) q += airCavityRate(av, H, n);
    else q += (gasVolume(nodeC3[i], H, n.elev) - nodeV[i]) / dt;
    return q;
  };
  function gasVolume(C3: number, H: number, z: number) {
    const y = H - z + HBc - HV;
    return y > 1e-14 ? C3 / y : C3 / 1e-14;
  }
  function vesselHead(vs: NonNullable<(typeof vessels)[number]>, Vg: number) {
    const zl = vs.bottom + waterDepthOf(vs.geo, vs.cfg.volume - Vg);
    return zl + vs.C / Vg ** vs.cfg.n - HB;
  }
  function vesselFlow(vs: NonNullable<(typeof vessels)[number]>, H: number) {
    // flow into the vessel that balances the node head with the vessel water head, the connection loss and the
    // inertia of the water in the connection pipe (trapezoidal gas-volume update over the step)
    const gasAfter = (Qs: number) => Math.min(Math.max(vs.Vg - (dt * (Qs + vs.Qs)) / 2, 1e-6), vs.VgMax);
    const f = (Qs: number) => H - vesselHead(vs, gasAfter(Qs)) - (Qs >= 0 ? vs.rin : vs.rout) * Qs * Math.abs(Qs) - (vs.inert * (Qs - vs.Qs)) / dt;
    let lo = -50, hi = 50;
    // outflow cannot take more water than is left above the dip tube / bottom
    const qMinEmpty = (-2 * (vs.VgMax - vs.Vg)) / dt - vs.Qs;
    if (lo < qMinEmpty) lo = qMinEmpty;
    if (lo >= hi) return lo;
    return solveDecreasing(f, lo, hi, vs.Qs);
  }
  function portFlow(tk: NonNullable<(typeof tanks)[number]>, H: number) {
    // differential tank: flow through the ports into the chamber (orifice loss, chamber level over the step)
    const d = tk.diff!;
    const f = (Q: number) => H - Math.min(d.zc + (dt * (Q + d.Qp)) / (2 * d.Ac), tk.cfg.topElev) - d.rp * Q * Math.abs(Q);
    let lo = -50;
    const qMinEmpty = (-2 * (d.zc - tk.cfg.bottomElev) * d.Ac) / dt - d.Qp;
    if (lo < qMinEmpty) lo = Math.min(qMinEmpty, 0);
    return solveDecreasing(f, lo, 50, d.Qp);
  }
  function tankFlow(tk: NonNullable<(typeof tanks)[number]>, H: number): number {
    if (tk.diff) return riserFlow(tk, H) + portFlow(tk, H);
    return riserFlow(tk, H);
  }
  function riserFlow(tk: NonNullable<(typeof tanks)[number]>, H: number) {
    // flow into an open tank; its surface is at atmospheric pressure, so the head there is the water level
    const top = tk.diff ? tk.diff.top : tk.cfg.topElev;
    const levelAfter = (Q: number) => tk.z + (dt * (Q + tk.Qt)) / (2 * tk.As);
    const f = (Q: number) => H - Math.min(levelAfter(Q), top) - (Q >= 0 ? tk.rin : tk.rout) * Q * Math.abs(Q);
    let lo = -50, hi = tk.oneWay ? 0 : 50;
    const qMinEmpty = (-2 * (tk.z - tk.cfg.bottomElev) * tk.As) / dt - tk.Qt;
    if (lo < qMinEmpty) lo = Math.min(qMinEmpty, 0);
    if (lo >= hi) return hi;
    return solveDecreasing(f, lo, hi, tk.Qt);
  }
  function airState(av: NonNullable<(typeof airv)[number]>, H: number, n: NetNode) {
    const p = Math.max(RHO * G * (H - n.elev + HB), 500);
    const m = Math.max(av.m + dt * airValveMassRate(av.model, p, av.m), 0);
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
  const plainNode = (i: number) => !nodes[i].relief && !vessels[i] && !airv[i] && !tanks[i] && !savs[i] && !outlets[i] && demK[i] === 0;
  const dgcm = (sb: number, sc: number, qext: number, z: number, C3: number, Vold: number) => {
    const E = Vold + dt * (sb * (z - HBc + HV) - sc - qext);
    const disc = Math.sqrt(E * E + 4 * dt * sb * C3);
    const y = E > 0 ? (2 * C3) / (E + disc) : (-E + disc) / (2 * dt * sb);
    return { H: y + z - HBc + HV, V: C3 / Math.max(y, 1e-12) };
  };

  // element helpers
  /** Extra loss of a check valve that is part-way through closing: kOpen·(1/s² − 1), zero when fully open. */
  const cvLoss = (e: Element) => {
    if (e.kind === 'rigid' || !e.cv || e.cv.state !== 'closing') return 0;
    const s2 = Math.max(e.cv.s, 1e-3) ** 2;
    return (e.cv.kcv * (1 / s2 - 1)) / (e.kind === 'pump' ? e.m * e.m : 1);
  };
  const elFlowAt = (e: Element, Hi: number, Hj: number, Q: number, alpha: number): number => {
    if (e.closed) return Q; // residual Q = 0
    if (e.kind === 'valve') return (e.kq + e.open * e.open * cvLoss(e)) * Q * Math.abs(Q) - e.open * e.open * (Hi - Hj);
    if (e.kind === 'rigid') return (e.inert * (Q - e.Qold)) / dt + rigidR(e, Q) * Q * Math.abs(Q) - (Hi - Hj);
    return Hj - Hi - pHead(e, Q, alpha) + cvLoss(e) * Q * Math.abs(Q);
  };


  /** Robust solve for a cluster with one element between two nodes: bracketed search on the element flow. */
  const solveSingle = (e: Element) => {
    const headAt = (i: number, qext: number) => (isRes[i] ? Hn[i] : solveNode(i, qext));
    const alphaOf = (Q: number) => {
      if (e.kind !== 'pump') return 0;
      if (!e.tripped) return e.on ? e.alphaSet : 0;
      const k = dt / (2 * e.I * e.w);
      if (e.fq || e.motor?.on) {
        // speed from the implicit torque balance α − α₀ + k (T(α) + T₀) = 0, by Newton with bisection safeguard
        const f = (a: number) => a - e.alpha + k * (dTorque(e, a, Q) + e.T);
        let lo = minAlpha(e), hi = Math.max(1.5, e.alpha + 0.5), a = e.alpha;
        for (let it = 0; it < 60; it++) {
          const fa = f(a);
          if (Math.abs(fa) < 1e-12) break;
          if (fa > 0) hi = a; else lo = a;
          const d = (f(a + 1e-7) - fa) / 1e-7;
          let an = d > 0 ? a - fa / d : 0.5 * (lo + hi);
          if (!(an > lo && an < hi)) an = 0.5 * (lo + hi);
          a = an;
        }
        return a;
      }
      const A = k * e.ta, B = 1 + k * e.tb * Q, C = k * e.tc * Q * Q - e.alpha + k * e.T;
      let al = Math.abs(A) < 1e-14 ? -C / B : (-B + Math.sqrt(Math.max(B * B - 4 * A * C, 0))) / (2 * A);
      if (!Number.isFinite(al) || al < 0) al = 0;
      return al;
    };
    const forcedShut = (e.kind === 'valve' ? e.open <= 0 : e.kind === 'pump' ? !e.on : false) || (e.kind !== 'rigid' && e.cv?.state === 'closed');
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
      if (e.kind === 'valve') return (e.kq + e.open * e.open * cvLoss(e)) * Q * Math.abs(Q) - e.open * e.open * (Hi - Hj);
      if (e.kind === 'rigid') return (e.inert * (Q - e.Qold)) / dt + rigidR(e, Q) * Q * Math.abs(Q) - (Hi - Hj);
      return Hj - Hi - pHead(e, Q, alphaOf(Q)) + cvLoss(e) * Q * Math.abs(Q);
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
          const T = dTorque(e, a, q);
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
          speedVars.forEach((e, k) => (xn[free.length + els.length + k] = Math.max(xn[free.length + els.length + k], minAlpha(e))));
          const rn = resid(xn);
          if (Math.max(...rn.map(Math.abs)) < norm || ls === 11) {
            for (let k = 0; k < nv; k++) x[k] = xn[k];
            break;
          }
          lam /= 2;
        }
      }
      // Newton can stall on devices with a sharp opening law (relief, surge anticipation valve, air valves): then
      // solve again in element flows only, each node head coming from the robust scalar node solve
      const normNewton = Math.max(...resid(x).map(Math.abs));
      if (normNewton > 1e-7) {
        const ne = els.length + speedVars.length;
        const heads = (q: number[]) => free.map((i) => {
          let qext = 0;
          els.forEach((e, k) => { if (e.i === i) qext -= q[k]; if (e.j === i) qext += q[k]; });
          return solveNode(i, qext);
        });
        const headIn = (i: number, hv: number[]) => (isRes[i] ? Hn[i] : hv[free.indexOf(i)]);
        const residQ = (q: number[]) => {
          const hv = heads(q);
          const r = els.map((e, k) => {
            const sv = e.kind === 'pump' && e.tripped ? speedVars.indexOf(e) : -1;
            const alpha = e.kind === 'pump' ? (sv >= 0 ? q[els.length + sv] : e.on ? e.alphaSet : 0) : 0;
            return elFlowAt(e, headIn(e.i, hv), headIn(e.j, hv), q[k], alpha);
          });
          speedVars.forEach((e, k) => {
            const a2 = q[els.length + k], qq = q[els.indexOf(e)];
            r.push(a2 - e.alpha + (dt * (dTorque(e, a2, qq) + e.T)) / (2 * e.I * e.w));
          });
          return { r, hv };
        };
        const q = [...els.map((_, k) => x[free.length + k]), ...speedVars.map((_, k) => x[free.length + els.length + k])];
        let cur = residQ(q);
        for (let it = 0; it < 100; it++) {
          const norm = Math.max(...cur.r.map(Math.abs));
          if (norm < 1e-10) break;
          const J = Array.from({ length: ne }, () => new Array(ne).fill(0));
          for (let k = 0; k < ne; k++) {
            const h = 1e-7 * Math.max(1, Math.abs(q[k]));
            const qp = q.slice();
            qp[k] += h;
            const rp = residQ(qp).r;
            for (let m = 0; m < ne; m++) J[m][k] = (rp[m] - cur.r[m]) / h;
          }
          const d = solveDense(J, cur.r.map((v) => -v));
          let lam = 1, accepted = false;
          for (let ls = 0; ls < 30; ls++) {
            const qn = q.map((v, k) => v + lam * d[k]);
            speedVars.forEach((e, k) => (qn[els.length + k] = Math.max(qn[els.length + k], minAlpha(e))));
            const rn = residQ(qn);
            if (Math.max(...rn.r.map(Math.abs)) < norm) { q.splice(0, ne, ...qn); cur = rn; accepted = true; break; }
            lam /= 2;
          }
          if (!accepted) break;
        }
        // keep whichever answer balances the nodes and elements better (same residual for both)
        const xf = [...cur.hv, ...q];
        if (Math.max(...resid(xf).map(Math.abs)) < normNewton) for (let k = 0; k < nv; k++) x[k] = xf[k];
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
          const lift = e.kind === 'pump' ? pHead(e, 0, alpha) : 0;
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
      o.level[frame] = v.bottom + waterDepthOf(v.geo, v.cfg.volume - v.Vg);
    });
    tanks.forEach((tk) => {
      if (!tk) return;
      const o = tankOut[nodes[tk.node].id];
      o.level[frame] = tk.z;
      o.flow[frame] = tk.Qt + (tk.diff ? tk.diff.Qp : 0);
      if (o.chamber && tk.diff) o.chamber.level[frame] = tk.diff.zc;
    });
    savs.forEach((sv) => {
      if (!sv) return;
      const o = savOut[nodes[sv.node].id];
      o.opening[frame] = sv.openUsed;
      o.flow[frame] = sv.Q;
    });
    reliefs.forEach((rv) => rv && (reliefOut[nodes[rv.node].id].flow[frame] = rv.Q));
    elements.forEach((e) => {
      if (e.kind === 'pump') {
        for (const id of e.ids) {
          pumpOut[id].speed[frame] = e.alpha;
          pumpOut[id].flow[frame] = e.Q / e.m;
        }
      } else if (e.kind === 'valve') {
        const o = valveOut[net.valves[e.idx].id];
        o.opening[frame] = e.open;
        o.flow[frame] = e.Q;
        const gv = govern.get(e.idx);
        if (gv) { o.speed ??= new Float32Array(nFrames); o.speed[frame] = gv.w / gv.w0; }
        const tu = turbs.get(e.idx);
        if (tu) { o.speed ??= new Float32Array(nFrames); o.speed[frame] = tu.w / tu.w0; }
      } else if (e.kind === 'rigid') frameFlows[net.pipes[e.pipe].id][frame] = e.Q;
      if (e.kind !== 'rigid') for (const id of cvKey(e)) {
        const o = cvOut[id];
        if (!o) continue;
        o.flow[frame] = e.kind === 'pump' ? e.Q / e.m : e.Q;
        o.opening[frame] = e.closed ? 0 : e.cv ? (e.cv.state === 'closing' ? e.cv.s : 1) : 1;
      }
    });
    outlets.forEach((ou) => {
      if (!ou) return;
      const o = outletOut[nodes[ou.node].id];
      o.flow[frame] = ou.Q;
      o.opening[frame] = ou.open;
    });
    airv.forEach((a, i) => { if (a) { airOut[nodes[i].id].air[frame] = a.V; airOut[nodes[i].id].mass[frame] = a.m; } });
    frame++;
  };
  record(0);

  let huBuf = new Float64Array(16);
  for (let step = 1; step <= steps; step++) {
    const t = step * dt;
    tNow = t;
    // events
    elements.forEach((e) => {
      const ev = e.kind === 'pump' ? pumpEv.get(e.ids[0]) : undefined;
      if (e.kind === 'pump' && ev && ev.pumpMode === 'start' && t >= ev.start && e.motor) {
        // motor start: the speed comes from the torque balance (motor torque curve, pump torque, inertia)
        if (!e.motor.on) {
          e.motor.on = true;
          e.motor.t0 = ev.start;
          e.on = true;
          e.tripped = true;
          if (!e.check && !e.cv) e.closed = false;
          tNow = t - dt;
          e.T = dTorque(e, e.alpha, e.Q);
          tNow = t;
        }
      } else if (e.kind === 'pump' && ev && ev.pumpMode === 'start' && t >= ev.start) {
        // pump start: speed raised linearly to full over the ramp time
        if (!e.on) {
          e.on = true;
          if (!e.check && !e.cv) e.closed = false;
        }
        const T = Math.max((ev.duration ?? 0) * (opt.strokeFactor ?? 1), 1e-9);
        e.alphaSet = Math.min(1, (t - ev.start) / T);
        e.alpha = e.alphaSet;
      } else if (e.kind === 'pump' && e.vsd && e.on && !e.tripped && !(ev && t >= ev.start)) {
        // variable-speed drive: PI control of the pressure at its node, speed-rate limited
        const v = e.vsd;
        const err = v.set - (Hprev[v.node] - v.z);
        v.I += err * dt;
        const target = Math.min(Math.max(v.s0 + v.kp * (err + v.I / v.ti), v.min), v.max);
        const step = Math.max(-v.rate * dt, Math.min(v.rate * dt, target - e.alphaSet));
        e.alphaSet += step;
        e.alpha = e.alphaSet;
        if (target === v.min || target === v.max) v.I -= err * dt; // anti-windup
      } else if (e.kind === 'pump' && ev && t >= ev.start && e.on) {
        if (ev.pumpMode === 'ramp') {
          // controlled stop: speed forced linearly to zero over the ramp time
          const T = Math.max((ev.duration ?? 0) * (opt.strokeFactor ?? 1), 1e-9);
          e.alphaSet = Math.max(0, 1 - (t - ev.start) / T);
          e.alpha = e.alphaSet;
        } else if (!e.tripped) e.tripped = true;
      }
      if (e.kind === 'valve') {
        const gv = govern.get(e.idx), tu = turbs.get(e.idx);
        if (tu) e.open = turbineStep(e, tu, t);
        else if (gv && t >= gv.start) e.open = governorStep(e, gv, t);
        else if (isValveTarget(e)) e.open = valveOpening(e, t);
        else if (net.valves[e.idx].control?.active) e.open = controlStep(e);
        if (e.open <= 0) e.closed = true;
        else if (e.closed && !e.check && e.cv?.state !== 'closed') e.closed = false;
      }
      // check valves that close with a delay or on reverse velocity
      if (e.kind !== 'rigid' && e.cv) {
        const cv = e.cv;
        if (cv.state === 'closing') {
          const T = cv.spec.closeTime ?? 0;
          cv.s = T > 0 ? 1 - (t - cv.tStart) / T : 0;
          if (cv.s <= 1e-3) {
            cv.state = 'closed';
            cv.s = 0;
            const v = Math.max(-cv.vLast, 0);
            for (const id of cvKey(e)) {
              const o = cvOut[id];
              o.closures++;
              o.reverseVelocityAtClosure = Math.max(o.reverseVelocityAtClosure, v);
            }
            if (v > 1e-4) {
              const np = nodePipes[e.j];
              const aW = np.length ? Math.max(...np.map((x) => x.a)) : 1000;
              startSlam('checkValve', cvKey(e)[0], e.j, t, v, aW, Hprev[e.j]);
            }
          }
        }
        if (cv.state === 'closed') e.closed = true;
      }
    });
    outlets.forEach((ou) => ou && (ou.open = outletOpening(ou.cfg.openTime, ou.tOpen, t)));
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
      const ve = p.ve;
      if (ve && !ve.H0) ve.H0 = Float64Array.from(H);
      const nk = ve ? ve.J.length : 0;
      for (let i = 1; i < N; i++) {
        const qa = Qd[i - 1], qb = Qu[i + 1];
        const CP = H[i - 1] + B * qa - fR[i - 1] * qa * Math.abs(qa) - hu[i - 1];
        const CM = H[i + 1] - B * qb + fR[i + 1] * qb * Math.abs(qb) + hu[i + 1];
        // discrete gas cavity model, closed form (ψ = 1). Viscoelastic creep (Kelvin–Voigt, exact exponential over
        // the step, implicit in the new head) adds the volume the swelling pipe makes room for: creep = α(H − H0) − β
        const C3 = C3a[i];
        let E = V[i] + dt * (sb * (z[i] + offs) - (CP + CM) / B), a2 = dtsb;
        if (ve) {
          let beta = 0;
          for (let k = 0; k < nk; k++) beta += ve.eps[k * (N + 1) + i] * (1 - ve.decay[k]);
          beta *= 2 * A * dx;
          E += ve.alpha * (z[i] + offs - ve.H0![i]) - beta;
          a2 += ve.alpha;
        }
        const disc = Math.sqrt(E * E + 4 * a2 * C3);
        const y = E > 0 ? (2 * C3) / (E + disc) : (-E + disc) / (2 * a2);
        const Hh = y + z[i] + offs;
        Hn2[i] = Hh;
        if (ve) {
          const F = ve.fac * (Hh - ve.H0![i]);
          for (let k = 0; k < nk; k++) { const j = k * (N + 1) + i; ve.eps[j] = ve.J[k] * F + (ve.eps[j] - ve.J[k] * F) * ve.decay[k]; }
        }
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
      if (isRes[i]) Hn[i] = resSched[i] ? resH0[i] + schedHead(resSched[i]!, t) : Hprev[i];
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
        if (Vg >= vs.VgMax - 1e-4 * vs.cfg.volume && q < 0) vs.emptied = true;
        Vg = Math.min(Vg, vs.VgMax);
        vs.Vg = Math.max(Vg, 1e-6);
        vs.Qs = q;
        vs.minGas = Math.min(vs.minGas, vs.Vg);
        vs.maxGas = Math.max(vs.maxGas, vs.Vg);
      }
      const tk = tanks[i];
      if (tk) {
        const q = riserFlow(tk, H);
        let z = tk.z + (dt * (q + tk.Qt)) / (2 * tk.As);
        const d = tk.diff;
        if (d) {
          const qp = portFlow(tk, H);
          let zc = d.zc + (dt * (qp + d.Qp)) / (2 * d.Ac);
          // the riser overflows into the chamber
          if (z > d.top) { zc += ((z - d.top) * tk.As) / d.Ac; z = d.top; }
          if (zc > tk.cfg.topElev) { tk.spilled += (zc - tk.cfg.topElev) * d.Ac; zc = tk.cfg.topElev; }
          if (zc <= tk.cfg.bottomElev + 1e-6 && qp < 0) tk.emptied = true;
          d.zc = Math.max(zc, tk.cfg.bottomElev);
          if (d.curve) d.Ac = Math.max(interpTable(d.curve, d.zc) - d.Ar, 1e-6);
          d.Qp = qp;
          d.minZ = Math.min(d.minZ, d.zc); d.maxZ = Math.max(d.maxZ, d.zc);
        }
        if (z > tk.cfg.topElev) { tk.spilled += (z - tk.cfg.topElev) * tk.As; z = tk.cfg.topElev; }
        if (z <= tk.cfg.bottomElev + 1e-6 && q < 0) tk.emptied = true;
        tk.z = Math.max(z, tk.cfg.bottomElev);
        tk.As = tk.areaAt(tk.z);
        tk.Qt = q;
        tk.minZ = Math.min(tk.minZ, tk.z);
        tk.maxZ = Math.max(tk.maxZ, tk.z);
      }
      const rv = reliefs[i];
      if (rv) {
        rv.Q = reliefFlow(rv.cfg, H - nodes[i].elev);
        rv.maxQ = Math.max(rv.maxQ, rv.Q);
        rv.vol += rv.Q * dt;
      }
      const sv = savs[i];
      if (sv) {
        const p = H - nodes[i].elev;
        sv.Q = sv.cd * sv.A * sv.open * Math.sqrt(2 * G * Math.max(p, 0));
        sv.openUsed = sv.open;
        sv.maxQ = Math.max(sv.maxQ, sv.Q);
        // trigger on low pressure (or high, if set) while closed; the opening for the next step follows its schedule
        const cycle = sv.cfg.openTime + sv.cfg.holdTime + sv.cfg.closeTime;
        if (sv.tTrig >= 0 && t - sv.tTrig >= cycle) sv.tTrig = -1;
        if (sv.tTrig < 0 && (p < sv.cfg.lowSet || (sv.cfg.highSet !== undefined && sv.cfg.highSet > 0 && p > sv.cfg.highSet))) { sv.tTrig = t; sv.opened++; }
        sv.open = sv.tTrig >= 0 ? savOpening(sv.cfg, t + dt - sv.tTrig) : 0;
      }
      const ou = outlets[i];
      if (ou) {
        const p = H - nodes[i].elev;
        const q0 = ou.Q;
        ou.Q = ou.cd * ou.A * ou.open * Math.sqrt(2 * G * Math.max(p, 0));
        ou.maxQ = Math.max(ou.maxQ, ou.Q);
        ou.vol += ((ou.Q + q0) / 2) * dt;
        if (ou.tOpen < 0 && ou.cfg.trigger === 'pressure' && ou.cfg.burstHead !== undefined && p >= ou.cfg.burstHead) ou.tOpen = t;
      }
      const av = airv[i];
      if (av) {
        const s2 = airState(av, H, nodes[i]);
        const hadAir = av.m > 0;
        av.m = s2.m;
        av.V = s2.V;
        av.maxAir = Math.max(av.maxAir, av.V);
        if (hadAir && av.m <= 0) {
          // the air pocket has closed: the water columns that were filling it stop at once (air-valve slam)
          // filling rate from the last whole steps (the air runs out part-way through this one)
          const L4 = av.hist.length;
          let filled = 0;
          while (filled < L4 && av.hist[L4 - 1 - filled] > 0) filled++;
          const n = Math.min(filled - 1, 3);
          const rate = n >= 1 ? (av.hist[L4 - 1 - n] - av.hist[L4 - 1]) / (n * dt) : av.hist[L4 - 1] / dt;
          const np = nodePipes[i];
          const Asum = np.reduce((sum, x) => sum + x.A, 0);
          const aW = Asum > 0 ? np.reduce((sum, x) => sum + x.a * x.A, 0) / Asum : 1000;
          if (Asum > 0 && rate > 0) startSlam('airValve', nodes[i].id, i, t, rate / Asum, aW, Hprev[i]);
        }
        av.hist.shift();
        av.hist.push(av.V);
      } else nodeV[i] = gasVolume(nodeC3[i], H, nodes[i].elev);
      nodeMax[i] = Math.max(nodeMax[i], H);
      nodeMin[i] = Math.min(nodeMin[i], H);
    }
    for (const pr of pendingRise) {
      const sl = slams[pr.k];
      // the jump: the closure can fall part-way through a step, so take the first three steps
      if (pr.left > 0) { sl.rise = Math.max(sl.rise, Hn[pr.node] - pr.h0); pr.left--; }
      if (t <= pr.tEnd + 1e-12) { sl.peak = Math.max(sl.peak, Hn[pr.node]); sl.peakPressure = sl.peak - nodes[pr.node].elev; }
    }
    while (pendingRise.length && t > pendingRise[0].tEnd && pendingRise[0].left <= 0) pendingRise.shift();
    // check valves: reversal, start of closure, reopening
    elements.forEach((e) => {
      if (e.kind === 'rigid' || !e.cv) return;
      const cv = e.cv;
      const V = e.Q / (cv.A * (e.kind === 'pump' ? e.m : 1));
      if (cv.state === 'closed') {
        const alpha = e.kind === 'pump' ? e.alpha : 0;
        const lift = e.kind === 'pump' ? pHead(e, 0, alpha) : 0;
        const can = e.kind === 'pump' ? e.on && alpha > 0.01 : e.open > 0;
        if (can && Hn[e.i] + lift - Hn[e.j] > (cv.spec.openHead ?? 1e-3)) {
          cv.state = 'open';
          cv.s = 1;
          cv.tRev = -1;
          cv.nRing = 0;
          e.closed = false;
        }
        return;
      }
      for (const id of cvKey(e)) cvOut[id].maxReverseVelocity = Math.max(cvOut[id].maxReverseVelocity, -V);
      cv.vLast = V;
      if (cv.state !== 'open') return;
      // recent velocities (about 0.1 s) give the deceleration for the dynamic characteristic
      const nr = cv.ring.length;
      if (cv.nRing < nr) cv.ring[cv.nRing++] = V;
      else { cv.ring.copyWithin(0, 1); cv.ring[nr - 1] = V; }
      if (V <= 0 && cv.tRev < 0) {
        const vp = cv.nRing >= 2 ? cv.ring[cv.nRing - 2] : V;
        cv.tRev = vp > V ? t - (dt * -V) / (vp - V) : t; // where the velocity crossed zero
        if (cv.spec.mode === 'dynamic') {
          const span = (cv.nRing - 1) * dt;
          const decel = span > 0 ? (cv.ring[0] - V) / span : 0;
          cv.vr = dynamicReverseVelocity(cv.spec.dynamic, decel);
        }
      } else if (V > 1e-9 && cv.tRev >= 0) cv.tRev = -1;
      const go = cv.tRev >= 0 && (cv.spec.mode === 'delay' ? t - cv.tRev >= (cv.spec.delay ?? 0) - 1e-12 : -V >= cv.vr);
      if (go) {
        cv.state = 'closing';
        cv.tStart = cv.spec.mode === 'delay' ? Math.max(cv.tRev + (cv.spec.delay ?? 0), t - dt) : t;
        cv.s = 1;
      }
    });
    elements.forEach((e) => {
      if (e.kind === 'rigid') e.Qold = e.Q;
      if (e.kind === 'pump') {
        e.T = dTorque(e, e.alpha, e.Q);
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
    if (v.emptied) {
      const why = v.cfg.volume - v.VgMax > 1e-9 ? 'the water fell to the dip tube' : v.cfg.bladder ? 'the bladder is fully expanded' : 'air could enter the pipe';
      warnings.push(`Surge vessel at ${nodes[v.node].id} emptied (${why}): it is too small or its initial water volume too low.`);
    }
  });
  tanks.forEach((tk) => {
    if (!tk) return;
    const o = tankOut[nodes[tk.node].id];
    Object.assign(o, { minLevel: tk.minZ, maxLevel: tk.maxZ, spilled: tk.spilled, emptied: tk.emptied });
    if (o.chamber && tk.diff) Object.assign(o.chamber, { minLevel: tk.diff.minZ, maxLevel: tk.diff.maxZ });
    const kind = tk.oneWay ? 'One-way tank' : tk.diff ? 'Differential surge tank' : 'Standpipe';
    if (tk.emptied) warnings.push(`${kind} at ${nodes[tk.node].id} emptied: air could enter the pipe. Make it larger.`);
    if (tk.spilled > 1e-6) warnings.push(`${kind} at ${nodes[tk.node].id} overflowed (${tk.spilled.toFixed(2)} m³ spilled). Raise its top or enlarge it.`);
  });
  savs.forEach((sv) => sv && Object.assign(savOut[nodes[sv.node].id], { opened: sv.opened, maxFlow: sv.maxQ }));
  reliefs.forEach((rv) => rv && Object.assign(reliefOut[nodes[rv.node].id], { maxFlow: rv.maxQ, volume: rv.vol }));
  airv.forEach((a, i) => a && (airOut[nodes[i].id].maxAir = a.maxAir));
  outlets.forEach((ou) => ou && Object.assign(outletOut[nodes[ou.node].id], { openedAt: ou.tOpen >= 0 && ou.tOpen <= st.duration ? ou.tOpen : -1, maxFlow: ou.maxQ, volume: ou.vol }));
  Object.entries(pumpOut).forEach(([id, o]) => {
    const pp = net.pumps.find((x) => x.id === id);
    if (pp?.fourQuadrant) {
      const minS = Math.min(...o.speed);
      if (minS < -0.01) warnings.push(`Pump ${id} turned backwards (lowest speed ${(minS * 100).toFixed(0)} % of rated${pp.fourQuadrant === 'generic' ? ', generic four-quadrant characteristic: use the manufacturer\'s Suter data for design' : ''}). Check the motor and coupling for reverse rotation.`);
      return;
    }
    if (!o.reverseFlow) return;
    if (cvOut[id]) warnings.push(`Pump ${id} ran in reverse until its check valve closed. Results with reverse flow through a pump need full four-quadrant pump data.`);
    else warnings.push(`Pump ${id} ran with reverse flow (no non-return valve). Results after flow reversal need full four-quadrant pump data.`);
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
    tanks: tankOut,
    savs: savOut,
    reliefs: reliefOut,
    pumps: pumpOut,
    airValves: airOut,
    valves: valveOut,
    checkValves: cvOut,
    outlets: outletOut,
    slams,
    steady: { heads: Object.fromEntries(steady.heads), flows: Object.fromEntries(steady.flows) },
    warnings,
    runtimeMs: performance.now() - t0,
  };
}

/** Change of reservoir head from its steady level at time t. Starts at zero, so the steady state is unchanged. */
export function schedHead(s: import('./types').HeadSchedule, t: number): number {
  if (s.mode === 'sine') {
    const T = Math.max(s.period ?? 10, 1e-6);
    const ph = ((s.phase ?? 0) * Math.PI) / 180;
    return (s.amplitude ?? 0) * (Math.sin((2 * Math.PI * t) / T + ph) - Math.sin(ph));
  }
  const tb = s.table ?? [];
  if (!tb.length) return 0;
  if (t <= tb[0][0]) return tb[0][1];
  for (let k = 1; k < tb.length; k++) if (t <= tb[k][0]) { const [t0, h0] = tb[k - 1], [t1, h1] = tb[k]; return h0 + ((h1 - h0) * (t - t0)) / Math.max(t1 - t0, 1e-12); }
  return tb[tb.length - 1][1];
}
