// Writes the plan drawing (DXF) of a network file, as a drafter would draw it (see plan-dxf.ts).
//   npx tsx validation/write-plan-dxf.ts validation/data/ky4.inp out.dxf [ft|m]
import { readFileSync, writeFileSync } from 'node:fs';
import { parseInp } from '../src/engine/inp';
import { netToPlanDxf } from './plan-dxf';

const [src, out, units = 'ft'] = process.argv.slice(2);
const net = parseInp(readFileSync(src, 'utf8'), src).network;
writeFileSync(out, netToPlanDxf(net, { units: units as 'ft' | 'm', clutter: true }));
console.log(`${out}: ${net.nodes.length} nodes, ${net.pipes.length} pipes`);
