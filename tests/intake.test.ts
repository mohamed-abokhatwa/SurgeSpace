// Model from documents: spreadsheets read by their headers, AI tool output parsed, gaps found, the basis traced to
// its sources, the model built with the air valves where the drawings show them, DXF symbols and texts summarised.
import { buildBasis, buildFromBasis, verifyModel, dxfSummary, findGaps, levelAt, materialId, parseRecorded, sheetEvidence, type Evidence, type IntakeDoc } from '../src/app/intake';
import { solveSteady } from '../src/engine/steady';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };

// a long-section table as engineers keep it: a title row, then headers, chainage in km
const ls: IntakeDoc = { id: 'd1', name: 'long-section.xlsx', kind: 'sheet', pages: [], sheets: [{ name: 'LS', rows: [
  ['Rising main long section', null, null],
  ['Chainage (km)', 'Ground level (m)', 'Invert level (m)'],
  [0, 101.5, 100], [1.2, 116.8, 115], [2.6, 141.9, 140], [3.8, 121.7, 120], [5, 131.5, 130],
] }] };
const ev = sheetEvidence(ls);
t('long section read from the sheet (header found below the title, km converted to m)', ev.length === 5 && ev[2].values.chainage_m === 2600 && ev[2].values.level_m === 140, ev.map((e) => `${e.values.chainage_m}:${e.values.level_m}`).join(' '));
t('each value cites its cell', ev[0].source.cell === 'LS!A3' && ev[4].source.cell === 'LS!A7', `${ev[0].source.cell} … ${ev[4].source.cell}`);
const curve: IntakeDoc = { id: 'd2', name: 'pump.csv', kind: 'sheet', pages: [], sheets: [{ name: 'pump', rows: [['Flow (L/s)', 'Head (m)'], [0, 80], [100, 70], [150, 58], [200, 40]] }] };
t('pump curve table recognised', sheetEvidence(curve).filter((e) => e.type === 'pumpCurvePoint').length === 4);
const pipes: IntakeDoc = { id: 'd3', name: 'pipes.csv', kind: 'sheet', pages: [], sheets: [{ name: 'p', rows: [['ID', 'From', 'To', 'Length', 'Diameter'], ['P1', 'J1', 'J2', 250, 0.3], ['P2', 'J2', 'J3', 400, 300]] }] };
const pe = sheetEvidence(pipes);
t('pipe table recognised, metres of diameter converted to mm', pe.length === 2 && pe[0].values.diameter_mm === 300 && pe[1].values.length_m === 400);

// the AI's tool call: numbers as text, a box beyond the page, an unknown type
const rec = parseRecorded({ summary: 'Long section sheet 2', items: [
  { type: 'airValve', label: 'ARV-1', fields: [{ name: 'chainage_m', value: '1,950' }, { name: 'diameter_mm', value: '100' }, { name: 'kind', value: 'double' }], box: [0.2, 0.3, 1.4, 0.35], confidence: 0.8 },
  { type: 'pump', fields: [{ name: 'count', value: '2' }, { name: 'duty_flow_lps', value: '160' }, { name: 'duty_head_m', value: '62' }, { name: 'speed_rpm', value: '1480' }] },
  { type: 'reservoir', label: 'Sump', fields: [{ name: 'level_m', value: '98' }, { name: 'chainage_m', value: '0' }] },
  { type: 'tank', label: 'Tank', fields: [{ name: 'level_m', value: '134' }, { name: 'chainage_m', value: '5000' }] },
  { type: 'pipe', fields: [{ name: 'diameter_mm', value: '590' }, { name: 'material', value: 'DI K9' }, { name: 'class_bar', value: 'PN25' }] },
  { type: 'spaceship', fields: [] },
] }, { doc: 'd4', page: 2 });
t('tool output parsed: numbers with separators, box clamped, unknown type dropped', rec.items.length === 5 && rec.items[0].values.chainage_m === 1950 && rec.items[0].source.box![2] === 1 && rec.items[0].values.kind === 'double' && rec.items[0].source.page === 2);
const all: Evidence[] = [...ev, ...rec.items];

// what is missing
const g0 = findGaps(ev);
t('with only a long section, the flow, diameter and levels are asked for', ['diameter', 'flow', 'startLevel', 'endLevel'].every((id) => g0.some((g) => g.id === id)) && !g0.some((g) => g.id === 'profile'), g0.map((g) => g.id).join(', '));
const g1 = findGaps(all);
t('with the drawing data, only the pump inertia is still asked (estimate offered)', g1.map((g) => g.id).join(',') === 'inertia', g1.map((g) => g.id).join(', '));
const g2 = findGaps(all, [{ ...g1[0], status: 'assumed' }]);
t('answers are kept when the gaps are recomputed', g2[0].status === 'assumed');

