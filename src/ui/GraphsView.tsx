// Graph builder: plot any variable of any element against time, several on one chart, in display units;
// export the series to CSV. The element-by-element device histories stay available under "All devices".
import { useMemo, useState } from 'react';
import type { TransientResult } from '../engine/transient';
import { turbineSpeeds } from '../engine/analysis';
import { area, type Network } from '../engine/types';
import { Chart, type Series } from './Chart';
import { HistoryView } from './HistoryView';
import { unitOf, useUnits, type Quantity } from '../app/units';
import type { ElRef } from '../app/edit';
import { download } from './util';

const COLORS = ['#e0620c', '#2563eb', '#16a34a', '#a855f7', '#e11d48', '#0891b2', '#ca8a04', '#64748b'];
export interface GraphItem { ref: ElRef; v: string }
interface VarDef { v: string; label: string; q: Quantity | null; unit?: string; get: (net: Network, r: TransientResult, id: string) => ArrayLike<number> | null }

const VARS: Record<ElRef['type'], VarDef[]> = {
  node: [
    { v: 'p', label: 'Pressure', q: 'pressureHead', get: (n, r, id) => { const h = r.nodeHead[id], z = n.nodes.find((x) => x.id === id)?.elev ?? 0; return h ? Array.from(h, (x) => x - z) : null; } },
    { v: 'h', label: 'Head (HGL)', q: 'head', get: (_n, r, id) => r.nodeHead[id] ?? null },
    { v: 'gas', label: 'Vessel gas volume', q: 'volume', get: (_n, r, id) => r.vessels[id]?.gas ?? null },
    { v: 'lvl', label: 'Vessel / tank level', q: 'elevation', get: (_n, r, id) => r.vessels[id]?.level ?? r.tanks[id]?.level ?? null },
    { v: 'air', label: 'Air volume at air valve', q: 'volume', get: (_n, r, id) => r.airValves[id]?.air ?? null },
    { v: 'dq', label: 'Device discharge', q: 'flow', get: (_n, r, id) => r.savs[id]?.flow ?? r.reliefs[id]?.flow ?? r.outlets[id]?.flow ?? null },
  ],
  pipe: [
    { v: 'q', label: 'Flow (mid-pipe)', q: 'flow', get: (_n, r, id) => r.frameFlows[id] ?? null },
    { v: 'vel', label: 'Velocity (mid-pipe)', q: 'velocity', get: (n, r, id) => { const q = r.frameFlows[id], p = n.pipes.find((x) => x.id === id); return q && p ? Array.from(q, (x) => x / area(p.diameter)) : null; } },
    { v: 'hs', label: 'Head at start', q: 'head', get: (_n, r, id) => { const s = r.frameSamples[id], h = r.frameHeads[id]; if (!s || !h) return null; const ns = s.length; return Array.from({ length: h.length / ns }, (_, f) => h[f * ns]); } },
    { v: 'he', label: 'Head at end', q: 'head', get: (_n, r, id) => { const s = r.frameSamples[id], h = r.frameHeads[id]; if (!s || !h) return null; const ns = s.length; return Array.from({ length: h.length / ns }, (_, f) => h[f * ns + ns - 1]); } },
  ],
  pump: [
    { v: 'spd', label: 'Speed', q: null, unit: '%', get: (_n, r, id) => (r.pumps[id] ? Array.from(r.pumps[id].speed, (x) => x * 100) : null) },
    { v: 'q', label: 'Flow', q: 'flow', get: (_n, r, id) => r.pumps[id]?.flow ?? null },
  ],
  valve: [
    { v: 'tspeed', label: 'Turbine speed', q: null, unit: '%', get: (n, r, id) => { const t = turbineSpeeds(n, r).find((x) => x.id === id); return t ? Array.from(t.speed, (x) => x * 100) : null; } },
    { v: 'tpower', label: 'Turbine power', q: 'power', get: (n, r, id) => turbineSpeeds(n, r).find((x) => x.id === id)?.power ?? null },
    { v: 'open', label: 'Flow area', q: null, unit: '%', get: (_n, r, id) => (r.valves[id] ? Array.from(r.valves[id].opening, (x) => x * 100) : null) },
    { v: 'q', label: 'Flow', q: 'flow', get: (_n, r, id) => r.valves[id]?.flow ?? null },
  ],
};

