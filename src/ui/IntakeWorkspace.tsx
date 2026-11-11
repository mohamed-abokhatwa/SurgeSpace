// Model from documents: drop the drawings, long sections, data sheets, spreadsheets or DXF; the AI reads them into
// an evidence register that the engineer reviews against the page; what is missing is asked for; the model is
// built, checked against the documents, and protected (air valve plan tested in surge runs, air vessel sizing).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAI, activeConfig } from '../ai/accounts';
import { buildBasis, buildFromBasis, chainageAt, findGaps, lineChainage, newId, readDocument, sheetEvidence, verifyModel, EV_TYPES, type BuildBasis, type Evidence, type EvType, type Gap, type IntakeDoc, type VerifyItem } from '../app/intake';
import type { AirValvePlanItem } from '../app/airValvePlan';
import { finishPlanNetwork, guessPipeLayers, guessSymbol, planToNetwork, verifyNetwork, SYMBOL_KINDS, type EndRole, type SymbolKind } from '../app/planNetwork';
import type { VesselSizing } from '../engine/analysis';
import { materialId } from '../app/intake';
import { NetThumb } from './Thumb';
import type { Network } from '../engine/types';
import { call } from './client';
import { Ic } from './Icons';
import { tr } from '../app/i18n';

export interface IntakeSession {
  docs: IntakeDoc[];
  evidence: Evidence[];
  gaps: Gap[];
  summaries: Record<string, string>;
  read: Record<string, boolean>;
  name: string;
  built?: { net: Network; notes: string[]; verify: VerifyItem[]; basis: BuildBasis; mode?: 'line' | 'network' };
  /** Single main from the long section, or a network from a plan drawing (DXF). */
  mode?: 'line' | 'network';
  netPlan?: { doc: string; layers: string[]; units: 'm' | 'mm'; symbols: Record<string, SymbolKind>; draft?: { net: Network; notes: string[]; ends: string[] }; roles: Record<string, EndRole> };
  vessel?: VesselSizing;
  plan?: AirValvePlanItem[];
  test?: { before: { minPressure: number; at: string; cavity: number; slams: number }; after: { minPressure: number; at: string; cavity: number; slams: number }; antiSlam: string[]; net: Network };
}

type Stage = 'docs' | 'review' | 'gaps' | 'build' | 'protect';
const STAGES: [Stage, string][] = [['docs', 'Documents'], ['review', 'Review'], ['gaps', 'Missing data'], ['build', 'Build and check'], ['protect', 'Protection']];
const TYPE_NAMES: Record<EvType, string> = { profilePoint: 'Long section point', reservoir: 'Reservoir', tank: 'Tank', pump: 'Pump', pumpCurvePoint: 'Pump curve point', pipe: 'Pipe', valve: 'Valve', checkValve: 'Check valve', airValve: 'Air valve', washout: 'Washout', junction: 'Junction', design: 'Design data', note: 'Note' };
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.bmp,.xlsx,.xlsm,.xls,.csv,.tsv,.dxf,.txt,.md';
const fmtVal = (v: number | string) => (typeof v === 'number' ? (Math.abs(v) >= 1000 || Number.isInteger(v) ? String(Math.round(v * 100) / 100) : v.toPrecision(4)) : v);
const valuesText = (e: Evidence) => Object.entries(e.values).map(([k, v]) => `${k} = ${fmtVal(v)}`).join('; ');
const parseValues = (s: string): Record<string, number | string> => {
  const out: Record<string, number | string> = {};
  for (const part of s.split(/[;\n]/)) { const m = part.split('='); if (m.length < 2) continue; const k = m[0].trim(), v = m.slice(1).join('=').trim(); if (!k) continue; const n = Number(v); out[k] = v !== '' && Number.isFinite(n) ? n : v; }
  return out;
};

