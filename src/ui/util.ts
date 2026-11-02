import type { Network } from '../engine/types';

export const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }) : '—');

/** Pressure head colour: vapour/negative red → amber at 0 → teal → blue → violet near class. */
export function pressureColor(p: number, cls = 100): string {
  if (!Number.isFinite(p)) return '#888';
  if (p < -5) return '#dc2626';
  if (p < 0) return mix('#dc2626', '#f59e0b', (p + 5) / 5);
  if (p < 10) return mix('#f59e0b', '#14b8a6', p / 10);
  const r = Math.min(1, (p - 10) / Math.max(cls - 10, 1));
  if (r < 0.7) return mix('#14b8a6', '#3b82f6', r / 0.7);
  if (r < 1) return mix('#3b82f6', '#a855f7', (r - 0.7) / 0.3);
  return '#e11d48';
}

function mix(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * Math.max(0, Math.min(1, t))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export interface Hop {
  kind: 'pipe' | 'pump' | 'valve';
  id: string;
  from: string;
  to: string;
  reversed: boolean;
  length: number;
}

/** Shortest route (by length) between two nodes, through pipes, pumps and valves. */
export function findPath(net: Network, a: string, b: string): Hop[] | null {
  const links: Hop[] = [
    ...net.pipes.filter((p) => !p.closed).map((p) => ({ kind: 'pipe' as const, id: p.id, from: p.from, to: p.to, reversed: false, length: p.length })),
    ...net.pumps.map((p) => ({ kind: 'pump' as const, id: p.id, from: p.from, to: p.to, reversed: false, length: 0 })),
    ...net.valves.map((v) => ({ kind: 'valve' as const, id: v.id, from: v.from, to: v.to, reversed: false, length: 0 })),
  ];
  const adj = new Map<string, Hop[]>();
  for (const l of links) {
    adj.set(l.from, [...(adj.get(l.from) ?? []), l]);
    adj.set(l.to, [...(adj.get(l.to) ?? []), { ...l, from: l.to, to: l.from, reversed: true }]);
  }
  const dist = new Map<string, number>([[a, 0]]);
  const prev = new Map<string, Hop>();
  const todo = new Set(net.nodes.map((n) => n.id));
  while (todo.size) {
    let u = '';
    let best = Infinity;
    for (const n of todo) {
      const d = dist.get(n) ?? Infinity;
      if (d < best) { best = d; u = n; }
    }
    if (!u || best === Infinity) break;
    todo.delete(u);
    if (u === b) break;
    for (const h of adj.get(u) ?? []) {
      const nd = best + h.length + 1e-6;
      if (nd < (dist.get(h.to) ?? Infinity)) { dist.set(h.to, nd); prev.set(h.to, h); }
    }
  }
  if (!prev.has(b) && a !== b) return null;
  const path: Hop[] = [];
  let cur = b;
  while (cur !== a) {
    const h = prev.get(cur)!;
    path.unshift(h);
    cur = h.from;
  }
  return path;
}

/** Default profile route: from the first source (reservoir) to the farthest node by length. */
export function defaultRoute(net: Network): [string, string] {
  const src = net.nodes.find((n) => n.kind === 'reservoir' && (net.pumps.some((p) => p.from !== n.id) || true));
  const pumpSuction = net.pumps[0]?.from;
  const start = pumpSuction ? net.nodes.find((n) => n.kind === 'reservoir' && net.pipes.some((p) => (p.from === n.id && p.to === pumpSuction) || (p.to === n.id && p.from === pumpSuction)))?.id ?? src?.id : src?.id;
  if (!start) return [net.nodes[0]?.id ?? '', net.nodes[net.nodes.length - 1]?.id ?? ''];
  let far = start, farD = -1;
  for (const n of net.nodes) {
    if (n.id === start) continue;
    const p = findPath(net, start, n.id);
    if (!p) continue;
    const d = p.reduce((s, h) => s + h.length, 0);
    if (d > farD) { farD = d; far = n.id; }
  }
  return [start, far];
}

export function download(name: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
