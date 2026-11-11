// Exchange with GIS and CAD: GeoJSON (QGIS, ArcGIS Pro, any GIS) and DXF (AutoCAD, MicroStation, BricsCAD,
// QGIS). Network geometry, attributes and surge results go out; GeoJSON networks come in with field mapping
// and snapping of pipe ends to nodes. Model coordinates are the map's projected coordinates (metres).
import type { TransientResult } from '../engine/transient';
import type { EPSResult } from '../engine/eps';
import { defaultSettings, type Network, type NetNode, type Pipe } from '../engine/types';

export interface GeoJSON { type: 'FeatureCollection'; crs?: unknown; features: { type: 'Feature'; geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> }[] }
const r3 = (x: number | undefined) => (x === undefined || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const devicesOf = (n: NetNode) => [n.vessel && 'air vessel', n.airValve && 'air valve', n.tank && (n.tank.oneWay ? 'feed tank' : 'standpipe'), n.relief && 'relief valve', n.sav && 'anticipator', n.outlet && 'outlet', n.storage && 'storage tank'].filter(Boolean).join(', ');

/** Network (and results, if given) as GeoJSON. `epsg` adds the coordinate system name (e.g. 32637 for UTM 37N). */
export function toGeoJSON(net: Network, result?: TransientResult | null, eps?: EPSResult | null, epsg?: number): GeoJSON {
  const env = new Map((result?.envelopes ?? []).map((e) => [e.id, e]));
  const features: GeoJSON['features'] = [];
  for (const n of net.nodes) {
    const p: Record<string, unknown> = {
      id: n.id, layer: 'nodes', kind: n.kind === 'reservoir' ? (n.storage ? 'tank' : 'source') : 'junction', label: n.label ?? null,
      elevation_m: r3(n.elev), demand_lps: n.kind === 'junction' ? r3((n.demand ?? 0) * 1000) : null, water_level_m: n.kind === 'reservoir' ? r3(n.head) : null, devices: devicesOf(n) || null,
    };
    if (result?.nodeMax[n.id] !== undefined) Object.assign(p, { steady_pressure_m: r3((result.steady.heads[n.id] ?? NaN) - n.elev), max_pressure_m: r3(result.nodeMax[n.id] - n.elev), min_pressure_m: r3(result.nodeMin[n.id] - n.elev) });
    if (eps?.pressure[n.id]) Object.assign(p, { eps_min_pressure_m: r3(Math.min(...eps.pressure[n.id])), eps_max_pressure_m: r3(Math.max(...eps.pressure[n.id])), ...(eps.quality?.[n.id] ? { eps_max_quality: r3(Math.max(...eps.quality[n.id])), quality_unit: eps.qualityUnit } : {}) });
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [n.x, n.y] }, properties: p });
  }
  const xy = new Map(net.nodes.map((n) => [n.id, [n.x, n.y]]));
  for (const p of net.pipes) {
    const coords = [xy.get(p.from)!, ...(p.vertices ?? []).map((v) => [v.x, v.y]), xy.get(p.to)!];
    const e = env.get(p.id);
    const props: Record<string, unknown> = {
      id: p.id, layer: 'pipes', from_node: p.from, to_node: p.to, length_m: r3(p.length), diameter_mm: r3(p.diameter * 1000), roughness: p.roughness, wavespeed_mps: p.wavespeed,
      material: p.material ?? null, pressure_class_m: p.pressureClass ?? null, closed: !!p.closed, check_valve: !!p.checkValve,
    };
    if (e) {
      let mx = -Infinity, mn = Infinity, cav = 0;
      for (let i = 0; i < e.s.length; i++) { mx = Math.max(mx, e.hMax[i] - e.z[i]); mn = Math.min(mn, e.hMin[i] - e.z[i]); cav = Math.max(cav, e.cavMax[i]); }
      Object.assign(props, { max_pressure_m: r3(mx), min_pressure_m: r3(mn), vapour_cavity_l: r3(cav * 1000), steady_flow_lps: r3((result!.steady.flows[p.id] ?? 0) * 1000), over_class: p.pressureClass ? mx > p.pressureClass : null });
    }
    features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: props });
  }
  for (const k of [...net.pumps, ...net.valves]) {
    const a = xy.get(k.from)!, b = xy.get(k.to)!;
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }, properties: { id: k.id, layer: 'pumps' in k ? 'pumps' : 'valves', kind: 'curve' in k ? 'pump' : (k as Network['valves'][number]).control?.type ?? ((k as Network['valves'][number]).check ? 'non-return valve' : 'valve'), from_node: k.from, to_node: k.to } });
  }
  return { type: 'FeatureCollection', ...(epsg ? { crs: { type: 'name', properties: { name: `urn:ogc:def:crs:EPSG::${epsg}` } } } : {}), features };
}

