// Model editing operations used by the drawing canvas, the explorer and the menus. All are pure: they take a
// network and return a new one, so undo / redo is a stack of snapshots.
import { allEvents, type Network, type NetNode, type Pipe, type Pump, type Valve, type TransientEvent } from '../engine/types';
import { deviceDefaults, type ElementKind } from './elements';

export type ElRef = { type: 'node' | 'pipe' | 'pump' | 'valve'; id: string };
type XY = { x: number; y: number };

/** Element defaults ("templates") for new elements; kept per project in the network's settings. */
export interface ElementDefaults {
  pipeDiameter: number; // m
  pipeRoughness: number; // mm or C
  wavespeed: number; // m/s
  pressureClass: number; // m
  material?: string;
  autoLength: boolean; // new pipes take their length from the drawing
  elevation: number; // m, for new junctions when no neighbour is known
}
export const DEFAULTS: ElementDefaults = { pipeDiameter: 0.3, pipeRoughness: 0.1, wavespeed: 1000, pressureClass: 100, autoLength: true, elevation: 0 };

const allIds = (net: Network) => new Set([...net.nodes.map((n) => n.id), ...net.pipes.map((p) => p.id), ...net.pumps.map((p) => p.id), ...net.valves.map((v) => v.id)]);
/** First free id like J-12 (numbers continue after the highest one in use). */
export function uniqueId(net: Network, prefix: string): string {
  const ids = allIds(net);
  let max = 0;
  const re = new RegExp(`^${prefix.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(\\d+)$`);
  ids.forEach((id) => { const m = id.match(re); if (m) max = Math.max(max, +m[1]); });
  let k = max + 1;
  while (ids.has(`${prefix}${k}`)) k++;
  return `${prefix}${k}`;
}

/** Polyline of a pipe on the drawing (from node, bends, to node). */
export function pipePath(net: Network, p: Pipe): XY[] {
  const a = net.nodes.find((n) => n.id === p.from), b = net.nodes.find((n) => n.id === p.to);
  if (!a || !b) return [];
  return [{ x: a.x, y: a.y }, ...(p.vertices ?? []), { x: b.x, y: b.y }];
}
export const polyLength = (pts: XY[]) => pts.slice(1).reduce((s, q, i) => s + Math.hypot(q.x - pts[i].x, q.y - pts[i].y), 0);
export const pipeLengthFromDrawing = (net: Network, p: Pipe) => polyLength(pipePath(net, p));
/** Point at fraction u (0–1) of a polyline's length, and the index of the segment it falls on. */
export function pointAt(pts: XY[], u: number): XY & { seg: number } {
  const L = polyLength(pts);
  let target = Math.max(0, Math.min(1, u)) * L;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (target <= d || i === pts.length - 1) {
      const t = d > 0 ? Math.min(1, target / d) : 0;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t, seg: i - 1 };
    }
    target -= d;
  }
  return { ...pts[0], seg: 0 };
}
/** Fraction along a polyline of the point nearest to q. */
export function nearestFraction(pts: XY[], q: XY): { u: number; d: number } {
  const L = polyLength(pts) || 1;
  let best = { u: 0, d: Infinity }, run = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2));
    const d = Math.hypot(a.x + t * dx - q.x, a.y + t * dy - q.y);
    const seg = Math.sqrt(l2);
    if (d < best.d) best = { u: (run + t * seg) / L, d };
    run += seg;
  }
  return best;
}

/** Elevation along a pipe at distance s from its start (uses the long-section points when given). */
export function elevationAt(net: Network, p: Pipe, s: number): number {
  const za = net.nodes.find((n) => n.id === p.from)?.elev ?? 0, zb = net.nodes.find((n) => n.id === p.to)?.elev ?? 0;
  const pts = [{ s: 0, z: za }, ...(p.profile ?? []).filter((q) => q.s > 0 && q.s < p.length).sort((a, b) => a.s - b.s), { s: p.length, z: zb }];
  for (let i = 1; i < pts.length; i++) if (s <= pts[i].s) return pts[i - 1].z + ((pts[i].z - pts[i - 1].z) * (s - pts[i - 1].s)) / Math.max(pts[i].s - pts[i - 1].s, 1e-9);
  return zb;
}

/** Elevation for a new node: the nearest existing node's, else the default. */
function nearElev(net: Network, q: XY, d: ElementDefaults) {
  let best = d.elevation, bd = Infinity;
  for (const n of net.nodes) { const dd = Math.hypot(n.x - q.x, n.y - q.y); if (dd < bd) { bd = dd; best = n.elev; } }
  return best;
}

