// Network skeletonisation: a smaller model that behaves the same, for faster surge runs on large networks.
//  • Series merge: a junction joining two pipes of the same diameter and material (no demand or device, nothing
//    attached, not used by an operation or control) is removed; the two pipes become one with the same length,
//    the same travel time (wave speed from L/Σ(Li/ai)), the summed minor losses and the removed node kept as a
//    profile point, so high points and the long section are preserved exactly.
//  • Branch trimming (optional): small dead-end pipes (below a diameter) with no device are removed and their
//    demand moved to the junction they hang from. This removes their reflections, so it is off by default.
// Every change is listed so the engineer can review it.
import type { Network, NetNode, Pipe } from './types';
import { allEvents } from './types';

export interface SkeletonOptions {
  series?: boolean;
  /** Relative roughness / wave speed difference allowed when merging (default 5 %). */
  tolerance?: number;
  /** Trim dead ends with a diameter below this (m); 0 = off. */
  trimBelow?: number;
  /** Node ids that must stay (results wanted there). */
  keep?: string[];
}
export interface SkeletonResult { net: Network; removedNodes: string[]; removedPipes: string[]; changes: string[] }

const hasDevice = (n: NetNode) => !!(n.vessel || n.airValve || n.relief || n.tank || n.sav || n.outlet || n.storage);

export function skeletonise(net0: Network, o: SkeletonOptions = {}): SkeletonResult {
  const tol = o.tolerance ?? 0.05;
  let nodes = net0.nodes.map((n) => ({ ...n }));
  let pipes: Pipe[] = net0.pipes.map((p) => ({ ...p, profile: p.profile ? [...p.profile] : undefined }));
  const removedNodes: string[] = [], removedPipes: string[] = [], changes: string[] = [];
  const keep = new Set(o.keep ?? []);
  for (const e of allEvents(net0)) e.targets.forEach((id) => keep.add(id));
  for (const c of net0.controls ?? []) { keep.add(c.link); if (c.node) keep.add(c.node); }
  for (const p of net0.profiles ?? []) p.path.forEach((id) => keep.add(id));
  if (net0.eps?.traceNode) keep.add(net0.eps.traceNode);
  const linkEnds = () => {
    const m = new Map<string, number>();
    const add = (id: string) => m.set(id, (m.get(id) ?? 0) + 1);
    for (const p of pipes) { add(p.from); add(p.to); }
    for (const p of net0.pumps) { add(p.from); add(p.to); }
    for (const v of net0.valves) { add(v.from); add(v.to); }
    return m;
  };
  const near = (a: number, b: number) => Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b), 1e-12);

  // ── branch trimming ──
  if ((o.trimBelow ?? 0) > 0) {
    let again = true;
    while (again) {
      again = false;
      const deg = linkEnds();
      for (const n of nodes) {
        if (n.kind !== 'junction' || keep.has(n.id) || hasDevice(n) || deg.get(n.id) !== 1) continue;
        const p = pipes.find((x) => x.from === n.id || x.to === n.id);
        if (!p || p.diameter >= o.trimBelow! || keep.has(p.id) || p.checkValve) continue;
        const other = p.from === n.id ? p.to : p.from;
        const up = nodes.find((x) => x.id === other)!;
        if (up.kind !== 'junction') continue;
        up.demand = (up.demand ?? 0) + (n.demand ?? 0);
        pipes = pipes.filter((x) => x !== p);
        nodes = nodes.filter((x) => x !== n);
        removedNodes.push(n.id); removedPipes.push(p.id);
        changes.push(`Trimmed dead end ${p.id} (DN${Math.round(p.diameter * 1000)}) and node ${n.id}; its demand moved to ${up.id}.`);
        again = true;
      }
    }
  }

  // ── series merge ──
  if (o.series !== false) {
    let again = true;
    while (again) {
      again = false;
      const deg = linkEnds();
      for (const n of nodes) {
        if (n.kind !== 'junction' || keep.has(n.id) || hasDevice(n) || (n.demand ?? 0) !== 0 || deg.get(n.id) !== 2) continue;
        const ps = pipes.filter((x) => x.from === n.id || x.to === n.id);
        if (ps.length !== 2) continue;
        const [a, b] = ps;
        if (a === b || keep.has(a.id) || keep.has(b.id) || a.closed || b.closed || a.checkValve || b.checkValve) continue;
        if (Math.abs(a.diameter - b.diameter) > 1e-9 || !near(a.roughness, b.roughness) || !near(a.wavespeed, b.wavespeed)) continue;
        if ((a.material ?? '') !== (b.material ?? '') || (a.pressureClass ?? 0) !== (b.pressureClass ?? 0)) continue;
        if ((a.bulkCoeff ?? NaN) !== (b.bulkCoeff ?? NaN) && !(a.bulkCoeff === undefined && b.bulkCoeff === undefined)) continue;
        // orient: first pipe ends at n, second starts at n
        const first = a.to === n.id ? a : flip(a), second = b.from === n.id ? b : flip(b);
        if (first.to !== n.id || second.from !== n.id || first.from === second.to) continue;
        const L = first.length + second.length;
        const travel = first.length / first.wavespeed + second.length / second.wavespeed;
        const merged: Pipe = {
          ...first,
          to: second.to,
          length: L,
          wavespeed: L / travel,
          roughness: (first.roughness * first.length + second.roughness * second.length) / L,
          minorLoss: (first.minorLoss ?? 0) + (second.minorLoss ?? 0) || undefined,
          profile: [...(first.profile ?? []), { s: first.length, z: n.elev }, ...(second.profile ?? []).map((q) => ({ s: q.s + first.length, z: q.z }))],
          vertices: [...(first.vertices ?? []), { x: n.x, y: n.y }, ...(second.vertices ?? [])],
          label: first.label,
        };
        pipes = pipes.filter((x) => x.id !== a.id && x.id !== b.id);
        pipes.push(merged);
        nodes = nodes.filter((x) => x !== n);
        removedNodes.push(n.id); removedPipes.push(second.id);
        changes.push(`Merged ${first.id} + ${second.id} through ${n.id} (kept as a profile point at ${n.elev.toFixed(2)} m).`);
        again = true;
        break;
      }
    }
  }
  return { net: { ...net0, nodes, pipes, name: `${net0.name} (skeleton)` }, removedNodes, removedPipes, changes };
}

function flip(p: Pipe): Pipe {
  return {
    ...p, from: p.to, to: p.from,
    profile: p.profile?.map((q) => ({ s: p.length - q.s, z: q.z })).reverse(),
    vertices: p.vertices ? [...p.vertices].reverse() : undefined,
    checkValve: p.checkValve,
  };
}
