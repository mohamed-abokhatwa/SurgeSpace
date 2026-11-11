// Skeletonisation and protection optimisation.
import { skeletonise } from '../src/engine/skeleton';
import { candidates, optimiseProtection, pipeCandidates } from '../src/engine/optimise';
import { solveSteady } from '../src/engine/steady';
import { runTransient } from '../src/engine/transient';
import { risingMain, EXAMPLES } from '../src/engine/cases';
import type { Network } from '../src/engine/types';
import { townSupply } from '../src/engine/cases';
import { runEPS } from '../src/engine/eps';
import { applySnapshot, boundaryFromSeries, compareWithData, parseHistorianCsv, type TagMap } from '../src/app/scada';
import { fromGeoJSON, guessFields, toDXF, toGeoJSON } from '../src/app/exchange';
import { importDxf } from '../src/engine/importers';
import { xlsx } from '../src/app/xlsx';
import { healthCheck } from '../src/app/health';
import { addItem, allItems, applyItem } from '../src/app/library';
import { applyFactors, calibrate } from '../src/app/calibrate';
import { runQuery } from '../src/app/query';
import { plotSVG } from '../src/app/plot';
import { resultsBook } from '../src/app/resultsBook';
import { connectLive, mqttParse, mqttPublish, readPayloadValue } from '../src/app/live';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };
const extremes = (n: Network) => { const r = runTransient(n, { steady: solveSteady(n), frames: 200 }); return { max: Math.max(...r.envelopes.flatMap((e) => Array.from(e.hMax))), min: Math.min(...r.envelopes.flatMap((e) => Array.from(e.hMin).map((h, i) => h - e.z[i]))) }; };