export function addNode(net: Network, q: XY, kind: ElementKind, d: ElementDefaults = DEFAULTS): { net: Network; id: string } {
  const isRes = kind === 'reservoir' || kind === 'levelSource';
  const id = uniqueId(net, isRes ? 'R-' : 'J-');
  const elev = Math.round(nearElev(net, q, d) * 100) / 100;
  let node: NetNode = { id, kind: isRes ? 'reservoir' : 'junction', x: q.x, y: q.y, elev, ...(isRes ? { head: elev + 5 } : { demand: 0 }) };
  if (kind === 'levelSource') node = { ...node, headSchedule: { mode: 'sine', amplitude: 1, period: 30, phase: 0 } };
  if (!isRes && kind !== 'junction') node = { ...node, ...deviceDefaults(kind, node, d.pipeDiameter) };
  return { net: { ...net, nodes: [...net.nodes, node] }, id };
}

export function addPipe(net: Network, from: string, to: string, vertices: XY[] = [], d: ElementDefaults = DEFAULTS): { net: Network; id: string } {
  const id = uniqueId(net, 'P-');
  const p: Pipe = { id, from, to, length: 100, diameter: d.pipeDiameter, roughness: d.pipeRoughness, wavespeed: d.wavespeed, pressureClass: d.pressureClass, ...(vertices.length ? { vertices } : {}), ...(d.material ? { material: d.material } : {}) };
  const n2 = { ...net, pipes: [...net.pipes, p] };
  const L = pipeLengthFromDrawing(n2, p);
  p.length = d.autoLength && L > 0.01 ? Math.round(L * 100) / 100 : 100;
  return { net: n2, id };
}

/** Link (pump or valve) directly between two nodes. */
export function addLink(net: Network, kind: ElementKind, from: string, to: string, d: ElementDefaults = DEFAULTS): { net: Network; id: string } {
  if (kind === 'pump') {
    const id = uniqueId(net, 'PU-');
    const like = net.pumps.at(-1);
    const pump: Pump = like ? { ...like, id, from, to, label: undefined } : { id, from, to, curve: [[0, 60], [0.1, 45], [0.15, 32]], efficiency: 0.8, speed: 1480, inertia: 2, checkValve: true, on: true };
    return { net: { ...net, pumps: [...net.pumps, pump] }, id };
  }
  if (kind === 'turbine') {
    const id = uniqueId(net, 'TU-');
    const D = Math.max(d.pipeDiameter, 0.1);
    const spec = { ratedHead: 50, ratedFlow: Math.round(((Math.PI / 4) * D * D * 3) * 1000) / 1000, efficiency: 0.9, speed: 750, inertia: 2000 };
    const A = (Math.PI / 4) * D * D, V = spec.ratedFlow / A;
    const v: Valve = { id, from, to, diameter: D, k0: Math.round(((2 * 9.80665 * spec.ratedHead) / (V * V)) * 100) / 100, opening: 1, law: 'area', turbine: spec };
    return { net: { ...net, valves: [...net.valves, v] }, id };
  }
  const prefix = kind === 'nrv' ? 'NRV-' : kind === 'prv' ? 'PRV-' : kind === 'psv' ? 'PSV-' : kind === 'fcv' ? 'FCV-' : kind === 'orifice' ? 'OR-' : 'V-';
  const id = uniqueId(net, prefix);
  const v: Valve = { id, from, to, diameter: d.pipeDiameter, k0: kind === 'orifice' ? 5 : 0.3, opening: 1, law: kind === 'lineValve' ? 'gate' : undefined };
  if (kind === 'nrv') { v.check = true; v.checkSpec = { mode: 'ideal', kOpen: 1 }; v.k0 = 1; }
  if (kind === 'orifice') v.orifice = true;
  if (kind === 'prv') v.control = { type: 'PRV', set: 30, active: true, responseTime: 3, strokeTime: 20 };
  if (kind === 'psv') v.control = { type: 'PSV', set: 30, active: true, responseTime: 3, strokeTime: 20 };
  if (kind === 'fcv') v.control = { type: 'FCV', set: 0.05, active: true, responseTime: 3, strokeTime: 20 };
  return { net: { ...net, valves: [...net.valves, v] }, id };
}

