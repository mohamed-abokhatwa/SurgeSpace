// Design checks, uncertainty envelopes and automatic surge-protection sizing.
import { solveSteady } from './steady';
import { runTransient, type PipeEnvelope, type RunOptions, type TransientResult } from './transient';
import { G, RHO, allEvents, area, type Network } from './types';

export type CheckLevel = 'fail' | 'warn' | 'pass' | 'info';
export interface Check {
  level: CheckLevel;
  title: string;
  detail: string;
  where?: { pipe?: string; node?: string; s?: number };
}

const DEFAULT_CLASS = 100; // m, when a pipe has no pressure class

export function designChecks(net: Network, r: TransientResult, envs: PipeEnvelope[] = r.envelopes): Check[] {
  const out: Check[] = [];
  const minLim = net.settings.minPressure;
  // maximum pressure vs pipe class
  let worstMax = { ratio: 0, pipe: '', s: 0, p: 0, cls: 0 };
  let worstMin = { p: Infinity, pipe: '', s: 0 };
  let cav = { v: 0, pipe: '', s: 0 };
  for (const e of envs) {
    const pipe = net.pipes.find((p) => p.id === e.id)!;
    // a project-wide maximum (Run Setup → Design limits) tightens the pipe class where it is lower
    const cls = Math.min(pipe.pressureClass ?? DEFAULT_CLASS, net.settings.maxPressure ?? Infinity);
    for (let i = 0; i < e.s.length; i++) {
      const pMax = e.hMax[i] - e.z[i];
      const pMin = e.hMin[i] - e.z[i];
      if (pMax / cls > worstMax.ratio) worstMax = { ratio: pMax / cls, pipe: e.id, s: e.s[i], p: pMax, cls };
      if (pMin < worstMin.p) worstMin = { p: pMin, pipe: e.id, s: e.s[i] };
      if (e.cavMax[i] > cav.v) cav = { v: e.cavMax[i], pipe: e.id, s: e.s[i] };
    }
  }
  const fmt = (x: number) => x.toFixed(1);
  out.push(
    worstMax.ratio > 1
      ? { level: 'fail', title: 'Maximum pressure exceeds the pipe class', detail: `${fmt(worstMax.p)} m in ${worstMax.pipe} at ${fmt(worstMax.s)} m, class ${fmt(worstMax.cls)} m (${Math.round(worstMax.ratio * 100)} %).`, where: { pipe: worstMax.pipe, s: worstMax.s } }
      : worstMax.ratio > 0.9
        ? { level: 'warn', title: 'Maximum pressure is close to the pipe class', detail: `${fmt(worstMax.p)} m in ${worstMax.pipe} (${Math.round(worstMax.ratio * 100)} % of class).`, where: { pipe: worstMax.pipe, s: worstMax.s } }
        : { level: 'pass', title: 'Maximum pressure within pipe class', detail: `Highest ${fmt(worstMax.p)} m in ${worstMax.pipe} (${Math.round(worstMax.ratio * 100)} % of class).`, where: { pipe: worstMax.pipe, s: worstMax.s } },
  );
  out.push(
    worstMin.p < minLim
      ? { level: 'fail', title: 'Minimum pressure below the limit', detail: `${fmt(worstMin.p)} m in ${worstMin.pipe} at ${fmt(worstMin.s)} m (limit ${fmt(minLim)} m).`, where: { pipe: worstMin.pipe, s: worstMin.s } }
      : { level: 'pass', title: 'Minimum pressure above the limit', detail: `Lowest ${fmt(worstMin.p)} m in ${worstMin.pipe} (limit ${fmt(minLim)} m).`, where: { pipe: worstMin.pipe, s: worstMin.s } },
  );
  if (cav.v > 1e-4)
    out.push({ level: 'fail', title: 'Column separation (vapour cavity)', detail: `Largest cavity ${(cav.v * 1000).toFixed(0)} L in ${cav.pipe} at ${fmt(cav.s)} m. The collapse can cause pressure peaks above the normal surge.`, where: { pipe: cav.pipe, s: cav.s } });
  for (const [id, v] of Object.entries(r.vessels)) {
    const reserve = v.minWater > 1e-9 ? ` (dip tube keeps ${v.minWater.toFixed(2)} m³)` : '';
    if (v.emptied) out.push({ level: 'fail', title: `Air vessel ${id} empties`, detail: `The usable water ran out${reserve}. Increase its volume or its initial water volume (less gas or a lower pre-charge).`, where: { node: id } });
    else {
      const minWater = v.volume - v.maxGas;
      const usable = minWater - v.minWater;
      out.push({ level: usable < 0.1 * v.volume ? 'warn' : 'pass', title: `Air vessel ${id}`, detail: `Gas volume ${v.minGas.toFixed(2)}–${v.maxGas.toFixed(2)} m³ of ${v.volume} m³ (start ${v.initialGas.toFixed(2)} m³); lowest water volume ${minWater.toFixed(2)} m³${reserve}.`, where: { node: id } });
    }
  }
  for (const [id, tk] of Object.entries(r.tanks ?? {})) {
    const kind = tk.oneWay ? 'One-way tank' : 'Standpipe';
    if (tk.emptied) out.push({ level: 'fail', title: `${kind} ${id} empties`, detail: 'The tank ran dry, so air can enter the pipe. Make it larger or raise its water level.', where: { node: id } });
    else if (tk.spilled > 1e-6) out.push({ level: 'warn', title: `Standpipe ${id} overflows`, detail: `${tk.spilled.toFixed(2)} m³ spilled over the top (${tk.top} m). Raise the top or enlarge the tank.`, where: { node: id } });
    else out.push({ level: 'pass', title: `${kind} ${id}`, detail: `Water level ${tk.minLevel.toFixed(2)}–${tk.maxLevel.toFixed(2)} m (bottom ${tk.bottom} m, top ${tk.top} m).`, where: { node: id } });
  }
  for (const [id, v] of Object.entries(r.savs ?? {}))
    out.push({ level: 'info', title: `Anticipator valve ${id}`, detail: v.opened ? `Opened ${v.opened} time${v.opened > 1 ? 's' : ''}; largest discharge ${(v.maxFlow * 1000).toFixed(0)} L/s.` : 'Did not open (the pressure stayed above its low set point).', where: { node: id } });
  for (const [id, v] of Object.entries(r.reliefs ?? {}))
    out.push({ level: 'info', title: `Relief valve ${id}`, detail: v.maxFlow > 1e-6 ? `Opened; largest discharge ${(v.maxFlow * 1000).toFixed(0)} L/s, ${v.volume.toFixed(2)} m³ released.` : 'Did not open.', where: { node: id } });
  for (const [id, a] of Object.entries(r.airValves))
    if (a.maxAir > 1e-4) out.push({ level: 'info', title: `Air valve ${id} admitted air`, detail: `Up to ${(a.maxAir * 1000).toFixed(0)} L of air${a.air[a.air.length - 1] > 1e-4 ? '; some air is still in the pipe at the end of the run' : ', expelled again as the column returned'}.`, where: { node: id } });
  // slams: the largest at each check valve or air valve
  const worstSlam = new Map<string, TransientResult['slams'][number]>();
  for (const sl of r.slams ?? []) {
    const k = `${sl.kind}:${sl.id}`;
    if (!worstSlam.has(k) || sl.joukowsky > worstSlam.get(k)!.joukowsky) worstSlam.set(k, sl);
  }
  for (const sl of worstSlam.values()) {
    const n = (r.slams ?? []).filter((x) => x.kind === sl.kind && x.id === sl.id).length;
    const times = n > 1 ? ` (${n} closures; the largest at ${sl.t.toFixed(2)} s)` : ` at ${sl.t.toFixed(2)} s`;
    const level: CheckLevel = sl.joukowsky >= 5 ? 'warn' : 'info';
    if (sl.kind === 'checkValve')
      out.push({ level, title: `Check valve slam: ${sl.id}`, detail: `It closed on reverse flow of ${sl.velocity.toFixed(2)} m/s${times}: slam surge a·v/g = ${fmt(sl.joukowsky)} m; peak pressure at ${sl.node.replace(/~.*/, '')} just after: ${fmt(sl.peakPressure)} m. A faster-closing (nozzle / spring-assisted) check valve reduces the reverse velocity.`, where: { node: sl.node.replace(/~.*/, '') } });
    else
      out.push({ level, title: `Air-valve slam: ${sl.id}`, detail: `The air pocket closed with the water arriving at ${sl.velocity.toFixed(2)} m/s${times}: slam surge a·v/g = ${fmt(sl.joukowsky)} m; peak pressure just after: ${fmt(sl.peakPressure)} m. A three-stage (anti-slam) valve or a smaller outflow orifice reduces it.`, where: { node: sl.node } });
  }
  for (const [id, c] of Object.entries(r.checkValves ?? {})) {
    if (c.mode === 'ideal') continue;
    const where = c.where === 'pump' ? `pump ${id}` : c.where === 'pipe' ? `pipe ${id}` : `valve ${id}`;
    out.push({ level: 'info', title: `Check valve on ${where}`, detail: c.closures ? `Closed ${c.closures} time${c.closures > 1 ? 's' : ''}; largest reverse velocity ${c.maxReverseVelocity.toFixed(2)} m/s, ${c.reverseVelocityAtClosure.toFixed(2)} m/s at closure.` : c.maxReverseVelocity > 1e-4 ? `Reverse flow up to ${c.maxReverseVelocity.toFixed(2)} m/s but it did not close.` : 'The flow never reversed.' });
  }
  for (const [id, o] of Object.entries(r.outlets ?? {})) {
    const node = net.nodes.find((x) => x.id === id);
    const what = node?.outlet?.trigger === 'pressure' ? 'Burst disc' : 'Blow-off';
    out.push({ level: o.openedAt >= 0 && node?.outlet?.trigger === 'pressure' ? 'warn' : 'info', title: `${what} ${id}`, detail: o.openedAt >= 0 ? `${node?.outlet?.trigger === 'pressure' ? 'Burst' : 'Opened'} at ${o.openedAt.toFixed(2)} s; largest discharge ${(o.maxFlow * 1000).toFixed(0)} L/s, ${o.volume.toFixed(2)} m³ released.` : node?.outlet?.trigger === 'pressure' ? 'Did not burst.' : 'Did not open during the run.', where: { node: id } });
  }
  for (const v of net.valves) {
    if (!v.control || !r.valves[v.id]) continue;
    const op = r.valves[v.id].opening;
    let lo = Infinity, hi = -Infinity;
    for (const x of op) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    const name = { PRV: 'Pressure reducing valve', PSV: 'Pressure sustaining valve', FCV: 'Flow control valve' }[v.control.type];
    const set = v.control.type === 'FCV' ? `${(v.control.set * 1000).toFixed(1)} L/s` : `${fmt(v.control.set)} m`;
    out.push({ level: 'info', title: `${name} ${v.id}`, detail: `Set point ${set}; ${v.control.active ? 'active during the transient' : 'locked at its steady opening during the transient'}. Opening ${(lo * 100).toFixed(1)}–${(hi * 100).toFixed(1)} % of full area.` });
  }
  if (r.maxAdjust > net.settings.maxAdjust)
    out.push({ level: 'warn', title: 'Wave speeds adjusted beyond the target', detail: `Up to ${(r.maxAdjust * 100).toFixed(2)} %.` });
  else
    out.push({ level: 'pass', title: 'Exact geometry', detail: `Wave speeds adjusted by at most ${(r.maxAdjust * 100).toFixed(2)} %; pipe lengths unchanged.${r.rigidPipes.length ? ` ${r.rigidPipes.length} very short pipe(s) modelled as rigid columns.` : ''}` });
  for (const tr of turbineSpeeds(net, r)) {
    if (tr.mode !== 'rejection') { out.push({ level: 'info', title: `Turbine ${tr.id}`, detail: `Synchronised to the grid; rated output ${tr.ratedPower.toFixed(0)} kW.` }); continue; }
    const pct = Math.round((tr.maxSpeed - 1) * 100);
    out.push(tr.maxSpeed > 1.5
      ? { level: 'fail', title: `Turbine ${tr.id} overspeeds on load rejection`, detail: `Speed rises ${pct} % (to ${(tr.maxSpeed * 100).toFixed(0)} %) at ${tr.tMax.toFixed(2)} s. Close the gates faster or add inertia (a flywheel), or relieve the flow with a bypass valve.` }
      : tr.maxSpeed > 1.35
        ? { level: 'warn', title: `Turbine ${tr.id} speed rise is high`, detail: `Speed rises ${pct} % at ${tr.tMax.toFixed(2)} s on load rejection (typical guarantee 35–50 %).` }
        : { level: 'pass', title: `Turbine ${tr.id} speed rise acceptable`, detail: `Speed rises ${pct} % at ${tr.tMax.toFixed(2)} s on load rejection.` });
  }
  for (const w of r.warnings) out.push({ level: 'warn', title: 'Note', detail: w });
  return out;
}

