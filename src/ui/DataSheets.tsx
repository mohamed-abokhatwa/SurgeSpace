// Data Sheets: every element type and every result as a table — sort, filter, edit in place, paste blocks from
// Excel, and export to CSV. Values are shown in the chosen units.
import { useMemo, useState } from 'react';
import type { TransientResult } from '../engine/transient';
import { area, type Network, type NetNode, type Pipe, type Pump, type Valve } from '../engine/types';
import { unitOf, useUnits, type Quantity, type UnitPrefs } from '../app/units';
import { EL, valveKind } from '../app/elements';
import { PIPE_MATERIALS } from '../app/catalogues';
import type { ElRef } from '../app/edit';
import { download } from './util';

type SetNet = (f: (n: Network) => Network, label?: string) => void;
type V = number | string | boolean | undefined;
interface Col<T> { key: string; label: string; q?: Quantity; get: (r: T) => V; set?: (r: T, v: string) => T; type?: 'num' | 'text' | 'bool' | 'select'; options?: string[]; digits?: number }
interface Sheet<T> { key: string; label: string; rows: (n: Network, r: TransientResult | null) => T[]; cols: (n: Network, r: TransientResult | null) => Col<T>[]; id: (row: T) => string; ref?: (row: T) => ElRef; write?: (n: Network, rows: T[]) => Network; results?: boolean }

const num = (s: string) => { const v = Number(String(s).replace(/,/g, '').trim()); return Number.isFinite(v) ? v : NaN; };
const nodeBase: Col<NetNode>[] = [
  { key: 'id', label: 'ID', get: (r) => r.id, type: 'text' },
  { key: 'label', label: 'Label', get: (r) => r.label ?? '', set: (r, v) => ({ ...r, label: v || undefined }), type: 'text' },
  { key: 'x', label: 'X', q: 'length', get: (r) => r.x, set: (r, v) => ({ ...r, x: num(v) }), digits: 2 },
  { key: 'y', label: 'Y', q: 'length', get: (r) => r.y, set: (r, v) => ({ ...r, y: num(v) }), digits: 2 },
  { key: 'elev', label: 'Elevation', q: 'elevation', get: (r) => r.elev, set: (r, v) => ({ ...r, elev: num(v) }), digits: 3 },
];
const writeNodes = (n: Network, rows: NetNode[]) => { const m = new Map(rows.map((r) => [r.id, r])); return { ...n, nodes: n.nodes.map((x) => m.get(x.id) ?? x) }; };

