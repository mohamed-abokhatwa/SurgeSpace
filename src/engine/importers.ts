// Input methods besides EPANET: spreadsheets (paste or CSV), long-section profiles, and DXF drawings.
import { defaultSettings, type Network, type NetNode, type Pipe } from './types';

/** Split pasted Excel (tab-separated) or CSV text into rows of cells. */
export function parseTable(text: string): string[][] {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (!lines.length) return [];
  const tab = lines[0].includes('\t');
  const semi = !tab && (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0);
  const sep = tab ? '\t' : semi ? ';' : ',';
  return lines.map((l) => {
    if (sep !== ',') return l.split(sep).map((c) => c.trim());
    const out: string[] = [];
    let cur = '', q = false;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  });
}

const num = (s: string | undefined) => {
  if (s === undefined || s === '') return NaN;
  return Number(String(s).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/,(?=\d{3}\b)/g, '').replace(',', '.'));
};

/** Find a column by any of several header names (case-insensitive, ignores units in brackets). */
function col(header: string[], ...names: string[]) {
  const h = header.map((c) => c.toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9]/g, ''));
  for (const n of names) {
    const i = h.indexOf(n.replace(/[^a-z0-9]/g, ''));
    if (i >= 0) return i;
  }
  return -1;
}

export interface TableImport {
  nodes: NetNode[];
  pipes: Pipe[];
  notes: string[];
}

/**
 * Nodes table: id, x, y, elevation [, demand L/s] [, type: junction|reservoir] [, head]
 * Pipes table: id, from, to, length m, diameter mm [, roughness mm] [, wave speed m/s] [, class m]
 * Headers are matched by name; units in brackets are ignored. Diameter in mm, demand in L/s.
 */
export function importTables(nodesText: string, pipesText: string): TableImport {
  const notes: string[] = [];
  const nodes: NetNode[] = [];
  const pipes: Pipe[] = [];
  const nt = parseTable(nodesText);
  if (nt.length > 1) {
    const h = nt[0];
    const ci = col(h, 'id', 'node', 'name', 'nodeid');
    const cx = col(h, 'x', 'easting', 'e');
    const cy = col(h, 'y', 'northing', 'n');
    const cz = col(h, 'elevation', 'elev', 'level', 'z', 'groundlevel', 'il', 'invertlevel');
    const cd = col(h, 'demand', 'flow', 'q');
    const ct = col(h, 'type', 'kind');
    const chd = col(h, 'head', 'waterlevel', 'twl', 'hgl');
    if (ci < 0 || cz < 0) throw new Error('Nodes table needs at least "id" and "elevation" columns.');
    for (const r of nt.slice(1)) {
      if (!r[ci]) continue;
      const type = (r[ct] ?? '').toLowerCase();
      const res = type.startsWith('res') || type.startsWith('tank');
      const elev = num(r[cz]);
      nodes.push({
        id: r[ci], kind: res ? 'reservoir' : 'junction', x: num(r[cx]) || 0, y: num(r[cy]) || 0, elev,
        ...(res ? { head: Number.isFinite(num(r[chd])) ? num(r[chd]) : elev } : { demand: (num(r[cd]) || 0) / 1000 }),
      });
    }
  }
  const pt = parseTable(pipesText);
  if (pt.length > 1) {
    const h = pt[0];
    const ci = col(h, 'id', 'pipe', 'name', 'pipeid');
    const cf = col(h, 'from', 'start', 'node1', 'fromnode', 'upstream');
    const cto = col(h, 'to', 'end', 'node2', 'tonode', 'downstream');
    const cl = col(h, 'length', 'len', 'l');
    const cdia = col(h, 'diameter', 'dia', 'd', 'dn', 'id(mm)');
    const cr = col(h, 'roughness', 'rough', 'ks', 'epsilon', 'c');
    const ca = col(h, 'wavespeed', 'celerity', 'a', 'wave');
    const cc = col(h, 'class', 'pressureclass', 'pn', 'rating');
    if (cf < 0 || cto < 0 || cdia < 0) throw new Error('Pipes table needs "from", "to" and "diameter" columns.');
    pt.slice(1).forEach((r, k) => {
      if (!r[cf] || !r[cto]) return;
      let L = num(r[cl]);
      if (!Number.isFinite(L)) {
        const a = nodes.find((n) => n.id === r[cf]), b = nodes.find((n) => n.id === r[cto]);
        L = a && b ? Math.hypot(a.x - b.x, a.y - b.y) : NaN;
        if (Number.isFinite(L)) notes.push(`Pipe ${r[ci] || k + 1}: length taken from coordinates (${L.toFixed(1)} m).`);
      }
      const cls = num(r[cc]);
      pipes.push({
        id: r[ci] || `P${k + 1}`, from: r[cf], to: r[cto], length: L, diameter: num(r[cdia]) / 1000,
        roughness: Number.isFinite(num(r[cr])) ? num(r[cr]) : 0.1, wavespeed: Number.isFinite(num(r[ca])) ? num(r[ca]) : 1000,
        ...(Number.isFinite(cls) ? { pressureClass: cls > 0 && cls < 60 ? cls * 10.2 : cls } : {}),
      });
    });
    if (cc >= 0) notes.push('Pressure class values below 60 were read as bar (PN) and converted to metres of head.');
    if (ca < 0) notes.push('No wave speed column: 1000 m/s used for all pipes.');
  }
  return { nodes, pipes, notes };
}

