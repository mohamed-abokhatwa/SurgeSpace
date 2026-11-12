// Network from a plan drawing (DXF): the pipe layers become pipes and junctions (lines that end on another line are
// joined there), symbol blocks become air valves, line valves, non-return valves and pumps where they sit, texts
// next to the lines give levels and diameters, and missing levels are filled from the neighbours. The ends of the
// network are then set as sources, demands or closed ends by the engineer.
import { solveSteady } from '../engine/steady';
import { defaultSettings, type Network, type NetNode, type Pipe } from '../engine/types';
import { PIPE_MATERIALS } from './catalogues';
import { addLink, insertOnPipe, splitPipe, uniqueId } from './edit';
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

/** Drawing units: from the header ($INSUNITS), else sizes written in inches mean a drawing in feet, else a very
 *  large extent means millimetres. */
export function guessUnits(d: DxfSummary): 'm' | 'mm' | 'ft' {
  if (d.insunits === 2) return 'ft';
  if (d.insunits === 4) return 'mm';
  if (d.insunits === 6) return 'm';
  const inch = d.texts.filter((t) => INCH_RE.test(t.s)).length, dn = d.texts.filter((t) => DIA_RE.test(t.s)).length;
  if (inch >= 3 && inch > dn) return 'ft';
  const pts = [...d.blocks.flatMap((b) => b.at), ...d.texts.map((t) => [t.x, t.y] as [number, number])];
  if (!pts.length) return 'm';
  const span = Math.max(Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1])));
  return span > 50000 ? 'mm' : 'm';
}

/** Layers that look like pipes (by name), else the layer with the most lines. */
export function guessPipeLayers(d: DxfSummary): string[] {
  const named = d.layers.filter((l) => /PIPE|MAIN|WATER|WTR|PROP|DI\b|HDPE|GRP|LINE/i.test(l.name) && !/TEXT|ANNO|DIM|GRID|BORDER|TITLE|ROAD|KERB|CONTOUR|BUILD/i.test(l.name));
  return named.length ? named.map((l) => l.name) : d.layers.slice(0, 1).map((l) => l.name);
}

export interface PlanOptions {
  layers: string[];
  /** Drawing units (in feet, the levels written on the drawing are in feet too). */
  units: 'm' | 'mm' | 'ft';
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
const WL_RE = /(?:^|[\s(])(TWL|T\.W\.L\.?|HWL|MWL|LWL|TOP WATER(?: LEVEL)?|WL|W\.L\.?)\s*[=:.]?\s*\+?(-?\d{1,4}(?:\.\d{1,3})?)/i;
const INCH_RE = /(?:^|[\s(])(\d{1,2}(?:\.\d{1,2})?)\s*(?:"|''|IN\b|IN\.|INCH)/i;
const DIA_RE = /(?:DN|Ø|⌀|%%C|DIA\.?|NB)\s*(\d{2,4})|(\d{2,4})\s*MM\s*(?:Ø|DIA|DI|HDPE|GRP|PVC|STEEL|MS)/i;

const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-12;
  const u = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2));
  return { d: Math.hypot(px - ax - u * dx, py - ay - u * dy), u };
};

/** Uniform grid over the drawing: items by bounding box, queries by radius (keeps plans of thousands of pipes fast). */
class Grid<T> {
  private cells = new Map<string, T[]>();
  private c: number;
  constructor(c: number) { this.c = c; }
  private key(i: number, j: number) { return `${i},${j}`; }
  add(x0: number, y0: number, x1: number, y1: number, t: T) {
    const c = this.c;
    for (let i = Math.floor(Math.min(x0, x1) / c); i <= Math.floor(Math.max(x0, x1) / c); i++)
      for (let j = Math.floor(Math.min(y0, y1) / c); j <= Math.floor(Math.max(y0, y1) / c); j++) {
        const k = this.key(i, j); const a = this.cells.get(k); if (a) a.push(t); else this.cells.set(k, [t]);
      }
  }
  near(x: number, y: number, r: number): Set<T> {
    const c = this.c, out = new Set<T>();
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++)
      for (let j = Math.floor((y - r) / c); j <= Math.floor((y + r) / c); j++) for (const t of this.cells.get(this.key(i, j)) ?? []) out.add(t);
    return out;
  }
}

/** Lines and polylines on the chosen layers, as point chains in metres. */
function readChains(raw: string, layers: string[], k: number): { pts: [number, number, number][] }[] {
  const want = new Set(layers.map((l) => l.toLowerCase()));
  const lines = raw.replace(/\r/g, '').split('\n');
  const out: { pts: [number, number, number][] }[] = [];
  let inE = false;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const c = Number(lines[i].trim()), v = lines[i + 1].trim();
    if (c === 2 && v === 'ENTITIES') inE = true;
    if (c === 0 && v === 'ENDSEC') inE = false;
    if (!inE || c !== 0 || (v !== 'LINE' && v !== 'LWPOLYLINE' && v !== 'POLYLINE')) continue;
    let layer = '0', elev = 0;
    const pts: [number, number, number][] = [];
    const e: Record<number, string> = {};
    let j = i + 2;
    for (; j + 1 < lines.length && Number(lines[j].trim()) !== 0; j += 2) {
      const cc = Number(lines[j].trim()), vv = lines[j + 1].trim();
      if (cc === 8) layer = vv;
      if (v === 'LWPOLYLINE') { if (cc === 38) elev = +vv; if (cc === 10) pts.push([+vv * k, 0, 0]); if (cc === 20 && pts.length) pts[pts.length - 1][1] = +vv * k; }
      else if (!(cc in e)) e[cc] = vv;
    }
    if (v === 'LINE') pts.push([+e[10] * k, +e[20] * k, +(e[30] ?? 0) * k], [+e[11] * k, +e[21] * k, +(e[31] ?? 0) * k]);
    if (v === 'LWPOLYLINE') pts.forEach((p) => (p[2] = elev * k));
    if (v === 'POLYLINE') {
      while (j + 1 < lines.length && lines[j + 1].trim() === 'VERTEX') {
        const ve: Record<number, string> = {};
        let m = j + 2;
        for (; m + 1 < lines.length && Number(lines[m].trim()) !== 0; m += 2) ve[Number(lines[m].trim())] = lines[m + 1].trim();
        pts.push([+ve[10] * k, +ve[20] * k, +(ve[30] ?? 0) * k]);
        j = m;
      }
    }
    i = j - 2;
    if (want.has(layer.toLowerCase()) && pts.length >= 2 && pts.every((p) => p.every(Number.isFinite))) out.push({ pts });
  }
  return out;
}

