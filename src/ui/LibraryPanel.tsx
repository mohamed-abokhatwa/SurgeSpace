// Library panel: save the selected element's data, apply a saved type to the selection, share as a file.
import { useState } from 'react';
import { addItem, allItems, applyItem, exportItems, importItems, removeItem, useLibrary, type LibKind } from '../app/library';
import type { ElRef } from '../app/edit';
import type { Network } from '../engine/types';
import { download } from './util';

type SetNet = (f: (n: Network) => Network, label?: string) => void;
const KIND_NAME: Record<LibKind, string> = { pump: 'Pumps', valve: 'Valves', airValve: 'Air valves', vessel: 'Air vessels', pipe: 'Pipe types' };

export function LibraryPanel({ net, setNet, selected, onToast }: { net: Network; setNet: SetNet; selected: ElRef[]; onToast: (m: string[]) => void }) {
  const user = useLibrary();
  const [q, setQ] = useState('');
  const sel = selected[0];
  const node = sel?.type === 'node' ? net.nodes.find((n) => n.id === sel.id) : undefined;
  const saveables: { kind: LibKind; label: string; src: object }[] = [];
  if (sel?.type === 'pump') { const p = net.pumps.find((x) => x.id === sel.id); if (p) saveables.push({ kind: 'pump', label: `pump ${p.id}`, src: p }); }
  if (sel?.type === 'valve') { const v = net.valves.find((x) => x.id === sel.id); if (v) saveables.push({ kind: 'valve', label: `valve ${v.id}`, src: v }); }
  if (sel?.type === 'pipe') { const p = net.pipes.find((x) => x.id === sel.id); if (p) saveables.push({ kind: 'pipe', label: `pipe ${p.id}`, src: p }); }
  if (node?.airValve) saveables.push({ kind: 'airValve', label: `air valve at ${node.id}`, src: node.airValve });
  if (node?.vessel) saveables.push({ kind: 'vessel', label: `air vessel at ${node.id}`, src: node.vessel });
  const targetIds = (kind: LibKind) => selected.filter((r) => (kind === 'pump' ? r.type === 'pump' : kind === 'valve' ? r.type === 'valve' : kind === 'pipe' ? r.type === 'pipe' : r.type === 'node')).map((r) => r.id);
  const list = allItems(user).filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="library">
      {saveables.map((s) => (
        <button key={s.kind} className="btn small" style={{ marginBottom: 6, width: '100%' }} onClick={() => { const name = window.prompt(`Name for this ${KIND_NAME[s.kind].toLowerCase().replace(/s$/, '')}`, s.label); if (name) { addItem(s.kind, name, s.src as never); onToast([`Saved “${name}” to your library.`]); } }}>Save {s.label} to the library</button>
      ))}
      {!saveables.length && <p className="small muted" style={{ marginTop: 0 }}>Select a pump, valve, pipe or a node with an air valve or vessel to save its data. Select elements, then press Apply on a library entry.</p>}
      <input className="search small" placeholder="Search the library…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', marginBottom: 6 }} />
      {(Object.keys(KIND_NAME) as LibKind[]).map((k) => {
        const its = list.filter((i) => i.kind === k);
        if (!its.length) return null;
        const ids = targetIds(k);
        return (
          <div key={k}>
            <div className="label">{KIND_NAME[k]}</div>
            {its.map((i) => (
              <div key={i.id} className="row small" style={{ gap: 4, padding: '3px 0', borderBottom: '1px solid var(--line)' }}>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }} title={i.note ?? i.name}>{i.name}</span>
                <button className="btn ghost small" disabled={!ids.length} title={ids.length ? `Apply to ${ids.join(', ')}` : 'Select elements first'} onClick={() => setNet((n) => applyItem(n, i, ids), `Library: ${i.name}`)}>Apply{ids.length > 1 ? ` (${ids.length})` : ''}</button>
                {!i.id.startsWith('g-') && <button className="btn ghost small" onClick={() => removeItem(i.id)} aria-label={`Remove ${i.name}`}>×</button>}
              </div>
            ))}
          </div>
        );
      })}
      <div className="row" style={{ gap: 6, marginTop: 10 }}>
        <button className="btn small" disabled={!user.length} onClick={() => download('surgespace-library.json', exportItems(), 'application/json')}>Export…</button>
        <button className="btn small" onClick={() => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.json'; i.onchange = () => i.files?.[0]?.text().then((t) => { try { onToast([`${importItems(t)} library entries added.`]); } catch { onToast(['That file is not a SurgeSpace library.']); } }); i.click(); }}>Import…</button>
      </div>
    </div>
  );
}