export interface FieldMap { id?: string; elevation?: string; demand?: string; diameter?: string; roughness?: string; material?: string; length?: string; wavespeed?: string; pressureClass?: string; demandScale?: number; diameterScale?: number }
const guess = (keys: string[], ...names: string[]) => keys.find((k) => names.some((n) => k.toLowerCase().replace(/[^a-z]/g, '') === n)) ?? keys.find((k) => names.some((n) => k.toLowerCase().includes(n)));

/** Field names guessed from the first features (the user confirms or changes them). */
export function guessFields(g: GeoJSON): FieldMap {
  const pk = Object.keys(g.features.find((f) => f.geometry?.type.includes('Point'))?.properties ?? {});
  const lk = Object.keys(g.features.find((f) => f.geometry?.type.includes('LineString'))?.properties ?? {});
  return {
    id: guess([...pk, ...lk], 'id', 'facilityid', 'assetid', 'name', 'fid'),
    elevation: guess(pk, 'elevation', 'elevationm', 'elev', 'z', 'groundlevel', 'invert'),
    demand: guess(pk, 'demandlps', 'demand', 'baseflow'),
    diameter: guess(lk, 'diametermm', 'diameter', 'dia', 'dn', 'size'),
    roughness: guess(lk, 'roughness', 'cfactor', 'hwc', 'rough'),
    material: guess(lk, 'material', 'mat', 'pipematerial'),
    length: guess(lk, 'lengthm', 'length', 'shapelength'),
    wavespeed: guess(lk, 'wavespeedmps', 'wavespeed', 'celerity'),
    pressureClass: guess(lk, 'pressureclassm', 'pressureclass', 'pn', 'rating'),
  };
}

/** Build a network from GeoJSON points (nodes) and lines (pipes). Pipe ends snap to the nearest node within `tol`
 *  (m); otherwise a junction is created there. Z of 3-D coordinates is used when no elevation field is mapped. */
