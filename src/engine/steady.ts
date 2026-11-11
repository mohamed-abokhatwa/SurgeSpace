// Steady state by the global gradient algorithm (Todini & Pilati), the method EPANET uses.
// Gives the initial heads and flows for the transient.
import { pipeR, pumpCurve, valveKv } from './hydraulics';
import { G, applyFluid, area, type Network } from './types';
import { controlArea, valveArea } from './devices';
import { prepareNetwork } from './prepare';

export interface SteadyResult {
  heads: Map<string, number>;
  flows: Map<string, number>; // link id → m³/s (positive from → to)
  iterations: number;
  converged: boolean;
  warnings: string[];
  /** Relative flow area of every valve in this steady state (control valves: the opening that meets the set point). */
  openings: Map<string, number>;
  /** Control valve statuses (only from the internal control solve). */
  controlStatus?: Map<string, 'active' | 'open' | 'closed'>;
  /** Relative speed of variable-speed pumps that hold a pressure (1 for the others). */
  speeds?: Map<string, number>;
  /** Water leaving each junction: the demand delivered (pressure-driven model) plus emitter flow, m³/s. Only for
   *  nodes where it differs from the set demand. */
  outflow?: Map<string, number>;
  /** Emitter flow at each node with an emitter, m³/s. */
  emitterFlow?: Map<string, number>;
}

interface Link {
  id: string;
  i: number;
  j: number;
  kind: 'pipe' | 'pump' | 'valve';
  ref: number;
}

/** Pump curve at a relative speed (affinity laws). */
export const atSpeed = <P extends Network['pumps'][number]>(p: P, s: number): P => (s === 1 ? p : { ...p, curve: p.curve.map(([q, h]) => [q * s, h * s * s] as [number, number]), power: p.power ? p.power * s ** 3 : undefined });

export function solveSteady(netIn: Network): SteadyResult {
  const vsd = netIn.pumps.filter((p) => p.vsd && p.on);
  if (!vsd.length) return solveSteadyBase(netIn);
  // variable-speed pumps: find each speed that meets its pressure set point (secant, all pumps together)
  const sp = new Map(vsd.map((p) => [p.id, 1]));
  const solveAt = () => solveSteadyBase({ ...netIn, pumps: netIn.pumps.map((p) => (sp.has(p.id) ? atSpeed(p, sp.get(p.id)!) : p)) });
  const errOf = (r: SteadyResult, p: Network['pumps'][number]) => (r.heads.get(p.vsd!.node) ?? NaN) - (netIn.nodes.find((n) => n.id === p.vsd!.node)?.elev ?? 0) - p.vsd!.setPressure;
  let r = solveAt();
  const prev = new Map(vsd.map((p) => [p.id, { s: 1, e: errOf(r, p) }]));
  for (const p of vsd) sp.set(p.id, 0.95);
  for (let it = 0; it < 40; it++) {
    r = solveAt();
    let worst = 0;
    for (const p of vsd) {
      const e = errOf(r, p), s = sp.get(p.id)!, pr = prev.get(p.id)!;
      worst = Math.max(worst, Math.abs(e));
      let ns = Math.abs(e - pr.e) > 1e-12 ? s - (e * (s - pr.s)) / (e - pr.e) : s - 0.01 * Math.sign(e);
      ns = Math.min(Math.max(ns, p.vsd!.minSpeed ?? 0.3), p.vsd!.maxSpeed ?? 1.05);
      if (!Number.isFinite(ns)) ns = s;
      prev.set(p.id, { s, e });
      sp.set(p.id, ns);
    }
    if (worst < 1e-4) break;
  }
  r = solveAt();
  for (const p of vsd) {
    const e = errOf(r, p);
    if (Math.abs(e) > 0.05) r.warnings.push(`Variable-speed pump ${p.id} cannot hold ${p.vsd!.setPressure} m at ${p.vsd!.node} (${e > 0 ? 'too high even at its lowest speed' : 'too low even at its highest speed'}; speed ${(sp.get(p.id)! * 100).toFixed(0)} %).`);
  }
  r.speeds = new Map(netIn.pumps.map((p) => [p.id, sp.get(p.id) ?? 1]));
  return r;
}

