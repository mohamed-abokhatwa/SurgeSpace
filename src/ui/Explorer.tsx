// Model Explorer: every element grouped by type, with counts and a filter; click to select and zoom.
import { useMemo, useState } from 'react';
import type { Network } from '../engine/types';
import { explorerGroups } from '../app/elements';
import type { ElRef } from '../app/edit';
import { ElIcon } from './Icons';

export function Explorer({ net, selected, onSelect }: { net: Network; selected: ElRef[]; onSelect: (r: ElRef[], additive?: boolean) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>(() => ({ pipe: net.pipes.length <= 30, junction: net.nodes.length <= 20 }));
  const groups = useMemo(() => explorerGroups(net), [net]);
  const sel = new Set(selected.map((r) => `${r.type}:${r.id}`));
  const ql = q.trim().toLowerCase();
  return (
    <div className="explorer">
      <input className="search small" placeholder="Filter elements…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter elements" />
      <div className="tree">
        {groups.map((g) => {
          const items = ql ? g.items.filter((i) => i.id.toLowerCase().includes(ql)) : g.items;
          if (!g.items.length && (ql || !['junction', 'reservoir', 'pipe'].includes(g.kind))) return null;
          const isOpen = ql ? items.length > 0 : !!open[g.key];
          return (
            <div key={g.key} className="tree-group">
              <div className="tree-head" role="button" tabIndex={0} onClick={() => setOpen((o) => ({ ...o, [g.key]: !isOpen }))} onKeyDown={(e) => e.key === 'Enter' && setOpen((o) => ({ ...o, [g.key]: !isOpen }))}>
                <span className={`caret ${isOpen ? 'open' : ''}`}>›</span>
                <ElIcon kind={g.kind} size={16} />
                <span className="tree-label">{g.label}</span>
                <span className="tree-count">{ql ? `${items.length}/${g.items.length}` : g.items.length}</span>
                {g.items.length > 0 && <button className="tree-all" title="Select all of this type" onClick={(e) => { e.stopPropagation(); onSelect(g.items.map(({ type, id }) => ({ type, id }))); }}>all</button>}
              </div>
              {isOpen && (
                <div className="tree-items">
                  {items.slice(0, 500).map((i) => (
                    <button key={`${i.type}:${i.id}`} className={`tree-item ${sel.has(`${i.type}:${i.id}`) ? 'on' : ''}`} onClick={(e) => onSelect([{ type: i.type, id: i.id }], e.shiftKey || e.ctrlKey || e.metaKey)}>
                      {i.id}{i.sub ? <em> {i.sub}</em> : null}
                    </button>
                  ))}
                  {items.length > 500 && <div className="hint">{items.length - 500} more — use the filter.</div>}
                  {!items.length && <div className="hint">None.</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
