// Surge protection device tests against theory and exact balances.
//  • Tank geometry (vertical, horizontal, sphere) and bladder pre-charge.
//  • Hydropneumatic tank: mass-oscillation period and amplitude (rigid-column theory, n = 1.0 and 1.4,
//    vertical and horizontal), connection-pipe inertia, water balance, dip tube, non-return valve with bypass.
//  • Open surge tank: period and amplitude (classic standpipe theory), overflow volume balance.
//  • One-way tank, surge anticipation valve, relief valve: flow laws checked at every stored frame.
//  • Air valves: curve model equals orifice model, vacuum breaker, release-only, three-stage outflow limit and
//    anti-slam effect, Treat as junction, mass balance.
import { airValveModel, orificeCurve, orificeMassFlow, prechargeGas, reliefFlow, savOpening, vesselGeometry, waterDepthOf, waterVolumeAt, RAIR, TAIR } from '../src/engine/devices';
import { runTransient, type TransientResult } from '../src/engine/transient';
import { G, HB, RHO, area, defaultSettings, type Network, type NetNode, type Pump } from '../src/engine/types';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);

// ── geometry ──
for (const shape of ['vertical', 'horizontal', 'sphere'] as const) {
  const g = vesselGeometry({ volume: 20, shape, diameter: shape === 'sphere' ? undefined : 2 });
  const half = waterVolumeAt(g, g.height / 2);
  let worst = 0;
  for (let k = 1; k < 20; k++) { const Vw = (20 * k) / 20; worst = Math.max(worst, Math.abs(waterVolumeAt(g, waterDepthOf(g, Vw)) - Vw)); }
  t(`${shape} tank: full = 20 m³, half depth = half volume, depth↔volume round trip`, Math.abs(waterVolumeAt(g, g.height) - 20) < 1e-9 && Math.abs(half - 10) < 1e-9 && worst < 1e-9, `${worst.toExponential(1)} m³`);
}
{
  const g = vesselGeometry({ volume: 30, shape: 'horizontal', diameter: 2 });
  const R = 1, h = 0.4; // segment area by hand
  const seg = R * R * Math.acos((R - h) / R) - (R - h) * Math.sqrt(2 * R * h - h * h);
  t('horizontal tank: partial volume = circular segment × length', rel(waterVolumeAt(g, h), seg * g.L) < 1e-12);
  const pc = prechargeGas(10, 30, () => 50 + HB);
  t('bladder pre-charge: p_pre·V = p0·Vg (isothermal charging)', rel(pc.gas, (10 * (30 + HB)) / (50 + HB)) < 1e-12 && pc.holdsWater);
  t('pre-charge above operating pressure → tank holds no water', !prechargeGas(10, 60, () => 50 + HB).holdsWater);
}

// ── test network: reservoir → 2 km DN500 → node N (device) → valve → 10 m → reservoir; valve closes in 0.1 s ──
const L = 2000, D = 0.5, A = area(D);
function line(devices: Partial<NetNode>, opt: { a?: number; dur?: number; H1?: number; H2?: number; close?: boolean; L1?: number } = {}): Network {
  return {
    name: 'test',
    nodes: [
      { id: 'R1', kind: 'reservoir', x: 0, y: 0, elev: 0, head: opt.H1 ?? 100 },
      { id: 'N', kind: 'junction', x: 2000, y: 0, elev: 0, demand: 0, ...devices },
      { id: 'M', kind: 'junction', x: 2005, y: 0, elev: 0, demand: 0 },
      { id: 'R2', kind: 'reservoir', x: 2010, y: 0, elev: 0, head: opt.H2 ?? 99.97 },
    ],
    pipes: [
      { id: 'P1', from: 'R1', to: 'N', length: opt.L1 ?? L, diameter: D, roughness: 0.0015, wavespeed: opt.a ?? 1200 },
      { id: 'P2', from: 'M', to: 'R2', length: 10, diameter: D, roughness: 0.0015, wavespeed: 1200 },
    ],
    pumps: [],
    valves: [{ id: 'V', from: 'N', to: 'M', diameter: D, k0: 0.2, opening: 1 }],
    event: { kind: opt.close === false ? 'none' : 'valveClose', targets: ['V'], start: 1, duration: 0.1, exponent: 1, finalOpening: 0 },
    settings: { ...defaultSettings(), duration: opt.dur ?? 160, unsteadyFriction: false, gasFraction: 1e-7, pressureDependentDemand: false },
  };
}
const run = (n: Network, frames = 3200) => runTransient(n, { frames });
function peaks(times: Float64Array, y: ArrayLike<number>, after: number) {
  const out: { t: number; v: number }[] = [];
  for (let k = 2; k < y.length - 2; k++) if (times[k] > after && y[k] >= y[k - 1] && y[k] > y[k + 1] && y[k] >= y[k - 2] && y[k] >= y[k + 2]) out.push({ t: times[k], v: y[k] });
  return out;
}
/** Peaks of a slow oscillation only: smooth over `win` seconds (removes the pipe-wave ripple), find the maxima of
 *  the smoothed signal, and report the raw maximum near each one. */
