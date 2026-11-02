// Design checks, uncertainty envelopes and automatic surge-protection sizing.
import { solveSteady } from './steady';
import { runTransient, type PipeEnvelope, type RunOptions, type TransientResult } from './transient';
import type { Network } from './types';

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
    const cls = pipe.pressureClass ?? DEFAULT_CLASS;
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
    if (v.emptied) out.push({ level: 'fail', title: `Surge vessel ${id} empties`, detail: 'Water ran out of the vessel. Increase its volume or its initial water volume.', where: { node: id } });
    else {
      const minWater = v.volume - v.maxGas;
      out.push({ level: minWater < 0.1 * v.volume ? 'warn' : 'pass', title: `Surge vessel ${id}`, detail: `Gas volume ${v.minGas.toFixed(2)}–${v.maxGas.toFixed(2)} m³ of ${v.volume} m³; lowest water volume ${minWater.toFixed(2)} m³.`, where: { node: id } });
    }
  }
  for (const [id, a] of Object.entries(r.airValves))
    if (a.maxAir > 1e-4) out.push({ level: 'info', title: `Air valve ${id} admitted air`, detail: `Up to ${(a.maxAir * 1000).toFixed(0)} L of air, expelled again as the column returned.`, where: { node: id } });
  if (r.maxAdjust > net.settings.maxAdjust)
    out.push({ level: 'warn', title: 'Wave speeds adjusted beyond the target', detail: `Up to ${(r.maxAdjust * 100).toFixed(2)} %.` });
  else
    out.push({ level: 'pass', title: 'Exact geometry', detail: `Wave speeds adjusted by at most ${(r.maxAdjust * 100).toFixed(2)} % (HAMMER's default tolerance is 75 %); pipe lengths unchanged.${r.rigidPipes.length ? ` ${r.rigidPipes.length} very short pipe(s) modelled as rigid columns.` : ''}` });
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
  if (net.event.kind === 'valveClose' || net.event.kind === 'valveOpen') {
    variants.push({ label: 'Valve stroke −20 %', opt: { strokeFactor: 0.8 } }, { label: 'Valve stroke +20 %', opt: { strokeFactor: 1.2 } });
  }
  if (net.event.kind === 'pumpTrip') {
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
    n.vessel = { volume: V, gasVolume: V * gf, n: 1.2, connDiameter: conn, kIn: 2.5, kOut: 0.5 };
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
