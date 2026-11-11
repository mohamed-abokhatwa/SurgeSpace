// Calibration: adjust pipe roughness (all pipes, or per material) and the demand level so the daily-operation
// model matches field data (historian pressures, flows, levels). Each trial is a full extended-period run.
import { runEPS } from '../engine/eps';
import type { Network } from '../engine/types';
import { compareWithData, type Series, type TagMap } from './scada';

export type CalParam = { kind: 'roughness'; material?: string } | { kind: 'demand' };
export interface CalResult { factors: number[]; params: CalParam[]; before: number; after: number; runs: number; net: Network; fit: ReturnType<typeof compareWithData> }

const paramName = (p: CalParam) => (p.kind === 'demand' ? 'demand' : p.material ? `roughness of ${p.material}` : 'roughness (all pipes)');
export { paramName };

/** Apply factors to a model: roughness scaled (D-W ε; H-W C divided, since a larger C is smoother), demands scaled. */
export function applyFactors(net: Network, params: CalParam[], f: number[]): Network {
  let out = net;
  params.forEach((p, k) => {
    const x = f[k];
    if (p.kind === 'demand') out = { ...out, nodes: out.nodes.map((n) => (n.kind === 'junction' && n.demand ? { ...n, demand: n.demand * x } : n)) };
    else out = { ...out, pipes: out.pipes.map((q) => (!p.material || q.material === p.material ? { ...q, roughness: out.settings.friction === 'HW' ? q.roughness / x : q.roughness * x } : q)) };
  });
  return out;
}

/** Weighted misfit: RMS per tag over a typical scale (pressure/head/level 1 m, flow 1 L/s, status 1). */
export function misfit(net: Network, data: Series, maps: TagMap[]): { value: number; fit: ReturnType<typeof compareWithData> } {
  const fit = compareWithData(net, runEPS(net), data, maps);
  const value = Math.sqrt(fit.reduce((s, f) => s + (f.rms / (f.quantity === 'flow' ? 1e-3 : 1)) ** 2, 0) / Math.max(fit.length, 1));
  return { value, fit };
}

export function calibrate(net: Network, data: Series, maps: TagMap[], params: CalParam[], onProgress?: (m: string) => void, bounds: [number, number] = [0.2, 5]): CalResult {
  let runs = 0;
  const cost = (f: number[]) => { runs++; return misfit(applyFactors(net, params, f), data, maps).value; };
  const f = params.map(() => 1);
  const before = cost(f);
  let best = before;
  const gr = (Math.sqrt(5) - 1) / 2;
  for (let sweep = 0; sweep < 3; sweep++) {
    for (let k = 0; k < params.length; k++) {
      onProgress?.(`Calibrating ${paramName(params[k])} (pass ${sweep + 1})…`);
      // golden-section search in log space
      let a = Math.log(bounds[0]), b = Math.log(bounds[1]);
      const at = (u: number) => { const g = f.slice(); g[k] = Math.exp(u); return cost(g); };
      let c = b - gr * (b - a), d = a + gr * (b - a), fc = at(c), fd = at(d);
      for (let it = 0; it < 18; it++) {
        if (fc < fd) { b = d; d = c; fd = fc; c = b - gr * (b - a); fc = at(c); }
        else { a = c; c = d; fc = fd; d = a + gr * (b - a); fd = at(d); }
      }
      const u = (a + b) / 2, val = at(u);
      if (val < best) { best = val; f[k] = Math.exp(u); }
    }
  }
  const out = applyFactors(net, params, f);
  return { factors: f, params, before, after: best, runs, net: out, fit: misfit(out, data, maps).fit };
}