export interface ProfileInput {
  /** Rows of chainage (m), ground or pipe level (m) [, diameter mm]. */
  rows: [number, number, number?][];
  diameter: number; // m, default when a row has none
  wavespeed: number;
  roughness: number;
  pressureClass: number;
  upstream: 'pump' | 'reservoir';
  upstreamLevel: number; // reservoir/sump water level
  downstreamLevel: number; // delivery water level
  flow: number; // m³/s design flow (pump sizing)
  pumps: number;
}

/** Build a pipeline project from a long-section: nodes at every break point, air valves at high points. */
export function buildFromProfile(inp: ProfileInput): { network: Network; notes: string[] } {
  const notes: string[] = [];
  const rows = [...inp.rows].filter((r) => Number.isFinite(r[0]) && Number.isFinite(r[1])).sort((a, b) => a[0] - b[0]);
  if (rows.length < 2) throw new Error('The profile needs at least two rows of chainage and level.');
  // keep significant points: ends, local highs/lows, and grade breaks; others become profile points inside pipes
  const keep = new Set<number>([0, rows.length - 1]);
  for (let i = 1; i < rows.length - 1; i++) {
    const s1 = (rows[i][1] - rows[i - 1][1]) / Math.max(rows[i][0] - rows[i - 1][0], 1e-6);
    const s2 = (rows[i + 1][1] - rows[i][1]) / Math.max(rows[i + 1][0] - rows[i][0], 1e-6);
    if ((s1 > 0 && s2 <= 0) || (s1 < 0 && s2 >= 0)) keep.add(i); // high or low point
    if (rows[i][2] !== undefined && rows[i][2] !== rows[i - 1][2]) keep.add(i);
  }
  const idx = [...keep].sort((a, b) => a - b);
  const total = rows[rows.length - 1][0] - rows[0][0];
  const nodes: NetNode[] = [];
  const pipes: Pipe[] = [];
  const W = 900, Hgt = 260;
  const zMin = Math.min(...rows.map((r) => r[1])), zMax = Math.max(...rows.map((r) => r[1]));
  const xy = (ch: number, z: number) => ({ x: 60 + ((ch - rows[0][0]) / total) * W, y: 40 + ((z - zMin) / Math.max(zMax - zMin, 1)) * Hgt });
  const nodeId = (k: number) => (k === 0 ? 'START' : k === idx.length - 1 ? 'END' : `CH${Math.round(rows[idx[k]][0])}`);
  idx.forEach((ri, k) => {
    const [ch, z] = rows[ri];
    const isHigh = k > 0 && k < idx.length - 1 && rows[idx[k - 1]][1] < z && rows[idx[k + 1]][1] < z;
    nodes.push({ id: nodeId(k), kind: 'junction', ...xy(ch, z), elev: z, ...(isHigh ? { airValve: { inDiameter: 0.1, outDiameter: 0.025 } } : {}) });
    if (isHigh) notes.push(`High point at chainage ${ch} m: air valve DN100 added (size it with Protection → Air valves).`);
  });
  for (let k = 0; k < idx.length - 1; k++) {
    const a = idx[k], b = idx[k + 1];
    const profile = rows.slice(a + 1, b).map((r) => ({ s: r[0] - rows[a][0], z: r[1] }));
    pipes.push({
      id: `L${k + 1}`, from: nodeId(k), to: nodeId(k + 1), length: rows[b][0] - rows[a][0],
      diameter: rows[a][2] !== undefined ? (rows[a][2] as number) / 1000 : inp.diameter, roughness: inp.roughness, wavespeed: inp.wavespeed,
      pressureClass: inp.pressureClass, ...(profile.length ? { profile } : {}),
    });
  }
  // upstream source and downstream delivery
  const start = nodes[0], end = nodes[nodes.length - 1];
  const net: Network = {
    name: 'Pipeline from long-section',
    description: `Built from a ${rows.length}-point long-section, ${(total / 1000).toFixed(2)} km.`,
    nodes, pipes, pumps: [], valves: [],
    event: { kind: 'none', targets: [], start: 1 },
    settings: { ...defaultSettings() },
  };
  net.nodes.push({ id: 'DELIVERY', kind: 'reservoir', x: end.x + 50, y: end.y, elev: end.elev, head: inp.downstreamLevel });
  net.pipes.push({ id: 'OUTLET', from: end.id, to: 'DELIVERY', length: 10, diameter: pipes[pipes.length - 1].diameter, roughness: inp.roughness, wavespeed: inp.wavespeed, pressureClass: inp.pressureClass });
  if (inp.upstream === 'reservoir') {
    net.nodes.push({ id: 'SOURCE', kind: 'reservoir', x: start.x - 50, y: start.y, elev: start.elev, head: inp.upstreamLevel });
    net.pipes.push({ id: 'INLET', from: 'SOURCE', to: start.id, length: 10, diameter: pipes[0].diameter, roughness: inp.roughness, wavespeed: inp.wavespeed, pressureClass: inp.pressureClass });
  } else {
    const n = Math.max(1, Math.round(inp.pumps));
    const qEach = inp.flow / n;
    const A = Math.PI / 4 * pipes[0].diameter ** 2;
    const v = inp.flow / A;
    const hf = pipes.reduce((s, p) => s + 0.018 * (p.length / p.diameter) * (v * v) / 19.6, 0);
    const hDuty = inp.downstreamLevel - inp.upstreamLevel + hf * 1.1 + 2;
    net.nodes.push({ id: 'SUMP', kind: 'reservoir', x: start.x - 110, y: start.y, elev: inp.upstreamLevel - 3, head: inp.upstreamLevel });
    net.nodes.push({ id: 'PS-S', kind: 'junction', x: start.x - 60, y: start.y, elev: start.elev });
    net.pipes.push({ id: 'SUCTION', from: 'SUMP', to: 'PS-S', length: 10, diameter: pipes[0].diameter * 1.2, roughness: inp.roughness, wavespeed: inp.wavespeed, pressureClass: inp.pressureClass });
    for (let k = 1; k <= n; k++)
      net.pumps.push({ id: `PU${k}`, from: 'PS-S', to: start.id, curve: [[0, hDuty * 1.3], [qEach, hDuty], [qEach * 1.5, hDuty * 0.7]], efficiency: 0.82, speed: 1480, inertia: 1, checkValve: true, on: true });
    net.event = { kind: 'pumpTrip', targets: net.pumps.map((p) => p.id), start: 1 };
    notes.push(`${n} pump(s) of ${(qEach * 1000).toFixed(0)} L/s at ${hDuty.toFixed(1)} m were sized from the profile (estimate); enter the real curve and inertia.`);
  }
  return { network: net, notes };
}

