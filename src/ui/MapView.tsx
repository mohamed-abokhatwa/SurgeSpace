import { useEffect, useMemo, useRef, useState } from 'react';
import type { TransientResult, PipeEnvelope } from '../engine/transient';
import type { Network } from '../engine/types';
import { pressureColor } from './util';

export type ColorMode = 'frame' | 'max' | 'min' | 'steady' | 'plain';
export type Selection = { type: 'node' | 'pipe' | 'pump' | 'valve'; id: string } | null;

const interpZ = (e: PipeEnvelope | undefined, s: number, fallback: number) => {
  if (!e) return fallback;
  const xs = e.s, zs = e.z;
  if (s <= xs[0]) return zs[0];
  for (let i = 1; i < xs.length; i++) if (s <= xs[i]) return zs[i - 1] + ((zs[i] - zs[i - 1]) * (s - xs[i - 1])) / (xs[i] - xs[i - 1] || 1);
  return zs[zs.length - 1];
};

export function MapView({
  net, result, envelopes, frame, mode, selection, onSelect, route,
}: {
  net: Network;
  result: TransientResult | null;
  envelopes?: PipeEnvelope[];
  frame: number;
  mode: ColorMode;
  selection: Selection;
  onSelect: (s: Selection) => void;
  route: Set<string>;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const bounds = useMemo(() => {
    const xs = net.nodes.map((n) => n.x), ys = net.nodes.map((n) => -n.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const w = Math.max(x1 - x0, 1), h = Math.max(y1 - y0, 1);
    const pad = Math.max(w, h) * 0.08 + 1;
    return { x: x0 - pad, y: y0 - pad, w: w + 2 * pad, h: h + 2 * pad };
  }, [net.nodes]);
  const [vb, setVb] = useState(bounds);
  useEffect(() => setVb(bounds), [bounds]);
  const drag = useRef<{ x: number; y: number; vb: typeof vb; moved: boolean } | null>(null);
  const unit = Math.max(vb.w, vb.h) / 900; // one screen pixel-ish in drawing units
  const pos = useMemo(() => new Map(net.nodes.map((n) => [n.id, { x: n.x, y: -n.y }])), [net.nodes]);
  const envMap = useMemo(() => new Map((envelopes ?? result?.envelopes ?? []).map((e) => [e.id, e])), [envelopes, result]);
  const pressureClassOf = (id: string) => net.pipes.find((p) => p.id === id)?.pressureClass ?? 100;

  const pipeSegments = (pipeId: string, a: { x: number; y: number }, b: { x: number; y: number }, zA: number, zB: number) => {
    const L = net.pipes.find((p) => p.id === pipeId)?.length ?? 1;
    const env = envMap.get(pipeId);
    const cls = pressureClassOf(pipeId);
    const segs: { x1: number; y1: number; x2: number; y2: number; c: string }[] = [];
    const at = (s: number) => ({ x: a.x + ((b.x - a.x) * s) / L, y: a.y + ((b.y - a.y) * s) / L });
    if (mode === 'plain' || !result) return [{ ...{ x1: a.x, y1: a.y, x2: b.x, y2: b.y }, c: 'var(--line-2)' }];
    if (mode === 'frame') {
      const ss = result.frameSamples[pipeId];
      const hs = result.frameHeads[pipeId];
      if (!ss || !hs) return [];
      const ns = ss.length;
      const f = Math.min(frame, result.times.length - 1);
      for (let k = 0; k < ns - 1; k++) {
        const sMid = (ss[k] + ss[k + 1]) / 2;
        const h = (hs[f * ns + k] + hs[f * ns + k + 1]) / 2;
        const p = h - interpZ(env, sMid, (zA + zB) / 2);
        const P1 = at(ss[k]), P2 = at(ss[k + 1]);
        segs.push({ x1: P1.x, y1: P1.y, x2: P2.x, y2: P2.y, c: pressureColor(p, cls) });
      }
      return segs;
    }
    if (!env) return [];
    const n = env.s.length;
    const stride = Math.max(1, Math.floor(n / 40));
    for (let i = 0; i < n - 1; i += stride) {
      const j = Math.min(i + stride, n - 1);
      const arr = mode === 'max' ? env.hMax : mode === 'min' ? env.hMin : env.hSteady;
      let p = mode === 'max' ? -Infinity : Infinity;
      for (let k = i; k <= j; k++) {
        const v = arr[k] - env.z[k];
        p = mode === 'max' ? Math.max(p, v) : mode === 'min' ? Math.min(p, v) : v;
      }
      const P1 = at(env.s[i]), P2 = at(env.s[j]);
      segs.push({ x1: P1.x, y1: P1.y, x2: P2.x, y2: P2.y, c: pressureColor(p, cls) });
    }
    return segs;
  };

  // group parallel pumps between the same pair of nodes
  const pumpGroups = useMemo(() => {
    const g = new Map<string, string[]>();
    net.pumps.forEach((p) => g.set(`${p.from}>${p.to}`, [...(g.get(`${p.from}>${p.to}`) ?? []), p.id]));
    return [...g.entries()].map(([k, ids]) => ({ from: k.split('>')[0], to: k.split('>')[1], ids }));
  }, [net.pumps]);

  const sw = unit * 4.2;
  const sel = (t: Selection) => selection && t && selection.type === t.type && selection.id === t.id;

  return (
    <svg ref={ref} width="100%" height="100%" viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block', cursor: drag.current ? 'grabbing' : 'grab', touchAction: 'none' }}
      onWheel={(e) => {
        const svg = ref.current!;
        const r = svg.getBoundingClientRect();
        const k = e.deltaY > 0 ? 1.15 : 1 / 1.15;
        const scale = Math.max(vb.w / r.width, vb.h / r.height);
        const cx = vb.x + (e.clientX - r.left - (r.width - vb.w / scale) / 2) * scale;
        const cy = vb.y + (e.clientY - r.top - (r.height - vb.h / scale) / 2) * scale;
        setVb({ x: cx - (cx - vb.x) * k, y: cy - (cy - vb.y) * k, w: vb.w * k, h: vb.h * k });
      }}
      onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, vb, moved: false }; (e.target as Element).setPointerCapture?.(e.pointerId); }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const r = ref.current!.getBoundingClientRect();
        const scale = Math.max(d.vb.w / r.width, d.vb.h / r.height);
        const dx = (e.clientX - d.x) * scale, dy = (e.clientY - d.y) * scale;
        if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) d.moved = true;
        setVb({ ...d.vb, x: d.vb.x - dx, y: d.vb.y - dy });
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved && e.target === ref.current) onSelect(null);
      }}
      onDoubleClick={() => setVb(bounds)}>
      {/* route highlight */}
      {net.pipes.filter((p) => route.has(p.id)).map((p) => {
        const a = pos.get(p.from)!, b = pos.get(p.to)!;
        return <line key={`r${p.id}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--accent)" strokeOpacity="0.25" strokeWidth={sw * 3.2} strokeLinecap="round" />;
      })}
      {net.pipes.map((p) => {
        const a = pos.get(p.from), b = pos.get(p.to);
        if (!a || !b) return null;
        const zA = net.nodes.find((n) => n.id === p.from)?.elev ?? 0, zB = net.nodes.find((n) => n.id === p.to)?.elev ?? 0;
        const isSel = sel({ type: 'pipe', id: p.id });
        return (
          <g key={p.id} onClick={(e) => { e.stopPropagation(); onSelect({ type: 'pipe', id: p.id }); }} style={{ cursor: 'pointer' }}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={sw * 4} />
            {isSel && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--text)" strokeWidth={sw * 2.2} strokeLinecap="round" />}
            {p.closed ? (
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--faint)" strokeWidth={sw} strokeDasharray={`${sw * 2} ${sw * 2}`} />
            ) : (
              pipeSegments(p.id, a, b, zA, zB).map((s, k) => <line key={k} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.c} strokeWidth={sw * Math.max(0.7, Math.min(1.8, p.diameter / 0.4))} strokeLinecap="round" />)
            )}
          </g>
        );
      })}
      {pumpGroups.map((g) => {
        const a = pos.get(g.from), b = pos.get(g.to);
        if (!a || !b) return null;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
        const r = unit * 11;
        const speed = result && result.pumps[g.ids[0]] ? result.pumps[g.ids[0]].speed[Math.min(frame, result.times.length - 1)] : 1;
        const isSel = g.ids.some((id) => sel({ type: 'pump', id }));
        return (
          <g key={`pg${g.ids[0]}`} onClick={(e) => { e.stopPropagation(); onSelect({ type: 'pump', id: g.ids[0] }); }} style={{ cursor: 'pointer' }}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--muted)" strokeWidth={sw} />
            <circle cx={mx} cy={my} r={r} fill="var(--panel)" stroke={isSel ? 'var(--accent)' : 'var(--text)'} strokeWidth={unit * 2} />
            <path d={`M${-r * 0.45},${-r * 0.5} L${r * 0.6},0 L${-r * 0.45},${r * 0.5} Z`} transform={`translate(${mx} ${my}) rotate(${ang})`} fill={mode === 'frame' && result ? `rgba(224,98,12,${0.25 + 0.75 * speed})` : 'var(--accent)'} />
            {g.ids.length > 1 && <text x={mx + r * 1.1} y={my - r * 0.9} fontSize={unit * 12} fill="var(--muted)" fontWeight="600">×{g.ids.length}</text>}
          </g>
        );
      })}
      {net.valves.map((v) => {
        const a = pos.get(v.from), b = pos.get(v.to);
        if (!a || !b) return null;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
        const r = unit * 9;
        const open = result && result.valves[v.id] ? result.valves[v.id].opening[Math.min(frame, result.times.length - 1)] : v.opening;
        return (
          <g key={v.id} onClick={(e) => { e.stopPropagation(); onSelect({ type: 'valve', id: v.id }); }} style={{ cursor: 'pointer' }}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--muted)" strokeWidth={sw} />
            <path d={`M${-r},${-r * 0.7} L${r},${r * 0.7} L${r},${-r * 0.7} L${-r},${r * 0.7} Z`} transform={`translate(${mx} ${my}) rotate(${ang})`}
              fill={open > 0.01 ? 'var(--panel)' : 'var(--bad)'} stroke={sel({ type: 'valve', id: v.id }) ? 'var(--accent)' : 'var(--text)'} strokeWidth={unit * 1.8} />
          </g>
        );
      })}
      {net.nodes.map((n) => {
        const p = pos.get(n.id)!;
        const isSel = sel({ type: 'node', id: n.id });
        const r = unit * (n.kind === 'reservoir' ? 9 : 4.5);
        const pNow = result && mode === 'frame' && n.kind !== 'reservoir' ? (result.nodeHead[n.id]?.[Math.min(frame, result.times.length - 1)] ?? NaN) - n.elev : NaN;
        return (
          <g key={n.id} onClick={(e) => { e.stopPropagation(); onSelect({ type: 'node', id: n.id }); }} style={{ cursor: 'pointer' }}>
            {n.kind === 'reservoir' ? (
              <path d={`M${p.x - r},${p.y - r * 0.6} L${p.x + r},${p.y - r * 0.6} L${p.x + r * 0.75},${p.y + r * 0.7} L${p.x - r * 0.75},${p.y + r * 0.7} Z`} fill="var(--cyan-soft)" stroke={isSel ? 'var(--accent)' : 'var(--cyan)'} strokeWidth={unit * 2} />
            ) : (
              <circle cx={p.x} cy={p.y} r={isSel ? r * 1.6 : r} fill={Number.isFinite(pNow) ? pressureColor(pNow) : 'var(--panel)'} stroke={isSel ? 'var(--accent)' : 'var(--text)'} strokeWidth={unit * 1.6} />
            )}
            {n.vessel && (
              <g>
                <rect x={p.x - unit * 6} y={p.y - unit * 30} width={unit * 12} height={unit * 22} rx={unit * 6} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={unit * 1.6} />
                {result?.vessels[n.id] && (() => {
                  const v = result.vessels[n.id];
                  const g = v.gas[Math.min(frame, v.gas.length - 1)];
                  const water = Math.max(0, Math.min(1, 1 - g / v.volume));
                  return <rect x={p.x - unit * 4.5} y={p.y - unit * 9.5 - unit * 19 * water} width={unit * 9} height={unit * 19 * water} rx={unit * 3} fill="var(--cyan)" opacity="0.7" />;
                })()}
                <line x1={p.x} y1={p.y - unit * 8} x2={p.x} y2={p.y - r} stroke="var(--accent)" strokeWidth={unit * 1.6} />
              </g>
            )}
            {n.airValve && (
              <g>
                <path d={`M${p.x},${p.y - unit * 7} l${unit * 6},${-unit * 11} l${-unit * 12},0 Z`} fill={result?.airValves[n.id] && result.airValves[n.id].air[Math.min(frame, result.times.length - 1)] > 1e-4 ? 'var(--warn)' : 'var(--panel)'} stroke="var(--warn)" strokeWidth={unit * 1.6} />
              </g>
            )}
            {(net.nodes.length < 70 || isSel) && (
              <text x={p.x + unit * 8} y={p.y + unit * 14} fontSize={unit * 11} fill="var(--muted)">{n.id}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