// the basis, traced
const docs = [{ id: 'd1', name: 'long-section.xlsx' }, { id: 'd4', name: 'drawings.pdf' }];
const b = buildBasis(all, g2, docs);
t('basis: pumped, 2 × 160 L/s, DN590, PN25 → 255 m, levels from the drawings', b.kind === 'pumped' && b.flowLps === 320 && b.pumps === 2 && b.diameterMm === 590 && b.classM === 255 && b.startLevel === 98 && b.endLevel === 134 && b.dutyHead === 62, JSON.stringify({ q: b.flowLps, n: b.pumps, d: b.diameterMm, c: b.classM, s: b.startLevel, e: b.endLevel }));
t('every value traced to a document, cell or page', b.trace.some((x) => x.what === 'Long section' && x.from.includes('LS!A3')) && b.trace.some((x) => x.what === 'Design flow' && x.from.includes('drawings.pdf, page 2')));
t('material names from drawings map to the catalogue', materialId('DI K9') === 'di' && materialId('HDPE PE100 SDR17') === 'pe100' && materialId('MS lined') === 'steel' && materialId('GRP SN5000') === 'grp' && materialId('uPVC') === 'pvcu');
t('level interpolated along the long section', Math.abs(levelAt(b.profile, 1950) - (115 + (750 / 1400) * 25)) < 1e-9);
// rejected evidence drops out
const rej = all.map((e) => (e.type === 'tank' ? { ...e, status: 'rejected' as const } : e));
t('rejected evidence is not used (the end level becomes a question)', findGaps(rej).some((g) => g.id === 'endLevel'));

const run = async () => {
  const { net, notes } = await buildFromBasis(b, 'From documents');
  t('model built: 2 pumps, the air valve from the drawing at CH 1950 on the pipe', net.pumps.length === 2 && net.nodes.some((n) => n.airValve && Math.abs(n.elev - levelAt(b.profile, 1950)) < 0.01), notes.join(' | '));
  t('pump duty head taken from the documents', Math.abs(net.pumps[0].curve[1][1] - 62) < 1e-6);
  // the stated duty head (62 m) is well above lift + friction (≈ 47 m): the check must flag the mismatch
  const ver = await verifyModel(net, b);
  t('verify flags a duty head that does not fit the line', ver.find((x) => x.what.startsWith('Flow'))?.ok === false, ver.map((x) => `${x.ok ? '✓' : '✗'} ${x.detail}`).join(' | '));
  // without the stated duty head the estimate fits the design flow
  const { net: net2 } = await buildFromBasis({ ...b, dutyHead: undefined }, 'x');
  const ver2 = await verifyModel(net2, { ...b, dutyHead: undefined });
  t('with the estimated duty the flow and class check, and the high point above the tank level (140 > 134 m) is flagged', ver2[0].ok && ver2[2].ok && !ver2[1].ok && ver2[1].detail.includes('CH2600'), ver2.map((x) => `${x.ok ? '✓' : '✗'} ${x.detail}`).join(' | '));
  const st = solveSteady(net2);
  t('steady state solves', st.heads.size > 0);

  // DXF: blocks (symbols) and texts summarised for the AI to map
  const dxf = ['0', 'SECTION', '2', 'ENTITIES',
    '0', 'LINE', '8', 'MAIN', '10', '0', '20', '0', '11', '100', '21', '0',
    '0', 'INSERT', '8', 'VALVES', '2', 'ARV', '10', '50', '20', '0',
    '0', 'INSERT', '8', 'VALVES', '2', 'ARV', '10', '80', '20', '0',
    '0', 'TEXT', '8', 'ANNO', '10', '50', '20', '5', '1', 'ARV DN100 CH 0+950',
    '0', 'ENDSEC', '0', 'EOF'].join('\n');
  const d = dxfSummary(dxf);
  t('DXF: layers, symbol blocks with positions and texts', d.layers[0]?.name === 'MAIN' && d.blocks[0]?.name === 'ARV' && d.blocks[0].count === 2 && d.texts[0]?.s === 'ARV DN100 CH 0+950', JSON.stringify({ l: d.layers, b: d.blocks.map((x) => [x.name, x.count]), t: d.texts.map((x) => x.s) }));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
};
void run();
