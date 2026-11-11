// Model from documents: drop the drawings, long sections, data sheets, spreadsheets or DXF; the AI reads them into
// an evidence register that the engineer reviews against the page; what is missing is asked for; the model is
// built, checked against the documents, and protected (air valve plan tested in surge runs, air vessel sizing).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAI, activeConfig } from '../ai/accounts';
import { buildBasis, buildFromBasis, chainageAt, findGaps, lineChainage, newId, readDocument, sheetEvidence, verifyModel, EV_TYPES, type BuildBasis, type Evidence, type EvType, type Gap, type IntakeDoc, type VerifyItem } from '../app/intake';
import type { AirValvePlanItem } from '../app/airValvePlan';
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
  built?: { net: Network; notes: string[]; verify: VerifyItem[]; basis: BuildBasis };
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

export function IntakeWorkspace({ session, setSession, onClose, onOpenAccounts, onOpen }: {
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
  useEffect(() => { setSession((s) => ({ ...s, gaps: findGaps(s.evidence, s.gaps) })); }, [S.evidence, setSession]);
  const openCritical = S.gaps.filter((g) => g.critical && g.status === 'open');
  const basis = useMemo(() => buildBasis(S.evidence, S.gaps, S.docs), [S.evidence, S.gaps, S.docs]);

  const build = async () => {
    setBusy(tr('Building the model…')); setErr(null);
    try {
      const { net, notes } = await buildFromBasis(basis, S.name);
      const net2 = { ...net, sources: basis.trace };
      setBusy(tr('Checking it against the documents…'));
      const verify = await verifyModel(net2, basis);
      set({ built: { net: net2, notes, verify, basis }, plan: undefined, test: undefined });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
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
        {stage === 'build' && <BuildStage S={S} basis={basis} build={build} busy={!!busy} />}
        {stage === 'protect' && <ProtectStage S={S} plan={plan} busy={!!busy} onOpen={onOpen} />}
      </div>
      <footer className="intake-foot">
        <span className="small muted">{S.docs.length} {tr('documents')} · {S.evidence.filter((e) => e.status !== 'rejected').length} {tr('items')} · {S.gaps.filter((g) => g.status === 'open').length} {tr('open questions')}</span>
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
            {S.built.verify.map((v, i) => <div key={i} className={`vrow ${v.ok ? 'ok' : 'bad'}`}><span>{v.ok ? '✓' : '!'}</span><div><b>{tr(v.what)}</b><span className="small">{v.detail}</span></div></div>)}
            <div className="small muted" style={{ marginTop: 6 }}>{S.built.notes.join(' · ')}</div>
          </div>
        )}
      </div>
    </div>
  );
}
const profileLevel = (p: [number, number][], ch: number) => { for (let k = 0; k + 1 < p.length; k++) if (ch >= p[k][0] && ch <= p[k + 1][0]) return p[k][1] + ((ch - p[k][0]) / (p[k + 1][0] - p[k][0] || 1)) * (p[k + 1][1] - p[k][1]); return p[p.length - 1]?.[1] ?? 0; };

