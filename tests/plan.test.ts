// Network from a plan drawing (DXF): pipe layers to pipes with T-junctions joined, symbols to devices, texts to
// levels and diameters, missing levels from the neighbours, ends set as sources and demands, then a surge run.
import { dxfSummary } from '../src/app/intake';
import { finishPlanNetwork, guessPipeLayers, guessSymbol, planToNetwork } from '../src/app/planNetwork';
import { solveSteady } from '../src/engine/steady';
import { runTransient } from '../src/engine/transient';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };

const ent: string[] = [];
const line = (layer: string, x1: number, y1: number, x2: number, y2: number) => ent.push('0', 'LINE', '8', layer, '10', String(x1), '20', String(y1), '11', String(x2), '21', String(y2));
const poly = (layer: string, pts: [number, number][]) => { ent.push('0', 'LWPOLYLINE', '8', layer, '90', String(pts.length)); for (const [x, y] of pts) ent.push('10', String(x), '20', String(y)); };
const insert = (block: string, x: number, y: number) => ent.push('0', 'INSERT', '8', 'SYMBOLS', '2', block, '10', String(x), '20', String(y));
const text = (s: string, x: number, y: number) => ent.push('0', 'TEXT', '8', 'ANNO', '10', String(x), '20', String(y), '1', s);
poly('W-PIPE-MAIN', [[0, 0], [500, 0], [1000, 0]]);
line('W-PIPE-MAIN', 500, 0, 500, 400);
line('W-PIPE-MAIN', 250, 300, 250, 0); // ends on the main between vertices: a T-junction drawn without a vertex
line('ROAD-KERB', -50, -20, 1100, -20);
insert('ARV_DN100', 500, 2);
insert('GV-SLUICE', 750, 1);
insert('NORTH_ARROW', 900, 300);
text('IL 100.00', 3, 5);
text('IL 110.00', 997, 5);
text('GL 120.50', 503, 405);
text('DN300 DI K9', 300, 3);
const dxf = ['0', 'SECTION', '2', 'ENTITIES', ...ent, '0', 'ENDSEC', '0', 'EOF'].join('\n');
const d = dxfSummary(dxf);

t('symbol names guessed', guessSymbol('ARV_DN100') === 'airValve' && guessSymbol('GV-SLUICE') === 'valve' && guessSymbol('NRV') === 'checkValve' && guessSymbol('WASHOUT-150') === 'washout' && guessSymbol('NORTH_ARROW') === 'ignore' && guessSymbol('PUMP-1') === 'pump');
t('pipe layer guessed (the road layer is not)', JSON.stringify(guessPipeLayers(d)) === '["W-PIPE-MAIN"]', guessPipeLayers(d).join(','));
const symbols = Object.fromEntries(d.blocks.map((b) => [b.name, guessSymbol(b.name)]));
const r = planToNetwork(d, { layers: ['W-PIPE-MAIN'], units: 'm', symbols, diameterMm: 200, material: 'di', classM: 160 });
const net = r.net;
t('T-junction joined: the branch at x = 250 meets the main', net.nodes.some((n) => n.x === 250 && n.y === 0) && r.notes.some((x) => x.includes('joined')), r.notes.join(' | '));
t('air valve where the symbol sits (on the node at x = 500)', net.nodes.some((n) => n.x === 500 && n.y === 0 && n.airValve));
t('line valve inserted where the valve symbol sits', net.valves.length === 1);
const at = (x: number, y: number) => net.nodes.find((n) => Math.abs(n.x - x) < 0.01 && Math.abs(n.y - y) < 0.01)!;
t('levels from the texts (ground level less 1.2 m cover)', at(0, 0).elev === 100 && at(1000, 0).elev === 110 && Math.abs(at(500, 400).elev - 119.3) < 1e-9, `${at(0, 0).elev}, ${at(1000, 0).elev}, ${at(500, 400).elev}`);
const z500 = at(500, 0).elev;
t('missing levels filled from the neighbours (between the known ones)', z500 > 100 && z500 < 119.3, `${z500}`);
const p300 = net.pipes.filter((p) => Math.abs(p.diameter - 0.3) < 1e-9).length;
t('DN300 from the text on the main, spread along the run but not into the branches', p300 >= 2 && net.pipes.filter((p) => Math.abs(p.diameter - 0.2) < 1e-9).length >= 2, `${p300} pipes DN300`);
t('open ends listed', r.ends.length === 4, r.ends.join(','));

// the engineer sets the ends: a source at the west end, demands at two ends, one closed
const west = at(0, 0).id, east = at(1000, 0).id, north = at(500, 400).id, br = at(250, 300).id;
const f = finishPlanNetwork(net, { [west]: { role: 'source', level: 160 }, [east]: { role: 'demand', lps: 40 }, [north]: { role: 'demand', lps: 20 }, [br]: { role: 'closed' } });
const st = solveSteady(f.net);
const qIn = f.net.pipes.filter((p) => p.from === west || p.to === west).reduce((s, p) => s + Math.abs(st.flows.get(p.id) ?? 0), 0);
t('steady state: the source supplies the demands', Math.abs(qIn * 1000 - 60) < 0.5, `${(qIn * 1000).toFixed(1)} L/s`);
t('operation set: the line valve closes', f.net.event.kind === 'valveClose' && f.net.event.targets[0] === f.net.valves[0].id, f.notes.join(' | '));
const tr = runTransient(f.net, { envelopeOnly: true });
t('surge run completes', tr.envelopes.length === f.net.pipes.length);
let threw = false;
try { finishPlanNetwork(net, {}); } catch { threw = true; }
t('a source is required', threw);

// millimetre drawings
const dmm = dxfSummary(dxf.replace(/\n(10|20|11|21)\n(-?\d+(?:\.\d+)?)/g, (_m, c, v) => `\n${c}\n${Number(v) * 1000}`));
const rmm = planToNetwork(dmm, { layers: ['W-PIPE-MAIN'], units: 'mm', symbols, diameterMm: 200, material: 'di', classM: 160 });
t('drawing in millimetres gives the same network', rmm.net.nodes.length === net.nodes.length && Math.abs(rmm.net.pipes.reduce((s, p) => s + p.length, 0) - net.pipes.reduce((s, p) => s + p.length, 0)) < 0.5);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
