// Editors for the surge protection devices at a junction: hydropneumatic tank, air valve, open surge tank,
// one-way tank, surge anticipation valve, pressure relief valve and discharge to atmosphere / rupture disk.
import { useState, type ReactNode } from 'react';
import { airValveModel, orificeCurve, vesselGeometry, waterDepthOf } from '../engine/devices';
import type { TransientResult } from '../engine/transient';
import type { AirValve, AirValveType, NetNode, OpenTank, ReliefValve, SurgeAnticipationValve, SurgeVessel, VesselShape } from '../engine/types';
import { fmt } from './util';
import { convertLabel, unitOf, useUnits } from '../app/units';
import { OutletEditor } from './ValveEditors';

type SetNode = (id: string, f: (n: NetNode) => NetNode) => void;
const num = (s: string) => (s.trim() === '' ? NaN : Number(s));

/** Number input; `scale` converts stored SI units to the shown unit (e.g. 1000 for m → mm). Empty = undefined. */
export function Num({ label, value, onChange, scale = 1, step, list, digits = 3, optional }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; scale?: number; step?: number; list?: string; digits?: number; optional?: boolean }) {
  // the SI unit written in the label picks the display unit (m → ft, mm → in, L/s → gpm …) from the unit settings
  const units = useUnits();
  const cv = convertLabel(label, units);
  const k = cv.q && (units.system !== 'SI' || cv.q === 'flow' || cv.q === 'pressureHead') ? unitOf(cv.q, units).f : scale;
  const shownLabel = cv.q && k !== scale ? cv.label : label;
  const useList = k === scale ? list : undefined;
  const shown = value === undefined || !Number.isFinite(value) ? '' : String(+(value * k).toFixed(digits));
  return (
    <label className="field"><span>{shownLabel}</span>
      <input type="number" step={step && k === scale ? step : 'any'} list={useList} value={shown} placeholder={optional ? 'optional' : undefined}
        onChange={(e) => { const v = num(e.target.value); onChange(Number.isFinite(v) ? v / k : undefined); }} />
    </label>
  );
}
export function Section({ title, on, onAdd, onRemove, children, hint }: { title: string; on: boolean; onAdd: () => void; onRemove: () => void; children: ReactNode; hint?: string }) {
  return (
    <details className="dev" open={on}>
      <summary><span>{title}</span>{on ? <span className="pill good">in model</span> : <span className="muted">none</span>}</summary>
      {on ? (
        <div className="dev-body">
          {children}
          <button className="btn small ghost" onClick={onRemove}>Remove</button>
        </div>
      ) : (
        <div className="dev-body">
          {hint && <p className="muted" style={{ margin: 0 }}>{hint}</p>}
          <button className="btn small" onClick={onAdd}>+ Add {title.toLowerCase()}</button>
        </div>
      )}
    </details>
  );
}

const DN_LIST = [25, 50, 80, 100, 150, 200, 250, 300];
const SMALL_LIST = [1.6, 2.4, 3, 5, 8, 12];
export function DeviceDatalists() {
  return (
    <>
      <datalist id="dn-sizes">{DN_LIST.map((d) => <option key={d} value={d}>DN{d}</option>)}</datalist>
      <datalist id="small-sizes">{SMALL_LIST.map((d) => <option key={d} value={d} />)}</datalist>
    </>
  );
}