export interface UncertaintyRun {
  label: string;
  maxHead: number;
  minPressure: number;
  result: TransientResult;
}
export interface Uncertainty {
  runs: UncertaintyRun[];
  envelopes: PipeEnvelope[]; // worst case over all runs, on the base run's grid
  spread: { maxHead: [number, number]; minPressure: [number, number] };
}

const summary = (r: TransientResult) => {
  let maxH = -Infinity, minP = Infinity;
  for (const e of r.envelopes)
    for (let i = 0; i < e.s.length; i++) {
      maxH = Math.max(maxH, e.hMax[i]);
      minP = Math.min(minP, e.hMin[i] - e.z[i]);
    }
  return { maxH, minP };
};

const interp = (xs: Float64Array, ys: Float64Array, x: number) => {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1] || 1);
  return ys[ys.length - 1];
};

/** Re-run with the uncertain inputs varied and return the worst-case envelope. */
export function uncertainty(net: Network, base: TransientResult, onProgress?: (done: number, total: number) => void): Uncertainty {
  const variants: { label: string; opt: RunOptions }[] = [
    { label: 'Wave speed −10 %', opt: { waveFactor: 0.9 } },
    { label: 'Wave speed +10 %', opt: { waveFactor: 1.1 } },
  ];
  const kinds = new Set(allEvents(net).map((e) => e.kind));
  if (kinds.has('valveClose') || kinds.has('valveOpen')) {
    variants.push({ label: 'Valve stroke −20 %', opt: { strokeFactor: 0.8 } }, { label: 'Valve stroke +20 %', opt: { strokeFactor: 1.2 } });
  }
  if (kinds.has('pumpTrip')) {
    variants.push({ label: 'Pump inertia −15 %', opt: { inertiaFactor: 0.85 } }, { label: 'Pump inertia +15 %', opt: { inertiaFactor: 1.15 } });
  }
  const hasCavity = base.envelopes.some((e) => e.cavMax.some((v) => v > 1e-4));
  if (hasCavity) variants.push({ label: 'Half time step (cavity collapse sensitivity)', opt: { dtMax: base.dt / 2 } });
  const steady = solveSteady(net);
  const runs: UncertaintyRun[] = [{ label: 'Base case', ...(() => { const s = summary(base); return { maxHead: s.maxH, minPressure: s.minP }; })(), result: base }];
  variants.forEach((v, k) => {
    onProgress?.(k, variants.length);
    const r = runTransient(net, { ...v.opt, steady, envelopeOnly: true });
    const s = summary(r);
    runs.push({ label: v.label, maxHead: s.maxH, minPressure: s.minP, result: r });
  });
  onProgress?.(variants.length, variants.length);
  const envelopes = base.envelopes.map((e) => {
    const hMax = e.hMax.slice();
    const hMin = e.hMin.slice();
    const cavMax = e.cavMax.slice();
    for (const run of runs.slice(1)) {
      const o = run.result.envelopes.find((x) => x.id === e.id);
      if (!o) continue;
      for (let i = 0; i < e.s.length; i++) {
        hMax[i] = Math.max(hMax[i], interp(o.s, o.hMax, e.s[i]));
        hMin[i] = Math.min(hMin[i], interp(o.s, o.hMin, e.s[i]));
        cavMax[i] = Math.max(cavMax[i], interp(o.s, o.cavMax, e.s[i]));
      }
    }
    return { ...e, hMax, hMin, cavMax };
  });
  const mh = runs.map((r) => r.maxHead), mp = runs.map((r) => r.minPressure);
  return { runs, envelopes, spread: { maxHead: [Math.min(...mh), Math.max(...mh)], minPressure: [Math.min(...mp), Math.max(...mp)] } };
}

