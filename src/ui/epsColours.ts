// Map colours from daily-operation (extended period) results; kept apart from the panel so the map does not load it.
import { clock, type EPSResult } from '../engine/eps';
import type { Network } from '../engine/types';

export type EPSColour = 'none' | 'pressure' | 'quality' | 'demand';
const PAL = ['#2c7bb6', '#00a6ca', '#00ccbc', '#90eb9d', '#f9d057', '#f29e2e', '#e76818', '#d7191c'];

/** Pipe colours for the map from EPS node values at report index k (average of the end nodes). */
export function epsPipeColours(net: Network, r: EPSResult, by: EPSColour, k: number) {
  if (by === 'none') return null;
  const vals = by === 'quality' ? r.quality : by === 'pressure' ? r.pressure : r.demand;
  if (!vals) return null;
  const nodeVal = (id: string) => vals[id]?.[k] ?? NaN;
  const all = net.nodes.filter((n) => n.kind === 'junction').map((n) => nodeVal(n.id)).filter(Number.isFinite);
  if (!all.length) return null;
  const lo = Math.min(...all), hi = Math.max(...all);
  const col = (v: number) => (Number.isFinite(v) ? PAL[Math.min(PAL.length - 1, Math.floor(((v - lo) / Math.max(hi - lo, 1e-9)) * PAL.length))] : null);
  const unit = by === 'quality' ? r.qualityUnit ?? '' : by === 'pressure' ? 'm' : 'L/s';
  const f = by === 'demand' ? 1000 : 1;
  return {
    color: (pid: string) => { const p = net.pipes.find((x) => x.id === pid); if (!p) return null; return col((nodeVal(p.from) + nodeVal(p.to)) / 2); },
    legend: { title: `${by === 'quality' ? 'Quality' : by === 'pressure' ? 'Pressure' : 'Demand'} at ${clock(r.times[k])} (${unit})`, items: PAL.map((c, i) => ({ color: c, label: `${((lo + ((hi - lo) * i) / PAL.length) * f).toFixed(2)}` })) },
  };
}