// ── hydropneumatic tank ──
function VesselEditor({ n, setNode, steadyHead }: { n: NetNode; setNode: SetNode; steadyHead?: number }) {
  const v = n.vessel!;
  const set = (p: Partial<SurgeVessel>) => setNode(n.id, (x) => ({ ...x, vessel: { ...x.vessel!, ...p } }));
  const g = vesselGeometry(v);
  const bottom = v.bottomElev ?? n.elev;
  const waterDepth = v.gasInput === 'precharge' ? undefined : waterDepthOf(g, v.volume - v.gasVolume);
  return (
    <>
      <div className="grid2">
        <label className="field"><span>Shape</span>
          <select value={v.shape ?? 'vertical'} onChange={(e) => set({ shape: e.target.value as VesselShape })}>
            <option value="vertical">Vertical cylinder</option>
            <option value="horizontal">Horizontal cylinder</option>
            <option value="sphere">Sphere</option>
          </select>
        </label>
        <Num label="Volume (m³)" value={v.volume} onChange={(x) => set({ volume: Math.max(x ?? 1, 0.01) })} />
        {v.shape !== 'sphere' && <Num label="Diameter (m)" value={v.diameter} optional onChange={(x) => set({ diameter: x })} />}
        <Num label="Bottom level (m)" value={v.bottomElev} optional onChange={(x) => set({ bottomElev: x })} />
      </div>
      <p className="muted dev-note">{g.shape === 'vertical' ? `Ø ${fmt(g.D, 2)} m × ${fmt(g.L, 2)} m high` : g.shape === 'horizontal' ? `Ø ${fmt(g.D, 2)} m × ${fmt(g.L, 2)} m long` : `Ø ${fmt(g.D, 2)} m`} · bottom at {fmt(bottom, 2)} m{waterDepth !== undefined ? ` · water ${fmt(waterDepth, 2)} m deep at start` : ''}</p>
      <div className="grid2">
        <label className="field"><span>Gas given as</span>
          <select value={v.gasInput ?? 'volume'} onChange={(e) => {
            const gi = e.target.value as 'volume' | 'precharge';
            // store a starting pre-charge (about 40 % of the operating pressure, leaving room for water) so the run uses the value shown
            set(gi === 'precharge' && v.prechargeHead === undefined ? { gasInput: gi, prechargeHead: Math.max(1, Math.round(0.4 * ((steadyHead ?? bottom + 30) - bottom))) } : { gasInput: gi });
          }}>
            <option value="volume">Initial gas volume</option>
            <option value="precharge">Bladder pre-charge</option>
          </select>
        </label>
        {v.gasInput === 'precharge'
          ? <Num label="Pre-charge (m, gauge)" value={v.prechargeHead} onChange={(x) => set({ prechargeHead: x ?? 0 })} />
          : <Num label="Initial gas (m³)" value={v.gasVolume} onChange={(x) => set({ gasVolume: Math.min(Math.max(x ?? 0, 0), v.volume) })} />}
        <Num label="Polytropic n" value={v.n} step={0.05} onChange={(x) => set({ n: Math.min(Math.max(x ?? 1.2, 1), 1.4) })} />
        <Num label="Dip tube height (m)" value={v.dipTubeHeight} optional onChange={(x) => set({ dipTubeHeight: x })} />
      </div>
      <label className="row dev-check"><input type="checkbox" checked={!!v.bladder} onChange={(e) => set({ bladder: e.target.checked })} /> Bladder / diaphragm (gas never reaches the pipe)</label>
      {steadyHead !== undefined && v.gasInput === 'precharge' && (v.prechargeHead ?? 0) >= steadyHead - bottom && <p className="dev-warn">The pre-charge is at or above the operating pressure (≈{fmt(steadyHead - bottom, 1)} m): the tank would hold no water.</p>}
      <div className="label">Connection</div>
      <div className="grid2">
        <Num label="Diameter (mm)" value={v.connDiameter} scale={1000} list="dn-sizes" digits={0} onChange={(x) => set({ connDiameter: Math.max(x ?? 0.1, 0.01) })} />
        <Num label="Length (m)" value={v.connLength} optional onChange={(x) => set({ connLength: x })} />
        <label className="field"><span>Inflow path</span>
          <select value={v.inlet ?? 'orifice'} onChange={(e) => set({ inlet: e.target.value as 'orifice' | 'checkBypass', bypassDiameter: v.bypassDiameter ?? v.connDiameter / 3 })}>
            <option value="orifice">Connection (K in)</option>
            <option value="checkBypass">Non-return valve + bypass</option>
          </select>
        </label>
        <Num label="K out (to pipe)" value={v.kOut} step={0.1} onChange={(x) => set({ kOut: Math.max(x ?? 0, 0) })} />
        {v.inlet === 'checkBypass' ? (
          <>
            <Num label="Bypass Ø (mm)" value={v.bypassDiameter} scale={1000} digits={0} onChange={(x) => set({ bypassDiameter: Math.max(x ?? 0.01, 0.005) })} />
            <Num label="Bypass K" value={v.bypassK ?? 1} step={0.1} onChange={(x) => set({ bypassK: Math.max(x ?? 1, 0) })} />
          </>
        ) : <Num label="K in (to tank)" value={v.kIn} step={0.1} onChange={(x) => set({ kIn: Math.max(x ?? 0, 0) })} />}
      </div>
    </>
  );
}

