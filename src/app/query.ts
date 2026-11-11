// Queries: select elements by their data and results, e.g.
//   pipes where diameter_mm < 200 and material = PVC
//   nodes where max_pressure_m > 120 or min_pressure_m < 0
//   junctions where elevation > 140
// Fields are the element fields of the model (as in the properties) plus results of the last run.
import type { ElRef } from './edit';
import { readFields, type ElType } from './schema';
import type { TransientResult } from '../engine/transient';
import type { Network } from '../engine/types';

export interface QueryResult { refs: ElRef[]; fields: string[]; error?: string }
const TYPES: Record<string, { type: ElType; filter?: (e: { kind?: string }) => boolean }> = {
  nodes: { type: 'node' }, node: { type: 'node' }, junctions: { type: 'node', filter: (e) => e.kind === 'junction' }, sources: { type: 'node', filter: (e) => e.kind === 'reservoir' },
  pipes: { type: 'pipe' }, pipe: { type: 'pipe' }, pumps: { type: 'pump' }, pump: { type: 'pump' }, valves: { type: 'valve' }, valve: { type: 'valve' },
};

function resultFields(net: Network, type: ElType, id: string, r?: TransientResult | null): Record<string, unknown> {
  if (!r) return {};
  if (type === 'node') { const n = net.nodes.find((x) => x.id === id)!; return r.nodeMax[id] === undefined ? {} : { max_pressure_m: r.nodeMax[id] - n.elev, min_pressure_m: r.nodeMin[id] - n.elev, steady_pressure_m: (r.steady.heads[id] ?? NaN) - n.elev }; }
  if (type === 'pipe') {
    const e = r.envelopes.find((x) => x.id === id);
    if (!e) return {};
    let mx = -Infinity, mn = Infinity, cav = 0;
    for (let i = 0; i < e.s.length; i++) { mx = Math.max(mx, e.hMax[i] - e.z[i]); mn = Math.min(mn, e.hMin[i] - e.z[i]); cav = Math.max(cav, e.cavMax[i] * 1000); }
    const p = net.pipes.find((x) => x.id === id)!;
    return { max_pressure_m: mx, min_pressure_m: mn, cavity_l: cav, steady_flow_lps: (r.steady.flows[id] ?? 0) * 1000, class_used_pct: p.pressureClass ? (mx / p.pressureClass) * 100 : NaN };
  }
  return { steady_flow_lps: (r.steady.flows[id] ?? 0) * 1000 };
}

export function runQuery(net: Network, text: string, r?: TransientResult | null): QueryResult {
  const m = /^\s*(\w+)\s*(?:where\s+(.+))?$/i.exec(text);
  if (!m) return { refs: [], fields: [], error: 'Write: <pipes|nodes|junctions|sources|pumps|valves> where <field> <op> <value> [and|or …]' };
  const t = TYPES[m[1].toLowerCase()];
  if (!t) return { refs: [], fields: [], error: `Unknown element type "${m[1]}". Use pipes, nodes, junctions, sources, pumps or valves.` };
  const els = (t.type === 'node' ? net.nodes : t.type === 'pipe' ? net.pipes : t.type === 'pump' ? net.pumps : net.valves) as ({ id: string; kind?: string })[];
  const pool = els.filter((e) => !t.filter || t.filter(e));
  const sample = pool[0] ? { ...readFields(t.type, pool[0]), ...resultFields(net, t.type, pool[0].id, r) } : {};
  const fields = Object.keys(sample);
  if (!m[2]) return { refs: pool.map((e) => ({ type: t.type, id: e.id })), fields };
  // conditions joined by and / or (and binds tighter)
  const orParts = m[2].split(/\s+or\s+/i).map((g) => g.split(/\s+and\s+/i).map((c) => {
    const cm = /^\s*([\w.]+)\s*(<=|>=|!=|<>|=|<|>|contains)\s*(.+?)\s*$/i.exec(c);
    return cm ? { f: cm[1], op: cm[2].toLowerCase(), v: cm[3].replace(/^["']|["']$/g, '') } : null;
  }));
  const bad = orParts.flat().find((c) => !c);
  if (bad === null) return { refs: [], fields, error: 'Each condition is: field operator value (operators = != < > <= >= contains).' };
  const unknown = orParts.flat().find((c) => c && !fields.includes(c.f) && c.f !== 'id');
  if (unknown) return { refs: [], fields, error: `Unknown field "${unknown.f}". Fields: id, ${fields.join(', ')}.` };
  const test = (vals: Record<string, unknown>, c: { f: string; op: string; v: string }) => {
    const a = vals[c.f], num = Number(c.v);
    if (typeof a === 'number' && Number.isFinite(num) && c.op !== 'contains') {
      switch (c.op) { case '<': return a < num; case '>': return a > num; case '<=': return a <= num; case '>=': return a >= num; case '=': return Math.abs(a - num) < 1e-9; default: return Math.abs(a - num) >= 1e-9; }
    }
    const sa = String(a ?? '').toLowerCase(), sv = c.v.toLowerCase();
    if (c.op === 'contains') return sa.includes(sv);
    if (c.op === '=') return sa === sv || (sa === 'true' && sv === 'yes') || (sa === 'false' && sv === 'no');
    if (c.op === '!=' || c.op === '<>') return sa !== sv;
    return false;
  };
  const refs = pool.filter((e) => {
    const vals = { id: e.id, ...readFields(t.type, e), ...resultFields(net, t.type, e.id, r) };
    return orParts.some((g) => g.every((c) => test(vals, c!)));
  }).map((e) => ({ type: t.type, id: e.id }));
  return { refs, fields };
}
