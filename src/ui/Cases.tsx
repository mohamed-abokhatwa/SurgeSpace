// Cases: named variants of the model (with / without a vessel, different closure times, future demand…).
// Each case is a complete copy, so it can be edited, run and compared on its own. Run all → side-by-side table.
import { useState } from 'react';
import type { Network } from '../engine/types';
import type { TransientResult } from '../engine/transient';
import type { Check } from '../engine/analysis';
import { callParallel } from './client';
import { fmtQ, useUnits } from '../app/units';

export interface CaseSummary { id: string; name: string; maxHead: number; maxP: number; minP: number; cavity: number; slams: number; fails: number; warns: number; runtime: number; error?: string }

type Model = Omit<Network, 'cases' | 'activeCase'>;
export { ensureCases, syncActive, switchCase, addCase } from '../app/cases';
import { ensureCases, syncActive, switchCase, addCase } from '../app/cases';

/** What differs between two models, in words (first few). */
export function diffModels(a: Model, b: Model): string[] {
  const out: string[] = [];
  const cmp = <T extends { id: string }>(la: T[], lb: T[], what: string) => {
    const ma = new Map(la.map((x) => [x.id, JSON.stringify(x)]));
    const mb = new Map(lb.map((x) => [x.id, JSON.stringify(x)]));
    let changed = 0, added = 0, removed = 0;
    mb.forEach((v, k) => { if (!ma.has(k)) added++; else if (ma.get(k) !== v) changed++; });
    ma.forEach((_v, k) => { if (!mb.has(k)) removed++; });
    if (changed) out.push(`${changed} ${what} changed`);
    if (added) out.push(`${added} ${what} added`);
    if (removed) out.push(`${removed} ${what} removed`);
  };
  cmp(a.nodes, b.nodes, 'nodes');
  cmp(a.pipes, b.pipes, 'pipes');
  cmp(a.pumps, b.pumps, 'pumps');
  cmp(a.valves, b.valves, 'valves');
  if (JSON.stringify([a.event, a.extraEvents ?? []]) !== JSON.stringify([b.event, b.extraEvents ?? []])) out.push('operations differ');
  if (JSON.stringify(a.settings) !== JSON.stringify(b.settings)) out.push('run setup differs');
  return out;
}

export function summarize(net: Model, r: TransientResult, checks: Check[]): Omit<CaseSummary, 'id' | 'name'> {
  let maxH = -Infinity, maxP = -Infinity, minP = Infinity, cav = 0;
  for (const e of r.envelopes) for (let i = 0; i < e.s.length; i++) { maxH = Math.max(maxH, e.hMax[i]); maxP = Math.max(maxP, e.hMax[i] - e.z[i]); minP = Math.min(minP, e.hMin[i] - e.z[i]); cav = Math.max(cav, e.cavMax[i]); }
  void net;
  return { maxHead: maxH, maxP, minP, cavity: cav, slams: (r.slams ?? []).filter((s) => s.joukowsky >= 0.5).length, fails: checks.filter((c) => c.level === 'fail').length, warns: checks.filter((c) => c.level === 'warn').length, runtime: r.runtimeMs };
}

