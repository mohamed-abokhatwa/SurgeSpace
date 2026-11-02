import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AirValveSuggestion, Check, VesselSizing } from './engine/analysis';
import { EXAMPLES } from './engine/cases';
import { toInp } from './engine/inp';
import type { PipeEnvelope, TransientResult } from './engine/transient';
import type { Network } from './engine/types';
import { call, cancelAll } from './ui/client';
import { HistoryView } from './ui/HistoryView';
import { ImportDialog } from './ui/ImportDialog';
import { MapView, type ColorMode, type Selection } from './ui/MapView';
import { ChecksView, EventPanel, Inspector, ModelPanel, ProtectionPanel, SettingsPanel } from './ui/panels';
import { ProfileView } from './ui/ProfileView';
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
  const setNet = useCallback((f: (n: Network) => Network) => { setNetRaw(f); setStale(true); }, []);
  const [result, setResult] = useState<TransientResult | null>(null);
  const [checks, setChecks] = useState<Check[]>([]);
  const [unc, setUnc] = useState<UncertaintyOut | null>(null);
  const [sizing, setSizing] = useState<VesselSizing | null>(null);
  const [airSugg, setAirSugg] = useState<AirValveSuggestion[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [mode, setMode] = useState<ColorMode>('max');
  const [sel, setSel] = useState<Selection>(null);
  const [route, setRoute] = useState<[string, string]>(() => defaultRoute(net));
  const [histNodes, setHistNodes] = useState<string[]>([]);
  const [side, setSide] = useState<SideTab>('model');
  const [bottom, setBottom] = useState<BottomTab>('profile');
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<string[] | null>(null);
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>('auto');
  const [examplesOpen, setExamplesOpen] = useState(false);

  useEffect(() => {
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const run = useCallback(async (n: Network = net) => {
    setBusy('Running…');
    setPlaying(false);
    try {
      const out = await call<{ result: TransientResult; checks: Check[] }>({ type: 'run', net: n }, (m) => setBusy(m));
      setResult(out.result);
      setChecks(out.checks);
      setUnc(null);
      setStale(false);
      setFrame(0);
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
    let acc = 0;
    const T = result.times;
    const frameDt = T.length > 1 ? T[1] - T[0] : 1;
    const tick = (now: number) => {
      acc += ((now - last) / 1000) * speed;
      last = now;
      const adv = Math.floor(acc / frameDt);
      if (adv > 0) {
        acc -= adv * frameDt;
        setFrame((f) => {
          const nf = f + adv;
          if (nf >= T.length - 1) { setPlaying(false); return T.length - 1; }
          return nf;
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, result, speed]);

  const load = (n: Network, notes: string[] = []) => {
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

  const select = (s: Selection) => {
    setSel(s);
    if (s?.type === 'node' && result?.nodeHead[s.id]) setHistNodes((h) => (h.includes(s.id) ? h : [...h.slice(-3), s.id]));
  };

  const doUncertainty = async () => {
    setBusy('Uncertainty runs…');
    try {
      const out = await call<{ uncertainty: UncertaintyOut; checks: Check[] }>({ type: 'uncertainty', net }, (m) => setBusy(m));
      setUnc(out.uncertainty);
      setChecks(out.checks);
    } catch (e) { setToast([(e as Error).message]); } finally { setBusy(null); }
  };
  const doSize = async (node: string) => {
    setBusy('Sizing surge vessel…');
    try {
      const out = await call<{ sizing: VesselSizing }>({ type: 'sizeVessel', net, node }, (m) => setBusy(`Sizing surge vessel · ${m}`));
      setSizing(out.sizing);
    } catch (e) { setToast([(e as Error).message]); } finally { setBusy(null); }
  };
  const doAir = async () => {
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

  const tNow = result ? result.times[Math.min(frame, result.times.length - 1)] : 0;
  const fails = checks.filter((c) => c.level === 'fail').length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><Logo /> SurgeLite <small>beta</small></div>
        <div className="project-name" title={net.description}>{net.name}</div>
        <div style={{ position: 'relative' }}>
          <button className="btn" onClick={() => setExamplesOpen((v) => !v)}>Examples ▾</button>
          {examplesOpen && (
            <div className="card" style={{ position: 'absolute', right: 0, top: 40, zIndex: 20, width: 300, padding: 6 }} onMouseLeave={() => setExamplesOpen(false)}>
              {EXAMPLES.map((ex) => {
                const n = ex.make();
                return (
                  <button key={ex.id} className="btn ghost" style={{ width: '100%', justifyContent: 'flex-start', height: 'auto', padding: '8px 10px', flexDirection: 'column', alignItems: 'flex-start' }} onClick={() => { setExamplesOpen(false); load(n); }}>
                    <b>{n.name}</b>
                    <span className="small muted" style={{ whiteSpace: 'normal', textAlign: 'left', fontWeight: 400 }}>{n.description}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <button className="btn" onClick={() => setImporting(true)}>Import</button>
        <button className="btn" onClick={() => download(`${net.name.replace(/[^\w-]+/g, '_')}.surge.json`, JSON.stringify(net, null, 1), 'application/json')} title="Save project">Save</button>
        <button className="btn" onClick={() => {
          const i = document.createElement('input');
          i.type = 'file'; i.accept = '.json';
          i.onchange = () => i.files?.[0]?.text().then((t) => { try { load(JSON.parse(t)); } catch { setToast(['That file is not a SurgeLite project.']); } });
          i.click();
        }} title="Open project">Open</button>
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
            {side === 'model' && <ModelPanel net={net} setNet={setNet} selection={sel} onSelect={select} />}
            {side === 'event' && <EventPanel net={net} setNet={setNet} />}
            {side === 'protection' && <ProtectionPanel net={net} setNet={setNet} busy={!!busy} onSizeVessel={doSize} onAirValves={doAir} sizing={sizing} airSugg={airSugg} />}
            {side === 'settings' && <SettingsPanel net={net} setNet={setNet} />}
          </div>
        </aside>

        <section className="work">
          <div className="map-wrap">
            <MapView net={net} result={result} envelopes={unc?.envelopes} frame={frame} mode={result ? mode : 'plain'} selection={sel} onSelect={select} route={routeSet} />
            <div className="map-tools">
              {(['max', 'min', 'steady', 'frame'] as const).map((m) => (
                <button key={m} className={`btn small ${mode === m ? 'primary' : ''}`} onClick={() => setMode(m)} disabled={!result}>
                  {m === 'max' ? 'Max pressure' : m === 'min' ? 'Min pressure' : m === 'steady' ? 'Steady' : 'Animation'}
                </button>
              ))}
            </div>
            {result && (
              <div className="legend">
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{mode === 'frame' ? `Pressure at ${tNow.toFixed(2)} s` : mode === 'max' ? 'Maximum pressure' : mode === 'min' ? 'Minimum pressure' : 'Steady pressure'}</div>
                {[[-10, 'vapour'], [0, '0 m'], [10, '10 m'], [50, '50 m'], [90, '90 % class'], [120, 'over class']].map(([p, l]) => (
                  <div key={l} className="row" style={{ gap: 6 }}><span style={{ width: 22, height: 6, borderRadius: 3, background: pressureColor(p as number, 100) }} />{l}</div>
                ))}
              </div>
            )}
            {sel && <Inspector net={net} setNet={setNet} sel={sel} result={result} onClose={() => setSel(null)} />}
            {result && (
              <div className="player">
                <button className="btn small primary" onClick={() => { if (frame >= result.times.length - 1) setFrame(0); setMode('frame'); setPlaying(!playing); }}>{playing ? '❚❚' : '▶'}</button>
                <input type="range" min={0} max={result.times.length - 1} value={frame} onChange={(e) => { setFrame(+e.target.value); setMode('frame'); }} aria-label="Time" />
                <span className="mono small" style={{ minWidth: 76, textAlign: 'right' }}>{tNow.toFixed(2)} s</span>
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
              {bottom === 'profile' && (
                <div className="row small" style={{ marginLeft: 'auto', gap: 6, paddingBottom: 4 }}>
                  <span className="muted">Route</span>
                  <select className="cell" style={{ width: 110, border: '1px solid var(--line-2)' }} value={route[0]} onChange={(e) => setRoute([e.target.value, route[1]])}>{net.nodes.map((n) => <option key={n.id}>{n.id}</option>)}</select>
                  <span>→</span>
                  <select className="cell" style={{ width: 110, border: '1px solid var(--line-2)' }} value={route[1]} onChange={(e) => setRoute([route[0], e.target.value])}>{net.nodes.map((n) => <option key={n.id}>{n.id}</option>)}</select>
                </div>
              )}
            </div>
            <div className="bottom-body">
              {!result ? <div className="empty">Results appear here after a run.</div> : (
                <>
                  {bottom === 'profile' && <ProfileView net={net} result={result} a={route[0]} b={route[1]} frame={frame} uEnv={unc?.envelopes} showNow={mode === 'frame'} />}
                  {bottom === 'history' && <HistoryView net={net} result={result} nodes={histNodes} frame={frame} />}
                  {bottom === 'checks' && <ChecksView checks={checks} onFocus={(c) => { if (c.where?.pipe) select({ type: 'pipe', id: c.where.pipe }); else if (c.where?.node) select({ type: 'node', id: c.where.node }); setMode(c.title.toLowerCase().includes('minimum') || c.title.toLowerCase().includes('column') ? 'min' : 'max'); }} />}
                  {bottom === 'uncertainty' && (
                    <div>
                      <p className="small muted" style={{ marginTop: 0 }}>Inputs are never exact. SurgeLite re-runs the case with wave speed ±10 %, valve stroke ±20 % or pump inertia ±15 %, and at half the time step when the water column separates, then reports the worst case. The profile and map show the worst-case envelope once this has run.</p>
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
                        <thead><tr><th>Topic</th><th>Typical fixed-grid MOC (HAMMER defaults)</th><th>SurgeLite</th></tr></thead>
                        <tbody>
                          <tr><td>Pipe geometry</td><td>Lengths or wave speeds stretched to fit the time step; warning only above 75 %</td><td>Lengths kept; wave speeds within {(net.settings.maxAdjust * 100).toFixed(1)} % (this run: {(result.maxAdjust * 100).toFixed(3)} %); very short pipes as rigid columns</td></tr>
                          <tr><td>Column separation</td><td>Vapour cavity at computing points</td><td>Discrete gas cavity model (free gas {net.settings.gasFraction}), closed-form at every section</td></tr>
                          <tr><td>Wave damping</td><td>Steady or quasi-steady friction by default</td><td>{net.settings.unsteadyFriction ? 'Unsteady friction on (Brunone–Vítkovský, Vardy coefficient)' : 'Quasi-steady (unsteady friction off in Settings)'}</td></tr>
                          <tr><td>Uncertainty</td><td>One deterministic run</td><td>Worst-case envelope over wave speed, stroke, inertia and time step</td></tr>
                          <tr><td>Protection design</td><td>Trial and error</td><td>Automatic vessel and air valve sizing</td></tr>
                        </tbody>
                      </table>
                      <div className="row" style={{ gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                        <button className="btn small" onClick={() => download(`${net.name.replace(/[^\w-]+/g, '_')}.inp`, toInp(net))}>Export EPANET (.inp)</button>
                        <button className="btn small" onClick={() => {
                          const rows = ['pipe,chainage_m,elevation_m,steady_head_m,max_head_m,min_head_m,max_pressure_m,min_pressure_m,cavity_L'];
                          for (const e of result.envelopes) for (let i = 0; i < e.s.length; i++) rows.push([e.id, e.s[i].toFixed(2), e.z[i].toFixed(3), e.hSteady[i].toFixed(3), e.hMax[i].toFixed(3), e.hMin[i].toFixed(3), (e.hMax[i] - e.z[i]).toFixed(3), (e.hMin[i] - e.z[i]).toFixed(3), (e.cavMax[i] * 1000).toFixed(2)].join(','));
                          download(`${net.name.replace(/[^\w-]+/g, '_')}-envelopes.csv`, rows.join('\n'), 'text/csv');
                        }}>Export envelopes (.csv)</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </section>
      </div>
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