/** Build the network from the plan. */
export function planToNetwork(d: DxfSummary, o: PlanOptions, name = 'Network from the plan'): PlanResult {
  const k = o.units === 'mm' ? 0.001 : o.units === 'ft' ? 0.3048 : 1;
  const zk = o.units === 'ft' ? 0.3048 : 1;
  const snap = o.snap ?? 0.5, symDist = o.symbolDist ?? 5, txtDist = o.textDist ?? 15, cover = o.cover ?? 1.2;
  const mat = PIPE_MATERIALS.find((m) => m.id === o.material) ?? PIPE_MATERIALS[0];
  const a = wizardWaveSpeed(mat.id, o.diameterMm);
  const chains = readChains(d.raw, o.layers, k);
  if (!chains.length) throw new Error(`No lines on layer(s) ${o.layers.join(', ') || '(none chosen)'}.`);
  const notes: string[] = [];
  // nodes: line ends and vertices, merged within the snap distance
  const nodes: NetNode[] = [];
  const nodeGrid = new Grid<NetNode>(Math.max(snap * 4, 1));
  const lineEnds = new Set<NetNode>();
  const nodeAt = (x: number, y: number, z: number, isEnd = false): NetNode => {
    let best: NetNode | null = null, bd = snap;
    for (const n of nodeGrid.near(x, y, snap * 2)) { const dd = Math.hypot(n.x - x, n.y - y); if (dd <= bd) { bd = dd; best = n; } }
    if (best) {
      // a line end is where the junction really is; a bend vertex drawn next to it moves onto it
      if (isEnd && !lineEnds.has(best) && bd > 0) { best.x = x; best.y = y; nodeGrid.add(x, y, x, y, best); }
      if (isEnd) lineEnds.add(best);
      return best;
    }
    const n: NetNode = { id: `N${nodes.length + 1}`, kind: 'junction', x, y, elev: z };
    nodes.push(n); nodeGrid.add(x, y, x, y, n);
    if (isEnd) lineEnds.add(n);
    return n;
  };
  type Seg = { id: number; a: NetNode; b: NetNode; dead?: boolean; chain: number; idx: number };
  let segs: Seg[] = [];
  let sid = 0;
  const pairs = new Set<string>();
  // the ends of every line or polyline are real nodes (junctions, ends); inner vertices are bends unless more meets there
  // first the line ends (they meet within the snap distance), then the inner vertices, which join something else only
  // where they coincide with it (a vertex merely near a junction of another line does not connect to it)
  const endNodes = chains.map((c) => [nodeAt(...c.pts[0], true), nodeAt(...c.pts[c.pts.length - 1], true)]);
  const vertexAt = (x: number, y: number, z: number): NetNode => {
    for (const n of nodeGrid.near(x, y, 0.01)) if (Math.hypot(n.x - x, n.y - y) <= 0.01) return n;
    const n: NetNode = { id: `N${nodes.length + 1}`, kind: 'junction', x, y, elev: z };
    nodes.push(n); nodeGrid.add(x, y, x, y, n);
    return n;
  };
  chains.forEach((c, ci) => {
    const ns = c.pts.map((pt, i) => (i === 0 ? endNodes[ci][0] : i === c.pts.length - 1 ? endNodes[ci][1] : vertexAt(...pt)));
    for (let i = 0; i + 1 < c.pts.length; i++) {
      const A = ns[i], B = ns[i + 1];
      const key = A.id < B.id ? `${A.id}|${B.id}` : `${B.id}|${A.id}`;
      // a line drawn twice over itself is one pipe
      if (A !== B && !pairs.has(key)) { pairs.add(key); segs.push({ id: sid++, a: A, b: B, chain: ci, idx: i }); }
    }
  });
  const hasZ = nodes.some((n) => n.elev !== 0);
  const segGrid = () => { const g = new Grid<Seg>(Math.max(txtDist, 10)); for (const s of segs) if (!s.dead) g.add(s.a.x, s.a.y, s.b.x, s.b.y, s); return g; };
  // lines that end on another line (T-junctions drawn without a vertex): split that line there
  let joined = 0;
  {
    const deg = new Map<NetNode, number>();
    for (const s of segs) { deg.set(s.a, (deg.get(s.a) ?? 0) + 1); deg.set(s.b, (deg.get(s.b) ?? 0) + 1); }
    let g = segGrid();
    for (const n of nodes) {
      if (deg.get(n) !== 1) continue;
      let best: { s: Seg; u: number; d: number } | null = null;
      let vtx: NetNode | null = null, vd = snap;
      for (const s of g.near(n.x, n.y, snap)) {
        if (s.dead || s.a === n || s.b === n) continue;
        const r = segDist(n.x, n.y, s.a.x, s.a.y, s.b.x, s.b.y);
        if (r.d <= snap && r.u > 0.001 && r.u < 0.999 && (!best || r.d < best.d)) best = { s, u: r.u, d: r.d };
        for (const v of [s.a, s.b]) { const dv = Math.hypot(v.x - n.x, v.y - n.y); if (dv <= vd) { vd = dv; vtx = v; } }
      }
      // a loose end next to a vertex of another line joins that vertex
      if (vtx && (!best || vd <= best.d + 1e-9)) {
        for (const s of segs) { if (s.a === n) s.a = vtx; if (s.b === n) s.b = vtx; }
        if (lineEnds.has(n)) lineEnds.add(vtx);
        deg.set(vtx, (deg.get(vtx) ?? 0) + 1); deg.set(n, 0); joined++;
        continue;
      }
      if (!best) continue;
      best.s.dead = true;
      const s1 = { id: sid++, a: best.s.a, b: n, chain: best.s.chain, idx: best.s.idx }, s2 = { id: sid++, a: n, b: best.s.b, chain: best.s.chain, idx: best.s.idx + 0.5 };
      segs.push(s1, s2);
      g.add(s1.a.x, s1.a.y, s1.b.x, s1.b.y, s1); g.add(s2.a.x, s2.a.y, s2.b.x, s2.b.y, s2);
      deg.set(n, 3); joined++;
    }
    segs = segs.filter((s) => !s.dead);
  }
  if (joined) notes.push(`${joined} line end(s) joined to the line they touch (T-junctions)`);
  // levels from the texts (invert, centreline, reduced level; ground level less the cover); water levels kept for sources
  const fixed = new Set<NetNode>();
  if (hasZ) nodes.forEach((n) => fixed.add(n));
  const waterLevels: { x: number; y: number; z: number }[] = [];
  let lv = 0, gl = 0;
  for (const t of d.texts) {
    const x = t.x * k, y = t.y * k;
    const w = WL_RE.exec(t.s);
    if (w) { waterLevels.push({ x, y, z: Math.round(Number(w[2]) * zk * 1000) / 1000 }); continue; }
    const m = LEVEL_RE.exec(t.s);
    if (!m) continue;
    // a level belongs to the nearest line end (junction), else the nearest vertex
    let best: NetNode | null = null, bd = txtDist, bestEnd: NetNode | null = null, bde = txtDist;
    for (const n of nodeGrid.near(x, y, txtDist)) { const dd = Math.hypot(n.x - x, n.y - y); if (dd < bd) { bd = dd; best = n; } if (lineEnds.has(n) && dd < bde) { bde = dd; bestEnd = n; } }
    best = bestEnd ?? best;
    if (!best) continue;
    const isGround = /^(GL|G\.L|NGL|FGL)/i.test(m[1]);
    if (fixed.has(best) && isGround) continue;
    best.elev = Math.round((Number(m[2]) * zk - (isGround ? cover : 0)) * 1000) / 1000; fixed.add(best);
    if (isGround) gl++; else lv++;
  }
  if (lv || gl) notes.push(`Levels from the drawing texts at ${lv + gl} node(s)${gl ? ` (${gl} from ground level less ${cover} m cover)` : ''}`);
  // diameters from the texts next to the lines
  const dia = new Map<Seg, number>();
  {
    const g = segGrid();
    for (const t of d.texts) {
      const m = DIA_RE.exec(t.s), mi = m ? null : INCH_RE.exec(t.s);
      if (!m && !mi) continue;
      const D = m ? Number(m[1] ?? m[2]) : Math.round(Number(mi![1]) * 25.4 * 10) / 10;
      if (!(D >= 20 && D <= 4000)) continue;
      const x = t.x * k, y = t.y * k;
      let best: Seg | null = null, bd = txtDist;
      for (const s of g.near(x, y, txtDist)) { const r = segDist(x, y, s.a.x, s.a.y, s.b.x, s.b.y); if (r.d < bd) { bd = r.d; best = s; } }
      if (best) dia.set(best, D);
    }
  }
  const dn = dia.size;
  // sizes carry on along a run: through plain continuations, and straight through a tee
  if (dn) {
    const at = new Map<NetNode, Seg[]>();
    for (const s of segs) { at.set(s.a, [...(at.get(s.a) ?? []), s]); at.set(s.b, [...(at.get(s.b) ?? []), s]); }
    const dir = (s: Seg, n: NetNode) => { const o2 = s.a === n ? s.b : s.a; const L = Math.hypot(o2.x - n.x, o2.y - n.y) || 1; return [(o2.x - n.x) / L, (o2.y - n.y) / L]; };
    const straight = (p: Seg, q: Seg, n: NetNode) => { const [a1, a2] = dir(p, n), [b1, b2] = dir(q, n); return a1 * b1 + a2 * b2 < -0.94; };
    // first along the line it was written on (a polyline is one run), then across plain joints and straight through tees
    const byChain = new Map<number, Seg[]>();
    for (const sg of segs) byChain.set(sg.chain, [...(byChain.get(sg.chain) ?? []), sg]);
    for (const list of byChain.values()) {
      const lab = list.filter((x) => dia.has(x));
      if (!lab.length) continue;
      for (const sg of list) if (!dia.has(sg)) { const near = lab.reduce((b2, x) => (Math.abs(x.idx - sg.idx) < Math.abs(b2.idx - sg.idx) ? x : b2)); dia.set(sg, dia.get(near)!); }
    }
    const queue = [...dia.keys()];
    while (queue.length) {
      const q = queue.shift()!;
      for (const n of [q.a, q.b]) {
        const here = at.get(n) ?? [];
        for (const p of here) if (!dia.has(p) && (here.length === 2 || straight(p, q, n))) { dia.set(p, dia.get(q)!); queue.push(p); }
      }
    }
    notes.push(`Diameters from the drawing texts on ${dn} line(s), carried along their runs; DN${o.diameterMm} elsewhere`);
  }
  // missing levels: from the neighbours (weighted by length), if any level is known
  if (fixed.size && fixed.size < nodes.length) {
    const adj = new Map<NetNode, { o: NetNode; w: number }[]>();
    for (const s of segs) { const w = 1 / Math.max(Math.hypot(s.a.x - s.b.x, s.a.y - s.b.y), 1); adj.set(s.a, [...(adj.get(s.a) ?? []), { o: s.b, w }]); adj.set(s.b, [...(adj.get(s.b) ?? []), { o: s.a, w }]); }
    const free = nodes.filter((n) => !fixed.has(n));
    const mean = [...fixed].reduce((sum, n) => sum + n.elev, 0) / fixed.size;
    free.forEach((n) => (n.elev = mean));
    // Gauss–Seidel with over-relaxation until the levels settle
    for (let it = 0; it < 3000; it++) {
      let dmax = 0;
      for (const n of free) {
        let w = 0, sz = 0;
        for (const e of adj.get(n) ?? []) { w += e.w; sz += e.w * e.o.elev; }
        if (!w) continue;
        const nz = n.elev + 1.6 * (sz / w - n.elev);
        dmax = Math.max(dmax, Math.abs(nz - n.elev)); n.elev = nz;
      }
      if (dmax < 1e-4) break;
    }
    free.forEach((n) => (n.elev = Math.round(n.elev * 100) / 100));
    notes.push(`${free.length} node level(s) filled in from their neighbours`);
  } else if (!fixed.size) notes.push('The drawing gives no levels: every node is at 0 m. Add a long section or levels before trusting the pressures.');
  // bends: chains of plain vertices (two lines, no level text, same size) become one pipe with its bends
  const keep = new Set<NetNode>([...fixed, ...lineEnds]);
  // a device drawn at a vertex keeps that vertex as a node (only the nearest one; notes such as hydrants keep none)
  const symPts = d.blocks.filter((b) => !['ignore', 'washout', 'hydrant'].includes(o.symbols[b.name] ?? 'ignore')).flatMap((b) => b.at.map(([x, y]) => [x * k, y * k] as [number, number]));
  for (const [x, y] of symPts) {
    let bn: NetNode | null = null, bd2 = Math.min(3, symDist);
    for (const n of nodeGrid.near(x, y, bd2)) { const dd = Math.hypot(n.x - x, n.y - y); if (dd <= bd2) { bd2 = dd; bn = n; } }
    if (bn) keep.add(bn);
  }
  const at = new Map<NetNode, Seg[]>();
  for (const s of segs) { at.set(s.a, [...(at.get(s.a) ?? []), s]); at.set(s.b, [...(at.get(s.b) ?? []), s]); }
  const isBend = (n: NetNode) => { const h = at.get(n) ?? []; return h.length === 2 && !keep.has(n) && (dia.get(h[0]) ?? 0) === (dia.get(h[1]) ?? 0); };
  const pipes: Pipe[] = [];
  const used = new Set<Seg>();
  const L3 = (A: NetNode, B: NetNode) => Math.hypot(A.x - B.x, A.y - B.y, A.elev - B.elev);
  for (const s0 of segs) {
    if (used.has(s0)) continue;
    // walk to both ends of the run of bends
    const run: NetNode[] = [s0.a, s0.b];
    used.add(s0);
    for (const side of [0, 1]) {
      for (;;) {
        const end = side ? run[run.length - 1] : run[0];
        if (!isBend(end)) break;
        const nxt = (at.get(end) ?? []).find((x) => !used.has(x));
        if (!nxt) break;
        used.add(nxt);
        const other = nxt.a === end ? nxt.b : nxt.a;
        if (side) run.push(other); else run.unshift(other);
        if (other === run[side ? 0 : run.length - 1]) break; // closed loop of bends
      }
    }
    const D = (dia.get(s0) ?? o.diameterMm) / 1000;
    // a ring drawn as one closed line becomes two pipes, split at its middle bend (a pipe cannot join a node to itself)
    let parts: NetNode[][] = [run];
    if (run[0] === run[run.length - 1]) {
      if (run.length < 4) parts = run.length === 3 ? [[run[0], run[1]]] : [];
      else { const m = Math.floor(run.length / 2); parts = [run.slice(0, m + 1), run.slice(m)]; }
    }
    for (const part of parts) {
      let len = 0;
      const profile: { s: number; z: number }[] = [];
      for (let i = 0; i + 1 < part.length; i++) { len += L3(part[i], part[i + 1]); if (i + 1 < part.length - 1) profile.push({ s: Math.round(len * 100) / 100, z: part[i + 1].elev }); }
      const inner = part.slice(1, -1);
      pipes.push({ id: `P${pipes.length + 1}`, from: part[0].id, to: part[part.length - 1].id, length: Math.max(0.1, Math.round(len * 100) / 100), diameter: D, roughness: mat.roughness, wavespeed: D * 1000 === o.diameterMm ? a : wizardWaveSpeed(mat.id, D * 1000), pressureClass: o.classM, material: mat.name, ...(inner.length ? { vertices: inner.map((n) => ({ x: n.x, y: n.y })), profile } : {}) });
    }
  }
  const usedNodes = new Set(pipes.flatMap((p) => [p.from, p.to]));
  let net: Network = { name, nodes: nodes.filter((n) => usedNodes.has(n.id)), pipes, pumps: [], valves: [], event: { kind: 'none', targets: [], start: 1 }, settings: { ...defaultSettings(), friction: 'DW' } };
  const bends = nodes.length - net.nodes.length;
  if (bends) notes.push(`${bends} bend(s) kept as points along their pipes`);
  // symbols: located on the network as drawn, then placed pipe by pipe from the far end back
  const placed: PlanResult['placed'] = [];
  let skipped = 0;
  const byId = new Map(net.nodes.map((n) => [n.id, n]));
  const pts = (p: Pipe) => [byId.get(p.from)!, ...(p.vertices ?? []), byId.get(p.to)!];
  const pg = new Grid<Pipe>(Math.max(symDist * 4, 20));
  for (const p of net.pipes) { const q = pts(p); for (let i = 0; i + 1 < q.length; i++) pg.add(q[i].x, q[i].y, q[i + 1].x, q[i + 1].y, p); }
  const ng = new Grid<NetNode>(Math.max(symDist * 4, 20));
  for (const n of net.nodes) ng.add(n.x, n.y, n.x, n.y, n);
  type Hit = { kind: SymbolKind; block: string; x: number; y: number; node?: string; pipe?: Pipe; u?: number };
  const hits: Hit[] = [];
  for (const b of d.blocks) {
    const kind = o.symbols[b.name] ?? 'ignore';
    if (kind === 'ignore') continue;
    for (const [bx, by] of b.at) {
      const x = bx * k, y = by * k;
      let nearNode: NetNode | null = null, nd = Math.min(3, symDist);
      for (const n of ng.near(x, y, nd)) { const dd = Math.hypot(n.x - x, n.y - y); if (dd <= nd) { nd = dd; nearNode = n; } }
      let best: { p: Pipe; u: number; d: number } | null = null;
      for (const p of pg.near(x, y, symDist)) {
        const q = pts(p);
        const lens = q.slice(1).map((v, i) => Math.hypot(v.x - q[i].x, v.y - q[i].y)), tot = lens.reduce((s2, v) => s2 + v, 0) || 1;
        let acc = 0;
        for (let i = 0; i + 1 < q.length; i++) { const r = segDist(x, y, q[i].x, q[i].y, q[i + 1].x, q[i + 1].y); if (!best || r.d < best.d) best = { p, u: (acc + r.u * lens[i]) / tot, d: r.d }; acc += lens[i]; }
      }
      if (!nearNode && (!best || best.d > symDist)) { skipped++; continue; }
      const linkKind = kind === 'valve' || kind === 'checkValve' || kind === 'pump';
      if (nearNode) hits.push({ kind, block: b.name, x, y, node: nearNode.id });
      else if (best) {
        const endNode = best.u * best.p.length < 1 ? best.p.from : (1 - best.u) * best.p.length < 1 ? best.p.to : null;
        if (endNode && !linkKind) hits.push({ kind, block: b.name, x, y, node: endNode });
        else hits.push({ kind, block: b.name, x, y, pipe: best.p, u: linkKind ? Math.max(1 / best.p.length, Math.min(1 - 1 / best.p.length, best.u)) : best.u });
      }
    }
  }
  const avDefault = { type: 'double' as const, inDiameter: 0.1, outDiameter: 0.1, smallDiameter: 0.003 };
  for (const h of hits.filter((x) => x.node)) {
    if (h.kind === 'reservoir' || h.kind === 'tank') {
      const n = byId.get(h.node!)!;
      // the water level written next to the symbol (TWL, WL …)
      const wl = waterLevels.filter((w) => Math.hypot(w.x - h.x, w.y - h.y) <= txtDist * 2).sort((p1, p2) => Math.hypot(p1.x - h.x, p1.y - h.y) - Math.hypot(p2.x - h.x, p2.y - h.y))[0];
      net = { ...net, nodes: net.nodes.map((x) => (x.id === n.id ? { ...x, kind: 'reservoir' as const, head: wl ? wl.z : x.head ?? x.elev + 3 } : x)) };
      placed.push({ kind: h.kind, at: n.id });
    } else if (h.kind === 'airValve') { net = { ...net, nodes: net.nodes.map((x) => (x.id === h.node ? { ...x, airValve: x.airValve ?? avDefault } : x)) }; placed.push({ kind: h.kind, at: h.node! }); }
    else if (h.kind === 'washout' || h.kind === 'hydrant') { if (h.kind === 'washout') net = { ...net, annotations: [...(net.annotations ?? []), { id: uniqueId(net, 'A-'), x: h.x, y: h.y, text: 'WO' }] }; placed.push({ kind: h.kind, at: 'note' }); }
    else {
      // a pump or valve drawn on a node: the node is split there, the link joins the two halves (direction set later)
      const rr = linkAt(net, h.node!, h.kind);
      if (!rr) { skipped++; continue; }
      net = rr.net; placed.push({ kind: h.kind, at: rr.id });
    }
  }
  // on pipes: from the far end of each pipe back, so the earlier positions stay valid on the remaining part
  const onPipes = hits.filter((x) => x.pipe).sort((p1, p2) => (p1.pipe!.id === p2.pipe!.id ? p2.u! - p1.u! : p1.pipe!.id.localeCompare(p2.pipe!.id)));
  const frac = new Map<string, number>();
  for (const h of onPipes) {
    if (h.kind === 'washout' || h.kind === 'hydrant') { if (h.kind === 'washout') net = { ...net, annotations: [...(net.annotations ?? []), { id: uniqueId(net, 'A-'), x: h.x, y: h.y, text: 'WO' }] }; placed.push({ kind: h.kind, at: 'note' }); continue; }
    if (h.kind === 'reservoir' || h.kind === 'tank') { skipped++; continue; }
    const f = frac.get(h.pipe!.id) ?? 1;
    const u = Math.max(0.001, Math.min(0.999, h.u! / f));
    if (h.kind === 'airValve') { const r = insertOnPipe(net, h.pipe!.id, 'airValve', u); net = r.net; placed.push({ kind: h.kind, at: r.id }); }
    else {
      // a link on a pipe: split the pipe where the symbol is, then put the link across a short gap there
      const sp = splitPipe(net, h.pipe!.id, u);
      if (!sp.node) { skipped++; continue; }
      const rr = linkAt(sp.net, sp.node, h.kind, sp.newPipe);
      if (!rr) { skipped++; continue; }
      net = rr.net; placed.push({ kind: h.kind, at: rr.id });
    }
    frac.set(h.pipe!.id, h.u!);
  }
  if (skipped) notes.push(`${skipped} symbol(s) away from the pipes left out`);
  const counts = SYMBOL_KINDS.map((x) => [x, placed.filter((p) => p.kind === x).length] as const).filter(([, c]) => c);
  if (counts.length) notes.push(`Placed from the symbols: ${counts.map(([x, c]) => `${c} ${x}`).join(', ')}`);
  const dg = new Map<string, number>();
  for (const l of [...net.pipes, ...net.pumps, ...net.valves]) { dg.set(l.from, (dg.get(l.from) ?? 0) + 1); dg.set(l.to, (dg.get(l.to) ?? 0) + 1); }
  const ends = net.nodes.filter((n) => (dg.get(n.id) ?? 0) === 1 || n.kind === 'reservoir').map((n) => n.id);
  notes.unshift(`${net.nodes.length} nodes, ${net.pipes.length} pipes from layer(s) ${o.layers.join(', ')}; ${ends.length} open end(s) and sources`);
  return { net, notes, ends, placed };
}

