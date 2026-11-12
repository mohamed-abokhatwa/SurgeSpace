// Air valve plan by the usual design rules (AWWA M51 practice), sized for draining and filling, then tested in surge
// runs. Locations:
//   • high points (including high points inside a pipe's long section) and points where the pipe rises above the
//     steady hydraulic grade line;
//   • decreases in upward slope and increases in downward slope (in the flow direction);
//   • long runs with no other air valve: every `spacing` metres (400–800 m is usual);
//   • the discharge of pump stations.
// Sizing: the large orifice admits the air that replaces the water draining by gravity (pipe break or emptying) at
// 35 kPa vacuum, and releases the air pushed out while filling at 14 kPa; double (combination) valves by default,
// anti-slam (three-stage) where the surge run shows a slam or the valve opens and closes violently.
import { CD_AIR, orificeMassFlow } from '../engine/devices';
import { HB, RHO, G, type AirValve, type Network, type Pipe } from '../engine/types';
import { solveSteady, type SteadyResult } from '../engine/steady';
import { runTransient, type TransientResult } from '../engine/transient';
import { splitPipe } from './edit';

export interface AirValvePlanItem {
  id: string;
  /** Existing node, or a point inside a pipe (distance from its `from` end). */
  at: { node: string } | { pipe: string; s: number };
  z: number;
  reasons: string[];
  type: NonNullable<AirValve['type']>;
  /** Large orifice (inflow and outflow) and small orifice diameters, m. */
  inDiameter: number;
  outDiameter: number;
  smallDiameter: number;
  /** Water draining by gravity past the point (air to admit), and air pushed out while filling, m³/s. */
  qDrain: number;
  qFill: number;
  critical: boolean;
  existing?: boolean;
}
export interface AirValvePlanOptions {
  /** Longest run without an air valve, m (default 600). */
  spacing?: number;
  /** Only mains of at least this internal diameter, m (distribution networks: the transmission mains). */
  minDiameter?: number;
  /** Smallest rise that counts as a high point, m (default 0.3). */
  minRise?: number;
  /** Smallest grade change that needs a valve (fraction, default 0.01 = 1 %). */
  gradeChange?: number;
  /** Filling velocity, m/s (default 0.3). */
  fillVelocity?: number;
  /** Vacuum allowed while draining, kPa (default 35), and back-pressure while filling, kPa (default 14). */
  vacuumKPa?: number;
  fillKPa?: number;
}

export const AV_SIZES = [0.025, 0.05, 0.08, 0.1, 0.15, 0.2, 0.25, 0.3];
const PA = () => RHO * G * HB;
const RHO_AIR = () => PA() / (287.1 * 293.15);

/** Air an orifice of diameter d admits at the given vacuum, m³/s (at atmospheric pressure). */
export function avInflow(d: number, vacuumKPa = 35): number {
  const pa = PA();
  return orificeMassFlow(CD_AIR * Math.PI / 4 * d * d, pa, pa - vacuumKPa * 1000) / RHO_AIR();
}
/** Air an orifice of diameter d releases at the given back-pressure, m³/s (free air). */
export function avOutflow(d: number, overKPa = 14): number {
  const pa = PA();
  return orificeMassFlow(CD_AIR * Math.PI / 4 * d * d, pa + overKPa * 1000, pa) / RHO_AIR();
}
/** Gravity flow in a full pipe on a slope (Hazen–Williams), m³/s. */
export function drainFlow(D: number, slope: number, C = 130): number {
  return 0.2785 * C * D ** 2.63 * Math.max(Math.abs(slope), 0.001) ** 0.54;
}

type Pt = { s: number; z: number };
/** Long section of a pipe from its `from` end: end nodes plus intermediate profile points. */
function pipeProfile(net: Network, p: Pipe): Pt[] {
  const za = net.nodes.find((n) => n.id === p.from)!.elev, zb = net.nodes.find((n) => n.id === p.to)!.elev;
  return [{ s: 0, z: za }, ...(p.profile ?? []).filter((q) => q.s > 0 && q.s < p.length).sort((a, b) => a.s - b.s), { s: p.length, z: zb }];
}
const hwC = (net: Network, p: Pipe) => (net.settings.friction === 'HW' ? p.roughness : 130);