export function fromGeoJSON(g: GeoJSON, f: FieldMap = guessFields(g), tol = 0.5): { network: Network; notes: string[] } {
  const notes: string[] = [];
  const nodes: NetNode[] = [];
  const num = (v: unknown, d = 0) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
  const flat = (geom: { type: string; coordinates: unknown }) => (geom.type.startsWith('Multi') ? (geom.coordinates as unknown[]) : [geom.coordinates]);
  let auto = 0;
  for (const ft of g.features) {
    if (!ft.geometry || !ft.geometry.type.includes('Point')) continue;
    if (ft.properties.layer === 'pumps' || ft.properties.layer === 'valves') continue; // SurgeSpace link markers
    for (const c of flat(ft.geometry) as number[][]) {
      const id = String(ft.properties[f.id ?? ''] ?? `N${++auto}`);
      const kind = String(ft.properties.kind ?? ft.properties.type ?? '').toLowerCase();
      const elev = f.elevation ? num(ft.properties[f.elevation], c[2] ?? 0) : c[2] ?? 0;
      if (nodes.some((n) => n.id === id)) continue;
      const isRes = /reservoir|source|tank/.test(kind);
      nodes.push({ id, kind: isRes ? 'reservoir' : 'junction', x: c[0], y: c[1], elev, ...(isRes ? { head: num(ft.properties.water_level_m ?? ft.properties.head, elev + 5) } : { demand: f.demand ? num(ft.properties[f.demand]) * (f.demandScale ?? 1e-3) : 0 }) });
    }
  }
  const findNode = (x: number, y: number, z?: number) => {
    let best: NetNode | null = null, bd = tol;
    for (const n of nodes) { const d = Math.hypot(n.x - x, n.y - y); if (d <= bd) { bd = d; best = n; } }
    if (best) return best;
    const n: NetNode = { id: `J${++auto}`, kind: 'junction', x, y, elev: z ?? 0, demand: 0 };
    nodes.push(n);
    return n;
  };
  const pipes: Pipe[] = [];
  let pid = 0, created = nodes.length;
  for (const ft of g.features) {
    if (!ft.geometry || !ft.geometry.type.includes('LineString')) continue;
    for (const line of flat(ft.geometry) as number[][][]) {
      if (line.length < 2) continue;
      const a = findNode(line[0][0], line[0][1], line[0][2]), b = findNode(line[line.length - 1][0], line[line.length - 1][1], line[line.length - 1][2]);
      if (a === b) continue;
      let L = 0;
      for (let i = 1; i < line.length; i++) L += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
      const base = String(ft.properties[f.id ?? ''] ?? `P${++pid}`);
      const id = pipes.some((p) => p.id === base) ? `${base}_${++pid}` : base;
      pipes.push({
        id, from: a.id, to: b.id,
        length: f.length ? num(ft.properties[f.length], L) || L : L,
        diameter: (f.diameter ? num(ft.properties[f.diameter], 300) : 300) * (f.diameterScale ?? 1e-3),
        roughness: f.roughness ? num(ft.properties[f.roughness], 0.1) : 0.1,
        wavespeed: f.wavespeed ? num(ft.properties[f.wavespeed], 1000) : 1000,
        ...(f.material && ft.properties[f.material] ? { material: String(ft.properties[f.material]) } : {}),
        ...(f.pressureClass && ft.properties[f.pressureClass] !== undefined ? { pressureClass: num(ft.properties[f.pressureClass]) } : {}),
        ...(line.length > 2 ? { vertices: line.slice(1, -1).map((c) => ({ x: c[0], y: c[1] })) } : {}),
        ...(line.some((c) => c.length > 2) && line.length > 2 ? { profile: line.slice(1, -1).map((c, i) => ({ s: line.slice(0, i + 2).reduce((s, q, k) => (k ? s + Math.hypot(q[0] - line[k - 1][0], q[1] - line[k - 1][1]) : 0), 0), z: c[2] ?? 0 })) } : {}),
      });
    }
  }
  created = nodes.length - created;
  const used = new Set(pipes.flatMap((p) => [p.from, p.to]));
  const lone = nodes.filter((n) => !used.has(n.id));
  if (lone.length) notes.push(`${lone.length} points touch no pipe and were left out (${lone.slice(0, 5).map((n) => n.id).join(', ')}${lone.length > 5 ? '…' : ''}).`);
  for (const n of lone) nodes.splice(nodes.indexOf(n), 1);
  if (created) notes.push(`${created} junctions were created where pipe ends met no node (within ${tol} m).`);
  if (!f.wavespeed) notes.push('Wave speeds were set to 1000 m/s; set them by material.');
  if (!nodes.some((n) => n.kind === 'reservoir')) notes.push('No source was found (a point with kind "source", "reservoir" or "tank"): set one before running.');
  return { network: { name: 'GIS import', nodes, pipes, pumps: [], valves: [], event: { kind: 'none', targets: [], start: 1 }, settings: defaultSettings() }, notes };
}

