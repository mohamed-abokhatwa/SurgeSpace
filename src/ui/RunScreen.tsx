// Run progress: the stages of an analysis (steady state, surge run, design checks), simulated time, time left, and the
// pressure envelope along the long section growing as the run goes — instead of a spinner.
import { useMemo, type ReactNode } from 'react';
import type { Network } from '../engine/types';
import { findPath } from './util';

export interface RunProg {
  stage: 'steady' | 'surge' | 'checks' | 'done';
  t0: number;
  frac?: number;
  t?: number;
  duration?: number;
  steadyMs?: number;
  iterations?: number;
  steadyHeads?: Record<string, number>;
  nodeMax?: Float32Array;
  nodeMin?: Float32Array;
  elapsed?: number;
}

const STAGES: { k: RunProg['stage']; label: string }[] = [
  { k: 'steady', label: 'Steady state' },
  { k: 'surge', label: 'Surge run' },
  { k: 'checks', label: 'Design checks' },
];

export function RunScreen({ net, route, prog, onCancel }: { net: Network; route: [string, string]; prog: RunProg; onCancel: () => void }) {
  const order = { steady: 0, surge: 1, checks: 2, done: 3 } as const;
  const at = order[prog.stage];
  const now = performance.now();
  const elapsed = prog.elapsed ?? (now - prog.t0) / 1000;
  const frac = prog.stage === 'surge' ? prog.frac ?? 0 : at > 1 ? 1 : 0;
  const left = prog.stage === 'surge' && frac > 0.04 ? (elapsed * (1 - frac)) / frac : null;
  // long section along the profile route
  const prof = useMemo(() => {
    const path = route[0] && route[1] ? findPath(net, route[0], route[1]) : null;
    if (!path || !path.length) return null;
    const idx = new Map(net.nodes.map((n, i) => [n.id, i]));
    const pts: { s: number; i: number; z: number; id: string }[] = [];
    let s = 0;
    const first = net.nodes[idx.get(route[0])!];
    pts.push({ s: 0, i: idx.get(route[0])!, z: first.elev, id: first.id });
    for (const h of path) { s += h.length; const i = idx.get(h.to)!; pts.push({ s, i, z: net.nodes[i].elev, id: h.to }); }
    return { pts, L: Math.max(s, 1) };
  }, [net, route]);
  const W = 460, H = 130, pad = 8;
  let chart: ReactNode = null;
  if (prof && prog.steadyHeads) {
    const hs = prof.pts.map((p) => prog.steadyHeads![p.id] ?? p.z);
    const mx = prof.pts.map((p, k) => (prog.nodeMax ? prog.nodeMax[p.i] : hs[k]));
    const mn = prof.pts.map((p, k) => (prog.nodeMin ? prog.nodeMin[p.i] : hs[k]));
    const all = [...prof.pts.map((p) => p.z), ...hs, ...mx, ...mn].filter(Number.isFinite);
    const lo = Math.min(...all), hi = Math.max(...all), span = Math.max(hi - lo, 1);
    const X = (s: number) => pad + (s / prof.L) * (W - 2 * pad), Y = (h: number) => H - pad - ((h - lo) / span) * (H - 2 * pad);
    const line = (v: number[]) => prof.pts.map((p, k) => `${k ? 'L' : 'M'}${X(p.s).toFixed(1)} ${Y(v[k]).toFixed(1)}`).join('');
    const ground = `${line(prof.pts.map((p) => p.z))}L${X(prof.L)} ${H - pad}L${X(0)} ${H - pad}Z`;
    const band = `${line(mx)}${prof.pts.slice().reverse().map((p, k) => `L${X(p.s).toFixed(1)} ${Y(mn[prof.pts.length - 1 - k]).toFixed(1)}`).join('')}Z`;
    chart = (
      <svg className="run-chart" viewBox={`0 0 ${W} ${H}`} width="100%" height={H} aria-label="Pressure envelope so far">
        <path d={ground} className="rc-ground" />
        {prog.nodeMax && <path d={band} className="rc-band" />}
        <path d={line(hs)} className="rc-steady" />
        {prog.nodeMax && <path d={line(mx)} className="rc-max" />}
        {prog.nodeMin && <path d={line(mn)} className="rc-min" />}
      </svg>
    );
  }
  return (
    <div className={`run-screen ${prog.stage === 'done' ? 'done' : ''}`} role="status" aria-live="polite">
      <div className="run-card card">
        <div className="run-head">
          <b>{prog.stage === 'done' ? 'Analysis complete' : 'Surge analysis'}</b>
          <span className="mono small muted">{elapsed.toFixed(1)} s</span>
        </div>
        <ol className="run-stages">
          {STAGES.map((st, k) => (
            <li key={st.k} className={k < at ? 'ok' : k === at ? 'on' : ''}>
              <span className="dot">{k < at ? '✓' : k + 1}</span>
              <span>{st.label}{st.k === 'steady' && prog.iterations !== undefined ? <em> · {prog.iterations} iterations</em> : null}</span>
            </li>
          ))}
        </ol>
        <div className="run-bar"><i style={{ width: `${(prog.stage === 'steady' ? 0.04 : prog.stage === 'surge' ? 0.06 + 0.88 * frac : prog.stage === 'checks' ? 0.97 : 1) * 100}%` }} /></div>
        <div className="run-meta mono small">
          <span>{prog.stage === 'surge' && prog.t !== undefined ? `t = ${prog.t.toFixed(1)} of ${prog.duration?.toFixed(0)} s simulated` : prog.stage === 'steady' ? 'Balancing flows and heads…' : prog.stage === 'checks' ? 'Checking limits, cavities and slams…' : 'Results ready'}</span>
          <span>{left !== null ? `about ${left < 1 ? '1' : left.toFixed(0)} s left` : ''}</span>
        </div>
        {chart}
        {chart && <div className="run-legend small muted"><span><i className="lg-steady" />steady</span><span><i className="lg-max" />highest so far</span><span><i className="lg-min" />lowest so far</span></div>}
        {prog.stage !== 'done' && <div className="run-foot"><button className="btn small" onClick={onCancel}>Cancel</button></div>}
      </div>
    </div>
  );
}