/**
 * DXF import: LINE, LWPOLYLINE and POLYLINE entities become pipes; vertices become nodes (merged within
 * `tol` drawing units). Levels come from vertex Z, or from the polyline elevation; drawing units × `scale` = m.
 */
export function importDxf(text: string, opts: { tol: number; scale: number; diameter: number; wavespeed: number; layerFilter?: string }): TableImport {
  const notes: string[] = [];
  const lines = text.replace(/\r/g, '').split('\n');
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([Number(lines[i].trim()), lines[i + 1].trim()]);
  type Poly = { layer: string; pts: [number, number, number][] };
  const polys: Poly[] = [];
  let inEntities = false;
  for (let i = 0; i < pairs.length; i++) {
    const [c, v] = pairs[i];
    if (c === 2 && v === 'ENTITIES') inEntities = true;
    if (c === 0 && v === 'ENDSEC') inEntities = false;
    if (!inEntities || c !== 0) continue;
    if (v === 'LINE') {
      const e: Record<number, string> = {};
      let j = i + 1;
      for (; j < pairs.length && pairs[j][0] !== 0; j++) e[pairs[j][0]] = pairs[j][1];
      polys.push({ layer: e[8] ?? '0', pts: [[+e[10], +e[20], +(e[30] ?? 0)], [+e[11], +e[21], +(e[31] ?? 0)]] });
    } else if (v === 'LWPOLYLINE') {
      let layer = '0', elev = 0;
      const pts: [number, number, number][] = [];
      let j = i + 1;
      for (; j < pairs.length && pairs[j][0] !== 0; j++) {
        const [cc, vv] = pairs[j];
        if (cc === 8) layer = vv;
        if (cc === 38) elev = +vv;
        if (cc === 10) pts.push([+vv, 0, elev]);
        if (cc === 20 && pts.length) pts[pts.length - 1][1] = +vv;
      }
      pts.forEach((p) => (p[2] = elev));
      polys.push({ layer, pts });
    } else if (v === 'POLYLINE') {
      let layer = '0';
      const pts: [number, number, number][] = [];
      let j = i + 1;
      for (; j < pairs.length && pairs[j][0] !== 0; j++) if (pairs[j][0] === 8) layer = pairs[j][1];
      while (j < pairs.length && pairs[j][1] === 'VERTEX') {
        const e: Record<number, string> = {};
        let k = j + 1;
        for (; k < pairs.length && pairs[k][0] !== 0; k++) e[pairs[k][0]] = pairs[k][1];
        pts.push([+e[10], +e[20], +(e[30] ?? 0)]);
        j = k;
      }
      polys.push({ layer, pts });
    }
  }
  const filtered = opts.layerFilter ? polys.filter((p) => p.layer.toLowerCase().includes(opts.layerFilter!.toLowerCase())) : polys;
  if (!filtered.length) throw new Error('No LINE or POLYLINE entities found' + (opts.layerFilter ? ` on layers matching "${opts.layerFilter}".` : '.'));
  const nodes: NetNode[] = [];
  const pipes: Pipe[] = [];
  const findNode = (x: number, y: number, z: number) => {
    let n = nodes.find((m) => Math.hypot(m.x - x * opts.scale, m.y - y * opts.scale) <= opts.tol * opts.scale);
    if (!n) {
      n = { id: `N${nodes.length + 1}`, kind: 'junction', x: x * opts.scale, y: y * opts.scale, elev: z * opts.scale };
      nodes.push(n);
    }
    return n;
  };
  for (const p of filtered)
    for (let k = 0; k + 1 < p.pts.length; k++) {
      const a = findNode(...p.pts[k]), b = findNode(...p.pts[k + 1]);
      if (a === b) continue;
      pipes.push({ id: `P${pipes.length + 1}`, from: a.id, to: b.id, length: Math.hypot(a.x - b.x, a.y - b.y, a.elev - b.elev), diameter: opts.diameter, roughness: 0.1, wavespeed: opts.wavespeed });
    }
  const layers = [...new Set(filtered.map((p) => p.layer))];
  notes.push(`Read ${filtered.length} drawing entities on layer(s) ${layers.join(', ')}: ${nodes.length} nodes, ${pipes.length} pipes.`);
  if (nodes.every((n) => n.elev === 0)) notes.push('The drawing has no levels (Z = 0). Enter node elevations in the Nodes table or paste them from a spreadsheet.');
  notes.push('Set one node as a reservoir (or add a pump station) before running.');
  return { nodes, pipes, notes };
}