function slowPeaks(times: Float64Array, y: ArrayLike<number>, after: number, win: number) {
  const n = y.length, dtF = times[1] - times[0], hw = Math.max(1, Math.round(win / 2 / dtF));
  const pre = new Float64Array(n + 1);
  for (let k = 0; k < n; k++) pre[k + 1] = pre[k] + y[k];
  const sm = new Float64Array(n);
  for (let k = 0; k < n; k++) { const a = Math.max(0, k - hw), b = Math.min(n, k + hw + 1); sm[k] = (pre[b] - pre[a]) / (b - a); }
  const out: { t: number; v: number }[] = [];
  for (let k = hw; k < n - hw; k++) {
    if (times[k] <= after || !(sm[k] >= sm[k - 1] && sm[k] > sm[k + 1])) continue;
    let v = -Infinity;
    for (let j = k - hw; j <= k + hw; j++) v = Math.max(v, y[j]);
    if (!out.length || times[k] - out[out.length - 1].t > 4 * win) out.push({ t: times[k], v });
  }
  return out;
}

// ── hydropneumatic tank: rigid-column mass oscillation ──
function vesselTheory(r: TransientResult, n: number, As: number, extraInertia = 0, L1 = L) {
  const v = r.vessels.N;
  const H0 = r.steady.heads.N;
  const P0 = H0 - v.level[0] + HB; // absolute gas head
  const k = 1 / As + (n * P0) / v.initialGas; // head per m³ of inflow
  const I = L1 / (G * A) + extraInertia; // inertia, head per (m³/s²)
  const w = Math.sqrt(k / I);
  const Q0 = Math.abs(r.steady.flows.P1);
  return { T: (2 * Math.PI) / w, amp: Q0 * Math.sqrt(k * I) /* = I·Q0·ω */, Q0 };
}
for (const nExp of [1.0, 1.4]) {
  const net = line({ vessel: { volume: 60, gasVolume: 28, n: nExp, connDiameter: 0.5, kIn: 0, kOut: 0 } });
  const r = run(net, 40000);
  const geo = vesselGeometry({ volume: 60 });
  const th = vesselTheory(r, nExp, (Math.PI / 4) * geo.D * geo.D);
  const pk = slowPeaks(r.times, r.nodeHead.N, 1.5, 6.7);
  const T = pk[1].t - pk[0].t;
  const amp = pk[0].v - 100;
  t(`vessel n=${nExp}: period = rigid-column theory`, rel(T, th.T) < 0.02, `${T.toFixed(2)} s vs ${th.T.toFixed(2)} s`);
  t(`vessel n=${nExp}: first surge = I·Q0·ω`, rel(amp, th.amp) < 0.03, `${amp.toFixed(3)} m vs ${th.amp.toFixed(3)} m`);
  // water balance: ∫Q dt = −ΔVg (the gas loses what the water gains)
  const v = r.vessels.N, dtF = r.times[1] - r.times[0];
  let inflow = 0;
  for (let k = 1; k < v.flow.length; k++) inflow += 0.5 * (v.flow[k] + v.flow[k - 1]) * dtF;
  t(`vessel n=${nExp}: water balance ∫Q dt = −ΔV_gas`, Math.abs(inflow + (v.gas[v.gas.length - 1] - v.gas[0])) < 0.01 * Math.abs(v.maxGas - v.minGas), `${inflow.toFixed(4)} vs ${(v.gas[0] - v.gas[v.gas.length - 1]).toFixed(4)} m³`);
}
{
  // horizontal tank: free-surface stiffness 1/As uses the surface width at the initial level
  const net = line({ vessel: { volume: 60, gasVolume: 28, n: 1.2, connDiameter: 0.5, kIn: 0, kOut: 0, shape: 'horizontal', diameter: 2.5 } });
  const r = run(net);
  const g = vesselGeometry({ volume: 60, shape: 'horizontal', diameter: 2.5 });
  const h = waterDepthOf(g, 60 - 28), R = 1.25;
  const As = 2 * Math.sqrt(R * R - (R - h) * (R - h)) * g.L;
  const th = vesselTheory(r, 1.2, As);
  const pk = slowPeaks(r.times, r.nodeHead.N, 1.5, 6.7);
  t('horizontal vessel: period = theory with surface width at the water level', rel(pk[1].t - pk[0].t, th.T) < 0.02, `${(pk[1].t - pk[0].t).toFixed(2)} s vs ${th.T.toFixed(2)} s`);
}
{
  // connection pipe inertia adds in series: I = L/(gA) + Lc/(gAc)
  const Lc = 200, Dc = 0.2;
  // short main (50 m) so the connection pipe carries most of the inertia and rigid-column theory is exact
  const net = line({ vessel: { volume: 60, gasVolume: 28, n: 1.0, connDiameter: Dc, kIn: 0, kOut: 0, connLength: Lc } }, { L1: 50, H2: 99.99 });
  const r = run(net);
  const geo = vesselGeometry({ volume: 60 });
  const th = vesselTheory(r, 1.0, (Math.PI / 4) * geo.D * geo.D, Lc / (G * area(Dc)), 50);
  const neg = Array.from(r.vessels.N.gas, (x) => -x);
  const pk = slowPeaks(r.times, neg, 1.5, 1);
  t('vessel connection inertia: period with L/(gA) + Lc/(gAc)', rel(pk[1].t - pk[0].t, th.T) < 0.02, `${(pk[1].t - pk[0].t).toFixed(2)} s vs ${th.T.toFixed(2)} s`);
  const noLc = run(line({ vessel: { volume: 60, gasVolume: 28, n: 1.0, connDiameter: Dc, kIn: 0, kOut: 0 } }, { L1: 50, H2: 99.99 }));
  const pk2 = slowPeaks(noLc.times, Array.from(noLc.vessels.N.gas, (x) => -x), 1.5, 1);
  t('vessel connection inertia lengthens the period', pk[1].t - pk[0].t > (pk2[1].t - pk2[0].t) * 2, `${(pk2[1].t - pk2[0].t).toFixed(1)} → ${(pk[1].t - pk[0].t).toFixed(1)} s`);
}
{
  // non-return valve with bypass: inflow loss Kb/(2gAb²)·Q², outflow loss Kout/(2gAc²)·Q², checked at every frame
  const Db = 0.15, Kb = 1.5, Kout = 0.5, Dc = 0.5;
  const net = line({ vessel: { volume: 60, gasVolume: 28, n: 1.2, connDiameter: Dc, kIn: 2.5, kOut: Kout, inlet: 'checkBypass', bypassDiameter: Db, bypassK: Kb } }, { H2: 99.7 });
  const r = run(net);
  const v = r.vessels.N;
  const P0 = r.steady.heads.N - v.level[0] + HB, C = P0 * v.initialGas ** 1.2;
  const rin = Kb / (2 * G * area(Db) ** 2), rout = Kout / (2 * G * area(Dc) ** 2);
  let worst = 0, nIn = 0, nOut = 0;
  for (let k = 1; k < v.flow.length; k++) {
    const Q = v.flow[k];
    if (Math.abs(Q) < 0.005) continue;
    const Hv = v.level[k] + C / v.gas[k] ** 1.2 - HB;
    const loss = r.nodeHead.N[k] - Hv;
    const want = (Q > 0 ? rin : rout) * Q * Math.abs(Q);
    worst = Math.max(worst, Math.abs(loss - want) / Math.max(Math.abs(want), 0.05));
    if (Q > 0) nIn++; else nOut++;
  }
  t('non-return valve + bypass: in/out losses follow their own coefficients at every frame', worst < 0.01 && nIn > 10 && nOut > 10, `worst ${(worst * 100).toFixed(2)} %`);
  const plain = run(line({ vessel: { volume: 60, gasVolume: 28, n: 1.2, connDiameter: Dc, kIn: 2.5, kOut: Kout } }, { H2: 99.7 }));
  t('bypass throttling damps the return surge (lower 2nd peak than plain tank)', Math.max(...slowPeaks(r.times, r.nodeHead.N, 40, 6.7).map((p) => p.v)) < Math.max(...slowPeaks(plain.times, plain.nodeHead.N, 40, 6.7).map((p) => p.v)));
}
{
  // dip tube: a small tank empties down to the dip tube and no further
  const net = line({ vessel: { volume: 2, gasVolume: 1, n: 1.2, connDiameter: 0.5, kIn: 0, kOut: 0, dipTubeHeight: 0.3 } }, { H1: 100, H2: 5, dur: 40 });
  net.event = { kind: 'valveOpen', targets: ['V'], start: 1, duration: 0.5, finalOpening: 1 };
  net.valves[0].opening = 0.05;
  const r = run(net, 800);
  const v = r.vessels.N;
  const g = vesselGeometry({ volume: 2 });
  const minWater = waterVolumeAt(g, 0.3);
  const lowestWater = 2 - v.maxGas;
  t('dip tube: tank empties only down to the dip tube', v.emptied && lowestWater >= minWater - 1e-6 && lowestWater < minWater + 0.02, `lowest water ${lowestWater.toFixed(4)} m³, dip tube ${minWater.toFixed(4)} m³`);
}
{
  // bladder tank by pre-charge: run's initial gas satisfies p_pre·V = p0·Vg
  const net = line({ vessel: { volume: 10, gasVolume: 0, n: 1.2, connDiameter: 0.5, kIn: 0, kOut: 0, gasInput: 'precharge', prechargeHead: 40, bladder: true } }, { close: false, dur: 2 });
  const r = run(net, 20);
  const v = r.vessels.N;
  const p0 = r.steady.heads.N - v.level[0] + HB;
  t('bladder tank: initial gas from pre-charge', rel((40 + HB) * 10, p0 * v.initialGas) < 1e-6, `${v.initialGas.toFixed(4)} m³`);
  t('no event: tank stays at rest', Math.abs(v.maxGas - v.minGas) < 1e-7 && Math.abs(r.nodeMax.N - r.nodeMin.N) < 1e-6, `${(r.nodeMax.N - r.nodeMin.N).toExponential(1)} m`);
}