/** Split a pipe at fraction u of its length: a new junction, the first part keeps the id. */
export function splitPipe(net: Network, pipeId: string, u: number, d: ElementDefaults = DEFAULTS): { net: Network; node: string; newPipe: string } {
  const p = net.pipes.find((x) => x.id === pipeId);
  if (!p) return { net, node: '', newPipe: '' };
  // at least half a metre (and 0.1 %) from either end; on short pipes the usual 2 %
  const umin = Math.min(0.02, Math.max(0.5 / Math.max(p.length, 1e-6), 0.001));
  u = Math.max(umin, Math.min(1 - umin, u));
  const pts = pipePath(net, p);
  const at = pointAt(pts, u);
  const s = u * p.length;
  const node = uniqueId(net, 'J-');
  const elev = Math.round(elevationAt(net, p, s) * 1000) / 1000;
  const verts = p.vertices ?? [];
  const v1 = verts.slice(0, at.seg), v2 = verts.slice(at.seg);
  const prof1 = (p.profile ?? []).filter((q) => q.s < s);
  const prof2 = (p.profile ?? []).filter((q) => q.s > s).map((q) => ({ s: q.s - s, z: q.z }));
  const newId = uniqueId({ ...net, nodes: [...net.nodes, { id: node } as NetNode] }, 'P-');
  const a: Pipe = { ...p, to: node, length: Math.round(s * 1000) / 1000, vertices: v1.length ? v1 : undefined, profile: prof1.length ? prof1 : undefined };
  const b: Pipe = { ...p, id: newId, from: node, length: Math.round((p.length - s) * 1000) / 1000, vertices: v2.length ? v2 : undefined, profile: prof2.length ? prof2 : undefined, checkValve: undefined, label: undefined };
  const junction: NetNode = { id: node, kind: 'junction', x: at.x, y: at.y, elev, demand: 0 };
  void d;
  return {
    net: { ...net, nodes: [...net.nodes, junction], pipes: net.pipes.flatMap((x) => (x.id === pipeId ? [a, b] : [x])) },
    node, newPipe: newId,
  };
}

/** Put an element on a pipe at fraction u: devices go on a new junction; links (pump, valves) sit between two new
 *  junctions a short way apart; a non-return valve on a pipe is stored on the pipe itself. */
export function insertOnPipe(net: Network, pipeId: string, kind: ElementKind, u: number, d: ElementDefaults = DEFAULTS): { net: Network; id: string; type: ElRef['type'] } {
  const p = net.pipes.find((x) => x.id === pipeId);
  if (!p) return { net, id: '', type: 'node' };
  const sp = splitPipe(net, pipeId, u, d);
  let n = sp.net;
  if (kind === 'junction') return { net: n, id: sp.node, type: 'node' };
  if (['airVessel', 'airValve', 'standpipe', 'feedTank', 'anticipator', 'relief', 'blowoff', 'burstDisc'].includes(kind)) {
    n = { ...n, nodes: n.nodes.map((x) => (x.id === sp.node ? { ...x, ...deviceDefaults(kind, x, p.diameter) } : x)) };
    return { net: n, id: sp.node, type: 'node' };
  }
  // links: a second node a little downstream, the downstream pipe starts there
  const a = n.nodes.find((x) => x.id === sp.node)!;
  const pts = pipePath(net, p), L = polyLength(pts) || 1;
  const at2 = pointAt(pts, Math.min(1, u + Math.min(0.06, 12 / L)));
  const dx = at2.x - a.x, dy = at2.y - a.y, len = Math.hypot(dx, dy) || 1;
  const gap = Math.min(len, Math.max(L * 0.03, 1e-3));
  const bId = uniqueId(n, 'J-');
  const b: NetNode = { ...a, id: bId, x: a.x + (dx / len) * gap, y: a.y + (dy / len) * gap, vessel: undefined, airValve: undefined, demand: 0 };
  n = { ...n, nodes: [...n.nodes, b], pipes: n.pipes.map((x) => (x.id === sp.newPipe ? { ...x, from: bId } : x)) };
  const dd = { ...d, pipeDiameter: p.diameter };
  const r = addLink(n, kind, sp.node, bId, dd);
  return { net: r.net, id: r.id, type: kind === 'pump' ? 'pump' : 'valve' };
}

/** Delete elements; deleting a node removes the pipes, pumps and valves connected to it. */
export function deleteElements(net: Network, refs: ElRef[]): Network {
  const nodes = new Set(refs.filter((r) => r.type === 'node').map((r) => r.id));
  const pipes = new Set(refs.filter((r) => r.type === 'pipe').map((r) => r.id));
  const pumps = new Set(refs.filter((r) => r.type === 'pump').map((r) => r.id));
  const valves = new Set(refs.filter((r) => r.type === 'valve').map((r) => r.id));
  const touches = (l: { from: string; to: string }) => nodes.has(l.from) || nodes.has(l.to);
  const gone = new Set<string>([...pumps, ...valves]);
  net.pumps.forEach((p) => touches(p) && gone.add(p.id));
  net.valves.forEach((v) => touches(v) && gone.add(v.id));
  const fixEv = (e: TransientEvent) => ({ ...e, targets: e.targets.filter((t) => !gone.has(t)) });
  return {
    ...net,
    nodes: net.nodes.filter((n) => !nodes.has(n.id)),
    pipes: net.pipes.filter((p) => !pipes.has(p.id) && !touches(p)),
    pumps: net.pumps.filter((p) => !gone.has(p.id)),
    valves: net.valves.filter((v) => !gone.has(v.id)),
    event: fixEv(net.event),
    extraEvents: net.extraEvents?.map(fixEv),
  };
}

