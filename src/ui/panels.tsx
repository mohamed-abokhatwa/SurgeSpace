import { useState } from 'react';
import type { AirValveSuggestion, Check, VesselSizing } from '../engine/analysis';
import { DeviceDatalists, DeviceEditors } from './DeviceEditors';
import { CheckValveEditor, PairsField, ValveLinkEditor } from './ValveEditors';
import type { AirValveType } from '../engine/types';
import { estimateInertia, pumpRatedQ } from '../engine/hydraulics';
import type { TransientResult } from '../engine/transient';
import type { EventKind, Network, NetNode, Pipe, Pump, Valve } from '../engine/types';
import { Grid, num, type Col } from './Grid';
import type { Selection } from './MapView';
import { fmt } from './util';

type SetNet = (f: (n: Network) => Network) => void;

const nodeCols: Col<NetNode>[] = [
  { key: 'id', label: 'ID', get: (r) => r.id, set: (r, v) => ({ ...r, id: v }), width: 70 },
  { key: 'kind', label: 'Type', get: (r) => r.kind, set: (r, v) => ({ ...r, kind: v === 'reservoir' ? 'reservoir' : 'junction', head: v === 'reservoir' ? r.head ?? r.elev : r.head }), type: 'select', options: ['junction', 'reservoir'] },
  { key: 'x', label: 'X (m)', get: (r) => r.x, set: (r, v) => ({ ...r, x: num(v) }), type: 'num' },
  { key: 'y', label: 'Y (m)', get: (r) => r.y, set: (r, v) => ({ ...r, y: num(v) }), type: 'num' },
  { key: 'elev', label: 'Level (m)', get: (r) => r.elev, set: (r, v) => ({ ...r, elev: num(v) }), type: 'num' },
  { key: 'demand', label: 'Demand (L/s)', get: (r) => (r.kind === 'junction' ? +((r.demand ?? 0) * 1000).toFixed(3) : ''), set: (r, v) => ({ ...r, demand: (num(v) || 0) / 1000 }), type: 'num' },
  { key: 'head', label: 'Water level (m)', get: (r) => (r.kind === 'reservoir' ? r.head : ''), set: (r, v) => ({ ...r, head: num(v) }), type: 'num' },
];
const pipeCols: Col<Pipe>[] = [
  { key: 'id', label: 'ID', get: (r) => r.id, set: (r, v) => ({ ...r, id: v }), width: 60 },
  { key: 'from', label: 'From', get: (r) => r.from, set: (r, v) => ({ ...r, from: v }), width: 60 },
  { key: 'to', label: 'To', get: (r) => r.to, set: (r, v) => ({ ...r, to: v }), width: 60 },
  { key: 'length', label: 'Length (m)', get: (r) => r.length, set: (r, v) => ({ ...r, length: num(v) }), type: 'num' },
  { key: 'diameter', label: 'ID (mm)', get: (r) => +(r.diameter * 1000).toFixed(1), set: (r, v) => ({ ...r, diameter: num(v) / 1000 }), type: 'num' },
  { key: 'roughness', label: 'Rough.', get: (r) => r.roughness, set: (r, v) => ({ ...r, roughness: num(v) }), type: 'num' },
  { key: 'wavespeed', label: 'a (m/s)', get: (r) => r.wavespeed, set: (r, v) => ({ ...r, wavespeed: num(v) }), type: 'num' },
  { key: 'pressureClass', label: 'Class (m)', get: (r) => r.pressureClass ?? '', set: (r, v) => ({ ...r, pressureClass: num(v) || undefined }), type: 'num' },
  { key: 'cv', label: 'Check valve', get: (r) => !!r.checkValve, set: (r, v) => ({ ...r, checkValve: v === '1' ? r.checkValve ?? { mode: 'ideal', kOpen: 1 } : undefined }), type: 'bool' },
];
const pumpCols: Col<Pump>[] = [
  { key: 'id', label: 'ID', get: (r) => r.id, set: (r, v) => ({ ...r, id: v }) },
  { key: 'from', label: 'Suction', get: (r) => r.from, set: (r, v) => ({ ...r, from: v }) },
  { key: 'to', label: 'Discharge', get: (r) => r.to, set: (r, v) => ({ ...r, to: v }) },
  { key: 'h0', label: 'Shut-off H (m)', get: (r) => r.curve[0]?.[1], set: (r, v) => ({ ...r, curve: [[0, num(v)], r.curve[1] ?? [0.1, 30], r.curve[2] ?? [0.15, 20]] }), type: 'num' },
  { key: 'qr', label: 'Rated Q (L/s)', get: (r) => +((r.curve[1]?.[0] ?? 0) * 1000).toFixed(2), set: (r, v) => ({ ...r, curve: [r.curve[0], [num(v) / 1000, r.curve[1]?.[1] ?? 30], r.curve[2]] }), type: 'num' },
  { key: 'hr', label: 'Rated H (m)', get: (r) => r.curve[1]?.[1], set: (r, v) => ({ ...r, curve: [r.curve[0], [r.curve[1]?.[0] ?? 0.1, num(v)], r.curve[2]] }), type: 'num' },
  { key: 'qm', label: 'Max Q (L/s)', get: (r) => +((r.curve[2]?.[0] ?? 0) * 1000).toFixed(2), set: (r, v) => ({ ...r, curve: [r.curve[0], r.curve[1], [num(v) / 1000, r.curve[2]?.[1] ?? 20]] }), type: 'num' },
  { key: 'hm', label: 'H at max Q', get: (r) => r.curve[2]?.[1], set: (r, v) => ({ ...r, curve: [r.curve[0], r.curve[1], [r.curve[2]?.[0] ?? 0.15, num(v)]] }), type: 'num' },
  { key: 'eff', label: 'Eff. (%)', get: (r) => Math.round(r.efficiency * 100), set: (r, v) => ({ ...r, efficiency: num(v) / 100 }), type: 'num' },
  { key: 'speed', label: 'rpm', get: (r) => r.speed, set: (r, v) => ({ ...r, speed: num(v) }), type: 'num' },
  { key: 'inertia', label: 'I (kg·m²)', get: (r) => r.inertia, set: (r, v) => ({ ...r, inertia: num(v) }), type: 'num' },
  { key: 'check', label: 'NRV', get: (r) => r.checkValve, set: (r, v) => ({ ...r, checkValve: v === '1' }), type: 'bool' },
  { key: 'on', label: 'Running', get: (r) => r.on, set: (r, v) => ({ ...r, on: v === '1' }), type: 'bool' },
];
const valveCols: Col<Valve>[] = [
  { key: 'id', label: 'ID', get: (r) => r.id, set: (r, v) => ({ ...r, id: v }) },
  { key: 'from', label: 'From', get: (r) => r.from, set: (r, v) => ({ ...r, from: v }) },
  { key: 'to', label: 'To', get: (r) => r.to, set: (r, v) => ({ ...r, to: v }) },
  { key: 'd', label: 'D (mm)', get: (r) => +(r.diameter * 1000).toFixed(1), set: (r, v) => ({ ...r, diameter: num(v) / 1000 }), type: 'num' },
  { key: 'k0', label: 'K open', get: (r) => r.k0, set: (r, v) => ({ ...r, k0: num(v) }), type: 'num' },
  { key: 'open', label: 'Stroke', get: (r) => r.opening, set: (r, v) => ({ ...r, opening: num(v) }), type: 'num' },
  { key: 'check', label: 'NRV', get: (r) => !!r.check, set: (r, v) => ({ ...r, check: v === '1' }), type: 'bool' },
];