export function planAirValves(net: Network, o: AirValvePlanOptions = {}, steadyIn?: SteadyResult): AirValvePlanItem[] {
  const spacing = o.spacing ?? 600, minRise = o.minRise ?? 0.3, dg = o.gradeChange ?? 0.01, vFill = o.fillVelocity ?? 0.3;
  let steady = steadyIn;
  if (!steady) { try { steady = solveSteady(net); } catch { steady = undefined; } }
  const open = net.pipes.filter((p) => !p.closed && p.diameter >= (o.minDiameter ?? 0) - 1e-9);
  const prof = new Map(open.map((p) => [p.id, pipeProfile(net, p)]));
  const items = new Map<string, AirValvePlanItem>();
  const key = (at: AirValvePlanItem['at']) => ('node' in at ? `n:${at.node}` : `p:${at.pipe}:${Math.round(at.s)}`);
  const add = (at: AirValvePlanItem['at'], z: number, reason: string, critical = false) => {
    const k = key(at);
    const it = items.get(k);
    if (it) { if (!it.reasons.includes(reason)) it.reasons.push(reason); it.critical ||= critical; return; }
    items.set(k, { id: k, at, z, reasons: [reason], type: 'double', inDiameter: 0, outDiameter: 0, smallDiameter: 0, qDrain: 0, qFill: 0, critical });
  };
  // slope leaving a node along a pipe (first segment away from the node), and the pipe's other end
  const away = (p: Pipe, node: string) => {
    const pr = prof.get(p.id)!;
    if (p.from === node) return { slope: (pr[1].z - pr[0].z) / Math.max(pr[1].s - pr[0].s, 1e-6), len: pr[1].s };
    const n = pr.length;
    return { slope: (pr[n - 2].z - pr[n - 1].z) / Math.max(pr[n - 1].s - pr[n - 2].s, 1e-6), len: pr[n - 1].s - pr[n - 2].s };
  };
  const pipesAt = new Map<string, Pipe[]>();
  for (const p of open) { pipesAt.set(p.from, [...(pipesAt.get(p.from) ?? []), p]); pipesAt.set(p.to, [...(pipesAt.get(p.to) ?? []), p]); }
  // 1. high points at junctions (every pipe falls away), and pipe rising above the steady grade line
  // pumps break the line (the suction side is not a high point); a valve joins the pipes on both sides
  const pumpNode = new Set(net.pumps.flatMap((p) => [p.from, p.to]));
  const valvePartners = new Map<string, string[]>();
  for (const v of net.valves) { valvePartners.set(v.from, [...(valvePartners.get(v.from) ?? []), v.to]); valvePartners.set(v.to, [...(valvePartners.get(v.to) ?? []), v.from]); }
  for (const n of net.nodes) {
    if (n.kind !== 'junction' || pumpNode.has(n.id)) continue;
    const ps = pipesAt.get(n.id) ?? [];
    if (!ps.length) continue;
    const partners = valvePartners.get(n.id) ?? [];
    const drops = [...ps.map((p) => away(p, n.id)), ...partners.flatMap((m) => (pipesAt.get(m) ?? []).map((p) => away(p, m)))];
    if (partners.length && drops.every((d) => d.slope < -1e-4)) { if (partners.some((m) => items.has(`n:${m}`))) continue; }
    if (drops.every((d) => d.slope < -1e-4) && drops.some((d) => -d.slope * d.len >= minRise * 0.5)) add({ node: n.id }, n.elev, 'High point');
    else if (ps.length === 2 && !partners.length) {
      // grade change where two pipes meet, in the flow direction
      const q0 = steady?.flows.get(ps[0].id) ?? 1;
      const inP = (ps[0].to === n.id) === q0 >= 0 ? ps[0] : ps[1], outP = inP === ps[0] ? ps[1] : ps[0];
      const g1 = -away(inP, n.id).slope, g2 = away(outP, n.id).slope;
      if (g1 > 0 && g2 >= 0 && g1 - g2 >= dg) add({ node: n.id }, n.elev, 'Decrease in upward slope');
      else if (g1 <= 0 && g2 < 0 && g1 - g2 >= dg) add({ node: n.id }, n.elev, 'Increase in downward slope');
    }
    const h = steady?.heads.get(n.id);
    if (h !== undefined && h - n.elev < 0) add({ node: n.id }, n.elev, 'Above the steady hydraulic grade line (negative pressure)', true);
  }
  // 2. inside pipes: high points and grade changes along the long section, in the flow direction
  for (const p of open) {
    const pr = prof.get(p.id)!;
    const q = steady?.flows.get(p.id) ?? 1;
    const order = q >= 0 ? pr : [...pr].reverse().map((x) => ({ s: p.length - x.s, z: x.z }));
    const toPipeS = (s: number) => (q >= 0 ? s : p.length - s);
    for (let i = 1; i < order.length - 1; i++) {
      const a = order[i - 1], b = order[i], c = order[i + 1];
      const g1 = (b.z - a.z) / Math.max(b.s - a.s, 1e-6), g2 = (c.z - b.z) / Math.max(c.s - b.s, 1e-6);
      const at = { pipe: p.id, s: toPipeS(b.s) };
      if (b.z - a.z >= minRise * 0.5 && b.z - c.z >= minRise * 0.5 && b.z >= Math.max(a.z, c.z)) add(at, b.z, 'High point in the long section');
      else if (g1 > 0 && g2 >= 0 && g1 - g2 >= dg) add(at, b.z, 'Decrease in upward slope');
      else if (g1 <= 0 && g2 < 0 && g1 - g2 >= dg) add(at, b.z, 'Increase in downward slope');
      const h0 = steady?.heads.get(p.from), h1 = steady?.heads.get(p.to);
      if (h0 !== undefined && h1 !== undefined) { const hs = h0 + ((h1 - h0) * toPipeS(b.s)) / p.length; if (hs - b.z < 0) add(at, b.z, 'Above the steady hydraulic grade line (negative pressure)', true); }
    }
  }
  // 3. pump discharges
  for (const pu of net.pumps) { const n = net.nodes.find((x) => x.id === pu.to); if (n?.kind === 'junction') add({ node: n.id }, n.elev, 'Pump discharge (air at start-up, vacuum at a trip)'); }
  // existing air valves count as placed
  for (const n of net.nodes) if (n.airValve && !n.airValve.treatAsJunction) { add({ node: n.id }, n.elev, 'Existing air valve'); items.get(`n:${n.id}`)!.existing = true; }
  // 4. long runs: walk each pipe with the planned points; a run continues through a junction joining two pipes
  //    that has no air valve (except at a low point, where the ascending and descending runs separate)
  const marksOn = (pid: string) => [...items.values()].flatMap((it) => ('pipe' in it.at && it.at.pipe === pid ? [it.at.s] : []));
  const hasValve = (node: string) => items.has(`n:${node}`);
  const lowPoint = (node: string) => { const ps = pipesAt.get(node) ?? []; return ps.length >= 2 && ps.every((q) => away(q, node).slope > 1e-4); };
  const extraBeyond = (node: string, p: Pipe) => {
    if (hasValve(node) || lowPoint(node)) return 0;
    const ps = pipesAt.get(node) ?? [];
    if (ps.length !== 2) return 0;
    const q = ps[0] === p ? ps[1] : ps[0];
    const ms = marksOn(q.id).map((x) => (q.from === node ? x : q.length - x));
    const other = q.from === node ? q.to : q.from;
    return Math.min(...ms, hasValve(other) ? q.length : q.length + spacing);
  };
  for (const p of open) {
    const left = extraBeyond(p.from, p), right = extraBeyond(p.to, p);
    const marks = marksOn(p.id);
    const pts = [-left, ...marks, ...(hasValve(p.from) ? [0] : []), ...(hasValve(p.to) ? [p.length] : []), p.length + right].sort((a, b) => a - b);
    for (let i = 1; i < pts.length; i++) {
      const gap = pts[i] - pts[i - 1];
      if (gap <= spacing * 1.05) continue;
      const k = Math.ceil(gap / spacing) - 1;
      for (let j = 1; j <= k; j++) {
        const sv = pts[i - 1] + (gap * j) / (k + 1);
        if (sv <= 1 || sv >= p.length - 1) continue; // outside this pipe: the neighbour pipe takes it
        const pr = prof.get(p.id)!;
        let m = 1; while (m < pr.length - 1 && pr[m].s < sv) m++;
        const z = pr[m - 1].z + ((pr[m].z - pr[m - 1].z) * (sv - pr[m - 1].s)) / Math.max(pr[m].s - pr[m - 1].s, 1e-6);
        add({ pipe: p.id, s: Math.round(sv) }, z, `Long run (more than ${spacing} m without an air valve)`);
      }
    }
  }
  // sizing: drain both ways from the point; fill at the filling velocity of the largest pipe there
  for (const it of items.values()) {
    let qd = 0, Dmax = 0;
    if ('node' in it.at) {
      for (const p of pipesAt.get(it.at.node) ?? []) { const d = away(p, it.at.node); Dmax = Math.max(Dmax, p.diameter); if (d.slope < 0) qd += drainFlow(p.diameter, d.slope, hwC(net, p)); }
    } else {
      const p = open.find((x) => x.id === (it.at as { pipe: string }).pipe)!;
      const pr = prof.get(p.id)!, s = it.at.s;
      let m = 1; while (m < pr.length - 1 && pr[m].s < s - 1e-6) m++;
      const back = (pr[Math.max(m - 1, 0)].z - it.z) / Math.max(s - pr[Math.max(m - 1, 0)].s, 1), fwdIdx = Math.min(pr[m].s > s + 1e-6 ? m : m + 1, pr.length - 1);
      const fwd = (pr[fwdIdx].z - it.z) / Math.max(pr[fwdIdx].s - s, 1);
      Dmax = p.diameter;
      if (back < 0) qd += drainFlow(p.diameter, back, hwC(net, p));
      if (fwd < 0) qd += drainFlow(p.diameter, fwd, hwC(net, p));
      if (qd === 0) qd = drainFlow(p.diameter, 0.001, hwC(net, p));
    }
    if (qd === 0) qd = drainFlow(Math.max(Dmax, 0.05), 0.001);
    const qf = vFill * Math.PI / 4 * Dmax * Dmax;
    const din = AV_SIZES.find((d) => avInflow(d, o.vacuumKPa ?? 35) >= qd) ?? AV_SIZES[AV_SIZES.length - 1];
    const dout = AV_SIZES.find((d) => avOutflow(d, o.fillKPa ?? 14) >= qf) ?? AV_SIZES[AV_SIZES.length - 1];
    const d = Math.min(Math.max(din, dout), Math.max(0.05, AV_SIZES.find((x) => x >= Dmax * 0.5) ?? 0.3));
    Object.assign(it, { qDrain: qd, qFill: qf, inDiameter: d, outDiameter: d, smallDiameter: Dmax > 0.3 ? 0.003 : 0.002 });
  }
  return [...items.values()].sort((a, b) => (b.critical ? 1 : 0) - (a.critical ? 1 : 0) || a.id.localeCompare(b.id));
}