export interface VesselSizing {
  ok: boolean;
  node: string;
  volume: number;
  gasVolume: number;
  connDiameter: number;
  minPressure: number;
  maxPressureRatio: number;
  tried: { volume: number; gasFraction: number; pass: boolean; minPressure: number }[];
  message: string;
}

/** Smallest surge vessel at `nodeId` that keeps every point above the minimum pressure, within pipe class, without emptying. */
export function sizeVessel(net: Network, nodeId: string, onProgress?: (msg: string) => void): VesselSizing {
  const node = net.nodes.find((n) => n.id === nodeId);
  if (!node || node.kind === 'reservoir') throw new Error('Choose a junction for the surge vessel.');
  const steady = solveSteady(net);
  const qMain = Math.max(...net.pumps.map((p) => Math.abs(steady.flows.get(p.id) ?? 0)), ...net.pipes.filter((p) => p.from === nodeId || p.to === nodeId).map((p) => Math.abs(steady.flows.get(p.id) ?? 0)), 0.01);
  const conn = Math.max(0.1, Math.min(1.0, Math.round(Math.sqrt((4 * qMain) / (Math.PI * 3)) * 20) / 20)); // ~3 m/s at full main flow
  const tried: VesselSizing['tried'] = [];
  const evaluate = (V: number, gf: number) => {
    const trial: Network = structuredClone(net);
    const n = trial.nodes.find((x) => x.id === nodeId)!;
    // keep the tank type the user chose (shape, bladder, dip tube, connection, losses); only size and gas change
    const tpl = node.vessel;
    n.vessel = { n: 1.2, kIn: 2.5, kOut: 0.5, ...tpl, diameter: undefined, gasInput: 'volume', volume: V, gasVolume: V * gf, connDiameter: conn };
    const r = runTransient(trial, { steady, envelopeOnly: true });
    const s = summary(r);
    let ratio = 0;
    for (const e of r.envelopes) {
      const cls = trial.pipes.find((p) => p.id === e.id)!.pressureClass ?? DEFAULT_CLASS;
      for (let i = 0; i < e.s.length; i++) ratio = Math.max(ratio, (e.hMax[i] - e.z[i]) / cls);
    }
    const emptied = Object.values(r.vessels).some((v) => v.emptied);
    const pass = s.minP >= net.settings.minPressure && ratio <= 1 && !emptied;
    tried.push({ volume: V, gasFraction: gf, pass, minPressure: s.minP });
    return { pass, minP: s.minP, ratio };
  };
  let best: { V: number; gf: number; minP: number; ratio: number } | null = null;
  for (const gf of [0.35, 0.5, 0.65]) {
    onProgress?.(`Initial gas ${Math.round(gf * 100)} %…`);
    let lo = 0.2, hi = 5;
    let hiRes = evaluate(hi, gf);
    while (!hiRes.pass && hi < 3000) {
      lo = hi;
      hi *= 3;
      hiRes = evaluate(hi, gf);
    }
    if (!hiRes.pass) continue;
    for (let k = 0; k < 9 && hi / lo > 1.04; k++) {
      const mid = Math.sqrt(lo * hi);
      const m = evaluate(mid, gf);
      if (m.pass) { hi = mid; hiRes = m; } else lo = mid;
    }
    if (!best || hi < best.V) best = { V: hi, gf, minP: hiRes.minP, ratio: hiRes.ratio };
  }
  if (!best) return { ok: false, node: nodeId, volume: 0, gasVolume: 0, connDiameter: conn, minPressure: NaN, maxPressureRatio: NaN, tried, message: 'No vessel up to 3,000 m³ meets the criteria at this location. Try another location, air valves at the high points, or a higher pipe class.' };
  const V = Math.ceil(best.V * 1.1 * 2) / 2; // 10 % margin, rounded up to 0.5 m³
  return {
    ok: true, node: nodeId, volume: V, gasVolume: Math.round(V * best.gf * 100) / 100, connDiameter: conn, minPressure: best.minP, maxPressureRatio: best.ratio, tried,
    message: `Smallest passing vessel ${best.V.toFixed(1)} m³ (initial gas ${Math.round(best.gf * 100)} %); recommended ${V} m³ with a 10 % margin and a DN${Math.round(conn * 1000)} connection.`,
  };
}

