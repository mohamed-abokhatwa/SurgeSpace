// Uncertainty envelopes and automatic surge-protection sizing (each runs the engines several times).
import { solveSteady } from './steady';
import { runTransient, type PipeEnvelope, type RunOptions, type TransientResult } from './transient';
import { allEvents, type Network } from './types';
import { DEFAULT_CLASS } from './results';
export * from './results';

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

