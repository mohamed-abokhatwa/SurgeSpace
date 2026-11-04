// Editors for valves and check valves: check valve closure (pumps, valves, pipes), valve characteristic,
// control valves (PRV / PSV / FCV), and discharge to atmosphere / rupture disk at a node.
import { useState } from 'react';
import { VALVE_CURVES, valveArea } from '../engine/devices';
import type { TransientResult } from '../engine/transient';
import type { CheckValveSpec, ControlValve, NetNode, Outlet, Valve, ValveLaw } from '../engine/types';
import { Num } from './DeviceEditors';
import { fmt } from './util';

const PAIRS_TEXT = (c?: [number, number][]) => (c ?? []).map(([a, b]) => `${+a.toFixed(4)}, ${+b.toFixed(4)}`).join('\n');
const PARSE_PAIRS = (t: string) => t.split(/\n+/).map((l) => l.split(/[,;\t ]+/).filter(Boolean).map(Number)).filter((p) => p.length >= 2 && p.every(Number.isFinite)).map((p) => [p[0], p[1]] as [number, number]);

/** Two-column table typed or pasted as lines of "x, y". */
export function PairsField({ label, value, onChange, rows = 5, note }: { label: string; value?: [number, number][]; onChange: (v: [number, number][]) => void; rows?: number; note?: string }) {
  const [text, setText] = useState(PAIRS_TEXT(value));
  return (
    <label className="field" style={{ gridColumn: '1 / -1' }}><span>{label}</span>
      <textarea rows={rows} value={text} placeholder={note} onChange={(e) => { setText(e.target.value); onChange(PARSE_PAIRS(e.target.value)); }} />
    </label>
  );
}

// ── check valve ──
export const CHECK_MODES: { v: CheckValveSpec['mode']; label: string }[] = [
  { v: 'ideal', label: 'Ideal (shuts as the flow reverses)' },
  { v: 'delay', label: 'Delay + closing time' },
  { v: 'velocity', label: 'Closes at a reverse velocity' },
  { v: 'dynamic', label: 'Dynamic characteristic (manufacturer)' },
];

/** Values shown in the editor are stored when the mode is picked, so the run uses exactly what is shown. */
const MODE_DEFAULTS = (mode: CheckValveSpec['mode'], s: CheckValveSpec): Partial<CheckValveSpec> => ({
  mode,
  ...(mode === 'delay' ? { delay: s.delay ?? 0.5, closeTime: s.closeTime ?? 0.2 } : {}),
  ...(mode === 'velocity' ? { reverseVelocity: s.reverseVelocity ?? 0.3, closeTime: s.closeTime ?? 0 } : {}),
  ...(mode === 'dynamic' ? { dynamic: s.dynamic?.length ? s.dynamic : [[0, 0], [2, 0.15], [10, 0.5]], closeTime: s.closeTime ?? 0 } : {}),
  ...(mode !== 'ideal' ? { kOpen: s.kOpen ?? 1 } : {}),
});