export interface AirValveSuggestion {
  node: string;
  minPressure: number;
  inDiameter: number;
}

/** High points that go below the limit get an air valve; the smallest standard inflow size that fixes each is chosen. */
export function suggestAirValves(net: Network, base: TransientResult, onProgress?: (msg: string) => void): AirValveSuggestion[] {
  const lim = net.settings.minPressure;
  const deg = new Map<string, number>();
  net.pipes.forEach((p) => { deg.set(p.from, (deg.get(p.from) ?? 0) + 1); deg.set(p.to, (deg.get(p.to) ?? 0) + 1); });
  const candidates = net.nodes.filter((n) => {
    if (n.kind === 'reservoir' || n.airValve || n.vessel) return false;
    if (base.nodeMin[n.id] - n.elev >= lim) return false;
    const nb = net.pipes.filter((p) => p.from === n.id || p.to === n.id).map((p) => net.nodes.find((x) => x.id === (p.from === n.id ? p.to : p.from))!);
    return nb.length > 0 && nb.every((m) => m.elev <= n.elev + 0.01); // local high point
  });
  const out: AirValveSuggestion[] = [];
  const sizes = [0.05, 0.08, 0.1, 0.15, 0.2, 0.25, 0.3];
  const steady = solveSteady(net);
  for (const c of candidates) {
    onProgress?.(`Air valve at ${c.id}…`);
    for (const d of sizes) {
      const trial: Network = structuredClone(net);
      trial.nodes.find((x) => x.id === c.id)!.airValve = { inDiameter: d, outDiameter: Math.max(0.01, d / 4) };
      const r = runTransient(trial, { steady, envelopeOnly: true });
      const p = r.nodeMin[c.id] - c.elev;
      if (p >= lim || d === sizes[sizes.length - 1]) {
        out.push({ node: c.id, minPressure: p, inDiameter: d });
        break;
      }
    }
  }
  return out;
}

