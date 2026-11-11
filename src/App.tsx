import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AirValveSuggestion, Check, VesselSizing } from './engine/analysis';
import { EXAMPLES } from './engine/cases';
import { toInp } from './engine/inp';
import type { PipeEnvelope, TransientResult } from './engine/transient';
import { defaultSettings, type Network } from './engine/types';
import { call, cancelAll } from './ui/client';
import { ImportDialog } from './ui/ImportDialog';
import { ReportDialog } from './ui/ReportDialog';
import { Canvas, colorByPipes, surgeScale, type ColorBy, type ContourBy, type ColorMode, type Tool, type ValueLabel, type ViewOpts } from './ui/Canvas';
import { Timeline } from './ui/Timeline';
import { ChecksView, ProtectionPanel } from './ui/panels';
import { ProfileView } from './ui/ProfileView';
import { LicenceDialog, TellUsDialog, useLicence } from './license/LicenceDialog';
import { initLicence, planLabel } from './license/licence';
import { defaultRoute, download, findPath, pressureColor } from './ui/util';
import { MenuBar, ContextMenu, type Menu, type MenuItem } from './ui/MenuBar';
import { ElIcon, Ic, type ActionIcon } from './ui/Icons';
import { ELEMENTS, EL, deviceDefaults, nodeDevices, removeDevice, type ElementKind } from './app/elements';
import { DEFAULTS, deleteElements, duplicateNodes, insertOnPipe, lengthsFromDrawing, reversePipe, splitPipe, addNode, type ElRef, type ElementDefaults } from './app/edit';
import { fmtQ, setUnits, uLabel, toShow, useUnits } from './app/units';
import { Properties } from './ui/Properties';
import { OperationsPanel } from './ui/Operations';
import { BackgroundDialog, CataloguesDialog, FindDialog, HealthDialog, HelpDialog, ProjectDialog, RunSetupDialog } from './ui/Dialogs';
import { DataSheets } from './ui/DataSheets';
import { CasesPanel, addCase, syncActive } from './ui/Cases';
import { LivePanel } from './ui/LivePanel';
import { EPSPanel, epsPipeColours, type EPSColour } from './ui/EPSPanel';
import { clock, networkAt, type EPSResult } from './engine/eps';
import { skeletonise } from './engine/skeleton';
import { fromGeoJSON, toDXF, toGeoJSON, type GeoJSON } from './app/exchange';
import { applyDesign, type Design, type OptVar } from './engine/optimise';
import { Explorer } from './ui/Explorer';
import { GraphsView, type GraphItem } from './ui/GraphsView';
import { healthCheck } from './app/health';
import type { CommandContext, RunOutput } from './app/commands';
import { projectJson, upgradeProject } from './app/project';
import { AI_TASKS } from './ai/agent';
import { initAITransport } from './ai/transport';
import { useAI } from './ai/accounts';
import { AIAccountsDialog, CopilotPanel } from './ui/AIPanel';

type LeftTab = 'explorer' | 'operations';
type BottomTab = 'profile' | 'graphs' | 'checks' | 'tables' | 'cases' | 'protection' | 'uncertainty' | 'log' | 'eps' | 'live';
interface UncertaintyOut { runs: { label: string; maxHead: number; minPressure: number }[]; envelopes: PipeEnvelope[]; spread: { maxHead: [number, number]; minPressure: [number, number] } }
type Dialog = null | 'background' | 'import' | 'report' | 'setup' | 'catalogues' | 'health' | 'project' | 'help' | 'keys' | 'about' | 'find' | 'tellus' | 'ai';

const Logo = () => (
  <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="7" fill="#07111F" />
    <path d="M3 20 L9 20 L12 7 L16 25 L19 13 L22 20 L29 20" fill="none" stroke="#FF7A1A" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
  </svg>
);

const blankModel = (): Network => ({
  name: 'Untitled model', description: '', nodes: [], pipes: [], pumps: [], valves: [],
  event: { kind: 'none', targets: [], start: 1 }, settings: { ...defaultSettings(), duration: 60 },
});
const safeName = (s: string) => s.replace(/[^\w-]+/g, '_') || 'model';
const readLS = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const writeLS = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };

export default function App() {
  const units = useUnits();
  const [net, setNetRaw] = useState<Network>(() => EXAMPLES[0].make());
  const netRef = useRef(net);
  netRef.current = net;
  const [stale, setStale] = useState(true);
  const isExample = useRef(true);
  // ── undo / redo: snapshots; quick edits with the same label are merged into one step ──
  const past = useRef<Network[]>([]);
  const future = useRef<Network[]>([]);
  const lastEdit = useRef<{ label: string; t: number }>({ label: '', t: 0 });
  const [, setHistTick] = useState(0);
  const [result, setResult] = useState<TransientResult | null>(null);
  const [mode, setMode] = useState<ColorMode>('max');
  const setNet = useCallback((f: (n: Network) => Network, label = 'Edit') => {
    const cur = netRef.current;
    const next = f(cur);
    if (next === cur) return;
    const now = Date.now();
    if (!(lastEdit.current.label === label && now - lastEdit.current.t < 900 && label !== 'Move')) {
      past.current.push(cur);
      if (past.current.length > 150) past.current.shift();
    }
    lastEdit.current = { label, t: now };
    future.current = [];
    netRef.current = next;
    setNetRaw(next);
    setStale(true);
    isExample.current = false;
    setMode((m) => (m === 'surge' || m === 'pressure' || m === 'max' || m === 'min' || m === 'steady' ? 'plain' : m));
    setHistTick((k) => k + 1);
  }, []);
  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(netRef.current);
    netRef.current = prev;
    setNetRaw(prev); setStale(true); lastEdit.current = { label: '', t: 0 }; setHistTick((k) => k + 1);
  }, []);
  const redo = useCallback(() => {
    const nx = future.current.pop();
    if (!nx) return;
    past.current.push(netRef.current);
    netRef.current = nx;
    setNetRaw(nx); setStale(true); lastEdit.current = { label: '', t: 0 }; setHistTick((k) => k + 1);
  }, []);

  const lic = useLicence();
  const licRef = useRef(lic);
  licRef.current = lic;
  const [licReason, setLicReason] = useState<string | null | undefined>(undefined);
  useEffect(() => { void initLicence(); }, []);
  const allowed = (ok: boolean, reason: string) => { if (!ok) setLicReason(reason); return ok; };

  const [checks, setChecks] = useState<Check[]>([]);
  const [unc, setUnc] = useState<UncertaintyOut | null>(null);
  const [sizing, setSizing] = useState<VesselSizing | null>(null);
  const [airSugg, setAirSugg] = useState<AirValveSuggestion[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [framePos, setFramePos] = useState(0);
  const [flowDashes, setFlowDashes] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selected, setSelected] = useState<ElRef[]>([]);
  const [route, setRoute] = useState<[string, string]>(() => defaultRoute(net));
  const [graphs, setGraphs] = useState<GraphItem[]>([]);
  const [left, setLeft] = useState<LeftTab>('explorer');
  const [bottom, setBottom] = useState<BottomTab>('profile');
  const [dock, setDock] = useState<'normal' | 'max' | 'min'>('normal');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toast, setToast] = useState<string[] | null>(null);
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>(() => (readLS('surgespace.theme') as 'auto' | 'light' | 'dark') || 'auto');
  const [tool, setTool] = useState<Tool>('select');
  const [viewOpts, setViewOpts] = useState<ViewOpts>({ ids: true, values: 'none', grid: true, snap: false, colorBy: 'none', north: true });
  const [defaults, setDefaults] = useState<ElementDefaults>(DEFAULTS);
  const [cursorW, setCursorW] = useState<{ x: number; y: number } | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [ctx, setCtx] = useState<{ x: number; y: number; ref: ElRef | null; world: { x: number; y: number }; u?: number } | null>(null);
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(true);
  const [right, setRight] = useState<'props' | 'ai'>('props');
  const [epsRes, setEpsRes] = useState<{ r: EPSResult; net: Network } | null>(null);
  const [epsK, setEpsK] = useState(0);
  const [epsColour, setEpsColour] = useState<EPSColour>('none');
  const [aiQueued, setAiQueued] = useState<{ prompt: string; label: string } | null>(null);
  const ai = useAI();
  useEffect(() => { void initAITransport(); }, []);
  // the last run and the model it was made for (the copilot only reads results that match the current model)
  const lastRun = useRef<{ out: RunOutput; net: Network } | null>(null);

  useEffect(() => {
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    writeLS('surgespace.theme', theme);
  }, [theme]);
  // autosave (recover from File menu)
  useEffect(() => {
    if (isExample.current) return;
    const t = setTimeout(() => writeLS('surgespace.autosave', projectJson({ ...net, cases: net.cases ? syncActive(net) : undefined })), 1500);
    return () => clearTimeout(t);
  }, [net]);

  /** Run the model. With `strict` (the copilot), problems are thrown as errors instead of shown. */
  const run = useCallback(async (n: Network = netRef.current, strict = false): Promise<RunOutput | undefined> => {
    const f = licRef.current.features;
    if (!isExample.current && n.pipes.length > f.maxPipes) {
      const msg = `This model has ${n.pipes.length} pipes. The Free plan runs your own models up to ${f.maxPipes} pipes (built-in examples run at any size). Start a free trial or activate a licence to run it.`;
      if (strict) throw new Error(msg);
      setLicReason(msg);
      return;
    }
    const errs = healthCheck(n).filter((i) => i.level === 'error');
    if (errs.length) {
      if (strict) throw new Error(`The model has ${errs.length} error(s) to fix first: ${errs.slice(0, 8).map((e) => `${e.title}${e.detail ? ` (${e.detail})` : ''}`).join('; ')}`);
      setToast([`The model has ${errs.length} error${errs.length > 1 ? 's' : ''} to fix first:`, ...errs.slice(0, 5).map((e) => e.title), 'Open Analysis → Model Health Check for the full list.']); return;
    }
    setBusy('Running…');
    setPlaying(false);
    try {
      const out = await call<{ result: TransientResult; checks: Check[] }>({ type: 'run', net: n }, (m) => setBusy(m));
      lastRun.current = { out, net: n };
      setResult(out.result);
      setChecks(out.checks);
      setUnc(null);
      setStale(false);
      setFramePos(0);
      setMode((m) => (m === 'plain' ? 'max' : m));
      setGraphs((g) => {
        const valid = g.filter((it) => it.ref.type !== 'node' || out.result.nodeHead[it.ref.id]);
        if (valid.length) return valid;
        const pick = [n.pumps[0]?.to, n.nodes.find((x) => x.airValve)?.id, n.valves[0]?.from].filter((x): x is string => !!x && !!out.result.nodeHead[x]);
        const ids = pick.length ? pick : n.nodes.filter((x) => x.kind === 'junction').slice(0, 2).map((x) => x.id);
        return ids.map((id) => ({ ref: { type: 'node', id }, v: 'p' }));
      });
      if (out.result.warnings.length && !strict) setToast(out.result.warnings.slice(0, 6));
      return out;
    } catch (e) {
      if (strict) throw e;
      setToast([(e as Error).message]);
    } finally {
      setBusy(null);
    }
  }, []);
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; run(); } }, [run]);

  useEffect(() => {
    if (!playing || !result) return;
    let raf = 0, last = performance.now();
    const T = result.times, frameDt = T.length > 1 ? T[1] - T[0] : 1;
    const tick = (now: number) => {
      const adv = (((now - last) / 1000) * speed) / frameDt;
      last = now;
      setFramePos((f) => { const nf = f + adv; if (nf >= T.length - 1) { setPlaying(false); return T.length - 1; } return nf; });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, result, speed]);

  const load = (n: Network, notes: string[] = [], example = false) => {
    isExample.current = example;
    past.current = []; future.current = [];
    netRef.current = n;
    setNetRaw(n);
    setStale(true); setResult(null); setChecks([]); setUnc(null); setSizing(null); setAirSugg(null); setSelected([]); setGraphs([]);
    lastRun.current = null;
    setEpsRes(null); setEpsK(0); setEpsColour('none');
    setRoute(defaultRoute(n));
    setFitKey((k) => k + 1);
    setMode('plain');
    setTool('select');
    if (notes.length) setToast(notes);
    if (n.nodes.some((x) => x.kind === 'reservoir') && n.pipes.length && example) setTimeout(() => run(n), 50);
  };
  const setProject = (n: Network, label: string) => {
    if (label === 'Switch case' || label === 'Delete case') {
      past.current = []; future.current = [];
      netRef.current = n; setNetRaw(n); setResult(null); setStale(true); setSelected([]); setMode('plain');
      return;
    }
    setNet(() => n, label);
  };

  // keep the profile route valid as nodes are added, renamed or deleted
  useEffect(() => {
    const ids = new Set(net.nodes.map((n) => n.id));
    if (!ids.has(route[0]) || !ids.has(route[1]) || route[0] === route[1]) { const d = defaultRoute(net); if (d[0] !== route[0] || d[1] !== route[1]) setRoute(d); }
  }, [net.nodes, net.pipes]); // eslint-disable-line react-hooks/exhaustive-deps
  const routeSet = useMemo(() => {
    const p = findPath(net, route[0], route[1]);
    return new Set((p ?? []).filter((h) => h.kind === 'pipe').map((h) => h.id));
  }, [net, route]);

  const select = useCallback((refs: ElRef[], additive?: boolean) => {
    setSelected((cur) => {
      if (!additive) return refs;
      const keys = new Set(cur.map((r) => `${r.type}:${r.id}`));
      const out = [...cur];
      for (const r of refs) { const k = `${r.type}:${r.id}`; if (keys.has(k)) { if (refs.length === 1) return out.filter((x) => `${x.type}:${x.id}` !== k); } else out.push(r); }
      return out;
    });
    if (refs.length === 1 && refs[0].type === 'node' && result?.nodeHead[refs[0].id] && !additive) {
      const id = refs[0].id;
      setGraphs((g) => (g.some((x) => x.ref.id === id) ? g : [...g.slice(-5), { ref: { type: 'node', id }, v: 'p' }]));
    }
  }, [result]);
  const edit = useCallback((f: (n: Network) => Network, sel?: ElRef[], label?: string) => { setNet(f, label); if (sel) setSelected(sel); }, [setNet]);

  const doUncertainty = async () => {
    if (!allowed(lic.features.uncertainty, 'Uncertainty (worst-case) analysis is part of SurgeSpace Pro.')) return;
    setBusy('Uncertainty runs…');
    try {
      const out = await call<{ uncertainty: UncertaintyOut; checks: Check[] }>({ type: 'uncertainty', net }, (m) => setBusy(m));
      setUnc(out.uncertainty); setChecks(out.checks); setBottom('uncertainty');
    } catch (e) { setToast([(e as Error).message]); } finally { setBusy(null); }
  };
  const doSize = async (node: string) => {
    if (!allowed(lic.features.protectionSizing, 'Automatic air vessel sizing is part of SurgeSpace Pro.')) return;
    setBusy('Sizing air vessel…');
    try { const out = await call<{ sizing: VesselSizing }>({ type: 'sizeVessel', net, node }, (m) => setBusy(`Sizing air vessel · ${m}`)); setSizing(out.sizing); }
    catch (e) { setToast([(e as Error).message]); } finally { setBusy(null); }
  };
  const doAir = async () => {
    if (!allowed(lic.features.protectionSizing, 'Automatic air valve sizing is part of SurgeSpace Pro.')) return;
    setBusy('Sizing air valves…');
    try { const out = await call<{ airValves: AirValveSuggestion[] }>({ type: 'airValves', net }, (m) => setBusy(m)); setAirSugg(out.airValves); }
    catch (e) { setToast([(e as Error).message]); } finally { setBusy(null); }
  };

  const doEPS = async (n: Network = netRef.current): Promise<EPSResult | undefined> => {
    if (!n.nodes.some((x) => x.kind === 'reservoir')) { setToast(['The model needs a fixed-level source or a tank.']); return; }
    setBusy('Extended period…');
    try {
      const out = await call<{ eps: EPSResult }>({ type: 'eps', net: n }, (m) => setBusy(m));
      setEpsRes({ r: out.eps, net: n }); setEpsK(0); setBottom('eps'); if (dock === 'min') setDock('normal');
      return out.eps;
    } catch (e) { setToast([(e as Error).message]); } finally { setBusy(null); }
  };
  const doSkeleton = () => {
    const cur = netRef.current;
    const sk = skeletonise(cur, { keep: selected.filter((r) => r.type === 'node').map((r) => r.id) });
    if (!sk.changes.length) { setToast(['Nothing to simplify: every junction carries a demand, a device, a branch or a change of pipe.']); return; }
    const withCase = addCase(cur, 'Skeleton');
    setProject({ ...sk.net, cases: withCase.cases, activeCase: withCase.activeCase }, 'Skeletonise');
    setToast([`New case “Skeleton”: ${cur.pipes.length} → ${sk.net.pipes.length} pipes, ${cur.nodes.length} → ${sk.net.nodes.length} nodes. Removed junctions are kept as profile points, so levels and high points are unchanged. Selected nodes were kept.`, ...sk.changes.slice(0, 5)]);
  };
  const doOptimise = async () => {
    if (!allowed(lic.features.protectionSizing, 'Protection optimisation is part of SurgeSpace Pro.')) return;
    setBusy('Optimising protection…');
    try {
      const out = await call<{ optimise: { best: Design; evaluations: number; vars: OptVar[] } }>({ type: 'optimise', net: netRef.current }, (m) => setBusy(m));
      const { best, vars, evaluations } = out.optimise;
      const cur = netRef.current;
      const withCase = addCase(cur, 'Optimised protection');
      setProject({ ...applyDesign(cur, vars, best.genes), cases: withCase.cases, activeCase: withCase.activeCase }, 'Optimise protection');
      const lines = vars.map((v, k) => `${v.kind === 'vessel' ? 'Air vessel' : 'Air valve'} at ${v.node}: ${v.options[best.genes[k]] ? (v.kind === 'vessel' ? `${v.options[best.genes[k]]} m³` : `DN${Math.round(v.options[best.genes[k]] * 1000)}`) : 'none'}`);
      setToast([best.feasible ? `Least-cost design meeting the limits (${evaluations} surge runs), applied as case “Optimised protection”:` : `No design met all limits; the best found (${evaluations} surge runs) is applied as case “Optimised protection”:`, ...lines, `Lowest pressure ${best.minP.toFixed(1)} m; highest ${(best.maxRatio * 100).toFixed(0)} % of the pipe class. Press Run to see it.`]);
    } catch (e) { setToast([(e as Error).message]); } finally { setBusy(null); }
  };
  const epsRef = useRef(doEPS);
  epsRef.current = doEPS;
  const surgeAt = (t: number) => {
    const cur = netRef.current;
    const at = networkAt(cur, t);
    // a case frozen at that moment: demands, levels and pump states of that hour (no patterns, so they apply once)
    const frozen = { ...at, nodes: at.nodes.map((x) => { const y = { ...x }; delete y.pattern; return y; }), patterns: undefined, controls: undefined, eps: undefined, name: `${cur.name} · surge from ${clock(t)}` };
    const withCase = addCase(cur, `Surge from ${clock(t)}`);
    setProject({ ...frozen, cases: withCase.cases, activeCase: withCase.activeCase }, 'Surge from time');
    setBottom('profile');
    setToast([`New case “Surge from ${clock(t)}”: tank levels, demands and pump states of ${clock(t)}. Set the operation and press Run. The base case keeps the daily data.`]);
  };

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
  const fails = checks.filter((c) => c.level === 'fail').length;
  const colorByBase = useMemo(() => colorByPipes(net, result, viewOpts.colorBy), [net, result, viewOpts.colorBy, units]); // eslint-disable-line react-hooks/exhaustive-deps
  const epsCol = useMemo(() => (epsRes && bottom === 'eps' && epsColour !== 'none' ? epsPipeColours(epsRes.net, epsRes.r, epsColour, epsK) : null), [epsRes, bottom, epsColour, epsK]);
  const colorBy = epsCol ?? colorByBase;

  // ── file actions ──
  const saveProject = () => download(`${safeName(net.name)}.surge.json`, projectJson({ ...net, cases: net.cases ? syncActive(net) : undefined }), 'application/json');
  const openProject = () => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = '.json';
    i.onchange = () => i.files?.[0]?.text().then((t) => {
      let raw: unknown;
      try { raw = JSON.parse(t); } catch { setToast(['That file is not a SurgeSpace project (it is not JSON).']); return; }
      try { load(upgradeProject(raw)); } catch (e) { setToast([(e as Error).message]); }
    });
    i.click();
  };
  const newProject = () => { load(blankModel()); setTool('pipe'); setToast(['New model. Draw with the Pipe tool: click to place junctions, Shift+click for bends. Add a Fixed-Level Source first.']); };
  const recover = () => { const s = readLS('surgespace.autosave'); if (!s) { setToast(['Nothing autosaved on this device yet.']); return; } try { load(upgradeProject(JSON.parse(s))); setToast(['Recovered the last autosaved model.']); } catch { setToast(['The autosave could not be read.']); } };
  const exportInp = () => allowed(lic.features.exportFiles, 'Export is part of SurgeSpace Pro.') && download(`${safeName(net.name)}.inp`, toInp(net));
  const exportEnv = () => {
    if (!result || !allowed(lic.features.exportFiles, 'Export is part of SurgeSpace Pro.')) return;
    const fL = toShow(1, 'length'), fH = toShow(1, 'head'), fP = toShow(1, 'pressureHead');
    const rows = [`pipe,chainage_${uLabel('length')},elevation_${uLabel('elevation')},steady_head_${uLabel('head')},max_head_${uLabel('head')},min_head_${uLabel('head')},max_pressure_${uLabel('pressureHead')},min_pressure_${uLabel('pressureHead')},cavity_L`];
    for (const e of result.envelopes) for (let i = 0; i < e.s.length; i++) rows.push([e.id, (e.s[i] * fL).toFixed(2), (e.z[i] * fL).toFixed(3), (e.hSteady[i] * fH).toFixed(3), (e.hMax[i] * fH).toFixed(3), (e.hMin[i] * fH).toFixed(3), ((e.hMax[i] - e.z[i]) * fP).toFixed(3), ((e.hMin[i] - e.z[i]) * fP).toFixed(3), (e.cavMax[i] * 1000).toFixed(2)].join(','));
    download(`${safeName(net.name)}-envelopes.csv`, rows.join('\n'), 'text/csv');
  };
  const openReport = () => result && allowed(lic.features.exportFiles, 'The detailed report is part of SurgeSpace Pro.') && setDialog('report');
  const deleteSel = () => { if (selected.length) { edit((n) => deleteElements(n, selected), [], 'Delete'); } };
  const selectAll = () => setSelected([...net.nodes.map((n) => ({ type: 'node' as const, id: n.id })), ...net.pipes.map((p) => ({ type: 'pipe' as const, id: p.id }))]);
  const duplicate = () => {
    const ids = selected.filter((r) => r.type === 'node').map((r) => r.id);
    if (!ids.length) return;
    const span = Math.max(1, ...net.nodes.map((n) => Math.abs(n.x))) * 0.05;
    let out: string[] = [];
    edit((n) => { const r = duplicateNodes(n, ids, span, -span); out = r.ids; return r.net; }, undefined, 'Duplicate');
    setTimeout(() => setSelected(out.map((id) => ({ type: 'node', id }))), 0);
  };
  const goTo = (r: ElRef) => { setSelected([r]); };

  // ── AI copilot ──
  const aiCtx = useMemo<CommandContext>(() => ({
    getNet: () => netRef.current,
    apply: (next, label) => setNet(() => next, label),
    run: async () => { const out = await run(netRef.current, true); if (!out) throw new Error('The run did not finish.'); return out; },
    getRun: () => (lastRun.current && lastRun.current.net === netRef.current ? lastRun.current.out : null),
    sizeVessel: async (node) => {
      if (!licRef.current.features.protectionSizing) throw new Error('Automatic air vessel sizing is part of SurgeSpace Pro; the user can start a free trial. Size the vessel by trial runs instead.');
      setBusy('Sizing air vessel…');
      try { const o = await call<{ sizing: VesselSizing }>({ type: 'sizeVessel', net: netRef.current, node }, (m) => setBusy(`Sizing air vessel · ${m}`)); setSizing(o.sizing); return o.sizing; } finally { setBusy(null); }
    },
    suggestAirValves: async () => {
      if (!licRef.current.features.protectionSizing) throw new Error('Automatic air valve sizing is part of SurgeSpace Pro; the user can start a free trial. Place air valves at the high points by hand instead.');
      setBusy('Sizing air valves…');
      try { const o = await call<{ airValves: AirValveSuggestion[] }>({ type: 'airValves', net: netRef.current }, (m) => setBusy(m)); setAirSugg(o.airValves); return o.airValves; } finally { setBusy(null); }
    },
    select: (refs) => setSelected(refs),
    optimise: async (vars) => {
      setBusy('Optimising protection…');
      try { const o = await call<{ optimise: { best: Design; evaluations: number } }>({ type: 'optimise', net: netRef.current, vars }, (m) => setBusy(m)); return o.optimise; } finally { setBusy(null); }
    },
    runEPS: async () => { const r = await epsRef.current(); if (!r) throw new Error('The extended-period run did not finish (does the model have a fixed-level source or tank?).'); return r; },
  }), [setNet, run]);
  const openCopilot = () => { setShowRight(true); setRight('ai'); };
  const aiTask = (t: { prompt: string; label: string }) => { openCopilot(); if (!ai.accounts.length) { setDialog('ai'); return; } setAiQueued({ prompt: t.prompt, label: t.label }); };
  const applyNarrative = (md: string) => { setNetRaw((n) => ({ ...n, report: { ...(n.report ?? {}), narrative: md, narrativeByAI: true } })); setToast(['The text is now the report narrative. Review and edit it in File → Detailed report.']); };

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(); return; }
      if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); openProject(); return; }
      if ((mod && e.key === 'Enter') || e.key === 'F5') { e.preventDefault(); run(); return; }
      if (typing || dialog) return;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (mod && ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y')) { e.preventDefault(); redo(); return; }
      if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAll(); return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); return; }
      if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); setDialog('find'); return; }
      if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); newProject(); return; }
      if (mod) return;
      if (e.key === 'Escape') { if (tool !== 'select') setTool('select'); else setSelected([]); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); return; }
      if (result && e.code === 'Space') { e.preventDefault(); togglePlay(); return; }
      if (result && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault(); setPlaying(false); if (!live) setMode('surge');
        const d = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : 1);
        setFramePos((f) => Math.max(0, Math.min(result.times.length - 1, Math.round(f) + d)));
        return;
      }
      const k = e.key.toUpperCase();
      if (k === 'S') setTool('select');
      else if (k === 'H') setTool('pan');
      else if (k === 'F') setFitKey((x) => x + 1);
      else { const el = ELEMENTS.find((x) => x.key === k); if (el) setTool(el.kind); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const pickTool = (k: Tool) => { setTool(k); if (k !== 'select' && k !== 'pan' && result && mode !== 'plain') { setMode('plain'); setPlaying(false); } };

  // ── menus ──
  const exItems: MenuItem[] = EXAMPLES.map((ex) => { const n = ex.make(); return { label: n.name, hint: n.description, action: () => load(n, [], true) }; });
  const toolItem = (k: ElementKind): MenuItem => ({ label: EL[k].name, shortcut: EL[k].key, checked: tool === k, action: () => pickTool(k) });
  const valueLabels: [ValueLabel, string][] = [['none', 'None'], ['elevation', 'Elevation'], ['demand', 'Demand'], ['steadyPressure', 'Steady pressure'], ['maxPressure', 'Maximum pressure'], ['minPressure', 'Minimum pressure'], ['diameter', 'Pipe diameter'], ['length', 'Pipe length'], ['flow', 'Steady flow'], ['velocity', 'Steady velocity']];
  const colorBys: [ColorBy, string][] = [['none', 'None'], ['diameter', 'Diameter'], ['material', 'Material'], ['class', 'Pressure class'], ['wavespeed', 'Wave speed'], ['elevation', 'Elevation'], ['velocity', 'Steady velocity']];
  const menus: Menu[] = [
    { label: 'File', items: [
      { label: 'New model', shortcut: 'Ctrl+N', action: newProject },
      { label: 'Open project…', shortcut: 'Ctrl+O', action: openProject },
      { label: 'Open example', sub: exItems },
      { label: 'Recover autosaved model', action: recover },
      'sep',
      { label: 'Save project', shortcut: 'Ctrl+S', action: saveProject },
      'sep',
      { label: 'Import (EPANET, spreadsheet, long section, DXF)…', action: () => setDialog('import') },
      { label: 'Import GIS layer (GeoJSON)…', action: () => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.geojson,.json'; i.onchange = () => i.files?.[0]?.text().then((t) => { try { const g = JSON.parse(t) as GeoJSON; if (g.type !== 'FeatureCollection') throw new Error('Not a GeoJSON FeatureCollection.'); const r = fromGeoJSON(g); load(r.network, [`${r.network.pipes.length} pipes and ${r.network.nodes.length} nodes from ${i.files![0].name}. Fields were matched by name (id, elevation, diameter, material…).`, ...r.notes]); } catch (e) { setToast([(e as Error).message]); } }); i.click(); } },
      { label: 'Export EPANET .inp', action: exportInp },
      { label: 'Export GIS (GeoJSON, with results)', action: () => allowed(lic.features.exportFiles, 'Export is part of SurgeSpace Pro.') && download(`${safeName(net.name)}.geojson`, JSON.stringify(toGeoJSON(net, result, epsRes?.r ?? null)), 'application/geo+json') },
      { label: 'Export CAD (DXF, with results)', action: () => allowed(lic.features.exportFiles, 'Export is part of SurgeSpace Pro.') && download(`${safeName(net.name)}.dxf`, toDXF(net, result, Math.max(1, Math.round(Math.max(...net.nodes.map((n) => Math.abs(n.x)), 100) / 300))), 'application/dxf') },
      { label: 'Export envelopes .csv', action: exportEnv, disabled: !result },
      'sep',
      { label: 'Project details…', action: () => setDialog('project') },
      { label: 'Detailed report…', action: openReport, disabled: !result },
    ] },
    { label: 'Edit', items: [
      { label: 'Undo', shortcut: 'Ctrl+Z', action: undo, disabled: !past.current.length },
      { label: 'Redo', shortcut: 'Ctrl+Y', action: redo, disabled: !future.current.length },
      'sep',
      { label: 'Select all', shortcut: 'Ctrl+A', action: selectAll },
      { label: 'Clear selection', shortcut: 'Esc', action: () => setSelected([]), disabled: !selected.length },
      { label: 'Duplicate nodes', shortcut: 'Ctrl+D', action: duplicate, disabled: !selected.some((r) => r.type === 'node') },
      { label: 'Delete', shortcut: 'Del', action: deleteSel, disabled: !selected.length },
      'sep',
      { label: 'Find element…', shortcut: 'Ctrl+F', action: () => setDialog('find') },
    ] },
    { label: 'View', items: [
      { label: 'Zoom to fit', shortcut: 'F', action: () => setFitKey((k) => k + 1) },
      { label: 'Grid', checked: viewOpts.grid, action: () => setViewOpts((v) => ({ ...v, grid: !v.grid })) },
      { label: 'Snap to grid', checked: viewOpts.snap, action: () => setViewOpts((v) => ({ ...v, snap: !v.snap })) },
      { label: 'Element IDs', checked: viewOpts.ids, action: () => setViewOpts((v) => ({ ...v, ids: !v.ids })) },
      { label: 'Background picture…', checked: !!net.background?.visible, action: () => setDialog('background') },
      { label: 'North arrow', checked: viewOpts.north, action: () => setViewOpts((v) => ({ ...v, north: !v.north })) },
      { label: 'Value labels', sub: valueLabels.map(([k, l]) => ({ label: l, checked: viewOpts.values === k, action: () => setViewOpts((v) => ({ ...v, values: k })) })) },
      { label: 'Contours', sub: ([['none', 'None'], ['elevation', 'Ground elevation'], ['steadyPressure', 'Steady pressure'], ['maxPressure', 'Maximum pressure'], ['minPressure', 'Minimum pressure'], ['maxHead', 'Maximum head']] as [ContourBy, string][]).map(([k, l]) => ({ label: l, checked: (viewOpts.contour ?? 'none') === k, disabled: k !== 'none' && k !== 'elevation' && !result, action: () => setViewOpts((v) => ({ ...v, contour: k })) })) },
      { label: 'Colour pipes by', sub: colorBys.map(([k, l]) => ({ label: l, checked: viewOpts.colorBy === k, action: () => { setViewOpts((v) => ({ ...v, colorBy: k })); setMode('plain'); } })) },
      'sep',
      { label: 'Model Explorer panel', checked: showLeft, action: () => setShowLeft((v) => !v) },
      { label: 'Properties panel', checked: showRight, action: () => setShowRight((v) => !v) },
      { label: 'Results dock', sub: [['normal', 'Normal'], ['max', 'Large'], ['min', 'Hidden']].map(([k, l]) => ({ label: l, checked: dock === k, action: () => setDock(k as typeof dock) })) },
      'sep',
      { label: 'Theme', sub: [['auto', 'Follow system'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => ({ label: l, checked: theme === k, action: () => setTheme(k as typeof theme) })) },
    ] },
    { label: 'Model', items: [
      { label: 'Select / move', shortcut: 'S', checked: tool === 'select', action: () => pickTool('select') },
      { label: 'Pan', shortcut: 'H', checked: tool === 'pan', action: () => pickTool('pan') },
      'sep',
      { label: 'Network', sub: (['junction', 'reservoir', 'levelSource'] as ElementKind[]).map(toolItem) },
      { label: 'Links', sub: (['pipe', 'pump', 'turbine', 'lineValve', 'nrv', 'prv', 'psv', 'fcv', 'orifice'] as ElementKind[]).map(toolItem) },
      { label: 'Protection devices', sub: (['airVessel', 'airValve', 'standpipe', 'feedTank', 'anticipator', 'relief', 'blowoff', 'burstDisc'] as ElementKind[]).map(toolItem) },
      'sep',
      { label: 'Operations…', action: () => { setLeft('operations'); setShowLeft(true); } },
      { label: 'Cases…', action: () => { setBottom('cases'); if (dock === 'min') setDock('normal'); } },
      { label: 'Data sheets', action: () => { setBottom('tables'); if (dock === 'min') setDock('normal'); } },
      'sep',
      { label: 'Pipe lengths from drawing (all)', action: () => setNet((n) => lengthsFromDrawing(n), 'Lengths from drawing') },
      { label: 'Pipe lengths from drawing (selected)', action: () => setNet((n) => lengthsFromDrawing(n, selected.filter((r) => r.type === 'pipe').map((r) => r.id)), 'Lengths from drawing'), disabled: !selected.some((r) => r.type === 'pipe') },
    ] },
    { label: 'Analysis', items: [
      { label: 'Model Health Check…', action: () => setDialog('health') },
      { label: 'Run Setup…', action: () => setDialog('setup') },
      { label: 'Run surge', shortcut: 'F5', action: () => run(), disabled: !!busy },
      'sep',
      { label: 'Uncertainty (worst case)', action: doUncertainty, disabled: !!busy },
      { label: 'Extended period (daily operation, water quality)…', action: () => { setBottom('eps'); if (dock === 'min') setDock('normal'); } },
      { label: 'Run extended period', action: () => void doEPS(), disabled: !!busy },
      { label: 'Surge engine', sub: [
        { label: 'Wave (method of characteristics) — fast events', checked: (net.settings.engine ?? 'wave') === 'wave', action: () => setNet((n) => ({ ...n, settings: { ...n.settings, engine: 'wave' } }), 'Engine') },
        { label: 'Rigid column — slow events, mass oscillation', checked: net.settings.engine === 'rigid', action: () => setNet((n) => ({ ...n, settings: { ...n.settings, engine: 'rigid' } }), 'Engine') },
      ] },
      { label: 'Optimise protection (genetic algorithm)', action: () => void doOptimise(), disabled: !!busy },
      { label: 'Skeletonise model (new case)', action: doSkeleton },
      { label: 'Live data and field data…', action: () => { setBottom('live'); if (dock === 'min') setDock('normal'); } },
      { label: 'Size protection (vessel, air valves)…', action: () => { setBottom('protection'); if (dock === 'min') setDock('normal'); } },
      { label: 'Run all cases and compare', action: () => { setBottom('cases'); if (dock === 'min') setDock('normal'); } },
    ] },
    { label: 'Results', items: [
      { label: 'Design view (no results)', checked: mode === 'plain', action: () => setMode('plain') },
      { label: 'Surge animation', checked: mode === 'surge', action: () => setMode('surge'), disabled: !result },
      { label: 'Pressure animation', checked: mode === 'pressure', action: () => setMode('pressure'), disabled: !result },
      { label: 'Maximum pressure', checked: mode === 'max', action: () => setMode('max'), disabled: !result },
      { label: 'Minimum pressure', checked: mode === 'min', action: () => setMode('min'), disabled: !result },
      { label: 'Steady pressure', checked: mode === 'steady', action: () => setMode('steady'), disabled: !result },
      'sep',
      ...([['profile', 'Long-section profile'], ['graphs', 'Graphs'], ['checks', 'Design checks'], ['tables', 'Result tables'], ['log', 'Run log']] as [BottomTab, string][]).map(([k, l]) => ({ label: l, action: () => { setBottom(k); if (dock === 'min') setDock('normal'); } })),
      'sep',
      { label: 'Detailed report…', action: openReport, disabled: !result },
    ] },
    { label: 'Tools', items: [
      { label: 'Catalogues & wave speed calculator…', action: () => setDialog('catalogues') },
      { label: 'Units', sub: [{ label: 'SI (metric)', checked: units.system === 'SI', action: () => setUnits({ system: 'SI' }) }, { label: 'US customary', checked: units.system === 'US', action: () => setUnits({ system: 'US' }) }, 'sep', { label: 'More unit options…', action: () => setDialog('setup') }] },
      { label: 'Element defaults…', action: () => setDialog('setup') },
      'sep',
      { label: 'Licence…', action: () => setLicReason(null) },
    ] },
    { label: 'AI', items: [
      { label: 'Copilot', action: openCopilot },
      'sep',
      ...AI_TASKS.map((t): MenuItem => ({ label: `${t.label}${t.needsResults && !result ? ' (run first)' : ''}`, disabled: t.needsResults && !result, action: () => aiTask(t) })),
      'sep',
      { label: 'AI accounts…', action: () => setDialog('ai') },
    ] },
    { label: 'Help', items: [
      { label: 'Quick start', action: () => setDialog('help') },
      { label: 'Keyboard shortcuts', action: () => setDialog('keys') },
      { label: 'Questions and ideas…', action: () => setDialog('tellus') },
      { label: 'About SurgeSpace', action: () => setDialog('about') },
    ] },
  ];

  // ── context menu ──
  const ctxItems = (): MenuItem[] => {
    if (!ctx) return [];
    const r = ctx.ref;
    const devItems = (id: string): MenuItem[] => (['airVessel', 'airValve', 'standpipe', 'feedTank', 'anticipator', 'relief', 'blowoff', 'burstDisc'] as ElementKind[]).map((k) => {
      const n = net.nodes.find((x) => x.id === id)!;
      const has = nodeDevices(n).includes(k);
      return { label: `${has ? 'Remove' : 'Add'} ${EL[k].name.toLowerCase()}`, checked: has, action: () => edit((m) => ({ ...m, nodes: m.nodes.map((x) => (x.id !== id ? x : has ? removeDevice(x, k) : { ...x, ...deviceDefaults(k, x, m.pipes.find((p) => p.from === id || p.to === id)?.diameter ?? defaults.pipeDiameter) })) }), [{ type: 'node', id }], has ? 'Remove device' : 'Add device') };
    });
    if (!r) return [
      { label: 'Add junction here', action: () => { let id = ''; edit((n) => { const o = addNode(n, ctx.world, 'junction', defaults); id = o.id; return o.net; }); setTimeout(() => setSelected([{ type: 'node', id }]), 0); } },
      { label: 'Add fixed-level source here', action: () => { let id = ''; edit((n) => { const o = addNode(n, ctx.world, 'reservoir', defaults); id = o.id; return o.net; }); setTimeout(() => setSelected([{ type: 'node', id }]), 0); } },
      'sep',
      { label: 'Zoom to fit', action: () => setFitKey((k) => k + 1) },
      { label: 'Select all', action: selectAll },
    ];
    const common: MenuItem[] = [{ label: 'Delete', shortcut: 'Del', action: () => edit((n) => deleteElements(n, [r]), [], 'Delete') }];
    if (r.type === 'node') {
      const n = net.nodes.find((x) => x.id === r.id);
      if (!n) return common;
      return [
        { label: 'Properties', action: () => { setSelected([r]); setShowRight(true); } },
        ...(n.kind === 'junction' ? [{ label: 'Protection device', sub: devItems(r.id) } as MenuItem] : []),
        { label: n.kind === 'junction' ? 'Convert to fixed-level source' : 'Convert to junction', action: () => edit((m) => ({ ...m, nodes: m.nodes.map((x) => (x.id !== r.id ? x : x.kind === 'junction' ? { ...x, kind: 'reservoir', head: x.head ?? x.elev + 5 } : { ...x, kind: 'junction', headSchedule: undefined, demand: 0 })) }), [r], 'Convert') },
        'sep',
        { label: 'Profile from here', action: () => { setRoute([r.id, route[1]]); setBottom('profile'); } },
        { label: 'Profile to here', action: () => { setRoute([route[0], r.id]); setBottom('profile'); } },
        { label: 'Add to graphs', disabled: !result, action: () => { setGraphs((g) => [...g, { ref: r, v: 'p' }]); setBottom('graphs'); } },
        'sep', ...common,
      ];
    }
    if (r.type === 'pipe') {
      const p = net.pipes.find((x) => x.id === r.id);
      if (!p) return common;
      const u = ctx.u ?? 0.5;
      return [
        { label: 'Properties', action: () => { setSelected([r]); setShowRight(true); } },
        { label: 'Split pipe here', action: () => { let id = ''; edit((n) => { const o = splitPipe(n, r.id, u, defaults); id = o.node; return o.net; }, undefined, 'Split pipe'); setTimeout(() => setSelected([{ type: 'node', id }]), 0); } },
        { label: 'Insert here', sub: (['pump', 'turbine', 'lineValve', 'prv', 'psv', 'fcv', 'orifice', 'airVessel', 'airValve', 'standpipe', 'feedTank', 'anticipator', 'relief', 'blowoff', 'burstDisc'] as ElementKind[]).map((k) => ({ label: EL[k].name, action: () => { let rr: ElRef | null = null; edit((n) => { const o = insertOnPipe(n, r.id, k, u, defaults); rr = { type: o.type, id: o.id }; return o.net; }, undefined, 'Insert'); setTimeout(() => rr && setSelected([rr]), 0); } })) },
        { label: p.checkValve ? 'Remove non-return valve' : 'Add non-return valve', action: () => edit((n) => ({ ...n, pipes: n.pipes.map((x) => (x.id === r.id ? { ...x, checkValve: x.checkValve ? undefined : { mode: 'ideal', kOpen: 1 } } : x)) }), [r], 'Non-return valve') },
        { label: 'Reverse direction', action: () => edit((n) => reversePipe(n, r.id), [r], 'Reverse pipe') },
        { label: 'Length from drawing', action: () => edit((n) => lengthsFromDrawing(n, [r.id]), [r], 'Length from drawing') },
        ...(p.vertices?.length ? [{ label: 'Remove bends', action: () => edit((n) => ({ ...n, pipes: n.pipes.map((x) => (x.id === r.id ? { ...x, vertices: undefined } : x)) }), [r], 'Remove bends') } as MenuItem] : []),
        { label: p.closed ? 'Open pipe' : 'Close pipe', action: () => edit((n) => ({ ...n, pipes: n.pipes.map((x) => (x.id === r.id ? { ...x, closed: !x.closed || undefined } : x)) }), [r], 'Pipe status') },
        { label: 'Add to graphs', disabled: !result, action: () => { setGraphs((g) => [...g, { ref: r, v: 'q' }]); setBottom('graphs'); } },
        'sep', ...common,
      ];
    }
    return [
      { label: 'Properties', action: () => { setSelected([r]); setShowRight(true); } },
      { label: 'Add to graphs', disabled: !result, action: () => { setGraphs((g) => [...g, { ref: r, v: r.type === 'pump' ? 'spd' : 'open' }]); setBottom('graphs'); } },
      { label: 'Operate in the run', action: () => { setLeft('operations'); setShowLeft(true); } },
      'sep', ...common,
    ];
  };

  // ── ribbon ──
  const RB = ({ icon, el, label, on, onClick, disabled, title, accent }: { icon?: ActionIcon; el?: ElementKind; label: string; on?: boolean; onClick: () => void; disabled?: boolean; title?: string; accent?: boolean }) => (
    <button className={`rb ${on ? 'on' : ''} ${accent ? 'accent' : ''}`} onClick={onClick} disabled={disabled} title={title ?? label} aria-pressed={on}>
      {el ? <ElIcon kind={el} size={20} /> : <Ic name={icon!} size={20} />}
      <span>{label}</span>
    </button>
  );
  const tb = (k: ElementKind) => <RB key={k} el={k} label={EL[k].short} on={tool === k} onClick={() => pickTool(tool === k ? 'select' : k)} title={`${EL[k].name}${EL[k].key ? ` (${EL[k].key})` : ''} — ${EL[k].description}`} />;

  const legend = (() => {
    if (epsCol || mode === 'plain' || !result) {
      const lg = colorBy.legend;
      if (!lg) return null;
      return <div className="legend card"><div className="legend-title">{lg.title}</div>{lg.items.slice(0, 12).map((i) => <div key={i.label} className="row" style={{ gap: 6 }}><span className="swatch" style={{ background: i.color }} />{i.label}</div>)}</div>;
    }
    return (
      <div className="legend card">
        <div className="legend-title">{mode === 'surge' ? `Change from steady · ${tNow.toFixed(2)} s` : mode === 'pressure' ? `Pressure · ${tNow.toFixed(2)} s` : mode === 'max' ? 'Maximum pressure' : mode === 'min' ? 'Minimum pressure' : 'Steady pressure'}</div>
        {mode === 'surge' ? (
          <div>
            <div className="surge-bar" />
            <div className="row mono" style={{ justifyContent: 'space-between', fontSize: 10.5 }}><span>−{fmtQ(sScale, 'head', 0, units)}</span><span>0</span><span>+{fmtQ(sScale, 'head', 0, units)}</span></div>
            <div className="muted" style={{ fontSize: 10.5, marginTop: 2 }}>blue = drop · red = rise</div>
          </div>
        ) : ([[-10, 'vapour'], [0, `0 ${uLabel('pressureHead', units)}`], [10, fmtQ(10, 'pressureHead', 0, units)], [50, fmtQ(50, 'pressureHead', 0, units)], [90, '90 % of class'], [120, 'over class']] as [number, string][]).map(([p, l]) => (
          <div key={l} className="row" style={{ gap: 6 }}><span className="swatch" style={{ background: pressureColor(p, 100) }} />{l}</div>
        ))}
      </div>
    );
  })();

  const activeCase = net.cases?.find((c) => c.id === net.activeCase);
  const nodeOpts = useMemo(() => net.nodes.map((n) => <option key={n.id}>{n.id}</option>), [net.nodes]);
  const bodyCols = `${showLeft ? '264px' : '0px'} minmax(0, 1fr) ${showRight ? (right === 'ai' ? '400px' : '340px') : '0px'}`;

  return (
    <div className="app2">
      <MenuBar menus={menus} right={
        <div className="row" style={{ gap: 6, paddingRight: 8 }}>
          <div className="brand"><Logo /> SurgeSpace</div>
          <button className={`plan-badge ${lic.plan}`} onClick={() => setLicReason(null)} title="Licence">{lic.checking ? '…' : planLabel(lic)}</button>
        </div>
      } />
      <div className="ribbon" role="toolbar" aria-label="Tools">
        <div className="ribbon-scroll">
        <div className="rgroup"><div className="rrow">
          <RB icon="new" label="New" onClick={newProject} />
          <RB icon="open" label="Open" onClick={openProject} />
          <RB icon="save" label="Save" onClick={saveProject} />
          <RB icon="import" label="Import" onClick={() => setDialog('import')} />
        </div><div className="rcap">Project</div></div>
        <div className="rgroup"><div className="rrow">
          <RB icon="undo" label="Undo" onClick={undo} disabled={!past.current.length} title="Undo (Ctrl+Z)" />
          <RB icon="redo" label="Redo" onClick={redo} disabled={!future.current.length} title="Redo (Ctrl+Y)" />
          <RB icon="delete" label="Delete" onClick={deleteSel} disabled={!selected.length} title="Delete selection (Del)" />
        </div><div className="rcap">Edit</div></div>
        <div className="rgroup"><div className="rrow">
          <RB icon="select" label="Select" on={tool === 'select'} onClick={() => pickTool('select')} title="Select and move (S)" />
          <RB icon="pan" label="Pan" on={tool === 'pan'} onClick={() => pickTool('pan')} title="Pan (H)" />
          <span className="rsep" />
          {(['reservoir', 'levelSource', 'junction'] as ElementKind[]).map(tb)}
        </div><div className="rcap">Network</div></div>
        <div className="rgroup"><div className="rrow">
          {(['pipe', 'pump', 'turbine', 'lineValve', 'nrv', 'prv', 'psv', 'fcv', 'orifice'] as ElementKind[]).map(tb)}
        </div><div className="rcap">Links</div></div>
        <div className="rgroup"><div className="rrow">
          {(['airVessel', 'airValve', 'standpipe', 'feedTank', 'anticipator', 'relief', 'blowoff', 'burstDisc'] as ElementKind[]).map(tb)}
        </div><div className="rcap">Surge protection</div></div>
        </div>
        <div className="rgroup pinned ai-group"><div className="rrow">
          <RB icon="ai" label="Copilot" on={showRight && right === 'ai'} onClick={() => (showRight && right === 'ai' ? setRight('props') : openCopilot())} title="AI copilot: build, review, protect, explain and report in plain words" />
          <RB icon="find" label="Review" onClick={() => aiTask(AI_TASKS.find((t) => t.id === 'review')!)} title="AI review of the model before running" />
          <RB icon="shield" label="Protect" onClick={() => aiTask(AI_TASKS.find((t) => t.id === 'protect')!)} title="AI designs the surge protection by running the options" />
          <RB icon="chat" label="Explain" onClick={() => aiTask(AI_TASKS.find((t) => t.id === 'explain')!)} disabled={!result} title="AI explains the results in plain language" />
        </div><div className="rcap">AI</div></div>
        <div className="rgroup pinned"><div className="rrow">
          <RB icon="health" label="Check" onClick={() => setDialog('health')} title="Model Health Check" />
          <RB icon="setup" label="Setup" onClick={() => setDialog('setup')} title="Run Setup" />
          <RB icon="catalogue" label="Catalogues" onClick={() => setDialog('catalogues')} />
          <button className="rb run" onClick={() => run()} disabled={!!busy} title="Run (F5)"><Ic name="run" size={20} /><span>{busy ? 'Running' : stale && result ? 'Run*' : 'Run'}</span></button>
          <RB icon="report" label="Report" onClick={openReport} disabled={!result} />
        </div><div className="rcap">Analysis</div></div>
      </div>

      <div className="body" style={{ gridTemplateColumns: bodyCols }}>
        <aside className="pane left" aria-hidden={!showLeft}>
          {showLeft && <>
            <div className="pane-tabs">
              <button className={`ptab ${left === 'explorer' ? 'on' : ''}`} onClick={() => setLeft('explorer')}>Model Explorer</button>
              <button className={`ptab ${left === 'operations' ? 'on' : ''}`} onClick={() => setLeft('operations')}>Operations{net.event.kind !== 'none' ? <span className="badge">{1 + (net.extraEvents?.length ?? 0)}</span> : null}</button>
            </div>
            <div className="pane-body">
              {left === 'explorer' && <Explorer net={net} selected={selected} onSelect={select} />}
              {left === 'operations' && <OperationsPanel net={net} setNet={setNet} />}
            </div>
          </>}
        </aside>

        <section className="center" style={{ gridTemplateRows: dock === 'max' ? 'minmax(200px, 38%) minmax(0, 1fr)' : dock === 'min' ? 'minmax(0, 1fr) 34px' : 'minmax(260px, 1fr) minmax(240px, 40%)' }}>
          <div className="canvas-wrap">
            <Canvas net={net} result={result} envelopes={unc?.envelopes} framePos={framePos} mode={result ? mode : 'plain'} selected={selected} onSelect={select}
              route={routeSet} flowDashes={flowDashes} playing={playing} sScale={sScale} tool={tool} onEdit={edit} view={viewOpts} defaults={defaults}
              onCursor={setCursorW} fitKey={fitKey} bottomInset={result && dock !== 'max' ? 84 : 0} onContext={setCtx} onToolEnd={() => setTool('select')} colorFn={epsCol ? epsCol.color : mode === 'plain' || !result ? colorBy.color : undefined} />
            <div className="map-tools">
              <div className="seg" role="group" aria-label="Map view">
                <button className={`seg-btn ${mode === 'plain' || !result ? 'on' : ''}`} onClick={() => { setMode('plain'); setPlaying(false); }}>Design</button>
                {(['surge', 'pressure'] as const).map((m) => <button key={m} className={`seg-btn ${result && mode === m ? 'on' : ''}`} onClick={() => setMode(m)} disabled={!result}>{m === 'surge' ? 'Surge' : 'Pressure'}</button>)}
                {(['max', 'min', 'steady'] as const).map((m) => <button key={m} className={`seg-btn ${result && mode === m ? 'on' : ''}`} onClick={() => { setMode(m); setPlaying(false); }} disabled={!result}>{m === 'max' ? 'Max' : m === 'min' ? 'Min' : 'Steady'}</button>)}
              </div>
              {live && result && <button className={`btn small ${flowDashes ? 'primary' : ''}`} onClick={() => setFlowDashes((v) => !v)} aria-pressed={flowDashes} title="Show flow direction and speed">Flow</button>}
              {(mode === 'plain' || !result) && (
                <select className="cell boxed" value={viewOpts.colorBy} onChange={(e) => setViewOpts((v) => ({ ...v, colorBy: e.target.value as ColorBy }))} aria-label="Colour pipes by" title="Colour pipes by">
                  {colorBys.map(([k, l]) => <option key={k} value={k}>{k === 'none' ? 'Colour by…' : l}</option>)}
                </select>
              )}
              <select className="cell boxed" value={viewOpts.values} onChange={(e) => setViewOpts((v) => ({ ...v, values: e.target.value as ValueLabel }))} aria-label="Value labels" title="Value labels">
                {valueLabels.map(([k, l]) => <option key={k} value={k}>{k === 'none' ? 'Labels…' : l}</option>)}
              </select>
              {stale && result && <span className="pill warn" title="The model changed since the last run">results out of date</span>}
            </div>
            {legend}
            <div className="view-tools" role="toolbar" aria-label="Drawing aids">
              <button className={`btn small ${viewOpts.grid ? 'on' : ''}`} title="Grid" aria-pressed={viewOpts.grid} onClick={() => setViewOpts((v) => ({ ...v, grid: !v.grid }))}><Ic name="grid" size={16} /></button>
              <button className={`btn small ${viewOpts.snap ? 'on' : ''}`} title="Snap to grid" aria-pressed={viewOpts.snap} onClick={() => setViewOpts((v) => ({ ...v, snap: !v.snap }))}><Ic name="magnet" size={16} /></button>
              <button className={`btn small ${viewOpts.ids ? 'on' : ''}`} title="Element IDs" aria-pressed={viewOpts.ids} onClick={() => setViewOpts((v) => ({ ...v, ids: !v.ids }))}><Ic name="labels" size={16} /></button>
            </div>
            {result && dock !== 'max' && (
              <div className="player card">
                <button className="btn primary play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} title="Space">{playing ? '❚❚' : '▶'}</button>
                <Timeline net={net} result={result} framePos={framePos} onSeek={(f) => { setFramePos(f); setPlaying(false); if (!live) setMode('surge'); }} />
                <span className="mono small" style={{ minWidth: 64, textAlign: 'right' }}>{tNow.toFixed(2)} s</span>
                <select className="cell" style={{ width: 64 }} value={speed} onChange={(e) => setSpeed(+e.target.value)} aria-label="Playback speed">
                  {[0.25, 0.5, 1, 2, 4, 8].map((s) => <option key={s} value={s}>{s}×</option>)}
                </select>
              </div>
            )}
            {busy && <div className="progress"><div className="card"><span className="spinner" />{busy}{(busy.includes('Sizing') || busy.includes('case') || busy.includes('Uncertainty')) && <button className="btn small" style={{ marginLeft: 10 }} onClick={() => { cancelAll(); setBusy(null); }}>Cancel</button>}</div></div>}
            {!net.nodes.length && !busy && (
              <div className="empty-canvas card">
                <b>Start drawing</b>
                <p className="small muted">Place a <b>Fixed-Level Source</b> (R), then pick <b>Pipe</b> (P) and click from point to point. Click a pipe with a device tool to insert it. Or open an example or import a model.</p>
                <div className="row" style={{ gap: 6, justifyContent: 'center' }}>
                  <button className="btn small primary" onClick={() => pickTool('reservoir')}>Place a source</button>
                  <button className="btn small" onClick={() => setDialog('import')}>Import…</button>
                </div>
              </div>
            )}
          </div>

          <div className="dock">
            <div className="dock-tabs">
              {([['profile', 'Profile'], ['graphs', 'Graphs'], ['checks', `Design checks${fails ? ` · ${fails}` : ''}`], ['tables', 'Data sheets'], ['cases', `Cases${net.cases?.length ? ` · ${net.cases.length}` : ''}`], ['protection', 'Protection sizing'], ['uncertainty', 'Uncertainty'], ['eps', 'Daily operation'], ['live', 'Live data'], ['log', 'Run log']] as [BottomTab, string][]).map(([k, l]) => (
                <button key={k} className={`dtab ${bottom === k ? 'on' : ''} ${k === 'checks' && fails ? 'bad' : ''}`} onClick={() => { setBottom(k); if (dock === 'min') setDock('normal'); }}>{l}</button>
              ))}
              <div style={{ flex: 1 }} />
              {bottom === 'profile' && dock !== 'min' && (
                <div className="row small" style={{ gap: 6, paddingRight: 6 }}>
                  <span className="muted">Route</span>
                  <select className="cell boxed" style={{ width: 110 }} value={route[0]} onChange={(e) => setRoute([e.target.value, route[1]])}>{nodeOpts}</select>
                  <span>→</span>
                  <select className="cell boxed" style={{ width: 110 }} value={route[1]} onChange={(e) => setRoute([route[0], e.target.value])}>{nodeOpts}</select>
                  <select className="cell boxed" style={{ width: 130 }} value="" onChange={(e) => {
                    const v = e.target.value;
                    if (v === '__save') { const name = `${route[0]} → ${route[1]}`; setNet((n) => ({ ...n, profiles: [...(n.profiles ?? []).filter((p) => p.name !== name), { name, path: [route[0], route[1]] }] }), 'Save profile'); }
                    else if (v.startsWith('__del:')) { const name = v.slice(6); setNet((n) => ({ ...n, profiles: (n.profiles ?? []).filter((p) => p.name !== name) }), 'Delete profile'); }
                    else { const p = net.profiles?.find((x) => x.name === v); if (p) setRoute([p.path[0], p.path[p.path.length - 1]]); }
                  }} aria-label="Saved profiles">
                    <option value="">Saved profiles…</option>
                    {(net.profiles ?? []).map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                    <option value="__save">+ Save this route</option>
                    {(net.profiles ?? []).map((p) => <option key={'d' + p.name} value={`__del:${p.name}`}>Delete “{p.name}”</option>)}
                  </select>
                </div>
              )}
              <button className="btn ghost small icon" title={dock === 'max' ? 'Restore' : 'Enlarge'} onClick={() => setDock(dock === 'max' ? 'normal' : 'max')}>{dock === 'max' ? '▾' : '▴'}</button>
              <button className="btn ghost small icon" title={dock === 'min' ? 'Show' : 'Hide'} onClick={() => setDock(dock === 'min' ? 'normal' : 'min')}>{dock === 'min' ? '▴' : '–'}</button>
            </div>
            {dock !== 'min' && (
              <div className="dock-body">
                {bottom === 'tables' && <DataSheets net={net} setNet={setNet} result={result} onSelect={(r) => setSelected(r)} selected={selected} />}
                {bottom === 'cases' && <CasesPanel net={net} setProject={setProject} busy={!!busy} setBusy={setBusy} />}
                {bottom === 'protection' && <div style={{ maxWidth: 620 }}><ProtectionPanel net={net} setNet={(f) => setNet(f, 'Apply sizing')} busy={!!busy} onSizeVessel={doSize} onAirValves={doAir} sizing={sizing} airSugg={airSugg} /></div>}
                {bottom === 'eps' && <EPSPanel net={net} setNet={setNet} result={epsRes?.r ?? null} busy={!!busy} onRun={() => void doEPS()} k={Math.min(epsK, (epsRes?.r.times.length ?? 1) - 1)} setK={setEpsK} colour={epsColour} setColour={(c) => { setEpsColour(c); if (c !== 'none') setMode('plain'); }} onSurgeAt={surgeAt} selected={selected} />}
                {bottom === 'live' && <LivePanel net={net} setNet={setNet} eps={epsRes?.r ?? null} onToast={setToast} />}
                {!result && !['tables', 'cases', 'protection', 'eps', 'live'].includes(bottom) ? <div className="empty">Results appear here after a run. Press <b>Run</b> (F5).</div> : result && (
                  <>
                    {bottom === 'profile' && <ProfileView net={net} result={result} a={route[0]} b={route[1]} framePos={framePos} uEnv={unc?.envelopes} showNow={live} height={dock === 'max' ? 420 : 250} />}
                    {bottom === 'graphs' && <GraphsView net={net} result={result} items={graphs} setItems={setGraphs} selected={selected} tNow={tNow} />}
                    {bottom === 'checks' && <ChecksView checks={checks} onFocus={(c) => { if (c.where?.pipe) setSelected([{ type: 'pipe', id: c.where.pipe }]); else if (c.where?.node) setSelected([{ type: 'node', id: c.where.node }]); setMode(c.title.toLowerCase().includes('minimum') || c.title.toLowerCase().includes('column') ? 'min' : 'max'); }} />}
                    {bottom === 'uncertainty' && (
                      <div>
                        <p className="small muted" style={{ marginTop: 0 }}>Inputs are never exact. SurgeSpace re-runs the case with wave speed ±10 %, valve stroke ±20 % or pump inertia ±15 %, and at half the time step when the water column separates, then reports the worst case. The profile and drawing show the worst-case envelope once this has run.</p>
                        <button className="btn primary" disabled={!!busy} onClick={doUncertainty}>Run uncertainty analysis</button>
                        {unc && (
                          <>
                            <div className="stats" style={{ marginTop: 10 }}>
                              <div className="stat"><b>{fmtQ(unc.spread.maxHead[0], 'head', 1, units)} – {fmtQ(unc.spread.maxHead[1], 'head', 1, units)}</b><span>Maximum head range</span></div>
                              <div className="stat"><b>{fmtQ(unc.spread.minPressure[0], 'pressureHead', 1, units)} – {fmtQ(unc.spread.minPressure[1], 'pressureHead', 1, units)}</b><span>Minimum pressure range</span></div>
                            </div>
                            <table className="grid" style={{ marginTop: 10 }}>
                              <thead><tr><th>Run</th><th>Max head ({uLabel('head', units)})</th><th>Min pressure ({uLabel('pressureHead', units)})</th></tr></thead>
                              <tbody>{unc.runs.map((r) => <tr key={r.label}><td>{r.label}</td><td className="mono">{toShow(r.maxHead, 'head', units).toFixed(2)}</td><td className="mono">{toShow(r.minPressure, 'pressureHead', units).toFixed(2)}</td></tr>)}</tbody>
                            </table>
                          </>
                        )}
                      </div>
                    )}
                    {bottom === 'log' && (
                      <div>
                        <div className="stats">
                          <div className="stat"><b>{result.dt.toPrecision(3)} s</b><span>Time step</span></div>
                          <div className="stat"><b>{result.reaches.toLocaleString()}</b><span>Reaches</span></div>
                          <div className="stat"><b>{result.steps.toLocaleString()}</b><span>Steps</span></div>
                          <div className="stat"><b>{(result.maxAdjust * 100).toFixed(3)} %</b><span>Largest wave-speed change</span></div>
                          <div className="stat"><b>{result.rigidPipes.length}</b><span>Rigid-column pipes</span></div>
                          <div className="stat"><b>{(result.runtimeMs / 1000).toFixed(2)} s</b><span>Run time</span></div>
                        </div>
                        <div className="label">Messages</div>
                        {result.warnings.length ? <ul className="small">{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul> : <p className="small muted">No warnings.</p>}
                        <div className="label">Engine</div>
                        <p className="small muted">Method of characteristics with pipe lengths kept exactly (wave speeds within {(net.settings.maxAdjust * 100).toFixed(1)} %), discrete gas cavity model (free gas {net.settings.gasFraction}), {net.settings.unsteadyFriction ? 'unsteady friction (Brunone–Vítkovský, Vardy)' : 'quasi-steady friction'}, {net.settings.fluid?.name ?? 'water 20 °C'}{net.settings.siteElevation ? ` at ${fmtQ(net.settings.siteElevation, 'elevation', 0, units)} above sea level` : ''}. Validated against closed-form theory, EPANET 2.2, TSNet and published benchmark cases (see Help → About).</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </section>

        <aside className="pane right" aria-hidden={!showRight}>
          {showRight && <>
            <div className="pane-tabs">
              <button className={`ptab ${right === 'props' ? 'on' : ''}`} onClick={() => setRight('props')}>Properties</button>
              <button className={`ptab ${right === 'ai' ? 'on' : ''}`} onClick={() => setRight('ai')}><span className="ai-badge sm">AI</span> Copilot</button>
            </div>
            <div className="pane-body" style={right === 'props' ? undefined : { display: 'none' }}><Properties net={net} setNet={setNet} selected={selected} result={result} onSelect={(r) => setSelected(r)} /></div>
            <div className="pane-body copilot-body" style={right === 'ai' ? undefined : { display: 'none' }}>
              <CopilotPanel ctx={aiCtx} hasResult={!!result} onAccounts={() => setDialog('ai')} onUseNarrative={applyNarrative} queued={aiQueued} done={() => setAiQueued(null)} />
            </div>
          </>}
        </aside>
      </div>

      <footer className="statusbar">
        <span>{activeCase ? <>Case: <b>{activeCase.name}</b></> : <b>{net.name}</b>}</span>
        <span className="sep" />
        <span>{net.nodes.length} nodes · {net.pipes.length} pipes · {net.pumps.length} pumps · {net.valves.length} valves</span>
        <span className="sep" />
        <span>{tool === 'select' ? 'Select' : tool === 'pan' ? 'Pan' : `Placing: ${EL[tool as ElementKind]?.name}`}</span>
        {selected.length > 0 && <><span className="sep" /><span>{selected.length} selected</span></>}
        <div style={{ flex: 1 }} />
        {cursorW && <span className="mono">X {toShow(cursorW.x, 'length', units).toFixed(1)} · Y {toShow(cursorW.y, 'length', units).toFixed(1)} {uLabel('length', units)}</span>}
        <span className="sep" />
        <button className="sb-btn" onClick={() => setUnits({ system: units.system === 'SI' ? 'US' : 'SI' })} title="Switch units">{units.system} · {units.flow} · {units.pressure}</button>
        <span className="sep" />
        <span className={busy ? 'warn' : stale ? 'muted' : 'good'}>{busy ? 'Running…' : !result ? 'Not run' : stale ? 'Changed since run' : `Run OK · ${fails ? `${fails} check${fails > 1 ? 's' : ''} to fix` : 'all checks pass'}`}</span>
        <button className="sb-btn" onClick={() => setTheme(theme === 'auto' ? 'dark' : theme === 'dark' ? 'light' : 'auto')} title="Theme">{theme === 'auto' ? '◐' : theme === 'dark' ? '☾' : '☀'}</button>
      </footer>

      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems()} onClose={() => setCtx(null)} />}
      {dialog === 'tellus' && <TellUsDialog where={`${left} · ${bottom} · ${net.name}`} onClose={() => setDialog(null)} />}
      {licReason !== undefined && <LicenceDialog reason={licReason ?? undefined} onClose={() => setLicReason(undefined)} />}
      {dialog === 'report' && result && <ReportDialog net={net} result={result} checks={checks} route={route} nodes={graphs.filter((g) => g.ref.type === 'node').map((g) => g.ref.id)} version={__APP_VERSION__}
        onSaveInfo={(info) => setNetRaw((n) => ({ ...n, report: info }))} onClose={() => setDialog(null)} onDraftAI={() => { setDialog(null); aiTask(AI_TASKS.find((t) => t.id === 'report')!); }} />}
      {dialog === 'ai' && <AIAccountsDialog onClose={() => setDialog(null)} />}
      {dialog === 'import' && <ImportDialog onClose={() => setDialog(null)} onImport={(n, notes) => { setDialog(null); load(n, notes); }} />}
      {dialog === 'setup' && <RunSetupDialog net={net} setNet={setNet} onClose={() => setDialog(null)} defaults={defaults} setDefaults={setDefaults} />}
      {dialog === 'catalogues' && <CataloguesDialog net={net} onClose={() => setDialog(null)} onApplyWave={selected.some((r) => r.type === 'pipe') ? (a) => { const ids = new Set(selected.filter((r) => r.type === 'pipe').map((r) => r.id)); setNet((n) => ({ ...n, pipes: n.pipes.map((p) => (ids.has(p.id) ? { ...p, wavespeed: a } : p)) }), 'Wave speed'); setDialog(null); } : undefined} />}
      {dialog === 'health' && <HealthDialog net={net} onClose={() => setDialog(null)} onGo={goTo} />}
      {dialog === 'project' && <ProjectDialog net={net} setNet={setNet} onClose={() => setDialog(null)} />}
      {(dialog === 'help' || dialog === 'keys' || dialog === 'about') && <HelpDialog onClose={() => setDialog(null)} initial={dialog === 'keys' ? 'keys' : dialog === 'about' ? 'about' : 'guide'} version={__APP_VERSION__} />}
      {dialog === 'background' && <BackgroundDialog net={net} setNet={setNet} onClose={() => setDialog(null)} />}
      {dialog === 'find' && <FindDialog net={net} onClose={() => setDialog(null)} onGo={goTo} />}
      {toast && (
        <div className="toast card small">
          <div className="row" style={{ justifyContent: 'space-between' }}><b>Notes</b><button className="btn ghost small" onClick={() => setToast(null)}>×</button></div>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{toast.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