export function CheckValveEditor({ spec, onChange, boreHint, showLoss }: { spec: CheckValveSpec; onChange: (s: CheckValveSpec) => void; boreHint?: number; showLoss?: boolean }) {
  const set = (p: Partial<CheckValveSpec>) => onChange({ ...spec, ...p });
  const m = spec.mode;
  return (
    <>
      <div className="grid2">
        <label className="field" style={{ gridColumn: '1 / -1' }}><span>How it closes</span>
          <select value={m} onChange={(e) => set(MODE_DEFAULTS(e.target.value as CheckValveSpec['mode'], spec))}>
            {CHECK_MODES.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
        </label>
        {m === 'delay' && <Num label="Delay after reversal (s)" value={spec.delay ?? 0} step={0.05} onChange={(x) => set({ delay: Math.max(x ?? 0, 0) })} />}
        {m === 'velocity' && <Num label="Reverse velocity (m/s)" value={spec.reverseVelocity ?? 0.3} step={0.05} onChange={(x) => set({ reverseVelocity: Math.max(x ?? 0, 0) })} />}
        {m !== 'ideal' && <Num label="Closing time (s)" value={spec.closeTime ?? 0} step={0.05} onChange={(x) => set({ closeTime: Math.max(x ?? 0, 0) })} />}
        {m !== 'ideal' && <Num label="Bore (mm)" value={spec.diameter ?? boreHint} scale={1000} digits={0} list="dn-sizes" optional onChange={(x) => set({ diameter: x })} />}
        {(m !== 'ideal' || showLoss) && <Num label="K fully open" value={spec.kOpen ?? 1} step={0.1} onChange={(x) => set({ kOpen: Math.max(x ?? 1, 0.001) })} />}
        <Num label="Reopens at Δh (m)" value={spec.openHead} optional onChange={(x) => set({ openHead: x })} />
      </div>
      {m === 'dynamic' && <PairsField key={m} label="Dynamic characteristic: deceleration (m/s²), reverse velocity at closure (m/s)" value={spec.dynamic} onChange={(d) => set({ dynamic: d })} note={'0, 0\n2, 0.15\n10, 0.5'} />}
      <p className="muted dev-note">
        {m === 'ideal' && 'Closes the instant the flow reverses, so it never slams. Real discs need some reverse flow to close.'}
        {m === 'delay' && 'The disc starts closing the set delay after the flow reverses and takes the closing time to shut. Reverse flow builds up meanwhile; stopping it is the slam.'}
        {m === 'velocity' && 'The disc stays open until the reverse velocity reaches the set value, then shuts in the closing time.'}
        {m === 'dynamic' && "The reverse velocity at closure comes from the manufacturer's dynamic characteristic, read at the deceleration of the flow just before it reverses (averaged over 0.1 s)."}
      </p>
    </>
  );
}

// ── valve link ──
const LAWS: { v: ValveLaw; label: string }[] = [
  { v: 'area', label: 'Linear area' },
  { v: 'gate', label: 'Gate (standard table)' },
  { v: 'globe', label: 'Globe (typical)' },
  { v: 'ball', label: 'Ball (typical)' },
  { v: 'butterfly', label: 'Butterfly (typical)' },
  { v: 'needle', label: 'Needle (typical)' },
  { v: 'curve', label: "Manufacturer's curve" },
];

export function ValveLinkEditor({ v, setValve, result }: { v: Valve; setValve: (f: (v: Valve) => Valve) => void; result: TransientResult | null }) {
  const set = (p: Partial<Valve>) => setValve((x) => ({ ...x, ...p }));
  const law = v.law ?? 'area';
  const c = v.control;
  const setC = (p: Partial<ControlValve>) => setValve((x) => ({ ...x, control: { ...x.control!, ...p } }));
  const op = result?.valves[v.id]?.opening;
  return (
    <div className="devices">
      <details className="dev" open>
        <summary><span>Valve</span></summary>
        <div className="dev-body">
          <div className="grid2">
            <Num label="Diameter (mm)" value={v.diameter} scale={1000} digits={1} onChange={(x) => set({ diameter: Math.max(x ?? 0.1, 0.001) })} />
            <Num label="K fully open" value={v.k0} step={0.05} onChange={(x) => set({ k0: Math.max(x ?? 0.2, 0.001) })} />
            <label className="field"><span>Characteristic</span>
              <select value={law} onChange={(e) => set({ law: e.target.value as ValveLaw, lawCurve: e.target.value === 'curve' ? v.lawCurve ?? VALVE_CURVES.butterfly.map((y, k) => [k / 10, +y.toFixed(4)] as [number, number]) : v.lawCurve })}>
                {LAWS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </label>
            <Num label="Stroke (0 shut – 1 open)" value={v.opening} step={0.05} onChange={(x) => set({ opening: Math.min(Math.max(x ?? 1, 0), 1) })} />
          </div>
          {law === 'curve' && <PairsField key={v.id} label="Stroke (0–1), relative flow area or Cv/Cv open (0–1)" value={v.lawCurve} onChange={(d) => set({ lawCurve: d })} rows={6} />}
          <p className="muted dev-note">At this stroke the flow area is {fmt(valveArea(v, v.opening) * 100, 1)} % of fully open{law !== 'area' && law !== 'gate' && law !== 'curve' ? '. Typical curve: use the manufacturer’s curve when you have it' : ''}.</p>
        </div>
      </details>
      <details className="dev" open={!!v.check}>
        <summary><span>Check valve (non-return)</span>{v.check ? <span className="pill good">in model</span> : <span className="muted">none</span>}</summary>
        <div className="dev-body">
          <label className="row dev-check"><input type="checkbox" checked={!!v.check} onChange={(e) => set({ check: e.target.checked, checkSpec: e.target.checked ? v.checkSpec ?? { mode: 'ideal' } : v.checkSpec })} /> This valve only lets flow pass from {v.from} to {v.to}</label>
          {v.check && <CheckValveEditor spec={v.checkSpec ?? { mode: 'ideal' }} onChange={(s) => set({ checkSpec: s })} boreHint={v.diameter} />}
        </div>
      </details>
      <details className="dev" open={!!c}>
        <summary><span>Control valve (PRV / PSV / FCV)</span>{c ? <span className="pill good">{c.type}</span> : <span className="muted">none</span>}</summary>
        <div className="dev-body">
          {!c ? (
            <>
              <p className="muted" style={{ margin: 0 }}>Holds a downstream pressure (PRV), an upstream pressure (PSV) or a flow (FCV). Its opening is found in the steady state.</p>
              <button className="btn small" onClick={() => set({ control: { type: 'PRV', set: 30, active: false, responseTime: 3, strokeTime: 20 } })}>+ Make it a control valve</button>
            </>
          ) : (
            <>
              <div className="grid2">
                <label className="field"><span>Type</span>
                  <select value={c.type} onChange={(e) => setC({ type: e.target.value as ControlValve['type'], set: e.target.value === 'FCV' ? 0.05 : c.type === 'FCV' ? 30 : c.set })}>
                    <option value="PRV">PRV: pressure reducing</option>
                    <option value="PSV">PSV: pressure sustaining</option>
                    <option value="FCV">FCV: flow control</option>
                  </select>
                </label>
                {c.type === 'FCV'
                  ? <Num label="Set flow (L/s)" value={c.set} scale={1000} digits={2} onChange={(x) => setC({ set: Math.max(x ?? 0, 0) })} />
                  : <Num label={c.type === 'PRV' ? 'Downstream pressure (m)' : 'Upstream pressure (m)'} value={c.set} onChange={(x) => setC({ set: x ?? 0 })} />}
                <label className="field" style={{ gridColumn: '1 / -1' }}><span>During the transient</span>
                  <select value={c.active ? 'a' : 'l'} onChange={(e) => setC({ active: e.target.value === 'a' })}>
                    <option value="l">Locked at its steady opening</option>
                    <option value="a">Keeps controlling (response below)</option>
                  </select>
                </label>
                {c.active && <Num label="Response time (s)" value={c.responseTime ?? 3} step={0.5} onChange={(x) => setC({ responseTime: Math.max(x ?? 3, 0.01) })} />}
                {c.active && <Num label="Full stroke time (s)" value={c.strokeTime ?? 20} step={1} onChange={(x) => setC({ strokeTime: Math.max(x ?? 20, 0.01) })} />}
              </div>
              <p className="muted dev-note">{c.active ? 'The opening moves toward the one that meets the set point with the response time, no faster than the full stroke time allows. Opening here means flow area.' : 'Most pilot valves react too slowly to follow a surge, so locking them is the usual assumption.'}
                {op ? ` Last run: opening ${fmt(Math.min(...op) * 100, 1)}–${fmt(Math.max(...op) * 100, 1)} %.` : ''}</p>
              <button className="btn small ghost" onClick={() => set({ control: undefined })}>Remove control</button>
            </>
          )}
        </div>
      </details>
    </div>
  );
}

// ── discharge to atmosphere / rupture disk ──
export function OutletEditor({ n, setOutlet }: { n: NetNode; setOutlet: (p: Partial<Outlet>) => void }) {
  const o = n.outlet!;
  return (
    <>
      <div className="grid2">
        <label className="field" style={{ gridColumn: '1 / -1' }}><span>Opens</span>
          <select value={o.trigger} onChange={(e) => setOutlet({ trigger: e.target.value as Outlet['trigger'] })}>
            <option value="time">At a set time (blow-off, hydrant, burst)</option>
            <option value="pressure">At a bursting pressure (rupture disk)</option>
          </select>
        </label>
        <Num label="Opening Ø (mm)" value={o.diameter} scale={1000} digits={0} list="dn-sizes" onChange={(x) => setOutlet({ diameter: Math.max(x ?? 0.05, 0.002) })} />
        <Num label="Cd" value={o.cd ?? 0.6} step={0.05} onChange={(x) => setOutlet({ cd: Math.min(Math.max(x ?? 0.6, 0.1), 1) })} />
        {o.trigger === 'time' ? <Num label="Opens at (s)" value={o.time ?? 0} step={0.5} onChange={(x) => setOutlet({ time: Math.max(x ?? 0, 0) })} />
          : <Num label="Bursting pressure (m)" value={o.burstHead} onChange={(x) => setOutlet({ burstHead: x })} />}
        <Num label="Opening time (s)" value={o.openTime ?? 0} step={0.1} onChange={(x) => setOutlet({ openTime: Math.max(x ?? 0, 0) })} />
      </div>
      <p className="muted dev-note">Closed in the steady state. Discharges to air: Q = Cd·A·opening·√(2g·p). A rupture disk stays open once it bursts.</p>
    </>
  );
}
