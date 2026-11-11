// Properties panel: everything about the selected element(s), in display units, with results after a run.
// Several pipes selected → bulk edit. Identity (rename), location, data, devices, check valves and results.
import { useEffect, useState, type ReactNode } from 'react';
import type { TransientResult } from '../engine/transient';
import { area, type Network, type NetNode, type Pipe, type Pump, type Valve } from '../engine/types';
import { estimateInertia, pumpRatedQ } from '../engine/hydraulics';
import { turbineK, turbineSpeeds } from '../engine/analysis';
import { DeviceEditors, DeviceDatalists } from './DeviceEditors';
import { CheckValveEditor, PairsField, ValveLinkEditor } from './ValveEditors';
import { EL, nodeDevices, nodeKind, valveKind } from '../app/elements';
import { pipeLengthFromDrawing, renameElement, reversePipe, type ElRef } from '../app/edit';
import { fmtQ, unitOf, useUnits, type Quantity } from '../app/units';
import { DEFAULT_FLUID, PIPE_MATERIALS, waveSpeed } from '../app/catalogues';
import { ElIcon } from './Icons';

type SetNet = (f: (n: Network) => Network, label?: string) => void;
const num = (s: string) => (s.trim() === '' ? NaN : Number(s));

/** Number field in display units; the model value is SI. */
export function QNum({ label, q, value, onChange, digits = 3, step, placeholder, disabled }: { label: string; q: Quantity; value: number | undefined; onChange: (v: number | undefined) => void; digits?: number; step?: number; placeholder?: string; disabled?: boolean }) {
  const units = useUnits();
  const { f, u } = unitOf(q, units);
  const shown = value === undefined || !Number.isFinite(value) ? '' : String(+(value * f).toFixed(digits));
  const [txt, setTxt] = useState(shown);
  useEffect(() => setTxt(shown), [shown]);
  return (
    <label className="field"><span>{label}{u ? <em className="unit"> {u}</em> : null}</span>
      <input type="number" step={step ?? 'any'} value={txt} placeholder={placeholder} disabled={disabled}
        onChange={(e) => { setTxt(e.target.value); const v = num(e.target.value); onChange(Number.isFinite(v) ? v / f : undefined); }} />
    </label>
  );
}
export function Group({ title, children, right, open = true }: { title: string; children: ReactNode; right?: ReactNode; open?: boolean }) {
  return (
    <details className="pgroup" open={open}>
      <summary><span>{title}</span>{right}</summary>
      <div className="pgroup-body">{children}</div>
    </details>
  );
}
function IdField({ id, type, net, setNet, onRenamed }: { id: string; type: ElRef['type']; net: Network; setNet: SetNet; onRenamed: (id: string) => void }) {
  const [v, setV] = useState(id);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setV(id); setErr(null); }, [id]);
  const commit = () => {
    if (v === id) return;
    const r = renameElement(net, type, id, v);
    if (!r.ok) { setErr(r.error ?? 'Not allowed'); return; }
    setErr(null);
    setNet(() => r.net, 'Rename');
    onRenamed(v.trim());
  };
  return (
    <label className="field"><span>ID</span>
      <input value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} aria-invalid={!!err} />
      {err && <small className="bad">{err}</small>}
    </label>
  );
}
const Stat = ({ v, l }: { v: string; l: string }) => <div className="stat"><b>{v}</b><span>{l}</span></div>;

