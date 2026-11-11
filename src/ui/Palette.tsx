// Command palette (Ctrl+K): every menu command, every element and the copilot tasks, by typing part of the name.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Network } from '../engine/types';
import type { ElRef } from '../app/edit';
import type { Menu, MenuItem } from './MenuBar';
import { tr } from '../app/i18n';

interface Item { label: string; path: string; kind: 'command' | 'element'; shortcut?: string; run: () => void }

/** Score how well the query matches (all words present, earlier and denser matches first); -1 = no match. */
export function score(text: string, q: string): number {
  const t = text.toLowerCase(), words = q.toLowerCase().split(/\s+/).filter(Boolean);
  let s = 0;
  for (const w of words) {
    const i = t.indexOf(w);
    if (i < 0) {
      // letters in order (initials)
      let k = 0;
      for (const ch of t) if (ch === w[k]) k++;
      if (k < w.length) return -1;
      s += 30;
    } else s += i === 0 ? 0 : t[i - 1] === ' ' ? 4 : 10;
  }
  return s + t.length * 0.05;
}

export function Palette({ menus, net, onGo, onClose }: { menus: Menu[]; net: Network; onGo: (r: ElRef) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [k, setK] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const items = useMemo(() => {
    const out: Item[] = [];
    const walk = (it: MenuItem[], path: string) => {
      for (const m of it) {
        if (m === 'sep' || m.disabled) continue;
        if (m.sub) walk(m.sub, `${path} › ${m.label}`);
        else if (m.action) out.push({ label: m.label, path, kind: 'command', shortcut: m.shortcut, run: m.action });
      }
    };
    for (const m of menus) walk(m.items, m.label);
    for (const n of net.nodes) out.push({ label: n.id, path: n.kind === 'reservoir' ? 'Source' : 'Junction', kind: 'element', run: () => onGo({ type: 'node', id: n.id }) });
    for (const p of net.pipes) out.push({ label: p.id, path: `Pipe · ${Math.round(p.length)} m · DN${Math.round(p.diameter * 1000)}`, kind: 'element', run: () => onGo({ type: 'pipe', id: p.id }) });
    for (const p of net.pumps) out.push({ label: p.id, path: 'Pump', kind: 'element', run: () => onGo({ type: 'pump', id: p.id }) });
    for (const v of net.valves) out.push({ label: v.id, path: v.turbine ? 'Turbine' : 'Valve', kind: 'element', run: () => onGo({ type: 'valve', id: v.id }) });
    return out;
  }, [menus, net, onGo]);
  const shown = useMemo(() => {
    if (!q.trim()) return items.filter((i) => i.kind === 'command').slice(0, 60);
    return items.map((i) => ({ i, s: Math.min(score(`${i.label}`, q), score(`${i.path} ${i.label}`, q) + 6) })).filter((x) => x.s >= 0).sort((a, b) => a.s - b.s).slice(0, 60).map((x) => x.i);
  }, [items, q]);
  useEffect(() => { setK(0); }, [q]);
  useEffect(() => { list.current?.querySelector('.pal-item.on')?.scrollIntoView({ block: 'nearest' }); }, [k]);
  const choose = (it: Item | undefined) => { if (!it) return; onClose(); setTimeout(it.run, 0); };
  return (
    <div className="pal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pal card" role="dialog" aria-label="Command palette">
        <input ref={input} className="pal-in" placeholder={tr('Type a command, an element id or a setting…')} value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); onClose(); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); setK((x) => Math.min(x + 1, shown.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setK((x) => Math.max(x - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); choose(shown[k]); }
          }} aria-activedescendant={`pal-${k}`} />
        <div className="pal-list" ref={list} role="listbox">
          {shown.map((it, i) => (
            <div key={`${it.kind}:${it.path}:${it.label}`} id={`pal-${i}`} role="option" aria-selected={i === k} className={`pal-item ${i === k ? 'on' : ''}`} onMouseMove={() => setK(i)} onMouseDown={(e) => { e.preventDefault(); choose(it); }}>
              <span className={`pal-kind ${it.kind}`}>{it.kind === 'element' ? '◆' : '›'}</span>
              <span className="pal-label">{tr(it.label)}</span>
              <span className="pal-path">{it.path}</span>
              {it.shortcut && <kbd>{it.shortcut}</kbd>}
            </div>
          ))}
          {!shown.length && <div className="pal-empty muted small">{tr('Nothing matches. Try fewer letters.')}</div>}
        </div>
        <div className="pal-foot small muted"><span><kbd>↑</kbd><kbd>↓</kbd> {tr('move')}</span><span><kbd>Enter</kbd> {tr('run')}</span><span><kbd>Esc</kbd> {tr('close')}</span></div>
      </div>
    </div>
  );
}