export function CasesPanel({ net, setProject, busy, setBusy, onResults }: { net: Network; setProject: (n: Network, label: string) => void; busy: boolean; setBusy: (b: string | null) => void; onResults?: (r: { id: string; name: string; envelopes: TransientResult['envelopes'] }[]) => void }) {
  const units = useUnits();
  const [rows, setRows] = useState<CaseSummary[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const cases = net.cases ?? [];
  const synced = syncActive(net);
  const base = synced[0];
  const runAll = async () => {
    const list = syncActive(ensureCases(net));
    // cases run side by side on the spare processor cores
    setBusy(`Running ${list.length} cases…`);
    const res = await callParallel<{ result: TransientResult; checks: Check[] }>(list.map((c) => ({ type: 'run' as const, net: c.model as Network })), (d, n) => setBusy(`Running cases: ${d} of ${n} done…`));
    const out: CaseSummary[] = list.map((c, k) => {
      const o = res[k];
      return o instanceof Error
        ? { id: c.id, name: c.name, maxHead: NaN, maxP: NaN, minP: NaN, cavity: NaN, slams: 0, fails: 0, warns: 0, runtime: 0, error: o.message }
        : { id: c.id, name: c.name, ...summarize(c.model, o.result, o.checks) };
    });
    setRows(out);
    onResults?.(list.map((c, k) => ({ id: c.id, name: c.name, envelopes: res[k] instanceof Error ? [] : (res[k] as { result: TransientResult }).result.envelopes })));
    setBusy(null);
  };
  const best = (f: (r: CaseSummary) => number, lo = true) => { if (!rows) return null; const ok = rows.filter((r) => Number.isFinite(f(r))); if (!ok.length) return null; return ok.reduce((a, b) => ((lo ? f(b) < f(a) : f(b) > f(a)) ? b : a)).id; };
  return (
    <div className="cases">
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <button className="btn small primary" onClick={() => setProject(addCase(net, `Case ${cases.length + 1 || 2}`), 'New case')}>+ New case from current</button>
        <button className="btn small" disabled={busy} onClick={runAll}>Run all cases and compare</button>
      </div>
      {!cases.length && <p className="hint">You are editing a single model. “New case” keeps it as the <b>Base case</b> and starts a copy you can change — for example add an air vessel, slow the valve, or trip one pump instead of two. Every case is saved in the project file.</p>}
      {cases.length > 0 && (
        <table className="grid cases-table">
          <thead><tr><th></th><th>Case</th><th>Differs from {base?.name ?? 'base'}</th><th>Notes</th><th></th></tr></thead>
          <tbody>{synced.map((c, k) => (
            <tr key={c.id} className={c.id === net.activeCase ? 'sel' : ''}>
              <td><input type="radio" checked={c.id === net.activeCase} onChange={() => setProject(switchCase(net, c.id), 'Switch case')} aria-label={`Edit ${c.name}`} /></td>
              <td>{editing === c.id ? <input className="cell" autoFocus defaultValue={c.name} onBlur={(e) => { setEditing(null); setProject({ ...net, cases: syncActive(net).map((x) => (x.id === c.id ? { ...x, name: e.target.value || x.name } : x)) }, 'Rename case'); }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} /> : <button className="linkbtn" onDoubleClick={() => setEditing(c.id)} onClick={() => c.id !== net.activeCase && setProject(switchCase(net, c.id), 'Switch case')} title="Click to edit this case, double-click to rename"><b>{c.name}</b></button>}</td>
              <td className="small muted">{k === 0 ? 'reference' : diffModels(base.model, c.model).join(' · ') || 'identical'}</td>
              <td><input className="cell" defaultValue={c.notes ?? ''} placeholder="notes" onBlur={(e) => setProject({ ...net, cases: syncActive(net).map((x) => (x.id === c.id ? { ...x, notes: e.target.value || undefined } : x)) }, 'Case notes')} /></td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn ghost small" title="Duplicate" onClick={() => { const cs = syncActive(net); const id = Math.random().toString(36).slice(2, 9); setProject({ ...net, cases: [...cs, { id, name: `${c.name} (copy)`, notes: c.notes, model: structuredClone(c.model) }] }, 'Duplicate case'); }}>⧉</button>
                {k > 0 && <button className="btn ghost small" title="Delete" onClick={() => { const cs = syncActive(net).filter((x) => x.id !== c.id); if (c.id === net.activeCase) setProject({ ...structuredClone(cs[0].model), cases: cs, activeCase: cs[0].id } as Network, 'Delete case'); else setProject({ ...net, cases: cs }, 'Delete case'); }}>✕</button>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {rows && (
        <>
          <div className="label" style={{ marginTop: 14 }}>Comparison</div>
          <table className="grid cases-table">
            <thead><tr><th>Case</th><th>Highest pressure</th><th>Lowest pressure</th><th>Highest head</th><th>Largest cavity</th><th>Slams</th><th>Checks to fix</th><th>Run time</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td><b>{r.name}</b>{r.error && <div className="small bad">{r.error}</div>}</td>
                <td className={`num ${best((x) => x.maxP) === r.id ? 'best' : ''}`}>{fmtQ(r.maxP, 'pressureHead', 1, units)}</td>
                <td className={`num ${best((x) => x.minP, false) === r.id ? 'best' : ''}`}>{fmtQ(r.minP, 'pressureHead', 1, units)}</td>
                <td className="num">{fmtQ(r.maxHead, 'head', 1, units)}</td>
                <td className={`num ${best((x) => x.cavity) === r.id ? 'best' : ''}`}>{Number.isFinite(r.cavity) ? `${(r.cavity * 1000).toFixed(1)} L` : '—'}</td>
                <td className="num">{r.slams}</td>
                <td className={`num ${r.fails ? 'bad' : 'good'}`}>{r.fails}{r.warns ? ` (+${r.warns} warn)` : ''}</td>
                <td className="num">{(r.runtime / 1000).toFixed(2)} s</td>
              </tr>
            ))}</tbody>
          </table>
          <p className="hint">Best value in each column is highlighted. Click a case above to open it, then run it to see its map and profiles.</p>
        </>
      )}
    </div>
  );
}
