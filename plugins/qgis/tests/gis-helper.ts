// Helper for the QGIS plug-in test: write SurgeSpace results as GeoJSON, or import a GeoJSON the plug-in wrote.
import { readFileSync, writeFileSync } from 'node:fs';
import { fromGeoJSON, toGeoJSON } from '../../../src/app/exchange';
import { risingMain } from '../../../src/engine/cases';
import { runTransient } from '../../../src/engine/transient';
const [mode, file] = process.argv.slice(2);
if (mode === 'results') {
  const net = risingMain(true);
  const r = runTransient(net, { frames: 100 });
  // place the model in UTM zone 37N so QGIS reads metres
  const placed = { ...net, nodes: net.nodes.map((n) => ({ ...n, x: n.x + 500000, y: n.y + 2400000 })) };
  writeFileSync(file, JSON.stringify(toGeoJSON(placed, r, null, 32637)));
} else {
  const g = JSON.parse(readFileSync(file, 'utf8'));
  const { network, notes } = fromGeoJSON(g);
  console.log(JSON.stringify({ nodes: network.nodes.length, pipes: network.pipes.length, lengths: network.pipes.map((p) => Math.round(p.length)), diam: network.pipes.map((p) => p.diameter), elev: network.nodes.map((n) => n.elev), notes }));
}