/** Put the planned air valves into the model (new junctions inside pipes where needed). Returns the new model and
 *  the node of each plan item. */
export function applyAirValvePlan(net: Network, plan: AirValvePlanItem[]): { net: Network; nodes: Map<string, string> } {
  let n = net;
  const nodes = new Map<string, string>();
  // split pipes from the far end backwards, so earlier distances stay valid
  const inPipe = plan.filter((it) => 'pipe' in it.at).sort((a, b) => ((a.at as { pipe: string; s: number }).pipe.localeCompare((b.at as { pipe: string }).pipe)) || (b.at as { s: number }).s - (a.at as { s: number }).s);
  for (const it of inPipe) {
    const at = it.at as { pipe: string; s: number };
    const p = n.pipes.find((x) => x.id === at.pipe);
    if (!p) continue;
    const r = splitPipe(n, at.pipe, at.s / p.length);
    if (!r.node) continue;
    n = { ...r.net, nodes: r.net.nodes.map((x) => (x.id === r.node ? { ...x, elev: Math.round(it.z * 1000) / 1000 } : x)) };
    nodes.set(it.id, r.node);
  }
  for (const it of plan) if ('node' in it.at) nodes.set(it.id, it.at.node);
  n = {
    ...n,
    nodes: n.nodes.map((x) => {
      const it = plan.find((q) => nodes.get(q.id) === x.id);
      if (!it || it.existing) return x;
      return { ...x, airValve: { type: it.type, inDiameter: it.inDiameter, outDiameter: it.outDiameter, smallDiameter: it.smallDiameter } };
    }),
  };
  return { net: n, nodes };
}

