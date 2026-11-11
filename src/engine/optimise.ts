// Surge protection optimisation by a genetic algorithm: choose the size (or absence) of every candidate device —
// air vessels and air valves — and, optionally, the pressure class or diameter of pipes, to meet the pressure limits
// at the least cost. Every candidate design is judged by
// a full surge run, so the answer respects column separation, device interaction and the real network.
import { solveSteady } from './steady';
import { runTransient } from './transient';
import type { Network } from './types';

export type DeviceKind = 'vessel' | 'airValve' | 'pipeClass' | 'pipeDiameter';
export interface OptVar {
  /** Junction id (devices) or a label for a pipe group (pipe variables). */
  node: string;
  kind: DeviceKind;
  /** Pipes set together by a pipe variable. */
  pipes?: string[];
  /** Choices: vessel volume m³, air valve inflow diameter m (0 = no device); pipe class as allowed pressure head m;
   *  pipe internal diameter m. */
  options: number[];
}
export interface OptimiseOptions {
  vars: OptVar[];
  minPressure?: number;
  /** Highest allowed pressure head (m); default: each pipe's class. */
  maxPressure?: number;
  population?: number;
  generations?: number;
  /** Relative cost of a choice (default: vessel 15 + 8·V^0.8, air valve 1.5 + 20·d, pipes L·D·(0.85 + 0.0015·class),
   *  in thousands). */
  cost?: (kind: DeviceKind, size: number, v: OptVar, net: Network) => number;
  seed?: number;
  onProgress?: (msg: string, frac: number) => void;
}
export interface Design { genes: number[]; cost: number; minP: number; maxRatio: number; feasible: boolean; score: number }
export interface OptimiseResult { best: Design; evaluations: number; history: { gen: number; best: number; feasible: boolean }[]; vars: OptVar[]; apply: (net: Network) => Network }

/** Pressure classes PN6 … PN40 as allowed pressure head, m. */
export const PIPE_CLASSES = [61, 102, 163, 255, 408];

export const defaultCost = (kind: DeviceKind, size: number, v?: OptVar, net?: Network) => {
  if (kind === 'pipeClass' || kind === 'pipeDiameter') {
    const ps = (net?.pipes ?? []).filter((p) => v?.pipes?.includes(p.id));
    return ps.reduce((s, p) => {
      const D = kind === 'pipeDiameter' ? size : p.diameter, cls = kind === 'pipeClass' ? size : p.pressureClass ?? 160;
      return s + (p.length * D * (0.85 + 0.0015 * cls)) / 1;
    }, 0);
  }
  return size <= 0 ? 0 : kind === 'vessel' ? 15 + 8 * size ** 0.8 : 1.5 + 20 * size;
};

/** Pipe variables. Classes: one per pipe (per diameter and material group above 40 pipes), the choices being the
 *  standard classes that hold the steady pressure with a 10 % margin. Diameters: per diameter and material group,
 *  the current size and the next two up. */