function solveSteadyBase(netIn: Network): SteadyResult {
  applyFluid(netIn.settings);
  const net = prepareNetwork(netIn);
  const areas = new Map(net.valves.map((v) => [v.id, valveArea(v, v.opening)] as [string, number]));
  const ctl = net.valves.filter((v) => v.control && v.opening > 0);
  if (!ctl.length) return solveFixed(net, areas);
  // control valves, as EPANET does it: inside one solve each has a status (active / open / closed); an active PRV
  // holds its downstream node at the set head, an active PSV its upstream node, an active FCV passes its set flow.
  // Then the opening that gives exactly that state is computed and checked with a second, ordinary solve.
  const r1 = solveFixed(net, areas, true);
  const note = new Map<string, string>();
  for (const v of ctl) {
    const st = r1.controlStatus!.get(v.id)!;
    if (st === 'open') { areas.set(v.id, 1); note.set(v.id, 'fully open: it cannot reach its set point'); continue; }
    if (st === 'closed') { areas.set(v.id, 0); note.set(v.id, 'closed: the set point is already exceeded with the valve shut'); continue; }
    const kq = v.k0 / (2 * G * area(v.diameter) ** 2);
    const dh = r1.heads.get(v.from)! - r1.heads.get(v.to)!;
    areas.set(v.id, Math.max(controlArea(kq, Math.max(r1.flows.get(v.id) ?? 0, 0), dh), 1e-9));
  }
  const r = solveFixed(net, areas, false, r1);
  for (const [id, why] of note) {
    const v = ctl.find((x) => x.id === id)!;
    r.warnings.push(`Control valve ${v.owner ?? id} (${v.control!.type}) is ${why}.`);
  }
  return r;
}

type CtlStatus = 'active' | 'open' | 'closed';