/** A pump or valve at a node: the node is split, a short gap (at most 0.5 m) opened along one of its pipes (the
 *  given one, else the longest) and the link put across it. */
function linkAt(net: Network, nodeId: string, kind: SymbolKind, prefer?: string): { net: Network; id: string } | null {
  const n0 = net.nodes.find((x) => x.id === nodeId);
  if (!n0) return null;
  const ps = net.pipes.filter((q) => q.from === n0.id || q.to === n0.id).sort((p1, p2) => (p1.id === prefer ? -1 : p2.id === prefer ? 1 : p2.length - p1.length));
  if (!ps.length) return null;
  const q = ps[0];
  const far = net.nodes.find((x) => x.id === (q.from === n0.id ? q.to : q.from))!;
  const toward = q.from === n0.id ? (q.vertices?.[0] ?? far) : (q.vertices?.[q.vertices.length - 1] ?? far);
  const L = Math.hypot(toward.x - n0.x, toward.y - n0.y) || 1, g = Math.min(0.5, L / 4, q.length / 4);
  const bId = uniqueId(net, 'J-');
  const B: NetNode = { ...n0, id: bId, x: n0.x + ((toward.x - n0.x) / L) * g, y: n0.y + ((toward.y - n0.y) / L) * g, airValve: undefined, vessel: undefined, demand: 0, kind: 'junction', head: undefined };
  const shift = (pr: Pipe['profile']) => (q.from === n0.id ? pr?.map((v) => ({ s: Math.max(0, v.s - g), z: v.z })).filter((v) => v.s > 0) : pr);
  const n1: Network = { ...net, nodes: [...net.nodes, B], pipes: net.pipes.map((x) => (x.id === q.id ? { ...x, ...(x.from === n0.id ? { from: bId } : { to: bId }), length: Math.max(0.1, x.length - g), ...(x.profile ? { profile: shift(x.profile) } : {}) } : x)) };
  const rr = addLink(n1, kind === 'valve' ? 'lineValve' : kind === 'checkValve' ? 'nrv' : 'pump', n0.id, bId);
  return { net: rr.net, id: rr.id };
}

