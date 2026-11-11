// Write the DXF of an example with results, for an independent reader (ezdxf) to audit: validation/dxf-audit.py
import { writeFileSync } from 'node:fs';
import { toDXF } from '../src/app/exchange';
import { risingMain } from '../src/engine/cases';
import { runTransient } from '../src/engine/transient';
const net = risingMain(true);
writeFileSync(process.argv[2] ?? 'out.dxf', toDXF(net, runTransient(net, { frames: 100 })));