export function GraphsView({ net, result, items, setItems, selected, tNow }: { net: Network; result: TransientResult; items: GraphItem[]; setItems: (f: (i: GraphItem[]) => GraphItem[]) => void; selected: ElRef[]; tNow: number }) {
  const units = useUnits();
  const [tab, setTab] = useState<'builder' | 'devices'>('builder');
  const t = result.times;
  // charts grouped by quantity so units never mix on one axis
  const charts = useMemo(() => {
    const byQ = new Map<string, { title: string; unit: string; series: Series[] }>();
    items.forEach((it, k) => {
      const def = VARS[it.ref.type].find((d) => d.v === it.v);
      if (!def) return;
      const y = def.get(net, result, it.ref.id);
      if (!y) return;
      const { f, u } = def.q ? unitOf(def.q, units) : { f: 1, u: def.unit ?? '' };
      const key = `${def.q ?? def.unit}`;
      if (!byQ.has(key)) byQ.set(key, { title: def.q ? def.label.replace(/ \(.*\)/, '') : def.label, unit: u, series: [] });
      byQ.get(key)!.series.push({ name: `${it.ref.id} · ${def.label}`, color: COLORS[k % COLORS.length], x: t, y: f === 1 ? y : Array.from(y, (v) => v * f) });
    });
    return [...byQ.values()];
  }, [items, net, result, units, t]);
  const addSelected = () => setItems((cur) => {
    const next = [...cur];
    for (const r of selected) {
      const def = VARS[r.type].find((d) => d.get(net, result, r.id));
      if (def && !next.some((x) => x.ref.id === r.id && x.v === def.v)) next.push({ ref: r, v: def.v });
    }
    return next;
  });
  const csv = () => {
    const cols = items.map((it) => { const def = VARS[it.ref.type].find((d) => d.v === it.v)!; const y = def.get(net, result, it.ref.id); const { f, u } = def.q ? unitOf(def.q, units) : { f: 1, u: def.unit ?? '' }; return { name: `${it.ref.id} ${def.label} (${u})`, y, f }; }).filter((c) => c.y);
    const rows = [['time (s)', ...cols.map((c) => c.name)].join(',')];
    for (let i = 0; i < t.length; i++) rows.push([t[i].toFixed(4), ...cols.map((c) => (c.y![i] * c.f).toFixed(4))].join(','));
    download(`${net.name.replace(/[^\w-]+/g, '_')}-graphs.csv`, rows.join('\n'), 'text/csv');
  };
  return (
    <div>
      <div className="row" style={{ gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        <div className="seg small">
          <button className={`seg-btn ${tab === 'builder' ? 'on' : ''}`} onClick={() => setTab('builder')}>Graph builder</button>
          <button className={`seg-btn ${tab === 'devices' ? 'on' : ''}`} onClick={() => setTab('devices')}>All devices</button>
        </div>
        {tab === 'builder' && <>
          <button className="btn small" onClick={addSelected} disabled={!selected.length}>+ Add selected element{selected.length > 1 ? 's' : ''}</button>
          <button className="btn small" onClick={csv} disabled={!items.length}>Export CSV</button>
          {items.length > 0 && <button className="btn ghost small" onClick={() => setItems(() => [])}>Clear</button>}
        </>}
      </div>
      {tab === 'devices' ? <HistoryView net={net} result={result} nodes={items.filter((i) => i.ref.type === 'node').map((i) => i.ref.id)} tNow={tNow} /> : (
        <>
          <div className="chips" style={{ marginBottom: 8 }}>
            {items.map((it, k) => (
              <span key={k} className="chip on" style={{ borderColor: COLORS[k % COLORS.length] }}>
                <b style={{ color: COLORS[k % COLORS.length] }}>{it.ref.id}</b>
                <select className="cell" value={it.v} onChange={(e) => setItems((cur) => cur.map((x, j) => (j === k ? { ...x, v: e.target.value } : x)))}>
                  {VARS[it.ref.type].filter((d) => d.get(net, result, it.ref.id)).map((d) => <option key={d.v} value={d.v}>{d.label}</option>)}
                </select>
                <button className="chip-x" onClick={() => setItems((cur) => cur.filter((_, j) => j !== k))} aria-label="Remove">×</button>
              </span>
            ))}
            {!items.length && <span className="hint">Select elements on the drawing (Shift for several) and press “Add selected”. Clicking a node also adds it.</span>}
          </div>
          <div className={charts.length > 1 ? 'grid2' : ''}>
            {charts.map((c) => <Chart key={c.title + c.unit} series={c.series} xLabel="Time (s)" yLabel={`${c.title} (${c.unit})`} yUnit={c.unit} xUnit="s" vLine={tNow} height={charts.length > 1 ? 200 : 220} />)}
          </div>
        </>
      )}
    </div>
  );
}