export function Properties({ net, setNet, selected, result, onSelect }: { net: Network; setNet: SetNet; selected: ElRef[]; result: TransientResult | null; onSelect: (r: ElRef[]) => void }) {
  const units = useUnits();
  if (!selected.length) return <ModelSummary net={net} result={result} />;
  if (selected.length > 1) return <MultiEdit net={net} setNet={setNet} selected={selected} onSelect={onSelect} />;
  const sel = selected[0];
  const renamed = (id: string) => onSelect([{ ...sel, id }]);
  if (sel.type === 'node') {
    const n = net.nodes.find((x) => x.id === sel.id);
    if (!n) return <div className="empty">Not found.</div>;
    const setNode = (id: string, f: (n: NetNode) => NetNode) => setNet((m) => ({ ...m, nodes: m.nodes.map((x) => (x.id === id ? f(x) : x)) }));
    const set = (p: Partial<NetNode>) => setNode(n.id, (x) => ({ ...x, ...p }));
    const kind = nodeKind(n);
    const st = result?.steady.heads[n.id];
    return (
      <div className="props">
        <div className="props-head"><ElIcon kind={kind} size={22} /><div><b>{n.id}</b><span>{n.kind === 'reservoir' ? EL[kind].name : nodeDevices(n).length ? `Junction with ${nodeDevices(n).map((k) => EL[k].name.toLowerCase()).join(', ')}` : 'Junction'}</span></div></div>
        <Group title="Identity">
          <div className="grid2">
            <IdField id={n.id} type="node" net={net} setNet={setNet} onRenamed={renamed} />
            <label className="field"><span>Label</span><input value={n.label ?? ''} onChange={(e) => set({ label: e.target.value || undefined })} placeholder="optional" /></label>
          </div>
          <label className="field" style={{ marginTop: 8 }}><span>Type</span>
            <select value={n.kind === 'reservoir' ? (n.headSchedule ? 'levelSource' : 'reservoir') : 'junction'} onChange={(e) => {
              const v = e.target.value;
              if (v === 'junction') set({ kind: 'junction', headSchedule: undefined, demand: n.demand ?? 0 });
              else set({ kind: 'reservoir', head: n.head ?? n.elev + 5, headSchedule: v === 'levelSource' ? n.headSchedule ?? { mode: 'sine', amplitude: 1, period: 30, phase: 0 } : undefined });
            }}>
              <option value="junction">Junction</option>
              <option value="reservoir">Fixed-level source</option>
              <option value="levelSource">Varying-level source</option>
            </select>
          </label>
        </Group>
        <Group title="Location">
          <div className="grid3">
            <QNum label="X" q="length" value={n.x} digits={2} onChange={(v) => v !== undefined && set({ x: v })} />
            <QNum label="Y" q="length" value={n.y} digits={2} onChange={(v) => v !== undefined && set({ y: v })} />
            <QNum label="Elevation" q="elevation" value={n.elev} digits={3} onChange={(v) => v !== undefined && set({ elev: v })} />
          </div>
        </Group>
        {n.kind === 'junction' ? (
          <Group title="Demand">
            <QNum label="Base demand" q="flow" value={n.demand ?? 0} onChange={(v) => set({ demand: v ?? 0 })} />
            <p className="hint">Demands follow the pressure during the run when “pressure-dependent demands” is on in Run Setup.</p>
          </Group>
        ) : (
          <Group title="Water level">
            <QNum label="Water surface level" q="head" value={n.head ?? n.elev} onChange={(v) => v !== undefined && set({ head: v })} />
            {n.headSchedule && (
              <>
                <label className="field" style={{ marginTop: 8 }}><span>Level varies by</span>
                  <select value={n.headSchedule.mode} onChange={(e) => set({ headSchedule: { ...n.headSchedule!, mode: e.target.value as 'sine' | 'table', table: n.headSchedule!.table ?? [[0, 0], [10, 1], [20, 0]] } })}>
                    <option value="sine">Sine wave (tide, waves, sloshing)</option>
                    <option value="table">Time table (change from the steady level)</option>
                  </select>
                </label>
                {n.headSchedule.mode === 'sine' ? (
                  <div className="grid3" style={{ marginTop: 8 }}>
                    <QNum label="Amplitude" q="head" value={n.headSchedule.amplitude} onChange={(v) => set({ headSchedule: { ...n.headSchedule!, amplitude: v ?? 0 } })} />
                    <QNum label="Period" q="time" value={n.headSchedule.period} onChange={(v) => set({ headSchedule: { ...n.headSchedule!, period: v ?? 10 } })} />
                    <label className="field"><span>Phase <em className="unit">°</em></span><input type="number" value={n.headSchedule.phase ?? 0} onChange={(e) => set({ headSchedule: { ...n.headSchedule!, phase: num(e.target.value) || 0 } })} /></label>
                  </div>
                ) : <PairsField label="Time (s), change of level (m) — start at 0, 0" value={n.headSchedule.table} onChange={(t) => set({ headSchedule: { ...n.headSchedule!, table: t } })} rows={6} />}
                <p className="hint">The steady state uses the level above; during the run the level moves by the schedule.</p>
              </>
            )}
          </Group>
        )}
        {result && n.kind === 'junction' && (
          <Group title="Results">
            <div className="stats">
              <Stat v={fmtQ((st ?? NaN) - n.elev, 'pressureHead', 1, units)} l="Steady pressure" />
              <Stat v={fmtQ(result.nodeMax[n.id] - n.elev, 'pressureHead', 1, units)} l="Maximum pressure" />
              <Stat v={fmtQ(result.nodeMin[n.id] - n.elev, 'pressureHead', 1, units)} l="Minimum pressure" />
              <Stat v={fmtQ(result.nodeMax[n.id], 'head', 1, units)} l="Maximum head" />
            </div>
          </Group>
        )}
        {n.kind === 'junction' && (
          <Group title="Protection devices on this junction">
            <DeviceEditors n={n} setNode={setNode} result={result} />
          </Group>
        )}
      </div>
    );
  }
  if (sel.type === 'pipe') {
    const p = net.pipes.find((x) => x.id === sel.id);
    if (!p) return <div className="empty">Not found.</div>;
    return <PipeProps net={net} setNet={setNet} p={p} result={result} onRenamed={renamed} />;
  }
  if (sel.type === 'pump') {
    const p = net.pumps.find((x) => x.id === sel.id);
    if (!p) return <div className="empty">Not found.</div>;
    return <PumpProps net={net} setNet={setNet} p={p} result={result} onRenamed={renamed} />;
  }
  const v = net.valves.find((x) => x.id === sel.id);
  if (!v) return <div className="empty">Not found.</div>;
  const kind = valveKind(v);
  const setValve = (f: (v: Valve) => Valve) => setNet((n) => ({ ...n, valves: n.valves.map((x) => (x.id === v.id ? f(x) : x)) }));
  return (
    <div className="props">
      <div className="props-head"><ElIcon kind={kind} size={22} /><div><b>{v.id}</b><span>{EL[kind].name} · {v.from} → {v.to}</span></div></div>
      <Group title="Identity">
        <div className="grid2">
          <IdField id={v.id} type="valve" net={net} setNet={setNet} onRenamed={renamed} />
          <label className="field"><span>Label</span><input value={v.label ?? ''} onChange={(e) => setValve((x) => ({ ...x, label: e.target.value || undefined }))} placeholder="optional" /></label>
        </div>
        <ConnFields net={net} from={v.from} to={v.to} onChange={(from, to) => setValve((x) => ({ ...x, from, to }))} />
        <label className="row small" style={{ marginTop: 8 }}><input type="checkbox" checked={!!v.orifice} onChange={(e) => setValve((x) => ({ ...x, orifice: e.target.checked || undefined }))} /> Fixed restriction (inline orifice, never operated)</label>
      </Group>
      {v.turbine && <TurbineGroup v={v} setValve={setValve} net={net} result={result} />}
      <Group title={v.turbine ? 'Wicket gate (as a valve)' : 'Valve data'} open={!v.turbine}>
        <DeviceDatalists />
        <ValveLinkEditor v={v} result={result} setValve={setValve} />
      </Group>
      {!v.turbine && !v.control && (
        <Group title="Fixed-loss valve types" open={v.pbv !== undefined || !!v.gpv}>
          <label className="field"><span>Behaviour in the steady state</span>
            <select value={v.pbv !== undefined ? 'pbv' : v.gpv ? 'gpv' : ''} onChange={(e) => setValve((x) => { const y = { ...x }; delete y.pbv; delete y.gpv; if (e.target.value === 'pbv') y.pbv = 10; if (e.target.value === 'gpv') y.gpv = [[0, 0], [0.05, 2], [0.1, 8]]; return y; })}>
              <option value="">Loss from K and opening</option>
              <option value="pbv">Pressure breaker: fixed head drop</option>
              <option value="gpv">General purpose: head loss curve</option>
            </select>
          </label>
          {v.pbv !== undefined && <QNum label="Head drop" q="head" value={v.pbv} onChange={(x) => x !== undefined && setValve((y) => ({ ...y, pbv: x }))} />}
          {v.gpv && (
            <label className="field" style={{ marginTop: 6 }}><span>Head loss curve: flow L/s, loss m (one point per line)</span>
              <textarea rows={4} defaultValue={v.gpv.map(([q, h]) => `${+(q * 1000).toFixed(3)}\t${h}`).join('\n')} onBlur={(e) => { const pts = e.target.value.split(/\n/).map((l) => l.trim().split(/[\s,;]+/).map(Number)).filter((r) => r.length >= 2 && r.every(Number.isFinite)).map(([q, h]) => [q / 1000, h] as [number, number]).sort((a, b) => a[0] - b[0]); if (pts.length >= 2) setValve((y) => ({ ...y, gpv: pts })); }} />
            </label>
          )}
          <p className="hint">As in EPANET. In the surge run the valve keeps its steady head loss as a fixed restriction (and still follows any operation).</p>
        </Group>
      )}
      {result?.valves[v.id] && (
        <Group title="Results">
          <div className="stats">
            <Stat v={fmtQ(result.steady.flows[v.id], 'flow', 1, units)} l="Steady flow" />
            <Stat v={fmtQ(Math.max(...Array.from(result.valves[v.id].flow).map(Math.abs)), 'flow', 1, units)} l="Largest flow" />
          </div>
        </Group>
      )}
    </div>
  );
}