function ProtectStage({ S, plan, busy, onOpen }: { S: IntakeSession; plan: (test: boolean) => Promise<void>; busy: boolean; onOpen: (net: Network, notes: string[], sizeVessel: boolean) => void }) {
  const [vessel, setVessel] = useState(true);
  useEffect(() => { if (S.built && !S.plan && !busy) void plan(false); }, [S.built]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!S.built) return <div className="empty">{tr('Build the model first.')}</div>;
  const net = S.built.net, b = S.built.basis;
  const start = b.kind === 'pumped' ? 'PS-D' : 'R-UP';
  const ch = lineChainage(net, start);
  const rows = (S.plan ?? []).map((it) => ({ it, ch: chainageAt(net, ch, it.at) })).sort((a, b) => (a.ch ?? 1e9) - (b.ch ?? 1e9));
  const pumped = net.pumps.length > 0;
  const t = S.test;
  const reasonsCell = (r: string[]): ReactNode => r.map((x, i) => <span key={i} className="pill">{tr(x)}</span>);
  return (
    <div className="intake-protect">
      <LongSection b={b} items={[...b.airValves.map((a) => ({ ch: a.chainage, z: profileLevel(b.profile, a.chainage), label: tr('Air valve on the drawings'), kind: 'drawing' as const })), ...rows.filter((r) => r.ch !== undefined && !r.it.existing).map((r) => ({ ch: r.ch!, z: r.it.z, label: `${tr('Proposed air valve')} CH ${r.ch!.toFixed(0)}: ${r.it.reasons.join(', ')}`, kind: 'plan' as const }))]} />
      <div className="row" style={{ gap: 10, alignItems: 'center', margin: '8px 0' }}>
        <span className="ilegend small"><i className="lg drawing" />{tr('on the drawings')}</span><span className="ilegend small"><i className="lg plan" />{tr('proposed')}</span>
        <span style={{ flex: 1 }} />
        <button className="btn" disabled={busy} onClick={() => void plan(false)}>{tr('Plan again')}</button>
        <button className="btn primary" disabled={busy || !S.plan} onClick={() => void plan(true)}>{tr('Test the plan in surge runs')}</button>
      </div>
      <table className="grid-table small">
        <thead><tr><th>{tr('Chainage')}</th><th>{tr('Level')}</th><th>{tr('Why')}</th><th>{tr('Type')}</th><th>{tr('Large orifice')}</th><th>{tr('Drain / fill flow')}</th></tr></thead>
        <tbody>{rows.map(({ it, ch: c }) => <tr key={it.id} className={it.existing ? 'muted' : ''}><td className="mono">{c !== undefined ? c.toFixed(0) : '—'}</td><td className="mono">{it.z.toFixed(1)}</td><td>{reasonsCell(it.reasons)}</td><td>{it.existing ? tr('existing') : it.type === 'threeStage' ? tr('anti-slam (three-stage)') : tr('double orifice')}</td><td className="mono">DN{Math.round(it.inDiameter * 1000)}</td><td className="mono">{(it.qDrain * 1000).toFixed(0)} / {(it.qFill * 1000).toFixed(0)} L/s</td></tr>)}</tbody>
      </table>
      {t && (
        <div className="test-cmp">
          <div className="card"><span className="small muted">{tr('Without the new air valves')}</span><b className="mono">{t.before.minPressure.toFixed(1)} m</b><span className="small">{tr('lowest pressure')} · {t.before.at}</span><span className="small">{tr('largest vapour cavity')} {(t.before.cavity * 1000).toFixed(0)} L · {t.before.slams} {tr('air valve slams')}</span></div>
          <div className="arrow">→</div>
          <div className="card good"><span className="small muted">{tr('With the plan')}</span><b className="mono">{t.after.minPressure.toFixed(1)} m</b><span className="small">{tr('lowest pressure')} · {t.after.at}</span><span className="small">{tr('largest vapour cavity')} {(t.after.cavity * 1000).toFixed(0)} L · {t.after.slams} {tr('air valve slams')}</span>{t.antiSlam.length > 0 && <span className="small muted">{tr('anti-slam (three-stage) where the run showed a slam')}: {t.antiSlam.join(', ')}</span>}</div>
        </div>
      )}
      <div className="open-row">
        {pumped && <label className="check"><input type="checkbox" checked={vessel} onChange={(e) => setVessel(e.target.checked)} /> {tr('Size an air vessel at the pump discharge after opening')}</label>}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={() => onOpen(net, [...S.built!.notes, tr('Air valves from the plan not added')], pumped && vessel)}>{tr('Open without the plan')}</button>
        <button className="btn primary big" disabled={!S.plan} onClick={() => void (async () => {
          const n = S.plan!.filter((p) => !p.existing).length;
          if (t) { onOpen(t.net, [...S.built!.notes, `${n} ${tr('air valves from the plan, tested in surge runs')}`], pumped && vessel); return; }
          const { applyAirValvePlan } = await import('../app/airValvePlan');
          onOpen(applyAirValvePlan(net, S.plan!).net, [...S.built!.notes, `${n} ${tr('air valves from the plan (not yet tested in surge runs)')}`], pumped && vessel);
        })()}>{t ? tr('Open the model with the tested plan') : tr('Open the model')}</button>
      </div>
    </div>
  );
}