export function pipeCandidates(net: Network, what: 'class' | 'diameter'): OptVar[] {
  const open = net.pipes.filter((p) => !p.closed);
  const perPipe = what === 'class' && open.length <= 40;
  const groups = new Map<string, string[]>();
  for (const p of open) {
    const key = perPipe ? p.id : `${Math.round(p.diameter * 1000)}|${p.material ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), p.id]);
  }
  const sizes = [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.4, 1.6, 1.8, 2];
  let steadyP: Map<string, number> | null = null;
  if (what === 'class') {
    const st = solveSteady(net);
    const z = new Map(net.nodes.map((n) => [n.id, n.elev]));
    steadyP = new Map(open.map((p) => [p.id, Math.max((st.heads.get(p.from) ?? 0) - z.get(p.from)!, (st.heads.get(p.to) ?? 0) - z.get(p.to)!)]));
  }
  return [...groups.entries()].map(([key, ids]) => {
    const p = net.pipes.find((x) => x.id === ids[0])!;
    const label = perPipe ? key : `DN${key.split('|')[0]}${key.split('|')[1] ? ' ' + key.split('|')[1] : ''} (${ids.length} pipe${ids.length > 1 ? 's' : ''})`;
    if (what === 'class') {
      const need = 1.1 * Math.max(...ids.map((id) => steadyP!.get(id) ?? 0));
      const ok = PIPE_CLASSES.filter((c) => c >= need);
      return { node: label, kind: 'pipeClass' as const, pipes: ids, options: ok.length ? ok : [PIPE_CLASSES[PIPE_CLASSES.length - 1]] };
    }
    const up = sizes.filter((d) => d > p.diameter + 1e-6).slice(0, 2);
    return { node: label, kind: 'pipeDiameter' as const, pipes: ids, options: [p.diameter, ...up] };
  });
}

/** Candidate devices: air vessels at pump discharges, air valves at high points of the drawing's junctions. */
export function candidates(net: Network): OptVar[] {
  const out: OptVar[] = [];
  const nb = new Map<string, string[]>();
  for (const p of net.pipes) { nb.set(p.from, [...(nb.get(p.from) ?? []), p.to]); nb.set(p.to, [...(nb.get(p.to) ?? []), p.from]); }
  for (const id of new Set(net.pumps.map((p) => p.to))) {
    const n = net.nodes.find((x) => x.id === id);
    if (n?.kind === 'junction') out.push({ node: id, kind: 'vessel', options: [0, 2, 5, 10, 15, 20, 30, 45, 60, 80] });
  }
  for (const n of net.nodes) {
    if (n.kind !== 'junction' || out.some((v) => v.node === n.id)) continue;
    const ns = (nb.get(n.id) ?? []).map((id) => net.nodes.find((x) => x.id === id)!).filter(Boolean);
    if (ns.length >= 1 && ns.every((m) => m.elev < n.elev)) out.push({ node: n.id, kind: 'airValve', options: [0, 0.05, 0.08, 0.1, 0.15, 0.2] });
  }
  return out;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export function applyDesign(net: Network, vars: OptVar[], genes: number[]): Network {
  const pipeD = (id: string) => Math.max(...net.pipes.filter((p) => p.from === id || p.to === id).map((p) => p.diameter), 0.1);
  const pipeSet = new Map<string, { cls?: number; D?: number }>();
  vars.forEach((v, k) => {
    if (v.kind !== 'pipeClass' && v.kind !== 'pipeDiameter') return;
    for (const id of v.pipes ?? []) pipeSet.set(id, { ...pipeSet.get(id), ...(v.kind === 'pipeClass' ? { cls: v.options[genes[k]] } : { D: v.options[genes[k]] }) });
  });
  return {
    ...net,
    pipes: pipeSet.size ? net.pipes.map((p) => { const c = pipeSet.get(p.id); return c ? { ...p, ...(c.cls !== undefined ? { pressureClass: c.cls } : {}), ...(c.D !== undefined ? { diameter: c.D } : {}) } : p; }) : net.pipes,
    nodes: net.nodes.map((n) => {
      const k = vars.findIndex((v) => v.node === n.id && (v.kind === 'vessel' || v.kind === 'airValve'));
      if (k < 0) return n;
      const v = vars[k], size = v.options[genes[k]];
      if (v.kind === 'vessel') {
        if (size <= 0) { const m = { ...n }; delete m.vessel; return m; }
        return { ...n, vessel: { n: 1.2, kIn: 2.5, kOut: 0.5, ...(n.vessel ?? {}), volume: size, gasVolume: size * 0.5, connDiameter: Math.min(pipeD(n.id), Math.max(0.1, Math.cbrt(size) * 0.12)), gasInput: 'volume', diameter: undefined } };
      }
      if (size <= 0) { const m = { ...n }; delete m.airValve; return m; }
      return { ...n, airValve: { ...(n.airValve ?? {}), inDiameter: size, outDiameter: size / 4, smallDiameter: undefined } };
    }),
  };
}

export function optimiseProtection(net: Network, o: OptimiseOptions): OptimiseResult {
  const vars = o.vars;
  if (!vars.length) throw new Error('No candidate devices. Add candidate locations first.');
  const cost = o.cost ?? defaultCost;
  const minLim = o.minPressure ?? net.settings.minPressure;
  const pop = o.population ?? 16, gens = o.generations ?? 12;
  const rand = rng(o.seed ?? 12345);
  const changesSteady = vars.some((v) => v.kind === 'pipeDiameter');
  const steady = changesSteady ? undefined : solveSteady(net);
  const cache = new Map<string, Design>();
  let evals = 0;
  const total = pop * (gens + 1);
  const evaluate = (genes: number[]): Design => {
    const key = genes.join(',');
    const hit = cache.get(key);
    if (hit) return hit;
    evals++;
    o.onProgress?.(`Design ${evals}`, Math.min(evals / total, 1));
    const trial = applyDesign(net, vars, genes);
    const r = runTransient(trial, { steady: steady ?? solveSteady(trial), envelopeOnly: true });
    let minP = Infinity, ratio = 0;
    for (const e of r.envelopes) {
      const cls = o.maxPressure ?? trial.pipes.find((p) => p.id === e.id)?.pressureClass ?? 160;
      for (let i = 0; i < e.s.length; i++) { minP = Math.min(minP, e.hMin[i] - e.z[i]); ratio = Math.max(ratio, (e.hMax[i] - e.z[i]) / cls); }
    }
    const emptied = Object.values(r.vessels).some((v) => v.emptied);
    const c = genes.reduce((s, g, k) => s + cost(vars[k].kind, vars[k].options[g], vars[k], net), 0);
    const viol = Math.max(0, minLim - minP) + Math.max(0, ratio - 1) * 100 + (emptied ? 20 : 0);
    const d: Design = { genes, cost: c, minP, maxRatio: ratio, feasible: viol <= 1e-6, score: c + 1000 * viol };
    cache.set(key, d);
    return d;
  };
  // start: random designs plus "everything largest" and "nothing" (smallest pipes / classes)
  let popn: Design[] = [evaluate(vars.map((v) => v.options.length - 1)), evaluate(vars.map(() => 0))];
  while (popn.length < pop) popn.push(evaluate(vars.map((v) => Math.floor(rand() * v.options.length))));
  const history: OptimiseResult['history'] = [];
  const pick = () => { const a = popn[Math.floor(rand() * popn.length)], b = popn[Math.floor(rand() * popn.length)]; return a.score <= b.score ? a : b; };
  for (let g = 0; g < gens; g++) {
    popn.sort((a, b) => a.score - b.score);
    history.push({ gen: g, best: popn[0].cost, feasible: popn[0].feasible });
    const next: Design[] = popn.slice(0, 2); // elitism
    while (next.length < pop) {
      const pa = pick(), pb = pick();
      const child = pa.genes.map((x, k) => (rand() < 0.5 ? x : pb.genes[k]));
      for (let k = 0; k < child.length; k++) {
        if (rand() < 1 / child.length + 0.05) child[k] = Math.max(0, Math.min(vars[k].options.length - 1, child[k] + (rand() < 0.5 ? -1 : 1) * (rand() < 0.3 ? 2 : 1)));
      }
      next.push(evaluate(child));
    }
    popn = next;
  }
  popn.sort((a, b) => a.score - b.score);
  // local polish: try one size smaller for each device of the best feasible design
  let best = popn[0];
  for (let pass = 0; pass < 2 && best.feasible; pass++) {
    for (let k = 0; k < vars.length; k++) {
      if (best.genes[k] === 0) continue;
      const tryG = best.genes.slice(); tryG[k]--;
      const d = evaluate(tryG);
      if (d.feasible && d.cost < best.cost) best = d;
    }
  }
  history.push({ gen: gens, best: best.cost, feasible: best.feasible });
  return { best, evaluations: evals, history, vars, apply: (n) => applyDesign(n, vars, best.genes) };
}