function solveFixed(net: Network, areas: Map<string, number>, withControl = false, init?: SteadyResult): SteadyResult {
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
  for (let i = 0; i < N; i++) if (!fixed[i]) H[i] = init?.heads.get(net.nodes[i].id) ?? maxFixed;
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
  // warm start from a previous solution of the same network
  if (init) links.forEach((l, k) => { const q = init.flows.get(l.id); if (q !== undefined && q !== 0) Q[k] = q; });
  const closed = links.map((l) => {
    if (l.kind === 'pipe') return !!net.pipes[l.ref].closed;
    if (l.kind === 'pump') return !net.pumps[l.ref].on;
    return !(areas.get(net.valves[l.ref].id)! > 0);
  });
  const demand = net.nodes.map((n) => (n.kind === 'reservoir' ? 0 : n.demand ?? 0));
  const curves = net.pumps.map((p) => pumpCurve(p));
  // emitters and pressure-driven demands: flows from a node to a virtual source at the node elevation, with a head
  // loss that grows with the flow (EPANET 2.2's treatment)
  const st = net.settings;
  const gEm = Math.max(st.emitterExp ?? 0.5, 0.05);
  const emC = net.nodes.map((n) => (n.kind === 'reservoir' ? 0 : Math.max(n.emitter ?? 0, 0)));
  const qEm = emC.map((c, i) => (c > 0 ? c * Math.sqrt(Math.max((init?.heads.get(net.nodes[i].id) ?? maxFixed) - net.nodes[i].elev, 1)) : 0));
  const pda = st.demandModel === 'PDA';
  const pMin = st.pdaMin ?? 0, pReq = Math.max(st.pdaReq ?? 0.1, pMin + 0.01), pExp = Math.max(st.pdaExp ?? 0.5, 0.05);
  const pdaNode = demand.map((d) => pda && d > 0);
  const qD = demand.map((d, i) => (pdaNode[i] ? d : 0));
  const cap = demand.map(() => 0 as -1 | 0 | 1); // −1: no supply (p ≤ pMin), +1: full demand (p ≥ pReq)
  const pEm = new Array(N).fill(0), yEm = new Array(N).fill(0), pD = new Array(N).fill(0), yD = new Array(N).fill(0);
  const emLoss = (q: number, c: number) => Math.sign(q) * (Math.abs(q) / c) ** (1 / gEm);
  const pdaLoss = (q: number, d: number) => pMin + (pReq - pMin) * (Math.max(q, 0) / d) ** (1 / pExp);
  const outOf = (n: number) => (pdaNode[n] ? qD[n] : demand[n]) + qEm[n];
  // control valves (EPANET-style statuses), only in the control solve
  const cst: (CtlStatus | null)[] = links.map((l) => (withControl && l.kind === 'valve' && net.valves[l.ref].control && areas.get(l.id)! > 0 ? 'open' : null)); // start open: always a solvable system
  const ctlInfo = links.map((l, k) => {
    if (!cst[k]) return null;
    const v = net.valves[l.ref], c = v.control!;
    const hs = c.type === 'PRV' ? net.nodes[l.j].elev + c.set : c.type === 'PSV' ? net.nodes[l.i].elev + c.set : 0;
    return { c, hs, kq: valveKv(v, 1), flips: 0 };
  });

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
      if (cst[k] === 'active') { p[k] = 1e-8; y[k] = 0; return; } // its flow is set from the node balance below
      if (closed[k]) {
        p[k] = 1e-8;
        y[k] = q; // drives the flow to zero
        return;
      }
      if (l.kind === 'pipe') {
        const r = pipeR(net.pipes[l.ref], q, net.settings.friction);
        const dh = Math.max((net.settings.friction === 'HW' ? 1.852 : 2) * r * Math.abs(q), 1e-7);
        p[k] = 1 / dh;
        y[k] = p[k] * r * q * Math.abs(q);
      } else if (l.kind === 'valve' && net.valves[l.ref].gpv?.length && areas.get(net.valves[l.ref].id)! > 0) {
        // general-purpose valve: head loss from its curve (straight-line pieces, odd in the flow)
        const c = net.valves[l.ref].gpv!, aq = Math.abs(q);
        let i = 1;
        while (i < c.length - 1 && aq > c[i][0]) i++;
        const [q0, h0] = c[Math.max(i - 1, 0)], [q1, h1] = c[Math.min(i, c.length - 1)];
        const slope = Math.max((h1 - h0) / (q1 - q0 || 1e-9), 1e-6);
        const h = (h0 + slope * (aq - q0)) * Math.sign(q || 1);
        p[k] = 1 / slope;
        y[k] = p[k] * h;
      } else if (l.kind === 'valve' && net.valves[l.ref].pbv !== undefined && areas.get(net.valves[l.ref].id)! > 0) {
        // pressure-breaker valve: a fixed head drop in the direction of flow (EPANET: very large conductance)
        p[k] = 1e8;
        y[k] = p[k] * net.valves[l.ref].pbv! * (q < 0 ? -1 : 1);
      } else if (l.kind === 'valve') {
        const kv = valveKv(net.valves[l.ref], cst[k] === 'open' ? 1 : areas.get(net.valves[l.ref].id)!);
        const dh = Math.max(2 * kv * Math.abs(q), 1e-7);
        p[k] = 1 / dh;
        y[k] = p[k] * kv * q * Math.abs(q);
      } else {
        const pc = curves[l.ref];
        const h = -pc.h(q); // head "loss" is negative (gain)
        const dh = Math.max(-pc.dh(q), 1e-7);
        p[k] = 1 / dh;
        y[k] = p[k] * h;
      }
    });
    for (let n = 0; n < N; n++) {
      if (emC[n] > 0) {
        const aq = Math.max(Math.abs(qEm[n]), 1e-9);
        const dh = Math.max((emLoss(aq, emC[n]) / aq) / gEm, 1e-7);
        pEm[n] = 1 / dh;
        yEm[n] = pEm[n] * emLoss(qEm[n], emC[n]);
      }
      if (pdaNode[n]) {
        if (cap[n] !== 0) { pD[n] = 1e-8; yD[n] = qD[n] - (cap[n] > 0 ? demand[n] : 0); continue; }
        const q = Math.min(Math.max(qD[n], 1e-9 * demand[n]), demand[n]);
        const dh = Math.max(((pReq - pMin) * (q / demand[n]) ** (1 / pExp) / q) / pExp, 1e-7);
        pD[n] = 1 / dh;
        yD[n] = pD[n] * pdaLoss(qD[n], demand[n]);
      }
    }
    // active PRV / PSV: the controlled node is held at the set head for this iteration (a fixed head)
    let fixedIt = fixed;
    if (withControl) {
      fixedIt = fixed.slice();
      links.forEach((l, k) => {
        if (cst[k] !== 'active') return;
        const ci = ctlInfo[k]!;
        const n = ci.c.type === 'PRV' ? l.j : ci.c.type === 'PSV' ? l.i : -1;
        if (n >= 0 && !fixed[n]) { fixedIt[n] = true; H[n] = ci.hs; }
      });
    }
    // assemble A·H = F over free nodes (stored as sparse rows)
    const diag = new Array(N).fill(0);
    const F = new Array(N).fill(0);
    for (let n = 0; n < N; n++) {
      if (fixedIt[n]) continue;
      F[n] = pdaNode[n] ? 0 : -demand[n];
      // emitter and pressure-driven demand: links to a fixed head at the node elevation
      if (emC[n] > 0) { diag[n] += pEm[n]; F[n] += -(qEm[n] - yEm[n]) + pEm[n] * net.nodes[n].elev; }
      if (pdaNode[n]) { diag[n] += pD[n]; F[n] += -(qD[n] - yD[n]) + pD[n] * net.nodes[n].elev; }
      for (const k of adj[n]) {
        const l = links[k];
        diag[n] += p[k];
        const other = l.i === n ? l.j : l.i;
        const sgn = l.j === n ? 1 : -1; // +1 when the link flows into n
        F[n] += sgn * (Q[k] - y[k]);
        if (fixedIt[other]) F[n] += p[k] * H[other];
      }
    }
    const Hnew = conjugateGradient(N, fixedIt, diag, adj, links, p, F, H);
    // flow update
    let dqSum = 0;
    let qSum = 0;
    links.forEach((l, k) => {
      const dq = y[k] - p[k] * (Hnew[l.i] - Hnew[l.j]);
      Q[k] -= dq;
      dqSum += Math.abs(dq);
      qSum += Math.abs(Q[k]);
    });
    for (let n = 0; n < N; n++) if (!fixedIt[n]) H[n] = Hnew[n];
    for (let n = 0; n < N; n++) {
      if (fixedIt[n]) continue;
      if (emC[n] > 0) { const dq = yEm[n] - pEm[n] * (H[n] - net.nodes[n].elev); qEm[n] -= dq; dqSum += Math.abs(dq); qSum += Math.abs(qEm[n]); }
      if (pdaNode[n]) {
        const dq = yD[n] - pD[n] * (H[n] - net.nodes[n].elev);
        qD[n] = Math.min(Math.max(qD[n] - dq, 0), demand[n]);
        dqSum += Math.abs(dq); qSum += Math.abs(qD[n]);
      }
    }
    // active control valves carry what balances their controlled node (FCV: the set flow)
    links.forEach((l, k) => {
      if (cst[k] !== 'active') return;
      const ci = ctlInfo[k]!;
      let q = ci.c.set;
      if (ci.c.type !== 'FCV') {
        const n = ci.c.type === 'PRV' ? l.j : l.i;
        let out = outOf(n);
        for (const m of adj[n]) if (m !== k) out += links[m].i === n ? Q[m] : -Q[m];
        q = ci.c.type === 'PRV' ? out : -out;
      }
      dqSum += Math.abs(q - Q[k]);
      qSum += Math.abs(q);
      Q[k] = q;
    });
    // status checks: non-return valves and pumps cannot carry reverse flow
    let statusChanged = false;
    links.forEach((l, k) => {
      if (l.kind === 'pump' && net.pumps[l.ref].on) {
        const a = curves[l.ref].h(0);
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
        } else if (closed[k] && areas.get(l.id)! > 0 && H[l.i] > H[l.j] + 1e-3) {
          closed[k] = false;
          statusChanged = true;
          Q[k] = 1e-3;
        }
      }
    });
    // pressure-driven demand: hold a node at no supply or full demand while its pressure stays beyond the limits
    for (let n = 0; n < N; n++) {
      if (!pdaNode[n] || fixedIt[n]) continue;
      const pr = H[n] - net.nodes[n].elev;
      const next: -1 | 0 | 1 = cap[n] === 1 ? (pr < pReq - 1e-6 ? 0 : 1) : cap[n] === -1 ? (pr > pMin + 1e-6 ? 0 : -1) : qD[n] >= demand[n] && pr >= pReq ? 1 : qD[n] <= 0 && pr <= pMin ? -1 : 0;
      if (next !== cap[n]) { cap[n] = next; if (next === 1) qD[n] = demand[n]; if (next === -1) qD[n] = 0; if (next === 0 && qD[n] <= 0) qD[n] = 1e-6 * demand[n]; statusChanged = true; }
    }
    links.forEach((l, k) => {
      const s0 = cst[k];
      if (!s0) return;
      const ci = ctlInfo[k]!;
      if (ci.flips > 8) return; // stop a valve that keeps switching
      if (dqSum / Math.max(qSum, 1e-9) > 1e-3) return; // as EPANET: change statuses only once the flows have settled
      const Hi = H[l.i], Hj = H[l.j], q = Q[k], hs = ci.hs, kq = ci.kq, tol = 1e-4;
      let next: CtlStatus = s0;
      if (ci.c.type === 'PRV') {
        if (s0 === 'active') next = q < -1e-9 ? 'closed' : Hi < hs + kq * q * q - tol ? 'open' : 'active';
        else if (s0 === 'open') next = q < -1e-9 ? 'closed' : Hj > hs + tol ? 'active' : 'open';
        else next = Hi > hs + tol ? 'active' : Hi > Hj + tol ? 'open' : 'closed';
      } else if (ci.c.type === 'PSV') {
        if (s0 === 'active') next = q < -1e-9 ? 'closed' : Hj + kq * q * q > hs + tol ? 'open' : 'active';
        else if (s0 === 'open') next = q < -1e-9 ? 'closed' : Hi < hs - tol ? 'active' : 'open';
        else next = Hi > hs + tol && Hi > Hj + tol ? 'active' : 'closed';
      } else {
        if (s0 === 'active') next = Hi - Hj < kq * ci.c.set * ci.c.set - tol ? 'open' : 'active';
        else if (s0 === 'open') next = q > ci.c.set + 1e-9 ? 'active' : 'open';
      }
      if ((globalThis as { __dbg?: boolean }).__dbg) console.log('it', it, l.id, s0, '->', next, 'q', q.toFixed(5), 'Hi', Hi.toFixed(3), 'Hj', Hj.toFixed(3), 'hs', hs);
      if (next !== s0) {
        cst[k] = next;
        ci.flips++;
        closed[k] = next === 'closed';
        if (next === 'open') Q[k] = Math.max(Q[k], 1e-4);
        statusChanged = true;
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
    openings: new Map(areas),
    ...(emC.some((c) => c > 0) || pda ? { outflow: new Map(net.nodes.flatMap((n, i) => (emC[i] > 0 || pdaNode[i] ? [[n.id, outOf(i)] as [string, number]] : []))) } : {}),
    ...(emC.some((c) => c > 0) ? { emitterFlow: new Map(net.nodes.flatMap((n, i) => (emC[i] > 0 ? [[n.id, qEm[i]] as [string, number]] : []))) } : {}),
    ...(withControl ? { controlStatus: new Map(links.flatMap((l, k) => (cst[k] ? [[l.id, cst[k]!] as [string, CtlStatus]] : []))) } : {}),
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