function ConnFields({ net, from, to, onChange }: { net: Network; from: string; to: string; onChange: (from: string, to: string) => void }) {
  const ids = net.nodes.map((n) => n.id);
  return (
    <div className="grid2" style={{ marginTop: 8 }}>
      <label className="field"><span>From node</span><select value={from} onChange={(e) => onChange(e.target.value, to)}>{!ids.includes(from) && <option>{from}</option>}{ids.map((id) => <option key={id}>{id}</option>)}</select></label>
      <label className="field"><span>To node</span><select value={to} onChange={(e) => onChange(from, e.target.value)}>{!ids.includes(to) && <option>{to}</option>}{ids.map((id) => <option key={id}>{id}</option>)}</select></label>
    </div>
  );
}

function PipeProps({ net, setNet, p, result, onRenamed }: { net: Network; setNet: SetNet; p: Pipe; result: TransientResult | null; onRenamed: (id: string) => void }) {
  const units = useUnits();
  const set = (q: Partial<Pipe>) => setNet((n) => ({ ...n, pipes: n.pipes.map((x) => (x.id === p.id ? { ...x, ...q } : x)) }));
  const drawn = pipeLengthFromDrawing(net, p);
  const mat = PIPE_MATERIALS.find((m) => m.name === p.material);
  const fluid = net.settings.fluid ?? DEFAULT_FLUID;
  const wallM = (p.wall ?? (mat ? mat.wallRatio * p.diameter * 1000 : NaN)) / 1000;
  const aCalc = mat && wallM > 0 ? waveSpeed({ D: p.diameter, e: wallM, E: mat.E, nu: mat.poisson, K: fluid.bulkModulus ?? 2.19, rho: fluid.density, restraint: 'anchoredJoints' }) : NaN;
  const e = result?.envelopes.find((x) => x.id === p.id);
  let maxP = -Infinity, minP = Infinity;
  if (e) for (let i = 0; i < e.s.length; i++) { maxP = Math.max(maxP, e.hMax[i] - e.z[i]); minP = Math.min(minP, e.hMin[i] - e.z[i]); }
  const q = result?.steady.flows[p.id];
  const rigid = result?.rigidPipes.includes(p.id);
  const dw = net.settings.friction === 'DW';
  return (
    <div className="props">
      <div className="props-head"><ElIcon kind="pipe" size={22} /><div><b>{p.id}</b><span>Pipe · {p.from} → {p.to}</span></div></div>
      <Group title="Identity">
        <div className="grid2">
          <IdField id={p.id} type="pipe" net={net} setNet={setNet} onRenamed={onRenamed} />
          <label className="field"><span>Label</span><input value={p.label ?? ''} onChange={(e) => set({ label: e.target.value || undefined })} placeholder="optional" /></label>
        </div>
        <ConnFields net={net} from={p.from} to={p.to} onChange={(from, to) => set({ from, to })} />
        <div className="row" style={{ marginTop: 8, gap: 6, flexWrap: 'wrap' }}>
          <button className="btn small" onClick={() => setNet((n) => reversePipe(n, p.id), 'Reverse pipe')}>Reverse direction</button>
          {p.vertices?.length ? <button className="btn small" onClick={() => set({ vertices: undefined })}>Remove {p.vertices.length} bend{p.vertices.length > 1 ? 's' : ''}</button> : null}
          <label className="row small"><input type="checkbox" checked={!!p.closed} onChange={(e) => set({ closed: e.target.checked || undefined })} /> Closed</label>
        </div>
      </Group>
      <Group title="Geometry">
        <div className="grid2">
          <QNum label="Length" q="length" value={p.length} digits={2} onChange={(v) => v !== undefined && set({ length: v })} />
          <QNum label="Internal diameter" q="diameter" value={p.diameter} digits={1} onChange={(v) => v !== undefined && set({ diameter: v })} />
        </div>
        <p className="hint">Drawn length {fmtQ(drawn, 'length', 1, units)}{Math.abs(drawn - p.length) > 0.5 ? <> · <button className="linkbtn" onClick={() => set({ length: Math.round(drawn * 100) / 100 })}>use it</button></> : ' (matches)'}</p>
      </Group>
      <Group title="Material and wave speed">
        <label className="field"><span>Material</span>
          <select value={p.material ?? ''} onChange={(e) => {
            const m = PIPE_MATERIALS.find((x) => x.name === e.target.value);
            set({ material: e.target.value || undefined, ...(m ? { roughness: dw ? m.roughness : m.hwC } : {}) });
          }}>
            <option value="">Not set</option>
            {PIPE_MATERIALS.map((m) => <option key={m.id}>{m.name}</option>)}
          </select>
        </label>
        <div className="grid2" style={{ marginTop: 8 }}>
          <label className="field"><span>{dw ? 'Roughness ε' : 'Hazen–Williams C'}{dw ? <em className="unit"> mm</em> : null}</span><input type="number" step="any" value={p.roughness} onChange={(e) => set({ roughness: num(e.target.value) || 0 })} /></label>
          <label className="field"><span>Wall thickness <em className="unit">mm</em></span><input type="number" step="any" value={p.wall ?? ''} placeholder={mat ? (mat.wallRatio * p.diameter * 1000).toFixed(1) : 'optional'} onChange={(e) => set({ wall: num(e.target.value) || undefined })} /></label>
          <QNum label="Wave speed" q="wavespeed" value={p.wavespeed} digits={1} onChange={(v) => v !== undefined && set({ wavespeed: v })} />
          <QNum label="Pressure class" q="pressureHead" value={p.pressureClass} digits={1} placeholder="optional" onChange={(v) => set({ pressureClass: v })} />
        </div>
        {Number.isFinite(aCalc) && <p className="hint">Calculated for {mat!.name.toLowerCase()}, {fluid.name.toLowerCase()}, restrained: <b>{fmtQ(aCalc, 'wavespeed', 0, units)}</b> · <button className="linkbtn" onClick={() => set({ wavespeed: Math.round(aCalc) })}>use it</button></p>}
        <label className="field" style={{ marginTop: 8 }}><span>Minor loss coefficient ΣK</span><input type="number" step="any" value={p.minorLoss ?? 0} onChange={(e) => set({ minorLoss: num(e.target.value) || 0 })} /></label>
      </Group>
      <Group title="Viscoelastic wall (PE, PVC)" open={!!p.viscoelastic} right={p.viscoelastic ? <span className="pill good">{p.viscoelastic.J.length} element{p.viscoelastic.J.length > 1 ? 's' : ''}</span> : undefined}>
        <label className="row small"><input type="checkbox" checked={!!p.viscoelastic} onChange={(e) => set({ viscoelastic: e.target.checked ? { J: [0.1, 0.1, 0.09], tau: [0.05, 0.5, 1.5] } : undefined })} /> Creep of the pipe wall damps and slows the waves</label>
        {p.viscoelastic && (
          <label className="field" style={{ marginTop: 6 }}><span>Kelvin–Voigt elements: creep compliance J (1/GPa) and retardation time τ (s), one per line</span>
            <textarea rows={3} defaultValue={p.viscoelastic.J.map((j, k) => `${j}\t${p.viscoelastic!.tau[k]}`).join('\n')} onBlur={(e) => { const rows = e.target.value.split(/\n/).map((l) => l.trim().split(/[\s,;]+/).map(Number)).filter((r) => r.length >= 2 && r.every((x) => Number.isFinite(x) && x >= 0)); if (rows.length) set({ viscoelastic: { J: rows.map((r) => r[0]), tau: rows.map((r) => Math.max(r[1], 1e-3)) } }); }} />
          </label>
        )}
        {p.viscoelastic && !p.wall && <p className="hint bad">Enter the wall thickness (Material and wave speed): it is needed for the wall stress.</p>}
        <p className="hint">Use the instantaneous wave speed. The starting values are indicative for HDPE from published tests; calibrate them to the pipe (or to field records) for design.</p>
      </Group>
      <Group title="Long section" open={!!p.profile?.length}>
        <PairsField label="Chainage from start (m), pipe level (m)" value={p.profile?.map((x) => [x.s, x.z] as [number, number])} onChange={(v) => set({ profile: v.length ? v.map(([s, z]) => ({ s, z })).sort((a, b) => a.s - b.s) : undefined })} rows={5} note="High and low points between the end nodes; used for cavity checks and the profile." />
      </Group>
      <Group title="Non-return valve" open={!!p.checkValve} right={p.checkValve ? <span className="pill good">fitted</span> : undefined}>
        <label className="row small"><input type="checkbox" checked={!!p.checkValve} onChange={(e) => set({ checkValve: e.target.checked ? p.checkValve ?? { mode: 'ideal', kOpen: 1 } : undefined })} /> At the start of the pipe ({p.from}), flow only towards {p.to}</label>
        {p.checkValve && <CheckValveEditor spec={p.checkValve} showLoss boreHint={p.diameter} onChange={(s) => set({ checkValve: s })} />}
      </Group>
      {result && (
        <Group title="Results">
          <div className="stats">
            <Stat v={fmtQ(q, 'flow', 1, units)} l="Steady flow" />
            <Stat v={fmtQ(Math.abs(q ?? 0) / area(p.diameter), 'velocity', 2, units)} l="Steady velocity" />
            <Stat v={fmtQ(maxP, 'pressureHead', 1, units)} l="Maximum pressure" />
            <Stat v={fmtQ(minP, 'pressureHead', 1, units)} l="Minimum pressure" />
          </div>
          <p className="hint">{rigid ? 'Modelled as a rigid water column (too short to carry a wave at this time step).' : `Wave speed adjusted by ${((result.pipeAdjust[p.id] ?? 0) * 100).toFixed(3)} %; length unchanged.`}</p>
        </Group>
      )}
    </div>
  );
}

