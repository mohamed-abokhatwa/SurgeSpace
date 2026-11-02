// Steady state by the global gradient algorithm (Todini & Pilati), the method EPANET uses.
// Gives the initial heads and flows for the transient.
import { pipeR, pumpQuadratic, valveKv } from './hydraulics';
import { area, type Network } from './types';

export interface SteadyResult {
  heads: Map<string, number>;
  flows: Map<string, number>; // link id → m³/s (positive from → to)
  iterations: number;
  converged: boolean;
  warnings: string[];
}

interface Link {
  id: string;
  i: number;
  j: number;
  kind: 'pipe' | 'pump' | 'valve';
  ref: number;
}

export function solveSteady(net: Network): SteadyResult {
  const warnings: string[] = [];
  const idx = new Map(net.nodes.map((n, i) => [n.id, i]));
  const N = net.nodes.length;
  const fixed = net.nodes.map((n) => n.kind === 'reservoir');
  const links: Link[] = [];
  const nodeOf = (id: string, who: string) => {
    const v = idx.get(id);
    if (v === undefined) throw new Error(`${who}: unknown node "${id}"`);
    return v;
  };
  net.pipes.forEach((p, k) => links.push({ id: p.id, i: nodeOf(p.from, p.id), j: nodeOf(p.to, p.id), kind: 'pipe', ref: k }));
  net.pumps.forEach((p, k) => links.push({ id: p.id, i: nodeOf(p.from, p.id), j: nodeOf(p.to, p.id), kind: 'pump', ref: k }));
  net.valves.forEach((v, k) => links.push({ id: v.id, i: nodeOf(v.from, v.id), j: nodeOf(v.to, v.id), kind: 'valve', ref: k }));

  const H = net.nodes.map((n) => (n.kind === 'reservoir' ? n.head ?? n.elev : NaN));
  const maxFixed = Math.max(...H.filter((h) => !Number.isNaN(h)), ...net.nodes.map((n) => n.elev));
  for (let i = 0; i < N; i++) if (!fixed[i]) H[i] = maxFixed;
  if (!fixed.some(Boolean)) throw new Error('The network needs at least one reservoir or tank (a fixed head).');

  // initial flows: 1 m/s in pipes, rated flow in running pumps
  const Q = links.map((l) => {
    if (l.kind === 'pipe') return area(net.pipes[l.ref].diameter) * 0.3;
    if (l.kind === 'pump') {
      const p = net.pumps[l.ref];
      return p.on ? [...p.curve].sort((a, b) => a[0] - b[0])[Math.min(1, p.curve.length - 1)][0] : 0;
    }
    return area(net.valves[l.ref].diameter) * 0.3;
  });
  const closed = links.map((l) => {
    if (l.kind === 'pipe') return !!net.pipes[l.ref].closed;
    if (l.kind === 'pump') return !net.pumps[l.ref].on;
    return net.valves[l.ref].opening <= 0;
  });
  const demand = net.nodes.map((n) => (n.kind === 'reservoir' ? 0 : n.demand ?? 0));

  // node adjacency for the sparse system
  const adj: number[][] = Array.from({ length: N }, () => []);
  links.forEach((l, k) => {
    adj[l.i].push(k);
    adj[l.j].push(k);
  });

  let converged = false;
  let it = 0;
  const p = new Array(links.length).fill(0);
  const y = new Array(links.length).fill(0);
  for (it = 1; it <= 200; it++) {
    // link linearisation
    links.forEach((l, k) => {
      const q = Q[k];
      if (closed[k]) {
        p[k] = 1e-8;
        y[k] = q; // drives the flow to zero
        return;
      }
      if (l.kind === 'pipe') {
        const r = pipeR(net.pipes[l.ref], q, net.settings.friction);
        const dh = Math.max(2 * r * Math.abs(q), 1e-7);
        p[k] = 1 / dh;
        y[k] = p[k] * r * q * Math.abs(q);
      } else if (l.kind === 'valve') {
        const kv = valveKv(net.valves[l.ref], net.valves[l.ref].opening);
        const dh = Math.max(2 * kv * Math.abs(q), 1e-7);
        p[k] = 1 / dh;
        y[k] = p[k] * kv * q * Math.abs(q);
      } else {
        const { a, b, c } = pumpQuadratic(net.pumps[l.ref]);
        const h = -(a + b * q + c * q * q); // head "loss" is negative (gain)
        const dh = Math.max(-(b + 2 * c * q), 1e-7);
        p[k] = 1 / dh;
        y[k] = p[k] * h;
      }
    });
    // assemble A·H = F over free nodes (stored as sparse rows)
    const diag = new Array(N).fill(0);
    const F = new Array(N).fill(0);
    for (let n = 0; n < N; n++) {
      if (fixed[n]) continue;
      F[n] = -demand[n];
      for (const k of adj[n]) {
        const l = links[k];
        diag[n] += p[k];
        const other = l.i === n ? l.j : l.i;
        const sgn = l.j === n ? 1 : -1; // +1 when the link flows into n
        F[n] += sgn * (Q[k] - y[k]);
        if (fixed[other]) F[n] += p[k] * H[other];
      }
    }
    const Hnew = conjugateGradient(N, fixed, diag, adj, links, p, F, H);
    // flow update
    let dqSum = 0;
    let qSum = 0;
    links.forEach((l, k) => {
      const dq = y[k] - p[k] * (Hnew[l.i] - Hnew[l.j]);
      Q[k] -= dq;
      dqSum += Math.abs(dq);
      qSum += Math.abs(Q[k]);
    });
    for (let n = 0; n < N; n++) if (!fixed[n]) H[n] = Hnew[n];
    // status checks: non-return valves and pumps cannot carry reverse flow
    let statusChanged = false;
    links.forEach((l, k) => {
      if (l.kind === 'pump' && net.pumps[l.ref].on) {
        const pump = net.pumps[l.ref];
        const { a } = pumpQuadratic(pump);
        if (!closed[k] && Q[k] < -1e-6) {
          closed[k] = true;
          statusChanged = true;
        } else if (closed[k] && H[l.j] - H[l.i] < a) {
          closed[k] = false;
          statusChanged = true;
          Q[k] = 1e-3;
        }
      }
      if (l.kind === 'valve' && net.valves[l.ref].check) {
        if (!closed[k] && Q[k] < -1e-6) {
          closed[k] = true;
          statusChanged = true;
        } else if (closed[k] && H[l.i] > H[l.j] + 1e-3) {
          closed[k] = false;
          statusChanged = true;
          Q[k] = 1e-3;
        }
      }
    });
    if (!statusChanged && dqSum / Math.max(qSum, 1e-9) < 1e-7) {
      converged = true;
      break;
    }
  }
  if (!converged) warnings.push('Steady state did not fully converge in 200 iterations; check pump curves and closed valves.');
  links.forEach((l, k) => {
    if (closed[k]) Q[k] = 0;
    if (l.kind === 'pump' && net.pumps[l.ref].on && closed[k]) warnings.push(`Pump ${l.id} cannot deliver against the system head (shut-off head too low).`);
  });
  net.nodes.forEach((n, i) => {
    if (n.kind !== 'reservoir' && H[i] - n.elev < 0) warnings.push(`Node ${n.id} has negative steady pressure (${(H[i] - n.elev).toFixed(1)} m).`);
  });
  return {
    heads: new Map(net.nodes.map((n, i) => [n.id, H[i]])),
    flows: new Map(links.map((l, k) => [l.id, Q[k]])),
    iterations: it,
    converged,
    warnings,
  };
}