{
  // rising main with extra junctions along the line: merging them keeps the steady state and the surge
  const base = risingMain(true);
  const split: Network = structuredClone(base);
  // split M2 and M3 into halves with plain junctions
  for (const id of ['M2', 'M3']) {
    const p = split.pipes.find((x) => x.id === id)!;
    const a = split.nodes.find((n) => n.id === p.from)!, b = split.nodes.find((n) => n.id === p.to)!;
    const prof = [{ s: 0, z: a.elev }, ...(p.profile ?? []), { s: p.length, z: b.elev }];
    const zMid = prof.reduce((z, q, i) => (i && q.s >= p.length / 2 && prof[i - 1].s < p.length / 2 ? prof[i - 1].z + ((q.z - prof[i - 1].z) * (p.length / 2 - prof[i - 1].s)) / (q.s - prof[i - 1].s) : z), a.elev);
    const mid = { id: `${id}-MID`, kind: 'junction' as const, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, elev: zMid };
    split.nodes.push(mid);
    const h = p.length / 2;
    const p1 = { ...p, id: `${id}a`, to: mid.id, length: h, profile: p.profile?.filter((q) => q.s < h) };
    const p2 = { ...p, id: `${id}b`, from: mid.id, length: h, profile: p.profile?.filter((q) => q.s > h).map((q) => ({ s: q.s - h, z: q.z })) };
    split.pipes = split.pipes.filter((x) => x !== p).concat([p1, p2]);
  }
  const sk = skeletonise(split);
  t('series junctions removed (plain junctions along the main)', sk.removedNodes.length === 4 && sk.net.pipes.length === 3, sk.changes.join(' | '));
  t('air valve, vessel and pump nodes kept', ['HP2600', 'PS-D', 'PS-S'].every((id) => sk.net.nodes.some((n) => n.id === id)));
  const s1 = solveSteady(split), s2 = solveSteady(sk.net);
  t('steady heads unchanged at the kept nodes', ['PS-D', 'HP2600', 'PS-S'].every((id) => Math.abs(s1.heads.get(id)! - s2.heads.get(id)!) < 1e-6));
  const e1 = extremes(split), e2 = extremes(sk.net);
  t('surge extremes unchanged', Math.abs(e1.max - e2.max) < 0.5 && Math.abs(e1.min - e2.min) < 0.5, `max ${e1.max.toFixed(2)}/${e2.max.toFixed(2)} m, min p ${e1.min.toFixed(2)}/${e2.min.toFixed(2)} m`);
  // a real network: fewer elements, same steady heads at the kept nodes
  const bw = EXAMPLES.find((x) => x.id === 'bwsn1')!.make();
  const sb = skeletonise(bw);
  const h1 = solveSteady(bw), h2 = solveSteady(sb.net);
  const worst = Math.max(...sb.net.nodes.map((n) => Math.abs(h1.heads.get(n.id)! - h2.heads.get(n.id)!)));
  t('real network: fewer pipes, steady heads unchanged', sb.net.pipes.length < bw.pipes.length && worst < 1e-3, `${bw.pipes.length} → ${sb.net.pipes.length} pipes, worst head change ${worst.toExponential(1)} m`);
  const tr = skeletonise({ ...split, nodes: split.nodes.map((n) => (n.id === 'CH1200' ? { ...n, demand: 0.001 } : n)) }, { trimBelow: 0.2 });
  t('branch trimming leaves a main without dead ends untouched', tr.changes.every((c) => !c.startsWith('Trimmed')));
}
{
  // optimisation on the unprotected rising main: a feasible, cheaper design than "everything largest"
  const net = risingMain(false);
  const vars = candidates(net);
  t('candidates: vessel at the pump discharge, air valve at the high point', vars.some((v) => v.kind === 'vessel' && v.node === 'PS-D') && vars.some((v) => v.kind === 'airValve' && v.node === 'HP2600'), vars.map((v) => `${v.kind}@${v.node}`).join(', '));
  const t0 = performance.now();
  const r = optimiseProtection(net, { vars, minPressure: -5, population: 10, generations: 6, seed: 7 });
  const top = vars.reduce((s, v) => s + (v.kind === 'vessel' ? 15 + 8 * Math.max(...v.options) ** 0.8 : 1.5 + 20 * Math.max(...v.options)), 0);
  t('optimisation finds a design that meets the limits', r.best.feasible, `min pressure ${r.best.minP.toFixed(1)} m, ${r.evaluations} surge runs, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  t('cheaper than the largest of everything', r.best.cost < top, `${r.best.cost.toFixed(1)} vs ${top.toFixed(1)}; ${vars.map((v, k) => `${v.node} ${v.options[r.best.genes[k]]}`).join(', ')}`);
  const applied = r.apply(net);
  const chk = extremes(applied);
  t('applied design re-checks', chk.min >= -5 - 0.05, `${chk.min.toFixed(2)} m`);
}
{
  // pipe class selection with the vessel in place: the cheapest classes that hold the surge, higher near the pumps
  const net = risingMain(true);
  const vars = pipeCandidates(net, 'class');
  t('class candidates: one per pipe, only classes that hold the steady pressure', vars.length === net.pipes.length && vars.every((v) => v.options.length >= 1), vars.map((v) => `${v.node}: ${v.options.join('/')}`).join('; '));
  const r = optimiseProtection(net, { vars, minPressure: -100, population: 12, generations: 8, seed: 3 });
  const cls = Object.fromEntries(vars.map((v, k) => [v.node, v.options[r.best.genes[k]]]));
  t('class selection: feasible, M1 (by the pumps) needs a higher class than M4 (far end)', r.best.feasible && r.best.maxRatio <= 1 && cls.M1 > cls.M4, JSON.stringify(cls) + ` · peak ${(r.best.maxRatio * 100).toFixed(0)} % of class`);
  const allTop = vars.map((v) => v.options.length - 1);
  const topCost = vars.reduce((s, v, k) => s + (net.pipes.filter((p) => v.pipes!.includes(p.id)).reduce((a, p) => a + p.length * p.diameter * (0.85 + 0.0015 * v.options[allTop[k]]), 0)), 0);
  t('class selection: cheaper than the highest classes', r.best.cost < topCost, `${r.best.cost.toFixed(0)} vs ${topCost.toFixed(0)}`);
  const dv = pipeCandidates(net, 'diameter');
  t('diameter candidates: current size and two up', dv.every((v) => v.options.length === 3 && v.options[0] < v.options[2]));
}
{
  // historian data, comparison, live snapshot, boundary from data
  const net = townSupply();
  net.eps = { ...net.eps!, duration: 12 * 3600, quality: 'none' };
  const r = runEPS(net);
  const csv = ['time,TANK_LVL_cm,T2_P_bar,PU1_RUN', ...r.times.map((t, k) => `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')},${(r.level.TANK[k] * 100).toFixed(1)},${(r.pressure.T2[k] / 10.197).toFixed(4)},${r.status.PU1[k]}`)].join('\n');
  const h = parseHistorianCsv(csv);
  t('historian CSV read (times from hh:mm, tags as columns)', h.times.length === r.times.length && Object.keys(h.values).length === 3 && h.times[1] === 900);
  const maps: TagMap[] = [{ tag: 'TANK_LVL_cm', element: 'TANK', quantity: 'level', scale: 0.01 }, { tag: 'T2_P_bar', element: 'T2', quantity: 'pressure', scale: 10.197 }, { tag: 'PU1_RUN', element: 'PU1', quantity: 'status' }];
  const c = compareWithData(net, r, h, maps);
  t('model vs data: the model compared with its own output fits', c.length === 3 && c[0].rms < 0.001 && c[1].rms < 0.01 && c[0].r > 0.999, c.map((x) => `${x.tag} rms ${x.rms.toExponential(1)}`).join(', '));
  const snap = applySnapshot(net, { TANK_LVL_cm: 250, PU1_RUN: 0 }, maps);
  t('live snapshot sets tank level and pump state', snap.net.nodes.find((n) => n.id === 'TANK')!.storage!.initLevel === 2.5 && snap.net.pumps.find((p) => p.id === 'PU1')!.on === false, snap.changes.join('; '));
  const b = boundaryFromSeries(net, { times: [0, 10, 20], values: { W: [2, 2.5, 1.5] } }, { tag: 'W', element: 'WORKS', quantity: 'level' });
  const sch = b.nodes.find((n) => n.id === 'WORKS')!.headSchedule!;
  t('measured level becomes the source head schedule', sch.mode === 'table' && sch.table![1][1] === 0.5 && sch.table![2][1] === -0.5);
}
{
  // MQTT packets: a fake broker on a fake WebSocket
  const sent: Uint8Array[] = [];
  let sock: { onopen: ((e: unknown) => void) | null; onmessage: ((e: { data: unknown }) => void) | null; onclose: ((e: unknown) => void) | null; onerror: ((e: unknown) => void) | null; binaryType: string; send: (d: Uint8Array) => void; close: () => void } | null = null;
  const got: string[] = [];
  const stopIt = connectLive({ kind: 'mqtt', url: 'wss://x', topics: ['a/#'] }, (v) => got.push(`${v.tag}=${v.value}`), (s) => got.push(`[${s}]`), () => {
    sock = { onopen: null, onmessage: null, onclose: null, onerror: null, binaryType: '', send: (d) => sent.push(d), close: () => sock?.onclose?.({}) };
    return sock as never;
  });
  sock!.onopen!({});
  const connect = mqttParse(sent[0]).packets[0];
  t('MQTT CONNECT packet', connect.type === 1 && new TextDecoder().decode(connect.body.slice(2, 6)) === 'MQTT');
  const deliver = (b: Uint8Array) => sock!.onmessage!({ data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) });
  deliver(new Uint8Array([0x20, 2, 0, 0]));
  const sub = mqttParse(sent[1]).packets[0];
  t('MQTT SUBSCRIBE after CONNACK', sub.type === 8 && new TextDecoder().decode(sub.body.slice(4, 7)) === 'a/#');
  // two publishes in one frame, the second split across frames
  const p1 = mqttPublish('a/p', '12.5'), p2 = mqttPublish('a/q', '{"value": 3}');
  const both = new Uint8Array([...p1, ...p2]);
  deliver(both.slice(0, p1.length + 3));
  deliver(both.slice(p1.length + 3));
  t('MQTT PUBLISH parsed across frames, numbers and JSON', got.includes('a/p=12.5') && got.includes('a/q=3'), got.join(' '));
  t('payload forms', readPayloadValue('true') === 1 && readPayloadValue('{"v": 2}') === 2 && readPayloadValue('7') === 7);
  stopIt();
}
{
  // GIS / CAD exchange
  const net = risingMain(true);
  const s0 = solveSteady(net);
  const r = runTransient(net, { steady: s0, frames: 100 });
  const g = toGeoJSON(net, r, null, 32637);
  t('GeoJSON: points, lines, results', g.features.filter((f) => f.geometry.type === 'LineString').length === net.pipes.length && g.features.some((f) => f.properties.max_pressure_m !== undefined) && JSON.stringify(g.crs).includes('32637'));
  const back = fromGeoJSON(JSON.parse(JSON.stringify(g)));
  // pumps are not lines: put them back to compare the hydraulics
  back.network.pumps = net.pumps;
  const s1 = solveSteady(back.network);
  t('GeoJSON round trip: same pipes, same steady heads', back.network.pipes.length === net.pipes.length && ['PS-D', 'HP2600'].every((id) => Math.abs(s0.heads.get(id)! - s1.heads.get(id)!) < 1e-6), back.notes.join(' '));
  const fm = guessFields(g);
  t('field mapping guessed', fm.diameter === 'diameter_mm' && fm.elevation === 'elevation_m' && fm.id === 'id');
  // a GIS layer with other names, 3-D lines and no node layer
  const gis = { type: 'FeatureCollection' as const, features: [
    { type: 'Feature' as const, geometry: { type: 'LineString', coordinates: [[0, 0, 10], [100, 0, 12], [200, 0, 9]] }, properties: { FACILITYID: 'A1', DIAMETER: 200, MATERIAL: 'PVC' } },
    { type: 'Feature' as const, geometry: { type: 'LineString', coordinates: [[200.2, 0.1, 9], [300, 50, 8]] }, properties: { FACILITYID: 'A2', DIAMETER: 150, MATERIAL: 'PVC' } },
  ] };
  const gi = fromGeoJSON(gis, undefined, 0.5);
  t('GIS lines: ends snapped, 3-D profile kept, junctions created', gi.network.pipes.length === 2 && gi.network.nodes.length === 3 && gi.network.pipes[0].profile?.[0].z === 12 && gi.network.pipes[0].material === 'PVC' && Math.abs(gi.network.pipes[1].diameter - 0.15) < 1e-12, gi.notes.join(' '));
  const dxf = toDXF(net, r);
  const di = importDxf(dxf, { tol: 0.5, scale: 1, diameter: 0.3, wavespeed: 1000, layerFilter: 'SS_PIPES' });
  t('DXF export reads back as the same pipe network', di.pipes.length === net.pipes.length, `${di.pipes.length} pipes`);
}
{
  // results workbook (.xlsx): a valid zip with one worksheet per table (also opened with openpyxl during development)
  const net = risingMain(true);
  const r = runTransient(net, { steady: solveSteady(net), frames: 50 });
  const book = resultsBook(net, r, [], null);
  const bytes = xlsx(book);
  const txt = new TextDecoder('latin1').decode(bytes);
  t('xlsx: zip with workbook, styles and a sheet per table', bytes[0] === 0x50 && bytes[1] === 0x4b && txt.includes('xl/workbook.xml') && book.length >= 4 && txt.includes(`xl/worksheets/sheet${book.length}.xml`) && txt.includes('<v>1200</v>'), book.map((b) => b.name).join(', '));
}
{
  // health check fixes
  const net = risingMain(true);
  const bad: Network = { ...net, nodes: [...net.nodes.map((n) => (n.id === 'PS-D' ? { ...n, vessel: { ...n.vessel!, gasVolume: 40 } } : n)), { id: 'LOOSE', kind: 'junction', x: 0, y: 0, elev: 0 }], pumps: net.pumps.map((p) => ({ ...p, inertia: 0, efficiency: 84 })), pipes: net.pipes.map((p) => (p.id === 'M2' ? { ...p, diameter: 600 } : p)), settings: { ...net.settings, duration: 5 } };
  const before = healthCheck(bad);
  const fixed = before.filter((i) => i.fix).reduce((m, i) => i.fix!.apply(m), bad);
  const after = healthCheck(fixed);
  t('health fixes clear the errors and warnings they cover', before.filter((i) => i.fix).length >= 6 && !after.some((i) => i.level === 'error') && !after.some((i) => i.fix), `${before.filter((i) => i.fix).length} fixes; left: ${after.filter((i) => i.level !== 'info').map((i) => i.title).join('; ') || 'none'}`);
  t('fixed model runs', runTransient(fixed, { steady: solveSteady(fixed), frames: 20 }).envelopes.length > 0);
}
{
  // library: save a pump and an air valve, apply them elsewhere
  const net = risingMain(true);
  addItem('pump', 'Duty pump', net.pumps[0]);
  addItem('airValve', 'AV', net.nodes.find((n) => n.id === 'HP2600')!.airValve!);
  const its = allItems();
  const pumpIt = its.find((i) => i.name === 'Duty pump')!, av = its.find((i) => i.name === 'AV')!;
  const n2 = applyItem(applyItem({ ...net, pumps: net.pumps.map((p) => ({ ...p, curve: [[0.1, 10]] as [number, number][], inertia: 1 })) }, pumpIt, ['PU2']), av, ['CH1200']);
  t('library: pump data and air valve applied', JSON.stringify(n2.pumps[1].curve) === JSON.stringify(net.pumps[0].curve) && n2.pumps[1].inertia === net.pumps[0].inertia && n2.pumps[0].inertia === 1 && !!n2.nodes.find((n) => n.id === 'CH1200')!.airValve);
  t('library: generic air valves and pipe types', its.some((i) => i.id === 'g-av100') && its.some((i) => i.kind === 'pipe'));
}
{
  // calibration: "field data" made by the model with rougher pipes and 20 % more demand are recovered
  const base = townSupply();
  base.eps = { ...base.eps!, duration: 24 * 3600, hydStep: 3600, reportStep: 3600, quality: 'none' };
  const truth = applyFactors(base, [{ kind: 'roughness' }, { kind: 'demand' }], [3, 1.2]);
  const r = runEPS(truth);
  const maps: TagMap[] = [{ tag: 'T2', element: 'T2', quantity: 'pressure' }, { tag: 'T4', element: 'T4', quantity: 'pressure' }, { tag: 'LVL', element: 'TANK', quantity: 'level' }, { tag: 'Q', element: 'RM1', quantity: 'flow' }];
  const data = { times: r.times, values: { T2: r.pressure.T2, T4: r.pressure.T4, LVL: r.level.TANK, Q: r.flow.RM1 } };
  const c = calibrate(base, data, maps, [{ kind: 'roughness' }, { kind: 'demand' }]);
  t('calibration recovers roughness and demand factors', Math.abs(c.factors[0] - 3) < 0.3 && Math.abs(c.factors[1] - 1.2) < 0.03 && c.after < 0.05 * c.before, `roughness ×${c.factors[0].toFixed(2)}, demand ×${c.factors[1].toFixed(3)}, misfit ${c.before.toFixed(2)} → ${c.after.toFixed(3)} in ${c.runs} runs`);
}
{
  // queries
  const net = risingMain(true);
  const r = runTransient(net, { steady: solveSteady(net), frames: 30 });
  const a = runQuery(net, 'pipes where diameter_mm < 650 and length_m > 1000');
  t('query: pipes by diameter and length', a.refs.map((x) => x.id).join(',') === 'M1,M2,M3,M4', a.error ?? a.refs.map((x) => x.id).join(','));
  const b = runQuery(net, 'nodes where max_pressure_m > 50 or elevation > 145', r);
  t('query: nodes by results or level', !b.error && b.refs.some((x) => x.id === 'PS-D') && b.refs.some((x) => x.id === 'HP2600'), b.error ?? b.refs.map((x) => x.id).join(','));
  t('query: unknown field explained', !!runQuery(net, 'pipes where size > 3').error?.includes('Fields'));
  t('query: sources only', runQuery(net, 'sources').refs.length === 2);
}
{
  // drawing to scale
  const net = risingMain(true);
  const r = runTransient(net, { steady: solveSteady(net), frames: 20 });
  const a3 = plotSVG(net, r, { sheet: 'A3' }), a1 = plotSVG(net, r, { sheet: 'A1' });
  const xs = net.nodes.map((n) => n.x), span = Math.max(...xs) - Math.min(...xs);
  t('drawing to scale: standard scale that fits the sheet', a3.svg.startsWith('<svg') && a3.svg.includes('width="420mm"') && span * 1000 / a3.scale <= 400 && a1.scale < a3.scale && a3.svg.includes(`1:${a3.scale}`), `A3 1:${a3.scale}, A1 1:${a1.scale}`);
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