// ── air valve ──
const CURVE_TEXT = (c?: [number, number][]) => (c ?? []).map(([a, b]) => `${a}, ${+b.toFixed(1)}`).join('\n');
const PARSE_CURVE = (t: string) => t.split(/\n+/).map((l) => l.split(/[,;\t ]+/).map(Number)).filter((p) => p.length >= 2 && p.every(Number.isFinite)).map((p) => [p[0], p[1]] as [number, number]);
function AirValveEditor({ n, setNode }: { n: NetNode; setNode: SetNode }) {
  const a = n.airValve!;
  const set = (p: Partial<AirValve>) => setNode(n.id, (x) => ({ ...x, airValve: { ...x.airValve!, ...p } }));
  const type = a.type ?? 'double';
  const [inText, setInText] = useState(CURVE_TEXT(a.inCurve));
  const [outText, setOutText] = useState(CURVE_TEXT(a.outCurve));
  const usesIn = type !== 'releaseOnly' && type !== 'curve';
  const usesOut = type === 'double' || type === 'threeStage';
  const usesSmall = type !== 'vacuumBreaker' && type !== 'curve';
  return (
    <>
      <label className="row dev-check"><input type="checkbox" checked={!!a.treatAsJunction} onChange={(e) => set({ treatAsJunction: e.target.checked })} /> Treat as junction (keep the valve but leave it out of the run)</label>
      <div className="grid2">
        <label className="field" style={{ gridColumn: '1 / -1' }}><span>Type</span>
          <select value={type} onChange={(e) => set({ type: e.target.value as AirValveType })}>
            <option value="double">Double-acting (air in and out)</option>
            <option value="threeStage">Three-stage, anti-slam</option>
            <option value="vacuumBreaker">Vacuum breaker (air in only)</option>
            <option value="releaseOnly">Air release only (small orifice out)</option>
            <option value="curve">Manufacturer flow curves</option>
          </select>
        </label>
        {usesIn && <Num label="Inflow orifice (mm)" value={a.inDiameter} scale={1000} list="dn-sizes" digits={1} onChange={(x) => set({ inDiameter: Math.max(x ?? 0.05, 0.001) })} />}
        {usesOut && <Num label={type === 'threeStage' ? 'Large outflow orifice (mm)' : 'Outflow orifice (mm)'} value={a.outDiameter} scale={1000} list="dn-sizes" digits={1} onChange={(x) => set({ outDiameter: Math.max(x ?? 0.01, 0.0005) })} />}
        {usesSmall && <Num label={type === 'double' ? 'Small orifice (mm, optional)' : 'Small orifice (mm)'} value={a.smallDiameter ?? (type === 'double' ? undefined : Math.max(a.outDiameter / 10, 0.002))} scale={1000} list="small-sizes" digits={1} optional={type === 'double'} onChange={(x) => set({ smallDiameter: x })} />}
        {type === 'threeStage' && <Num label="Switch overpressure (m)" value={a.switchHead ?? 0.3} step={0.05} onChange={(x) => set({ switchHead: Math.max(x ?? 0.3, 0.001) })} />}
        {type !== 'curve' && <Num label="Cd inflow" value={a.cdIn ?? 0.6} step={0.05} onChange={(x) => set({ cdIn: Math.min(Math.max(x ?? 0.6, 0.1), 1) })} />}
        {type !== 'curve' && type !== 'vacuumBreaker' && <Num label="Cd outflow" value={a.cdOut ?? 0.6} step={0.05} onChange={(x) => set({ cdOut: Math.min(Math.max(x ?? 0.6, 0.1), 1) })} />}
      </div>
      {type === 'threeStage' && <p className="muted dev-note">Air leaves through the large orifice until the overpressure reaches the switch value, then only through the small orifice. The air left in the pipe cushions the returning water.</p>}
      {type === 'curve' && (
        <>
          <p className="muted dev-note">One point per line: pressure difference (kPa), free air flow (Nm³/h).</p>
          <div className="grid2">
            <label className="field"><span>Inflow curve</span><textarea rows={5} value={inText} onChange={(e) => { setInText(e.target.value); set({ inCurve: PARSE_CURVE(e.target.value) }); }} /></label>
            <label className="field"><span>Outflow curve</span><textarea rows={5} value={outText} onChange={(e) => { setOutText(e.target.value); set({ outCurve: PARSE_CURVE(e.target.value) }); }} /></label>
          </div>
          <button className="btn small" onClick={() => {
            const m = airValveModel({ ...a, type: 'double' });
            const ic = orificeCurve(m.cdAin, true), oc = orificeCurve(m.cdAout, false);
            setInText(CURVE_TEXT(ic)); setOutText(CURVE_TEXT(oc)); set({ inCurve: ic, outCurve: oc });
          }}>Start from the orifice sizes</button>
        </>
      )}
    </>
  );
}

