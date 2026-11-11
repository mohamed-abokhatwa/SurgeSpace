// Network from a plan drawing (DXF): the pipe layers become pipes and junctions (lines that end on another line are
// joined there), symbol blocks become air valves, line valves, non-return valves and pumps where they sit, texts
// next to the lines give levels and diameters, and missing levels are filled from the neighbours. The ends of the
// network are then set as sources, demands or closed ends by the engineer.
import { importDxf } from '../engine/importers';
import { defaultSettings, type Network, type NetNode, type Pipe } from '../engine/types';
import { PIPE_MATERIALS } from './catalogues';
import { insertOnPipe, uniqueId } from './edit';
import type { DxfSummary } from './intake';
import { wizardWaveSpeed } from './wizard';

export type SymbolKind = 'airValve' | 'washout' | 'valve' | 'checkValve' | 'pump' | 'reservoir' | 'tank' | 'hydrant' | 'ignore';
export const SYMBOL_KINDS: SymbolKind[] = ['airValve', 'washout', 'valve', 'checkValve', 'pump', 'reservoir', 'tank', 'hydrant', 'ignore'];

/** A first guess from the block name, as drafters name them (AV, ARV, WO, GV, BFV, NRV, PUMP …). */
export function guessSymbol(name: string): SymbolKind {
  const s = name.toUpperCase().replace(/[^A-Z0-9]+/g, ' ');
  if (/\b(ARV|AV|DAV|SAV|AIR|AIRV|VENT|KINETIC)\b|AIR ?VALVE|AIRVALVE/.test(s)) return 'airValve';
  if (/\b(WO|SCOUR|WASH|WASHOUT|DRAIN|BO|BLOWOFF)\b|WASH ?OUT|SCOUR/.test(s)) return 'washout';
  if (/\b(NRV|CV|CHECK|RV)\b|NON ?RETURN|REFLUX|CHECK ?VALVE/.test(s)) return 'checkValve';
  if (/\b(PUMP|PMP|PU)\b|PUMP/.test(s)) return 'pump';
  if (/\b(TANK|TK|GST|EST|RESERVOIR|RES|SUMP)\b/.test(s)) return /\b(RES|RESERVOIR|SUMP)\b/.test(s) ? 'reservoir' : 'tank';
  if (/\b(FH|HYD|HYDRANT)\b/.test(s)) return 'hydrant';
  if (/\b(GV|SV|BFV|BV|VALVE|VLV|ISO|SLUICE|GATE|PRV|FCV)\b|VALVE|BUTTERFLY/.test(s)) return 'valve';
  return 'ignore';
}

/** Layers that look like pipes (by name), else the layer with the most lines. */
export function guessPipeLayers(d: DxfSummary): string[] {
  const named = d.layers.filter((l) => /PIPE|MAIN|WATER|WTR|PROP|DI\b|HDPE|GRP|LINE/i.test(l.name) && !/TEXT|ANNO|DIM|GRID|BORDER|TITLE|ROAD|KERB|CONTOUR|BUILD/i.test(l.name));
  return named.length ? named.map((l) => l.name) : d.layers.slice(0, 1).map((l) => l.name);
}

export interface PlanOptions {
  layers: string[];
  /** Drawing units. */
  units: 'm' | 'mm';
  symbols: Record<string, SymbolKind>;
  diameterMm: number;
  material: string;
  classM: number;
  /** Lines closer than this are joined, m (default 0.5). */
  snap?: number;
  /** Symbols and texts are taken up to this distance from the network, m (default 5 and 15). */
  symbolDist?: number;
  textDist?: number;
  /** Ground level texts: cover to the pipe, m (default 1.2). */
  cover?: number;
}
export interface PlanResult { net: Network; notes: string[]; ends: string[]; placed: { kind: SymbolKind; at: string }[] }