/** Jacobi-preconditioned conjugate gradient on the free-node system. */
function conjugateGradient(
  N: number,
  fixed: boolean[],
  diag: number[],
  adj: number[][],
  links: Link[],
  p: number[],
  F: number[],
  H0: number[],
): number[] {
  const free = [] as number[];
  for (let n = 0; n < N; n++) if (!fixed[n]) free.push(n);
  const x = H0.slice();
  const mul = (v: number[], out: number[]) => {
    for (const n of free) {
      let s = diag[n] * v[n];
      for (const k of adj[n]) {
        const l = links[k];
        const o = l.i === n ? l.j : l.i;
        if (!fixed[o]) s -= p[k] * v[o];
      }
      out[n] = s;
    }
  };
  const r = new Array(N).fill(0);
  const z = new Array(N).fill(0);
  const d = new Array(N).fill(0);
  const Ad = new Array(N).fill(0);
  mul(x, Ad);
  let rz = 0;
  let bnorm = 0;
  for (const n of free) {
    r[n] = F[n] - Ad[n];
    z[n] = r[n] / diag[n];
    d[n] = z[n];
    rz += r[n] * z[n];
    bnorm += F[n] * F[n];
  }
  bnorm = Math.sqrt(bnorm) || 1;
  for (let it = 0; it < 5 * free.length + 50; it++) {
    mul(d, Ad);
    let dAd = 0;
    for (const n of free) dAd += d[n] * Ad[n];
    if (dAd === 0) break;
    const alpha = rz / dAd;
    let rn = 0;
    for (const n of free) {
      x[n] += alpha * d[n];
      r[n] -= alpha * Ad[n];
      rn += r[n] * r[n];
    }
    if (Math.sqrt(rn) / bnorm < 1e-12) break;
    let rzNew = 0;
    for (const n of free) {
      z[n] = r[n] / diag[n];
      rzNew += r[n] * z[n];
    }
    const beta = rzNew / rz;
    rz = rzNew;
    for (const n of free) d[n] = z[n] + beta * d[n];
  }
  return x;
}