/** Loss coefficient (fully open, on the bore velocity) that makes a turbine pass its rated flow at its rated head. */
export function turbineK(t: { ratedHead: number; ratedFlow: number }, diameter: number): number {
  const A = (Math.PI / 4) * diameter * diameter;
  const V = t.ratedFlow / Math.max(A, 1e-9);
  return Math.max((2 * 9.80665 * t.ratedHead) / Math.max(V * V, 1e-12), 1e-3);
}

export interface TurbineRun {
  id: string;
  /** Runner speed per frame, fraction of synchronous speed. */
  speed: Float32Array;
  /** Hydraulic power per frame, kW. */
  power: Float32Array;
  maxSpeed: number;
  tMax: number;
  ratedPower: number;
  mode: 'rejection' | 'acceptance' | 'none';
}

/** Runner speed of each turbine from the power balance I·ω·dω/dt = P_hydraulic − P_generator.
 *  Load rejection: the generator load falls to zero at the operation start, so the unit speeds up until the gates
 *  have closed enough. Load acceptance and normal running: the unit stays synchronised to the grid (speed 1). */
export function turbineSpeeds(net: Network, r: TransientResult): TurbineRun[] {
  const out: TurbineRun[] = [];
  const evs = allEvents(net);
  const t = r.times;
  for (const v of net.valves) {
    const tb = v.turbine;
    const vr = r.valves[v.id];
    if (!tb || !vr) continue;
    const ev = evs.find((e) => e.targets.includes(v.id));
    const mode = ev?.turbineOp ?? (ev?.kind === 'valveClose' ? 'rejection' : ev?.kind === 'valveOpen' ? 'acceptance' : 'none');
    const hf = r.nodeHead[v.from], ht = r.nodeHead[v.to];
    const n = t.length;
    const speed = new Float32Array(n), power = new Float32Array(n);
    const w0 = (2 * Math.PI * tb.speed) / 60;
    const rho = 998.2, g = 9.80665;
    for (let k = 0; k < n; k++) {
      const dH = hf && ht ? hf[k] - ht[k] : tb.ratedHead;
      power[k] = (rho * g * Math.max(vr.flow[k], 0) * Math.max(dH, 0) * tb.efficiency) / 1000;
    }
    let w = w0, maxW = w0, tMax = 0;
    speed[0] = 1;
    if (vr.speed) {
      // speed from the governor in the surge run
      for (let k = 0; k < n; k++) { speed[k] = vr.speed[k] || 1; if (speed[k] * w0 > maxW) { maxW = speed[k] * w0; tMax = t[k]; } }
      out.push({ id: v.id, speed, power, maxSpeed: maxW / w0, tMax, ratedPower: (rho * g * tb.ratedFlow * tb.ratedHead * tb.efficiency) / 1000, mode });
      continue;
    }
    for (let k = 1; k < n; k++) {
      const dt = t[k] - t[k - 1];
      const rejected = mode === 'rejection' && ev && t[k] >= ev.start;
      if (!rejected) { w = w0; speed[k] = 1; continue; }
      // the efficiency falls as the runner overspeeds; a simple parabola keeps the runaway speed finite (~1.8 ×)
      const ratio = w / w0;
      const eta = Math.max(0, 1 - ((ratio - 1) / 0.8) ** 2);
      const Ph = power[k] * 1000 * eta;
      // after the rejection the only load is windage and bearing friction (about 1 % of rated power at rated speed, ∝ ω³)
      const Pw = 0.01 * rho * g * tb.ratedFlow * tb.ratedHead * tb.efficiency * ratio ** 3;
      w = Math.max(0, w + (dt * (Ph - Pw)) / Math.max(tb.inertia * w, 1e-6));
      speed[k] = w / w0;
      if (w > maxW) { maxW = w; tMax = t[k]; }
    }
    out.push({ id: v.id, speed, power, maxSpeed: maxW / w0, tMax, ratedPower: (rho * g * tb.ratedFlow * tb.ratedHead * tb.efficiency) / 1000, mode });
  }
  return out;
}

