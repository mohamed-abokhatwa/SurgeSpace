// SCADA and field data: historian exports (CSV), live tags (MQTT over WebSocket, or the SurgeSpace data bridge
// for OPC UA and Modbus), tag-to-element mapping, comparison with the model and boundary conditions from data.
import type { EPSResult } from '../engine/eps';
import type { Network } from '../engine/types';

export type TagQuantity = 'pressure' | 'head' | 'flow' | 'level' | 'status' | 'speed';
export interface TagMap {
  tag: string;
  /** Node (pressure, head, level) or link (flow, status, speed) id. */
  element: string;
  quantity: TagQuantity;
  /** value_model = value_tag × scale + offset (to SI: m, m³/s, 0/1, speed ratio). */
  scale?: number;
  offset?: number;
}
export interface Series { times: number[]; values: Record<string, number[]> }

/** Read a historian export: first column time (ISO date, "hh:mm[:ss]", or seconds), other columns tags. */
export function parseHistorianCsv(text: string): Series {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (lines.length < 2) throw new Error('The file has no data rows.');
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
  const head = lines[0].split(sep).map((s) => s.trim().replace(/^"|"$/g, ''));
  const tags = head.slice(1);
  const values: Record<string, number[]> = Object.fromEntries(tags.map((t) => [t, []]));
  const raw: number[] = [];
  for (const l of lines.slice(1)) {
    const c = l.split(sep).map((s) => s.trim().replace(/^"|"$/g, ''));
    const t = parseTime(c[0]);
    if (!Number.isFinite(t)) continue;
    raw.push(t);
    tags.forEach((tag, k) => values[tag].push(c[k + 1] === undefined || c[k + 1] === '' ? NaN : Number(c[k + 1].replace(',', '.'))));
  }
  if (!raw.length) throw new Error('No row had a readable time in the first column.');
  const t0 = raw[0];
  return { times: raw.map((t) => t - t0), values };
}
function parseTime(s: string): number {
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const hm = /^(\d{1,3}):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/.exec(s);
  if (hm) return Number(hm[1]) * 3600 + Number(hm[2]) * 60 + Number(hm[3] ?? 0);
  const d = Date.parse(s);
  return Number.isFinite(d) ? d / 1000 : NaN;
}

const toModel = (m: TagMap, v: number) => v * (m.scale ?? 1) + (m.offset ?? 0);

/** Model values at the measurement times (linear in time) for one tag, from an extended-period result. */
export function modelSeries(net: Network, r: EPSResult, m: TagMap, times: number[]): number[] {
  const arr = m.quantity === 'pressure' ? r.pressure[m.element] : m.quantity === 'head' ? r.head[m.element] : m.quantity === 'level' ? r.level[m.element] : m.quantity === 'flow' ? r.flow[m.element] : m.quantity === 'status' ? r.status[m.element] : undefined;
  if (!arr) throw new Error(`No ${m.quantity} results for ${m.element}.`);
  void net;
  return times.map((t) => {
    const T = r.times;
    if (t <= T[0]) return arr[0];
    for (let i = 1; i < T.length; i++) if (t <= T[i]) return arr[i - 1] + ((arr[i] - arr[i - 1]) * (t - T[i - 1])) / (T[i] - T[i - 1] || 1);
    return arr[arr.length - 1];
  });
}

/** Fit of the model to field data, per tag: mean difference (bias), root-mean-square difference, correlation. */
export function compareWithData(net: Network, r: EPSResult, data: Series, maps: TagMap[]) {
  return maps.filter((m) => data.values[m.tag]).map((m) => {
    const meas = data.values[m.tag].map((v) => toModel(m, v));
    const mod = modelSeries(net, r, m, data.times);
    const pairs = meas.map((v, i) => [v, mod[i]]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
    const n = pairs.length || 1;
    const bias = pairs.reduce((s, [a, b]) => s + (b - a), 0) / n;
    const rms = Math.sqrt(pairs.reduce((s, [a, b]) => s + (b - a) ** 2, 0) / n);
    const ma = pairs.reduce((s, [a]) => s + a, 0) / n, mb = pairs.reduce((s, [, b]) => s + b, 0) / n;
    const cov = pairs.reduce((s, [a, b]) => s + (a - ma) * (b - mb), 0);
    const va = pairs.reduce((s, [a]) => s + (a - ma) ** 2, 0), vb = pairs.reduce((s, [, b]) => s + (b - mb) ** 2, 0);
    return { tag: m.tag, element: m.element, quantity: m.quantity, points: pairs.length, bias, rms, r: va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : NaN };
  });
}

/** Set the model to measured values (one snapshot): source and tank heads/levels, pump running and speed,
 *  ready for a surge run from the real operating state. Returns the new model and what changed. */
export function applySnapshot(net: Network, values: Record<string, number>, maps: TagMap[]): { net: Network; changes: string[] } {
  const changes: string[] = [];
  let out: Network = { ...net, nodes: net.nodes.map((n) => ({ ...n })), pumps: net.pumps.map((p) => ({ ...p })), pipes: net.pipes.map((p) => ({ ...p })) };
  for (const m of maps) {
    const raw = values[m.tag];
    if (raw === undefined || !Number.isFinite(raw)) continue;
    const v = toModel(m, raw);
    const n = out.nodes.find((x) => x.id === m.element);
    const p = out.pumps.find((x) => x.id === m.element);
    if (n && n.kind === 'reservoir' && (m.quantity === 'level' || m.quantity === 'head' || m.quantity === 'pressure')) {
      const h = m.quantity === 'head' ? v : n.elev + v;
      n.head = h;
      if (n.storage) n.storage = { ...n.storage, initLevel: h - n.elev };
      changes.push(`${n.id}: water level ${h.toFixed(2)} m (from ${m.tag})`);
    } else if (p && m.quantity === 'status') { p.on = v > 0.5; changes.push(`${p.id}: ${p.on ? 'running' : 'stopped'} (from ${m.tag})`); }
    else if (p && m.quantity === 'speed' && v > 0) {
      const s = v;
      p.curve = p.curve.map(([q, h]) => [q * s, h * s * s] as [number, number]);
      changes.push(`${p.id}: speed ${(s * 100).toFixed(0)} % (from ${m.tag})`);
    }
    const pi = out.pipes.find((x) => x.id === m.element);
    if (pi && m.quantity === 'status') { pi.closed = v < 0.5; changes.push(`${pi.id}: ${pi.closed ? 'closed' : 'open'} (from ${m.tag})`); }
  }
  out = { ...out };
  return { net: out, changes };
}

/** A measured pressure or level history at a fixed-level source, as its head schedule for a surge run. */
export function boundaryFromSeries(net: Network, data: Series, m: TagMap): Network {
  const n = net.nodes.find((x) => x.id === m.element);
  if (!n || n.kind !== 'reservoir') throw new Error(`${m.element} is not a fixed-level source.`);
  const h = data.values[m.tag].map((v) => toModel(m, v)).map((v) => (m.quantity === 'head' ? v : n.elev + v));
  const h0 = h.find(Number.isFinite) ?? (n.head ?? n.elev);
  const table = data.times.map((t, i) => [t, (h[i] ?? h0) - h0] as [number, number]).filter(([, d]) => Number.isFinite(d));
  return { ...net, nodes: net.nodes.map((x) => (x.id === n.id ? { ...x, head: h0, headSchedule: { mode: 'table', table } } : x)) };
}