// ── relief valve ──
function ReliefEditor({ n, setNode }: { n: NetNode; setNode: SetNode }) {
  const r = n.relief!;
  const set = (p: Partial<ReliefValve>) => setNode(n.id, (x) => ({ ...x, relief: { ...x.relief!, ...p } }));
  const byDiameter = !!r.diameter;
  return (
    <div className="grid2">
      <Num label="Set pressure (m)" value={r.setHead} onChange={(x) => set({ setHead: x ?? 0 })} />
      <label className="field"><span>Capacity given by</span>
        <select value={byDiameter ? 'd' : 'c'} onChange={(e) => set(e.target.value === 'd' ? { diameter: 0.1 } : { diameter: undefined })}>
          <option value="d">Valve size</option>
          <option value="c">Flow at +10 m</option>
        </select>
      </label>
      {byDiameter ? (
        <>
          <Num label="Valve Ø (mm)" value={r.diameter} scale={1000} list="dn-sizes" digits={0} onChange={(x) => set({ diameter: Math.max(x ?? 0.05, 0.005) })} />
          <Num label="Cd" value={r.cd ?? 0.7} step={0.05} onChange={(x) => set({ cd: Math.min(Math.max(x ?? 0.7, 0.1), 1) })} />
          <Num label="Full open at +m" value={r.accumulation} optional onChange={(x) => set({ accumulation: x })} />
        </>
      ) : <Num label="Flow at +10 m (L/s)" value={r.capacity} scale={1000} digits={1} onChange={(x) => set({ capacity: Math.max(x ?? 0, 0) })} />}
    </div>
  );
}