export interface PipeForce { id: string; maxForce: number; tMax: number; steadyForce: number; maxDelta: number; sections: number }
/** Unbalanced axial forces for anchor and thrust-block design. For each straight section of a pipe (between bends
 *  and ends, from the animation samples), the force along the section is F = ρ g A (h₁ − h₂), with h the pressure
 *  head at its two ends: the part of the surge that pushes the section along its axis while a wave travels through
 *  it (steady pressure is balanced by the bends and anchors, so maxDelta = the transient part is also given). kN. */
export function pipeForces(net: Network, r: TransientResult): PipeForce[] {
  const out: PipeForce[] = [];
  const nf = r.times.length;
  for (const p of net.pipes) {
    const s = r.frameSamples[p.id], H = r.frameHeads[p.id];
    if (!s || !H || s.length < 2) continue;
    const ns = s.length;
    const A = area(p.diameter);
    const a = net.nodes.find((n) => n.id === p.from)!, b = net.nodes.find((n) => n.id === p.to)!;
    const prof = [{ s: 0, z: a.elev }, ...(p.profile ?? []).filter((q) => q.s > 0 && q.s < p.length).sort((u, v) => u.s - v.s), { s: p.length, z: b.elev }];
    const zAt = (x: number) => { for (let i = 1; i < prof.length; i++) if (x <= prof[i].s) return prof[i - 1].z + ((prof[i].z - prof[i - 1].z) * (x - prof[i - 1].s)) / (prof[i].s - prof[i - 1].s || 1); return prof[prof.length - 1].z; };
    // sections: between profile break points and the pipe ends, at the nearest samples
    const cuts = [...new Set([0, ...prof.slice(1, -1).map((q) => nearestIndex(s, q.s)), ns - 1])].sort((x, y) => x - y);
    let best = { f: 0, t: 0, st: 0, d: 0 };
    for (let c = 1; c < cuts.length; c++) {
      const i = cuts[c - 1], j = cuts[c];
      if (i === j) continue;
      const zi = zAt(s[i]), zj = zAt(s[j]);
      const f0 = (RHO * G * A * ((H[i] - zi) - (H[j] - zj))) / 1000;
      for (let k = 0; k < nf; k++) {
        const f = (RHO * G * A * ((H[k * ns + i] - zi) - (H[k * ns + j] - zj))) / 1000;
        if (Math.abs(f) > Math.abs(best.f)) best = { ...best, f, t: r.times[k], st: f0 };
        best.d = Math.max(best.d, Math.abs(f - f0));
      }
    }
    out.push({ id: p.id, maxForce: best.f, tMax: best.t, steadyForce: best.st, maxDelta: best.d, sections: cuts.length - 1 });
  }
  return out;
}
const nearestIndex = (arr: ArrayLike<number>, x: number) => { let k = 0; for (let i = 1; i < arr.length; i++) if (Math.abs(arr[i] - x) < Math.abs(arr[k] - x)) k = i; return k; };
