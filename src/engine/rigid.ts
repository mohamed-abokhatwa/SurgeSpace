// Rigid-column engine: the water in every pipe moves as one incompressible column (L/gA · dQ/dt = ΔH − losses).
// No pressure waves, so large time steps can be used: suited to slow events and long runs — surge tank and
// vessel mass oscillation, slow valve strokes, pump start-up and run-down over minutes, fast screening of
// options. For fast events (pump trip with a long main, quick valve closure) use the wave engine.
// Solved implicitly at each step (Newton on all heads, flows, pump speeds and device flows together).
import { interpTable, valveArea } from './devices';
import { fourQuadrant, omegaRated, pipeR, pumpCurve, pumpHeadAt, pumpTorqueQuadratic, solveDense, type FourQ } from './hydraulics';
import { prepareNetwork } from './prepare';
import { solveSteady, type SteadyResult } from './steady';
import type { PipeEnvelope, RunOptions, TransientResult } from './transient';
import { G, HB, HV, allEvents, applyFluid, area, type Network, type TransientEvent } from './types';

export const RIGID_MAX_UNKNOWNS = 600;

export function runRigid(netIn: Network, opt: RunOptions = {}): TransientResult {
  const t0 = performance.now();
  applyFluid(netIn.settings);
  const steady: SteadyResult = opt.steady ?? solveSteady(netIn);
  const net = prepareNetwork(netIn);
  const st = net.settings;
  const warnings: string[] = ['Rigid-column engine: water columns are incompressible; pressure waves (and the water hammer they cause) are not modelled.'];
  const nodes = net.nodes;
  const nIdx = new Map(nodes.map((n, i) => [n.id, i]));
  const evs = allEvents(net);
  const valveEv = new Map<string, TransientEvent>(), pumpEv = new Map<string, TransientEvent>();
  for (const e of evs) for (const id of e.targets) {
    if ((e.kind === 'valveClose' || e.kind === 'valveOpen') && !valveEv.has(id)) valveEv.set(id, e);
    if (e.kind === 'pumpTrip' && !pumpEv.has(id)) pumpEv.set(id, e);
  }
  // time step: small enough for the fastest operation, at most 0.1 s
  let dt = opt.dtMax ?? 0.1;
  for (const e of evs) if (e.duration && e.duration > 0) dt = Math.min(dt, Math.max(e.duration / 50, 0.005));
  if (evs.some((e) => e.kind === 'pumpTrip' && (e.pumpMode ?? 'trip') === 'trip')) dt = Math.min(dt, 0.02);
  const steps = Math.ceil(st.duration / dt);
  for (const n of nodes) {
    if (n.airValve && !n.airValve.treatAsJunction) warnings.push(`Air valve at ${n.id} is not modelled by the rigid-column engine (no column separation).`);
    if (n.sav || n.relief || n.outlet) warnings.push(`Device at ${n.id} (anticipator, relief or outlet) is not modelled by the rigid-column engine.`);
  }

  // ── unknowns ──
  const isRes = nodes.map((n) => n.kind === 'reservoir');
  const free = nodes.map((_, i) => i).filter((i) => !isRes[i]);
  const fIdx = new Map(free.map((i, k) => [i, k]));
  type L = { kind: 'pipe' | 'pump' | 'valve'; id: string; i: number; j: number; ref: number; Q: number; closed: boolean };
  const links: L[] = [
    ...net.pipes.map((p, k): L => ({ kind: 'pipe', id: p.id, i: nIdx.get(p.from)!, j: nIdx.get(p.to)!, ref: k, Q: steady.flows.get(p.id) ?? 0, closed: !!p.closed })),
    ...net.pumps.map((p, k): L => ({ kind: 'pump', id: p.id, i: nIdx.get(p.from)!, j: nIdx.get(p.to)!, ref: k, Q: steady.flows.get(p.id) ?? 0, closed: !p.on || (steady.flows.get(p.id) ?? 0) <= 0 })),
    ...net.valves.map((v, k): L => ({ kind: 'valve', id: v.id, i: nIdx.get(v.from)!, j: nIdx.get(v.to)!, ref: k, Q: steady.flows.get(v.id) ?? 0, closed: false })),
  ];
  const pumpS = net.pumps.map((p) => ({ alpha: p.on ? 1 : 0, alphaSet: p.on ? 1 : 0, on: p.on, tripped: false, curve: pumpCurve(p), tq: pumpTorqueQuadratic(p), fq: p.fourQuadrant ? fourQuadrant(p) as FourQ : undefined, w: omegaRated(p), T: 0 }));
  const head = (k: number, q: number, a: number) => { const s = pumpS[k]; return s.fq ? s.fq.head(q, a) : pumpHeadAt(s.curve, q, a); };
  const torque = (k: number, q: number, a: number) => { const s = pumpS[k]; return s.fq ? s.fq.torque(q, a) : s.tq.ta * a * a + s.tq.tb * a * q + s.tq.tc * q * q; };
  pumpS.forEach((s, k) => (s.T = torque(k, links[net.pipes.length + k].Q, s.alpha)));
  const valveBase = net.valves.map((v) => steady.openings?.get(v.id) ?? valveArea(v, v.opening));
  const valveOpen = valveBase.slice();
  // storage devices at nodes
  type Dev = { node: number; kind: 'vessel' | 'tank'; Qs: number; Vg: number; C: number; n: number; bottom: number; area: number; total: number; kIn: number; kOut: number; z: number; oneWay: boolean; top: number; minGas: number; maxGas: number; spilled: number; emptied: boolean; minLevel: number; maxLevel: number };
  const devs: Dev[] = [];
  nodes.forEach((n, i) => {
    if (isRes[i]) return;
    const H0 = steady.heads.get(n.id) ?? n.elev;
    if (n.vessel) {
      const v = n.vessel, A = area(v.connDiameter);
      const bottom = v.bottomElev ?? n.elev;
      const D = v.diameter ?? Math.cbrt((4 * v.volume) / (Math.PI * 2));
      const Aw = area(D);
      const Vg = Math.min(v.gasVolume, v.volume * 0.98);
      const zw = bottom + (v.volume - Vg) / Aw;
      const pAbs = H0 - zw + HB;
      devs.push({ node: i, kind: 'vessel', Qs: 0, Vg, C: pAbs * Vg ** v.n, n: v.n, bottom, area: Aw, total: v.volume, kIn: v.kIn / (2 * G * A * A), kOut: v.kOut / (2 * G * A * A), z: zw, oneWay: false, top: bottom + v.volume / Aw, minGas: Vg, maxGas: Vg, spilled: 0, emptied: false, minLevel: zw, maxLevel: zw });
    } else if (n.tank) {
      const tk = n.tank, A = area(tk.connDiameter);
      const z = tk.oneWay ? tk.initialLevel ?? tk.bottomElev + 0.9 * (tk.topElev - tk.bottomElev) : H0;
      devs.push({ node: i, kind: 'tank', Qs: 0, Vg: 0, C: 0, n: 1, bottom: tk.bottomElev, area: area(tk.diameter), total: 0, kIn: tk.kIn / (2 * G * A * A), kOut: tk.kOut / (2 * G * A * A), z, oneWay: !!tk.oneWay, top: tk.topElev, minGas: 0, maxGas: 0, spilled: 0, emptied: false, minLevel: z, maxLevel: z });
    }
  });
  const tripped = () => pumpS.map((s, k) => (s.tripped ? k : -1)).filter((k) => k >= 0);
  const nU = () => free.length + links.length + tripped().length + devs.length;
  if (nU() > RIGID_MAX_UNKNOWNS) throw new Error(`The rigid-column engine handles models up to about ${Math.floor(RIGID_MAX_UNKNOWNS / 2)} pipes; this one is larger. Use the wave engine.`);

  // ── outputs ──
  const nFrames = Math.max(2, Math.min(opt.frames ?? st.frames ?? 600, steps + 1));
  const every = Math.max(1, Math.floor(steps / (nFrames - 1)));
  const fr = Math.floor(steps / every) + 1;
  const times = new Float64Array(fr);
  const nodeHead: Record<string, Float32Array> = {};
  nodes.forEach((n) => (nodeHead[n.id] = new Float32Array(fr)));
  const frameSamples: Record<string, Float64Array> = {}, frameHeads: Record<string, Float32Array> = {}, frameFlows: Record<string, Float32Array> = {};
  const pumps: TransientResult['pumps'] = {};
  net.pumps.forEach((p) => (pumps[p.id] = { speed: new Float32Array(fr), flow: new Float32Array(fr), reverseFlow: false }));
  const valves: TransientResult['valves'] = {};
  net.valves.forEach((v) => (valves[v.owner ?? v.id] = { opening: new Float32Array(fr), flow: new Float32Array(fr) }));
  const vessels: TransientResult['vessels'] = {}, tanks: TransientResult['tanks'] = {};
  devs.forEach((d) => {
    const id = nodes[d.node].id;
    if (d.kind === 'vessel') vessels[id] = { gas: new Float32Array(fr), flow: new Float32Array(fr), level: new Float32Array(fr), minGas: d.Vg, maxGas: d.Vg, volume: d.total, initialGas: d.Vg, emptied: false, minWater: d.total - d.Vg, bottom: d.bottom, top: d.top };
    else tanks[id] = { level: new Float32Array(fr), flow: new Float32Array(fr), minLevel: d.z, maxLevel: d.z, bottom: d.bottom, top: d.top, spilled: 0, emptied: false, oneWay: d.oneWay };
  });
  // envelopes: the head line is straight along a rigid pipe (uniform friction), so interior points interpolate
  const env = net.pipes.filter((p) => !p.closed).map((p) => {
    const prof = [{ s: 0, z: nodes[nIdx.get(p.from)!].elev }, ...(p.profile ?? []).filter((q) => q.s > 0 && q.s < p.length).sort((a, b) => a.s - b.s), { s: p.length, z: nodes[nIdx.get(p.to)!].elev }];
    const s = Float64Array.from(prof.map((x) => x.s)), z = Float64Array.from(prof.map((x) => x.z));
    const hi = steady.heads.get(p.from) ?? 0, hj = steady.heads.get(p.to) ?? 0;
    const h = Float64Array.from(prof.map((x) => hi + ((hj - hi) * x.s) / p.length));
    frameSamples[p.id] = Float64Array.from([0, p.length]);
    frameHeads[p.id] = new Float32Array(fr * 2);
    frameFlows[p.id] = new Float32Array(fr);
    return { pipe: p, i: nIdx.get(p.from)!, j: nIdx.get(p.to)!, e: { id: p.id, s, z, hSteady: h, hMax: h.slice(), hMin: h.slice(), cavMax: new Float64Array(s.length), tMax: new Float64Array(s.length), tMin: new Float64Array(s.length) } as PipeEnvelope };
  });

  // ── state ──
  const H = nodes.map((n) => (n.kind === 'reservoir' ? n.head ?? n.elev : steady.heads.get(n.id) ?? n.elev));
  const res0 = nodes.map((n) => n.head ?? n.elev);
  const demand = nodes.map((n) => (n.kind === 'junction' ? n.demand ?? 0 : 0));
  let slow = 0;

  const resHead = (i: number, t: number) => {
    const n = nodes[i], s = n.headSchedule;
    if (!s) return res0[i];
    if (s.mode === 'sine') return res0[i] + (s.amplitude ?? 0) * Math.sin((2 * Math.PI * t) / Math.max(s.period ?? 1, 1e-6) + ((s.phase ?? 0) * Math.PI) / 180);
    return res0[i] + (s.table?.length ? interpTable(s.table, t) : 0);
  };

  const step = (t: number) => {
    // events
    net.pumps.forEach((p, k) => {
      const ev = pumpEv.get(p.id), s = pumpS[k];
      if (!ev || t < ev.start) return;
      if (ev.pumpMode === 'start') { s.on = true; s.alphaSet = Math.min(1, (t - ev.start) / Math.max(ev.duration ?? 0, 1e-9)); s.alpha = s.alphaSet; links[net.pipes.length + k].closed = false; }
      else if (ev.pumpMode === 'ramp') { s.alphaSet = Math.max(0, 1 - (t - ev.start) / Math.max(ev.duration ?? 0, 1e-9)); s.alpha = s.alphaSet; }
      else if (s.on && !s.tripped) s.tripped = true;
    });
    net.valves.forEach((v, k) => {
      const ev = valveEv.get(v.id);
      if (!ev || t <= ev.start) return;
      if (ev.curve && ev.curve.length >= 2) { valveOpen[k] = valveArea(v, interpTable([...ev.curve].sort((a, b) => a[0] - b[0]), t - ev.start)); return; }
      const tf = ev.finalOpening ?? (ev.kind === 'valveClose' ? 0 : 1);
      const s = (ev.duration ?? 0) > 0 ? Math.min((t - ev.start) / ev.duration!, 1) : 1;
      valveOpen[k] = valveArea(v, tf + (v.opening - tf) * (1 - s) ** (ev.exponent ?? 1));
    });
    nodes.forEach((_, i) => { if (isRes[i]) H[i] = resHead(i, t); });
    const tp = tripped();
    const nf = free.length, nl = links.length;
    const n = nf + nl + tp.length + devs.length;
    const Qold = links.map((l) => l.Q);
    const aOld = tp.map((k) => pumpS[k].alpha);
    const x = [...free.map((i) => H[i]), ...Qold, ...aOld, ...devs.map((d) => d.Qs)];
    const resid = (v: number[]) => {
      const r = new Array(n).fill(0);
      const h = (i: number) => (isRes[i] ? H[i] : v[fIdx.get(i)!]);
      free.forEach((i, k) => (r[k] = -demand[i]));
      links.forEach((l, k) => {
        const q = v[nf + k];
        const fi = fIdx.get(l.i), fj = fIdx.get(l.j);
        if (fi !== undefined) r[fi] -= q;
        if (fj !== undefined) r[fj] += q;
        let e: number;
        if (l.closed) e = q;
        else if (l.kind === 'pipe') {
          const p = net.pipes[l.ref];
          const c = p.length / (G * area(p.diameter) * dt);
          e = c * (q - Qold[k]) + pipeR(p, q, st.friction) * q * Math.abs(q) - (h(l.i) - h(l.j));
        } else if (l.kind === 'pump') {
          const s = pumpS[l.ref];
          const ti = tp.indexOf(l.ref);
          const a = ti >= 0 ? v[nf + nl + ti] : s.on ? s.alphaSet : 0;
          e = h(l.j) - h(l.i) - head(l.ref, q, a);
        } else {
          const vv = net.valves[l.ref], A = area(vv.diameter), o = valveOpen[l.ref];
          e = o <= 0 ? q : (vv.k0 / (2 * G * A * A)) * q * Math.abs(q) - o * o * (h(l.i) - h(l.j));
        }
        r[nf + k] = e;
      });
      tp.forEach((pk, k) => {
        const a = v[nf + nl + k], s = pumpS[pk], p = net.pumps[pk];
        const q = v[nf + net.pipes.length + pk];
        r[nf + nl + k] = a - aOld[k] + (dt * (torque(pk, q, a) + s.T)) / (2 * p.inertia * s.w);
      });
      devs.forEach((d, k) => {
        const Qs = v[nf + nl + tp.length + k];
        const fi = fIdx.get(d.node)!;
        r[fi] -= Qs;
        const loss = (Qs > 0 ? d.kIn : d.kOut) * Qs * Math.abs(Qs);
        let Hd: number;
        if (d.kind === 'vessel') {
          const Vg = Math.min(Math.max(d.Vg - Qs * dt, 1e-6), d.total);
          const zw = d.bottom + (d.total - Vg) / d.area;
          Hd = d.C / Vg ** d.n - HB + zw;
        } else Hd = d.z + (Qs * dt) / d.area;
        r[nf + nl + tp.length + k] = (d.kind === 'tank' && d.oneWay && Qs >= 0 && v[fi] >= Hd) ? Qs : v[fi] - Hd - loss;
      });
      return r;
    };
    for (let it = 0; it < 40; it++) {
      const r = resid(x);
      const norm = Math.max(...r.map(Math.abs));
      if (norm < 1e-9) break;
      const J = Array.from({ length: n }, () => new Array(n).fill(0));
      for (let k = 0; k < n; k++) {
        const hh = 1e-7 * Math.max(1, Math.abs(x[k]));
        const xp = x.slice(); xp[k] += hh;
        const rp = resid(xp);
        for (let m = 0; m < n; m++) J[m][k] = (rp[m] - r[m]) / hh;
      }
      const d = solveDense(J, r.map((v) => -v));
      let lam = 1;
      for (let ls = 0; ls < 20; ls++) {
        const xn = x.map((v, k) => v + lam * d[k]);
        if (Math.max(...resid(xn).map(Math.abs)) < norm || ls === 19) { for (let k = 0; k < n; k++) x[k] = xn[k]; break; }
        lam /= 2;
      }
      if (it === 39) slow++;
    }
    // non-return valves on pumps and valves (ideal): close on reverse flow, reopen when the head allows
    links.forEach((l, k) => {
      const q = x[nf + k];
      const check = l.kind === 'pump' ? net.pumps[l.ref].checkValve : l.kind === 'valve' ? !!net.valves[l.ref].check : false;
      if (l.kind === 'pump' && !pumpS[l.ref].on) { l.closed = true; return; }
      if (!check) { if (l.kind !== 'pipe') l.closed = false; return; }
      if (!l.closed && q < -1e-9) l.closed = true;
      else if (l.closed) {
        const lift = l.kind === 'pump' ? head(l.ref, 0, pumpS[l.ref].alpha) : 0;
        const hi = isRes[l.i] ? H[l.i] : x[fIdx.get(l.i)!], hj = isRes[l.j] ? H[l.j] : x[fIdx.get(l.j)!];
        if (hi + lift > hj + 1e-6 && (l.kind === 'pump' ? pumpS[l.ref].alpha > 0.01 : valveOpen[l.ref] > 0)) l.closed = false;
      }
    });
    free.forEach((i, k) => (H[i] = x[k]));
    links.forEach((l, k) => (l.Q = l.closed ? 0 : x[nf + k]));
    tp.forEach((pk, k) => { pumpS[pk].alpha = Math.max(x[nf + nl + k], pumpS[pk].fq ? -3 : 0); });
    pumpS.forEach((s, k) => (s.T = torque(k, links[net.pipes.length + k].Q, s.alpha)));
    devs.forEach((d, k) => {
      const Qs = x[nf + nl + tp.length + k];
      d.Qs = Qs;
      if (d.kind === 'vessel') {
        d.Vg = Math.min(Math.max(d.Vg - Qs * dt, 1e-6), d.total);
        if (d.Vg >= d.total - 1e-6) d.emptied = true;
        d.minGas = Math.min(d.minGas, d.Vg); d.maxGas = Math.max(d.maxGas, d.Vg);
        d.z = d.bottom + (d.total - d.Vg) / d.area;
      } else {
        d.z += (Qs * dt) / d.area;
        if (d.z > d.top) { d.spilled += (d.z - d.top) * d.area; d.z = d.top; }
        if (d.z < d.bottom) { d.emptied = true; d.z = d.bottom; }
      }
      d.minLevel = Math.min(d.minLevel, d.z); d.maxLevel = Math.max(d.maxLevel, d.z);
    });
  };

  let frame = 0;
  const record = (t: number) => {
    times[frame] = t;
    nodes.forEach((nn, i) => (nodeHead[nn.id][frame] = H[i]));
    for (const p of env) { frameHeads[p.pipe.id][frame * 2] = H[p.i]; frameHeads[p.pipe.id][frame * 2 + 1] = H[p.j]; frameFlows[p.pipe.id][frame] = links.find((l) => l.id === p.pipe.id)!.Q; }
    net.pumps.forEach((p, k) => { pumps[p.id].speed[frame] = pumpS[k].alpha; pumps[p.id].flow[frame] = links[net.pipes.length + k].Q; });
    net.valves.forEach((v, k) => { const o = valves[v.owner ?? v.id]; o.opening[frame] = valveOpen[k]; o.flow[frame] = links[net.pipes.length + net.pumps.length + k].Q; });
    devs.forEach((d) => {
      const id = nodes[d.node].id;
      if (d.kind === 'vessel') { vessels[id].gas[frame] = d.Vg; vessels[id].flow[frame] = d.Qs; vessels[id].level[frame] = d.z; }
      else { tanks[id].level[frame] = d.z; tanks[id].flow[frame] = d.Qs; }
    });
    frame++;
  };
  const nodeMax = nodes.map((_, i) => H[i]), nodeMin = nodes.map((_, i) => H[i]);
  record(0);
  for (let k = 1; k <= steps; k++) {
    const t = k * dt;
    step(t);
    H.forEach((h, i) => { nodeMax[i] = Math.max(nodeMax[i], h); nodeMin[i] = Math.min(nodeMin[i], h); });
    for (const p of env) {
      const L = p.pipe.length;
      for (let m = 0; m < p.e.s.length; m++) {
        const h = H[p.i] + ((H[p.j] - H[p.i]) * p.e.s[m]) / L;
        if (h > p.e.hMax[m]) { p.e.hMax[m] = h; p.e.tMax[m] = t; }
        if (h < p.e.hMin[m]) { p.e.hMin[m] = h; p.e.tMin[m] = t; }
      }
    }
    if (k % every === 0 && frame < fr) record(t);
  }
  if (slow) warnings.push(`The rigid-column solve converged slowly at ${slow} step(s).`);
  for (const p of env) if (p.e.hMin.some((h, m) => h - p.e.z[m] < HV - HB)) { warnings.push(`Pressure falls to vapour pressure in pipe ${p.pipe.id}: the water column would separate. Use the wave engine for this case.`); break; }
  devs.forEach((d) => {
    const id = nodes[d.node].id;
    if (d.kind === 'vessel') Object.assign(vessels[id], { minGas: d.minGas, maxGas: d.maxGas, emptied: d.emptied, minWater: d.total - d.maxGas });
    else Object.assign(tanks[id], { minLevel: d.minLevel, maxLevel: d.maxLevel, spilled: d.spilled, emptied: d.emptied });
    if (d.emptied) warnings.push(`${d.kind === 'vessel' ? 'Air vessel' : 'Tank'} at ${id} emptied.`);
  });
  net.pumps.forEach((p) => { if (Array.from(pumps[p.id].flow).some((q) => q < -1e-6)) pumps[p.id].reverseFlow = true; });

  return {
    ok: true, dt, steps, reaches: 0, maxAdjust: 0, pipeAdjust: {}, rigidPipes: net.pipes.map((p) => p.id),
    times: times.slice(0, frame), nodeHead, frameSamples, frameHeads, frameFlows, envelopes: env.map((p) => p.e),
    nodeMax: Object.fromEntries(nodes.map((nn, i) => [nn.id, nodeMax[i]])), nodeMin: Object.fromEntries(nodes.map((nn, i) => [nn.id, nodeMin[i]])),
    vessels, tanks, savs: {}, reliefs: {}, pumps, airValves: {}, valves, checkValves: {}, outlets: {}, slams: [],
    steady: { heads: Object.fromEntries(steady.heads), flows: Object.fromEntries(steady.flows) },
    warnings, runtimeMs: performance.now() - t0,
  };
}
