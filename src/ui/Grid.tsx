import { useRef } from 'react';
import { parseTable } from '../engine/importers';

export interface Col<T> {
  key: string;
  label: string;
  get: (r: T) => string | number | boolean | undefined;
  set?: (r: T, v: string) => T;
  type?: 'text' | 'num' | 'bool' | 'select';
  options?: string[];
  width?: number;
}

/** Editable table. Paste a block from Excel into any cell: it fills right and down, adding rows as needed. */
export function Grid<T>({ rows, cols, onChange, onAdd, onDelete, selected, onSelectRow, newRow }: {
  rows: T[];
  cols: Col<T>[];
  onChange: (rows: T[]) => void;
  onAdd?: () => void;
  onDelete?: (i: number) => void;
  selected?: number;
  onSelectRow?: (i: number) => void;
  newRow?: (i: number) => T;
}) {
  const tbl = useRef<HTMLTableElement>(null);
  const update = (i: number, c: Col<T>, v: string) => {
    if (!c.set) return;
    const next = rows.slice();
    next[i] = c.set(next[i], v);
    onChange(next);
  };
  const onPaste = (e: React.ClipboardEvent, ri: number, ci: number) => {
    const text = e.clipboardData.getData('text');
    if (!text.includes('\t') && !text.includes('\n')) return; // a single value: let the input handle it
    e.preventDefault();
    const block = parseTable(text);
    const next = rows.slice();
    block.forEach((cells, dr) => {
      const i = ri + dr;
      if (i >= next.length) {
        if (!newRow) return;
        next.push(newRow(i));
      }
      cells.forEach((v, dc) => {
        const c = cols[ci + dc];
        if (c?.set) next[i] = c.set(next[i], v);
      });
    });
    onChange(next);
  };
  return (
    <div>
      <div style={{ overflow: 'auto', maxHeight: 360, border: '1px solid var(--line)', borderRadius: 8 }}>
        <table className="grid" ref={tbl}>
          <thead>
            <tr>
              {cols.map((c) => <th key={c.key} style={{ minWidth: c.width }}>{c.label}</th>)}
              {onDelete && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={selected === i ? 'sel' : ''} onClick={() => onSelectRow?.(i)}>
                {cols.map((c, ci) => {
                  const v = c.get(r);
                  if (c.type === 'bool')
                    return <td key={c.key}><input type="checkbox" checked={!!v} onChange={(e) => update(i, c, e.target.checked ? '1' : '0')} /></td>;
                  if (c.type === 'select')
                    return <td key={c.key}><select className="cell" value={String(v ?? '')} onChange={(e) => update(i, c, e.target.value)}>{c.options!.map((o) => <option key={o}>{o}</option>)}</select></td>;
                  return (
                    <td key={c.key}>
                      <input className="cell" defaultValue={v === undefined || (typeof v === 'number' && !Number.isFinite(v)) ? '' : String(v)} key={`${i}-${String(v)}`}
                        readOnly={!c.set} onBlur={(e) => e.target.value !== String(v ?? '') && update(i, c, e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                        onPaste={(e) => onPaste(e, i, ci)} inputMode={c.type === 'num' ? 'decimal' : undefined} />
                    </td>
                  );
                })}
                {onDelete && <td><button className="btn ghost small" title="Delete row" onClick={(e) => { e.stopPropagation(); onDelete(i); }}>×</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {onAdd && <button className="btn small" style={{ marginTop: 6 }} onClick={onAdd}>+ Add row</button>}
    </div>
  );
}

export const num = (v: string) => {
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};
