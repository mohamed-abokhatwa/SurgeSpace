import { tr } from '../app/i18n';
// Menu bar (File, Edit, View, Model, Analysis, Results, Tools, Help) with keyboard shortcuts shown,
// and the tool ribbon below it.
import { useEffect, useRef, useState, type ReactNode } from 'react';

export type MenuItem =
  | { label: string; shortcut?: string; action?: () => void; disabled?: boolean; checked?: boolean; hint?: string; sub?: MenuItem[] }
  | 'sep';
export interface Menu { label: string; items: MenuItem[] }

export function MenuBar({ menus, right }: { menus: Menu[]; right?: ReactNode }) {
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open === null) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(null); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <div className="menubar" ref={ref} role="menubar">
      {menus.map((m, i) => (
        <div key={m.label} className="menu-root">
          <button className={`menu-btn ${open === i ? 'on' : ''}`} role="menuitem" aria-haspopup="true" aria-expanded={open === i}
            onMouseDown={(e) => { e.preventDefault(); setOpen(open === i ? null : i); }}
            onMouseEnter={() => open !== null && setOpen(i)}>{tr(m.label)}</button>
          {open === i && <MenuList items={m.items} onDone={() => setOpen(null)} />}
        </div>
      ))}
      <div style={{ flex: 1 }} />
      {right}
    </div>
  );
}

function MenuList({ items, onDone }: { items: MenuItem[]; onDone: () => void }) {
  const [sub, setSub] = useState<number | null>(null);
  return (
    <div className="menu-list" role="menu">
      {items.map((it, k) => it === 'sep' ? <div key={k} className="menu-sep" /> : (
        <div key={k} className="menu-item-wrap" onMouseEnter={() => setSub(it.sub ? k : null)}>
          <button className="menu-item" role="menuitem" disabled={it.disabled} title={it.hint}
            onClick={() => { if (it.sub) { setSub(k); return; } it.action?.(); onDone(); }}>
            <span className="menu-check">{it.checked ? '✓' : ''}</span>
            <span className="menu-label">{tr(it.label)}</span>
            <span className="menu-kbd">{it.sub ? '›' : it.shortcut ?? ''}</span>
          </button>
          {it.sub && sub === k && <div className="menu-sub"><MenuList items={it.sub} onDone={onDone} /></div>}
        </div>
      ))}
    </div>
  );
}

/** Small popup menu at a screen position (right-click on the drawing). */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', key); };
  }, [onClose]);
  const left = Math.min(x, window.innerWidth - 250), top = Math.min(y, window.innerHeight - 30 * items.length - 20);
  return <div ref={ref} className="context-menu" style={{ left, top }}><MenuList items={items} onDone={onClose} /></div>;
}
