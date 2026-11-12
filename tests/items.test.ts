// Network from schedules: EPANET Net3 (97 junctions, 117 pipes, 2 pumps, 3 tanks, 2 reservoirs) written out as
// the node and link schedules an engineer keeps in Excel, read back by the header rules (no AI), built, and solved
// against the original network. Also a scanned plan as the AI records it: junctions by their place on the page and
// pipes by the junctions they join, scaled by the lengths written.
import { readFileSync } from 'node:fs';
import { sheetEvidence, type Evidence, type IntakeDoc } from '../src/app/intake';
import { networkFromItems } from '../src/app/planNetwork';
import { parseInp } from '../src/engine/inp';
import { solveSteady } from '../src/engine/steady';
import type { Network } from '../src/engine/types';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };

const net3 = parseInp(readFileSync(new URL('../validation/data/Net3.inp', import.meta.url), 'utf8'), 'Net3').network;
const truth: Network = { ...net3, patterns: undefined, controls: undefined, rules: undefined, eps: undefined, nodes: net3.nodes.map((n) => ({ ...n, pattern: undefined, storage: undefined, head: n.kind === 'reservoir' ? (n.storage ? n.elev + (n.storage.initLevel ?? 0) : n.head) : undefined })) };
const r2 = (v: number) => Math.round(v * 1000) / 1000;
const nodesSheet = [['Node schedule — Net3'], ['ID', 'Type', 'X', 'Y', 'Elevation (m)', 'Water level (m)', 'Demand (L/s)'],
  ...truth.nodes.map((n) => [n.id, n.kind === 'reservoir' ? (net3.nodes.find((x) => x.id === n.id)!.storage ? 'Tank' : 'Reservoir') : 'Junction', n.x, n.y, r2(n.elev), n.kind === 'reservoir' ? r2(n.head!) : null, r2((n.demand ?? 0) * 1000)])];
const linksSheet = [['ID', 'Type', 'From', 'To', 'Length (m)', 'Diameter (mm)', 'Roughness (C)', 'Status'],
  ...truth.pipes.map((p) => [p.id, 'Pipe', p.from, p.to, r2(p.length), r2(p.diameter * 1000), p.roughness, p.closed ? 'Closed' : 'Open']),
  ...truth.pumps.map((p) => [p.id, 'Pump', p.from, p.to, null, null, null]),
  ...truth.valves.map((v) => [v.id, 'Valve', v.from, v.to, null, r2(v.diameter * 1000), null])];
const doc: IntakeDoc = { id: 'x', name: 'Net3 schedules.xlsx', kind: 'sheet', pages: [], sheets: [{ name: 'Nodes', rows: nodesSheet as (string | number | null)[][] }, { name: 'Links', rows: linksSheet as (string | number | null)[][] }] };
const ev = sheetEvidence(doc).map((e) => ({ ...e, status: 'accepted' as const }));
t('node schedule read below its title row (junctions, tanks, reservoirs)', ev.filter((e) => e.type === 'junction').length === truth.nodes.filter((n) => n.kind === 'junction').length && ev.filter((e) => e.type === 'tank').length === 3 && ev.filter((e) => e.type === 'reservoir').length === 2);
t('link schedule read (pipes, pumps by the type column)', ev.filter((e) => e.type === 'pipe').length === truth.pipes.length && ev.filter((e) => e.type === 'pump').length === truth.pumps.length);
const r = networkFromItems(ev, { diameterMm: 300, material: 'di', classM: 160 }, 'Net3 from schedules');
t('network built from the schedules', r.net.nodes.length === truth.nodes.length && r.net.pipes.length === truth.pipes.length && r.net.pumps.length === truth.pumps.length, r.notes.join(' | '));
t('Hazen–Williams C recognised from the roughness column; closed pipes from the status column', r.net.settings.friction === 'HW' && r.net.pipes.every((p) => p.roughness === truth.pipes.find((q) => q.id === p.id)!.roughness) && r.net.pipes.filter((p) => p.closed).map((p) => p.id).join() === '330');
// the pump data sheets: curves as in the network
const built: Network = { ...r.net, pumps: r.net.pumps.map((p) => ({ ...truth.pumps.find((q) => q.id === p.id)!, from: p.from, to: p.to })) };
const s1 = solveSteady(truth), s2 = solveSteady(built);
let dh = 0;
for (const n of truth.nodes) dh = Math.max(dh, Math.abs((s1.heads.get(n.id) ?? 0) - (s2.heads.get(n.id) ?? 0)));
t('heads equal to the original network', dh < 0.01, `largest difference ${dh.toFixed(4)} m`);

// a scanned plan as the AI records it: a small loop, positions on the page, two lengths written
const page = (x: number, y: number): [number, number, number, number] => [x - 0.005, y - 0.005, x + 0.005, y + 0.005];
const ai: Evidence[] = [
  { id: 'a', type: 'reservoir', label: 'R1', values: { name: 'R1', level_m: 80 }, source: { doc: 'scan', page: 1, box: page(0.1, 0.5), how: 'ai' }, confidence: 0.9, status: 'accepted' },
  ...[['J1', 0.3, 0.5, 20], ['J2', 0.6, 0.5, 22], ['J3', 0.6, 0.2, 25], ['J4', 0.3, 0.2, 21]].map(([n, x, y, z]) => ({ id: String(n), type: 'junction' as const, label: String(n), values: { name: String(n), level_m: Number(z), demand_lps: 5 }, source: { doc: 'scan', page: 1, box: page(Number(x), Number(y)), how: 'ai' as const }, confidence: 0.8, status: 'accepted' as const })),
  ...[['R1', 'J1', 300, 400], ['J1', 'J2', 450, 300], ['J2', 'J3', undefined, 200], ['J3', 'J4', undefined, 200], ['J4', 'J1', undefined, 150]].map(([f, to, L, D], i) => ({ id: `p${i}`, type: 'pipe' as const, values: { from: String(f), to: String(to), ...(L ? { length_m: Number(L) } : {}), diameter_mm: Number(D) }, source: { doc: 'scan', page: 1, how: 'ai' as const }, confidence: 0.8, status: 'accepted' as const })),
];
const rs = networkFromItems(ai, { diameterMm: 150, material: 'di', classM: 160 });
const P = (a: string, b: string) => rs.net.pipes.find((p) => p.from === a && p.to === b)!;
t('scanned plan: lengths written are used, the others measured on the page at the scale they give', P('R1', 'J1').length === 300 && P('J1', 'J2').length === 450 && Math.abs(P('J2', 'J3').length - 450) < 1 && Math.abs(P('J4', 'J1').length - 450) < 1, `${rs.net.pipes.map((p) => `${p.from}-${p.to} ${p.length} m`).join(', ')}; ${rs.notes.join(' | ')}`);
const st = solveSteady(rs.net);
t('scanned plan: the loop solves and supplies the demands', Math.abs((st.flows.get(P('R1', 'J1').id) ?? 0) * 1000 - 20) < 0.01);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
