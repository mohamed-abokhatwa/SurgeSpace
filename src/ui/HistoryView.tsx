import { useMemo } from 'react';
import type { TransientResult } from '../engine/transient';
import type { Network } from '../engine/types';
import { Chart, type Series } from './Chart';

const COLORS = ['#e0620c', '#2563eb', '#16a34a', '#a855f7', '#e11d48', '#0891b2'];

export function HistoryView({ net, result, nodes, tNow }: { net: Network; result: TransientResult; nodes: string[]; tNow: number }) {
  const t = result.times;
  const series: Series[] = useMemo(() => nodes.filter((id) => result.nodeHead[id]).map((id, k) => {
    const n = net.nodes.find((x) => x.id === id)!;
    const h = result.nodeHead[id];
    return { name: `${id} pressure`, color: COLORS[k % COLORS.length], x: t, y: Array.from(h, (v) => v - n.elev) };
  }), [nodes, result, net.nodes, t]);
  const pumps = Object.entries(result.pumps);
  const vessels = Object.entries(result.vessels);
  const airs = Object.entries(result.airValves).filter(([, a]) => a.maxAir > 1e-4);
  const now = tNow;
  return (
    <div>
      <div className="label">Pressure head at selected nodes</div>
      {series.length ? <Chart series={series} xLabel="Time (s)" yLabel="Pressure head (m)" vLine={now} height={230} xUnit="s" /> : <div className="hint">Click nodes on the map to add them here.</div>}
      {pumps.length > 0 && (
        <>
          <div className="label">Pumps</div>
          <div className="grid2">
            <Chart series={pumps.slice(0, 1).map(([id, p]) => ({ name: `${id}${pumps.length > 1 ? ` (and ${pumps.length - 1} more)` : ''} speed`, color: '#e0620c', x: t, y: Array.from(p.speed, (v) => v * 100) }))} xLabel="Time (s)" yLabel="Speed (%)" vLine={now} height={170} yUnit="%" xUnit="s" />
            <Chart series={pumps.slice(0, 1).map(([id, p]) => ({ name: `${id} flow`, color: '#2563eb', x: t, y: Array.from(p.flow, (v) => v * 1000) }))} xLabel="Time (s)" yLabel="Flow per pump (L/s)" vLine={now} height={170} yUnit="L/s" xUnit="s" />
          </div>
        </>
      )}
      {vessels.length > 0 && (
        <>
          <div className="label">Surge vessels</div>
          <Chart series={vessels.flatMap(([id, v], k) => [
            { name: `${id} gas volume`, color: COLORS[(k + 2) % COLORS.length], x: t, y: v.gas },
            { name: `${id} total volume`, color: 'var(--faint)', x: [t[0], t[t.length - 1]], y: [v.volume, v.volume], dash: '4 4', width: 1 },
          ])} xLabel="Time (s)" yLabel="Volume (m³)" vLine={now} height={170} yUnit="m³" xUnit="s" />
        </>
      )}
      {airs.length > 0 && (
        <>
          <div className="label">Air valves</div>
          <Chart series={airs.map(([id, a], k) => ({ name: `${id} air volume`, color: COLORS[(k + 4) % COLORS.length], x: t, y: Array.from(a.air, (v) => v * 1000) }))} xLabel="Time (s)" yLabel="Air in pipe (L)" vLine={now} height={170} yUnit="L" xUnit="s" />
        </>
      )}
    </div>
  );
}
