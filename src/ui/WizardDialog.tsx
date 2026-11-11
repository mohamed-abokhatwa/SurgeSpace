// Guided wizard: a pumped rising main or a gravity main from a few questions, in four short steps.
import { useMemo, useState } from 'react';
import { PIPE_MATERIALS } from '../app/catalogues';
import { buildFromWizard, wizardDutyHead, wizardWaveSpeed, type WizardSpec } from '../app/wizard';
import type { Network } from '../engine/types';
import { Modal } from './Dialogs';
import { Ic } from './Icons';

const parseProfile = (s: string): [number, number][] => s.split(/\n/).map((l) => l.trim().split(/[\s,;\t]+/).map(Number)).filter((r) => r.length >= 2 && r.every(Number.isFinite)).map(([a, b]) => [a, b] as [number, number]).sort((a, b) => a[0] - b[0]);

export function WizardDialog({ onClose, onBuilt }: { onClose: () => void; onBuilt: (net: Network, notes: string[], designProtection: boolean) => void }) {
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<'pumped' | 'gravity'>('pumped');
  const [name, setName] = useState('New main');
  const [profileText, setProfileText] = useState('0\t96\n1200\t120\n2600\t146\n3500\t128\n5000\t140');
  const [startLevel, setStartLevel] = useState(100);
  const [endLevel, setEndLevel] = useState(147);
  const [dn, setDn] = useState(600);
  const [material, setMaterial] = useState('di');
  const [cls, setCls] = useState(160);
  const [flow, setFlow] = useState(500);
  const [pumps, setPumps] = useState(2);
  const [rpm, setRpm] = useState(1480);
  const [closure, setClosure] = useState(30);
  const [op, setOp] = useState<'trip' | 'start' | 'closure'>('trip');
  const [protect, setProtect] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const profile = useMemo(() => parseProfile(profileText), [profileText]);
  const spec: WizardSpec = { kind, name, profile, startLevel, endLevel, diameterMm: dn, material, pressureClassM: cls, flowLps: flow, pumps, speedRpm: rpm, closureS: closure, operation: kind === 'gravity' ? 'closure' : op === 'closure' ? 'trip' : op };
  const L = profile.length >= 2 ? profile[profile.length - 1][0] - profile[0][0] : 0;
  const a = wizardWaveSpeed(material, dn);
  const V = flow / 1000 / (Math.PI / 4 * (dn / 1000) ** 2);
  const steps = ['System', 'Long section', 'Pipe and flow', kind === 'pumped' ? 'Pumps and event' : 'Valve and event'];
  const ok = [true, profile.length >= 2 && L > 0, dn > 0 && flow > 0, kind === 'gravity' ? closure > 0 : pumps >= 1];
  const build = async () => {
    setBusy(true); setErr(null);
    try { const r = await buildFromWizard(spec); onBuilt(r.net, r.notes, protect); onClose(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const num = (v: string, d: number) => { const x = Number(v); return Number.isFinite(x) ? x : d; };
  return (
    <Modal title="New model wizard" onClose={onClose} wide icon={<Ic name="setup" />} footer={
      <div className="row" style={{ gap: 6, width: '100%' }}>
        <span className="muted small" style={{ flex: 1 }}>Step {step + 1} of {steps.length}: {steps[step]}</span>
        <button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>
        {step < steps.length - 1 ? <button className="btn primary" disabled={!ok[step]} onClick={() => setStep(step + 1)}>Next</button>
          : <button className="btn primary" disabled={busy || !ok.every(Boolean)} onClick={build}>{busy ? 'Building…' : 'Build the model'}</button>}
      </div>}>
      <div className="wizard-steps row" style={{ gap: 6, marginBottom: 10 }}>{steps.map((s, k) => <span key={s} className={`pill ${k === step ? 'good' : ''}`}>{k + 1}. {s}</span>)}</div>
      {step === 0 && (
        <div className="grid2">
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Project name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field"><span>System</span>
            <select value={kind} onChange={(e) => { const k = e.target.value as 'pumped' | 'gravity'; setKind(k); if (k === 'gravity') { setProfileText('0\t180\n3000\t150\n6000\t110'); setStartLevel(190); setEndLevel(115); setDn(500); setFlow(300); } }}>
              <option value="pumped">Pumped rising main (sump → pumps → main → tank)</option>
              <option value="gravity">Gravity main (reservoir → main → valve → reservoir)</option>
            </select>
          </label>
          <p className="hint" style={{ gridColumn: '1 / -1' }}>The wizard builds the model with the same commands as the copilot: everything it creates can be edited afterwards, and one Undo removes it.</p>
        </div>
      )}
      {step === 1 && (
        <div className="grid2">
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Long section: chainage m and pipe level m, one point per line (paste from a spreadsheet)</span>
            <textarea rows={7} value={profileText} onChange={(e) => setProfileText(e.target.value)} />
          </label>
          <label className="field"><span>{kind === 'pumped' ? 'Sump water level' : 'Upstream water level'} <em className="unit">m</em></span><input type="number" value={startLevel} onChange={(e) => setStartLevel(num(e.target.value, startLevel))} /></label>
          <label className="field"><span>{kind === 'pumped' ? 'Tank water level' : 'Downstream water level'} <em className="unit">m</em></span><input type="number" value={endLevel} onChange={(e) => setEndLevel(num(e.target.value, endLevel))} /></label>
          <p className="hint" style={{ gridColumn: '1 / -1' }}>{profile.length} points, {(L / 1000).toFixed(2)} km. High points get air valves automatically.</p>
        </div>
      )}
      {step === 2 && (
        <div className="grid2">
          <label className="field"><span>Material</span><select value={material} onChange={(e) => setMaterial(e.target.value)}>{PIPE_MATERIALS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
          <label className="field"><span>Internal diameter <em className="unit">mm</em></span><input type="number" list="dn-sizes" value={dn} onChange={(e) => setDn(num(e.target.value, dn))} /></label>
          <label className="field"><span>Pressure class <em className="unit">m head</em></span><input type="number" value={cls} onChange={(e) => setCls(num(e.target.value, cls))} /></label>
          <label className="field"><span>Design flow <em className="unit">L/s</em></span><input type="number" value={flow} onChange={(e) => setFlow(num(e.target.value, flow))} /></label>
          <p className="hint" style={{ gridColumn: '1 / -1' }}>Wave speed {a} m/s (buried, restrained). Velocity {V.toFixed(2)} m/s{V > 2.5 ? ' — high: consider a larger pipe' : V < 0.6 ? ' — low: consider a smaller pipe' : ''}. Joukowsky rise for a sudden stop ≈ {(a * V / 9.81).toFixed(0)} m.</p>
        </div>
      )}
      {step === 3 && kind === 'pumped' && (
        <div className="grid2">
          <label className="field"><span>Duty pumps</span><input type="number" min={1} value={pumps} onChange={(e) => setPumps(Math.max(1, Math.round(num(e.target.value, pumps))))} /></label>
          <label className="field"><span>Speed <em className="unit">rpm</em></span><input type="number" value={rpm} onChange={(e) => setRpm(num(e.target.value, rpm))} /></label>
          <label className="field"><span>Event to analyse</span><select value={op} onChange={(e) => setOp(e.target.value as 'trip')}><option value="trip">Power failure: all pumps trip</option><option value="start">Pump start</option></select></label>
          <label className="field"><span><input type="checkbox" checked={protect} onChange={(e) => setProtect(e.target.checked)} /> Then run it and size an air vessel</span></label>
          <p className="hint" style={{ gridColumn: '1 / -1' }}>Duty head per pump {wizardDutyHead(spec)} m (static lift, friction and 5 % margin); the pump curve and inertia are estimated from the duty and can be replaced with the manufacturer's data.</p>
        </div>
      )}
      {step === 3 && kind === 'gravity' && (
        <div className="grid2">
          <label className="field"><span>Valve closure time <em className="unit">s</em></span><input type="number" value={closure} onChange={(e) => setClosure(num(e.target.value, closure))} /></label>
          <label className="field"><span><input type="checkbox" checked={protect} onChange={(e) => setProtect(e.target.checked)} /> Then run it</span></label>
          <p className="hint" style={{ gridColumn: '1 / -1' }}>Wave return time 2L/a = {(2 * L / a).toFixed(1)} s. Closures faster than that give the full Joukowsky rise.</p>
        </div>
      )}
      {err && <p className="bad small" role="alert">{err}</p>}
    </Modal>
  );
}