function PumpProps({ net, setNet, p, result, onRenamed }: { net: Network; setNet: SetNet; p: Pump; result: TransientResult | null; onRenamed: (id: string) => void }) {
  const units = useUnits();
  const set = (q: Partial<Pump>) => setNet((n) => ({ ...n, pumps: n.pumps.map((x) => (x.id === p.id ? { ...x, ...q } : x)) }));
  const qr = pumpRatedQ(p);
  const hr = p.curve[Math.min(1, p.curve.length - 1)]?.[1] ?? 0;
  const est = estimateInertia((998.2 * 9.80665 * qr * hr) / p.efficiency / 1000, p.speed);
  const parallel = net.pumps.filter((x) => x.from === p.from && x.to === p.to).length;
  const fQ = unitOf('flow', units), fH = unitOf('head', units);
  return (
    <div className="props">
      <div className="props-head"><ElIcon kind="pump" size={22} /><div><b>{p.id}</b><span>Pump · {p.from} → {p.to}{parallel > 1 ? ` · ${parallel} in parallel` : ''}</span></div></div>
      <Group title="Identity">
        <div className="grid2">
          <IdField id={p.id} type="pump" net={net} setNet={setNet} onRenamed={onRenamed} />
          <label className="field"><span>Label</span><input value={p.label ?? ''} onChange={(e) => set({ label: e.target.value || undefined })} placeholder="optional" /></label>
        </div>
        <ConnFields net={net} from={p.from} to={p.to} onChange={(from, to) => set({ from, to })} />
        <label className="row small" style={{ marginTop: 8 }}><input type="checkbox" checked={p.on} onChange={(e) => set({ on: e.target.checked })} /> Running in the steady state</label>
      </Group>
      <Group title="Head curve">
        <PairsField key={`${fQ.u}-${fH.u}`} label={`Flow (${fQ.u}), head (${fH.u}) — shut-off, duty, run-out…`} value={p.curve.map(([qq, h]) => [+(qq * fQ.f).toFixed(4), +(h * fH.f).toFixed(3)] as [number, number])}
          onChange={(v) => v.length >= 1 && set({ curve: v.map(([qq, h]) => [qq / fQ.f, h / fH.f] as [number, number]) })} rows={5} />
        <div className="grid2" style={{ marginTop: 8 }}>
          <label className="field"><span>Efficiency at duty <em className="unit">%</em></span><input type="number" value={Math.round(p.efficiency * 1000) / 10} onChange={(e) => set({ efficiency: (num(e.target.value) || 0) / 100 })} /></label>
          <label className="field"><span>Rated speed <em className="unit">rpm</em></span><input type="number" value={p.speed} onChange={(e) => set({ speed: num(e.target.value) || 0 })} /></label>
          <QNum label="Constant power (optional)" q="power" value={p.power} placeholder="curve used" onChange={(v) => set({ power: v || undefined })} />
        </div>
      </Group>
      <Group title="Inertia">
        <QNum label="Pump + motor inertia" q="inertia" value={p.inertia} digits={3} onChange={(v) => v !== undefined && set({ inertia: v })} />
        <p className="hint">Thorley estimate for this duty: <b>{fmtQ(est, 'inertia', 2, units)}</b> · <button className="linkbtn" onClick={() => set({ inertia: +est.toFixed(2) })}>use it</button></p>
      </Group>
      <Group title="Variable-speed drive" open={!!p.vsd} right={p.vsd ? <span className="pill good">holds {p.vsd.setPressure} m</span> : undefined}>
        <label className="row small"><input type="checkbox" checked={!!p.vsd} onChange={(e) => set({ vsd: e.target.checked ? { node: p.to, setPressure: 30 } : undefined })} /> Speed controlled to hold a pressure</label>
        {p.vsd && (
          <div className="grid2" style={{ marginTop: 6 }}>
            <label className="field"><span>Controlled node</span><select value={p.vsd.node} onChange={(e) => set({ vsd: { ...p.vsd!, node: e.target.value } })}>{net.nodes.map((n) => <option key={n.id}>{n.id}</option>)}</select></label>
            <QNum label="Set pressure" q="pressureHead" value={p.vsd.setPressure} onChange={(v) => v !== undefined && set({ vsd: { ...p.vsd!, setPressure: v } })} />
            <label className="field"><span>Gain <em className="unit">speed per m</em></span><input type="number" step="0.005" value={p.vsd.kp ?? 0.02} onChange={(e) => set({ vsd: { ...p.vsd!, kp: num(e.target.value) } })} /></label>
            <label className="field"><span>Integral time <em className="unit">s</em></span><input type="number" value={p.vsd.ti ?? 5} onChange={(e) => set({ vsd: { ...p.vsd!, ti: num(e.target.value) || 5 } })} /></label>
            <label className="field"><span>Speed range <em className="unit">%</em></span><input value={`${Math.round((p.vsd.minSpeed ?? 0.3) * 100)}–${Math.round((p.vsd.maxSpeed ?? 1.05) * 100)}`} onChange={(e) => { const [a, b] = e.target.value.split(/[–-]/).map(Number); if (a > 0 && b > a) set({ vsd: { ...p.vsd!, minSpeed: a / 100, maxSpeed: b / 100 } }); }} /></label>
            <label className="field"><span>Ramp 0→100 % <em className="unit">s</em></span><input type="number" value={p.vsd.rampTime ?? 10} onChange={(e) => set({ vsd: { ...p.vsd!, rampTime: num(e.target.value) || 10 } })} /></label>
          </div>
        )}
        <p className="hint">The steady speed is found to meet the set pressure; in the surge run a PI controller keeps adjusting the speed until the pump trips or ramps by an operation.</p>
      </Group>
      <Group title="Four-quadrant behaviour" open={!!p.fourQuadrant} right={p.fourQuadrant ? <span className="pill good">{p.fourQuadrant}</span> : undefined}>
        <label className="field"><span>Reverse flow and reverse rotation</span>
          <select value={p.fourQuadrant ?? ''} onChange={(e) => set({ fourQuadrant: (e.target.value || undefined) as typeof p.fourQuadrant })}>
            <option value="">Off — normal pump zone (with a non-return valve)</option>
            <option value="generic">Generic — derived from this pump curve</option>
            <option value="suter">Manufacturer data (Suter curves)</option>
          </select>
        </label>
        {p.fourQuadrant === 'suter' && (
          <label className="field" style={{ marginTop: 6 }}><span>Suter data: one row per angle — θ (°), WH, WB</span>
            <textarea rows={6} defaultValue={p.suter ? p.suter.theta.map((t, i) => `${t}\t${p.suter!.wh[i]}\t${p.suter!.wb[i]}`).join('\n') : ''} placeholder={'0\t-0.55\t-0.43\n5\t-0.48\t-0.26\n…'}
              onBlur={(e) => { const rows = e.target.value.split(/\n/).map((l) => l.trim().split(/[\s,;]+/).map(Number)).filter((r) => r.length >= 3 && r.every(Number.isFinite)).sort((a, b) => a[0] - b[0]); set({ suter: rows.length ? { theta: rows.map((r) => r[0]), wh: rows.map((r) => r[1]), wb: rows.map((r) => r[2]) } : undefined }); }} />
          </label>
        )}
        <p className="hint">Use it for pumps without a non-return valve (or with a slow one): after a trip the flow reverses and the pump can turn backwards like a turbine. The generic characteristic is an approximation; paste the manufacturer's Suter data for final design.</p>
      </Group>
      <Group title="Discharge non-return valve" open={p.checkValve} right={p.checkValve ? <span className="pill good">fitted</span> : undefined}>
        <DeviceDatalists />
        <label className="row small"><input type="checkbox" checked={p.checkValve} onChange={(e) => set({ checkValve: e.target.checked })} /> Non-return valve on the discharge</label>
        {p.checkValve && <CheckValveEditor spec={p.checkSpec ?? { mode: 'ideal' }} boreHint={net.pipes.find((x) => x.from === p.to || x.to === p.to)?.diameter} onChange={(s) => set({ checkSpec: s })} />}
      </Group>
      {result?.pumps[p.id] && (
        <Group title="Results">
          <div className="stats">
            <Stat v={fmtQ(result.steady.flows[p.id], 'flow', 1, units)} l="Steady flow" />
            <Stat v={`${(Math.min(...Array.from(result.pumps[p.id].speed)) * 100).toFixed(0)} %`} l="Lowest speed" />
            <Stat v={result.pumps[p.id].reverseFlow ? 'Yes' : 'No'} l="Reverse flow" />
          </div>
        </Group>
      )}
    </div>
  );
}