function sheets(): Sheet<any>[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  const junctions: Sheet<NetNode> = {
    key: 'junctions', label: 'Junctions', id: (r) => r.id, ref: (r) => ({ type: 'node', id: r.id }), write: writeNodes,
    rows: (n) => n.nodes.filter((x) => x.kind === 'junction'),
    cols: () => [...nodeBase, { key: 'demand', label: 'Demand', q: 'flow', get: (r) => r.demand ?? 0, set: (r, v) => ({ ...r, demand: num(v) || 0 }) },
      { key: 'dev', label: 'Devices', get: (r) => [r.vessel && 'vessel', r.airValve && 'air valve', r.tank && (r.tank.oneWay ? 'feed tank' : 'standpipe'), r.sav && 'anticipator', r.relief && 'relief', r.outlet && (r.outlet.trigger === 'pressure' ? 'burst disc' : 'blow-off')].filter(Boolean).join(', '), type: 'text' }],
  };
  const sources: Sheet<NetNode> = {
    key: 'sources', label: 'Sources', id: (r) => r.id, ref: (r) => ({ type: 'node', id: r.id }), write: writeNodes,
    rows: (n) => n.nodes.filter((x) => x.kind === 'reservoir'),
    cols: () => [...nodeBase, { key: 'head', label: 'Water level', q: 'head', get: (r) => r.head ?? r.elev, set: (r, v) => ({ ...r, head: num(v) }) },
      { key: 'sched', label: 'Varies', get: (r) => (r.headSchedule ? (r.headSchedule.mode === 'sine' ? `sine ±${r.headSchedule.amplitude} m, ${r.headSchedule.period} s` : 'table') : '—'), type: 'text' }],
  };
  const pipes: Sheet<Pipe> = {
    key: 'pipes', label: 'Pipes', id: (r) => r.id, ref: (r) => ({ type: 'pipe', id: r.id }),
    write: (n, rows) => { const m = new Map(rows.map((r) => [r.id, r])); return { ...n, pipes: n.pipes.map((x) => m.get(x.id) ?? x) }; },
    rows: (n) => n.pipes,
    cols: (n) => [
      { key: 'id', label: 'ID', get: (r) => r.id, type: 'text' },
      { key: 'from', label: 'From', get: (r) => r.from, type: 'text' },
      { key: 'to', label: 'To', get: (r) => r.to, type: 'text' },
      { key: 'length', label: 'Length', q: 'length', get: (r) => r.length, set: (r, v) => ({ ...r, length: num(v) }), digits: 2 },
      { key: 'diameter', label: 'Diameter', q: 'diameter', get: (r) => r.diameter, set: (r, v) => ({ ...r, diameter: num(v) }), digits: 1 },
      { key: 'material', label: 'Material', get: (r) => r.material ?? '', set: (r, v) => ({ ...r, material: v || undefined }), type: 'select', options: ['', ...PIPE_MATERIALS.map((m) => m.name)] },
      { key: 'roughness', label: n.settings.friction === 'DW' ? 'ε (mm)' : 'H-W C', get: (r) => r.roughness, set: (r, v) => ({ ...r, roughness: num(v) }) },
      { key: 'wavespeed', label: 'Wave speed', q: 'wavespeed', get: (r) => r.wavespeed, set: (r, v) => ({ ...r, wavespeed: num(v) }), digits: 1 },
      { key: 'class', label: 'Class', q: 'pressureHead', get: (r) => r.pressureClass, set: (r, v) => ({ ...r, pressureClass: num(v) || undefined }), digits: 1 },
      { key: 'k', label: 'ΣK', get: (r) => r.minorLoss ?? 0, set: (r, v) => ({ ...r, minorLoss: num(v) || 0 }) },
      { key: 'nrv', label: 'NRV', get: (r) => !!r.checkValve, set: (r, v) => ({ ...r, checkValve: v === '1' ? r.checkValve ?? { mode: 'ideal', kOpen: 1 } : undefined }), type: 'bool' },
      { key: 'closed', label: 'Closed', get: (r) => !!r.closed, set: (r, v) => ({ ...r, closed: v === '1' || undefined }), type: 'bool' },
    ],
  };
  const pumps: Sheet<Pump> = {
    key: 'pumps', label: 'Pumps', id: (r) => r.id, ref: (r) => ({ type: 'pump', id: r.id }),
    write: (n, rows) => { const m = new Map(rows.map((r) => [r.id, r])); return { ...n, pumps: n.pumps.map((x) => m.get(x.id) ?? x) }; },
    rows: (n) => n.pumps,
    cols: () => [
      { key: 'id', label: 'ID', get: (r) => r.id, type: 'text' },
      { key: 'from', label: 'Suction', get: (r) => r.from, type: 'text' },
      { key: 'to', label: 'Discharge', get: (r) => r.to, type: 'text' },
      { key: 'h0', label: 'Shut-off head', q: 'head', get: (r) => r.curve[0]?.[1], set: (r, v) => ({ ...r, curve: r.curve.map((c, i) => (i === 0 ? [c[0], num(v)] : c)) as [number, number][] }) },
      { key: 'qr', label: 'Duty flow', q: 'flow', get: (r) => r.curve[Math.min(1, r.curve.length - 1)]?.[0], set: (r, v) => ({ ...r, curve: r.curve.map((c, i) => (i === Math.min(1, r.curve.length - 1) ? [num(v), c[1]] : c)) as [number, number][] }) },
      { key: 'hr', label: 'Duty head', q: 'head', get: (r) => r.curve[Math.min(1, r.curve.length - 1)]?.[1], set: (r, v) => ({ ...r, curve: r.curve.map((c, i) => (i === Math.min(1, r.curve.length - 1) ? [c[0], num(v)] : c)) as [number, number][] }) },
      { key: 'eff', label: 'Eff. %', get: (r) => Math.round(r.efficiency * 1000) / 10, set: (r, v) => ({ ...r, efficiency: num(v) / 100 }) },
      { key: 'speed', label: 'rpm', get: (r) => r.speed, set: (r, v) => ({ ...r, speed: num(v) }) },
      { key: 'inertia', label: 'Inertia', q: 'inertia', get: (r) => r.inertia, set: (r, v) => ({ ...r, inertia: num(v) }) },
      { key: 'nrv', label: 'NRV', get: (r) => r.checkValve, set: (r, v) => ({ ...r, checkValve: v === '1' }), type: 'bool' },
      { key: 'on', label: 'Running', get: (r) => r.on, set: (r, v) => ({ ...r, on: v === '1' }), type: 'bool' },
    ],
  };
  const valves: Sheet<Valve> = {
    key: 'valves', label: 'Valves', id: (r) => r.id, ref: (r) => ({ type: 'valve', id: r.id }),
    write: (n, rows) => { const m = new Map(rows.map((r) => [r.id, r])); return { ...n, valves: n.valves.map((x) => m.get(x.id) ?? x) }; },
    rows: (n) => n.valves,
    cols: () => [
      { key: 'id', label: 'ID', get: (r) => r.id, type: 'text' },
      { key: 'type', label: 'Type', get: (r) => EL[valveKind(r)].name, type: 'text' },
      { key: 'from', label: 'From', get: (r) => r.from, type: 'text' },
      { key: 'to', label: 'To', get: (r) => r.to, type: 'text' },
      { key: 'd', label: 'Diameter', q: 'diameter', get: (r) => r.diameter, set: (r, v) => ({ ...r, diameter: num(v) }), digits: 1 },
      { key: 'k0', label: 'K open', get: (r) => r.k0, set: (r, v) => ({ ...r, k0: num(v) }) },
      { key: 'open', label: 'Stroke', get: (r) => r.opening, set: (r, v) => ({ ...r, opening: Math.max(0, Math.min(1, num(v))) }) },
      { key: 'law', label: 'Characteristic', get: (r) => r.law ?? 'area', set: (r, v) => ({ ...r, law: v as Valve['law'] }), type: 'select', options: ['area', 'gate', 'globe', 'ball', 'butterfly', 'needle', 'curve'] },
      { key: 'set', label: 'Set point', get: (r) => r.control?.set ?? '', set: (r, v) => (r.control ? { ...r, control: { ...r.control, set: num(v) } } : r) },
    ],
  };
  const vessels: Sheet<NetNode> = {
    key: 'vessels', label: 'Air vessels', id: (r) => r.id, ref: (r) => ({ type: 'node', id: r.id }), write: writeNodes,
    rows: (n) => n.nodes.filter((x) => x.vessel),
    cols: () => [
      { key: 'id', label: 'Node', get: (r) => r.id, type: 'text' },
      { key: 'vol', label: 'Volume', q: 'volume', get: (r) => r.vessel!.volume, set: (r, v) => ({ ...r, vessel: { ...r.vessel!, volume: num(v) } }) },
      { key: 'gas', label: 'Initial gas', q: 'volume', get: (r) => r.vessel!.gasVolume, set: (r, v) => ({ ...r, vessel: { ...r.vessel!, gasVolume: num(v) } }) },
      { key: 'shape', label: 'Shape', get: (r) => r.vessel!.shape ?? 'vertical', set: (r, v) => ({ ...r, vessel: { ...r.vessel!, shape: v as 'vertical' } }), type: 'select', options: ['vertical', 'horizontal', 'sphere'] },
      { key: 'n', label: 'Polytropic n', get: (r) => r.vessel!.n, set: (r, v) => ({ ...r, vessel: { ...r.vessel!, n: num(v) } }) },
      { key: 'cd', label: 'Connection Ø', q: 'diameter', get: (r) => r.vessel!.connDiameter, set: (r, v) => ({ ...r, vessel: { ...r.vessel!, connDiameter: num(v) } }), digits: 1 },
      { key: 'kin', label: 'K in', get: (r) => r.vessel!.kIn, set: (r, v) => ({ ...r, vessel: { ...r.vessel!, kIn: num(v) } }) },
      { key: 'kout', label: 'K out', get: (r) => r.vessel!.kOut, set: (r, v) => ({ ...r, vessel: { ...r.vessel!, kOut: num(v) } }) },
      { key: 'bl', label: 'Bladder', get: (r) => !!r.vessel!.bladder, set: (r, v) => ({ ...r, vessel: { ...r.vessel!, bladder: v === '1' || undefined } }), type: 'bool' },
    ],
  };
  const airValves: Sheet<NetNode> = {
    key: 'airvalves', label: 'Air valves', id: (r) => r.id, ref: (r) => ({ type: 'node', id: r.id }), write: writeNodes,
    rows: (n) => n.nodes.filter((x) => x.airValve),
    cols: () => [
      { key: 'id', label: 'Node', get: (r) => r.id, type: 'text' },
      { key: 'type', label: 'Type', get: (r) => r.airValve!.type ?? 'double', set: (r, v) => ({ ...r, airValve: { ...r.airValve!, type: v as 'double' } }), type: 'select', options: ['double', 'threeStage', 'vacuumBreaker', 'releaseOnly', 'curve'] },
      { key: 'in', label: 'Inflow orifice', q: 'smallDiameter', get: (r) => r.airValve!.inDiameter, set: (r, v) => ({ ...r, airValve: { ...r.airValve!, inDiameter: num(v) } }), digits: 1 },
      { key: 'out', label: 'Outflow orifice', q: 'smallDiameter', get: (r) => r.airValve!.outDiameter, set: (r, v) => ({ ...r, airValve: { ...r.airValve!, outDiameter: num(v) } }), digits: 1 },
      { key: 'small', label: 'Small orifice', q: 'smallDiameter', get: (r) => r.airValve!.smallDiameter, set: (r, v) => ({ ...r, airValve: { ...r.airValve!, smallDiameter: num(v) || undefined } }), digits: 2 },
      { key: 'tj', label: 'Treat as junction', get: (r) => !!r.airValve!.treatAsJunction, set: (r, v) => ({ ...r, airValve: { ...r.airValve!, treatAsJunction: v === '1' || undefined } }), type: 'bool' },
    ],
  };
  const otherDev: Sheet<NetNode> = {
    key: 'otherdev', label: 'Other devices', id: (r) => r.id, ref: (r) => ({ type: 'node', id: r.id }), write: writeNodes,
    rows: (n) => n.nodes.filter((x) => x.tank || x.sav || x.relief || x.outlet),
    cols: () => [
      { key: 'id', label: 'Node', get: (r) => r.id, type: 'text' },
      { key: 'what', label: 'Devices', get: (r) => [r.tank && (r.tank.oneWay ? 'Feed tank' : 'Standpipe'), r.sav && 'Anticipator', r.relief && 'Relief', r.outlet && (r.outlet.trigger === 'pressure' ? 'Burst disc' : 'Blow-off')].filter(Boolean).join(', '), type: 'text' },
      { key: 'tankD', label: 'Tank Ø', q: 'length', get: (r) => r.tank?.diameter, set: (r, v) => (r.tank ? { ...r, tank: { ...r.tank, diameter: num(v) } } : r) },
      { key: 'top', label: 'Tank top', q: 'elevation', get: (r) => r.tank?.topElev, set: (r, v) => (r.tank ? { ...r, tank: { ...r.tank, topElev: num(v) } } : r) },
      { key: 'rset', label: 'Relief set', q: 'pressureHead', get: (r) => r.relief?.setHead, set: (r, v) => (r.relief ? { ...r, relief: { ...r.relief, setHead: num(v) } } : r) },
      { key: 'slow', label: 'Anticipator low set', q: 'pressureHead', get: (r) => r.sav?.lowSet, set: (r, v) => (r.sav ? { ...r, sav: { ...r.sav, lowSet: num(v) } } : r) },
      { key: 'od', label: 'Outlet Ø', q: 'diameter', get: (r) => r.outlet?.diameter, set: (r, v) => (r.outlet ? { ...r, outlet: { ...r.outlet, diameter: num(v) } } : r), digits: 1 },
      { key: 'ot', label: 'Opens at (s) / bursts', get: (r) => (r.outlet ? (r.outlet.trigger === 'time' ? r.outlet.time ?? 0 : `${r.outlet.burstHead} m`) : ''), type: 'text' },
    ],
  };
  type NR = { id: string; n: NetNode };
  const nodeRes: Sheet<NR> = {
    key: 'noderes', label: 'Node results', results: true, id: (r) => r.id, ref: (r) => ({ type: 'node', id: r.id }),
    rows: (n, r) => (r ? n.nodes.filter((x) => r.nodeHead[x.id]).map((x) => ({ id: x.id, n: x })) : []),
    cols: (_n, r) => [
      { key: 'id', label: 'Node', get: (x) => x.id, type: 'text' },
      { key: 'elev', label: 'Elevation', q: 'elevation', get: (x) => x.n.elev },
      { key: 'hs', label: 'Steady head', q: 'head', get: (x) => r!.steady.heads[x.id] },
      { key: 'ps', label: 'Steady pressure', q: 'pressureHead', get: (x) => r!.steady.heads[x.id] - x.n.elev },
      { key: 'hmax', label: 'Max head', q: 'head', get: (x) => r!.nodeMax[x.id] },
      { key: 'hmin', label: 'Min head', q: 'head', get: (x) => r!.nodeMin[x.id] },
      { key: 'pmax', label: 'Max pressure', q: 'pressureHead', get: (x) => r!.nodeMax[x.id] - x.n.elev },
      { key: 'pmin', label: 'Min pressure', q: 'pressureHead', get: (x) => r!.nodeMin[x.id] - x.n.elev },
      { key: 'rise', label: 'Surge up', q: 'head', get: (x) => r!.nodeMax[x.id] - r!.steady.heads[x.id] },
      { key: 'drop', label: 'Surge down', q: 'head', get: (x) => r!.steady.heads[x.id] - r!.nodeMin[x.id] },
    ],
  };
  type PR = { id: string; p: Pipe };
  const pipeRes: Sheet<PR> = {
    key: 'piperes', label: 'Pipe results', results: true, id: (r) => r.id, ref: (r) => ({ type: 'pipe', id: r.id }),
    rows: (n, r) => (r ? n.pipes.filter((p) => r.envelopes.some((e) => e.id === p.id)).map((p) => ({ id: p.id, p })) : []),
    cols: (_n, r) => {
      const env = new Map(r!.envelopes.map((e) => [e.id, e]));
      const ext = (id: string, f: 'max' | 'min' | 'cav') => { const e = env.get(id)!; let v = f === 'min' ? Infinity : -Infinity; for (let i = 0; i < e.s.length; i++) { const x = f === 'max' ? e.hMax[i] - e.z[i] : f === 'min' ? e.hMin[i] - e.z[i] : e.cavMax[i]; v = f === 'min' ? Math.min(v, x) : Math.max(v, x); } return v; };
      return [
        { key: 'id', label: 'Pipe', get: (x) => x.id, type: 'text' },
        { key: 'q', label: 'Steady flow', q: 'flow', get: (x) => r!.steady.flows[x.id] },
        { key: 'v', label: 'Velocity', q: 'velocity', get: (x) => Math.abs(r!.steady.flows[x.id] ?? 0) / area(x.p.diameter), digits: 2 },
        { key: 'pmax', label: 'Max pressure', q: 'pressureHead', get: (x) => ext(x.id, 'max') },
        { key: 'pmin', label: 'Min pressure', q: 'pressureHead', get: (x) => ext(x.id, 'min') },
        { key: 'cls', label: 'Class', q: 'pressureHead', get: (x) => x.p.pressureClass },
        { key: 'use', label: '% of class', get: (x) => (x.p.pressureClass ? Math.round((ext(x.id, 'max') / x.p.pressureClass) * 1000) / 10 : '') },
        { key: 'cav', label: 'Vapour cavity (L)', get: (x) => Math.round(ext(x.id, 'cav') * 1e5) / 100 },
        { key: 'adj', label: 'Wave-speed adj. %', get: (x) => +(((r!.pipeAdjust[x.id] ?? 0) * 100).toFixed(3)) },
      ];
    },
  };
  return [junctions, sources, pipes, pumps, valves, vessels, airValves, otherDev, nodeRes, pipeRes];
}

