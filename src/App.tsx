import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AirValveSuggestion, Check, VesselSizing } from './engine/analysis';
import { EXAMPLES } from './engine/cases';
import { toInp } from './engine/inp';
import type { PipeEnvelope, TransientResult } from './engine/transient';
import type { Network } from './engine/types';
import { call, cancelAll } from './ui/client';
import { HistoryView } from './ui/HistoryView';
import { ImportDialog } from './ui/ImportDialog';
import { ReportDialog } from './ui/ReportDialog';
import { MapView, surgeScale, type ColorMode, type Selection } from './ui/MapView';
import { Timeline } from './ui/Timeline';
import { ChecksView, EventPanel, Inspector, ModelPanel, ProtectionPanel, SettingsPanel } from './ui/panels';
import { ProfileView } from './ui/ProfileView';
import { LicenceDialog, TellUsDialog, useLicence } from './license/LicenceDialog';
import { initLicence, planLabel } from './license/licence';
import { defaultRoute, download, findPath, fmt, pressureColor } from './ui/util';

type SideTab = 'model' | 'event' | 'protection' | 'settings';
type BottomTab = 'profile' | 'history' | 'checks' | 'uncertainty' | 'summary';
interface UncertaintyOut {
  runs: { label: string; maxHead: number; minPressure: number }[];
  envelopes: PipeEnvelope[];
  spread: { maxHead: [number, number]; minPressure: [number, number] };
}

const Logo = () => (
  <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="7" fill="#07111F" />
    <path d="M3 20 L9 20 L12 7 L16 25 L19 13 L22 20 L29 20" fill="none" stroke="#FF7A1A" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
  </svg>
);