function MultiEdit({ net, setNet, selected, onSelect }: { net: Network; setNet: SetNet; selected: ElRef[]; onSelect: (r: ElRef[]) => void }) {
  const pipes = selected.filter((r) => r.type === 'pipe').map((r) => r.id);
  const nodes = selected.filter((r) => r.type === 'node').map((r) => r.id);
  const ps = new Set(pipes), ns = new Set(nodes);
  const setPipes = (q: Partial<Pipe>) => setNet((n) => ({ ...n, pipes: n.pipes.map((p) => (ps.has(p.id) ? { ...p, ...q } : p)) }), 'Edit pipes');
  const setNodes = (q: Partial<NetNode>) => setNet((n) => ({ ...n, nodes: n.nodes.map((x) => (ns.has(x.id) ? { ...x, ...q } : x)) }), 'Edit nodes');
  const first = net.pipes.find((p) => ps.has(p.id));
  const same = <K extends keyof Pipe>(k: K) => { const v = first?.[k]; return net.pipes.filter((p) => ps.has(p.id)).every((p) => p[k] === v) ? v : undefined; };
  const totalL = net.pipes.filter((p) => ps.has(p.id)).reduce((s, p) => s + p.length, 0);
  const units = useUnits();
  return (
    <div className="props">
      <div className="props-head"><div><b>{selected.length} elements selected</b><span>{nodes.length} nodes · {pipes.length} pipes{pipes.length ? ` · ${fmtQ(totalL, 'length', 0, units)}` : ''}</span></div></div>
      {pipes.length > 0 && (
        <Group title={`Edit ${pipes.length} pipes together`}>
          <div className="grid2">
            <QNum label="Diameter" q="diameter" value={same('diameter') as number | undefined} placeholder="various" digits={1} onChange={(v) => v && setPipes({ diameter: v })} />
            <QNum label="Wave speed" q="wavespeed" value={same('wavespeed') as number | undefined} placeholder="various" onChange={(v) => v && setPipes({ wavespeed: v })} />
            <label className="field"><span>Roughness</span><input type="number" step="any" placeholder="various" value={(same('roughness') as number | undefined) ?? ''} onChange={(e) => num(e.target.value) >= 0 && setPipes({ roughness: num(e.target.value) })} /></label>
            <QNum label="Pressure class" q="pressureHead" value={same('pressureClass') as number | undefined} placeholder="various" onChange={(v) => v && setPipes({ pressureClass: v })} />
          </div>
          <label className="field" style={{ marginTop: 8 }}><span>Material</span>
            <select value={(same('material') as string | undefined) ?? ''} onChange={(e) => { const m = PIPE_MATERIALS.find((x) => x.name === e.target.value); setPipes({ material: e.target.value || undefined, ...(m ? { roughness: net.settings.friction === 'DW' ? m.roughness : m.hwC } : {}) }); }}>
              <option value="">— various / not set —</option>
              {PIPE_MATERIALS.map((m) => <option key={m.id}>{m.name}</option>)}
            </select>
          </label>
        </Group>
      )}
      {nodes.length > 0 && (
        <Group title={`Edit ${nodes.length} nodes together`}>
          <div className="grid2">
            <QNum label="Elevation" q="elevation" value={undefined} placeholder="type to set all" onChange={(v) => v !== undefined && setNodes({ elev: v })} />
            <QNum label="Demand" q="flow" value={undefined} placeholder="type to set all" onChange={(v) => v !== undefined && setNodes({ demand: v })} />
          </div>
        </Group>
      )}
      <Group title="Selection">
        <div className="sel-list">{selected.slice(0, 200).map((r) => <button key={`${r.type}:${r.id}`} className="chip" onClick={() => onSelect([r])}>{r.id}</button>)}</div>
      </Group>
    </div>
  );
}