const LEVEL_RE = /(?:^|[\s(])(IL|I\.L\.?|INV(?:ERT)?|CL|C\.L\.?|RL|EL(?:EV)?|TOP|Z|GL|G\.L\.?|NGL|FGL)\s*[=:.]?\s*\+?(-?\d{1,4}(?:\.\d{1,3})?)/i;
const DIA_RE = /(?:DN|Ø|⌀|%%C|DIA\.?|NB)\s*(\d{2,4})|(\d{2,4})\s*MM\s*(?:Ø|DIA|DI|HDPE|GRP|PVC|STEEL|MS)/i;

const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-12;
  const u = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2));
  return { d: Math.hypot(px - ax - u * dx, py - ay - u * dy), u };
};

/** Build the network from the plan. */
export function planToNetwork(d: DxfSummary, o: PlanOptions, name = 'Network from the plan'): PlanResult {
  const k = o.units === 'mm' ? 0.001 : 1;
  const snap = o.snap ?? 0.5, symDist = o.symbolDist ?? 5, txtDist = o.textDist ?? 15, cover = o.cover ?? 1.2;
  const mat = PIPE_MATERIALS.find((m) => m.id === o.material) ?? PIPE_MATERIALS[0];
  const a = wizardWaveSpeed(mat.id, o.diameterMm);
  const imp = importDxf(d.raw, { tol: snap / k, scale: k, diameter: o.diameterMm / 1000, wavespeed: a, layers: o.layers });
  const notes: string[] = [];
  const nodes: NetNode[] = imp.nodes.map((n) => ({ ...n }));
  let pipes: Pipe[] = imp.pipes.map((p) => ({ ...p, roughness: mat.roughness, pressureClass: o.classM, material: mat.name }));
  const hasZ = nodes.some((n) => n.elev !== 0);
  // lines that end on another line (T-junctions drawn without a vertex): split that line and join them
  const deg = () => { const m = new Map<string, number>(); for (const p of pipes) { m.set(p.from, (m.get(p.from) ?? 0) + 1); m.set(p.to, (m.get(p.to) ?? 0) + 1); } return m; };
  let joined = 0;
  for (const n of nodes) {
    if ((deg().get(n.id) ?? 0) !== 1) continue;
    let best: { p: Pipe; u: number; d: number } | null = null;
    for (const p of pipes) {
      if (p.from === n.id || p.to === n.id) continue;
      const A = nodes.find((x) => x.id === p.from)!, B = nodes.find((x) => x.id === p.to)!;
      const r = segDist(n.x, n.y, A.x, A.y, B.x, B.y);
      if (r.d <= snap && r.u > 0.001 && r.u < 0.999 && (!best || r.d < best.d)) best = { p, u: r.u, d: r.d };
    }
    if (!best) continue;
    const { p, u } = best;
    const L1 = p.length * u;
    pipes = pipes.filter((x) => x !== p).concat([{ ...p, to: n.id, length: L1 }, { ...p, id: `${p.id}b`, from: n.id, length: p.length - L1 }]);
    joined++;
  }
  if (joined) notes.push(`${joined} line end(s) joined to the line they touch (T-junctions)`);
  let net: Network = { name, nodes, pipes: pipes.map((p, i) => ({ ...p, id: `P${i + 1}` })), pumps: [], valves: [], event: { kind: 'none', targets: [], start: 1 }, settings: { ...defaultSettings(), friction: 'DW' } };
  // levels from the texts (invert, centreline, reduced level; ground level less the cover)
  let lv = 0, gl = 0;
  const fixed = new Set<string>();
  if (hasZ) net.nodes.forEach((n) => fixed.add(n.id));
  for (const t of d.texts) {
    const m = LEVEL_RE.exec(t.s);
    if (!m) continue;
    const x = t.x * k, y = t.y * k;
    let best: NetNode | null = null, bd = txtDist;
    for (const n of net.nodes) { const dd = Math.hypot(n.x - x, n.y - y); if (dd < bd) { bd = dd; best = n; } }
    if (!best) continue;
    const isGround = /^(GL|G\.L|NGL|FGL)/i.test(m[1]);
    const z = Number(m[2]) - (isGround ? cover : 0);
    // a pipe level beats a ground level for the same node
    if (fixed.has(best.id) && isGround) continue;
    best.elev = z; fixed.add(best.id);
    if (isGround) gl++; else lv++;
  }
  if (lv || gl) notes.push(`Levels from the drawing texts at ${lv + gl} node(s)${gl ? ` (${gl} from ground level less ${cover} m cover)` : ''}`);
  // diameters from the texts next to the pipes
  let dn = 0;
  for (const t of d.texts) {
    const m = DIA_RE.exec(t.s);
    if (!m) continue;
    const D = Number(m[1] ?? m[2]);
    if (!(D >= 20 && D <= 4000)) continue;
    const x = t.x * k, y = t.y * k;
    let best: Pipe | null = null, bd = txtDist;
    for (const p of net.pipes) { const A = net.nodes.find((q) => q.id === p.from)!, B = net.nodes.find((q) => q.id === p.to)!; const r = segDist(x, y, A.x, A.y, B.x, B.y); if (r.d < bd) { bd = r.d; best = p; } }
    if (!best) continue;
    best.diameter = D / 1000; best.wavespeed = wizardWaveSpeed(mat.id, D); dn++;
  }
  if (dn) notes.push(`Diameters from the drawing texts on ${dn} pipe(s); DN${o.diameterMm} elsewhere`);
  // diameters spread along unlabelled runs (a size holds until the next label)
  const labelled = new Set(net.pipes.filter((p) => p.diameter !== o.diameterMm / 1000).map((p) => p.id));
  const dg0 = new Map<string, number>();
  for (const p of net.pipes) { dg0.set(p.from, (dg0.get(p.from) ?? 0) + 1); dg0.set(p.to, (dg0.get(p.to) ?? 0) + 1); }
  // at a tee the size carries on along the straight run (the two pipes within 20° of a straight line)
  const dir = (p: Pipe, x: string) => { const A = net.nodes.find((q) => q.id === x)!, B = net.nodes.find((q) => q.id === (p.from === x ? p.to : p.from))!; const L = Math.hypot(B.x - A.x, B.y - A.y) || 1; return [(B.x - A.x) / L, (B.y - A.y) / L]; };
  const straight = (p: Pipe, q: Pipe, x: string) => { const [a1, a2] = dir(p, x), [b1, b2] = dir(q, x); return a1 * b1 + a2 * b2 < -0.94; };
  if (dn) for (let it = 0; it < 200; it++) {
    let changed = false;
    for (const p of net.pipes) {
      if (labelled.has(p.id)) continue;
      // only through a plain continuation (a node joining two pipes), not across a junction of branches
      const nb = net.pipes.find((q) => q !== p && labelled.has(q.id) && [q.from, q.to].some((x) => (x === p.from || x === p.to) && (dg0.get(x) === 2 || straight(p, q, x))));
      if (nb) { p.diameter = nb.diameter; p.wavespeed = nb.wavespeed; labelled.add(p.id); changed = true; }
    }
    if (!changed) break;
  }
  // missing levels: from the neighbours (weighted by length), if any level is known
  if (fixed.size && fixed.size < net.nodes.length) {
    const adj = new Map<string, { o: string; L: number }[]>();
    for (const p of net.pipes) { adj.set(p.from, [...(adj.get(p.from) ?? []), { o: p.to, L: p.length }]); adj.set(p.to, [...(adj.get(p.to) ?? []), { o: p.from, L: p.length }]); }
    const z = new Map(net.nodes.map((n) => [n.id, fixed.has(n.id) ? n.elev : NaN]));
    const known = [...fixed].map((id) => z.get(id)!);
    const mean = known.reduce((s, v) => s + v, 0) / known.length;
    for (const n of net.nodes) if (!fixed.has(n.id)) z.set(n.id, mean);
    for (let it = 0; it < 500; it++) for (const n of net.nodes) {
      if (fixed.has(n.id)) continue;
      const nb = adj.get(n.id) ?? [];
      let w = 0, sz = 0;
      for (const e of nb) { const ww = 1 / Math.max(e.L, 1); w += ww; sz += ww * z.get(e.o)!; }
      if (w) z.set(n.id, sz / w);
    }
    net.nodes.forEach((n) => { if (!fixed.has(n.id)) n.elev = Math.round(z.get(n.id)! * 100) / 100; });
    notes.push(`${net.nodes.length - fixed.size} node level(s) filled in from their neighbours`);
  } else if (!fixed.size) notes.push('The drawing gives no levels: every node is at 0 m. Add a long section or levels before trusting the pressures.');
  // pipe lengths in 3D now that the levels are known
  net = { ...net, pipes: net.pipes.map((p) => { const A = net.nodes.find((q) => q.id === p.from)!, B = net.nodes.find((q) => q.id === p.to)!; return { ...p, length: Math.max(0.1, Math.round(Math.hypot(A.x - B.x, A.y - B.y, A.elev - B.elev) * 100) / 100) }; }) };
  // symbols
  const placed: PlanResult['placed'] = [];
  let skipped = 0;
  for (const b of d.blocks) {
    const kind = o.symbols[b.name] ?? 'ignore';
    if (kind === 'ignore') continue;
    for (const [bx, by] of b.at) {
      const x = bx * k, y = by * k;
      let best: { p: Pipe; u: number; d: number } | null = null;
      for (const p of net.pipes) { const A = net.nodes.find((q) => q.id === p.from)!, B = net.nodes.find((q) => q.id === p.to)!; const r = segDist(x, y, A.x, A.y, B.x, B.y); if (!best || r.d < best.d) best = { p, u: r.u, d: r.d }; }
      if (!best || best.d > symDist) { skipped++; continue; }
      // a symbol drawn at a node (within 3 m) belongs to that node
      let nearNode: NetNode | null = null, nd = Math.min(3, symDist);
      for (const n of net.nodes) { const dd = Math.hypot(n.x - x, n.y - y); if (dd <= nd) { nd = dd; nearNode = n; } }
      const nearEnd = nearNode?.id ?? (best.u * best.p.length < 1 ? best.p.from : (1 - best.u) * best.p.length < 1 ? best.p.to : null);
      if (kind === 'reservoir' || kind === 'tank') {
        const id = nearEnd ?? (best.u < 0.5 ? best.p.from : best.p.to);
        net = { ...net, nodes: net.nodes.map((n) => (n.id === id ? { ...n, kind: 'reservoir' as const, head: n.head ?? n.elev + 3 } : n)) };
        placed.push({ kind, at: id });
      } else if (kind === 'airValve' || kind === 'washout' || kind === 'hydrant') {
        if (kind !== 'airValve') { net = { ...net, annotations: [...(net.annotations ?? []), { id: uniqueId(net, 'A-'), x, y, text: kind === 'washout' ? `Washout (${b.name})` : `Hydrant (${b.name})` }] }; placed.push({ kind, at: 'note' }); continue; }
        if (nearEnd) { net = { ...net, nodes: net.nodes.map((n) => (n.id === nearEnd ? { ...n, airValve: n.airValve ?? { type: 'double', inDiameter: 0.1, outDiameter: 0.1, smallDiameter: 0.003 } } : n)) }; placed.push({ kind, at: nearEnd }); }
        else { const r = insertOnPipe(net, best.p.id, 'airValve', best.u); net = r.net; placed.push({ kind, at: r.id }); }
      } else {
        const u = Math.max(0.03, Math.min(0.97, best.u));
        const r = insertOnPipe(net, best.p.id, kind === 'valve' ? 'lineValve' : kind === 'checkValve' ? 'nrv' : 'pump', u);
        net = r.net; placed.push({ kind, at: r.id });
      }
    }
  }
  if (skipped) notes.push(`${skipped} symbol(s) more than ${symDist} m from any pipe left out`);
  const counts = SYMBOL_KINDS.map((s) => [s, placed.filter((p) => p.kind === s).length] as const).filter(([, c]) => c);
  if (counts.length) notes.push(`Placed from the symbols: ${counts.map(([s, c]) => `${c} ${s}`).join(', ')}`);
  const dg = new Map<string, number>();
  for (const l of [...net.pipes, ...net.pumps, ...net.valves]) { dg.set(l.from, (dg.get(l.from) ?? 0) + 1); dg.set(l.to, (dg.get(l.to) ?? 0) + 1); }
  const ends = net.nodes.filter((n) => (dg.get(n.id) ?? 0) === 1).map((n) => n.id);
  notes.unshift(`${net.nodes.length} nodes, ${net.pipes.length} pipes from layer(s) ${o.layers.join(', ')}; ${ends.length} open end(s)`);
  return { net, notes, ends, placed };
}

