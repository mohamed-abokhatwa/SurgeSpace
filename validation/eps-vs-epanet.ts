// Extended-period hydraulics and water quality against EPANET 2.2 (run through WNTR).
//   npx tsx validation/eps-vs-epanet.ts [Net1|Net2|Net3]
// References: validation/data/<net>.eps.json and <net>.age.eps.json from make-eps-reference.py.
import { readFileSync } from 'node:fs';
import { parseInp } from '../src/engine/inp';
import { runEPS } from '../src/engine/eps';

const dir = new URL('./data/', import.meta.url);
type Ref = { times: number[]; head?: Record<string, number[]>; flow?: Record<string, number[]>; quality: Record<string, number[]> };
const nets = process.argv[2] ? [process.argv[2]] : ['Net1', 'Net2', 'Net3', 'Net1rules'];

export function compare(name: string, verbose = true) {
  const out: Record<string, number> = {};
  for (const mode of ['file', 'age'] as const) {
    const net = parseInp(readFileSync(new URL(`${name}.inp`, dir), 'utf8')).network;
    if (mode === 'age') net.eps = { ...net.eps!, quality: 'age' };
    const ref = JSON.parse(readFileSync(new URL(`${name}${mode === 'age' ? '.age' : ''}.eps.json`, dir), 'utf8')) as Ref;
    const t0 = performance.now();
    const r = runEPS(net);
    const ms = performance.now() - t0;
    const idx = (t: number) => r.times.findIndex((x) => Math.abs(x - t) < 1);
    let dH = 0, dHt = 0, dQ = 0, dC = 0, cRange = 0, n = 0, missing = 0, worstC = '';
    const diffs: number[] = [];
    const tankIds = new Set(net.nodes.filter((x) => x.storage).map((x) => x.id));
    ref.times.forEach((t, k) => {
      const i = idx(t);
      if (i < 0) { missing++; return; }
      if (mode === 'file') {
        for (const [id, v] of Object.entries(ref.head!)) {
          const d = Math.abs(r.head[id][i] - v[k]);
          if (tankIds.has(id)) dHt = Math.max(dHt, d); else dH = Math.max(dH, d);
        }
        for (const [id, v] of Object.entries(ref.flow!)) if (r.flow[id]) dQ = Math.max(dQ, Math.abs(r.flow[id][i] - v[k]));
      }
      if (r.quality) for (const [id, v] of Object.entries(ref.quality)) {
        if (!r.quality[id]) continue;
        const d = Math.abs(r.quality[id][i] - v[k]);
        diffs.push(d);
        if (d > dC) { dC = d; worstC = `${id} at ${t / 3600} h (${r.quality[id][i].toFixed(3)} vs ${v[k].toFixed(3)})`; }
        cRange = Math.max(cRange, Math.abs(v[k]));
        n++;
      }
    });
    if (mode === 'file') {
      out.head = dH; out.tankHead = dHt; out.flowLps = dQ * 1000;
      if (verbose) console.log(`${name} hydraulics: ${r.times.length} reports, ${r.solves} solves, ${ms.toFixed(0)} ms; max head difference ${dH.toFixed(3)} m (junctions), ${dHt.toFixed(3)} m (tanks); max flow difference ${(dQ * 1000).toFixed(2)} L/s${missing ? `; ${missing} report times missing` : ''}`);
    }
    if (r.quality) {
      diffs.sort((a, b) => a - b);
      const p95 = diffs[Math.floor(diffs.length * 0.95)] ?? 0, mean = diffs.reduce((a, b) => a + b, 0) / Math.max(diffs.length, 1);
      out[mode === 'age' ? 'age' : 'quality'] = p95;
      if (verbose) console.log(`${name} ${mode === 'age' ? 'water age' : `quality (${net.eps!.quality})`}: mean difference ${mean.toFixed(3)}, 95 % within ${p95.toFixed(3)}, max ${dC.toFixed(3)} ${r.qualityUnit} over ${n} values (largest value ${cRange.toFixed(2)}); max at ${worstC} (sharp fronts passing a node near a report time)`);
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) for (const n of nets) compare(n);