const show = (v: V, q: Quantity | undefined, u: UnitPrefs, digits = 3): string => {
  if (v === undefined || v === '') return '';
  if (typeof v === 'boolean') return v ? '✓' : '';
  if (typeof v === 'number') { if (!Number.isFinite(v)) return '—'; const x = q ? v * unitOf(q, u).f : v; return String(+x.toFixed(digits)); }
  return v;
};

export function DataSheets({ net, setNet, result, onSelect, selected }: { net: Network; setNet: SetNet; result: TransientResult | null; onSelect: (r: ElRef[]) => void; selected: ElRef[] }) {
  const all = useMemo(() => sheets(), []);
  const [key, setKey] = useState('pipes');
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 } | null>(null);
  const units = useUnits();
  const sh = all.find((s) => s.key === key)!;
  const cols = sh.results && !result ? [] : sh.cols(net, result);
  let rows = sh.rows(net, result);
  if (filter.trim()) { const f = filter.trim().toLowerCase(); rows = rows.filter((r) => cols.some((c) => String(c.get(r) ?? '').toLowerCase().includes(f))); }
  if (sort) { const c = cols.find((x) => x.key === sort.col); if (c) rows = [...rows].sort((a, b) => { const va = c.get(a), vb = c.get(b); return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va ?? '').localeCompare(String(vb ?? ''), undefined, { numeric: true })) * sort.dir; }); }
  const selIds = new Set(selected.map((r) => `${r.type}:${r.id}`));
  const edit = (row: unknown, c: Col<unknown>, v: string) => {
    if (!c.set || !sh.write) return;
    let val = v;
    if (c.q && (c.type ?? 'num') === 'num') { const x = num(v); if (!Number.isFinite(x)) return; val = String(x / unitOf(c.q, units).f); }
    const next = c.set(row, val);
    setNet((n) => sh.write!(n, [next]), `Edit ${sh.label.toLowerCase()}`);
  };
  const paste = (r0: number, c0: number, text: string) => {
    if (!sh.write) return;
    const grid = text.replace(/\r/g, '').split('\n').filter((l) => l.length).map((l) => l.split('\t'));
    const changed: unknown[] = [];
    grid.forEach((line, i) => {
      let row = rows[r0 + i];
      if (!row) return;
      line.forEach((cell, j) => {
        const c = cols[c0 + j];
        if (!c?.set) return;
        let val = cell.trim();
        if (c.q && (c.type ?? 'num') === 'num') { const x = num(val); if (!Number.isFinite(x)) return; val = String(x / unitOf(c.q, units).f); }
        row = c.set(row, val);
      });
      changed.push(row);
    });
    if (changed.length) setNet((n) => sh.write!(n, changed), `Paste into ${sh.label.toLowerCase()}`);
  };
  const csv = () => {
    const head = cols.map((c) => (c.q ? `${c.label} (${unitOf(c.q, units).u})` : c.label));
    const body = rows.map((r) => cols.map((c) => { const s = show(c.get(r), c.q, units, 6); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(','));
    download(`${net.name.replace(/[^\w-]+/g, '_')}-${sh.key}.csv`, [head.join(','), ...body].join('\n'), 'text/csv');
  };
  return (
    <div className="sheets">
      <div className="sheets-bar">
        <div className="seg small">
          {all.map((s) => <button key={s.key} className={`seg-btn ${key === s.key ? 'on' : ''} ${s.results ? 'res' : ''}`} onClick={() => { setKey(s.key); setSort(null); }}>{s.label} <span className="mono">{s.rows(net, result).length}</span></button>)}
        </div>
        <input className="search small" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className="btn small" onClick={csv} disabled={!rows.length}>Export CSV</button>
      </div>
      {sh.results && !result ? <div className="empty">Run the model to fill this table.</div> : !rows.length ? <div className="empty">No {sh.label.toLowerCase()} in the model.</div> : (
        <div className="sheet-scroll">
          <table className="grid sheet">
            <thead><tr>{cols.map((c) => (
              <th key={c.key} onClick={() => setSort((s) => (s?.col === c.key ? (s.dir === 1 ? { col: c.key, dir: -1 } : null) : { col: c.key, dir: 1 }))} className={c.set ? 'editable' : ''}>
                {c.label}{c.q ? <em> {unitOf(c.q, units).u}</em> : null}{sort?.col === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
              </th>))}</tr></thead>
            <tbody>{rows.slice(0, 3000).map((r, ri) => {
              const ref = sh.ref?.(r);
              const isS = ref && selIds.has(`${ref.type}:${ref.id}`);
              return (
                <tr key={sh.id(r)} className={isS ? 'sel' : ''} onClick={() => ref && onSelect([ref])}>
                  {cols.map((c, ci) => {
                    const v = c.get(r);
                    if (!c.set || !sh.write) return <td key={c.key} className={typeof v === 'number' ? 'num' : ''}>{show(v, c.q, units, c.digits ?? 3)}</td>;
                    if (c.type === 'bool') return <td key={c.key}><input type="checkbox" checked={!!v} onChange={(e) => edit(r, c, e.target.checked ? '1' : '0')} /></td>;
                    if (c.type === 'select') return <td key={c.key}><select className="cell" value={String(v ?? '')} onChange={(e) => edit(r, c, e.target.value)}>{c.options!.map((o) => <option key={o} value={o}>{o || '—'}</option>)}</select></td>;
                    return <td key={c.key}><input className="cell num" defaultValue={show(v, c.q, units, c.digits ?? 4)} key={`${show(v, c.q, units, c.digits ?? 4)}|${units.system}|${units.flow}|${units.pressure}`}
                      onBlur={(e) => e.target.value !== show(v, c.q, units, c.digits ?? 4) && edit(r, c, e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      onPaste={(e) => { const t = e.clipboardData.getData('text'); if (t.includes('\t') || t.includes('\n')) { e.preventDefault(); paste(ri, ci, t); } }} /></td>;
                  })}
                </tr>
              );
            })}</tbody>
          </table>
          {rows.length > 3000 && <div className="hint">Showing the first 3,000 rows; filter or export to see the rest.</div>}
        </div>
      )}
    </div>
  );
}