export default function App() {
  const [net, setNetRaw] = useState<Network>(() => EXAMPLES[0].make());
  const [stale, setStale] = useState(true);
  // built-in examples run on every plan; editing one makes it the user's own model
  const isExample = useRef(true);
  const setNet = useCallback((f: (n: Network) => Network) => { setNetRaw(f); setStale(true); isExample.current = false; }, []);
  const lic = useLicence();
  const licRef = useRef(lic);
  licRef.current = lic;
  const [licReason, setLicReason] = useState<string | null | undefined>(undefined); // undefined = dialog closed
  const [tellUs, setTellUs] = useState(false);
  useEffect(() => { void initLicence(); }, []);
  /** True when the plan includes the feature; otherwise opens the licence dialog with the reason. */
  const allowed = (ok: boolean, reason: string) => { if (!ok) setLicReason(reason); return ok; };
  const [result, setResult] = useState<TransientResult | null>(null);
  const [checks, setChecks] = useState<Check[]>([]);
  const [unc, setUnc] = useState<UncertaintyOut | null>(null);
  const [sizing, setSizing] = useState<VesselSizing | null>(null);
  const [airSugg, setAirSugg] = useState<AirValveSuggestion[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [framePos, setFramePos] = useState(0);
  const [flowDashes, setFlowDashes] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [mode, setMode] = useState<ColorMode>('max');
  const [sel, setSel] = useState<Selection>(null);
  const [route, setRoute] = useState<[string, string]>(() => defaultRoute(net));
  const [histNodes, setHistNodes] = useState<string[]>([]);
  const [side, setSide] = useState<SideTab>('model');
  const [bottom, setBottom] = useState<BottomTab>('profile');
  const [importing, setImporting] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [toast, setToast] = useState<string[] | null>(null);
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>('auto');
  const [examplesOpen, setExamplesOpen] = useState(false);

  useEffect(() => {
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const run = useCallback(async (n: Network = net) => {
    const f = licRef.current.features;
    if (!isExample.current && n.pipes.length > f.maxPipes) {
      setLicReason(`This model has ${n.pipes.length} pipes. The Free plan runs your own models up to ${f.maxPipes} pipes (built-in examples run at any size). Start a free trial or activate a licence to run it.`);
      return;
    }
    setBusy('Running…');
    setPlaying(false);
    try {
      const out = await call<{ result: TransientResult; checks: Check[] }>({ type: 'run', net: n }, (m) => setBusy(m));
      setResult(out.result);
      setChecks(out.checks);
      setUnc(null);
      setStale(false);
      setFramePos(0);
      setHistNodes((h) => {
        const valid = h.filter((id) => out.result.nodeHead[id]);
        if (valid.length) return valid;
        const pick = [n.pumps[0]?.to, n.nodes.find((x) => x.airValve)?.id, n.valves[0]?.from].filter((x): x is string => !!x && !!out.result.nodeHead[x]);
        return pick.length ? pick : n.nodes.filter((x) => x.kind === 'junction').slice(0, 2).map((x) => x.id);
      });
    } catch (e) {
      setToast([(e as Error).message]);
    } finally {
      setBusy(null);
    }
  }, [net]);

  // first run on load
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; run(); }
  }, [run]);

  // playback
  useEffect(() => {
    if (!playing || !result) return;
    let raf = 0;
    let last = performance.now();
    const T = result.times;
    const frameDt = T.length > 1 ? T[1] - T[0] : 1;
    // continuous time: the map and profile interpolate between stored frames
    const tick = (now: number) => {
      const adv = (((now - last) / 1000) * speed) / frameDt;
      last = now;
      setFramePos((f) => {
        const nf = f + adv;
        if (nf >= T.length - 1) { setPlaying(false); return T.length - 1; }
        return nf;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, result, speed]);

  const load = (n: Network, notes: string[] = [], example = false) => {
    isExample.current = example;
    setNetRaw(n);
    setStale(true);
    setResult(null);
    setChecks([]);
    setUnc(null);
    setSizing(null);
    setAirSugg(null);
    setSel(null);
    setHistNodes([]);
    setRoute(defaultRoute(n));
    if (notes.length) setToast(notes);
    if (n.nodes.some((x) => x.kind === 'reservoir') && n.pipes.length) setTimeout(() => run(n), 50);
  };

  const routeSet = useMemo(() => {
    const p = findPath(net, route[0], route[1]);
    return new Set((p ?? []).filter((h) => h.kind === 'pipe').map((h) => h.id));
  }, [net, route]);

  const select = useCallback((s: Selection) => {
    setSel(s);
    if (s?.type === 'node' && result?.nodeHead[s.id]) setHistNodes((h) => (h.includes(s.id) ? h : [...h.slice(-3), s.id]));
  }, [result]);

  const doUncertainty = async () => {
    if (!allowed(lic.features.uncertainty, 'Uncertainty (worst-case) analysis is part of SurgeSpace Pro.')) return;
    setBusy('Uncertainty runs…');
    try {
      const out = await call<{ uncertainty: UncertaintyOut; checks: Check[] }>({ type: 'uncertainty', net }, (m) => setBusy(m));
      setUnc(out.uncertainty);
      setChecks(out.checks);
    } catch (e) { setToast([(e as Error).message]); } finally { setBusy(null); }
  };
  const doSize = async (node: string) => {
    if (!allowed(lic.features.protectionSizing, 'Automatic surge vessel sizing is part of SurgeSpace Pro.')) return;
    setBusy('Sizing surge vessel…');
    try {
      const out = await call<{ sizing: VesselSizing }>({ type: 'sizeVessel', net, node }, (m) => setBusy(`Sizing surge vessel · ${m}`));
      setSizing(out.sizing);
    } catch (e) { setToast([(e as Error).message]); } finally { setBusy(null); }
  };
  const doAir = async () => {
    if (!allowed(lic.features.protectionSizing, 'Automatic air valve sizing is part of SurgeSpace Pro.')) return;
    setBusy('Sizing air valves…');
    try {
      const out = await call<{ airValves: AirValveSuggestion[] }>({ type: 'airValves', net }, (m) => setBusy(m));
      setAirSugg(out.airValves);
    } catch (e) { setToast([(e as Error).message]); } finally { setBusy(null); }
  };

  const summary = useMemo(() => {
    if (!result) return null;
    let maxH = -Infinity, minP = Infinity, maxP = -Infinity, cav = 0;
    for (const e of result.envelopes)
      for (let i = 0; i < e.s.length; i++) {
        maxH = Math.max(maxH, e.hMax[i]);
        maxP = Math.max(maxP, e.hMax[i] - e.z[i]);
        minP = Math.min(minP, e.hMin[i] - e.z[i]);
        cav = Math.max(cav, e.cavMax[i]);
      }
    return { maxH, minP, maxP, cav };
  }, [result]);

  const tNow = result ? (() => { const T = result.times, f0 = Math.min(Math.floor(framePos), T.length - 1), f1 = Math.min(f0 + 1, T.length - 1); return T[f0] + (T[f1] - T[f0]) * (framePos - f0); })() : 0;
  const sScale = useMemo(() => (result ? surgeScale(result) : 1), [result]);
  useEffect(() => { if (result && !(framePos <= result.times.length - 1)) setFramePos(0); }, [result, framePos]);
  const live = mode === 'surge' || mode === 'pressure';
  const togglePlay = useCallback(() => {
    if (!result) return;
    if (framePos >= result.times.length - 1) setFramePos(0);
    if (mode !== 'surge' && mode !== 'pressure') setMode('surge');
    setPlaying((p) => !p);
  }, [result, framePos, mode]);
  // keyboard: space plays / pauses, arrows step, when not typing in a field
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable || t.getAttribute('role') === 'slider')) return;
      if (!result) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        setPlaying(false);
        if (!live) setMode('surge');
        const d = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : 1);
        setFramePos((f) => Math.max(0, Math.min(result.times.length - 1, Math.round(f) + d)));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [result, togglePlay, live]);
  const fails = checks.filter((c) => c.level === 'fail').length;
  // route picker: thousands of options on big networks, so build it only when the route or nodes change
  const routePicker = useMemo(() => (
    <div className="row small" style={{ marginLeft: 'auto', gap: 6, paddingBottom: 4 }}>
      <span className="muted">Route</span>
      <select className="cell" style={{ width: 110, border: '1px solid var(--line-2)' }} value={route[0]} onChange={(e) => setRoute([e.target.value, route[1]])}>{net.nodes.map((n) => <option key={n.id}>{n.id}</option>)}</select>
      <span>→</span>
      <select className="cell" style={{ width: 110, border: '1px solid var(--line-2)' }} value={route[1]} onChange={(e) => setRoute([route[0], e.target.value])}>{net.nodes.map((n) => <option key={n.id}>{n.id}</option>)}</select>
    </div>
  ), [net.nodes, route]);
  // the side panel does not depend on playback time; keep it out of the per-frame re-render
  const sidePanel = useMemo(() => (
    <>
      {side === 'model' && <ModelPanel net={net} setNet={setNet} selection={sel} onSelect={select} />}
      {side === 'event' && <EventPanel net={net} setNet={setNet} />}
      {side === 'protection' && <ProtectionPanel net={net} setNet={setNet} busy={!!busy} onSizeVessel={doSize} onAirValves={doAir} sizing={sizing} airSugg={airSugg} />}
      {side === 'settings' && <SettingsPanel net={net} setNet={setNet} />}
    </>
  ), [side, net, setNet, sel, select, busy, sizing, airSugg]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><Logo /> SurgeSpace</div>
        <button className={`plan-badge ${lic.plan}`} onClick={() => setLicReason(null)} title="Licence">{lic.checking ? '…' : planLabel(lic)}</button>
        <div className="project-name" title={net.description}>{net.name}</div>
        <div style={{ position: 'relative' }}>
          <button className="btn" onClick={() => setExamplesOpen((v) => !v)}>Examples ▾</button>
          {examplesOpen && (
            <div className="card" style={{ position: 'absolute', right: 0, top: 40, zIndex: 20, width: 300, padding: 6 }} onMouseLeave={() => setExamplesOpen(false)}>
              {EXAMPLES.map((ex) => {
                const n = ex.make();
                return (
                  <button key={ex.id} className="btn ghost" style={{ width: '100%', justifyContent: 'flex-start', height: 'auto', padding: '8px 10px', flexDirection: 'column', alignItems: 'flex-start' }} onClick={() => { setExamplesOpen(false); load(n, [], true); }}>
                    <b>{n.name}</b>
                    <span className="small muted" style={{ whiteSpace: 'normal', textAlign: 'left', fontWeight: 400 }}>{n.description}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <button className="btn ghost" onClick={() => setTellUs(true)} title="Questions, ideas or problems">Tell us</button>
        <button className="btn" onClick={() => setImporting(true)}>Import</button>
        <button className="btn" onClick={() => download(`${net.name.replace(/[^\w-]+/g, '_')}.surge.json`, JSON.stringify(net, null, 1), 'application/json')} title="Save project">Save</button>
        <button className="btn" onClick={() => {
          const i = document.createElement('input');
          i.type = 'file'; i.accept = '.json';
          i.onchange = () => i.files?.[0]?.text().then((t) => { try { load(JSON.parse(t)); } catch { setToast(['That file is not a SurgeSpace project.']); } });
          i.click();
        }} title="Open project">Open</button>
        <button className="btn" disabled={!result} title={result ? 'Detailed report (print or save as PDF)' : 'Run first'} onClick={() => allowed(lic.features.exportFiles, 'The detailed report is part of SurgeSpace Pro.') && setReporting(true)}>Report</button>
        <button className="btn ghost" onClick={() => setTheme(theme === 'auto' ? 'dark' : theme === 'dark' ? 'light' : 'auto')} title="Theme">{theme === 'auto' ? '◐' : theme === 'dark' ? '☾' : '☀'}</button>
        <button className="btn primary" disabled={!!busy} onClick={() => run()}>{busy ? 'Running…' : stale && result ? '▶ Run (changed)' : '▶ Run'}</button>
      </header>

      <div className="main">
        <aside className="side">
          <div className="tabs">
            {([['model', 'Model'], ['event', 'Event'], ['protection', 'Protection'], ['settings', 'Settings']] as const).map(([k, l]) => (
              <button key={k} className={`tab ${side === k ? 'on' : ''}`} onClick={() => setSide(k)}>{l}</button>
            ))}
          </div>
          <div className="side-body">
            {sidePanel}
          </div>
        </aside>

        <section className="work">
          <div className="map-wrap">
            <MapView net={net} result={result} envelopes={unc?.envelopes} framePos={framePos} mode={result ? mode : 'plain'} selection={sel} onSelect={select} route={routeSet} flowDashes={flowDashes} playing={playing} sScale={sScale} />
            <div className="map-tools">
              <div className="seg" role="group" aria-label="Live view">
                {(['surge', 'pressure'] as const).map((m) => (
                  <button key={m} className={`seg-btn ${mode === m ? 'on' : ''}`} onClick={() => setMode(m)} disabled={!result}>{m === 'surge' ? 'Surge' : 'Pressure'}</button>
                ))}
              </div>
              <div className="seg" role="group" aria-label="Envelopes">
                {(['max', 'min', 'steady'] as const).map((m) => (
                  <button key={m} className={`seg-btn ${mode === m ? 'on' : ''}`} onClick={() => { setMode(m); setPlaying(false); }} disabled={!result}>{m === 'max' ? 'Max' : m === 'min' ? 'Min' : 'Steady'}</button>
                ))}
              </div>
              {live && result && (
                <button className={`btn small ${flowDashes ? 'primary' : ''}`} onClick={() => setFlowDashes((v) => !v)} aria-pressed={flowDashes} title="Show flow direction and speed">Flow</button>
              )}
            </div>
            {result && (
              <div className="legend">
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{mode === 'surge' ? `Change from steady · ${tNow.toFixed(2)} s` : mode === 'pressure' ? `Pressure head · ${tNow.toFixed(2)} s` : mode === 'max' ? 'Maximum pressure' : mode === 'min' ? 'Minimum pressure' : 'Steady pressure'}</div>
                {mode === 'surge' ? (
                  <div>
                    <div className="surge-bar" />
                    <div className="row mono" style={{ justifyContent: 'space-between', fontSize: 10.5 }}><span>−{fmt(sScale, 0)}</span><span>0</span><span>+{fmt(sScale, 0)} m</span></div>
                    <div className="muted" style={{ fontSize: 10.5, marginTop: 2 }}>blue = drop · red = rise</div>
                  </div>
                ) : [[-10, 'vapour'], [0, '0 m'], [10, '10 m'], [50, '50 m'], [90, '90 % class'], [120, 'over class']].map(([p, l]) => (
                  <div key={l} className="row" style={{ gap: 6 }}><span style={{ width: 22, height: 6, borderRadius: 3, background: pressureColor(p as number, 100) }} />{l}</div>
                ))}
              </div>
            )}
            {sel && <Inspector net={net} setNet={setNet} sel={sel} result={result} onClose={() => setSel(null)} />}
            {result && (
              <div className="player">
                <button className="btn primary play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} title="Space">{playing ? '❚❚' : '▶'}</button>
                <Timeline net={net} result={result} framePos={framePos} onSeek={(f) => { setFramePos(f); setPlaying(false); if (!live) setMode('surge'); }} />
                <span className="mono small" style={{ minWidth: 64, textAlign: 'right' }}>{tNow.toFixed(2)} s</span>
                <select className="cell" style={{ width: 64 }} value={speed} onChange={(e) => setSpeed(+e.target.value)} aria-label="Playback speed">
                  {[0.25, 0.5, 1, 2, 4, 8].map((s) => <option key={s} value={s}>{s}×</option>)}
                </select>
              </div>
            )}
            {busy && <div className="progress"><div className="card">{busy}</div></div>}
            {!result && !busy && <div className="progress"><div className="card small">Press <b>Run</b> to simulate.</div></div>}
          </div>

          <div className="bottom">
            <div className="tabs" style={{ alignItems: 'center' }}>
              {([['profile', 'Profile'], ['history', 'Time history'], ['checks', `Checks${fails ? ` · ${fails} to fix` : ''}`], ['uncertainty', 'Uncertainty'], ['summary', 'Engine']] as const).map(([k, l]) => (
                <button key={k} className={`tab ${bottom === k ? 'on' : ''}`} onClick={() => setBottom(k)} style={k === 'checks' && fails ? { color: 'var(--bad)' } : undefined}>{l}</button>
              ))}
              {bottom === 'profile' && routePicker}
            </div>
            <div className="bottom-body">
              {!result ? <div className="empty">Results appear here after a run.</div> : (
                <>
                  {bottom === 'profile' && <ProfileView net={net} result={result} a={route[0]} b={route[1]} framePos={framePos} uEnv={unc?.envelopes} showNow={live} />}
                  {bottom === 'history' && <HistoryView net={net} result={result} nodes={histNodes} tNow={tNow} />}
                  {bottom === 'checks' && <ChecksView checks={checks} onFocus={(c) => { if (c.where?.pipe) select({ type: 'pipe', id: c.where.pipe }); else if (c.where?.node) select({ type: 'node', id: c.where.node }); setMode(c.title.toLowerCase().includes('minimum') || c.title.toLowerCase().includes('column') ? 'min' : 'max'); }} />}
                  {bottom === 'uncertainty' && (
                    <div>
                      <p className="small muted" style={{ marginTop: 0 }}>Inputs are never exact. SurgeSpace re-runs the case with wave speed ±10 %, valve stroke ±20 % or pump inertia ±15 %, and at half the time step when the water column separates, then reports the worst case. The profile and map show the worst-case envelope once this has run.</p>
                      <button className="btn primary" disabled={!!busy} onClick={doUncertainty}>Run uncertainty analysis</button>
                      {unc && (
                        <>
                          <div className="stats" style={{ marginTop: 10 }}>
                            <div className="stat"><b>{fmt(unc.spread.maxHead[0], 1)}–{fmt(unc.spread.maxHead[1], 1)} m</b><span>Maximum head range</span></div>
                            <div className="stat"><b>{fmt(unc.spread.minPressure[0], 1)}–{fmt(unc.spread.minPressure[1], 1)} m</b><span>Minimum pressure range</span></div>
                          </div>
                          <table className="grid" style={{ marginTop: 10 }}>
                            <thead><tr><th>Run</th><th>Max head (m)</th><th>Min pressure (m)</th></tr></thead>
                            <tbody>{unc.runs.map((r) => <tr key={r.label}><td>{r.label}</td><td className="mono">{fmt(r.maxHead, 2)}</td><td className="mono">{fmt(r.minPressure, 2)}</td></tr>)}</tbody>
                          </table>
                        </>
                      )}
                    </div>
                  )}
                  {bottom === 'summary' && summary && (
                    <div>
                      <div className="stats">
                        <div className="stat"><b>{fmt(summary.maxP, 1)} m</b><span>Highest pressure</span></div>
                        <div className="stat"><b style={{ color: summary.minP < net.settings.minPressure ? 'var(--bad)' : undefined }}>{fmt(summary.minP, 1)} m</b><span>Lowest pressure</span></div>
                        <div className="stat"><b>{(result.maxAdjust * 100).toFixed(3)} %</b><span>Max wave-speed change</span></div>
                        <div className="stat"><b>{result.dt.toPrecision(3)} s</b><span>Time step</span></div>
                        <div className="stat"><b>{result.reaches.toLocaleString()}</b><span>Reaches</span></div>
                        <div className="stat"><b>{result.steps.toLocaleString()}</b><span>Steps</span></div>
                        <div className="stat"><b>{(result.runtimeMs / 1000).toFixed(2)} s</b><span>Run time</span></div>
                        <div className="stat"><b>{result.rigidPipes.length}</b><span>Rigid-column pipes</span></div>
                      </div>
                      <div className="label">How this engine goes beyond a standard MOC solver</div>
                      <table className="grid">
                        <thead><tr><th>Topic</th><th>Typical fixed-grid MOC (HAMMER defaults)</th><th>SurgeSpace</th></tr></thead>
                        <tbody>
                          <tr><td>Pipe geometry</td><td>Lengths or wave speeds stretched to fit the time step; warning only above 75 %</td><td>Lengths kept; wave speeds within {(net.settings.maxAdjust * 100).toFixed(1)} % (this run: {(result.maxAdjust * 100).toFixed(3)} %); very short pipes as rigid columns</td></tr>
                          <tr><td>Column separation</td><td>Vapour cavity at computing points</td><td>Discrete gas cavity model (free gas {net.settings.gasFraction}), closed-form at every section</td></tr>
                          <tr><td>Wave damping</td><td>Steady or quasi-steady friction by default</td><td>{net.settings.unsteadyFriction ? 'Unsteady friction on (Brunone–Vítkovský, Vardy coefficient)' : 'Quasi-steady (unsteady friction off in Settings)'}</td></tr>
                          <tr><td>Uncertainty</td><td>One deterministic run</td><td>Worst-case envelope over wave speed, stroke, inertia and time step</td></tr>
                          <tr><td>Protection devices</td><td>Hydropneumatic tank, air valves, surge tanks, relief and anticipation valves</td><td>The same, plus horizontal/spherical tanks, bladder pre-charge, dip tube, connection inertia, non-return valve with bypass, three-stage anti-slam and manufacturer-curve air valves, "treat as junction", rupture disks and timed outlets</td></tr>
                          <tr><td>Valves and check valves</td><td>Check valves on pipes and pumps; valve types; PRV / PSV / FCV</td><td>Check valves on pipes, pumps and valves that close ideally, after a delay, at a reverse velocity or by the manufacturer's dynamic characteristic, with slam detection; gate, globe, ball, butterfly, needle or manufacturer valve curves; operating curves; PRV / PSV / FCV locked or active</td></tr>
                          <tr><td>Report</td><td>Printed tables and graphs</td><td>One-click detailed report (summary, inputs, all node and pipe results, devices, slams, checks, time histories) to PDF</td></tr>
                          <tr><td>Protection design</td><td>Trial and error</td><td>Automatic vessel and air valve sizing</td></tr>
                        </tbody>
                      </table>
                      <div className="label">Validation</div>
                      <table className="grid">
                        <thead><tr><th>Benchmark</th><th>Compared</th><th>Agreement</th></tr></thead>
                        <tbody>
                          <tr><td>Bentley HAMMER · Tnet0 valve closure</td><td>Max and min head at both points</td><td>Exact to 0.1 m (761.8 / 738.3 m at the valve)</td></tr>
                          <tr><td>Bentley HAMMER · BWSN-1 network, pump shutdown</td><td>Max and min head at 332 pipe ends</td><td>Mean 1.6 m (max) and 0.8 m (min) on surges up to 44 m; 92 % within 3 m</td></tr>
                          <tr><td>TSNet · EPANET Net3, valve closure</td><td>Head histories at 8 nodes</td><td>First wave within 0.2–1.5 m; steady within 0.01 m</td></tr>
                          <tr><td>EPANET 2.2 · Net3, ky4, Net6 (3,323 junctions)</td><td>Steady heads and flows</td><td>Mean 0.001 m, worst 0.012 m</td></tr>
                          <tr><td>Closed-form theory</td><td>Joukowsky, 2L/a, junction transmission</td><td>0.05–0.8 %</td></tr>
                        </tbody>
                      </table>
                      <div className="row" style={{ gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                        <button className="btn small" onClick={() => allowed(lic.features.exportFiles, 'Export is part of SurgeSpace Pro.') && download(`${net.name.replace(/[^\w-]+/g, '_')}.inp`, toInp(net))}>Export EPANET (.inp)</button>
                        <button className="btn small" onClick={() => {
                          if (!allowed(lic.features.exportFiles, 'Export is part of SurgeSpace Pro.')) return;
                          const rows = ['pipe,chainage_m,elevation_m,steady_head_m,max_head_m,min_head_m,max_pressure_m,min_pressure_m,cavity_L'];
                          for (const e of result.envelopes) for (let i = 0; i < e.s.length; i++) rows.push([e.id, e.s[i].toFixed(2), e.z[i].toFixed(3), e.hSteady[i].toFixed(3), e.hMax[i].toFixed(3), e.hMin[i].toFixed(3), (e.hMax[i] - e.z[i]).toFixed(3), (e.hMin[i] - e.z[i]).toFixed(3), (e.cavMax[i] * 1000).toFixed(2)].join(','));
                          download(`${net.name.replace(/[^\w-]+/g, '_')}-envelopes.csv`, rows.join('\n'), 'text/csv');
                        }}>Export envelopes (.csv)</button>
                        <button className="btn small" onClick={() => allowed(lic.features.exportFiles, 'The detailed report is part of SurgeSpace Pro.') && setReporting(true)}>Detailed report (PDF)</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </section>
      </div>
      {tellUs && <TellUsDialog where={`${side} · ${bottom} · ${net.name}`} onClose={() => setTellUs(false)} />}
      {licReason !== undefined && <LicenceDialog reason={licReason ?? undefined} onClose={() => setLicReason(undefined)} />}
      {reporting && result && <ReportDialog net={net} result={result} checks={checks} route={route} nodes={histNodes} version={__APP_VERSION__}
        onSaveInfo={(info) => setNetRaw((n) => ({ ...n, report: info }))} onClose={() => setReporting(false)} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} onImport={(n, notes) => { setImporting(false); load(n, notes); }} />}
      {toast && (
        <div className="card small" style={{ position: 'fixed', right: 16, bottom: 16, maxWidth: 420, zIndex: 60 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}><b>Notes</b><button className="btn ghost small" onClick={() => setToast(null)}>×</button></div>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{toast.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </div>
      )}
      {busy && busy.includes('Sizing') && <button className="btn small" style={{ position: 'fixed', left: 16, bottom: 16, zIndex: 60 }} onClick={() => { cancelAll(); setBusy(null); }}>Cancel</button>}
    </div>
  );
}
