// Dialogs: Run Setup, Units, Catalogues (materials, liquids, wave speed calculator), Model Health Check,
// Project details, Element Defaults and Help.
import { useEffect, useState, type ReactNode } from 'react';
import type { Network, Settings } from '../engine/types';
import { barometricHead } from '../engine/types';
import { DEFAULT_FLUID, FLUIDS, PIPE_MATERIALS, RESTRAINTS, waveSpeed, type Restraint } from '../app/catalogues';
import { FLOW_UNITS, PRESSURE_UNITS, fmtQ, setUnits, useUnits } from '../app/units';
import { healthCheck, type Issue } from '../app/health';
import type { ElRef, ElementDefaults } from '../app/edit';
import { ELEMENTS } from '../app/elements';
import { ElIcon, Ic } from './Icons';
import { QNum } from './Properties';

type SetNet = (f: (n: Network) => Network, label?: string) => void;
const num = (s: string) => (s.trim() === '' ? NaN : Number(s));

export function Modal({ title, onClose, children, wide, footer, icon }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode; icon?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">{icon}<b>{title}</b><button className="btn ghost small icon" onClick={onClose} aria-label="Close"><Ic name="close" size={16} /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

function Tabs<T extends string>({ tabs, value, onChange }: { tabs: [T, string][]; value: T; onChange: (t: T) => void }) {
  return <div className="tabs inline">{tabs.map(([k, l]) => <button key={k} className={`tab ${value === k ? 'on' : ''}`} onClick={() => onChange(k)}>{l}</button>)}</div>;
}

export function RunSetupDialog({ net, setNet, onClose, defaults, setDefaults }: { net: Network; setNet: SetNet; onClose: () => void; defaults: ElementDefaults; setDefaults: (d: ElementDefaults) => void }) {
  const [tab, setTab] = useState<'run' | 'liquid' | 'accuracy' | 'checks' | 'units' | 'defaults'>('run');
  const s = net.settings;
  const set = (p: Partial<Settings>) => setNet((n) => ({ ...n, settings: { ...n.settings, ...p } }), 'Run setup');
  const units = useUnits();
  const fluid = s.fluid ?? DEFAULT_FLUID;
  return (
    <Modal title="Run Setup" onClose={onClose} wide icon={<Ic name="setup" />} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      <Tabs tabs={[['run', 'Run'], ['liquid', 'Liquid & site'], ['accuracy', 'Solver accuracy'], ['checks', 'Design limits'], ['units', 'Units'], ['defaults', 'Element defaults']]} value={tab} onChange={setTab} />
      <div className="modal-pane">
        {tab === 'run' && (
          <>
            <div className="grid2">
              <label className="field"><span>Simulation time <em className="unit">s</em></span><input type="number" value={s.duration} onChange={(e) => set({ duration: Math.max(num(e.target.value) || 1, 0.1) })} /></label>
              <label className="field"><span>Animation frames kept</span><input type="number" step={100} value={s.frames ?? 600} onChange={(e) => set({ frames: Math.max(50, Math.min(5000, num(e.target.value) || 600)) })} /></label>
              <label className="field"><span>Friction formula</span>
                <select value={s.friction} onChange={(e) => set({ friction: e.target.value as 'DW' | 'HW' })}>
                  <option value="DW">Darcy–Weisbach (ε in mm)</option>
                  <option value="HW">Hazen–Williams (C)</option>
                </select>
              </label>
            </div>
            <label className="row small" style={{ marginTop: 12 }}><input type="checkbox" checked={s.unsteadyFriction} onChange={(e) => set({ unsteadyFriction: e.target.checked })} /> Unsteady friction (Brunone–Vítkovský with Vardy’s coefficient) — realistic wave damping</label>
            <label className="row small" style={{ marginTop: 6 }}><input type="checkbox" checked={s.pressureDependentDemand} onChange={(e) => set({ pressureDependentDemand: e.target.checked })} /> Pressure-dependent demands during the run (orifice law)</label>
            <p className="hint">Animation frames set how smooth playback and graphs are; the solver always uses its own (much finer) time step.</p>
          </>
        )}
        {tab === 'liquid' && (
          <>
            <label className="field"><span>Liquid</span>
              <select value={fluid.name} onChange={(e) => set({ fluid: FLUIDS.find((f) => f.name === e.target.value) })}>
                {FLUIDS.map((f) => <option key={f.name}>{f.name}</option>)}
              </select>
            </label>
            <div className="grid3" style={{ marginTop: 8 }}>
              <label className="field"><span>Density <em className="unit">kg/m³</em></span><input type="number" step="any" value={fluid.density} onChange={(e) => set({ fluid: { ...fluid, name: 'Custom liquid', density: num(e.target.value) || 1000 } })} /></label>
              <label className="field"><span>Vapour pressure <em className="unit">kPa abs</em></span><input type="number" step="any" value={fluid.vapourPressure} onChange={(e) => set({ fluid: { ...fluid, name: 'Custom liquid', vapourPressure: num(e.target.value) || 0 } })} /></label>
              <label className="field"><span>Viscosity <em className="unit">mm²/s</em></span><input type="number" step="any" value={+((fluid.viscosity ?? 1.004e-6) * 1e6).toFixed(4)} onChange={(e) => set({ fluid: { ...fluid, name: 'Custom liquid', viscosity: (num(e.target.value) || 1) * 1e-6 } })} /></label>
              <label className="field"><span>Bulk modulus <em className="unit">GPa</em></span><input type="number" step="any" value={fluid.bulkModulus ?? 2.19} onChange={(e) => set({ fluid: { ...fluid, name: 'Custom liquid', bulkModulus: num(e.target.value) || 2.19 } })} /></label>
            </div>
            <div className="grid2" style={{ marginTop: 12 }}>
              <QNum label="Site elevation above sea level" q="elevation" value={s.siteElevation ?? 0} onChange={(v) => set({ siteElevation: v ?? 0 })} />
            </div>
            <p className="hint">Atmospheric head at this site: <b>{fmtQ(barometricHead(s.siteElevation ?? 0, fluid.density), 'head', 2, units)}</b> of liquid. Vapour pressure and atmospheric pressure set when the water column separates and how air valves breathe. The bulk modulus is used by the wave speed calculator.</p>
            <button className="btn small" onClick={() => set({ fluid: undefined, siteElevation: undefined })}>Reset to water 20 °C at sea level</button>
          </>
        )}
        {tab === 'accuracy' && (
          <>
            <div className="grid2">
              <label className="field"><span>Largest wave-speed adjustment <em className="unit">%</em></span><input type="number" step="0.1" value={+(s.maxAdjust * 100).toFixed(3)} onChange={(e) => set({ maxAdjust: (num(e.target.value) || 0.5) / 100 })} /></label>
              <label className="field"><span>Computational reach budget</span><input type="number" step="1000" value={s.maxReaches} onChange={(e) => set({ maxReaches: num(e.target.value) || 60000 })} /></label>
              <label className="field"><span>Free gas fraction (cavity model)</span><input type="number" step="any" value={s.gasFraction} onChange={(e) => set({ gasFraction: num(e.target.value) || 1e-7 })} /></label>
              <label className="field"><span>Rigid-column limit <em className="unit">s, 0 = auto</em></span><input type="number" step="0.005" value={s.rigidTravel} onChange={(e) => set({ rigidTravel: num(e.target.value) || 0 })} /></label>
            </div>
            <p className="hint">Pipe lengths are never changed. Wave speeds are adjusted by at most the value above to fit a common time step (default 0.5 %). Pipes too short to carry a wave at that step become rigid water columns instead of being distorted. Column separation uses the discrete gas cavity model; 1e-7 is the research-recommended free gas fraction.</p>
          </>
        )}
        {tab === 'checks' && (
          <>
            <div className="grid2">
              <QNum label="Lowest allowed pressure" q="pressureHead" value={s.minPressure} onChange={(v) => v !== undefined && set({ minPressure: v })} />
              <QNum label="Highest allowed pressure (blank = pipe class)" q="pressureHead" value={s.maxPressure} placeholder="pipe class" onChange={(v) => set({ maxPressure: v })} />
            </div>
            <p className="hint">Used by Design Checks, the map colours and automatic protection sizing. Typical lowest pressure: −5 m (sub-atmospheric limit for most pipes) or 0 m where no negative pressure is accepted.</p>
          </>
        )}
        {tab === 'units' && <UnitsPane />}
        {tab === 'defaults' && <DefaultsPane d={defaults} setD={setDefaults} friction={s.friction} />}
      </div>
    </Modal>
  );
}

export function UnitsPane() {
  const u = useUnits();
  return (
    <>
      <div className="grid3">
        <label className="field"><span>Unit system</span>
          <select value={u.system} onChange={(e) => setUnits({ system: e.target.value as 'SI' | 'US' })}>
            <option value="SI">SI (metric)</option>
            <option value="US">US customary</option>
          </select>
        </label>
        <label className="field"><span>Flow</span><select value={u.flow} onChange={(e) => setUnits({ flow: e.target.value })}>{FLOW_UNITS[u.system].map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="field"><span>Pressure</span><select value={u.pressure} onChange={(e) => setUnits({ pressure: e.target.value })}>{PRESSURE_UNITS[u.system].map((x) => <option key={x} value={x}>{x === 'm' ? 'm head' : x === 'ft' ? 'ft head' : x}</option>)}</select></label>
      </div>
      <p className="hint">Units change only how values are shown and typed; the model is stored in SI, so switching never changes the results. The choice is remembered on this device.</p>
    </>
  );
}

function DefaultsPane({ d, setD, friction }: { d: ElementDefaults; setD: (d: ElementDefaults) => void; friction: 'DW' | 'HW' }) {
  return (
    <>
      <p className="hint" style={{ marginTop: 0 }}>New pipes and junctions drawn on the canvas start with these values.</p>
      <div className="grid2">
        <QNum label="Pipe diameter" q="diameter" value={d.pipeDiameter} onChange={(v) => v && setD({ ...d, pipeDiameter: v })} />
        <label className="field"><span>{friction === 'DW' ? 'Roughness ε (mm)' : 'Hazen–Williams C'}</span><input type="number" step="any" value={d.pipeRoughness} onChange={(e) => setD({ ...d, pipeRoughness: num(e.target.value) || 0 })} /></label>
        <QNum label="Wave speed" q="wavespeed" value={d.wavespeed} onChange={(v) => v && setD({ ...d, wavespeed: v })} />
        <QNum label="Pressure class" q="pressureHead" value={d.pressureClass} onChange={(v) => v && setD({ ...d, pressureClass: v })} />
        <QNum label="Junction elevation (when nothing is near)" q="elevation" value={d.elevation} onChange={(v) => setD({ ...d, elevation: v ?? 0 })} />
        <label className="field"><span>Material</span>
          <select value={d.material ?? ''} onChange={(e) => { const m = PIPE_MATERIALS.find((x) => x.name === e.target.value); setD({ ...d, material: e.target.value || undefined, ...(m ? { pipeRoughness: friction === 'DW' ? m.roughness : m.hwC } : {}) }); }}>
            <option value="">Not set</option>{PIPE_MATERIALS.map((m) => <option key={m.id}>{m.name}</option>)}
          </select>
        </label>
      </div>
      <label className="row small" style={{ marginTop: 10 }}><input type="checkbox" checked={d.autoLength} onChange={(e) => setD({ ...d, autoLength: e.target.checked })} /> New pipes take their length from the drawing (drawing to scale)</label>
    </>
  );
}

export function CataloguesDialog({ net, onClose, onApplyWave }: { net: Network; onClose: () => void; onApplyWave?: (a: number) => void }) {
  const [tab, setTab] = useState<'wave' | 'materials' | 'liquids'>('wave');
  const fluid = net.settings.fluid ?? DEFAULT_FLUID;
  const [mat, setMat] = useState(PIPE_MATERIALS[0].id);
  const m = PIPE_MATERIALS.find((x) => x.id === mat)!;
  const [D, setD] = useState(0.3);
  const [e, setE] = useState<number | undefined>(undefined);
  const [E, setEm] = useState<number | undefined>(undefined);
  const [restraint, setRestraint] = useState<Restraint>('anchoredJoints');
  const wall = e ?? m.wallRatio * D;
  const a = waveSpeed({ D, e: wall, E: E ?? m.E, nu: m.poisson, K: fluid.bulkModulus ?? 2.19, rho: fluid.density, restraint });
  const units = useUnits();
  return (
    <Modal title="Catalogues" onClose={onClose} wide icon={<Ic name="catalogue" />}>
      <Tabs tabs={[['wave', 'Wave speed calculator'], ['materials', 'Pipe materials'], ['liquids', 'Liquids']]} value={tab} onChange={setTab} />
      <div className="modal-pane">
        {tab === 'wave' && (
          <div className="grid2" style={{ alignItems: 'start' }}>
            <div>
              <label className="field"><span>Material</span><select value={mat} onChange={(ev) => { setMat(ev.target.value); setEm(undefined); setE(undefined); }}>{PIPE_MATERIALS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
              <div className="grid2" style={{ marginTop: 8 }}>
                <QNum label="Internal diameter" q="diameter" value={D} onChange={(v) => v && setD(v)} />
                <QNum label="Wall thickness" q="diameter" value={wall} digits={2} onChange={(v) => setE(v)} />
                <label className="field"><span>Young’s modulus <em className="unit">GPa</em></span><input type="number" step="any" value={E ?? m.E} onChange={(ev) => setEm(num(ev.target.value) || undefined)} /></label>
                <label className="field"><span>Poisson’s ratio</span><input type="number" value={m.poisson} disabled /></label>
              </div>
              <label className="field" style={{ marginTop: 8 }}><span>Pipe restraint</span><select value={restraint} onChange={(ev) => setRestraint(ev.target.value as Restraint)}>{RESTRAINTS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
              <p className="hint">Liquid: {fluid.name} (bulk modulus {fluid.bulkModulus ?? 2.19} GPa, density {fluid.density} kg/m³) — change it in Run Setup.</p>
            </div>
            <div className="calc-out">
              <span>Wave speed</span>
              <b>{fmtQ(a, 'wavespeed', 0, units)}</b>
              <span className="small muted">Korteweg–Joukowsky with restraint factor{D / wall < 25 ? ' and thick-wall correction' : ''}. D/e = {(D / wall).toFixed(1)}.</span>
              <span className="small muted">Joukowsky surge for 1 {units.system === 'US' ? 'ft/s' : 'm/s'} change: {fmtQ((a * (units.system === 'US' ? 0.3048 : 1)) / 9.80665, 'head', 1, units)}</span>
              {m.note && <span className="small warn">{m.note}</span>}
              {onApplyWave && <button className="btn primary" style={{ marginTop: 10 }} onClick={() => onApplyWave(Math.round(a))}>Apply to selected pipes</button>}
            </div>
          </div>
        )}
        {tab === 'materials' && (
          <table className="grid">
            <thead><tr><th>Material</th><th>E (GPa)</th><th>Poisson</th><th>ε (mm)</th><th>H-W C</th><th>Typical e/D</th></tr></thead>
            <tbody>{PIPE_MATERIALS.map((x) => <tr key={x.id}><td>{x.name}</td><td className="mono">{x.E}</td><td className="mono">{x.poisson}</td><td className="mono">{x.roughness}</td><td className="mono">{x.hwC}</td><td className="mono">{(x.wallRatio * 100).toFixed(1)} %</td></tr>)}</tbody>
          </table>
        )}
        {tab === 'liquids' && (
          <table className="grid">
            <thead><tr><th>Liquid</th><th>Density (kg/m³)</th><th>Vapour p (kPa)</th><th>ν (mm²/s)</th><th>K (GPa)</th></tr></thead>
            <tbody>{FLUIDS.map((f) => <tr key={f.name}><td>{f.name}</td><td className="mono">{f.density}</td><td className="mono">{f.vapourPressure}</td><td className="mono">{((f.viscosity ?? 0) * 1e6).toFixed(3)}</td><td className="mono">{f.bulkModulus}</td></tr>)}</tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}

export function HealthDialog({ net, onClose, onGo }: { net: Network; onClose: () => void; onGo: (r: ElRef) => void }) {
  const issues: Issue[] = healthCheck(net);
  const count = (l: Issue['level']) => issues.filter((i) => i.level === l).length;
  return (
    <Modal title="Model Health Check" onClose={onClose} wide icon={<Ic name="health" />} footer={<button className="btn primary" onClick={onClose}>Close</button>}>
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <span className="pill bad">{count('error')} errors</span><span className="pill warn">{count('warn')} warnings</span><span className="pill">{count('info')} notes</span>
      </div>
      <div className="issues">
        {issues.map((i, k) => (
          <div key={k} className={`issue ${i.level}`}>
            <span className="dot" />
            <div style={{ flex: 1 }}><b>{i.title}</b>{i.detail && <div className="small muted">{i.detail}</div>}</div>
            {i.ref && <button className="btn small" onClick={() => { onGo(i.ref!); onClose(); }}>Show</button>}
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function ProjectDialog({ net, setNet, onClose }: { net: Network; setNet: SetNet; onClose: () => void }) {
  const r = net.report ?? {};
  const setR = (p: Partial<NonNullable<Network['report']>>) => setNet((n) => ({ ...n, report: { ...n.report, ...p } }), 'Project details');
  return (
    <Modal title="Project details" onClose={onClose} icon={<Ic name="info" />} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      <label className="field"><span>Project name</span><input value={net.name} onChange={(e) => setNet((n) => ({ ...n, name: e.target.value }), 'Rename project')} /></label>
      <label className="field" style={{ marginTop: 8 }}><span>Description</span><textarea rows={3} value={net.description ?? ''} onChange={(e) => setNet((n) => ({ ...n, description: e.target.value }), 'Description')} /></label>
      <div className="grid2" style={{ marginTop: 8 }}>
        <label className="field"><span>Project number</span><input value={r.projectNo ?? ''} onChange={(e) => setR({ projectNo: e.target.value })} /></label>
        <label className="field"><span>Client</span><input value={r.client ?? ''} onChange={(e) => setR({ client: e.target.value })} /></label>
        <label className="field"><span>Prepared by</span><input value={r.preparedBy ?? ''} onChange={(e) => setR({ preparedBy: e.target.value })} /></label>
        <label className="field"><span>Checked by</span><input value={r.checkedBy ?? ''} onChange={(e) => setR({ checkedBy: e.target.value })} /></label>
        <label className="field"><span>Revision</span><input value={r.revision ?? ''} onChange={(e) => setR({ revision: e.target.value })} /></label>
      </div>
      <label className="field" style={{ marginTop: 8 }}><span>Notes for the report</span><textarea rows={3} value={r.notes ?? ''} onChange={(e) => setR({ notes: e.target.value })} /></label>
    </Modal>
  );
}

export const SHORTCUTS: [string, string][] = [
  ['Ctrl/⌘ + Z', 'Undo'], ['Ctrl/⌘ + Shift + Z, Ctrl + Y', 'Redo'], ['Ctrl/⌘ + S', 'Save project'], ['Ctrl/⌘ + O', 'Open project'], ['Ctrl/⌘ + N', 'New project'],
  ['F5 or Ctrl/⌘ + Enter', 'Run'], ['Delete / Backspace', 'Delete selection'], ['Ctrl/⌘ + A', 'Select all'], ['Ctrl/⌘ + D', 'Duplicate selected nodes'], ['Ctrl/⌘ + F', 'Find element'],
  ['Esc', 'Stop drawing, then back to Select'], ['S', 'Select tool'], ['H', 'Pan tool'], ['P', 'Draw pipes'], ['J', 'Junction'], ['R', 'Fixed-level source'], ['U', 'Pump'], ['V', 'Line valve'], ['N', 'Non-return valve'], ['A', 'Air vessel'], ['K', 'Air valve'],
  ['Shift + click (pipe tool)', 'Add a bend while drawing'], ['Double-click a pipe', 'Add a bend (Select tool)'], ['Shift + drag', 'Box select'], ['Right-click', 'Element menu'],
  ['Space', 'Play / pause the animation'], ['← / →', 'Step one frame (Shift: 10)'], ['F', 'Zoom to fit'],
];

export function HelpDialog({ onClose, initial = 'guide', version }: { onClose: () => void; initial?: 'guide' | 'elements' | 'keys' | 'about'; version: string }) {
  const [tab, setTab] = useState(initial);
  return (
    <Modal title="SurgeSpace Help" onClose={onClose} wide icon={<Ic name="help" />}>
      <Tabs tabs={[['guide', 'Quick start'], ['elements', 'Elements'], ['keys', 'Shortcuts'], ['about', 'About']]} value={tab} onChange={setTab} />
      <div className="modal-pane help">
        {tab === 'guide' && (
          <ol className="steps">
            <li><b>Draw the network.</b> Pick <em>Pipe</em> in the ribbon and click from node to node (empty space makes a junction; Shift+click adds a bend). Sources, junctions and devices are placed with one click; click a pipe to insert a pump, valve or device on it. Or import an EPANET file, a spreadsheet, a long section or a DXF.</li>
            <li><b>Enter the data.</b> Select an element to edit it in Properties, or edit many at once in <em>Tables</em>. Several pipes selected → bulk edit. The wave speed calculator is in Catalogues.</li>
            <li><b>Define the operations.</b> In <em>Operations</em>, add pump trips, controlled stops, start-ups and valve movements — as many as the scenario needs, each with its own timing.</li>
            <li><b>Check and run.</b> <em>Model Health Check</em> finds broken links and implausible values. Press <em>Run</em> (F5).</li>
            <li><b>Read the results.</b> Animate surges on the drawing, read envelopes on the long section, graph any element, review Design Checks and slams, and print the detailed report.</li>
            <li><b>Compare options.</b> Save variants as <em>Cases</em> (with and without a vessel, different closure times…), run them all and compare side by side.</li>
            <li><b>Size protection.</b> Analysis → Size air vessel / air valves finds the smallest devices that meet your limits.</li>
          </ol>
        )}
        {tab === 'elements' && (
          <div className="el-ref">
            {ELEMENTS.map((e) => <div key={e.kind} className="el-row"><ElIcon kind={e.kind} size={22} /><div><b>{e.name}</b>{e.key ? <kbd>{e.key}</kbd> : null}<div className="small muted">{e.description}</div></div></div>)}
          </div>
        )}
        {tab === 'keys' && <table className="grid"><tbody>{SHORTCUTS.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}</tbody></table>}
        {tab === 'about' && (
          <div>
            <p><b>SurgeSpace {version}</b> — water hammer and surge analysis for pipelines and networks.</p>
            <p className="small">Method of characteristics on exact geometry (wave speeds within 0.5 %), discrete gas cavity model, unsteady friction, EPANET-compatible steady state, implicit device boundaries. Validated against closed-form theory, EPANET, TSNet and published HAMMER results.</p>
            <p className="small muted">Engineering for Root Cause Solutions · support@engspace.app</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Find an element by id or label. */
export function FindDialog({ net, onClose, onGo }: { net: Network; onClose: () => void; onGo: (r: ElRef) => void }) {
  const [q, setQ] = useState('');
  const all: (ElRef & { label?: string; kind: string })[] = [
    ...net.nodes.map((n) => ({ type: 'node' as const, id: n.id, label: n.label, kind: n.kind === 'reservoir' ? 'Source' : 'Junction' })),
    ...net.pipes.map((p) => ({ type: 'pipe' as const, id: p.id, label: p.label, kind: 'Pipe' })),
    ...net.pumps.map((p) => ({ type: 'pump' as const, id: p.id, label: p.label, kind: 'Pump' })),
    ...net.valves.map((v) => ({ type: 'valve' as const, id: v.id, label: v.label, kind: 'Valve' })),
  ];
  const ql = q.trim().toLowerCase();
  const hits = ql ? all.filter((x) => x.id.toLowerCase().includes(ql) || x.label?.toLowerCase().includes(ql)).slice(0, 60) : all.slice(0, 30);
  return (
    <Modal title="Find element" onClose={onClose} icon={<Ic name="find" />}>
      <input autoFocus className="search" placeholder="Type an id or label…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) { onGo(hits[0]); onClose(); } }} />
      <div className="find-list">
        {hits.map((h) => <button key={`${h.type}:${h.id}`} className="find-item" onClick={() => { onGo(h); onClose(); }}><b>{h.id}</b><span className="muted small">{h.kind}{h.label ? ` · ${h.label}` : ''}</span></button>)}
        {!hits.length && <div className="muted small" style={{ padding: 10 }}>Nothing matches.</div>}
      </div>
    </Modal>
  );
}

/** Background picture: load an image and place it by its corner coordinates. */
export function BackgroundDialog({ net, setNet, onClose }: { net: Network; setNet: SetNet; onClose: () => void }) {
  const bg = net.background;
  const xs = net.nodes.map((n) => n.x), ys = net.nodes.map((n) => n.y);
  const ext = xs.length ? { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) } : { x0: 0, y0: 0, x1: 1000, y1: 700 };
  const set = (p: Partial<NonNullable<Network['background']>>) => setNet((n) => (n.background ? { ...n, background: { ...n.background, ...p } } : n), 'Background');
  const pick = () => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = 'image/*';
    i.onchange = () => {
      const f = i.files?.[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        const src = String(rd.result);
        const im = new Image();
        im.onload = () => {
          // keep the picture's aspect ratio across the model's width
          const w = Math.max(ext.x1 - ext.x0, 1), h = (w * im.height) / im.width;
          const cy = (ext.y0 + ext.y1) / 2;
          setNet((n) => ({ ...n, background: { src, x0: ext.x0, x1: ext.x0 + w, y0: cy - h / 2, y1: cy + h / 2, opacity: 0.5, visible: true } }), 'Background');
        };
        im.src = src;
      };
      rd.readAsDataURL(f);
    };
    i.click();
  };
  return (
    <Modal title="Background picture" onClose={onClose} icon={<Ic name="grid" />} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      <p className="hint" style={{ marginTop: 0 }}>Put a site plan, aerial photo or scanned drawing under the network and trace over it. Place it by the map coordinates of its corners.</p>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn primary small" onClick={pick}>{bg ? 'Replace picture…' : 'Choose picture…'}</button>
        {bg && <button className="btn small" onClick={() => setNet((n) => ({ ...n, background: undefined }), 'Background')}>Remove</button>}
      </div>
      {bg && (
        <>
          <div className="grid2" style={{ marginTop: 12 }}>
            <QNum label="Left (X min)" q="length" value={bg.x0} onChange={(v) => v !== undefined && set({ x0: v })} />
            <QNum label="Right (X max)" q="length" value={bg.x1} onChange={(v) => v !== undefined && set({ x1: v })} />
            <QNum label="Bottom (Y min)" q="length" value={bg.y0} onChange={(v) => v !== undefined && set({ y0: v })} />
            <QNum label="Top (Y max)" q="length" value={bg.y1} onChange={(v) => v !== undefined && set({ y1: v })} />
          </div>
          <label className="field" style={{ marginTop: 8 }}><span>Opacity {Math.round(bg.opacity * 100)} %</span><input type="range" min={5} max={100} value={Math.round(bg.opacity * 100)} onChange={(e) => set({ opacity: num(e.target.value) / 100 })} /></label>
          <label className="row small" style={{ marginTop: 8 }}><input type="checkbox" checked={bg.visible} onChange={(e) => set({ visible: e.target.checked })} /> Show the picture</label>
          <button className="btn small" style={{ marginTop: 8 }} onClick={() => set({ x0: ext.x0, x1: ext.x1, y0: ext.y0, y1: ext.y1 })}>Stretch to the network’s extent</button>
        </>
      )}
    </Modal>
  );
}