export type EndRole = { role: 'closed' } | { role: 'source'; level: number } | { role: 'demand'; lps: number };
/** Sources, demands and closed ends at the open ends; the surge event and the run length follow. */
export function finishPlanNetwork(net: Network, roles: Record<string, EndRole>): { net: Network; notes: string[] } {
  const notes: string[] = [];
  let n: Network = { ...net, nodes: net.nodes.map((x) => {
    const r = roles[x.id];
    if (!r || r.role === 'closed') return x;
    if (r.role === 'source') return { ...x, kind: 'reservoir' as const, head: r.level };
    return { ...x, kind: 'junction' as const, demand: r.lps / 1000 };
  }) };
  if (!n.nodes.some((x) => x.kind === 'reservoir')) throw new Error('Set at least one end as a source (reservoir or tank) with its water level.');
  // the event: all pumps trip, else the first line valve closes in 30 s
  if (n.pumps.length) { n = { ...n, event: { kind: 'pumpTrip', targets: n.pumps.map((p) => p.id), start: 1 } }; notes.push('Operation: all pumps trip at 1 s'); }
  else if (n.valves.length) { n = { ...n, valves: n.valves.map((v, i) => (i === 0 ? { ...v, opening: 1 } : v)), event: { kind: 'valveClose', targets: [n.valves[0].id], start: 1, duration: 30 } }; notes.push(`Operation: valve ${n.valves[0].id} closes in 30 s`); }
  else notes.push('No pump or valve on the drawing: set the operation to analyse under Operations');
  const L = n.pipes.reduce((s, p) => s + p.length, 0), aMin = Math.min(...n.pipes.map((p) => p.wavespeed));
  const dur = Math.max(30, Math.min(600, Math.ceil(((4 * Math.min(L, 20000)) / aMin + 30) / 10) * 10));
  n = { ...n, settings: { ...n.settings, duration: dur } };
  notes.push(`Run ${dur} s`);
  return { net: n, notes };
}

