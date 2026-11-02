import { useEffect, useMemo, useRef, useState } from 'react';
import { fmt } from './util';

export interface Series {
  name: string;
  color: string;
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  dash?: string;
  width?: number;
  /** Fill down to the bottom of the chart (ground). */
  fillBelow?: string;
  hideInLegend?: boolean;
  /** Draw but do not let it set the axis range (e.g. a pipe-class line far above the data). */
  noScale?: boolean;
}
export interface Band {
  name: string;
  color: string;
  x: ArrayLike<number>;
  lo: ArrayLike<number>;
  hi: ArrayLike<number>;
}
export interface Marker {
  x: number;
  label: string;
}

function ticks(lo: number, hi: number, n = 6) {
  const span = hi - lo || 1;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return { out, step };
}

export function Chart({
  series, bands = [], markers = [], xLabel, yLabel, vLine, height = 260, yUnit = 'm', xUnit = 'm', onHoverX,
}: {
  series: Series[];
  bands?: Band[];
  markers?: Marker[];
  xLabel: string;
  yLabel: string;
  vLine?: number;
  height?: number;
  yUnit?: string;
  xUnit?: string;
  onHoverX?: (x: number | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [hx, setHx] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const m = { l: 58, r: 14, t: 12, b: 38 };
  const { x0, x1, y0, y1 } = useMemo(() => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const scan = (xs: ArrayLike<number>, ys: ArrayLike<number>) => {
      for (let i = 0; i < xs.length; i++) {
        const x = xs[i], y = ys[i];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    };
    series.filter((s) => !s.noScale).forEach((s) => scan(s.x, s.y));
    bands.forEach((b) => { scan(b.x, b.lo); scan(b.x, b.hi); });
    if (!Number.isFinite(x0)) return { x0: 0, x1: 1, y0: 0, y1: 1 };
    const pad = (y1 - y0) * 0.06 || 1;
    return { x0, x1: x1 === x0 ? x0 + 1 : x1, y0: y0 - pad, y1: y1 + pad };
  }, [series, bands]);
  const iw = Math.max(w - m.l - m.r, 50);
  const ih = height - m.t - m.b;
  const X = (x: number) => m.l + ((x - x0) / (x1 - x0)) * iw;
  const Y = (y: number) => m.t + (1 - (y - y0) / (y1 - y0)) * ih;
  const path = (xs: ArrayLike<number>, ys: ArrayLike<number>) => {
    let d = '';
    let pen = false;
    // decimate to ~2 points per pixel
    const stride = Math.max(1, Math.floor(xs.length / (iw * 2)));
    for (let i = 0; i < xs.length; i += stride) {
      const y = ys[i];
      if (!Number.isFinite(y)) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(y).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  const xt = ticks(x0, x1, Math.max(3, Math.floor(iw / 90)));
  const yt = ticks(y0, y1, 5);
  const readout = useMemo(() => {
    if (hx === null) return null;
    return series.filter((s) => !s.hideInLegend).map((s) => {
      let best = 0, bd = Infinity;
      for (let i = 0; i < s.x.length; i++) { const d = Math.abs(s.x[i] - hx); if (d < bd) { bd = d; best = i; } }
      return { name: s.name, color: s.color, v: s.y[best] };
    });
  }, [hx, series]);
  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <svg width={w} height={height} role="img" aria-label={`${yLabel} against ${xLabel}`}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = e.clientX - r.left;
          if (px < m.l || px > m.l + iw) { setHx(null); onHoverX?.(null); return; }
          const x = x0 + ((px - m.l) / iw) * (x1 - x0);
          setHx(x);
          onHoverX?.(x);
        }}
        onMouseLeave={() => { setHx(null); onHoverX?.(null); }}>
        {yt.out.map((v) => (
          <g key={`y${v}`}>
            <line x1={m.l} x2={m.l + iw} y1={Y(v)} y2={Y(v)} stroke="var(--line)" />
            <text x={m.l - 6} y={Y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{fmt(v, yt.step < 1 ? 1 : 0)}</text>
          </g>
        ))}
        {xt.out.map((v) => (
          <g key={`x${v}`}>
            <line x1={X(v)} x2={X(v)} y1={m.t} y2={m.t + ih} stroke="var(--line)" opacity="0.6" />
            <text x={X(v)} y={m.t + ih + 15} textAnchor="middle" fontSize="11" fill="var(--muted)">{fmt(v, xt.step < 1 ? 1 : 0)}</text>
          </g>
        ))}
        <text x={m.l + iw / 2} y={height - 4} textAnchor="middle" fontSize="11.5" fill="var(--muted)">{xLabel}</text>
        <text transform={`translate(13 ${m.t + ih / 2}) rotate(-90)`} textAnchor="middle" fontSize="11.5" fill="var(--muted)">{yLabel}</text>
        <clipPath id="plot"><rect x={m.l} y={m.t} width={iw} height={ih} /></clipPath>
        <g clipPath="url(#plot)">
          {series.filter((s) => s.fillBelow).map((s) => (
            <path key={`f${s.name}`} d={`${path(s.x, s.y)}L${X(s.x[s.x.length - 1])},${m.t + ih}L${X(s.x[0])},${m.t + ih}Z`} fill={s.fillBelow} stroke="none" />
          ))}
          {bands.map((b) => {
            let d = '';
            for (let i = 0; i < b.x.length; i++) d += `${i ? 'L' : 'M'}${X(b.x[i]).toFixed(1)},${Y(b.hi[i]).toFixed(1)}`;
            for (let i = b.x.length - 1; i >= 0; i--) d += `L${X(b.x[i]).toFixed(1)},${Y(b.lo[i]).toFixed(1)}`;
            return <path key={`b${b.name}`} d={d + 'Z'} fill={b.color} stroke="none" />;
          })}
          {series.map((s) => (
            <path key={s.name} d={path(s.x, s.y)} fill="none" stroke={s.color} strokeWidth={s.width ?? 1.6} strokeDasharray={s.dash} strokeLinejoin="round" />
          ))}
          {(() => {
            let lastX = -Infinity;
            return markers.map((mk) => {
              const px = X(mk.x);
              const show = px - lastX > 46;
              if (show) lastX = px;
              return (
                <g key={`m${mk.label}${mk.x}`}>
                  <line x1={px} x2={px} y1={m.t} y2={m.t + ih} stroke="var(--faint)" strokeDasharray="2 4" />
                  {show && <text x={px + 3} y={m.t + 10} fontSize="10" fill="var(--faint)">{mk.label}</text>}
                </g>
              );
            });
          })()}
          {vLine !== undefined && <line x1={X(vLine)} x2={X(vLine)} y1={m.t} y2={m.t + ih} stroke="var(--accent)" strokeWidth="1.5" />}
          {hx !== null && <line x1={X(hx)} x2={X(hx)} y1={m.t} y2={m.t + ih} stroke="var(--text)" strokeOpacity="0.35" />}
        </g>
      </svg>
      <div className="row small" style={{ flexWrap: 'wrap', gap: 12, marginTop: 2 }}>
        {series.filter((s) => !s.hideInLegend).map((s) => (
          <span key={s.name} className="row" style={{ gap: 5 }}>
            <svg width="18" height="8"><line x1="0" x2="18" y1="4" y2="4" stroke={s.color} strokeWidth="2.2" strokeDasharray={s.dash} /></svg>
            <span className="muted">{s.name}</span>
          </span>
        ))}
        {bands.map((b) => (
          <span key={b.name} className="row" style={{ gap: 5 }}>
            <span style={{ width: 14, height: 9, background: b.color, borderRadius: 2 }} />
            <span className="muted">{b.name}</span>
          </span>
        ))}
      </div>
      {readout && hx !== null && (
        <div className="card small" style={{ position: 'absolute', top: 8, left: Math.min(X(hx) + 10, w - 190), width: 180, padding: '6px 9px', pointerEvents: 'none' }}>
          <div className="mono" style={{ fontWeight: 600 }}>{fmt(hx, 1)} {xUnit}</div>
          {readout.map((r) => (
            <div key={r.name} className="row" style={{ justifyContent: 'space-between' }}>
              <span style={{ color: r.color }}>{r.name}</span>
              <span className="mono">{fmt(r.v, 1)} {yUnit}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