// ── open surge tank / one-way tank ──
function TankEditor({ n, setNode }: { n: NetNode; setNode: SetNode }) {
  const t = n.tank!;
  const set = (p: Partial<OpenTank>) => setNode(n.id, (x) => ({ ...x, tank: { ...x.tank!, ...p } }));
  return (
    <>
      <div className="grid2">
        <label className="field" style={{ gridColumn: '1 / -1' }}><span>Kind</span>
          <select value={t.oneWay ? 'oneway' : 'open'} onChange={(e) => set({ oneWay: e.target.value === 'oneway' })}>
            <option value="open">Open standpipe (standpipe)</option>
            <option value="oneway">One-way (feed) tank</option>
          </select>
        </label>
        <Num label="Tank Ø (m)" value={t.diameter} onChange={(x) => set({ diameter: Math.max(x ?? 1, 0.05) })} />
        <Num label="Bottom level (m)" value={t.bottomElev} onChange={(x) => set({ bottomElev: x ?? n.elev })} />
        <Num label="Top / overflow (m)" value={t.topElev} onChange={(x) => set({ topElev: x ?? n.elev + 10 })} />
        {t.oneWay && <Num label="Water level (m)" value={t.initialLevel} onChange={(x) => set({ initialLevel: x })} />}
        <Num label="Connection Ø (mm)" value={t.connDiameter} scale={1000} list="dn-sizes" digits={0} onChange={(x) => set({ connDiameter: Math.max(x ?? 0.1, 0.01) })} />
        <Num label="K in" value={t.kIn} step={0.1} onChange={(x) => set({ kIn: Math.max(x ?? 0, 0) })} />
        <Num label="K out" value={t.kOut} step={0.1} onChange={(x) => set({ kOut: Math.max(x ?? 0, 0) })} />
      </div>
      {!t.oneWay && (
        <label className="field" style={{ marginTop: 6 }}><span>Variable plan area (optional): water level m, area m² — one pair per line</span>
          <textarea rows={3} defaultValue={(t.areaCurve ?? []).map(([z, a]) => `${z}\t${a}`).join('\n')} placeholder={'e.g. shaft then a wide chamber:\n100\t3.1\n118\t3.1\n118.5\t50\n125\t50'} onBlur={(e) => { const rows = e.target.value.split(/\n/).map((l) => l.trim().split(/[\s,;]+/).map(Number)).filter((r) => r.length >= 2 && r.every(Number.isFinite) && r[1] > 0).map(([z, a]) => [z, a] as [number, number]); set({ areaCurve: rows.length >= 2 ? rows : undefined }); }} />
        </label>
      )}
      <p className="muted dev-note">{t.oneWay ? 'A non-return valve lets water flow only from the tank into the pipe, when the pipe head falls below the tank level. Keep the water level below the steady head.' : 'Open to air; the water level starts at the steady head and moves with the surge. Water above the top spills.'}</p>
    </>
  );
}

// ── surge anticipation valve ──
function SavEditor({ n, setNode }: { n: NetNode; setNode: SetNode }) {
  const s = n.sav!;
  const set = (p: Partial<SurgeAnticipationValve>) => setNode(n.id, (x) => ({ ...x, sav: { ...x.sav!, ...p } }));
  return (
    <>
      <div className="grid2">
        <Num label="Valve Ø (mm)" value={s.diameter} scale={1000} list="dn-sizes" digits={0} onChange={(x) => set({ diameter: Math.max(x ?? 0.05, 0.005) })} />
        <Num label="Cd" value={s.cd ?? 0.6} step={0.05} onChange={(x) => set({ cd: Math.min(Math.max(x ?? 0.6, 0.1), 1) })} />
        <Num label="Opens below (m)" value={s.lowSet} onChange={(x) => set({ lowSet: x ?? 0 })} />
        <Num label="Also opens above (m)" value={s.highSet} optional onChange={(x) => set({ highSet: x })} />
        <Num label="Opening time (s)" value={s.openTime} onChange={(x) => set({ openTime: Math.max(x ?? 1, 0.01) })} />
        <Num label="Held open (s)" value={s.holdTime} onChange={(x) => set({ holdTime: Math.max(x ?? 0, 0) })} />
        <Num label="Closing time (s)" value={s.closeTime} onChange={(x) => set({ closeTime: Math.max(x ?? 10, 0.01) })} />
      </div>
      <p className="muted dev-note">Opens when the pressure first drops below the low set point (the down-surge after a pump trip), so it is already open when the up-surge returns; then closes slowly. Discharges to air.</p>
    </>
  );
}

