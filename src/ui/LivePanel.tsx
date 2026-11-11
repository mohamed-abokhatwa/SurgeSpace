// Live data and field data: connect to SCADA (MQTT over WebSocket, or the SurgeSpace data bridge for OPC UA and
// Modbus), map tags to elements, set the model to the live operating state, and compare the daily-operation
// model with historian data.
import { useEffect, useRef, useState } from 'react';
import { connectLive, type LiveSource, type LiveValue } from '../app/live';
import { applySnapshot, boundaryFromSeries, compareWithData, parseHistorianCsv, type Series, type TagMap, type TagQuantity } from '../app/scada';
import type { EPSResult } from '../engine/eps';
import { applyFactors, paramName, type CalParam } from '../app/calibrate';
import { call } from './client';
import type { Network } from '../engine/types';

type SetNet = (f: (n: Network) => Network, label?: string) => void;
const Q: [TagQuantity, string][] = [['pressure', 'Pressure (m)'], ['head', 'Head (m)'], ['level', 'Level (m)'], ['flow', 'Flow (m³/s)'], ['status', 'Status (0/1)'], ['speed', 'Speed ratio']];

export function LivePanel({ net, setNet, eps, onToast }: { net: Network; setNet: SetNet; eps: EPSResult | null; onToast: (m: string[]) => void }) {
  const cfg = net.scada ?? { tags: [] };
  const [src, setSrc] = useState<LiveSource>(() => ({ kind: 'mqtt', url: 'wss://', topics: ['#'], ...(cfg.source ?? {}) }));
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('Not connected');
  const [vals, setVals] = useState<Record<string, LiveValue>>({});
  const [hist, setHist] = useState<Series | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const mats = [...new Set(net.pipes.map((p) => p.material).filter((m): m is string => !!m))];
  const calOpts: CalParam[] = [{ kind: 'roughness' }, ...(mats.length > 1 ? mats.map((m) => ({ kind: 'roughness' as const, material: m })) : []), { kind: 'demand' }];
  const [calSel, setCalSel] = useState<boolean[]>([true]);
  const [calBusy, setCalBusy] = useState(false);
  useEffect(() => () => stop.current?.(), []);
  const maps: TagMap[] = cfg.tags;
  const setMaps = (f: (m: TagMap[]) => TagMap[]) => setNet((n) => ({ ...n, scada: { ...(n.scada ?? { tags: [] }), tags: f(n.scada?.tags ?? []) } }), 'Tag mapping');
  const elements = [...net.nodes.map((n) => n.id), ...net.pumps.map((p) => p.id), ...net.pipes.map((p) => p.id), ...net.valves.map((v) => v.id)];
  const connect = () => {
    stop.current?.();
    const buf: Record<string, LiveValue> = {};
    let t: ReturnType<typeof setTimeout> | null = null;
    stop.current = connectLive({ ...src, password: password || undefined }, (v) => { buf[v.tag] = v; if (!t) t = setTimeout(() => { setVals((o) => ({ ...o, ...buf })); t = null; }, 250); }, setStatus);
    setNet((n) => ({ ...n, scada: { ...(n.scada ?? { tags: [] }), source: { kind: src.kind, url: src.url, topics: src.topics, username: src.username } } }), 'Live source');
  };
  const tags = [...new Set([...Object.keys(vals), ...maps.map((m) => m.tag), ...(hist ? Object.keys(hist.values) : [])])].sort();
  const cmp = hist && eps ? compareWithData(net, eps, hist, maps) : [];
  return (
    <div className="grid2" style={{ alignItems: 'start' }}>
      <div>
        <div className="label" style={{ marginTop: 0 }}>Live source</div>
        <div className="grid2">
          <label className="field"><span>Source</span><select value={src.kind} onChange={(e) => setSrc({ ...src, kind: e.target.value as LiveSource['kind'], url: e.target.value === 'bridge' ? 'ws://localhost:8765' : 'wss://' })}><option value="mqtt">MQTT broker (WebSocket)</option><option value="bridge">SurgeSpace data bridge (OPC UA, Modbus)</option></select></label>
          <label className="field"><span>Address</span><input className="mono" value={src.url} onChange={(e) => setSrc({ ...src, url: e.target.value })} placeholder={src.kind === 'mqtt' ? 'wss://broker:8884/mqtt' : 'ws://localhost:8765'} /></label>
          {src.kind === 'mqtt' && <>
            <label className="field"><span>Topics (comma separated)</span><input className="mono" value={(src.topics ?? []).join(', ')} onChange={(e) => setSrc({ ...src, topics: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></label>
            <label className="field"><span>User name</span><input value={src.username ?? ''} onChange={(e) => setSrc({ ...src, username: e.target.value || undefined })} autoComplete="off" /></label>
            <label className="field"><span>Password (not saved)</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" /></label>
          </>}
        </div>
        <div className="row" style={{ gap: 6, marginTop: 8 }}>
          <button className="btn small primary" onClick={connect}>Connect</button>
          <button className="btn small" onClick={() => { stop.current?.(); stop.current = null; }}>Disconnect</button>
          <span className="small muted" role="status">{status}</span>
        </div>
        <p className="small muted">Read-only: SurgeSpace only subscribes; it never writes to the plant. OPC UA servers and Modbus devices are read by the SurgeSpace data bridge on a computer in the plant network.</p>
        <div className="label">Historian data</div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn small" onClick={() => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.csv,.txt'; i.onchange = () => i.files?.[0]?.text().then((t) => { try { const s = parseHistorianCsv(t); setHist(s); onToast([`${Object.keys(s.values).length} tags, ${s.times.length} rows over ${(s.times[s.times.length - 1] / 3600).toFixed(1)} h.`]); } catch (e) { onToast([(e as Error).message]); } }); i.click(); }}>Import historian CSV…</button>
          {hist && <span className="small muted">{Object.keys(hist.values).length} tags · {hist.times.length} rows</span>}
        </div>
        {hist && !eps && <p className="small muted">Run the daily operation (extended period) to compare the model with these data.</p>}
        {hist && maps.length > 0 && (
          <div className="row small" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            <span className="muted">Calibrate:</span>
            {calOpts.map((o, k) => <label key={k} className="row" style={{ gap: 3 }}><input type="checkbox" checked={calSel[k] ?? false} onChange={(e) => setCalSel((x) => { const y = [...x]; y[k] = e.target.checked; return y; })} />{paramName(o)}</label>)}
            <button className="btn small" disabled={calBusy || !calSel.some(Boolean)} onClick={async () => {
              const params = calOpts.filter((_, k) => calSel[k]);
              setCalBusy(true);
              try {
                const o = await call<{ calibration: { factors: number[]; before: number; after: number; runs: number } }>({ type: 'calibrate', net, data: hist, maps, params }, (m) => onToast([m]));
                const c = o.calibration;
                setNet((n) => applyFactors(n, params, c.factors), 'Calibration');
                onToast([`Calibrated in ${c.runs} runs: misfit ${c.before.toFixed(2)} → ${c.after.toFixed(2)}.`, ...params.map((p, k) => `${paramName(p)} × ${c.factors[k].toFixed(3)}`), 'Applied to the model (Undo with Ctrl+Z). Run the daily operation again to see the fit.']);
              } catch (e) { onToast([(e as Error).message]); } finally { setCalBusy(false); }
            }}>{calBusy ? 'Calibrating…' : 'Calibrate'}</button>
          </div>
        )}
        {cmp.length > 0 && (
          <table className="grid" style={{ marginTop: 6 }}>
            <thead><tr><th>Tag</th><th>Element</th><th>Points</th><th>Bias</th><th>RMS</th><th>r</th></tr></thead>
            <tbody>{cmp.map((c) => <tr key={c.tag}><td className="mono">{c.tag}</td><td>{c.element} · {c.quantity}</td><td>{c.points}</td><td className="mono">{c.bias.toFixed(3)}</td><td className="mono">{c.rms.toFixed(3)}</td><td className="mono">{Number.isFinite(c.r) ? c.r.toFixed(3) : '—'}</td></tr>)}</tbody>
          </table>
        )}
      </div>
      <div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="label" style={{ marginTop: 0 }}>Tags and mapping</div>
          <button className="btn small" disabled={!maps.length || !Object.keys(vals).length} title="Set source and tank levels, pump states and speeds from the latest live values" onClick={() => {
            const snap = Object.fromEntries(Object.values(vals).map((v) => [v.tag, v.value]));
            const out = applySnapshot(net, snap, maps);
            if (!out.changes.length) { onToast(['No mapped tag sets a level, pump status or speed.']); return; }
            setNet(() => out.net, 'Live snapshot'); onToast(['Model set to the live operating state:', ...out.changes.slice(0, 8), 'Undo with Ctrl+Z.']);
          }}>Set model to live state</button>
        </div>
        <table className="grid">
          <thead><tr><th>Tag</th><th>Live</th><th>Element</th><th>Quantity</th><th>× scale</th><th>+ offset</th><th /></tr></thead>
          <tbody>
            {tags.slice(0, 300).map((tag) => {
              const m = maps.find((x) => x.tag === tag);
              const set = (p: Partial<TagMap>) => setMaps((ms) => (ms.some((x) => x.tag === tag) ? ms.map((x) => (x.tag === tag ? { ...x, ...p } : x)) : [...ms, { tag, element: elements[0] ?? '', quantity: 'pressure', ...p }]));
              const v = vals[tag];
              return (
                <tr key={tag}>
                  <td className="mono small">{tag}</td>
                  <td className="mono">{v ? +v.value.toPrecision(5) : '—'}</td>
                  <td><select className="cell" value={m?.element ?? ''} onChange={(e) => (e.target.value ? set({ element: e.target.value }) : setMaps((ms) => ms.filter((x) => x.tag !== tag)))}><option value="">Not mapped</option>{elements.map((id) => <option key={id}>{id}</option>)}</select></td>
                  <td><select className="cell" value={m?.quantity ?? 'pressure'} disabled={!m} onChange={(e) => set({ quantity: e.target.value as TagQuantity })}>{Q.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                  <td><input className="cell" type="number" disabled={!m} value={m?.scale ?? 1} onChange={(e) => set({ scale: +e.target.value })} /></td>
                  <td><input className="cell" type="number" disabled={!m} value={m?.offset ?? 0} onChange={(e) => set({ offset: +e.target.value })} /></td>
                  <td>{m && hist?.values[tag] && net.nodes.find((n) => n.id === m.element)?.kind === 'reservoir' && <button className="btn ghost small" title="Use this measured history as the source's head during the surge run" onClick={() => { try { setNet((n) => boundaryFromSeries(n, hist, m), 'Boundary from data'); onToast([`${m.element} now follows ${tag} during the surge run.`]); } catch (e) { onToast([(e as Error).message]); } }}>As boundary</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!tags.length && <p className="small muted">Connect or import historian data to see the tags.</p>}
      </div>
    </div>
  );
}
