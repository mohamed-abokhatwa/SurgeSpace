// Scrubber that doubles as an overview: the largest rise (red) and drop (blue) anywhere in the network at
// each moment, with the event and the peaks marked. Click or drag to jump; arrow keys step.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TransientResult } from '../engine/transient';
import type { Network } from '../engine/types';
import { fmt } from './util';

export function surgeTrace(result: TransientResult) {
  const nF = result.times.length;
  const rise = new Float32Array(nF), drop = new Float32Array(nF);
  for (const id in result.frameHeads) {
    const hs = result.frameHeads[id];
    const ns = result.frameSamples[id].length;
    for (let f = 0; f < nF; f++) {
      let r = rise[f], d = drop[f];
      for (let k = 0; k < ns; k++) {
        const v = hs[f * ns + k] - hs[k];
        if (v > r) r = v;
        if (v < d) d = v;
      }
      rise[f] = r; drop[f] = d;
    }
  }
  let fMax = 0, fMin = 0;
  for (let f = 0; f < nF; f++) { if (rise[f] > rise[fMax]) fMax = f; if (drop[f] < drop[fMin]) fMin = f; }
  return { rise, drop, fMax, fMin };
}

export function Timeline({ net, result, framePos: fpIn, onSeek }: { net: Network; result: TransientResult; framePos: number; onSeek: (f: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(400);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const tr = useMemo(() => surgeTrace(result), [result]);
  const T = result.times;
  const nF = T.length;
  const framePos = Number.isFinite(fpIn) ? Math.max(0, Math.min(nF - 1, fpIn)) : 0;
  const H = 44, mid = H / 2;
  const amp = Math.max(...tr.rise, ...Array.from(tr.drop, (v) => -v), 1e-6);
  const X = (f: number) => (f / Math.max(1, nF - 1)) * w;
  const tX = (t: number) => ((t - T[0]) / Math.max(1e-9, T[nF - 1] - T[0])) * w;
  const paths = useMemo(() => {
    let up = `M0,${mid}`, dn = `M0,${mid}`;
    const step = Math.max(1, Math.floor(nF / (w * 1.5)));
    for (let f = 0; f < nF; f += step) {
      up += `L${X(f).toFixed(1)},${(mid - (tr.rise[f] / amp) * (mid - 3)).toFixed(1)}`;
      dn += `L${X(f).toFixed(1)},${(mid - (tr.drop[f] / amp) * (mid - 3)).toFixed(1)}`;
    }
    up += `L${w},${mid}Z`; dn += `L${w},${mid}Z`;
    return { up, dn };
  }, [tr, w, nF, amp]); // eslint-disable-line react-hooks/exhaustive-deps
  const seekAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const f = ((clientX - r.left) / Math.max(r.width, 1)) * (nF - 1);
    if (Number.isFinite(f)) onSeek(Math.max(0, Math.min(nF - 1, f)));
  };
  const dragging = useRef(false);
  const ev = net.event;
  const marks: { x: number; label: string; color: string }[] = [];
  if (ev.kind !== 'none') {
    const ramp = ev.kind === 'pumpTrip' && ev.pumpMode === 'ramp';
    marks.push({ x: tX(ev.start), label: ev.kind === 'pumpTrip' ? (ramp ? 'Ramp' : 'Trip') : ev.kind === 'valveClose' ? 'Close' : 'Open', color: 'var(--accent)' });
    if (ev.duration && (ev.kind !== 'pumpTrip' || ramp)) marks.push({ x: tX(ev.start + ev.duration), label: ramp ? 'Stopped' : 'Stroke end', color: 'var(--accent)' });
  }
  const tNow = T[Math.min(nF - 1, Math.floor(framePos))] ?? 0;
  return (
    <div ref={ref} className="timeline" role="slider" tabIndex={0} aria-label="Time" aria-valuemin={0} aria-valuemax={T[nF - 1]} aria-valuenow={tNow} aria-valuetext={`${tNow.toFixed(2)} seconds`}
      onPointerDown={(e) => { dragging.current = true; (e.target as Element).setPointerCapture?.(e.pointerId); seekAt(e.clientX); }}
      onPointerMove={(e) => dragging.current && seekAt(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') { onSeek(Math.min(nF - 1, Math.floor(framePos) + (e.shiftKey ? 10 : 1))); e.preventDefault(); }
        if (e.key === 'ArrowLeft') { onSeek(Math.max(0, Math.ceil(framePos) - (e.shiftKey ? 10 : 1))); e.preventDefault(); }
        if (e.key === 'Home') onSeek(0);
        if (e.key === 'End') onSeek(nF - 1);
      }}>
      <svg width={w} height={H} style={{ display: 'block' }}>
        <path d={paths.up} fill="rgba(220,38,38,0.35)" stroke="#dc2626" strokeWidth="1" />
        <path d={paths.dn} fill="rgba(37,99,235,0.3)" stroke="#2563eb" strokeWidth="1" />
        <line x1={0} x2={w} y1={mid} y2={mid} stroke="var(--line-2)" />
        {marks.map((m) => (
          <g key={m.label}>
            <line x1={m.x} x2={m.x} y1={0} y2={H} stroke={m.color} strokeDasharray="2 3" />
            <text x={m.x + 3} y={10} fontSize="9.5" fill={m.color}>{m.label}</text>
          </g>
        ))}
        <g>
          <circle cx={X(tr.fMax)} cy={mid - (tr.rise[tr.fMax] / amp) * (mid - 3)} r="3" fill="#dc2626" />
          <circle cx={X(tr.fMin)} cy={mid - (tr.drop[tr.fMin] / amp) * (mid - 3)} r="3" fill="#2563eb" />
        </g>
        <line x1={X(framePos)} x2={X(framePos)} y1={0} y2={H} stroke="var(--text)" strokeWidth="2" />
        <circle cx={X(framePos)} cy={mid} r="4.5" fill="var(--accent)" stroke="var(--panel)" strokeWidth="1.5" />
      </svg>
      <div className="row small timeline-keys" onPointerDown={(e) => e.stopPropagation()}>
        <button className="linkish" onClick={() => onSeek(tr.fMax)} title="Jump to the highest rise">▲ +{fmt(tr.rise[tr.fMax], 1)} m at {fmt(T[tr.fMax], 2)} s</button>
        <button className="linkish" onClick={() => onSeek(tr.fMin)} title="Jump to the deepest drop">▼ {fmt(tr.drop[tr.fMin], 1)} m at {fmt(T[tr.fMin], 2)} s</button>
      </div>
    </div>
  );
}