export function IntakeWorkspace({ session, setSession, onClose, onOpenAccounts, onOpen, canSize = true }: {
  canSize?: boolean;
  session: IntakeSession;
  setSession: (f: (s: IntakeSession) => IntakeSession) => void;
  onClose: () => void;
  onOpenAccounts: () => void;
  onOpen: (net: Network, notes: string[], sizeVessel: boolean) => void;
}) {
  const ai = useAI();
  const hasAI = ai.accounts.length > 0;
  const [stage, setStage] = useState<Stage>(session.built ? 'build' : session.evidence.length ? 'review' : 'docs');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const S = session;
  const set = (p: Partial<IntakeSession>) => setSession((s) => ({ ...s, ...p }));

  // ── documents ──
  const addFiles = async (files: FileList | File[]): Promise<IntakeDoc[]> => {
    setErr(null);
    const added: IntakeDoc[] = [];
    for (const f of Array.from(files)) {
      setBusy(`${tr('Opening')} ${f.name}…`);
      try {
        const d = await readDocument(f, (m) => setBusy(m));
        const ev = d.kind === 'sheet' ? sheetEvidence(d) : [];
        added.push(d);
        setSession((s) => ({ ...s, docs: [...s.docs, d], evidence: [...s.evidence, ...ev], read: { ...s.read, [d.id]: ev.length > 0 }, summaries: ev.length ? { ...s.summaries, [d.id]: `${ev.length} ${tr('items read from the table headers (no AI needed)')}` } : s.summaries }));
      } catch (e) { setErr(`${f.name}: ${(e as Error).message}`); }
    }
    setBusy(null);
    return added;
  };
  const readWithAI = async (only?: IntakeDoc[]) => {
    if (!ai.consent) { setErr(tr('Reading documents with AI sends them to your AI provider. Allow it in AI → Accounts first.')); return; }
    const cfg = await activeConfig();
    if (!cfg) { onOpenAccounts(); return; }
    const { extractPage, extractSheet, extractDxf, extractText } = await import('../ai/intakeAI');
    const ac = new AbortController(); abort.current = ac; setErr(null);
    const todo = only ?? S.docs.filter((d) => !S.read[d.id]);
    let found = 0;
    try {
      for (const d of todo) {
        const results: { summary: string; items: Evidence[] }[] = [];
        if (d.kind === 'pdf' || d.kind === 'image') {
          for (const p of d.pages) { setBusy(`${tr('AI is reading')} ${d.name} · ${tr('page')} ${p.n}/${d.pages.length}`); results.push(await extractPage(cfg, d, p, ac.signal)); }
        } else { setBusy(`${tr('AI is reading')} ${d.name}`); results.push(d.kind === 'sheet' ? await extractSheet(cfg, d, ac.signal) : d.kind === 'dxf' ? await extractDxf(cfg, d, ac.signal) : await extractText(cfg, d, ac.signal)); }
        const items = results.flatMap((r) => r.items);
        found += items.length;
        setSession((s) => ({ ...s, evidence: [...s.evidence.filter((e) => !(e.source.doc === d.id && e.source.how === 'ai')), ...items], read: { ...s.read, [d.id]: true }, summaries: { ...s.summaries, [d.id]: results.map((r, k) => (results.length > 1 ? `p${k + 1}: ${r.summary}` : r.summary)).filter(Boolean).join(' · ') } }));
      }
      if (found) setStage('review');
    } catch (e) { if (!ac.signal.aborted) setErr((e as Error).message); }
    finally { setBusy(null); abort.current = null; }
  };

  // ── gaps follow the evidence ──
  const hasPlan = S.docs.some((d) => d.kind === 'dxf' && (d.dxf?.layers.length ?? 0) > 0);
  useEffect(() => { setSession((s) => ({ ...s, gaps: findGaps(s.evidence, s.gaps, hasPlan) })); }, [S.evidence, hasPlan, setSession]);
  const mode: 'line' | 'network' = S.mode ?? (hasPlan && S.evidence.filter((e) => e.type === 'profilePoint' && e.status !== 'rejected').length < 2 ? 'network' : 'line');
  const openCritical = S.gaps.filter((g) => g.critical && g.status === 'open');
  const basis = useMemo(() => buildBasis(S.evidence, S.gaps, S.docs), [S.evidence, S.gaps, S.docs]);

  const build = async () => {
    setBusy(tr('Building the model…')); setErr(null);
    try {
      const { net, notes } = await buildFromBasis(basis, S.name);
      const net2 = { ...net, sources: basis.trace };
      setBusy(tr('Checking it against the documents…'));
      const verify = await verifyModel(net2, basis);
      set({ built: { net: net2, notes, verify, basis, mode: 'line' }, plan: undefined, test: undefined, vessel: undefined });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  // ── network from the plan drawing ──
  const planCfg = (): NonNullable<IntakeSession['netPlan']> => {
    if (S.netPlan) return S.netPlan;
    const d = S.docs.find((x) => x.kind === 'dxf' && x.dxf?.layers.length)!;
    // symbols and pipe layers: the AI's mapping where it gave one, else a guess from the names
    const aiSym: Record<string, SymbolKind> = {}, aiLayers: string[] = [];
    for (const e of S.evidence) if (e.status !== 'rejected' && e.type === 'note' && e.source.doc === d.id) {
      if (e.values.block && SYMBOL_KINDS.includes(String(e.values.kind) as SymbolKind)) aiSym[String(e.values.block)] = String(e.values.kind) as SymbolKind;
      if (e.values.layer && String(e.values.kind) === 'pipe') aiLayers.push(String(e.values.layer));
    }
    const pts = [...d.dxf!.blocks.flatMap((b) => b.at), ...d.dxf!.texts.map((t) => [t.x, t.y] as [number, number])];
    const span = pts.length ? Math.max(Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1]))) : 0;
    const layers = aiLayers.filter((l) => d.dxf!.layers.some((x) => x.name === l));
    return { doc: d.id, layers: layers.length ? layers : guessPipeLayers(d.dxf!), units: span > 50000 ? 'mm' : 'm', symbols: Object.fromEntries(d.dxf!.blocks.map((b) => [b.name, aiSym[b.name] ?? guessSymbol(b.name)])), roles: {} };
  };
  const buildPlan = () => {
    setErr(null);
    try {
      const cfg = planCfg();
      const d = S.docs.find((x) => x.id === cfg.doc)!;
      const r = planToNetwork(d.dxf!, { layers: cfg.layers, units: cfg.units, symbols: cfg.symbols, diameterMm: basis.diameterMm, material: materialId(basis.material), classM: basis.classM }, S.name);
      // ends: a reservoir symbol is a source; otherwise closed until the engineer says
      const roles: Record<string, EndRole> = {};
      for (const id of r.ends) { const n = r.net.nodes.find((x) => x.id === id)!; roles[id] = cfg.roles[id] ?? (n.kind === 'reservoir' ? { role: 'source', level: n.head ?? n.elev } : { role: 'closed' }); }
      for (const n of r.net.nodes) if (n.kind === 'reservoir' && !roles[n.id]) roles[n.id] = { role: 'source', level: n.head ?? n.elev };
      set({ netPlan: { ...cfg, draft: { net: r.net, notes: r.notes, ends: [...new Set([...r.ends, ...r.net.nodes.filter((n) => n.kind === 'reservoir').map((n) => n.id)])] }, roles }, built: undefined, plan: undefined, test: undefined, vessel: undefined });
    } catch (e) { setErr((e as Error).message); }
  };
  const finishPlan = async () => {
    const np = S.netPlan;
    if (!np?.draft) return;
    setErr(null);
    try {
      const f = finishPlanNetwork(np.draft.net, np.roles);
      let net = f.net;
      // a pump curve from the data sheet, where the plan has pumps
      if (basis.curve && net.pumps.length) net = { ...net, pumps: net.pumps.map((p) => ({ ...p, curve: basis.curve!.map(([q, h]) => [q / 1000, h] as [number, number]), ...(basis.inertia ? { inertia: basis.inertia } : {}) })) };
      const trace = [{ what: 'Network', value: `${net.nodes.length} nodes, ${net.pipes.length} pipes`, from: S.docs.find((d) => d.id === np.doc)?.name ?? 'DXF' }, ...basis.trace.filter((x) => !['Long section', 'Start water level', 'End water level', 'Design flow', 'Air valves on the drawings'].includes(x.what))];
      net = { ...net, sources: trace };
      setBusy(tr('Checking it against the documents…'));
      const verify = await verifyNetwork(net);
      set({ built: { net, notes: [...np.draft.notes, ...f.notes], verify, basis: { ...basis, trace }, mode: 'network' }, plan: undefined, test: undefined, vessel: undefined });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const sizeVessel = async () => {
    if (!S.built) return;
    const net = S.test?.net ?? S.built.net;
    const node = net.nodes.some((n) => n.id === 'PS-D') ? 'PS-D' : net.pumps[0]?.to;
    if (!node) return;
    setErr(null);
    try { const o = await call<{ sizing: VesselSizing }>({ type: 'sizeVessel', net, node }, (m) => setBusy(`${tr('Sizing air vessel')} · ${m}`)); set({ vessel: o.sizing }); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const plan = async (test: boolean) => {
    if (!S.built) return;
    setErr(null);
    try {
      const o = await call<{ plan: AirValvePlanItem[]; test?: IntakeSession['test']; net?: Network }>({ type: 'avPlan', net: S.built.net, plan: test ? S.plan : undefined, test }, (m) => setBusy(m));
      set(test ? { plan: o.plan, test: o.test && o.net ? { ...o.test, net: o.net } : undefined } : { plan: o.plan, test: undefined });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };

  const stageOk: Record<Stage, boolean> = { docs: true, review: S.docs.length > 0 || S.evidence.length > 0, gaps: true, build: openCritical.length === 0, protect: !!S.built };
  const k = STAGES.findIndex(([s]) => s === stage);
  return (
    <div className="intake" role="dialog" aria-label={tr('Model from documents')}>
      <header className="intake-head">
        <div className="intake-title"><Ic name="ai" size={18} /><b>{tr('Model from documents')}</b><input className="intake-name" value={S.name} onChange={(e) => set({ name: e.target.value })} aria-label={tr('Model name')} /></div>
        <nav className="intake-steps">
          {STAGES.map(([s, l], i) => <button key={s} className={`istep ${s === stage ? 'on' : ''} ${i < k ? 'done' : ''}`} disabled={!stageOk[s]} onClick={() => setStage(s)}><span className="istep-n">{i < k ? '✓' : i + 1}</span>{tr(l)}</button>)}
        </nav>
        <button className="btn ghost small icon" onClick={onClose} aria-label={tr('Close')}><Ic name="close" size={16} /></button>
      </header>
      {busy && <div className="intake-busy"><span className="spinner" />{busy}{abort.current && <button className="btn small ghost" onClick={() => abort.current?.abort()}>{tr('Stop')}</button>}</div>}
      {err && <div className="intake-err" role="alert">{err}<button className="btn small ghost" onClick={() => setErr(null)}>×</button></div>}
      <div className="intake-body">
        {stage === 'docs' && <DocsStage S={S} hasAI={hasAI} busy={!!busy} addFiles={addFiles} readWithAI={readWithAI} onOpenAccounts={onOpenAccounts} remove={(id) => setSession((s) => ({ ...s, docs: s.docs.filter((d) => d.id !== id), evidence: s.evidence.filter((e) => e.source.doc !== id) }))} />}
        {stage === 'review' && <ReviewStage S={S} setSession={setSession} />}
        {stage === 'gaps' && <GapsStage S={S} setSession={setSession} addFiles={async (f) => { const fresh = (await addFiles(f)).filter((d) => d.kind !== 'sheet' || !S.read[d.id]); if (fresh.length && hasAI) await readWithAI(fresh); }} />}
        {stage === 'build' && (
          <>
            {hasPlan && (
              <div className="build-mode seg" role="tablist">
                <button className={mode === 'line' ? 'on' : ''} onClick={() => set({ mode: 'line' })}>{tr('Single main from the long section')}</button>
                <button className={mode === 'network' ? 'on' : ''} onClick={() => set({ mode: 'network' })}>{tr('Network from the plan drawing (DXF)')}</button>
              </div>
            )}
            {mode === 'line' ? <BuildStage S={S} basis={basis} build={build} busy={!!busy} />
              : <PlanBuild S={S} cfg={S.netPlan ?? planCfg()} setCfg={(c) => set({ netPlan: c })} buildPlan={buildPlan} finishPlan={finishPlan} busy={!!busy} />}
          </>
        )}
        {stage === 'protect' && <ProtectStage S={S} plan={plan} busy={!!busy} onOpen={onOpen} sizeVessel={sizeVessel} canSize={canSize} />}
      </div>
      <footer className="intake-foot">
        <span className="small muted">{S.docs.length} {tr(S.docs.length === 1 ? 'document' : 'documents')} · {S.evidence.filter((e) => e.status !== 'rejected').length} {tr('items')} · {S.gaps.filter((g) => g.status === 'open').length} {tr('open questions')}</span>
        <span style={{ flex: 1 }} />
        <button className="btn" disabled={k === 0} onClick={() => setStage(STAGES[k - 1][0])}>{tr('Back')}</button>
        {k < STAGES.length - 1 && <button className="btn primary intake-next" disabled={!stageOk[STAGES[k + 1][0]] || !!busy} onClick={() => setStage(STAGES[k + 1][0])}>{tr('Next')}: {tr(STAGES[k + 1][1])}</button>}
      </footer>
    </div>
  );
}

function DocsStage({ S, hasAI, busy, addFiles, readWithAI, onOpenAccounts, remove }: { S: IntakeSession; hasAI: boolean; busy: boolean; addFiles: (f: FileList) => Promise<IntakeDoc[]>; readWithAI: (only?: IntakeDoc[]) => Promise<void>; onOpenAccounts: () => void; remove: (id: string) => void }) {
  const inp = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const unread = S.docs.filter((d) => !S.read[d.id]);
  const pages = unread.reduce((a, d) => a + Math.max(1, d.pages.length), 0);
  return (
    <div className="intake-docs">
      <div className={`drop ${over ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files); }} onClick={() => inp.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && inp.current?.click()}>
        <input ref={inp} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { if (e.target.files?.length) void addFiles(e.target.files); e.target.value = ''; }} />
        <svg viewBox="0 0 64 48" width="64" height="48" aria-hidden><path d="M6 40h52M10 40V14l10-6 10 6v26M34 40V22h20v18" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M32 4v18m-6-6 6 6 6-6" fill="none" stroke="var(--accent)" strokeWidth="2.4" /></svg>
        <b>{tr('Drop drawings, long sections, data sheets or spreadsheets')}</b>
        <span className="small muted">PDF · {tr('images')} · Excel / CSV · DXF · {tr('text')} — {tr('or click to choose files')}</span>
      </div>
      <div className="intake-how small muted">
        <div><b>1</b> {tr('Spreadsheets with chainage/level, pipe or pump curve columns are read at once, without AI.')}</div>
        <div><b>2</b> {tr('Drawings are read by your AI: long-section tables, levels, pipe data, pumps, valves and air valves, each with the place on the page it came from.')}</div>
        <div><b>3</b> {tr('You review every item against the page, answer what is missing, and the model is built and tested.')}</div>
      </div>
      {S.docs.length > 0 && (
        <div className="doc-grid">
          {S.docs.map((d) => (
            <div key={d.id} className="doc-card card">
              <div className="doc-thumb">{d.pages[0] ? <img src={d.pages[0].image} alt="" /> : <span className="mono">{d.kind.toUpperCase()}</span>}</div>
              <div className="doc-meta">
                <b title={d.name}>{d.name}</b>
                <span className="small muted">{d.kind === 'pdf' ? `${d.pages.length} ${d.pages.length === 1 ? tr('page') : tr('pages')}` : d.kind === 'sheet' ? `${d.sheets?.length ?? 0} ${(d.sheets?.length ?? 0) === 1 ? tr('sheet') : tr('sheets')}` : d.kind === 'dxf' ? `${d.dxf?.blocks.length ?? 0} ${tr('symbol types')}, ${d.dxf?.texts.length ?? 0} ${tr('texts')}` : d.kind}</span>
                <span className={`pill ${S.read[d.id] ? 'good' : ''}`}>{S.read[d.id] ? `${S.evidence.filter((e) => e.source.doc === d.id).length} ${tr('items')}` : tr('not read yet')}</span>
                {S.summaries[d.id] && <span className="small doc-sum">{S.summaries[d.id]}</span>}
              </div>
              <div className="doc-act">
                {S.read[d.id] && hasAI && <button className="btn ghost small" disabled={busy} onClick={() => void readWithAI([d])}>{tr('Read again')}</button>}
                <button className="btn ghost small" disabled={busy} onClick={() => remove(d.id)} aria-label={tr('Remove')}>×</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {unread.length > 0 && (hasAI
        ? <button className="btn primary big" disabled={busy} onClick={() => void readWithAI()}><Ic name="ai" /> {tr('Read with AI')} ({pages} {pages === 1 ? tr('page') : tr('pages')})</button>
        : <div className="card intake-noai"><b>{tr('Drawings need an AI account to be read.')}</b><span className="small muted">{tr('Spreadsheets are read without one, and everything can be entered by hand under Missing data.')}</span><button className="btn small" onClick={onOpenAccounts}>{tr('Add an AI account')}</button></div>)}
    </div>
  );
}

function ReviewStage({ S, setSession }: { S: IntakeSession; setSession: (f: (s: IntakeSession) => IntakeSession) => void }) {
  const [sel, setSel] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [edit, setEdit] = useState<{ id: string; text: string } | null>(null);
  const [view, setView] = useState<{ doc: string; page: number } | null>(() => { const d = S.docs.find((x) => x.pages.length); return d ? { doc: d.id, page: 1 } : null; });
  const upd = (id: string, p: Partial<Evidence>) => setSession((s) => ({ ...s, evidence: s.evidence.map((e) => (e.id === id ? { ...e, ...p } : e)) }));
  const ev = S.evidence.filter((e) => filter === 'all' || e.source.doc === filter);
  const groups = EV_TYPES.map((t) => [t, ev.filter((e) => e.type === t)] as const).filter(([, l]) => l.length);
  const doc = view ? S.docs.find((d) => d.id === view.doc) : undefined;
  const page = doc?.pages.find((p) => p.n === view?.page);
  const onPage = page ? S.evidence.filter((e) => e.source.doc === doc!.id && e.source.page === page.n && e.source.box) : [];
  const pick = (e: Evidence) => { setSel(e.id); if (e.source.page && S.docs.find((d) => d.id === e.source.doc)?.pages.length) setView({ doc: e.source.doc, page: e.source.page }); };
  useEffect(() => { if (!sel) return; document.querySelector(`[data-ev="${sel}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [sel]);
  const acceptSure = () => setSession((s) => ({ ...s, evidence: s.evidence.map((e) => (e.status === 'proposed' && e.confidence >= 0.7 ? { ...e, status: 'accepted' } : e)) }));
  const addManual = () => { const e: Evidence = { id: newId(), type: 'note', values: {}, source: { doc: filter !== 'all' ? filter : S.docs[0]?.id ?? 'user', how: 'user' }, confidence: 1, status: 'accepted' }; setSession((s) => ({ ...s, evidence: [...s.evidence, e] })); setSel(e.id); setEdit({ id: e.id, text: '' }); };
  return (
    <div className="intake-review">
      <div className="review-page">
        {S.docs.some((d) => d.pages.length) ? (
          <>
            <div className="row" style={{ gap: 6, marginBottom: 6 }}>
              <select value={view ? `${view.doc}|${view.page}` : ''} onChange={(e) => { const [d, p] = e.target.value.split('|'); setView({ doc: d, page: Number(p) }); }} aria-label={tr('Page')}>
                {S.docs.filter((d) => d.pages.length).flatMap((d) => d.pages.map((p) => <option key={`${d.id}|${p.n}`} value={`${d.id}|${p.n}`}>{d.name}{d.pages.length > 1 ? ` · ${tr('page')} ${p.n}` : ''} ({S.evidence.filter((e) => e.source.doc === d.id && e.source.page === p.n).length})</option>))}
              </select>
              <span className="small muted">{tr('Boxes show where each item was read; click one to find it in the list.')}</span>
            </div>
            {page && (
              <div className="page-view">
                <img src={page.image} alt={`${doc!.name} ${page.n}`} />
                {onPage.map((e) => { const [x0, y0, x1, y1] = e.source.box!; return <button key={e.id} className={`ev-box t-${e.type} ${e.id === sel ? 'sel' : ''} ${e.status}`} style={{ left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${Math.max(0.6, (x1 - x0) * 100)}%`, height: `${Math.max(0.6, (y1 - y0) * 100)}%` }} title={`${tr(TYPE_NAMES[e.type])}: ${valuesText(e)}`} onClick={() => setSel(e.id)} />; })}
              </div>
            )}
          </>
        ) : <div className="empty">{tr('No drawings to show: the items come from spreadsheets, DXF or text, with the cell or label they came from.')}</div>}
      </div>
      <div className="review-list">
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={tr('Document')}><option value="all">{tr('All documents')}</option>{S.docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          <span style={{ flex: 1 }} />
          <button className="btn small" onClick={acceptSure}>{tr('Accept all with confidence ≥ 70 %')}</button>
          <button className="btn small ghost" onClick={addManual}>+ {tr('Add an item')}</button>
        </div>
        {!ev.length && <div className="empty">{tr('Nothing read yet. Go back to Documents, or enter the data under Missing data.')}</div>}
        {groups.map(([t, list]) => (
          <section key={t} className="ev-group">
            <h4>{tr(TYPE_NAMES[t])} <span className="muted small">{list.length}</span></h4>
            {list.map((e) => (
              <div key={e.id} data-ev={e.id} className={`ev-row ${e.status} ${e.id === sel ? 'sel' : ''}`} onClick={() => pick(e)}>
                <span className={`ev-dot t-${e.type}`} />
                <div className="ev-main">
                  {edit?.id === e.id ? (
                    <div className="ev-edit" onClick={(x) => x.stopPropagation()}>
                      <select value={e.type} onChange={(x) => upd(e.id, { type: x.target.value as EvType })}>{EV_TYPES.map((tt) => <option key={tt} value={tt}>{tr(TYPE_NAMES[tt])}</option>)}</select>
                      <textarea rows={2} value={edit.text} onChange={(x) => setEdit({ id: e.id, text: x.target.value })} placeholder="chainage_m = 1200; level_m = 115.4" autoFocus />
                      <button className="btn small primary" onClick={() => { upd(e.id, { values: parseValues(edit.text), status: 'accepted', source: { ...e.source, how: e.source.how === 'ai' ? 'ai' : e.source.how } }); setEdit(null); }}>{tr('Save')}</button>
                    </div>
                  ) : (
                    <>
                      <span className="ev-vals mono small">{e.label ? <b>{e.label} </b> : null}{valuesText(e) || <i className="muted">{tr('no values')}</i>}</span>
                      <span className="ev-src small muted">{S.docs.find((d) => d.id === e.source.doc)?.name ?? tr('entered')}{e.source.page ? ` · p${e.source.page}` : ''}{e.source.cell ? ` · ${e.source.cell}` : ''} · {e.source.how === 'ai' ? 'AI' : e.source.how === 'table' ? tr('table') : e.source.how === 'user' ? tr('you') : 'CAD'}</span>
                    </>
                  )}
                </div>
                <span className="ev-conf" title={`${tr('Confidence')} ${Math.round(e.confidence * 100)} %`}><i style={{ width: `${e.confidence * 100}%` }} /></span>
                <div className="ev-act" onClick={(x) => x.stopPropagation()}>
                  <button className={`btn small icon ${e.status === 'accepted' ? 'primary' : 'ghost'}`} aria-label={tr('Accept')} onClick={() => upd(e.id, { status: e.status === 'accepted' ? 'proposed' : 'accepted' })}>✓</button>
                  <button className="btn small icon ghost" aria-label={tr('Edit')} onClick={() => setEdit({ id: e.id, text: Object.entries(e.values).map(([kk, v]) => `${kk} = ${v}`).join('; ') })}>✎</button>
                  <button className={`btn small icon ${e.status === 'rejected' ? 'danger' : 'ghost'}`} aria-label={tr('Reject')} onClick={() => upd(e.id, { status: e.status === 'rejected' ? 'proposed' : 'rejected' })}>✗</button>
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function GapsStage({ S, setSession, addFiles }: { S: IntakeSession; setSession: (f: (s: IntakeSession) => IntakeSession) => void; addFiles: (f: FileList) => Promise<void> }) {
  const upd = (id: string, p: Partial<Gap>) => setSession((s) => ({ ...s, gaps: s.gaps.map((g) => (g.id === id ? { ...g, ...p } : g)) }));
  const inp = useRef<HTMLInputElement>(null);
  if (!S.gaps.length) return <div className="intake-gaps"><div className="all-set card"><b>✓ {tr('Nothing missing')}</b><span className="muted">{tr('The documents give everything the model needs. Go on to build it.')}</span></div></div>;
  return (
    <div className="intake-gaps">
      <p className="muted">{tr('What the documents do not give. Answer it, use the typical value (it is then listed as an assumption in the report), or add the data sheet and the AI reads it.')}</p>
      <input ref={inp} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { if (e.target.files?.length) void addFiles(e.target.files); e.target.value = ''; }} />
      {S.gaps.map((g) => (
        <div key={g.id} className={`gap card ${g.status} ${g.critical ? 'critical' : ''}`}>
          <div className="gap-q">
            <b>{g.critical && <span className="pill bad">{tr('needed')}</span>} {tr(g.question)}</b>
            <span className="small muted">{tr(g.why)}</span>
          </div>
          <div className="gap-a">
            {g.id === 'profile' ? (
              <textarea rows={4} placeholder={'0\t96\n1200\t120\n2600\t146'} value={String(g.answer ?? '')} onChange={(e) => upd(g.id, { answer: e.target.value })} aria-label={tr(g.question)} />
            ) : g.options ? (
              <select value={String(g.answer ?? '')} onChange={(e) => upd(g.id, { answer: e.target.value, status: e.target.value ? 'answered' : 'open' })} aria-label={tr(g.question)}><option value="">—</option>{g.options.map((o) => <option key={o}>{o}</option>)}</select>
            ) : (
              <label className="gap-num"><input type="number" value={g.status === 'answered' ? String(g.answer ?? '') : ''} placeholder={g.typical !== undefined ? String(g.typical) : ''} onChange={(e) => upd(g.id, { answer: e.target.value === '' ? undefined : Number(e.target.value), status: e.target.value === '' ? 'open' : 'answered' })} aria-label={tr(g.question)} />{g.unit && <span className="small muted">{g.unit}</span>}</label>
            )}
            {g.id === 'profile' && <button className="btn small primary" onClick={() => {
              const rows = String(g.answer ?? '').split('\n').map((l) => l.trim().split(/[\s,;\t]+/).map(Number)).filter((r) => r.length >= 2 && r.every(Number.isFinite));
              if (rows.length < 2) return;
              setSession((s) => ({ ...s, evidence: [...s.evidence, ...rows.map(([c, z]) => ({ id: newId(), type: 'profilePoint' as const, values: { chainage_m: c, level_m: z }, source: { doc: 'user', how: 'user' as const }, confidence: 1, status: 'accepted' as const }))] }));
            }}>{tr('Use these points')}</button>}
            {g.typical !== undefined && g.id !== 'profile' && <button className={`btn small ${g.status === 'assumed' ? 'primary' : ''}`} onClick={() => upd(g.id, { status: g.status === 'assumed' ? 'open' : 'assumed' })}>{g.status === 'assumed' ? '✓ ' : ''}{tr('Use typical')}: {String(g.typical)}{typeof g.typical === 'number' && g.unit ? ` ${g.unit}` : ''}</button>}
            <button className="btn small ghost" onClick={() => inp.current?.click()}>{tr('Add data sheet')}</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function LongSection({ b, items }: { b: BuildBasis; items?: { ch: number; z: number; label: string; kind: 'drawing' | 'plan' }[] }) {
  if (b.profile.length < 2) return null;
  const W = 760, H = 190, m = { l: 44, r: 12, t: 14, b: 26 };
  const c0 = b.profile[0][0], c1 = b.profile[b.profile.length - 1][0];
  const zs = [...b.profile.map((p) => p[1]), b.startLevel, b.endLevel];
  const z0 = Math.min(...zs) - 3, z1 = Math.max(...zs) + 6;
  const X = (c: number) => m.l + ((c - c0) / (c1 - c0 || 1)) * (W - m.l - m.r), Y = (z: number) => m.t + (1 - (z - z0) / (z1 - z0 || 1)) * (H - m.t - m.b);
  const path = b.profile.map(([c, z], i) => `${i ? 'L' : 'M'}${X(c).toFixed(1)},${Y(z).toFixed(1)}`).join('');
  return (
    <svg className="ls-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tr('Long section')}>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => <g key={f}><line x1={m.l} x2={W - m.r} y1={Y(z0 + f * (z1 - z0))} y2={Y(z0 + f * (z1 - z0))} className="ls-grid" /><text x={m.l - 5} y={Y(z0 + f * (z1 - z0)) + 3} textAnchor="end" className="ls-t">{(z0 + f * (z1 - z0)).toFixed(0)}</text></g>)}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => <text key={f} x={X(c0 + f * (c1 - c0))} y={H - 8} textAnchor="middle" className="ls-t">{(c0 + f * (c1 - c0)).toFixed(0)}</text>)}
      <path d={`${path}L${X(c1)},${Y(z0)}L${X(c0)},${Y(z0)}Z`} className="ls-ground" />
      <path d={path} className="ls-pipe" />
      <line x1={X(c0)} x2={X(c0) + 26} y1={Y(b.startLevel)} y2={Y(b.startLevel)} className="ls-wl" />
      <line x1={X(c1) - 26} x2={X(c1)} y1={Y(b.endLevel)} y2={Y(b.endLevel)} className="ls-wl" />
      {(items ?? []).map((it, i) => <g key={i} transform={`translate(${X(it.ch)},${Y(it.z)})`}><title>{it.label}</title><path d="M0,0V-12" className={`ls-av ${it.kind}`} /><circle cy={-15} r={4} className={`ls-av ${it.kind}`} /></g>)}
    </svg>
  );
}

function BuildStage({ S, basis, build, busy }: { S: IntakeSession; basis: BuildBasis; build: () => Promise<void>; busy: boolean }) {
  const fromDoc = (f: string) => !/^assumed|^entered/.test(f);
  return (
    <div className="intake-build">
      <div className="build-left">
        <h4>{tr('Basis of the model')}</h4>
        <table className="trace">
          <tbody>
            {basis.trace.map((r, i) => <tr key={i}><td>{tr(r.what)}</td><td className="mono">{r.value}</td><td className={fromDoc(r.from) ? 'src-doc' : r.from.startsWith('entered') ? 'src-you' : 'src-assumed'}>{r.from.startsWith('assumed') || r.from.startsWith('entered') ? tr(r.from) : r.from}</td></tr>)}
          </tbody>
        </table>
        <p className="small muted">{tr('Green: read from a document. Blue: entered by you. Orange: assumed; listed in the report as an assumption.')}</p>
      </div>
      <div className="build-right">
        <LongSection b={basis} items={basis.airValves.map((a) => ({ ch: a.chainage, z: profileLevel(basis.profile, a.chainage), label: `${tr('Air valve on the drawings')} CH ${a.chainage}`, kind: 'drawing' as const }))} />
        <button className="btn primary big" disabled={busy || basis.profile.length < 2} onClick={() => void build()}>{S.built ? tr('Build again') : tr('Build the model')}</button>
        {S.built && (
          <div className="verify card">
            <b>{tr('Checks against the documents')}</b>
            {S.built.verify.map((v, i) => <div key={i} className={`vrow ${v.ok ? 'v-ok' : 'v-warn'}`}><span>{v.ok ? '✓' : '!'}</span><div><b>{tr(v.what)}</b><span className="small">{v.detail}</span></div></div>)}
            <div className="small muted" style={{ marginTop: 6 }}>{S.built.notes.join(' · ')}</div>
          </div>
        )}
      </div>
    </div>
  );
}
const profileLevel = (p: [number, number][], ch: number) => { for (let k = 0; k + 1 < p.length; k++) if (ch >= p[k][0] && ch <= p[k + 1][0]) return p[k][1] + ((ch - p[k][0]) / (p[k + 1][0] - p[k][0] || 1)) * (p[k + 1][1] - p[k][1]); return p[p.length - 1]?.[1] ?? 0; };

const SYMBOL_NAMES: Record<SymbolKind, string> = { airValve: 'Air valve', washout: 'Washout', valve: 'Line valve', checkValve: 'Check valve', pump: 'Pump', reservoir: 'Reservoir', tank: 'Tank', hydrant: 'Hydrant', ignore: 'Not a pipeline item' };
function PlanBuild({ S, cfg, setCfg, buildPlan, finishPlan, busy }: { S: IntakeSession; cfg: NonNullable<IntakeSession['netPlan']>; setCfg: (c: NonNullable<IntakeSession['netPlan']>) => void; buildPlan: () => void; finishPlan: () => Promise<void>; busy: boolean }) {
  const d = S.docs.find((x) => x.id === cfg.doc);
  if (!d?.dxf) return <div className="empty">{tr('No plan drawing (DXF) among the documents.')}</div>;
  const draft = cfg.draft;
  const setRole = (id: string, r: EndRole) => setCfg({ ...cfg, roles: { ...cfg.roles, [id]: r } });
  const built = S.built?.mode === 'network' ? S.built : undefined;
  return (
    <div className="intake-build plan-build">
      <div className="build-left">
        <h4>{tr('Pipe layers')}</h4>
        <div className="layer-list">
          {d.dxf.layers.map((l) => (
            <label key={l.name} className="check small"><input type="checkbox" checked={cfg.layers.includes(l.name)} onChange={(e) => setCfg({ ...cfg, layers: e.target.checked ? [...cfg.layers, l.name] : cfg.layers.filter((x) => x !== l.name), draft: undefined })} /> <span className="mono">{l.name}</span> <span className="muted">{l.lines}</span></label>
          ))}
        </div>
        <label className="field small"><span>{tr('Drawing units')}</span>
          <select value={cfg.units} onChange={(e) => setCfg({ ...cfg, units: e.target.value as 'm' | 'mm', draft: undefined })}><option value="m">{tr('metres')}</option><option value="mm">{tr('millimetres')}</option></select>
        </label>
        {d.dxf.blocks.length > 0 && <>
          <h4>{tr('Symbols')}</h4>
          <table className="grid-table small">
            <thead><tr><th>{tr('Block')}</th><th>{tr('Count')}</th><th>{tr('Is')}</th></tr></thead>
            <tbody>{d.dxf.blocks.map((b) => <tr key={b.name}><td className="mono">{b.name}</td><td className="mono">{b.count}</td><td>
              <select value={cfg.symbols[b.name] ?? 'ignore'} onChange={(e) => setCfg({ ...cfg, symbols: { ...cfg.symbols, [b.name]: e.target.value as SymbolKind }, draft: undefined })} aria-label={`${b.name}`}>{SYMBOL_KINDS.map((k) => <option key={k} value={k}>{tr(SYMBOL_NAMES[k])}</option>)}</select>
            </td></tr>)}</tbody>
          </table>
        </>}
        <p className="small muted">{tr('Texts next to the lines give levels (IL, CL, RL; GL less 1.2 m cover) and sizes (DN…); levels not given are filled in from the neighbours.')}</p>
      </div>
      <div className="build-right">
        <button className="btn primary big" disabled={busy || !cfg.layers.length} onClick={buildPlan}>{draft ? tr('Read the plan again') : tr('Read the plan')}</button>
        {draft && (
          <>
            <div className="plan-preview card"><NetThumb net={draft.net} w={520} h={220} /><div className="small muted">{draft.notes.join(' · ')}</div></div>
            <h4>{tr('Open ends')}</h4>
            <table className="grid-table small">
              <thead><tr><th>{tr('Node')}</th><th>{tr('Level')}</th><th>{tr('Is')}</th><th /></tr></thead>
              <tbody>{draft.ends.map((id) => { const n = draft.net.nodes.find((x) => x.id === id)!; const r = cfg.roles[id] ?? { role: 'closed' as const }; return (
                <tr key={id}><td className="mono">{id}</td><td className="mono">{n.elev.toFixed(1)}</td>
                  <td><select value={r.role} onChange={(e) => setRole(id, e.target.value === 'source' ? { role: 'source', level: Math.round(n.elev + 10) } : e.target.value === 'demand' ? { role: 'demand', lps: 10 } : { role: 'closed' })} aria-label={`${id}`}><option value="closed">{tr('closed end')}</option><option value="source">{tr('source (reservoir or tank)')}</option><option value="demand">{tr('demand')}</option></select></td>
                  <td>{r.role === 'source' ? <label className="gap-num"><input type="number" value={r.level} onChange={(e) => setRole(id, { role: 'source', level: Number(e.target.value) })} aria-label={tr('Water level')} /><span className="small muted">m</span></label>
                    : r.role === 'demand' ? <label className="gap-num"><input type="number" value={r.lps} onChange={(e) => setRole(id, { role: 'demand', lps: Number(e.target.value) })} aria-label={tr('Demand')} /><span className="small muted">L/s</span></label> : null}</td></tr>); })}</tbody>
            </table>
            <button className="btn primary big" disabled={busy || !Object.values(cfg.roles).some((r) => r.role === 'source')} onClick={() => void finishPlan()}>{built ? tr('Build again') : tr('Build the model')}</button>
          </>
        )}
        {built && (
          <div className="verify card">
            <b>{tr('Checks')}</b>
            {built.verify.map((v, i) => <div key={i} className={`vrow ${v.ok ? 'v-ok' : 'v-warn'}`}><span>{v.ok ? '✓' : '!'}</span><div><b>{tr(v.what)}</b><span className="small">{v.detail}</span></div></div>)}
            <div className="small muted" style={{ marginTop: 6 }}>{built.notes.join(' · ')}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function ProtectStage({ S, plan, busy, onOpen, sizeVessel, canSize }: { S: IntakeSession; plan: (test: boolean) => Promise<void>; busy: boolean; onOpen: (net: Network, notes: string[], sizeVessel: boolean) => void; sizeVessel: () => Promise<void>; canSize: boolean }) {
  const [vessel, setVessel] = useState(true);
  useEffect(() => { if (S.built && !S.plan && !busy) void plan(false); }, [S.built]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!S.built) return <div className="empty">{tr('Build the model first.')}</div>;
  const net = S.built.net, b = S.built.basis, isNet = S.built.mode === 'network';
  const start = isNet ? (net.nodes.find((n) => n.kind === 'reservoir')?.id ?? net.nodes[0].id) : b.kind === 'pumped' ? 'PS-D' : 'R-UP';
  const ch = lineChainage(net, start);
  const rows = (S.plan ?? []).map((it) => ({ it, ch: chainageAt(net, ch, it.at) })).sort((a, b) => (a.ch ?? 1e9) - (b.ch ?? 1e9));
  const pumped = net.pumps.length > 0;
  const t = S.test;
  // the vessel sized here goes into the model that is opened
  const withVessel = (n: Network): Network => {
    const v = S.vessel;
    if (!v?.ok) return n;
    return { ...n, nodes: n.nodes.map((x) => (x.id === v.node ? { ...x, vessel: { n: 1.2, kIn: 2.5, kOut: 0.5, ...x.vessel, volume: v.volume, gasVolume: v.gasVolume, gasInput: 'volume' as const, connDiameter: v.connDiameter } } : x)) };
  };
  const vNote = S.vessel?.ok ? [`${tr('Air vessel')} ${S.vessel.volume} m³ ${tr('at')} ${S.vessel.node}`] : [];
  const sizeAfter = pumped && vessel && !S.vessel;
  const reasonsCell = (r: string[]): ReactNode => r.map((x, i) => <span key={i} className="pill">{tr(x)}</span>);
  return (
    <div className="intake-protect">
      {isNet ? <div className="plan-preview card"><NetThumb net={net} w={640} h={200} /></div> : <LongSection b={b} items={[...b.airValves.map((a) => ({ ch: a.chainage, z: profileLevel(b.profile, a.chainage), label: tr('Air valve on the drawings'), kind: 'drawing' as const })), ...rows.filter((r) => r.ch !== undefined && !r.it.existing).map((r) => ({ ch: r.ch!, z: r.it.z, label: `${tr('Proposed air valve')} CH ${r.ch!.toFixed(0)}: ${r.it.reasons.join(', ')}`, kind: 'plan' as const }))]} />}
      <div className="row" style={{ gap: 10, alignItems: 'center', margin: '8px 0' }}>
        <span className="ilegend small"><i className="lg drawing" />{tr('on the drawings')}</span><span className="ilegend small"><i className="lg plan" />{tr('proposed')}</span>
        <span style={{ flex: 1 }} />
        <button className="btn" disabled={busy} onClick={() => void plan(false)}>{tr('Plan again')}</button>
        <button className="btn primary" disabled={busy || !S.plan || !canSize} title={canSize ? undefined : tr('Part of SurgeSpace Pro (start an evaluation)')} onClick={() => void plan(true)}>{tr('Test the plan in surge runs')}</button>
      </div>
      <table className="grid-table small">
        <thead><tr><th>{isNet ? tr('Where') : tr('Chainage')}</th><th>{tr('Level')}</th><th>{tr('Why')}</th><th>{tr('Type')}</th><th>{tr('Large orifice')}</th><th>{tr('Drain / fill flow')}</th></tr></thead>
        <tbody>{rows.map(({ it, ch: c }) => <tr key={it.id} className={it.existing ? 'muted' : ''}><td className="mono">{isNet ? ('node' in it.at ? it.at.node : `${it.at.pipe} @ ${it.at.s.toFixed(0)} m`) : c !== undefined ? c.toFixed(0) : '—'}</td><td className="mono">{it.z.toFixed(1)}</td><td>{reasonsCell(it.reasons)}</td><td>{it.existing ? tr('existing') : it.type === 'threeStage' ? tr('anti-slam (three-stage)') : tr('double orifice')}</td><td className="mono">DN{Math.round(it.inDiameter * 1000)}</td><td className="mono">{(it.qDrain * 1000).toFixed(0)} / {(it.qFill * 1000).toFixed(0)} L/s</td></tr>)}</tbody>
      </table>
      {t && (
        <div className="test-cmp">
          <div className="card"><span className="small muted">{tr('Without the new air valves')}</span><b className="mono">{t.before.minPressure.toFixed(1)} m</b><span className="small">{tr('lowest pressure')} · {t.before.at}</span><span className="small">{tr('largest vapour cavity')} {(t.before.cavity * 1000).toFixed(0)} L · {t.before.slams} {tr('air valve slams')}</span></div>
          <div className="arrow">→</div>
          <div className="card good"><span className="small muted">{tr('With the plan')}</span><b className="mono">{t.after.minPressure.toFixed(1)} m</b><span className="small">{tr('lowest pressure')} · {t.after.at}</span><span className="small">{tr('largest vapour cavity')} {(t.after.cavity * 1000).toFixed(0)} L · {t.after.slams} {tr('air valve slams')}</span>{t.antiSlam.length > 0 && <span className="small muted">{tr('anti-slam (three-stage) where the run showed a slam')}: {t.antiSlam.join(', ')}</span>}</div>
        </div>
      )}
      {pumped && (
        <div className="vessel-row card">
          <div><b>{tr('Air vessel at the pump discharge')}</b><span className="small muted">{tr('The smallest vessel that keeps every point above the minimum pressure and within class after the pumps trip, with the air valve plan in place.')}</span></div>
          {S.vessel ? <div className="vessel-res mono">{S.vessel.ok ? '✓' : '!'} {S.vessel.volume} m³ · {tr('gas')} {S.vessel.gasVolume} m³ · DN{Math.round(S.vessel.connDiameter * 1000)} · {tr('lowest pressure')} {S.vessel.minPressure.toFixed(1)} m<span className="small muted">{S.vessel.message}</span></div> : null}
          <button className="btn" disabled={busy || !canSize} title={canSize ? undefined : tr('Part of SurgeSpace Pro (start an evaluation)')} onClick={() => void sizeVessel()}>{S.vessel ? tr('Size again') : tr('Size the air vessel')}</button>
        </div>
      )}
      <div className="open-row">
        {pumped && !S.vessel && <label className="check"><input type="checkbox" checked={vessel} onChange={(e) => setVessel(e.target.checked)} /> {tr('Size an air vessel at the pump discharge after opening')}</label>}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={() => onOpen(withVessel(net), [...S.built!.notes, ...vNote, tr('Air valves from the plan not added')], sizeAfter)}>{tr('Open without the plan')}</button>
        <button className="btn primary big" disabled={!S.plan} onClick={() => void (async () => {
          const n = S.plan!.filter((p) => !p.existing).length;
          if (t) { onOpen(withVessel(t.net), [...S.built!.notes, ...vNote, `${n} ${tr('air valves from the plan, tested in surge runs')}`], sizeAfter); return; }
          const { applyAirValvePlan } = await import('../app/airValvePlan');
          onOpen(withVessel(applyAirValvePlan(net, S.plan!).net), [...S.built!.notes, ...vNote, `${n} ${tr('air valves from the plan (not yet tested in surge runs)')}`], sizeAfter);
        })()}>{t ? tr('Open the model with the tested plan') : tr('Open the model')}</button>
      </div>
    </div>
  );
}
