// A small plan drawing (DXF, metres) for the "network from the plan" tests: a pumped main from a reservoir with two
// branches, symbols for the reservoir, pump, air valves, a line valve and a washout, and level and size texts.
//   node tests/fixtures/make-plan-dxf.mjs > tests/fixtures/plan.dxf
const ent = [];
const line = (layer, x1, y1, x2, y2) => ent.push('0', 'LINE', '8', layer, '10', x1, '20', y1, '11', x2, '21', y2);
const poly = (layer, pts) => { ent.push('0', 'LWPOLYLINE', '8', layer, '90', pts.length); for (const [x, y] of pts) ent.push('10', x, '20', y); };
const insert = (block, x, y) => ent.push('0', 'INSERT', '8', 'W-SYMBOLS', '2', block, '10', x, '20', y);
const text = (s, x, y) => ent.push('0', 'TEXT', '8', 'W-TEXT', '10', x, '20', y, '1', s);
poly('W-PIPE-MAIN', [[0, 0], [40, 0], [900, 0], [1800, 120], [2600, 120]]);
line('W-PIPE-MAIN', 900, 0, 900, -700);
line('W-PIPE-MAIN', 1800, 120, 1800, 800);
line('ROADS', -100, -40, 2700, -40);
insert('RES-SUMP', 0, 0);
insert('PUMP-DUTY', 20, 0);
insert('ARV-DN100', 900, 0);
insert('ARV-DN80', 1800, 120);
insert('BFV-400', 2200, 120);
insert('WO-150', 1400, 66);
insert('NORTH', 2500, 700);
text('IL 98.50', 3, 4);
text('IL 112.00', 903, 4);
text('IL 131.00', 1803, 124);
text('IL 118.00', 2597, 124);
text('GL 106.20', 903, -704);
text('GL 141.20', 1803, 804);
text('DN400 DI K9', 500, 4);
text('DN250 DI', 905, -350);
console.log(['0', 'SECTION', '2', 'ENTITIES', ...ent, '0', 'ENDSEC', '0', 'EOF'].join('\n'));