/** Rename an element and every reference to it. */
export function renameElement(net: Network, type: ElRef['type'], from: string, to: string): { net: Network; ok: boolean; error?: string } {
  to = to.trim();
  if (!to) return { net, ok: false, error: 'The name cannot be empty.' };
  if (to === from) return { net, ok: true };
  if (allIds(net).has(to)) return { net, ok: false, error: `${to} is already used.` };
  const r = (s: string) => (s === from ? to : s);
  const fixEv = (e: TransientEvent) => ({ ...e, targets: e.targets.map(r) });
  if (type === 'node') {
    return {
      ok: true,
      net: {
        ...net,
        nodes: net.nodes.map((n) => (n.id === from ? { ...n, id: to } : n)),
        pipes: net.pipes.map((p) => ({ ...p, from: r(p.from), to: r(p.to) })),
        pumps: net.pumps.map((p) => ({ ...p, from: r(p.from), to: r(p.to) })),
        valves: net.valves.map((v) => ({ ...v, from: r(v.from), to: r(v.to) })),
        profiles: net.profiles?.map((pr) => ({ ...pr, path: pr.path.map(r) })),
      },
    };
  }
  const key = type === 'pipe' ? 'pipes' : type === 'pump' ? 'pumps' : 'valves';
  return { ok: true, net: { ...net, [key]: (net[key] as { id: string }[]).map((x) => (x.id === from ? { ...x, id: to } : x)), event: fixEv(net.event), extraEvents: net.extraEvents?.map(fixEv) } as Network };
}

/** Move nodes (and pipe bends between two moved nodes) by dx, dy. */
export function moveNodes(net: Network, ids: string[], dx: number, dy: number): Network {
  const s = new Set(ids);
  return {
    ...net,
    nodes: net.nodes.map((n) => (s.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)),
    pipes: net.pipes.map((p) => (p.vertices && s.has(p.from) && s.has(p.to) ? { ...p, vertices: p.vertices.map((v) => ({ x: v.x + dx, y: v.y + dy })) } : p)),
  };
}

/** Set pipe lengths from the drawing (all pipes, or the listed ones). */
export function lengthsFromDrawing(net: Network, ids?: string[]): Network {
  const s = ids ? new Set(ids) : null;
  return { ...net, pipes: net.pipes.map((p) => (s && !s.has(p.id) ? p : { ...p, length: Math.max(0.01, Math.round(pipeLengthFromDrawing(net, p) * 100) / 100) })) };
}

/** Reverse a pipe (its long-section points are mirrored). */
export function reversePipe(net: Network, id: string): Network {
  return { ...net, pipes: net.pipes.map((p) => (p.id !== id ? p : { ...p, from: p.to, to: p.from, vertices: p.vertices ? [...p.vertices].reverse() : undefined, profile: p.profile?.map((q) => ({ s: p.length - q.s, z: q.z })).sort((a, b) => a.s - b.s) })) };
}

/** Copy elements with a new id each (offset on the drawing). */
export function duplicateNodes(net: Network, ids: string[], dx: number, dy: number): { net: Network; ids: string[] } {
  let n = net;
  const map = new Map<string, string>();
  for (const id of ids) {
    const src = net.nodes.find((x) => x.id === id);
    if (!src) continue;
    const nid = uniqueId(n, src.kind === 'reservoir' ? 'R-' : 'J-');
    map.set(id, nid);
    n = { ...n, nodes: [...n.nodes, { ...structuredClone(src), id: nid, x: src.x + dx, y: src.y + dy }] };
  }
  for (const p of net.pipes) if (map.has(p.from) && map.has(p.to)) {
    const pid = uniqueId(n, 'P-');
    n = { ...n, pipes: [...n.pipes, { ...structuredClone(p), id: pid, from: map.get(p.from)!, to: map.get(p.to)!, vertices: p.vertices?.map((v) => ({ x: v.x + dx, y: v.y + dy })) }] };
  }
  return { net: n, ids: [...map.values()] };
}

/** Ids referenced by the run's operations that no longer exist. */
export const missingTargets = (net: Network) => {
  const ids = new Set([...net.pumps.map((p) => p.id), ...net.valves.map((v) => v.id)]);
  return allEvents(net).flatMap((e) => e.targets.filter((t) => !ids.has(t)));
};