// ── open surge tank: period 2π√(L·As/(g·A)), surge Q0·√(L/(g·A·As)) ──
{
  const Dt = 0.557, As = area(Dt);
  const net = line({ tank: { diameter: Dt, bottomElev: 50, topElev: 120, connDiameter: 0.5, kIn: 0, kOut: 0 } });
  const r = run(net);
  const Q0 = Math.abs(r.steady.flows.P1);
  const T = 2 * Math.PI * Math.sqrt((L * As) / (G * A)), amp = Q0 * Math.sqrt(L / (G * A * As));
  const pk = slowPeaks(r.times, r.tanks.N.level, 1.5, 6.7);
  t('open surge tank: period = 2π√(L·As/(gA))', rel(pk[1].t - pk[0].t, T) < 0.02, `${(pk[1].t - pk[0].t).toFixed(2)} s vs ${T.toFixed(2)} s`);
  t('open surge tank: first surge = Q0·√(L/(gA·As))', rel(pk[0].v - 100, amp) < 0.03, `${(pk[0].v - 100).toFixed(3)} m vs ${amp.toFixed(3)} m`);
  t('open surge tank: node head follows the water level (no losses)', Math.abs(r.nodeHead.N[1600] - r.tanks.N.level[1600]) < 0.05);
  // overflow: the same tank with a low top spills; volume balance ∫Q dt = As·Δz + spilled
  const low = line({ tank: { diameter: Dt, bottomElev: 50, topElev: 100.5, connDiameter: 0.5, kIn: 0, kOut: 0 } }, { H2: 99.7 });
  const r2 = run(low, 40000);
  const tk = r2.tanks.N, dtF = r2.times[1] - r2.times[0];
  let inflow = 0;
  for (let k = 1; k < tk.flow.length; k++) inflow += 0.5 * (tk.flow[k] + tk.flow[k - 1]) * dtF;
  const stored = As * (tk.level[tk.level.length - 1] - tk.level[0]);
  t('surge tank overflow: level capped at the top, spilled volume reported', tk.maxLevel <= 100.5 + 1e-9 && tk.spilled > 0.1, `${tk.spilled.toFixed(3)} m³ spilled`);
  t('surge tank overflow: ∫Q dt = As·Δz + spilled', Math.abs(inflow - stored - tk.spilled) < 1e-3 * tk.spilled + 1e-3, `${inflow.toFixed(3)} vs ${(stored + tk.spilled).toFixed(3)} m³`);
}