/** Checks on a network built from a plan: it solves, pressures stay positive and within class, velocities. */
export async function verifyNetwork(net: Network): Promise<{ what: string; ok: boolean; detail: string }[]> {
  const { solveSteady } = await import('../engine/steady');
  let st;
  try { st = solveSteady(net); } catch (e) { return [{ what: 'Steady state', ok: false, detail: (e as Error).message }]; }
  const out: { what: string; ok: boolean; detail: string }[] = [{ what: 'Steady state', ok: true, detail: `solved in ${st.iterations} iterations` }];
  let pmin = Infinity, pmax = -Infinity, at = '', atMax = '';
  for (const n of net.nodes) { if (n.kind === 'reservoir') continue; const p = (st.heads.get(n.id) ?? 0) - n.elev; if (p < pmin) { pmin = p; at = n.id; } if (p > pmax) { pmax = p; atMax = n.id; } }
  out.push({ what: 'Steady pressure stays positive', ok: pmin > 2, detail: `lowest ${pmin.toFixed(1)} m at ${at}` });
  const cls = Math.min(...net.pipes.map((p) => p.pressureClass ?? 160));
  out.push({ what: 'Steady pressure within the class', ok: pmax < cls, detail: `highest ${pmax.toFixed(1)} m at ${atMax}, class ${cls} m` });
  let vmax = 0, vAt = '';
  for (const p of net.pipes) { const v = Math.abs(st.flows.get(p.id) ?? 0) / ((Math.PI / 4) * p.diameter * p.diameter); if (v > vmax) { vmax = v; vAt = p.id; } }
  out.push({ what: 'Velocity', ok: vmax < 2.5, detail: `highest ${vmax.toFixed(2)} m/s in ${vAt}` });
  return out;
}