export interface AirValvePlanTest {
  plan: AirValvePlanItem[];
  before: { minPressure: number; at: string; cavity: number; slams: number };
  after: { minPressure: number; at: string; cavity: number; slams: number };
  antiSlam: string[];
  net: Network;
}
const worst = (net: Network, r: TransientResult) => {
  let minP = Infinity, at = '', cav = 0;
  for (const e of r.envelopes) for (let i = 0; i < e.s.length; i++) { const p = e.hMin[i] - e.z[i]; if (p < minP) { minP = p; at = `${e.id} at ${e.s[i].toFixed(0)} m`; } cav = Math.max(cav, e.cavMax[i]); }
  void net;
  return { minPressure: minP, at, cavity: cav, slams: r.slams.filter((s) => s.kind === 'airValve' && s.joukowsky > 5).length };
};
/** Test the plan in surge runs: without and with the valves; where a valve slams, make it anti-slam (three-stage)
 *  and run again. */
export function testAirValvePlan(net: Network, plan: AirValvePlanItem[], onProgress?: (m: string) => void): AirValvePlanTest {
  onProgress?.('Surge run without the new air valves…');
  const r0 = runTransient(net, { envelopeOnly: true });
  const before = worst(net, r0);
  let p = plan.map((it) => ({ ...it }));
  let applied = applyAirValvePlan(net, p);
  onProgress?.('Surge run with the planned air valves…');
  let r = runTransient(applied.net, { envelopeOnly: true });
  const antiSlam: string[] = [];
  const slamNodes = new Set(r.slams.filter((s) => s.kind === 'airValve' && s.joukowsky > 5).map((s) => s.node));
  if (slamNodes.size) {
    // planned valves become anti-slam; existing ones that slam are marked for replacement with anti-slam valves
    p = p.map((it) => (slamNodes.has(applied.nodes.get(it.id) ?? '') && it.type !== 'threeStage' ? (antiSlam.push(applied.nodes.get(it.id)!), { ...it, type: 'threeStage' as const, existing: false, reasons: [...it.reasons, it.existing ? 'Replace with anti-slam: the surge run showed a slam at this valve' : 'Anti-slam: the surge run showed a slam at this valve'] }) : it));
    onProgress?.('Surge run with anti-slam valves where they slammed…');
    applied = applyAirValvePlan(net, p);
    r = runTransient(applied.net, { envelopeOnly: true });
  }
  const after = worst(applied.net, r);
  return { plan: p, before, after, antiSlam, net: applied.net };
}
