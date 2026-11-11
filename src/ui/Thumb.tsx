// Small drawing of a network for cards (start page, recent projects, examples).
import type { Network } from '../engine/types';

export function NetThumb({ net, w = 220, h = 120, colour = 'var(--thumb-pipe)' }: { net: Pick<Network, 'nodes' | 'pipes' | 'pumps' | 'valves'>; w?: number; h?: number; colour?: string }) {
  const nodes = net.nodes;
  if (!nodes.length) return <svg width={w} height={h} className="thumb" aria-hidden="true" />;
  const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = 12, sx = (w - 2 * pad) / Math.max(x1 - x0, 1e-9), sy = (h - 2 * pad) / Math.max(y1 - y0, 1e-9);
  const s = Math.min(sx, sy);
  const ox = (w - (x1 - x0) * s) / 2, oy = (h - (y1 - y0) * s) / 2;
  const P = new Map(nodes.map((n) => [n.id, [ox + (n.x - x0) * s, oy + (n.y - y0) * s] as const]));
  const many = net.pipes.length > 400;
  const d = net.pipes.map((p) => { const a = P.get(p.from), b = P.get(p.to); return a && b ? `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}` : ''; }).join('');
  const links = [...net.pumps, ...net.valves];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="thumb" aria-hidden="true">
      <path d={d} fill="none" stroke={colour} strokeWidth={many ? 0.8 : 1.8} strokeLinecap="round" strokeLinejoin="round" />
      {!many && nodes.filter((n) => n.kind === 'reservoir').map((n) => { const p = P.get(n.id)!; return <rect key={n.id} x={p[0] - 4} y={p[1] - 4} width={8} height={8} rx={1.5} fill="var(--thumb-source)" />; })}
      {!many && links.map((l) => { const a = P.get(l.from), b = P.get(l.to); if (!a || !b) return null; return <circle key={l.id} cx={(a[0] + b[0]) / 2} cy={(a[1] + b[1]) / 2} r={3.2} fill="var(--accent)" />; })}
      {!many && nodes.filter((n) => n.vessel || n.airValve || n.tank).map((n) => { const p = P.get(n.id)!; return <circle key={`d${n.id}`} cx={p[0]} cy={p[1]} r={2.4} fill="none" stroke="var(--thumb-device)" strokeWidth={1.4} />; })}
    </svg>
  );
}
