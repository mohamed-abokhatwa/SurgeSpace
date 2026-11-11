// Results workbook: model data and surge / daily-operation results, one sheet per table.
import { pipeForces, type Check } from '../engine/analysis';
import type { EPSResult } from '../engine/eps';
import type { TransientResult } from '../engine/transient';
import { area, type Network } from '../engine/types';
import type { Sheet } from './xlsx';

const r3 = (x: number | undefined) => (x === undefined || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
export function resultsBook(net: Network, r: TransientResult | null, checks: Check[], eps: EPSResult | null): Sheet[] {
  const sheets: Sheet[] = [];
  sheets.push({ name: 'Nodes', rows: [['Node', 'Type', 'Elevation (m)', 'Demand (L/s)', 'Water level (m)', 'Devices', 'Steady pressure (m)', 'Max pressure (m)', 'Min pressure (m)'],
    ...net.nodes.map((n) => [n.id, n.kind === 'reservoir' ? (n.storage ? 'tank' : 'source') : 'junction', n.elev, n.kind === 'junction' ? r3((n.demand ?? 0) * 1000) : null, n.kind === 'reservoir' ? n.head ?? null : null,
      [n.vessel && 'air vessel', n.airValve && 'air valve', n.tank && 'tank', n.relief && 'relief', n.sav && 'anticipator', n.outlet && 'outlet'].filter(Boolean).join(', ') || null,
      r ? r3((r.steady.heads[n.id] ?? NaN) - n.elev) : null, r ? r3(r.nodeMax[n.id] - n.elev) : null, r ? r3(r.nodeMin[n.id] - n.elev) : null])] });
  const env = new Map((r?.envelopes ?? []).map((e) => [e.id, e]));
  const forces = new Map((r ? pipeForces(net, r) : []).map((f) => [f.id, f]));
  sheets.push({ name: 'Pipes', rows: [['Pipe', 'From', 'To', 'Length (m)', 'Diameter (mm)', 'Material', 'Roughness', 'Wave speed (m/s)', 'Class (m)', 'Steady flow (L/s)', 'Velocity (m/s)', 'Max pressure (m)', 'Min pressure (m)', 'Vapour cavity (L)', 'Largest axial force (kN)'],
    ...net.pipes.map((p) => {
      const e = env.get(p.id);
      let mx = NaN, mn = NaN, cav = NaN;
      if (e) { mx = -Infinity; mn = Infinity; cav = 0; for (let i = 0; i < e.s.length; i++) { mx = Math.max(mx, e.hMax[i] - e.z[i]); mn = Math.min(mn, e.hMin[i] - e.z[i]); cav = Math.max(cav, e.cavMax[i] * 1000); } }
      const q = r?.steady.flows[p.id];
      return [p.id, p.from, p.to, r3(p.length), r3(p.diameter * 1000), p.material ?? null, p.roughness, p.wavespeed, p.pressureClass ?? null, q === undefined ? null : r3(q * 1000), q === undefined ? null : r3(Math.abs(q) / area(p.diameter)), r3(mx), r3(mn), r3(cav), r3(forces.get(p.id)?.maxForce)];
    })] });
  if (net.pumps.length) sheets.push({ name: 'Pumps', rows: [['Pump', 'From', 'To', 'Curve (L/s : m)', 'Efficiency (%)', 'Speed (rpm)', 'Inertia (kg·m²)', 'Non-return valve', 'Steady flow (L/s)', 'Lowest speed (%)', 'Reverse flow'],
    ...net.pumps.map((p) => [p.id, p.from, p.to, p.curve.map(([q, h]) => `${r3(q * 1000)}:${r3(h)}`).join(', '), r3(p.efficiency * 100), p.speed, p.inertia, p.checkValve, r ? r3((r.steady.flows[p.id] ?? 0) * 1000) : null, r?.pumps[p.id] ? r3(Math.min(...Array.from(r.pumps[p.id].speed)) * 100) : null, r?.pumps[p.id]?.reverseFlow ?? null])] });
  if (checks.length) sheets.push({ name: 'Design checks', rows: [['Result', 'Check', 'Detail'], ...checks.map((c) => [c.level, c.title, c.detail])] });
  if (r) {
    const ids = net.nodes.filter((n) => r.nodeHead[n.id]).slice(0, 200).map((n) => n.id);
    sheets.push({ name: 'Node pressures in time', rows: [['Time (s)', ...ids], ...Array.from(r.times).map((t, k) => [r3(t), ...ids.map((id) => r3(r.nodeHead[id][k] - net.nodes.find((n) => n.id === id)!.elev))])] });
  }
  if (eps) {
    const tk = Object.keys(eps.level), pumps = net.pumps.map((p) => p.id);
    sheets.push({ name: 'Daily operation', rows: [['Time (h)', ...tk.map((id) => `Tank ${id} level (m)`), ...pumps.map((id) => `${id} flow (L/s)`)], ...eps.times.map((t, k) => [r3(t / 3600), ...tk.map((id) => r3(eps.level[id][k])), ...pumps.map((id) => r3(eps.flow[id][k] * 1000))])] });
    const jn = net.nodes.filter((n) => n.kind === 'junction').slice(0, 200).map((n) => n.id);
    sheets.push({ name: 'Daily pressures', rows: [['Time (h)', ...jn], ...eps.times.map((t, k) => [r3(t / 3600), ...jn.map((id) => r3(eps.pressure[id][k]))])] });
    if (eps.quality) sheets.push({ name: `Quality (${eps.qualityUnit})`, rows: [['Time (h)', ...jn], ...eps.times.map((t, k) => [r3(t / 3600), ...jn.map((id) => r3(eps.quality![id][k]))])] });
  }
  return sheets;
}