// ── pump trip network for one-way tank, SAV and relief valve ──
function pumpLine(dev: Partial<NetNode>, dur = 60): Network {
  const pump: Pump = { id: 'PU', from: 'S', to: 'D', curve: [[0, 80], [0.25, 60], [0.4, 30]], efficiency: 0.8, speed: 1480, inertia: 5, checkValve: true, on: true };
  return {
    name: 'trip',
    nodes: [
      { id: 'W', kind: 'reservoir', x: 0, y: 0, elev: 0, head: 10 },
      { id: 'S', kind: 'junction', x: 10, y: 0, elev: 0, demand: 0 },
      { id: 'D', kind: 'junction', x: 20, y: 0, elev: 0, demand: 0, ...dev },
      { id: 'T', kind: 'reservoir', x: 3000, y: 0, elev: 40, head: 45 },
    ],
    pipes: [
      { id: 'SUC', from: 'W', to: 'S', length: 10, diameter: 0.5, roughness: 0.1, wavespeed: 1000 },
      { id: 'MAIN', from: 'D', to: 'T', length: 3000, diameter: 0.5, roughness: 0.1, wavespeed: 1000 },
    ],
    pumps: [pump],
    valves: [],
    event: { kind: 'pumpTrip', targets: ['PU'], start: 1 },
    settings: { ...defaultSettings(), duration: dur, unsteadyFriction: false },
  };
}
{
  const bare = run(pumpLine({}), 1200);
  const H0 = bare.steady.heads.D;
  const zT = H0 - 5;
  const net = pumpLine({ tank: { diameter: 3, bottomElev: zT - 6, topElev: zT + 2, connDiameter: 0.4, kIn: 1, kOut: 1, oneWay: true, initialLevel: zT } });
  const r = run(net, 1200);
  const tk = r.tanks.D;
  let rising = 0, inflow = 0, worstLow = 0;
  const rout = 1 / (2 * G * area(0.4) ** 2);
  for (let k = 1; k < tk.level.length; k++) {
    if (tk.level[k] > tk.level[k - 1] + 1e-9) rising++;
    if (tk.flow[k] > 1e-9) inflow++;
    // node head can't fall below the tank level minus the outflow loss
    worstLow = Math.max(worstLow, tk.level[k] - rout * tk.flow[k] * tk.flow[k] - r.nodeHead.D[k]);
  }
  t('one-way tank: never takes water back (level never rises, no inflow)', rising === 0 && inflow === 0);
  t('one-way tank: feeds the pipe after the trip', tk.minLevel < zT - 0.01, `level fell ${(zT - tk.minLevel).toFixed(3)} m`);
  t('one-way tank: head held at tank level minus outflow loss', worstLow < 0.05, `${worstLow.toFixed(4)} m`);
  t('one-way tank: closed before the trip', Math.abs(tk.flow[5]) < 1e-9);
  t('one-way tank: lifts the minimum head compared with no protection', r.nodeMin.D > bare.nodeMin.D + 1, `${bare.nodeMin.D.toFixed(2)} → ${r.nodeMin.D.toFixed(2)} m`);
}
{
  const bare = run(pumpLine({}), 1200);
  const p0 = bare.steady.heads.D;
  const sav = { diameter: 0.15, cd: 0.6, lowSet: p0 - 10, openTime: 2, holdTime: 5, closeTime: 20 };
  const r = run(pumpLine({ sav }), 2400);
  const o = r.savs.D;
  const A = area(0.15);
  let worst = 0, k0 = -1;
  for (let k = 0; k < o.flow.length; k++) {
    const want = 0.6 * A * o.opening[k] * Math.sqrt(2 * G * Math.max(r.nodeHead.D[k] - 0, 0));
    worst = Math.max(worst, Math.abs(o.flow[k] - want));
    if (k0 < 0 && o.opening[k] > 0) k0 = k;
  }
  t('surge anticipation valve: discharge = Cd·A·opening·√(2g·p) at every frame', worst < 1e-4 * o.maxFlow && o.maxFlow > 0.01, `max ${o.maxFlow.toFixed(3)} m³/s`);
  const tOpen = r.times[k0];
  const kFull = Array.from(o.opening).findIndex((x) => x >= 0.999);
  t('surge anticipation valve: opens after the low-pressure trigger, fully open after the opening time', o.opened >= 1 && kFull > 0 && Math.abs(r.times[kFull] - tOpen - 2) < 0.1, `opened at ${tOpen.toFixed(2)} s`);
  t('surge anticipation valve: opening schedule (open 2 s, hold 5 s, close 20 s)', Math.abs(savOpening(sav, 1) - 0.5) < 1e-12 && savOpening(sav, 5) === 1 && Math.abs(savOpening(sav, 17) - 0.5) < 1e-12 && savOpening(sav, 30) === 0);
  t('surge anticipation valve: limits the upsurge after the trip', r.nodeMax.D < bare.nodeMax.D, `${bare.nodeMax.D.toFixed(2)} → ${r.nodeMax.D.toFixed(2)} m`);
}
{
  // relief valve on a fast valve closure: flow law at every frame, and the peak is limited
  const bare = run(line({}, { dur: 20, H2: 95 }), 2000);
  const set = Math.round(bare.steady.heads.N + 0.4 * (bare.nodeMax.N - bare.steady.heads.N));
  const relief = { setHead: set, capacity: 0, diameter: 0.3, cd: 0.7, accumulation: 5 };
  const r = run(line({ relief }, { dur: 20, H2: 95 }), 2000);
  const o = r.reliefs.N;
  let worst = 0;
  for (let k = 0; k < o.flow.length; k++) worst = Math.max(worst, Math.abs(o.flow[k] - reliefFlow(relief, r.nodeHead.N[k])));
  t('relief valve: discharge = Cd·A·lift·√(2g·p) at every frame', worst < 1e-4 * o.maxFlow && o.maxFlow > 0.01, `max ${o.maxFlow.toFixed(3)} m³/s`);
  t('relief valve: limits the peak (bare peak above set + accumulation)', bare.nodeMax.N > set + 15 && r.nodeMax.N < set + 5 + 3, `${bare.nodeMax.N.toFixed(1)} → ${r.nodeMax.N.toFixed(1)} m`);
  t('relief valve: closed below the set pressure', reliefFlow(relief, set - 0.01) === 0 && reliefFlow({ setHead: 50, capacity: 0.1 }, 60) === 0.1);
}

