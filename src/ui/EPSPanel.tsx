// Daily operation: extended-period simulation (tanks, patterns, controls) and water quality, in the results dock.
// Run it, scrub through the day, colour the map by pressure or quality at any hour, and start a surge run from
// the state at that hour.
import { useMemo, useState } from 'react';
import { clock, defaultEPS, type EPSResult } from '../engine/eps';
import type { EPSSettings, Network, QualityMode, SimpleControl, StorageTank } from '../engine/types';
import { Chart, type Series } from './Chart';
import { fmtQ, uLabel, toShow, useUnits } from '../app/units';
import type { ElRef } from '../app/edit';

type SetNet = (f: (n: Network) => Network, label?: string) => void;
export type EPSColour = 'none' | 'pressure' | 'quality' | 'demand';
const PAL = ['#2c7bb6', '#00a6ca', '#00ccbc', '#90eb9d', '#f9d057', '#f29e2e', '#e76818', '#d7191c'];
const CAT = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#be185d', '#65a30d'];

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

export function EPSPanel({ net, setNet, result, busy, onRun, k, setK, colour, setColour, onSurgeAt, selected }: {
  net: Network; setNet: SetNet; result: EPSResult | null; busy: boolean; onRun: () => void;
  k: number; setK: (k: number) => void; colour: EPSColour; setColour: (c: EPSColour) => void;
  onSurgeAt: (t: number) => void; selected: ElRef[];
}) {
  const units = useUnits();
  const [tab, setTab] = useState<'results' | 'setup' | 'tanks' | 'patterns' | 'controls'>(result ? 'results' : 'setup');
  const e: EPSSettings = { ...defaultEPS(), ...(net.eps ?? {}) };
  const setE = (p: Partial<EPSSettings>) => setNet((n) => ({ ...n, eps: { ...defaultEPS(), ...(n.eps ?? {}), ...p } }), 'Extended period settings');
  const tanks = net.nodes.filter((n) => n.storage);
  const sources = net.nodes.filter((n) => n.kind === 'reservoir' && !n.storage);
  const linkIds = [...net.pipes.map((p) => p.id), ...net.pumps.map((p) => p.id), ...net.valves.map((v) => v.id)];

  const charts = useMemo(() => {
    if (!result) return null;
    const x = result.times.map((t) => t / 3600);
    const tankS: Series[] = Object.keys(result.level).map((id, i) => ({ name: `Tank ${id}`, color: CAT[i % CAT.length], x, y: result.level[id].map((v) => toShow(v, 'length', units)) }));
    const pumpS: Series[] = net.pumps.map((p, i) => ({ name: p.id, color: CAT[i % CAT.length], x, y: result.flow[p.id].map((q) => toShow(q, 'flow', units)) }));
    const sel = selected.filter((r) => r.type === 'node').map((r) => r.id).slice(0, 6);
    const nodes = sel.length ? sel : net.nodes.filter((n) => n.kind === 'junction').slice(0, 3).map((n) => n.id);
    const presS: Series[] = nodes.map((id, i) => ({ name: id, color: CAT[i % CAT.length], x, y: result.pressure[id].map((v) => toShow(v, 'pressureHead', units)) }));
    const qualS: Series[] = result.quality ? nodes.map((id, i) => ({ name: id, color: CAT[i % CAT.length], x, y: result.quality![id] })) : [];
    return { tankS, pumpS, presS, qualS, nodes };
  }, [result, net, selected, units]);

  const tabs: [typeof tab, string][] = [['results', 'Results'], ['setup', 'Settings'], ['tanks', `Tanks${tanks.length ? ` · ${tanks.length}` : ''}`], ['patterns', `Patterns${net.patterns?.length ? ` · ${net.patterns.length}` : ''}`], ['controls', `Controls${net.controls?.length ? ` · ${net.controls.length}` : ''}`]];
  return (
    <div className="eps">
      <div className="row" style={{ gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        <div className="tabs inline">{tabs.map(([k2, l]) => <button key={k2} className={`tab ${tab === k2 ? 'on' : ''}`} onClick={() => setTab(k2)}>{l}</button>)}</div>
        <div style={{ flex: 1 }} />
        <button className="btn primary small" disabled={busy} onClick={() => { onRun(); setTab('results'); }}>Run {e.duration / 3600} h</button>
      </div>

      {tab === 'setup' && (
        <div className="grid3">
          <label className="field"><span>Duration (h)</span><input type="number" min={1} value={e.duration / 3600} onChange={(ev) => setE({ duration: Math.max(1, +ev.target.value) * 3600 })} /></label>
          <label className="field"><span>Hydraulic step (min)</span><input type="number" min={1} value={e.hydStep / 60} onChange={(ev) => setE({ hydStep: Math.max(1, +ev.target.value) * 60 })} /></label>
          <label className="field"><span>Pattern step (min)</span><input type="number" min={1} value={(e.patternStep ?? e.hydStep) / 60} onChange={(ev) => setE({ patternStep: Math.max(1, +ev.target.value) * 60 })} /></label>
          <label className="field"><span>Start time of day</span><input type="time" value={`${String(Math.floor((e.startClock ?? 0) / 3600)).padStart(2, '0')}:${String(Math.floor(((e.startClock ?? 0) % 3600) / 60)).padStart(2, '0')}`} onChange={(ev) => { const [h, m] = ev.target.value.split(':').map(Number); setE({ startClock: h * 3600 + m * 60 }); }} /></label>
          <label className="field"><span>Junction default pattern</span>
            <select value={e.defaultPattern ?? ''} onChange={(ev) => setE({ defaultPattern: ev.target.value || undefined })}><option value="">None (constant)</option>{(net.patterns ?? []).map((p) => <option key={p.id}>{p.id}</option>)}</select>
          </label>
          <label className="field"><span>Water quality</span>
            <select value={e.quality} onChange={(ev) => setE({ quality: ev.target.value as QualityMode })}>
              <option value="none">None</option><option value="age">Water age</option><option value="trace">Source trace</option><option value="chemical">Chemical (chlorine…)</option>
            </select>
          </label>
          {e.quality === 'trace' && <label className="field"><span>Trace from</span><select value={e.traceNode ?? ''} onChange={(ev) => setE({ traceNode: ev.target.value })}><option value="">Choose…</option>{net.nodes.map((n) => <option key={n.id}>{n.id}</option>)}</select></label>}
          {e.quality === 'chemical' && <>
            <label className="field"><span>Chemical</span><input value={e.chemical ?? 'Chlorine'} onChange={(ev) => setE({ chemical: ev.target.value })} /></label>
            <label className="field"><span>Bulk decay (1/day, negative)</span><input type="number" step="0.1" value={e.bulk ?? 0} onChange={(ev) => setE({ bulk: +ev.target.value })} /></label>
            <label className="field"><span>Wall decay (m/day, negative)</span><input type="number" step="0.1" value={e.wall ?? 0} onChange={(ev) => setE({ wall: +ev.target.value })} /></label>
            <label className="field"><span>Quality step (s)</span><input type="number" min={10} value={e.qualStep ?? 300} onChange={(ev) => setE({ qualStep: Math.max(10, +ev.target.value) })} /></label>
          </>}
          {e.quality === 'chemical' && <div className="small muted" style={{ gridColumn: '1 / -1' }}>Source concentrations: set the initial quality of the fixed-level sources and tanks below (Tanks tab) or import them from EPANET. Booster stations can be set on junctions in the Tanks tab.</div>}
          <p className="small muted" style={{ gridColumn: '1 / -1', margin: 0 }}>The day is run as a series of steady states, as EPANET does (validated against EPANET 2.2 on its example networks). Then pick any hour and start a surge run from the state at that hour.</p>
        </div>
      )}

      {tab === 'tanks' && (
        <div>
          <p className="small muted" style={{ marginTop: 0 }}>A storage tank is a fixed-level source whose level changes over the day. Levels are above the tank bottom (the node elevation).</p>
          <table className="grid">
            <thead><tr><th>Node</th><th>Storage tank</th><th>Initial ({uLabel('length', units)})</th><th>Min</th><th>Max</th><th>Diameter</th><th>Initial quality</th><th>Head pattern</th></tr></thead>
            <tbody>
              {[...tanks, ...sources].map((n) => {
                const s = n.storage;
                const set = (p: Partial<StorageTank>) => setNet((m) => ({ ...m, nodes: m.nodes.map((x) => (x.id === n.id && x.storage ? { ...x, storage: { ...x.storage, ...p } } : x)) }), 'Tank');
                const cell = (k2: keyof StorageTank) => <td><input className="cell" type="number" value={s ? +(toShow(s[k2] as number, 'length', units)).toFixed(3) : ''} disabled={!s} onChange={(ev) => set({ [k2]: +ev.target.value / toShow(1, 'length', units) } as Partial<StorageTank>)} /></td>;
                return (
                  <tr key={n.id}>
                    <td className="mono">{n.id}</td>
                    <td><input type="checkbox" checked={!!s} onChange={(ev) => setNet((m) => ({ ...m, nodes: m.nodes.map((x) => (x.id !== n.id ? x : ev.target.checked ? { ...x, storage: { initLevel: Math.max((x.head ?? x.elev) - x.elev, 1), minLevel: 0.5, maxLevel: Math.max((x.head ?? x.elev) - x.elev + 3, 5), diameter: 20 } } : { ...x, storage: undefined })) }), 'Tank')} aria-label={`Storage tank at ${n.id}`} /></td>
                    {cell('initLevel')}{cell('minLevel')}{cell('maxLevel')}{cell('diameter')}
                    <td><input className="cell" type="number" value={n.quality ?? ''} onChange={(ev) => setNet((m) => ({ ...m, nodes: m.nodes.map((x) => (x.id === n.id ? { ...x, quality: ev.target.value === '' ? undefined : +ev.target.value } : x)) }), 'Quality')} /></td>
                    <td><select className="cell" value={n.pattern ?? ''} disabled={!!s} onChange={(ev) => setNet((m) => ({ ...m, nodes: m.nodes.map((x) => (x.id === n.id ? { ...x, pattern: ev.target.value || undefined } : x)) }), 'Pattern')}><option value="">—</option>{(net.patterns ?? []).map((p) => <option key={p.id}>{p.id}</option>)}</select></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!tanks.length && !sources.length && <p className="small muted">Add a fixed-level source first.</p>}
          <div className="label">Junction demand patterns and boosters</div>
          <table className="grid">
            <thead><tr><th>Junction</th><th>Demand ({uLabel('flow', units)})</th><th>Pattern</th><th>Booster (mg/L)</th></tr></thead>
            <tbody>{net.nodes.filter((n) => n.kind === 'junction' && (n.demand || n.pattern || n.booster !== undefined || selected.some((r) => r.id === n.id))).slice(0, 200).map((n) => (
              <tr key={n.id}>
                <td className="mono">{n.id}</td><td className="mono">{fmtQ(n.demand ?? 0, 'flow', 2, units)}</td>
                <td><select className="cell" value={n.pattern ?? ''} onChange={(ev) => setNet((m) => ({ ...m, nodes: m.nodes.map((x) => (x.id === n.id ? { ...x, pattern: ev.target.value || undefined } : x)) }), 'Pattern')}><option value="">Default</option>{(net.patterns ?? []).map((p) => <option key={p.id}>{p.id}</option>)}</select></td>
                <td><input className="cell" type="number" value={n.booster ?? ''} onChange={(ev) => setNet((m) => ({ ...m, nodes: m.nodes.map((x) => (x.id === n.id ? { ...x, booster: ev.target.value === '' ? undefined : +ev.target.value } : x)) }), 'Booster')} /></td>
              </tr>
            ))}</tbody>
          </table>
          <p className="small muted">Junctions with a demand are listed; select others on the drawing to add them.</p>
        </div>
      )}

      {tab === 'patterns' && (
        <div>
          <p className="small muted" style={{ marginTop: 0 }}>Each pattern multiplies demands (or a source's head) step by step, then repeats. Type the factors separated by commas or spaces, or paste a column from a spreadsheet.</p>
          {(net.patterns ?? []).map((p, i) => (
            <div key={i} className="row" style={{ gap: 6, marginBottom: 6, alignItems: 'flex-start' }}>
              <input className="cell boxed mono" style={{ width: 90 }} value={p.id} onChange={(ev) => setNet((m) => ({ ...m, patterns: m.patterns!.map((x, j) => (j === i ? { ...x, id: ev.target.value } : x)) }), 'Pattern')} aria-label="Pattern name" />
              <textarea rows={2} defaultValue={p.factors.join(', ')} onBlur={(ev) => { const f = ev.target.value.split(/[\s,;]+/).map(Number).filter(Number.isFinite); setNet((m) => ({ ...m, patterns: m.patterns!.map((x, j) => (j === i ? { ...x, factors: f.length ? f : [1] } : x)) }), 'Pattern'); }} aria-label={`Factors of ${p.id}`} />
              <svg width="120" height="36" aria-hidden="true" style={{ flex: 'none' }}>{(() => { const mx = Math.max(...p.factors, 1e-9); const w = 120 / p.factors.length; return p.factors.map((f, j) => <rect key={j} x={j * w} y={36 - (f / mx) * 34} width={Math.max(w - 1, 1)} height={(f / mx) * 34} fill="var(--accent)" opacity="0.7" />); })()}</svg>
              <button className="btn ghost small" onClick={() => setNet((m) => ({ ...m, patterns: m.patterns!.filter((_, j) => j !== i) }), 'Pattern')}>Remove</button>
            </div>
          ))}
          <div className="row" style={{ gap: 6 }}>
            <button className="btn small" onClick={() => setNet((m) => ({ ...m, patterns: [...(m.patterns ?? []), { id: String((m.patterns?.length ?? 0) + 1), factors: Array(24).fill(1) }] }), 'Pattern')}>+ Pattern</button>
            <button className="btn small" onClick={() => setNet((m) => ({ ...m, patterns: [...(m.patterns ?? []), { id: 'Residential', factors: [0.5, 0.4, 0.35, 0.35, 0.4, 0.6, 1.1, 1.5, 1.4, 1.2, 1.1, 1.05, 1.1, 1.0, 0.95, 0.95, 1.0, 1.2, 1.45, 1.5, 1.3, 1.0, 0.8, 0.6] }], eps: { ...defaultEPS(), ...(m.eps ?? {}), defaultPattern: m.eps?.defaultPattern ?? 'Residential' } }), 'Pattern')}>+ Typical residential day</button>
          </div>
        </div>
      )}

      {tab === 'controls' && (
        <div>
          <p className="small muted" style={{ marginTop: 0 }}>Switch a pump, pipe or valve at a time, or when a tank level or a node pressure passes a value.</p>
          <table className="grid">
            <thead><tr><th>Element</th><th>Action</th><th>When</th><th>Node</th><th /><th>Value</th><th /></tr></thead>
            <tbody>
              {(net.controls ?? []).map((c, i) => {
                const set = (p: Partial<SimpleControl>) => setNet((m) => ({ ...m, controls: m.controls!.map((x, j) => (j === i ? { ...x, ...p } : x)) }), 'Control');
                const when = c.at !== undefined ? 'time' : c.clock !== undefined ? 'clock' : 'node';
                return (
                  <tr key={i}>
                    <td><select className="cell" value={c.link} onChange={(ev) => set({ link: ev.target.value })}>{linkIds.map((id) => <option key={id}>{id}</option>)}</select></td>
                    <td><select className="cell" value={c.status ?? 'setting'} onChange={(ev) => (ev.target.value === 'setting' ? set({ status: undefined, setting: c.setting ?? 1 }) : set({ status: ev.target.value as 'open' | 'closed', setting: undefined }))}><option value="open">Open / run</option><option value="closed">Close / stop</option><option value="setting">Setting</option></select>{c.status === undefined && <input className="cell" type="number" value={c.setting ?? 1} onChange={(ev) => set({ setting: +ev.target.value })} />}</td>
                    <td><select className="cell" value={when} onChange={(ev) => (ev.target.value === 'time' ? set({ at: 3600, clock: undefined, node: undefined, op: undefined, value: undefined }) : ev.target.value === 'clock' ? set({ clock: 6 * 3600, at: undefined, node: undefined, op: undefined, value: undefined }) : set({ at: undefined, clock: undefined, node: tanks[0]?.id ?? net.nodes[0]?.id, op: 'below', value: 2 }))}><option value="time">After (h)</option><option value="clock">Every day at</option><option value="node">Node level / pressure</option></select></td>
                    <td>{when === 'node' && <select className="cell" value={c.node} onChange={(ev) => set({ node: ev.target.value })}>{net.nodes.map((n) => <option key={n.id}>{n.id}</option>)}</select>}</td>
                    <td>{when === 'node' && <select className="cell" value={c.op} onChange={(ev) => set({ op: ev.target.value as 'above' | 'below' })}><option value="below">below</option><option value="above">above</option></select>}</td>
                    <td>{when === 'time' ? <input className="cell" type="number" value={(c.at ?? 0) / 3600} onChange={(ev) => set({ at: +ev.target.value * 3600 })} /> : when === 'clock' ? <input className="cell" type="time" value={`${String(Math.floor((c.clock ?? 0) / 3600)).padStart(2, '0')}:${String(Math.floor(((c.clock ?? 0) % 3600) / 60)).padStart(2, '0')}`} onChange={(ev) => { const [h, mm] = ev.target.value.split(':').map(Number); set({ clock: h * 3600 + mm * 60 }); }} /> : <input className="cell" type="number" value={c.value ?? 0} onChange={(ev) => set({ value: +ev.target.value })} title="Tank level above its bottom, or junction pressure (m)" />}</td>
                    <td><button className="btn ghost small" onClick={() => setNet((m) => ({ ...m, controls: m.controls!.filter((_, j) => j !== i) }), 'Control')} aria-label="Remove control">×</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button className="btn small" style={{ marginTop: 6 }} disabled={!linkIds.length} onClick={() => setNet((m) => ({ ...m, controls: [...(m.controls ?? []), { link: m.pumps[0]?.id ?? linkIds[0], status: 'closed', node: tanks[0]?.id ?? m.nodes[0].id, op: 'above', value: tanks[0]?.storage ? tanks[0].storage.maxLevel - 0.5 : 30 }] }), 'Control')}>+ Control</button>
        </div>
      )}

      {tab === 'results' && (!result ? <div className="empty">Press <b>Run</b> to simulate the period.</div> : charts && (
        <div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            <span className="mono small" style={{ minWidth: 48 }}>{clock(result.times[k] ?? 0)}</span>
            <input type="range" min={0} max={result.times.length - 1} value={k} onChange={(ev) => setK(+ev.target.value)} style={{ flex: 1, minWidth: 160 }} aria-label="Time of day" />
            <select className="cell boxed" style={{ width: 170 }} value={colour} onChange={(ev) => setColour(ev.target.value as EPSColour)} aria-label="Colour the map by">
              <option value="none">Map: design colours</option><option value="pressure">Map: pressure</option><option value="demand">Map: demand</option>{result.quality && <option value="quality">Map: water quality</option>}
            </select>
            <button className="btn small" onClick={() => onSurgeAt(result.times[k])} title="Set the model to the tank levels, demands and pump states of this hour, ready for a surge run">Surge run from {clock(result.times[k])}</button>
          </div>
          <div className="stats" style={{ marginBottom: 6 }}>
            {Object.keys(result.level).map((id) => <div className="stat" key={id}><b>{fmtQ(Math.min(...result.level[id]), 'length', 2, units)} – {fmtQ(Math.max(...result.level[id]), 'length', 2, units)}</b><span>Tank {id} level</span></div>)}
            {net.pumps.map((p) => <div className="stat" key={p.id}><b>{result.energy[p.id].toFixed(0)} kWh</b><span>{p.id} energy</span></div>)}
            <div className="stat"><b>{result.solves}</b><span>Hydraulic solves</span></div>
          </div>
          <div className="grid2">
            {charts.tankS.length > 0 && <div><div className="label">Tank levels</div><Chart series={charts.tankS} xLabel="Time (h)" yLabel={`Level (${uLabel('length', units)})`} xUnit="h" yUnit={uLabel('length', units)} vLine={result.times[k] / 3600} height={190} /></div>}
            {charts.pumpS.length > 0 && <div><div className="label">Pump flows</div><Chart series={charts.pumpS} xLabel="Time (h)" yLabel={`Flow (${uLabel('flow', units)})`} xUnit="h" yUnit={uLabel('flow', units)} vLine={result.times[k] / 3600} height={190} /></div>}
            <div><div className="label">Pressure · {charts.nodes.join(', ')}</div><Chart series={charts.presS} xLabel="Time (h)" yLabel={`Pressure (${uLabel('pressureHead', units)})`} xUnit="h" yUnit={uLabel('pressureHead', units)} vLine={result.times[k] / 3600} height={190} /></div>
            {charts.qualS.length > 0 && <div><div className="label">{net.eps?.quality === 'age' ? 'Water age' : net.eps?.quality === 'trace' ? `Water from ${net.eps.traceNode}` : net.eps?.chemical ?? 'Chemical'} ({result.qualityUnit})</div><Chart series={charts.qualS} xLabel="Time (h)" yLabel={result.qualityUnit ?? ''} xUnit="h" yUnit={result.qualityUnit ?? ''} vLine={result.times[k] / 3600} height={190} /></div>}
          </div>
          <p className="small muted">Select nodes on the drawing to plot them.</p>
          {(result.log.length > 0 || result.warnings.length > 0) && <>
            <div className="label">Events</div>
            <ul className="small" style={{ maxHeight: 140, overflow: 'auto', margin: 0 }}>{result.log.slice(0, 200).map((l, i) => <li key={i}><span className="mono">{clock(l.t)}</span> {l.text}</li>)}{result.warnings.map((w, i) => <li key={`w${i}`} className="warn">{w}</li>)}</ul>
          </>}
        </div>
      ))}
    </div>
  );
}