export function ModelPanel({ net, setNet, selection, onSelect }: { net: Network; setNet: SetNet; selection: Selection; onSelect: (s: Selection) => void }) {
  const [t, setT] = useState<'nodes' | 'pipes' | 'pumps' | 'valves'>('pipes');
  const selIdx = (type: string, list: { id: string }[]) => (selection?.type === type ? list.findIndex((x) => x.id === selection.id) : -1);
  return (
    <div>
      <div className="row" style={{ gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
        {(['nodes', 'pipes', 'pumps', 'valves'] as const).map((k) => (
          <button key={k} className={`btn small ${t === k ? 'primary' : ''}`} onClick={() => setT(k)}>
            {k[0].toUpperCase() + k.slice(1)} <span className="mono" style={{ opacity: 0.7 }}>{net[k].length}</span>
          </button>
        ))}
      </div>
      {t === 'nodes' && <Grid rows={net.nodes} cols={nodeCols} selected={selIdx('node', net.nodes)} onSelectRow={(i) => onSelect({ type: 'node', id: net.nodes[i].id })}
        onChange={(rows) => setNet((n) => ({ ...n, nodes: rows }))} newRow={(i) => ({ id: `N${i + 1}`, kind: 'junction' as const, x: 0, y: 0, elev: 0, demand: 0 })}
        onAdd={() => setNet((n) => ({ ...n, nodes: [...n.nodes, { id: `N${n.nodes.length + 1}`, kind: 'junction', x: (n.nodes.at(-1)?.x ?? 0) + 50, y: n.nodes.at(-1)?.y ?? 0, elev: n.nodes.at(-1)?.elev ?? 0, demand: 0 }] }))}
        onDelete={(i) => setNet((n) => ({ ...n, nodes: n.nodes.filter((_, k) => k !== i) }))} />}
      {t === 'pipes' && <Grid rows={net.pipes} cols={pipeCols} selected={selIdx('pipe', net.pipes)} onSelectRow={(i) => onSelect({ type: 'pipe', id: net.pipes[i].id })}
        onChange={(rows) => setNet((n) => ({ ...n, pipes: rows }))} newRow={(i) => ({ id: `P${i + 1}`, from: '', to: '', length: 100, diameter: 0.3, roughness: 0.1, wavespeed: 1000 })}
        onAdd={() => setNet((n) => ({ ...n, pipes: [...n.pipes, { id: `P${n.pipes.length + 1}`, from: n.nodes.at(-2)?.id ?? '', to: n.nodes.at(-1)?.id ?? '', length: 100, diameter: 0.3, roughness: 0.1, wavespeed: 1000, pressureClass: 100 }] }))}
        onDelete={(i) => setNet((n) => ({ ...n, pipes: n.pipes.filter((_, k) => k !== i) }))} />}
      {t === 'pumps' && <Grid rows={net.pumps} cols={pumpCols} selected={selIdx('pump', net.pumps)} onSelectRow={(i) => onSelect({ type: 'pump', id: net.pumps[i].id })}
        onChange={(rows) => setNet((n) => ({ ...n, pumps: rows }))}
        onAdd={() => setNet((n) => ({ ...n, pumps: [...n.pumps, { ...(n.pumps.at(-1) ?? { from: '', to: '', curve: [[0, 50], [0.1, 40], [0.15, 28]], efficiency: 0.8, speed: 1480, inertia: 2, checkValve: true, on: true }), id: `PU${n.pumps.length + 1}` } as Pump] }))}
        onDelete={(i) => setNet((n) => ({ ...n, pumps: n.pumps.filter((_, k) => k !== i) }))} />}
      {t === 'valves' && <Grid rows={net.valves} cols={valveCols} selected={selIdx('valve', net.valves)} onSelectRow={(i) => onSelect({ type: 'valve', id: net.valves[i].id })}
        onChange={(rows) => setNet((n) => ({ ...n, valves: rows }))}
        onAdd={() => setNet((n) => ({ ...n, valves: [...n.valves, { id: `V${n.valves.length + 1}`, from: '', to: '', diameter: 0.3, k0: 0.3, opening: 1 }] }))}
        onDelete={(i) => setNet((n) => ({ ...n, valves: n.valves.filter((_, k) => k !== i) }))} />}
      <p className="hint" style={{ marginTop: 10 }}>
        Paste straight from Excel: copy a block of cells, click the first cell here, and paste. Rows are added as needed.
        {t === 'pipes' && ' Roughness is ε in mm (Darcy–Weisbach) or C (Hazen–Williams), per Settings.'}
        {t === 'pumps' && ' Unknown inertia? Use the inspector to estimate it from the duty (Thorley).'}
      </p>
    </div>
  );
}

export function EventPanel({ net, setNet }: { net: Network; setNet: SetNet }) {
  const ev = net.event;
  const targets = ev.kind === 'pumpTrip' ? net.pumps.map((p) => p.id) : net.valves.map((v) => v.id);
  const set = (p: Partial<typeof ev>) => setNet((n) => ({ ...n, event: { ...n.event, ...p } }));
  return (
    <div>
      <div className="label">Surge event</div>
      <div className="field">
        <span>Event</span>
        <select value={ev.kind} onChange={(e) => {
          const kind = e.target.value as EventKind;
          set({ kind, targets: kind === 'pumpTrip' ? net.pumps.filter((p) => p.on).map((p) => p.id) : net.valves.slice(0, 1).map((v) => v.id), duration: ev.duration ?? 5 });
        }}>
          <option value="pumpTrip">Pump trip (power failure)</option>
          <option value="valveClose">Valve closure</option>
          <option value="valveOpen">Valve opening</option>
          <option value="none">None (steady check only)</option>
        </select>
      </div>
      {ev.kind !== 'none' && (
        <>
          <div className="label">{ev.kind === 'pumpTrip' ? 'Pumps that trip' : 'Valve'}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {targets.map((id) => (
              <label key={id} className="pill" style={{ cursor: 'pointer', borderColor: ev.targets.includes(id) ? 'var(--accent)' : undefined, color: ev.targets.includes(id) ? 'var(--accent)' : undefined }}>
                <input type="checkbox" style={{ display: 'none' }} checked={ev.targets.includes(id)} onChange={(e) => set({ targets: e.target.checked ? [...ev.targets, id] : ev.targets.filter((x) => x !== id) })} />
                {id}
              </label>
            ))}
            {!targets.length && <span className="muted small">No {ev.kind === 'pumpTrip' ? 'pumps' : 'valves'} in the model.</span>}
          </div>
          <div className="grid2" style={{ marginTop: 10 }}>
            <label className="field"><span>Start time (s)</span><input type="number" step="0.1" value={ev.start} onChange={(e) => set({ start: num(e.target.value) })} /></label>
            {ev.kind === 'pumpTrip' && (
              <label className="field"><span>How the pump stops</span>
                <select value={ev.pumpMode ?? 'trip'} onChange={(e) => set({ pumpMode: e.target.value as 'trip' | 'ramp' | 'start', duration: ev.duration ?? 5 })}>
                  <option value="trip">Power failure (inertia run-down)</option>
                  <option value="ramp">Controlled stop (VFD ramp)</option>
                  <option value="start">Pump start (speed ramp-up)</option>
                </select>
              </label>
            )}
            {ev.kind === 'pumpTrip' && (ev.pumpMode === 'ramp' || ev.pumpMode === 'start') && <label className="field"><span>{ev.pumpMode === 'start' ? 'Ramp-up time (s)' : 'Ramp-down time (s)'}</span><input type="number" step="0.5" value={ev.duration ?? 5} onChange={(e) => set({ duration: num(e.target.value) })} /></label>}
            {ev.kind !== 'pumpTrip' && (
              <label className="field"><span>Movement</span>
                <select value={ev.curve ? 'curve' : 'stroke'} onChange={(e) => set({ curve: e.target.value === 'curve' ? [[0, ev.kind === 'valveClose' ? 1 : 0], [(ev.duration ?? 5) / 2, 0.2], [ev.duration ?? 5, ev.finalOpening ?? (ev.kind === 'valveClose' ? 0 : 1)]] : undefined })}>
                  <option value="stroke">Stroke time and law</option>
                  <option value="curve">Operating curve (time, stroke)</option>
                </select>
              </label>
            )}
            {ev.kind !== 'pumpTrip' && !ev.curve && <label className="field"><span>Stroke time (s)</span><input type="number" step="0.1" value={ev.duration ?? 5} onChange={(e) => set({ duration: num(e.target.value) })} /></label>}
            {ev.kind !== 'pumpTrip' && !ev.curve && <label className="field"><span>Final stroke (0–1)</span><input type="number" step="0.05" value={ev.finalOpening ?? (ev.kind === 'valveClose' ? 0 : 1)} onChange={(e) => set({ finalOpening: num(e.target.value) })} /></label>}
            {ev.kind !== 'pumpTrip' && ev.curve && <PairsField key={ev.curve.length} label="Time from start (s), stroke (0 shut – 1 open)" value={ev.curve} onChange={(c) => set({ curve: c.length >= 2 ? c : ev.curve })} rows={6} />}
            {ev.kind !== 'pumpTrip' && !ev.curve && (
              <label className="field"><span>Closure law</span>
                <select value={ev.exponent ?? 1} onChange={(e) => set({ exponent: num(e.target.value) })}>
                  <option value={0.5}>Fast start (0.5)</option>
                  <option value={1}>Linear area (1)</option>
                  <option value={2}>Gate valve, slow end (2)</option>
                  <option value={3}>Very slow end (3)</option>
                </select>
              </label>
            )}
          </div>
          {ev.kind === 'pumpTrip' && ev.pumpMode === 'start' && <p className="hint">The pumps above are off in the steady state and start at the start time; their check valves open once the pump head beats the line.</p>}
          {ev.kind !== 'pumpTrip' && <p className="hint">Stroke is converted to flow area by each valve’s characteristic (set it in the valve inspector). An operating curve gives multi-stage closures, e.g. fast to 20 % then slow.</p>}
        </>
      )}
      <div className="label">Run</div>
      <div className="grid2">
        <label className="field"><span>Simulation length (s)</span><input type="number" value={net.settings.duration} onChange={(e) => setNet((n) => ({ ...n, settings: { ...n.settings, duration: num(e.target.value) } }))} /></label>
        <label className="field"><span>Minimum pressure limit (m)</span><input type="number" value={net.settings.minPressure} onChange={(e) => setNet((n) => ({ ...n, settings: { ...n.settings, minPressure: num(e.target.value) } }))} /></label>
      </div>
    </div>
  );
}

export function SettingsPanel({ net, setNet }: { net: Network; setNet: SetNet }) {
  const s = net.settings;
  const set = (p: Partial<typeof s>) => setNet((n) => ({ ...n, settings: { ...n.settings, ...p } }));
  return (
    <div>
      <div className="label">Hydraulics</div>
      <label className="field"><span>Friction formula</span>
        <select value={s.friction} onChange={(e) => set({ friction: e.target.value as 'DW' | 'HW' })}>
          <option value="DW">Darcy–Weisbach (roughness ε in mm)</option>
          <option value="HW">Hazen–Williams (roughness = C)</option>
        </select>
      </label>
      <label className="row small" style={{ marginTop: 10 }}><input type="checkbox" checked={s.unsteadyFriction} onChange={(e) => set({ unsteadyFriction: e.target.checked })} /> Unsteady friction (Brunone–Vítkovský, Vardy coefficient): realistic wave damping</label>
      <label className="row small" style={{ marginTop: 6 }}><input type="checkbox" checked={s.pressureDependentDemand} onChange={(e) => set({ pressureDependentDemand: e.target.checked })} /> Demands follow pressure during the transient (orifice law)</label>
      <div className="label">Accuracy</div>
      <div className="grid2">
        <label className="field"><span>Max wave-speed adjustment (%)</span><input type="number" step="0.1" value={+(s.maxAdjust * 100).toFixed(3)} onChange={(e) => set({ maxAdjust: num(e.target.value) / 100 })} /></label>
        <label className="field"><span>Computational reach budget</span><input type="number" step="1000" value={s.maxReaches} onChange={(e) => set({ maxReaches: num(e.target.value) })} /></label>
        <label className="field"><span>Free gas fraction (DGCM)</span><input type="number" step="1e-8" value={s.gasFraction} onChange={(e) => set({ gasFraction: num(e.target.value) })} /></label>
        <label className="field"><span>Rigid-column limit (s, 0 = auto)</span><input type="number" step="0.005" value={s.rigidTravel} onChange={(e) => set({ rigidTravel: num(e.target.value) })} /></label>
      </div>
      <p className="hint" style={{ marginTop: 10 }}>
        SurgeSpace keeps every pipe's real length and adjusts wave speeds by at most the value above (default 0.5 %; HAMMER's default tolerance is 75 %).
        Pipes too short to carry a wave at the chosen time step are modelled as rigid water columns instead of being distorted.
        Column separation uses the discrete gas cavity model with the free gas fraction above (1e-7 is the research-recommended value).
      </p>
    </div>
  );
}

export function ProtectionPanel({ net, setNet, busy, onSizeVessel, onAirValves, sizing, airSugg }: {
  net: Network; setNet: SetNet; busy: boolean;
  onSizeVessel: (node: string) => void; onAirValves: () => void;
  sizing: VesselSizing | null; airSugg: AirValveSuggestion[] | null;
}) {
  const junctions = net.nodes.filter((n) => n.kind === 'junction');
  const defaultNode = net.pumps[0]?.to ?? junctions[0]?.id ?? '';
  const [node, setNode] = useState(defaultNode);
  const [airEdit, setAirEdit] = useState<Record<string, { type: AirValveType; inD: number; outD: number; smallD: number }>>({});
  return (
    <div>
      <div className="label">Automatic surge vessel sizing</div>
      <p className="small muted" style={{ marginTop: 0 }}>Finds the smallest vessel that keeps every point above the minimum pressure ({net.settings.minPressure} m), within pipe class, without emptying. Tries several initial gas volumes and adds a 10 % margin.</p>
      <div className="row">
        <select className="cell" style={{ height: 32, border: '1px solid var(--line-2)', flex: 1 }} value={node} onChange={(e) => setNode(e.target.value)}>
          {junctions.map((n) => <option key={n.id}>{n.id}</option>)}
        </select>
        <button className="btn primary" disabled={busy || !node} onClick={() => onSizeVessel(node)}>Size vessel</button>
      </div>
      {sizing && (
        <div className="card" style={{ marginTop: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b>{sizing.ok ? `Vessel at ${sizing.node}` : 'No solution'}</b>
            <span className={`pill ${sizing.ok ? 'good' : 'bad'}`}>{sizing.tried.length} trial runs</span>
          </div>
          <p className="small" style={{ margin: '6px 0' }}>{sizing.message}</p>
          {sizing.ok && (
            <>
              <div className="stats">
                <div className="stat"><b>{sizing.volume} m³</b><span>Total volume</span></div>
                <div className="stat"><b>{sizing.gasVolume} m³</b><span>Initial gas</span></div>
                <div className="stat"><b>DN{Math.round(sizing.connDiameter * 1000)}</b><span>Connection</span></div>
              </div>
              <button className="btn small" style={{ marginTop: 8 }} onClick={() => setNet((n) => ({ ...n, nodes: n.nodes.map((x) => (x.id === sizing.node ? { ...x, vessel: { n: 1.2, kIn: 2.5, kOut: 0.5, ...x.vessel, volume: sizing.volume, gasVolume: sizing.gasVolume, gasInput: 'volume' as const, connDiameter: sizing.connDiameter } } : x)) }))}>Apply to model</button>
            </>
          )}
        </div>
      )}
      <div className="label">Air valve sizing</div>
      <p className="small muted" style={{ marginTop: 0 }}>Finds high points that fall below the limit and picks the smallest standard inflow size (DN50–DN300) that fixes each.</p>
      <button className="btn" disabled={busy} onClick={onAirValves}>Suggest air valves</button>
      {airSugg && (
        <div className="card" style={{ marginTop: 10 }}>
          {airSugg.length === 0 ? <span className="small muted">No high point needs an air valve.</span> : (
            <>
              <p className="small muted" style={{ marginTop: 0 }}>Change the type or sizes before applying if you like (sizes in mm).</p>
              <table className="grid">
                <thead><tr><th>Node</th><th>Type</th><th>In</th><th>Out</th><th>Small</th></tr></thead>
                <tbody>{airSugg.map((a) => {
                  const e = airEdit[a.node] ?? { type: 'double' as AirValveType, inD: a.inDiameter * 1000, outD: Math.max(10, (a.inDiameter * 1000) / 4), smallD: 3 };
                  const upd = (p: Partial<typeof e>) => setAirEdit((m) => ({ ...m, [a.node]: { ...e, ...p } }));
                  return (
                    <tr key={a.node} title={`Lowest pressure with this valve: ${fmt(a.minPressure, 1)} m`}>
                      <td>{a.node}</td>
                      <td><select className="cell" value={e.type} onChange={(ev) => upd({ type: ev.target.value as AirValveType })}><option value="double">Double</option><option value="threeStage">3-stage</option><option value="vacuumBreaker">Vacuum br.</option></select></td>
                      <td><input className="cell" type="number" list="dn-sizes" value={e.inD} onChange={(ev) => upd({ inD: Number(ev.target.value) })} /></td>
                      <td><input className="cell" type="number" list="dn-sizes" value={e.outD} disabled={e.type === 'vacuumBreaker'} onChange={(ev) => upd({ outD: Number(ev.target.value) })} /></td>
                      <td><input className="cell" type="number" list="small-sizes" value={e.smallD} disabled={e.type !== 'threeStage'} onChange={(ev) => upd({ smallD: Number(ev.target.value) })} /></td>
                    </tr>
                  );
                })}</tbody>
              </table>
              <DeviceDatalists />
              <button className="btn small" style={{ marginTop: 8 }} onClick={() => setNet((n) => ({ ...n, nodes: n.nodes.map((x) => {
                const s = airSugg.find((a) => a.node === x.id);
                if (!s) return x;
                const e = airEdit[s.node] ?? { type: 'double' as AirValveType, inD: s.inDiameter * 1000, outD: Math.max(10, (s.inDiameter * 1000) / 4), smallD: 3 };
                return { ...x, airValve: { inDiameter: Math.max(e.inD, 1) / 1000, outDiameter: Math.max(e.outD, 0.5) / 1000, type: e.type, ...(e.type === 'threeStage' ? { smallDiameter: Math.max(e.smallD, 0.5) / 1000, switchHead: 0.3 } : {}) } };
              }) }))}>Apply to model</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function Inspector({ net, setNet, sel, result, onClose }: { net: Network; setNet: SetNet; sel: NonNullable<Selection>; result: TransientResult | null; onClose: () => void }) {
  const setNode = (id: string, f: (n: NetNode) => NetNode) => setNet((n) => ({ ...n, nodes: n.nodes.map((x) => (x.id === id ? f(x) : x)) }));
  const setPipe = (id: string, f: (p: Pipe) => Pipe) => setNet((n) => ({ ...n, pipes: n.pipes.map((x) => (x.id === id ? f(x) : x)) }));
  const setPump = (id: string, f: (p: Pump) => Pump) => setNet((n) => ({ ...n, pumps: n.pumps.map((x) => (x.id === id ? f(x) : x)) }));
  const head = (
    <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
      <b>{sel.type === 'node' ? 'Node' : sel.type === 'pipe' ? 'Pipe' : sel.type === 'pump' ? 'Pump' : 'Valve'} {sel.id}</b>
      <button className="btn ghost small" onClick={onClose} aria-label="Close">×</button>
    </div>
  );
  if (sel.type === 'node') {
    const n = net.nodes.find((x) => x.id === sel.id);
    if (!n) return null;
    const st = result?.steady.heads[n.id];
    return (
      <div className="card inspector small">
        {head}
        <div className="muted">{n.kind === 'reservoir' ? `Reservoir · water level ${fmt(n.head ?? n.elev, 2)} m` : `Junction · level ${fmt(n.elev, 2)} m · demand ${fmt((n.demand ?? 0) * 1000, 1)} L/s`}</div>
        {result && n.kind !== 'reservoir' && (
          <div className="stats" style={{ marginTop: 8 }}>
            <div className="stat"><b>{fmt((st ?? 0) - n.elev, 1)}</b><span>Steady p (m)</span></div>
            <div className="stat"><b>{fmt(result.nodeMax[n.id] - n.elev, 1)}</b><span>Max p (m)</span></div>
            <div className="stat"><b>{fmt(result.nodeMin[n.id] - n.elev, 1)}</b><span>Min p (m)</span></div>
          </div>
        )}
        {n.kind === 'junction' && <DeviceEditors n={n} setNode={setNode} result={result} />}
      </div>
    );
  }
  if (sel.type === 'pipe') {
    const p = net.pipes.find((x) => x.id === sel.id);
    if (!p) return null;
    const e = result?.envelopes.find((x) => x.id === p.id);
    let maxP = -Infinity, minP = Infinity;
    if (e) for (let i = 0; i < e.s.length; i++) { maxP = Math.max(maxP, e.hMax[i] - e.z[i]); minP = Math.min(minP, e.hMin[i] - e.z[i]); }
    const q = result?.steady.flows[p.id];
    const rigid = result?.rigidPipes.includes(p.id);
    return (
      <div className="card inspector small">
        {head}
        <div className="muted">{p.from} → {p.to} · {fmt(p.length, 0)} m · DN{Math.round(p.diameter * 1000)} · a = {p.wavespeed} m/s</div>
        {result && (
          <>
            <div className="stats" style={{ marginTop: 8 }}>
              <div className="stat"><b>{fmt((q ?? 0) * 1000, 1)}</b><span>Steady Q (L/s)</span></div>
              <div className="stat"><b>{fmt(maxP, 1)}</b><span>Max p (m)</span></div>
              <div className="stat"><b>{fmt(minP, 1)}</b><span>Min p (m)</span></div>
            </div>
            <p className="muted" style={{ marginBottom: 0 }}>{rigid ? 'Modelled as a rigid water column (too short to carry a wave at this time step).' : `Wave speed adjusted by ${fmt((result.pipeAdjust[p.id] ?? 0) * 100, 3)} %; length unchanged.`}</p>
          </>
        )}
        <div className="devices">
          <details className="dev" open={!!p.checkValve}>
            <summary><span>Check valve at {p.from}</span>{p.checkValve ? <span className="pill good">in model</span> : <span className="muted">none</span>}</summary>
            <div className="dev-body">
              <label className="row dev-check"><input type="checkbox" checked={!!p.checkValve} onChange={(e) => setPipe(p.id, (x) => ({ ...x, checkValve: e.target.checked ? x.checkValve ?? { mode: 'ideal', kOpen: 1 } : undefined }))} /> Flow only from {p.from} to {p.to}</label>
              {p.checkValve && <CheckValveEditor spec={p.checkValve} showLoss boreHint={p.diameter} onChange={(s) => setPipe(p.id, (x) => ({ ...x, checkValve: s }))} />}
              {p.checkValve && <CheckValveResult r={result} id={p.id} />}
            </div>
          </details>
        </div>
      </div>
    );
  }
  if (sel.type === 'pump') {
    const p = net.pumps.find((x) => x.id === sel.id);
    if (!p) return null;
    const qr = pumpRatedQ(p);
    const hr = p.curve[Math.min(1, p.curve.length - 1)][1];
    const est = estimateInertia((998.2 * 9.80665 * qr * hr) / p.efficiency / 1000, p.speed);
    const parallel = net.pumps.filter((x) => x.from === p.from && x.to === p.to).length;
    return (
      <div className="card inspector small">
        {head}
        <div className="muted">{p.from} → {p.to}{parallel > 1 ? ` · ${parallel} identical pumps in parallel` : ''}</div>
        <div className="stats" style={{ marginTop: 8 }}>
          <div className="stat"><b>{fmt(qr * 1000, 0)}</b><span>Rated Q (L/s)</span></div>
          <div className="stat"><b>{fmt(hr, 1)}</b><span>Rated H (m)</span></div>
          <div className="stat"><b>{fmt(p.inertia, 2)}</b><span>I (kg·m²)</span></div>
        </div>
        <p className="muted">Thorley estimate for this duty: {fmt(est, 2)} kg·m² (pump + motor).</p>
        <button className="btn small" onClick={() => setNet((n) => ({ ...n, pumps: n.pumps.map((x) => (x.id === p.id ? { ...x, inertia: +est.toFixed(2) } : x)) }))}>Use estimate</button>
        <div className="devices">
          <DeviceDatalists />
          <details className="dev" open={p.checkValve}>
            <summary><span>Discharge check valve</span>{p.checkValve ? <span className="pill good">in model</span> : <span className="muted">none</span>}</summary>
            <div className="dev-body">
              <label className="row dev-check"><input type="checkbox" checked={p.checkValve} onChange={(e) => setPump(p.id, (x) => ({ ...x, checkValve: e.target.checked }))} /> Non-return valve on the discharge</label>
              {p.checkValve && <CheckValveEditor spec={p.checkSpec ?? { mode: 'ideal' }} boreHint={net.pipes.find((x) => x.from === p.to || x.to === p.to)?.diameter} onChange={(s) => setPump(p.id, (x) => ({ ...x, checkSpec: s }))} />}
              {p.checkValve && <CheckValveResult r={result} id={p.id} />}
            </div>
          </details>
        </div>
      </div>
    );
  }
  const v = net.valves.find((x) => x.id === sel.id);
  if (!v) return null;
  return (
    <div className="card inspector small">
      {head}
      <div className="muted">{v.from} → {v.to}</div>
      <DeviceDatalists />
      <ValveLinkEditor v={v} result={result} setValve={(f) => setNet((n) => ({ ...n, valves: n.valves.map((x) => (x.id === v.id ? f(x) : x)) }))} />
      {v.check && <CheckValveResult r={result} id={v.id} />}
    </div>
  );
}

function CheckValveResult({ r, id }: { r: TransientResult | null; id: string }) {
  const c = r?.checkValves?.[id];
  if (!c) return null;
  const slam = r!.slams.filter((s) => s.kind === 'checkValve' && s.id === id).sort((a, b) => b.joukowsky - a.joukowsky)[0];
  return (
    <p className="muted dev-note">Last run: {c.closures ? `closed ${c.closures}×, ` : ''}largest reverse velocity {fmt(c.maxReverseVelocity, 2)} m/s{slam ? `; slam surge ${fmt(slam.joukowsky, 1)} m (a·v/g) at ${fmt(slam.t, 2)} s` : ''}.</p>
  );
}

export function ChecksView({ checks, onFocus }: { checks: Check[]; onFocus: (c: Check) => void }) {
  const color = { fail: 'var(--bad)', warn: 'var(--warn)', pass: 'var(--good)', info: 'var(--cyan)' } as const;
  const order = { fail: 0, warn: 1, info: 2, pass: 3 } as const;
  return (
    <div>
      {[...checks].sort((a, b) => order[a.level] - order[b.level]).map((c, i) => (
        <div key={i} className="check" onClick={() => onFocus(c)}>
          <span className="dot" style={{ background: color[c.level] }} />
          <div>
            <div style={{ fontWeight: 600 }}>{c.title}</div>
            <div className="small muted">{c.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