// ── air valves on a high point: pump trip on a main over a hill ──
function hill(av: NetNode['airValve'] | undefined, dur = 60, tHead = 60): Network {
  const pump: Pump = { id: 'PU', from: 'S', to: 'D', curve: [[0, 95], [0.2, 75], [0.32, 45]], efficiency: 0.8, speed: 1480, inertia: 2, checkValve: true, on: true };
  return {
    name: 'hill',
    nodes: [
      { id: 'W', kind: 'reservoir', x: 0, y: 0, elev: 0, head: 5 },
      { id: 'S', kind: 'junction', x: 10, y: 0, elev: 0, demand: 0 },
      { id: 'D', kind: 'junction', x: 20, y: 0, elev: 0, demand: 0 },
      { id: 'HP', kind: 'junction', x: 1500, y: 0, elev: 55, demand: 0, ...(av ? { airValve: av } : {}) },
      { id: 'T', kind: 'reservoir', x: 4000, y: 0, elev: 50, head: tHead },
    ],
    pipes: [
      { id: 'SUC', from: 'W', to: 'S', length: 10, diameter: 0.4, roughness: 0.1, wavespeed: 1000 },
      { id: 'UP', from: 'D', to: 'HP', length: 1500, diameter: 0.4, roughness: 0.1, wavespeed: 1000 },
      { id: 'DOWN', from: 'HP', to: 'T', length: 2500, diameter: 0.4, roughness: 0.1, wavespeed: 1000 },
    ],
    pumps: [pump],
    valves: [],
    event: { kind: 'pumpTrip', targets: ['PU'], start: 1 },
    settings: { ...defaultSettings(), duration: dur, unsteadyFriction: false },
  };
}
{
  const base = { inDiameter: 0.1, outDiameter: 0.1 };
  const dbl = run(hill({ ...base, type: 'double' }), 3000);
  t('air valve (double): admits air at the high point after the trip', dbl.airValves.HP.maxAir > 0.01, `${(dbl.airValves.HP.maxAir * 1000).toFixed(1)} L`);
  // manufacturer-curve model built from the same orifices must give the same answer
  const m = airValveModel({ ...base });
  const dps = Array.from({ length: 101 }, (_, k) => k);
  const cur = run(hill({ ...base, type: 'curve', inCurve: orificeCurve(m.cdAin, true, dps), outCurve: orificeCurve(m.cdAout, false, dps) }), 3000);
  t('air valve (curve) = orifice model with the same flow capacity', rel(cur.airValves.HP.maxAir, dbl.airValves.HP.maxAir) < 0.01 && Math.abs(cur.nodeMax.HP - dbl.nodeMax.HP) < 0.5 && Math.abs(cur.nodeMin.HP - dbl.nodeMin.HP) < 0.05,
    `air ${(cur.airValves.HP.maxAir * 1000).toFixed(2)} vs ${(dbl.airValves.HP.maxAir * 1000).toFixed(2)} L`);
  // vacuum breaker: air only enters
  const vb = run(hill({ ...base, type: 'vacuumBreaker' }), 3000);
  const mass = vb.airValves.HP.mass;
  let drops = 0;
  for (let k = 1; k < mass.length; k++) if (mass[k] < mass[k - 1] - 1e-12) drops++;
  t('vacuum breaker: air mass never decreases (no release)', drops === 0 && mass[mass.length - 1] > 0);
  t('vacuum breaker: same minimum pressure as double-acting during the inflow phase', Math.abs(vb.nodeMin.HP - dbl.nodeMin.HP) < 0.05);
  // release only: no air ever enters → the high point drops to vapour pressure
  const ro = run(hill({ ...base, type: 'releaseOnly', smallDiameter: 0.005 }), 3000);
  t('release-only valve: no air enters', Math.max(...ro.airValves.HP.mass) === 0);
  t('release-only valve: high point falls to vapour pressure (column separation)', ro.nodeMin.HP - 55 < -9.5, `${(ro.nodeMin.HP - 55).toFixed(2)} m`);
  // three-stage: above the switch overpressure, outflow is limited to the small orifice
  const small = 0.005;
  // strong return flow: far reservoir 25 m above the high point, so the water column slams back after the trip
  const ts = run(hill({ ...base, type: 'threeStage', smallDiameter: small, switchHead: 0.02 }, 40, 80), 8000);
  const tm = ts.airValves.HP.mass, dtF = ts.times[1] - ts.times[0];
  let worst = 0, counted = 0;
  for (let k = 1; k < tm.length; k++) {
    const p = RHO * G * (ts.nodeHead.HP[k] - 55 + HB);
    const pa = RHO * G * HB;
    if (p - pa > RHO * G * 0.03 && RHO * G * (ts.nodeHead.HP[k - 1] - 55 + HB) - pa > RHO * G * 0.03 && tm[k - 1] > 0 && tm[k] > 0) {
      const rate = (tm[k - 1] - tm[k]) / dtF; // outflow kg/s
      const cap = orificeMassFlow(0.6 * area(small), RHO * G * (Math.max(ts.nodeHead.HP[k], ts.nodeHead.HP[k - 1]) - 55 + HB), pa);
      worst = Math.max(worst, rate / cap);
      counted++;
    }
  }
  t('three-stage valve: above the switch pressure air leaves only through the small orifice', worst < 1.05 && counted > 20, `${counted} frames above the switch; max ${(worst * 100).toFixed(1)} % of small-orifice capacity`);
  const afterAir = (r: TransientResult) => { const k0 = Array.from(r.airValves.HP.mass).findIndex((m) => m > 0); let mx = -Infinity; for (let k = Math.max(k0, 0); k < r.nodeHead.HP.length; k++) mx = Math.max(mx, r.nodeHead.HP[k]); return mx; };
  const dbl6 = run(hill({ ...base, type: 'double' }, 40, 80), 8000);
  const sm = run(hill({ inDiameter: 0.1, outDiameter: 0.01 }, 40, 80), 8000);
  t('three-stage valve: cushions like a small-outflow valve (peak within 5 %)', rel(afterAir(ts), afterAir(sm)) < 0.05, `${afterAir(ts).toFixed(2)} vs ${afterAir(sm).toFixed(2)} m`);
  t('three-stage valve: lower closure (slam) peak than a large double-acting orifice', afterAir(ts) < afterAir(dbl6) - 20, `${afterAir(dbl6).toFixed(2)} → ${afterAir(ts).toFixed(2)} m after the air pocket forms`);
  // treat as junction = no valve at all
  const tj = run(hill({ ...base, treatAsJunction: true }), 3000);
  const none = run(hill(undefined), 3000);
  t('Treat as junction: identical to the model without the valve', Math.abs(tj.nodeMin.HP - none.nodeMin.HP) < 1e-9 && Math.abs(tj.nodeMax.HP - none.nodeMax.HP) < 1e-9 && !tj.airValves.HP);
  // air mass balance: m(t) = state; volume = m·R·T/p at the stored head
  let wv = 0;
  for (let k = 0; k < dbl.airValves.HP.mass.length; k++) {
    const p = Math.max(RHO * G * (dbl.nodeHead.HP[k] - 55 + HB), 500);
    wv = Math.max(wv, Math.abs(dbl.airValves.HP.air[k] - (dbl.airValves.HP.mass[k] * RAIR * TAIR) / p));
  }
  t('air pocket: volume = m·R·T/p at every frame (isothermal gas law)', wv < 1e-6 * dbl.airValves.HP.maxAir, `${wv.toExponential(1)} m³ (stored in single precision)`);
}

// ── determinism: the same model run twice gives identical results ──
{
  const a = run(hill({ inDiameter: 0.1, outDiameter: 0.02, type: 'threeStage', smallDiameter: 0.008 }), 600);
  const b = run(hill({ inDiameter: 0.1, outDiameter: 0.02, type: 'threeStage', smallDiameter: 0.008 }), 600);
  t('repeat run: identical results', a.nodeMax.HP === b.nodeMax.HP && a.nodeMin.HP === b.nodeMin.HP && a.airValves.HP.maxAir === b.airValves.HP.maxAir);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
