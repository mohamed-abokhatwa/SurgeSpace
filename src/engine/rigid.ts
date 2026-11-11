// Rigid-column engine: the water in every pipe moves as one incompressible column (L/gA · dQ/dt = ΔH − losses).
// No pressure waves, so large time steps can be used: suited to slow events and long runs — surge tank and
// vessel mass oscillation, slow valve strokes, pump start-up and run-down over minutes, fast screening of
// options. For fast events (pump trip with a long main, quick valve closure) use the wave engine.
// Solved implicitly at each step (Newton on all heads, flows, pump speeds and device flows together).
import { interpTable, motorTorque, turbineFactors, valveArea } from './devices';
import { fourQuadrant, omegaRated, pipeR, pumpCurve, pumpHeadAt, pumpRatedQ, pumpTorqueQuadratic, solveDense, type FourQ } from './hydraulics';
import { prepareNetwork } from './prepare';
import { solveSteady, type SteadyResult } from './steady';
import type { PipeEnvelope, RunOptions, TransientResult } from './transient';
import { G, HB, HV, RHO, allEvents, applyFluid, area, type Network, type TransientEvent } from './types';

export const RIGID_MAX_UNKNOWNS = 40000;

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
  const pumpS = net.pumps.map((p) => ({ alpha: p.on ? steady.speeds?.get(p.id) ?? 1 : 0, alphaSet: p.on ? steady.speeds?.get(p.id) ?? 1 : 0, on: p.on, tripped: false, curve: pumpCurve(p), tq: pumpTorqueQuadratic(p), fq: p.fourQuadrant ? fourQuadrant(p) as FourQ : undefined, w: omegaRated(p), T: 0, motorOn: false, t0: 0 }));
  let tNow = 0;
  const head = (k: number, q: number, a: number) => { const s = pumpS[k]; return s.fq ? s.fq.head(q, a) : pumpHeadAt(s.curve, q, a); };
  const torque = (k: number, q: number, a: number) => {
    const s = pumpS[k], p = net.pumps[k];
    const T = s.fq ? s.fq.torque(q, a) : s.tq.ta * a * a + s.tq.tb * a * q + s.tq.tc * q * q;
    if (!s.motorOn || !p.motor) return T;
    const qr = pumpRatedQ(p);
    return T - motorTorque(p.motor, s.tq.ta + s.tq.tb * qr + s.tq.tc * qr * qr, a, tNow - s.t0);
  };
  pumpS.forEach((s, k) => (s.T = torque(k, links[net.pipes.length + k].Q, s.alpha)));
  const valveBase = net.valves.map((v) => steady.openings?.get(v.id) ?? valveArea(v, v.opening));
  const valveOpen = valveBase.slice();
  const gateOpen = valveBase.slice();
  const turb = net.valves.map((v) => {
    const tb = v.turbine;
    if (!tb || (!tb.characteristic && !tb.governor)) return null;
    const ev = valveEv.get(v.id);
    const rejected = !!ev && (ev.turbineOp ?? (ev.kind === 'valveClose' ? 'rejection' : 'acceptance')) === 'rejection';
    const w0 = (2 * Math.PI * tb.speed) / 60;
    const dH0 = Math.max((steady.heads.get(v.from) ?? 0) - (steady.heads.get(v.to) ?? 0), 1e-3);
    const f0 = tb.characteristic ? turbineFactors(tb.characteristic, 1 / Math.sqrt(dH0 / tb.ratedHead)).flow : 1;
    return { start: ev?.start ?? Infinity, rejected, w: w0, w0, I: 0, stroke: v.opening, ratedP: RHO * G * tb.ratedFlow * tb.ratedHead * tb.efficiency, f0 };
  });
  // pressure-breaker and general-purpose valves keep their steady head loss as a fixed restriction
  const valveKq = net.valves.map((v, k) => {
    const q = steady.flows.get(v.id) ?? 0;
    if ((v.pbv === undefined && !v.gpv?.length) || Math.abs(q) < 1e-9 || valveBase[k] <= 0) return undefined;
    const dh = Math.abs((steady.heads.get(v.from) ?? 0) - (steady.heads.get(v.to) ?? 0));
    return (valveBase[k] ** 2 * dh) / (q * q);
  });
  // storage devices at nodes
  type Dev = { node: number; kind: 'vessel' | 'tank' | 'chamber'; chamber?: number; Qs: number; Vg: number; C: number; n: number; bottom: number; area: number; total: number; kIn: number; kOut: number; z: number; oneWay: boolean; top: number; minGas: number; maxGas: number; spilled: number; emptied: boolean; minLevel: number; maxLevel: number };
  const devs: Dev[] = [];
  const tankCurves = new Map<number, [number, number][]>();
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
      const ac = tk.areaCurve && tk.areaCurve.length >= 2 ? [...tk.areaCurve].sort((p, q) => p[0] - q[0]) as [number, number][] : null;
      const df = tk.differential && !tk.oneWay ? tk.differential : null;
      if (df) {
        // differential tank: the riser (direct) and the chamber behind the ports are two stores at the node
        const Ar = area(df.riserDiameter), rp = 1 / (2 * G * (df.portCd ?? 0.6) ** 2 * Math.max(df.portArea, 1e-9) ** 2);
        const Ach = Math.max((ac ? interpTable(ac, z) : area(tk.diameter)) - Ar, 1e-6);
        devs.push({ node: i, kind: 'tank', chamber: devs.length + 1, Qs: 0, Vg: 0, C: 0, n: 1, bottom: tk.bottomElev, area: Ar, total: 0, kIn: tk.kIn / (2 * G * A * A), kOut: tk.kOut / (2 * G * A * A), z, oneWay: false, top: Math.min(df.riserTop ?? tk.topElev, tk.topElev), minGas: 0, maxGas: 0, spilled: 0, emptied: false, minLevel: z, maxLevel: z });
        if (ac) tankCurves.set(devs.length, ac.map(([zz, a]) => [zz, a - Ar] as [number, number]));
        devs.push({ node: i, kind: 'chamber', Qs: 0, Vg: 0, C: 0, n: 1, bottom: tk.bottomElev, area: Ach, total: 0, kIn: rp, kOut: rp, z, oneWay: false, top: tk.topElev, minGas: 0, maxGas: 0, spilled: 0, emptied: false, minLevel: z, maxLevel: z });
        return;
      }
      if (ac) tankCurves.set(devs.length, ac);
      devs.push({ node: i, kind: 'tank', Qs: 0, Vg: 0, C: 0, n: 1, bottom: tk.bottomElev, area: ac ? Math.max(interpTable(ac, z), 1e-6) : area(tk.diameter), total: 0, kIn: tk.kIn / (2 * G * A * A), kOut: tk.kOut / (2 * G * A * A), z, oneWay: !!tk.oneWay, top: tk.topElev, minGas: 0, maxGas: 0, spilled: 0, emptied: false, minLevel: z, maxLevel: z });
    }
  });
  const tripped = () => pumpS.map((s, k) => (s.tripped ? k : -1)).filter((k) => k >= 0);
  const nU = () => free.length + links.length + tripped().length + devs.length;
  if (nU() > RIGID_MAX_UNKNOWNS) throw new Error(`The rigid-column engine handles models up to about ${Math.floor(RIGID_MAX_UNKNOWNS / 2).toLocaleString('en')} pipes; this one is larger. Use the wave engine.`);

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
    else if (d.kind === 'tank') tanks[id] = { level: new Float32Array(fr), flow: new Float32Array(fr), minLevel: d.z, maxLevel: d.z, bottom: d.bottom, top: nodes[d.node].tank!.topElev, spilled: 0, emptied: false, oneWay: d.oneWay, ...(d.chamber !== undefined ? { chamber: { level: new Float32Array(fr), minLevel: d.z, maxLevel: d.z } } : {}) };
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
    return { pipe: p, k: net.pipes.indexOf(p), i: nIdx.get(p.from)!, j: nIdx.get(p.to)!, e: { id: p.id, s, z, hSteady: h, hMax: h.slice(), hMin: h.slice(), cavMax: new Float64Array(s.length), tMax: new Float64Array(s.length), tMin: new Float64Array(s.length) } as PipeEnvelope };
  });

  // ── state ──
  const H = nodes.map((n) => (n.kind === 'reservoir' ? n.head ?? n.elev : steady.heads.get(n.id) ?? n.elev));
  const res0 = nodes.map((n) => n.head ?? n.elev);
  const demand = nodes.map((n) => (n.kind !== 'junction' ? 0 : steady.outflow?.has(n.id) ? Math.max(steady.outflow.get(n.id)! - (steady.emitterFlow?.get(n.id) ?? 0), 0) : n.demand ?? 0));
  const emG = Math.max(st.emitterExp ?? 0.5, 0.05);
  const emC = nodes.map((n) => (n.kind === 'junction' ? Math.max(n.emitter ?? 0, 0) : 0));
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
      if (ev.pumpMode === 'start' && net.pumps[k].motor) {
        if (!s.motorOn) { tNow = t - dt; s.motorOn = true; s.t0 = ev.start; s.on = true; s.tripped = true; s.T = torque(k, links[net.pipes.length + k].Q, s.alpha); links[net.pipes.length + k].closed = false; }
      } else if (ev.pumpMode === 'start') { s.on = true; s.alphaSet = Math.min(1, (t - ev.start) / Math.max(ev.duration ?? 0, 1e-9)); s.alpha = s.alphaSet; links[net.pipes.length + k].closed = false; }
      else if (ev.pumpMode === 'ramp') { s.alphaSet = Math.max(0, 1 - (t - ev.start) / Math.max(ev.duration ?? 0, 1e-9)); s.alpha = s.alphaSet; }
      else if (s.on && !s.tripped) s.tripped = true;
    });
    tNow = t;
    net.valves.forEach((v, k) => {
      const ev = valveEv.get(v.id);
      if (!ev || t <= ev.start) return;
      if (ev.curve && ev.curve.length >= 2) { gateOpen[k] = valveArea(v, interpTable([...ev.curve].sort((a, b) => a[0] - b[0]), t - ev.start)); return; }
      const tf = ev.finalOpening ?? (ev.kind === 'valveClose' ? 0 : 1);
      const s = (ev.duration ?? 0) > 0 ? Math.min((t - ev.start) / ev.duration!, 1) : 1;
      gateOpen[k] = valveArea(v, tf + (v.opening - tf) * (1 - s) ** (ev.exponent ?? 1));
    });
    // turbines: runner speed from the power balance after a load rejection; governor on the gates; flow factor from
    // the unit speed (runner characteristic) — explicit over the step, as in the wave engine
    net.valves.forEach((v, k) => {
      const u = turb[k];
      if (!u) { valveOpen[k] = gateOpen[k]; return; }
      const tb = v.turbine!, l = links[net.pipes.length + net.pumps.length + k];
      const dH = Math.max(H[l.i] - H[l.j], 1e-3), ratio = u.w / u.w0;
      const fac = tb.characteristic ? turbineFactors(tb.characteristic, ratio / Math.sqrt(dH / tb.ratedHead)) : { flow: 1, eff: Math.max(0, 1 - ((ratio - 1) / 0.8) ** 2) };
      if (u.rejected && t >= u.start) {
        const P = RHO * G * Math.max(l.Q, 0) * dH * tb.efficiency * fac.eff;
        u.w = Math.max(0, u.w + (dt * (P - 0.01 * u.ratedP * ratio ** 3)) / Math.max(tb.inertia * u.w, 1e-6));
        if (tb.governor) {
          const err = u.w / u.w0 - 1;
          u.I += (err * dt) / Math.max(tb.governor.ti ?? 5, 1e-3);
          const target = Math.min(1, Math.max(0, v.opening - (tb.governor.kp ?? 3) * (err + u.I)));
          const rate = 1 / Math.max(tb.governor.closeTime, 1e-3);
          u.stroke += Math.max(-rate * dt, Math.min(rate * dt, target - u.stroke));
          gateOpen[k] = valveArea(v, u.stroke);
        }
      }
      valveOpen[k] = Math.max(0, (gateOpen[k] * fac.flow) / u.f0);
    });
    nodes.forEach((_, i) => { if (isRes[i]) H[i] = resHead(i, t); });
    const tp = tripped();
    const nf = free.length, nl = links.length;
    const n = nf + nl + tp.length + devs.length;
    const Qold = links.map((l) => l.Q);
    const aOld = tp.map((k) => pumpS[k].alpha);
    const x = [...free.map((i) => H[i]), ...Qold, ...aOld, ...devs.map((d) => d.Qs)];
    // residual of each element (shared by the dense and the sparse Newton solves)
    const linkE = (k: number, q: number, a: number, hi: number, hj: number) => {
      const l = links[k];
      if (l.closed) return q;
      if (l.kind === 'pipe') {
        const p = net.pipes[l.ref];
        const c = p.length / (G * area(p.diameter) * dt);
        return c * (q - Qold[k]) + pipeR(p, q, st.friction) * q * Math.abs(q) - (hi - hj);
      }
      if (l.kind === 'pump') return hj - hi - head(l.ref, q, a);
      const vv = net.valves[l.ref], A = area(vv.diameter), o = valveOpen[l.ref];
      return o <= 0 ? q : (valveKq[l.ref] ?? vv.k0 / (2 * G * A * A)) * q * Math.abs(q) - o * o * (hi - hj);
    };
    const speedR = (k: number, a: number, q: number) => { const pk = tp[k], s = pumpS[pk], p = net.pumps[pk]; return a - aOld[k] + (dt * (torque(pk, q, a) + s.T)) / (2 * p.inertia * s.w); };
    const devR = (k: number, Qs: number, hn: number) => {
      const d = devs[k];
      const loss = (Qs > 0 ? d.kIn : d.kOut) * Qs * Math.abs(Qs);
      let Hd: number;
      if (d.kind === 'vessel') {
        const Vg = Math.min(Math.max(d.Vg - Qs * dt, 1e-6), d.total);
        const zw = d.bottom + (d.total - Vg) / d.area;
        Hd = d.C / Vg ** d.n - HB + zw;
      } else Hd = d.z + (Qs * dt) / d.area;
      return (d.kind === 'tank' && d.oneWay && Qs >= 0 && hn >= Hd) ? Qs : hn - Hd - loss;
    };
    const nodeBase = (i: number, hv: number) => -demand[i] - (emC[i] > 0 ? emC[i] * Math.max(hv - nodes[i].elev, 0) ** emG : 0);
    const tpOf = new Map(tp.map((pk, k) => [net.pipes.length + pk, k]));
    const resid = (v: number[]) => {
      const r = new Array(n).fill(0);
      const h = (i: number) => (isRes[i] ? H[i] : v[fIdx.get(i)!]);
      free.forEach((i, k) => (r[k] = nodeBase(i, v[k])));
      links.forEach((l, k) => {
        const q = v[nf + k];
        const fi = fIdx.get(l.i), fj = fIdx.get(l.j);
        if (fi !== undefined) r[fi] -= q;
        if (fj !== undefined) r[fj] += q;
        const ti = tpOf.get(k);
        const a = l.kind === 'pump' ? (ti !== undefined ? v[nf + nl + ti] : pumpS[l.ref].on ? pumpS[l.ref].alphaSet : 0) : 0;
        r[nf + k] = linkE(k, q, a, h(l.i), h(l.j));
      });
      tp.forEach((pk, k) => (r[nf + nl + k] = speedR(k, v[nf + nl + k], v[nf + net.pipes.length + pk])));
      devs.forEach((d, k) => {
        const Qs = v[nf + nl + tp.length + k];
        const fi = fIdx.get(d.node)!;
        r[fi] -= Qs;
        r[nf + nl + tp.length + k] = devR(k, Qs, v[fi]);
      });
      return r;
    };
    const normOf = (r: number[]) => { let m = 0; for (const x of r) { const a = Math.abs(x); if (a > m) m = a; } return m; };
    /** Newton step by eliminating the link, speed and device unknowns (each local to a link or a node), which leaves
     *  a sparse symmetric system in the node heads — solved by conjugate gradients on large models. */
    const sparseStep = (v: number[], r: number[]): number[] => {
      const h = (i: number) => (isRes[i] ? H[i] : v[fIdx.get(i)!]);
      const rows: Map<number, number>[] = free.map(() => new Map());
      const b = free.map((_, k) => -r[k]);
      const add = (row: number, col: number, val: number) => { const m = rows[row]; m.set(col, (m.get(col) ?? 0) + val); };
      const lin: { a0: number; ai: number; aj: number; s0: number; si: number; sj: number }[] = [];
      links.forEach((l, k) => {
        const q = v[nf + k], ti = tpOf.get(k);
        const a = l.kind === 'pump' ? (ti !== undefined ? v[nf + nl + ti] : pumpS[l.ref].on ? pumpS[l.ref].alphaSet : 0) : 0;
        const hi = h(l.i), hj = h(l.j), e = r[nf + k];
        const dq = 1e-7 * Math.max(1, Math.abs(q)), dh = 1e-6;
        const eq = (linkE(k, q + dq, a, hi, hj) - e) / dq;
        const ehi = (linkE(k, q, a, hi + dh, hj) - e) / dh, ehj = (linkE(k, q, a, hi, hj + dh) - e) / dh;
        let L0: number, Li: number, Lj: number, S0 = 0, Si = 0, Sj = 0;
        if (ti !== undefined) {
          const da = 1e-7 * Math.max(1, Math.abs(a)), tau = r[nf + nl + ti];
          const ea = (linkE(k, q, a + da, hi, hj) - e) / da;
          const tq = (speedR(ti, a, q + dq) - tau) / dq, ta = (speedR(ti, a + da, q) - tau) / da;
          const det = eq * ta - ea * tq || 1e-30;
          L0 = (-e * ta + ea * tau) / det; Li = (-ta / det) * ehi; Lj = (-ta / det) * ehj;
          S0 = (-tau * eq + tq * e) / det; Si = (tq / det) * ehi; Sj = (tq / det) * ehj;
        } else {
          const g = Math.abs(eq) > 1e-30 ? eq : 1e-30;
          L0 = -e / g; Li = -ehi / g; Lj = -ehj / g;
        }
        lin.push({ a0: L0, ai: Li, aj: Lj, s0: S0, si: Si, sj: Sj });
        // continuity: node i loses dq, node j gains it
        const fi = fIdx.get(l.i), fj = fIdx.get(l.j);
        if (fi !== undefined) { b[fi] += L0; add(fi, fi, -Li); if (fj !== undefined) add(fi, fj, -Lj); }
        if (fj !== undefined) { b[fj] -= L0; add(fj, fj, Lj); if (fi !== undefined) add(fj, fi, Li); }
      });
      const dl: { d0: number; dh: number }[] = [];
      devs.forEach((d, k) => {
        const Qs = v[nf + nl + tp.length + k], fi = fIdx.get(d.node)!, rd = r[nf + nl + tp.length + k];
        const dq = 1e-7 * Math.max(1, Math.abs(Qs));
        const rq = (devR(k, Qs + dq, v[fi]) - rd) / dq || 1e-30, rh = (devR(k, Qs, v[fi] + 1e-6) - rd) / 1e-6;
        const d0 = -rd / rq, dhc = -rh / rq;
        dl.push({ d0, dh: dhc });
        b[fi] += d0; add(fi, fi, -dhc);
      });
      free.forEach((i, k) => { const g = (nodeBase(i, v[k] + 1e-6) - nodeBase(i, v[k])) / 1e-6; if (g) add(k, k, g); });
      // solve A·dh = b (A symmetric, negative definite in practice): conjugate gradients on −A
      const m = free.length;
      const diag = rows.map((rw, k) => -(rw.get(k) ?? 0) || 1);
      const mul = (x: Float64Array) => { const y = new Float64Array(m); rows.forEach((rw, k) => { let s2 = 0; rw.forEach((val, c) => (s2 -= val * x[c])); y[k] = s2; }); return y; };
      const dhv = new Float64Array(m), res = Float64Array.from(b, (x) => -x);
      const z = res.map((x, k) => x / diag[k]);
      const pv = Float64Array.from(z);
      let rz = res.reduce((s2, x, k) => s2 + x * z[k], 0);
      const bn = Math.sqrt(res.reduce((s2, x) => s2 + x * x, 0)) || 1;
      for (let it2 = 0; it2 < 4 * m + 50; it2++) {
        const Ap = mul(pv);
        const pAp = pv.reduce((s2, x, k) => s2 + x * Ap[k], 0);
        if (!(Math.abs(pAp) > 1e-300)) break;
        const al = rz / pAp;
        for (let k = 0; k < m; k++) { dhv[k] += al * pv[k]; res[k] -= al * Ap[k]; }
        if (Math.sqrt(res.reduce((s2, x) => s2 + x * x, 0)) < 1e-12 * bn) break;
        for (let k = 0; k < m; k++) z[k] = res[k] / diag[k];
        const rzn = res.reduce((s2, x, k) => s2 + x * z[k], 0);
        const be = rzn / rz; rz = rzn;
        for (let k = 0; k < m; k++) pv[k] = z[k] + be * pv[k];
      }
      // back-substitute the local unknowns
      const out = new Array(n).fill(0);
      for (let k = 0; k < m; k++) out[k] = dhv[k];
      const dH = (i: number) => (isRes[i] ? 0 : dhv[fIdx.get(i)!]);
      links.forEach((l, k) => {
        const c = lin[k], ti = tpOf.get(k);
        out[nf + k] = c.a0 + c.ai * dH(l.i) + c.aj * dH(l.j);
        if (ti !== undefined) out[nf + nl + ti] = c.s0 + c.si * dH(l.i) + c.sj * dH(l.j);
      });
      devs.forEach((d, k) => (out[nf + nl + tp.length + k] = dl[k].d0 + dl[k].dh * dH(d.node)));
      return out;
    };
    const useSparse = n > 300 || (opt as { sparse?: boolean }).sparse === true;
    for (let it = 0; it < 40; it++) {
      const r = resid(x);
      const norm = normOf(r);
      if (norm < 1e-9) break;
      let d: number[];
      if (useSparse) d = sparseStep(x, r);
      else {
        const J = Array.from({ length: n }, () => new Array(n).fill(0));
        for (let k = 0; k < n; k++) {
          const hh = 1e-7 * Math.max(1, Math.abs(x[k]));
          const xp = x.slice(); xp[k] += hh;
          const rp = resid(xp);
          for (let m2 = 0; m2 < n; m2++) J[m2][k] = (rp[m2] - r[m2]) / hh;
        }
        d = solveDense(J, r.map((v) => -v));
      }
      let lam = 1;
      for (let ls = 0; ls < 20; ls++) {
        const xn = x.map((v, k) => v + lam * d[k]);
        if (normOf(resid(xn)) < norm || ls === 19) { for (let k = 0; k < n; k++) x[k] = xn[k]; break; }
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
        if (d.z > d.top && d.chamber !== undefined) { const c = devs[d.chamber]; c.z += ((d.z - d.top) * d.area) / c.area; d.z = d.top; }
        if (d.z > d.top) { d.spilled += (d.z - d.top) * d.area; d.z = d.top; }
        if (d.z < d.bottom) { d.emptied = true; d.z = d.bottom; }
        const ac = tankCurves.get(k);
        if (ac) d.area = Math.max(interpTable(ac, d.z), 1e-6);
      }
      d.minLevel = Math.min(d.minLevel, d.z); d.maxLevel = Math.max(d.maxLevel, d.z);
    });
  };

  let frame = 0;
  const record = (t: number) => {
    times[frame] = t;
    nodes.forEach((nn, i) => (nodeHead[nn.id][frame] = H[i]));
    for (const p of env) { frameHeads[p.pipe.id][frame * 2] = H[p.i]; frameHeads[p.pipe.id][frame * 2 + 1] = H[p.j]; frameFlows[p.pipe.id][frame] = links[p.k].Q; }
    net.pumps.forEach((p, k) => { pumps[p.id].speed[frame] = pumpS[k].alpha; pumps[p.id].flow[frame] = links[net.pipes.length + k].Q; });
    net.valves.forEach((v, k) => { const o = valves[v.owner ?? v.id]; o.opening[frame] = valveOpen[k]; o.flow[frame] = links[net.pipes.length + net.pumps.length + k].Q; const u = turb[k]; if (u) { o.speed ??= new Float32Array(fr); o.speed[frame] = u.w / u.w0; } });
    devs.forEach((d) => {
      const id = nodes[d.node].id;
      if (d.kind === 'vessel') { vessels[id].gas[frame] = d.Vg; vessels[id].flow[frame] = d.Qs; vessels[id].level[frame] = d.z; }
      else if (d.kind === 'tank') { tanks[id].level[frame] = d.z; tanks[id].flow[frame] = d.Qs; }
      else { const o = tanks[id]; o.flow[frame] += d.Qs; o.chamber!.level[frame] = d.z; }
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
    else if (d.kind === 'tank') Object.assign(tanks[id], { minLevel: d.minLevel, maxLevel: d.maxLevel, spilled: d.spilled, emptied: d.emptied });
    else { const o = tanks[id]; Object.assign(o.chamber!, { minLevel: d.minLevel, maxLevel: d.maxLevel }); o.spilled += d.spilled; o.emptied ||= d.emptied; }
    if (d.emptied) warnings.push(`${d.kind === 'vessel' ? 'Air vessel' : d.kind === 'chamber' ? 'Surge tank chamber' : 'Tank'} at ${id} emptied.`);
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