/** DXF (R12, readable by every CAD program): pipes, nodes, labels, devices and result text on separate layers. */
export function toDXF(net: Network, result?: TransientResult | null, textHeight = 2): string {
  const L: string[] = [];
  const add = (...a: (string | number)[]) => { for (const x of a) L.push(String(x)); };
  add(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 0, 'ENDSEC');
  const layers: [string, number][] = [['SS_PIPES', 5], ['SS_NODES', 7], ['SS_SOURCES', 4], ['SS_DEVICES', 1], ['SS_PUMPS_VALVES', 6], ['SS_LABELS', 8], ['SS_RESULTS', 3], ['SS_OVER_CLASS', 1]];
  add(0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LAYER', 70, layers.length);
  for (const [n, c] of layers) add(0, 'LAYER', 2, n, 70, 0, 62, c, 6, 'CONTINUOUS');
  add(0, 'ENDTAB', 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES');
  const xy = new Map(net.nodes.map((n) => [n.id, n]));
  const text = (layer: string, x: number, y: number, s: string, h = textHeight) => add(0, 'TEXT', 8, layer, 10, x, 20, y, 30, 0, 40, h, 1, s.replace(/[\r\n]/g, ' '));
  const env = new Map((result?.envelopes ?? []).map((e) => [e.id, e]));
  for (const p of net.pipes) {
    const a = xy.get(p.from)!, b = xy.get(p.to)!;
    const pts = [[a.x, a.y], ...(p.vertices ?? []).map((v) => [v.x, v.y]), [b.x, b.y]];
    const e = env.get(p.id);
    let mx = -Infinity, mn = Infinity;
    if (e) for (let i = 0; i < e.s.length; i++) { mx = Math.max(mx, e.hMax[i] - e.z[i]); mn = Math.min(mn, e.hMin[i] - e.z[i]); }
    const over = e && p.pressureClass && mx > p.pressureClass;
    add(0, 'POLYLINE', 8, over ? 'SS_OVER_CLASS' : 'SS_PIPES', 66, 1, 70, 0);
    for (const [x, y] of pts) add(0, 'VERTEX', 8, over ? 'SS_OVER_CLASS' : 'SS_PIPES', 10, x, 20, y, 30, 0);
    add(0, 'SEQEND');
    const m = pts[Math.floor(pts.length / 2) - (pts.length % 2 ? 0 : 1)], m2 = pts[Math.floor(pts.length / 2)];
    const cx = (m[0] + m2[0]) / 2, cy = (m[1] + m2[1]) / 2;
    text('SS_LABELS', cx, cy + textHeight * 0.6, `${p.id} DN${Math.round(p.diameter * 1000)} L=${p.length.toFixed(0)}`);
    if (e) text('SS_RESULTS', cx, cy - textHeight * 1.4, `Pmax ${mx.toFixed(1)} m  Pmin ${mn.toFixed(1)} m`);
  }
  for (const n of net.nodes) {
    add(0, 'CIRCLE', 8, n.kind === 'reservoir' ? 'SS_SOURCES' : devicesOf(n) ? 'SS_DEVICES' : 'SS_NODES', 10, n.x, 20, n.y, 30, 0, 40, textHeight * (n.kind === 'reservoir' ? 1.2 : 0.5));
    text('SS_LABELS', n.x + textHeight, n.y + textHeight, `${n.id} z=${n.elev.toFixed(2)}${devicesOf(n) ? ` [${devicesOf(n)}]` : ''}`);
    if (result?.nodeMax[n.id] !== undefined) text('SS_RESULTS', n.x + textHeight, n.y - textHeight * 1.2, `max ${(result.nodeMax[n.id] - n.elev).toFixed(1)} / min ${(result.nodeMin[n.id] - n.elev).toFixed(1)} m`);
  }
  for (const k of [...net.pumps, ...net.valves]) {
    const a = xy.get(k.from)!, b = xy.get(k.to)!;
    add(0, 'LINE', 8, 'SS_PUMPS_VALVES', 10, a.x, 20, a.y, 30, 0, 11, b.x, 21, b.y, 31, 0);
    text('SS_PUMPS_VALVES', (a.x + b.x) / 2, (a.y + b.y) / 2 + textHeight, k.id);
  }
  add(0, 'ENDSEC', 0, 'EOF');
  return L.join('\n');
}