function ModelSummary({ net, result }: { net: Network; result: TransientResult | null }) {
  const units = useUnits();
  const L = net.pipes.reduce((s, p) => s + p.length, 0);
  return (
    <div className="props">
      <div className="props-head"><div><b>{net.name}</b><span>{net.description ?? 'No description'}</span></div></div>
      <Group title="Model">
        <div className="stats">
          <Stat v={String(net.nodes.length)} l="Nodes" />
          <Stat v={String(net.pipes.length)} l="Pipes" />
          <Stat v={fmtQ(L, 'length', 0, units)} l="Pipe length" />
          <Stat v={String(net.pumps.length)} l="Pumps" />
          <Stat v={String(net.valves.length)} l="Valves" />
          <Stat v={String(net.nodes.filter((n) => nodeDevices(n).length).length)} l="Protected nodes" />
        </div>
      </Group>
      {result && (
        <Group title="Last run">
          <div className="stats">
            <Stat v={`${result.dt.toPrecision(3)} s`} l="Time step" />
            <Stat v={result.reaches.toLocaleString()} l="Reaches" />
            <Stat v={`${(result.runtimeMs / 1000).toFixed(2)} s`} l="Run time" />
            <Stat v={`${(result.maxAdjust * 100).toFixed(3)} %`} l="Wave-speed change" />
          </div>
        </Group>
      )}
      <p className="hint" style={{ margin: 12 }}>Select an element on the drawing or in the Model Explorer to see and edit its properties. Shift-drag on empty space selects several.</p>
    </div>
  );
}