export function DeviceEditors({ n, setNode, result }: { n: NetNode; setNode: SetNode; result: TransientResult | null }) {
  const H0 = result?.steady.heads[n.id];
  const p0 = H0 !== undefined ? H0 - n.elev : undefined;
  return (
    <div className="devices">
      <DeviceDatalists />
      <Section title="Air vessel" on={!!n.vessel} hint="Closed tank with an air cushion (surge vessel), with or without a bladder."
        onAdd={() => setNode(n.id, (x) => ({ ...x, vessel: { volume: 10, gasVolume: 5, n: 1.2, connDiameter: 0.3, kIn: 2.5, kOut: 0.5 } }))}
        onRemove={() => setNode(n.id, (x) => ({ ...x, vessel: undefined }))}>
        <VesselEditor n={n} setNode={setNode} steadyHead={H0} />
      </Section>
      <Section title="Air valve" on={!!n.airValve} hint="Admits air when the pressure drops below atmospheric, and releases it again."
        onAdd={() => setNode(n.id, (x) => ({ ...x, airValve: { inDiameter: 0.1, outDiameter: 0.025, type: 'double' } }))}
        onRemove={() => setNode(n.id, (x) => ({ ...x, airValve: undefined }))}>
        <AirValveEditor key={n.id} n={n} setNode={setNode} />
      </Section>
      <Section title="Standpipe or feed tank" on={!!n.tank} hint="Open standpipe, or a one-way feed tank with a non-return valve."
        onAdd={() => setNode(n.id, (x) => ({ ...x, tank: { diameter: 2, bottomElev: n.elev, topElev: Math.ceil((H0 ?? n.elev + 20) + 10), connDiameter: 0.3, kIn: 1, kOut: 1 } }))}
        onRemove={() => setNode(n.id, (x) => ({ ...x, tank: undefined }))}>
        <TankEditor n={n} setNode={setNode} />
      </Section>
      <Section title="Anticipator valve" on={!!n.sav} hint="Opens on the low-pressure wave so the returning up-surge is discharged."
        onAdd={() => setNode(n.id, (x) => ({ ...x, sav: { diameter: 0.15, cd: 0.6, lowSet: Math.max(Math.round((p0 ?? 30) * 0.8), 1), openTime: 2, holdTime: 10, closeTime: 30 } }))}
        onRemove={() => setNode(n.id, (x) => ({ ...x, sav: undefined }))}>
        <SavEditor n={n} setNode={setNode} />
      </Section>
      <Section title="Pressure relief valve" on={!!n.relief} hint="Opens above its set pressure and discharges to air."
        onAdd={() => setNode(n.id, (x) => ({ ...x, relief: { setHead: Math.round((p0 ?? 50) * 1.15), capacity: 0.1, diameter: 0.1, cd: 0.7 } }))}
        onRemove={() => setNode(n.id, (x) => ({ ...x, relief: undefined }))}>
        <ReliefEditor n={n} setNode={setNode} />
      </Section>
      <Section title="Blow-off" on={!!n.outlet} hint="Blow-off, hydrant or burst that opens at a set time, or a burst disc that bursts at a set pressure."
        onAdd={() => setNode(n.id, (x) => ({ ...x, outlet: { diameter: 0.1, cd: 0.6, trigger: 'time', time: 1, openTime: 0.5 } }))}
        onRemove={() => setNode(n.id, (x) => ({ ...x, outlet: undefined }))}>
        <OutletEditor n={n} setOutlet={(p) => setNode(n.id, (x) => ({ ...x, outlet: { ...x.outlet!, ...p } }))} />
      </Section>
    </div>
  );
}