export type EndRole = { role: 'closed' } | { role: 'source'; level: number } | { role: 'demand'; lps: number };
/** Sources, demands and closed ends; a total demand spread over the junctions by pipe length; pumps and
 *  non-return valves turned to push away from the sources; the surge event and the run length. */
export function finishPlanNetwork(net: Network, roles: Record<string, EndRole>, opt: { totalDemandLps?: number } = {}): { net: Network; notes: string[] } {
  const notes: string[] = [];
  let n: Network = { ...net, nodes: net.nodes.map((x) => {
    const r = roles[x.id];
    if (!r) return x;
    if (r.role === 'closed') return x.kind === 'reservoir' ? { ...x, kind: 'junction' as const, head: undefined } : x;
    if (r.role === 'source') return { ...x, kind: 'reservoir' as const, head: r.level };
    return { ...x, kind: 'junction' as const, demand: r.lps / 1000 };
  }) };
  if (!n.nodes.some((x) => x.kind === 'reservoir')) throw new Error('Set at least one end as a source (reservoir or tank) with its water level.');
  if (opt.totalDemandLps && opt.totalDemandLps > 0) {
    const half = new Map<string, number>();
    for (const p of n.pipes) { half.set(p.from, (half.get(p.from) ?? 0) + p.length / 2); half.set(p.to, (half.get(p.to) ?? 0) + p.length / 2); }
    const js = n.nodes.filter((x) => x.kind === 'junction' && !(roles[x.id]?.role === 'demand'));
    const tot = js.reduce((s2, x) => s2 + (half.get(x.id) ?? 0), 0) || 1;
    const q = opt.totalDemandLps / 1000;
    n = { ...n, nodes: n.nodes.map((x) => (x.kind === 'junction' && !(roles[x.id]?.role === 'demand') ? { ...x, demand: (x.demand ?? 0) + (q * (half.get(x.id) ?? 0)) / tot } : x)) };
    notes.push(`${opt.totalDemandLps} L/s spread over ${js.length} junctions by the length of pipe they serve`);
  }
  // pumps push away from the sources: a pump whose suction side cannot reach a source without it is turned round
  const reach = (skip: string) => {
    const adj = new Map<string, string[]>();
    for (const l of [...n.pipes, ...n.valves, ...n.pumps.filter((p) => p.id !== skip)]) { adj.set(l.from, [...(adj.get(l.from) ?? []), l.to]); adj.set(l.to, [...(adj.get(l.to) ?? []), l.from]); }
    const seen = new Set(n.nodes.filter((x) => x.kind === 'reservoir').map((x) => x.id)), q = [...seen];
    while (q.length) { const v = q.pop()!; for (const w of adj.get(v) ?? []) if (!seen.has(w)) { seen.add(w); q.push(w); } }
    return seen;
  };
  let turned = 0;
  const ambiguous: string[] = [];
  n = { ...n, pumps: n.pumps.map((p) => { const r = reach(p.id); if (r.has(p.to) && !r.has(p.from)) { turned++; return { ...p, from: p.to, to: p.from }; } if (r.has(p.to) && r.has(p.from)) ambiguous.push(p.id); return p; }) };
  // a pump with sources on both sides lifts from the lower one: the suction is the side whose nearest source (along
  // the pipes, without the pump) has the lower water level
  if (ambiguous.length) {
    const adjL = new Map<string, { o: string; L: number }[]>();
    for (const l of [...n.pipes.map((p) => ({ ...p, L: p.length })), ...n.valves.map((v) => ({ ...v, L: 0.1 }))]) { adjL.set(l.from, [...(adjL.get(l.from) ?? []), { o: l.to, L: l.L }]); adjL.set(l.to, [...(adjL.get(l.to) ?? []), { o: l.from, L: l.L }]); }
    const nodeBy = new Map(n.nodes.map((x) => [x.id, x]));
    const nearestSource = (start: string, block: Set<string>) => {
      const dist = new Map([[start, 0]]), done = new Set<string>();
      for (let guard = 0; guard < 200000; guard++) {
        let v = '', best = Infinity;
        for (const [k2, d2] of dist) if (!done.has(k2) && d2 < best) { best = d2; v = k2; }
        if (!v) return undefined;
        const nv = nodeBy.get(v)!;
        if (nv.kind === 'reservoir') return nv.head ?? nv.elev;
        done.add(v);
        for (const e of adjL.get(v) ?? []) if (!block.has(e.o) && (dist.get(e.o) ?? Infinity) > best + e.L) dist.set(e.o, best + e.L);
        if (done.size > 5000) return undefined;
      }
      return undefined;
    };
    n = { ...n, pumps: n.pumps.map((p) => {
      if (!ambiguous.includes(p.id)) return p;
      const hs = nearestSource(p.from, new Set([p.to])), hd = nearestSource(p.to, new Set([p.from]));
      if (hs !== undefined && hd !== undefined && hd < hs - 0.01) { turned++; return { ...p, from: p.to, to: p.from }; }
      return p;
    }) };
  }
  if (turned) notes.push(`${turned} pump(s) turned to push away from the source (drawn the other way)`);
  // non-return valves: let the steady flow through them choose their direction
  const nrv = n.valves.filter((v) => v.check);
  if (nrv.length) {
    try {
      const st = solveSteady({ ...n, valves: n.valves.map((v) => (v.check ? { ...v, check: false } : v)) });
      let flipped = 0;
      n = { ...n, valves: n.valves.map((v) => (v.check && (st.flows.get(v.id) ?? 0) < -1e-6 ? (flipped++, { ...v, from: v.to, to: v.from }) : v)) };
      if (flipped) notes.push(`${flipped} non-return valve(s) turned to the flow direction`);
    } catch { /* left as drawn */ }
  }
  // the event: all pumps trip, else the first line valve closes in 30 s
  if (n.pumps.length) { n = { ...n, event: { kind: 'pumpTrip', targets: n.pumps.map((p) => p.id), start: 1 } }; notes.push('Operation: all pumps trip at 1 s'); }
  else if (n.valves.some((v) => !v.check)) { const v0 = n.valves.find((v) => !v.check)!; n = { ...n, valves: n.valves.map((v) => (v === v0 ? { ...v, opening: 1 } : v)), event: { kind: 'valveClose', targets: [v0.id], start: 1, duration: 30 } }; notes.push(`Operation: valve ${v0.id} closes in 30 s`); }
  else notes.push('No pump or valve on the drawing: set the operation to analyse under Operations');
  const L = n.pipes.reduce((s2, p) => s2 + p.length, 0), aMin = Math.min(...n.pipes.map((p) => p.wavespeed));
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

/** Network from schedules: junction and pipe items read from spreadsheets (node and pipe tables) or by the AI from a
 *  scanned plan (junctions with their place on the page, pipes by the junctions they join). Lengths come from the
 *  schedules where given; positions from coordinates, else from the page (scaled by the lengths written), else laid
 *  out from the connections. */
export interface ItemsOptions { diameterMm: number; material: string; classM: number }
export function networkFromItems(ev: { type: string; label?: string; values: Record<string, number | string>; source: { box?: [number, number, number, number]; page?: number; doc: string }; status: string }[], o: ItemsOptions, name = 'Network from the schedules'): PlanResult {
  const acc = ev.filter((e) => e.status !== 'rejected');
  const mat = PIPE_MATERIALS.find((m) => m.id === o.material) ?? PIPE_MATERIALS[0];
  const notes: string[] = [];
  const N = (v: unknown) => (v === undefined || v === '' ? NaN : Number(v));
  const nm = (e: { label?: string; values: Record<string, number | string> }) => String(e.values.name ?? e.values.id ?? e.label ?? '').trim();
  type J = { id: string; x?: number; y?: number; px?: number; py?: number; page?: string; z?: number; demand?: number; kind: 'junction' | 'reservoir'; head?: number };
  const js = new Map<string, J>();
  const touch = (id: string) => { if (!js.has(id)) js.set(id, { id, kind: 'junction' }); return js.get(id)!; };
  for (const e of acc) {
    if (!['junction', 'reservoir', 'tank'].includes(e.type)) continue;
    const id = nm(e); if (!id) continue;
    const j = touch(id);
    const x = N(e.values.x_m ?? e.values.x ?? e.values.easting_m), y = N(e.values.y_m ?? e.values.y ?? e.values.northing_m);
    if (Number.isFinite(x) && Number.isFinite(y)) { j.x = x; j.y = y; }
    else if (e.source.box) { j.px = (e.source.box[0] + e.source.box[2]) / 2; j.py = (e.source.box[1] + e.source.box[3]) / 2; j.page = `${e.source.doc}:${e.source.page ?? 1}`; }
    const z = N(e.values.level_m ?? e.values.elevation_m ?? e.values.ground_m); if (Number.isFinite(z)) j.z = z;
    const q = N(e.values.demand_lps); if (Number.isFinite(q)) j.demand = q;
    if (e.type !== 'junction') { j.kind = 'reservoir'; const h = N(e.values.head_m ?? e.values.water_level_m ?? e.values.max_level_m ?? e.values.level_m ?? e.values.min_level_m); if (Number.isFinite(h)) j.head = h; }
  }
  type L = { id: string; from: string; to: string; L?: number; D?: number; R?: number; closed?: boolean; kind: 'pipe' | 'pump' | 'valve' | 'checkValve' };
  const links: L[] = [];
  for (const e of acc) {
    if (!['pipe', 'pump', 'valve', 'checkValve'].includes(e.type)) continue;
    const f = String(e.values.from ?? '').trim(), t = String(e.values.to ?? '').trim();
    if (!f || !t || f === t) continue;
    touch(f); touch(t);
    links.push({ id: nm(e) || `${e.type === 'pipe' ? 'P' : e.type === 'pump' ? 'PU' : 'V'}${links.length + 1}`, from: f, to: t, L: N(e.values.length_m), D: N(e.values.diameter_mm), R: N(e.values.roughness), closed: e.values.status === 'closed', kind: e.type as L['kind'] });
  }
  if (!links.length) throw new Error('No pipes with "from" and "to" junctions among the items. Pipe schedules (from, to, length, diameter) or a plan read by the AI are needed.');
  // positions: coordinates; else page positions scaled by the written lengths; else a layout from the connections
  const withXY = [...js.values()].filter((j) => j.x !== undefined);
  const onPage = [...js.values()].filter((j) => j.x === undefined && j.px !== undefined);
  if (onPage.length) {
    const ratios: number[] = [];
    for (const l of links) { const a = js.get(l.from)!, b = js.get(l.to)!; if (a.px !== undefined && b.px !== undefined && a.page === b.page && Number.isFinite(l.L!)) { const dd = Math.hypot(a.px - b.px!, a.py! - b.py!); if (dd > 1e-4) ratios.push(l.L! / dd); } }
    ratios.sort((p1, p2) => p1 - p2);
    const k = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 1000;
    for (const j of onPage) { j.x = j.px! * k; j.y = -j.py! * k; }
    notes.push(ratios.length ? `Positions from the page, scaled by the pipe lengths written (1 page width ≈ ${k.toFixed(0)} m)` : 'Positions from the page (no lengths written: 1 page width taken as 1000 m)');
  }
  const unplaced = [...js.values()].filter((j) => j.x === undefined);
  if (unplaced.length) {
    // breadth-first rings from the first source
    const adj = new Map<string, string[]>();
    for (const l of links) { adj.set(l.from, [...(adj.get(l.from) ?? []), l.to]); adj.set(l.to, [...(adj.get(l.to) ?? []), l.from]); }
    const start = [...js.values()].find((j) => j.kind === 'reservoir')?.id ?? links[0].from;
    const level = new Map([[start, 0]]), q = [start];
    while (q.length) { const v = q.shift()!; for (const w of adj.get(v) ?? []) if (!level.has(w)) { level.set(w, level.get(v)! + 1); q.push(w); } }
    const rows = new Map<number, number>();
    for (const j of unplaced) { const lv = level.get(j.id) ?? 0; const r = rows.get(lv) ?? 0; rows.set(lv, r + 1); j.x = lv * 200; j.y = r * 120; }
    notes.push(`${unplaced.length} junction(s) without a position laid out from the connections`);
  }
  if (withXY.length) notes.push(`${withXY.length} junction(s) placed by their coordinates`);
  const nodes: NetNode[] = [...js.values()].map((j) => ({ id: j.id, kind: j.kind, x: j.x!, y: j.y!, elev: j.z ?? 0, ...(j.kind === 'reservoir' ? { head: j.head ?? (j.z ?? 0) + 3 } : {}), ...(j.demand ? { demand: j.demand / 1000 } : {}) }));
  const noZ = nodes.filter((n) => !Number.isFinite(js.get(n.id)!.z ?? NaN)).length;
  if (noZ) notes.push(`${noZ} junction(s) without a level are at 0 m: add the levels before trusting the pressures`);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // roughness written in the schedule: Hazen–Williams C (values above 20) or Darcy–Weisbach ε in mm
  const rs = links.filter((l) => l.kind === 'pipe' && Number.isFinite(l.R!)).map((l) => l.R!);
  const hw = rs.length > 0 && rs.filter((r) => r > 20).length > rs.length / 2;
  if (rs.length) notes.push(hw ? 'Roughness from the schedule as Hazen–Williams C' : 'Roughness from the schedule as Darcy–Weisbach ε (mm)');
  let net: Network = { name, nodes, pipes: [], pumps: [], valves: [], event: { kind: 'none', targets: [], start: 1 }, settings: { ...defaultSettings(), friction: hw ? 'HW' : 'DW' } };
  let lenFromDrawing = 0;
  for (const l of links) {
    if (l.kind === 'pipe') {
      const a = byId.get(l.from)!, b = byId.get(l.to)!;
      let len = l.L!;
      if (!Number.isFinite(len)) { len = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)); lenFromDrawing++; }
      const D = Number.isFinite(l.D!) ? (l.D! < 5 ? l.D! * 1000 : l.D!) : o.diameterMm;
      net = { ...net, pipes: [...net.pipes, { id: l.id, from: l.from, to: l.to, length: Math.round(len * 100) / 100, diameter: D / 1000, roughness: Number.isFinite(l.R!) && (hw ? l.R! > 20 : l.R! <= 20) ? l.R! : hw ? mat.hwC : mat.roughness, wavespeed: wizardWaveSpeed(mat.id, D), pressureClass: o.classM, material: mat.name, ...(l.closed ? { closed: true } : {}) }] };
    } else {
      const rr = addLink(net, l.kind === 'pump' ? 'pump' : l.kind === 'checkValve' ? 'nrv' : 'lineValve', l.from, l.to);
      net = rr.net;
      // keep the schedule's name
      if (l.id && !net.pumps.some((x) => x.id === l.id) && !net.valves.some((x) => x.id === l.id)) net = { ...net, pumps: net.pumps.map((x) => (x.id === rr.id ? { ...x, id: l.id } : x)), valves: net.valves.map((x) => (x.id === rr.id ? { ...x, id: l.id } : x)) };
    }
  }
  if (lenFromDrawing) notes.push(`${lenFromDrawing} pipe length(s) measured on the drawing (not written)`);
  const dg = new Map<string, number>();
  for (const l of [...net.pipes, ...net.pumps, ...net.valves]) { dg.set(l.from, (dg.get(l.from) ?? 0) + 1); dg.set(l.to, (dg.get(l.to) ?? 0) + 1); }
  const ends = net.nodes.filter((n) => (dg.get(n.id) ?? 0) === 1 || n.kind === 'reservoir').map((n) => n.id);
  notes.unshift(`${net.nodes.length} junctions, ${net.pipes.length} pipes, ${net.pumps.length} pumps, ${net.valves.length} valves from the schedules`);
  return { net, notes, ends, placed: [] };
}