function TurbineGroup({ v, setValve, net, result }: { v: Valve; setValve: (f: (v: Valve) => Valve) => void; net: Network; result: TransientResult | null }) {
  const units = useUnits();
  const t = v.turbine!;
  const setT = (p: Partial<NonNullable<Valve['turbine']>>) => setValve((x) => {
    const nt = { ...x.turbine!, ...p };
    return { ...x, turbine: nt, k0: +turbineK(nt, x.diameter).toFixed(3) };
  });
  const run = result ? turbineSpeeds(net, result).find((r) => r.id === v.id) : undefined;
  const P = (998.2 * 9.80665 * t.ratedFlow * t.ratedHead * t.efficiency) / 1000;
  return (
    <Group title="Turbine and generator">
      <div className="grid2">
        <QNum label="Rated net head" q="head" value={t.ratedHead} onChange={(x) => x && setT({ ratedHead: x })} />
        <QNum label="Rated flow" q="flow" value={t.ratedFlow} onChange={(x) => x && setT({ ratedFlow: x })} />
        <label className="field"><span>Efficiency <em className="unit">%</em></span><input type="number" value={Math.round(t.efficiency * 1000) / 10} onChange={(e) => setT({ efficiency: (num(e.target.value) || 90) / 100 })} /></label>
        <label className="field"><span>Synchronous speed <em className="unit">rpm</em></span><input type="number" value={t.speed} onChange={(e) => setT({ speed: num(e.target.value) || 750 })} /></label>
        <QNum label="Turbine + generator inertia" q="inertia" value={t.inertia} onChange={(x) => x && setT({ inertia: x })} />
        <label className="field" style={{ gridColumn: '1 / -1' }}><span><input type="checkbox" checked={!!t.governor} onChange={(e) => setT({ governor: e.target.checked ? { kp: 3, ti: 5, closeTime: 8 } : undefined })} /> Speed governor on load rejection (gates follow a PI controller on the speed)</span></label>
        {t.governor && <>
          <label className="field"><span>Gain <em className="unit">gate per speed</em></span><input type="number" step="0.5" value={t.governor.kp ?? 3} onChange={(e) => setT({ governor: { ...t.governor!, kp: num(e.target.value) || 3 } })} /></label>
          <label className="field"><span>Integral time <em className="unit">s</em></span><input type="number" value={t.governor.ti ?? 5} onChange={(e) => setT({ governor: { ...t.governor!, ti: num(e.target.value) || 5 } })} /></label>
          <label className="field"><span>Fastest gate closure <em className="unit">s</em></span><input type="number" value={t.governor.closeTime} onChange={(e) => setT({ governor: { ...t.governor!, closeTime: num(e.target.value) || 8 } })} /></label>
        </>}
        <QNum label="Gate bore" q="diameter" value={v.diameter} digits={1} onChange={(x) => x && setValve((y) => ({ ...y, diameter: x, k0: +turbineK(y.turbine!, x).toFixed(3) }))} />
      </div>
      <p className="hint">Rated output {fmtQ(P, 'power', 0, units)}. The gates are sized so the turbine passes the rated flow at the rated head (K = {v.k0}). Operate it in Operations → Turbine load rejection / acceptance.</p>
      {run && (
        <div className="stats" style={{ marginTop: 8 }}>
          <Stat v={`${((run.maxSpeed - 1) * 100).toFixed(1)} %`} l="Largest speed rise" />
          <Stat v={`${run.tMax.toFixed(2)} s`} l="Time of peak speed" />
          <Stat v={fmtQ(run.power[0], 'power', 0, units)} l="Steady output" />
        </div>
      )}
    </Group>
  );
}
