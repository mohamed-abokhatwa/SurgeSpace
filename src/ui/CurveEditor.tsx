// Curve editor used by every two-column input in SurgeSpace (pump curves, valve characteristics, operating curves,
// long sections, level schedules, air valve curves, motor torque…): a live chart above an editable table.
// Type in the cells, Tab/Enter to move on, paste rows straight from Excel, add or remove points with one click.
import { useEffect, useMemo, useRef, useState } from 'react';

export interface CurveMarker { x: number; y: number; label: string }

const fmtN = (v: number) => (Number.isFinite(v) ? String(+v.toPrecision(6)) : '');
const parseRows = (t: string) => t.split(/\r?\n/).map((l) => l.trim().split(/[\t,;]+|\s{2,}|\s(?=[-\d.])/).filter(Boolean).map((x) => Number(x.replace(/\s/g, '')))).filter((r) => r.length >= 2 && r.slice(0, 2).every(Number.isFinite)).map((r) => [r[0], r[1]] as [number, number]);

function niceTicks(lo: number, hi: number, n = 4) {
  if (!(hi > lo)) { hi = lo + 1; }
  const raw = (hi - lo) / n, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  const step = (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(+v.toPrecision(10));
  return out;
}

export function CurveEditor({ value, onChange, xLabel, yLabel, title, note, marker, smooth, sortX = true, minPoints = 1, presets, height = 150, extra, chart = true }: {
  value: [number, number][] | undefined; onChange: (v: [number, number][]) => void;
  xLabel: string; yLabel: string; title?: string; note?: string;
  /** e.g. the duty point from the last run */ marker?: CurveMarker;
  /** draw a smooth curve through three points (pump curves) */ smooth?: boolean;
  sortX?: boolean; minPoints?: number;
  presets?: { label: string; make: () => [number, number][] }[];
  height?: number;
  /** a second, read-only curve (e.g. a system curve or the calculated characteristic) */ extra?: { label: string; points: [number, number][] };
  /** false for plain tables of pairs that are not a curve */ chart?: boolean;
}) {
  const [rows, setRows] = useState<string[][]>(() => (value?.length ? value : [[NaN, NaN]]).map(([a, b]) => [fmtN(a), fmtN(b)]));
  const lastSent = useRef<string>(JSON.stringify(value ?? []));
  // follow outside changes (undo, unit switch, presets) without fighting the cell being typed in
  useEffect(() => {
    const k = JSON.stringify(value ?? []);
    if (k !== lastSent.current) { lastSent.current = k; setRows((value?.length ? value : [[NaN, NaN]]).map(([a, b]) => [fmtN(a), fmtN(b)])); }
  }, [value]);
  const pts = useMemo(() => rows.filter(([a, b]) => a.trim() !== '' && b.trim() !== '').map(([a, b]) => [Number(a), Number(b)] as [number, number]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b)), [rows]);
  const commit = (next: string[][], sort = false) => {
    let r = next;
    if (sort && sortX) r = [...next].sort((u, v) => (Number(u[0]) || 0) - (Number(v[0]) || 0));
    setRows(r);
    const out = r.filter(([a, b]) => a.trim() !== '' && b.trim() !== '').map(([a, b]) => [Number(a), Number(b)] as [number, number]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
    const v = sort && sortX ? [...out].sort((u, w) => u[0] - w[0]) : out;
    if (v.length >= minPoints) { lastSent.current = JSON.stringify(v); onChange(v); }
  };
  const setCell = (i: number, j: number, s: string) => commit(rows.map((r, k) => (k === i ? (j === 0 ? [s, r[1]] : [r[0], s]) : r)));
  const onPaste = (i: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    const t = e.clipboardData.getData('text');
    const pr = parseRows(t);
    if (pr.length < 2 && !/\n/.test(t.trim())) return; // a single number: normal paste
    e.preventDefault();
    const add = pr.map(([a, b]) => [fmtN(a), fmtN(b)]);
    commit([...rows.slice(0, i).filter((r) => r[0] || r[1]), ...add, ...rows.slice(i + 1).filter((r) => r[0] || r[1])], true);
  };
  const tableRef = useRef<HTMLTableElement>(null);
  const focusCell = (i: number, j: number) => setTimeout(() => (tableRef.current?.querySelector(`input[data-c="${i}-${j}"]`) as HTMLInputElement | null)?.focus(), 0);

  // chart
  const W = 320, H = height, L = 40, R = 10, T = 10, B = 26;
  const sorted = [...pts].sort((a, b) => a[0] - b[0]);
  const all = [...sorted, ...(extra?.points ?? []), ...(marker && Number.isFinite(marker.x) ? [[marker.x, marker.y] as [number, number]] : [])];
  let x0 = Math.min(0, ...all.map((p) => p[0])), x1 = Math.max(...all.map((p) => p[0]), x0 + 1);
  let y0 = Math.min(0, ...all.map((p) => p[1])), y1 = Math.max(...all.map((p) => p[1]), y0 + 1);
  const padY = (y1 - y0) * 0.08; y1 += padY; if (y0 < 0) y0 -= padY;
  x1 += (x1 - x0) * 0.04;
  if (!all.length) { x0 = 0; x1 = 1; y0 = 0; y1 = 1; }
  const X = (v: number) => L + ((v - x0) / (x1 - x0)) * (W - L - R);
  const Y = (v: number) => H - B - ((v - y0) / (y1 - y0)) * (H - T - B);
  // a smooth pump-type curve through three points: h = a + b·q + c·q² (least squares when more)
  let curvePath = '';
  if (smooth && sorted.length === 3) {
    const [[q1, h1], [q2, h2], [q3, h3]] = sorted;
    const den = (q1 - q2) * (q1 - q3) * (q2 - q3) || 1;
    const c = (q3 * (h2 - h1) + q2 * (h1 - h3) + q1 * (h3 - h2)) / den;
    const b = (q3 * q3 * (h1 - h2) + q2 * q2 * (h3 - h1) + q1 * q1 * (h2 - h3)) / den;
    const a = h1 - b * q1 - c * q1 * q1;
    const n = 40;
    for (let k = 0; k <= n; k++) { const q = q1 + ((q3 - q1) * k) / n; curvePath += `${k ? 'L' : 'M'}${X(q).toFixed(1)},${Y(a + b * q + c * q * q).toFixed(1)}`; }
  } else sorted.forEach(([a, b], k) => { curvePath += `${k ? 'L' : 'M'}${X(a).toFixed(1)},${Y(b).toFixed(1)}`; });
  const extraPath = (extra?.points ?? []).map(([a, b], k) => `${k ? 'L' : 'M'}${X(a).toFixed(1)},${Y(b).toFixed(1)}`).join('');
  const xt = niceTicks(x0, x1), yt = niceTicks(y0, y1);
  const unsorted = sortX && pts.some((p, i) => i > 0 && p[0] < pts[i - 1][0]);

  return (
    <div className="curve-ed">
      {title && <div className="curve-title">{title}</div>}
      {chart && <svg viewBox={`0 0 ${W} ${H}`} className="curve-chart" role="img" aria-label={`${yLabel} against ${xLabel}`}>
        <defs><linearGradient id="cv-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity="0.22" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>
        {yt.map((v) => <g key={`y${v}`}><line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} className="cv-grid" /><text x={L - 5} y={Y(v) + 3} className="cv-tick" textAnchor="end">{+v.toPrecision(4)}</text></g>)}
        {xt.map((v) => <g key={`x${v}`}><line x1={X(v)} x2={X(v)} y1={T} y2={H - B} className="cv-grid" /><text x={X(v)} y={H - B + 12} className="cv-tick" textAnchor="middle">{+v.toPrecision(4)}</text></g>)}
        <text x={(L + W - R) / 2} y={H - 3} className="cv-axis" textAnchor="middle">{xLabel}</text>
        <text x={9} y={(T + H - B) / 2} className="cv-axis" textAnchor="middle" transform={`rotate(-90 9 ${(T + H - B) / 2})`}>{yLabel}</text>
        {curvePath && sorted.length > 1 && <path d={`${curvePath}L${X(sorted[sorted.length - 1][0]).toFixed(1)},${Y(Math.max(y0, 0)).toFixed(1)}L${X(sorted[0][0]).toFixed(1)},${Y(Math.max(y0, 0)).toFixed(1)}Z`} fill="url(#cv-fill)" stroke="none" />}
        {extraPath && <path d={extraPath} className="cv-extra" />}
        {curvePath && <path d={curvePath} className="cv-line" />}
        {sorted.map(([a, b], k) => <circle key={k} cx={X(a)} cy={Y(b)} r={3.6} className="cv-pt"><title>{`${+a.toPrecision(5)}, ${+b.toPrecision(5)}`}</title></circle>)}
        {marker && Number.isFinite(marker.x) && Number.isFinite(marker.y) && <g><circle cx={X(marker.x)} cy={Y(marker.y)} r={5.5} className="cv-mark" /><text x={X(marker.x) + 8} y={Y(marker.y) - 7} className="cv-mark-t">{marker.label}</text></g>}
        {!pts.length && <text x={(L + W) / 2} y={H / 2} className="cv-tick" textAnchor="middle">Type or paste points below</text>}
      </svg>}
      {extra && <div className="cv-key"><span><i className="k1" />Points</span><span><i className="k2" />{extra.label}</span></div>}
      <table className="curve-tbl" ref={tableRef}>
        <thead><tr><th>#</th><th>{xLabel}</th><th>{yLabel}</th><th /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="cv-n">{i + 1}</td>
              {[0, 1].map((j) => (
                <td key={j}><input data-c={`${i}-${j}`} inputMode="decimal" value={r[j]} aria-label={`${j ? yLabel : xLabel}, point ${i + 1}`}
                  aria-invalid={r[j].trim() !== '' && !Number.isFinite(Number(r[j]))}
                  onChange={(e) => setCell(i, j, e.target.value)} onPaste={(e) => onPaste(i, e)}
                  onBlur={() => commit(rows, true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); if (i === rows.length - 1) { commit([...rows, ['', '']]); } focusCell(i + 1, j); }
                    if (e.key === 'ArrowDown' && i < rows.length - 1) { e.preventDefault(); focusCell(i + 1, j); }
                    if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); focusCell(i - 1, j); }
                  }} /></td>
              ))}
              <td><button type="button" className="cv-del" title="Remove this point" aria-label={`Remove point ${i + 1}`} disabled={rows.length <= 1} onClick={() => commit(rows.filter((_, k) => k !== i))}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="cv-actions">
        <button type="button" className="btn small" onClick={() => { commit([...rows, ['', '']]); focusCell(rows.length, 0); }}>+ Add point</button>
        {presets?.map((p) => <button key={p.label} type="button" className="btn small ghost" onClick={() => { const v = p.make(); lastSent.current = ''; onChange(v); }}>{p.label}</button>)}
        <span className="cv-hint">Paste rows from Excel into any cell</span>
      </div>
      {unsorted && <p className="hint">The points are put in order of {xLabel.replace(/ \(.*\)/, '').toLowerCase()} when you leave the table.</p>}
      {note && <p className="hint">{note}</p>}
    </div>
  );
}

/** Split a label such as "Flow (L/s), head (m) — shut-off, duty, run-out" into axis names and a note. */
export function splitPairLabel(label: string): { x: string; y: string; note?: string } {
  const [main, note] = label.split(/\s+—\s+/);
  const body = main.replace(/^[^:()]*:\s*/, '');
  let depth = 0, cut = -1;
  for (let i = 0; i < body.length; i++) { const c = body[i]; if (c === '(') depth++; else if (c === ')') depth--; else if (c === ',' && depth === 0) { cut = i; break; } }
  if (cut < 0) return { x: 'x', y: body, note };
  const cap = (s: string) => s.trim().replace(/^./, (c) => c.toUpperCase());
  return { x: cap(body.slice(0, cut)), y: cap(body.slice(cut + 1)), note };
}
