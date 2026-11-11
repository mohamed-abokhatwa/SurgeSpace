// Drawing to scale: the network on an A3 or A1 sheet (SVG in millimetres) with a standard scale, scale bar, north
// arrow, notes, title block and, after a run, pipes coloured by maximum pressure (red where the class is exceeded).
// Print at 100 % (actual size) or import into CAD/illustration software.
import type { TransientResult } from '../engine/transient';
import type { Network } from '../engine/types';

const SHEETS = { A3: [420, 297], A1: [841, 594] } as const;
const SCALES = [100, 200, 250, 500, 1000, 1250, 2000, 2500, 5000, 10000, 12500, 20000, 25000, 50000, 100000];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function plotSVG(net: Network, r: TransientResult | null, o: { sheet?: 'A3' | 'A1'; title?: string; by?: string } = {}): { svg: string; scale: number } {
  const [W, H] = SHEETS[o.sheet ?? 'A3'];
  const m = 10, tb = 28; // margin, title block height
  const aw = W - 2 * m, ah = H - 2 * m - tb;
  const pts = [...net.nodes.map((n) => [n.x, n.y]), ...net.pipes.flatMap((p) => (p.vertices ?? []).map((v) => [v.x, v.y])), ...(net.annotations ?? []).map((a) => [a.x, a.y])];
  const x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0])), y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]));
  const need = Math.max((x1 - x0) / (aw * 0.9), (y1 - y0) / (ah * 0.9)) * 1000; // metres per metre of paper
  const N = SCALES.find((s) => s >= need) ?? Math.ceil(need / 100000) * 100000;
  const k = 1000 / N; // mm of paper per m
  const cx = m + aw / 2 - ((x0 + x1) / 2) * k, cy = m + ah / 2 + ((y0 + y1) / 2) * k;
  const X = (x: number) => +(cx + x * k).toFixed(2), Y = (y: number) => +(cy - y * k).toFixed(2);
  const xy = new Map(net.nodes.map((n) => [n.id, n]));
  const env = new Map((r?.envelopes ?? []).map((e) => [e.id, e]));
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" font-family="Arial, sans-serif">`);
  out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/><rect x="${m}" y="${m}" width="${aw}" height="${H - 2 * m}" fill="none" stroke="#000" stroke-width="0.5"/>`);
  out.push(`<g fill="none" stroke-linecap="round" stroke-linejoin="round">`);
  for (const p of net.pipes) {
    const a = xy.get(p.from), b = xy.get(p.to);
    if (!a || !b) continue;
    const e = env.get(p.id);
    let mx = NaN;
    if (e) { mx = -Infinity; for (let i = 0; i < e.s.length; i++) mx = Math.max(mx, e.hMax[i] - e.z[i]); }
    const over = p.pressureClass && mx > p.pressureClass;
    const col = !e ? '#1f2937' : over ? '#dc2626' : mx > 0.9 * (p.pressureClass ?? Infinity) ? '#f59e0b' : '#2563eb';
    const d = [a, ...(p.vertices ?? []), b].map((q, i) => `${i ? 'L' : 'M'}${X(q.x)} ${Y(q.y)}`).join(' ');
    out.push(`<path d="${d}" stroke="${col}" stroke-width="${Math.min(1.6, 0.35 + p.diameter * 1.2).toFixed(2)}"/>`);
  }
  out.push('</g><g font-size="2.2" fill="#111">');
  for (const p of net.pipes) {
    const a = xy.get(p.from), b = xy.get(p.to);
    if (!a || !b) continue;
    out.push(`<text x="${X((a.x + b.x) / 2)}" y="${Y((a.y + b.y) / 2) - 1}" text-anchor="middle" fill="#374151">${esc(p.id)} DN${Math.round(p.diameter * 1000)}</text>`);
  }
  for (const n of net.nodes) {
    const isSrc = n.kind === 'reservoir';
    out.push(isSrc ? `<rect x="${X(n.x) - 1.6}" y="${Y(n.y) - 1.6}" width="3.2" height="3.2" fill="#0ea5e9" stroke="#000" stroke-width="0.25"/>` : `<circle cx="${X(n.x)}" cy="${Y(n.y)}" r="${n.vessel || n.airValve || n.tank ? 1.1 : 0.6}" fill="${n.vessel || n.airValve || n.tank ? '#f97316' : '#fff'}" stroke="#000" stroke-width="0.25"/>`);
    const dev = [n.vessel && 'AV', n.airValve && 'ARV', n.tank && 'ST', n.relief && 'PRV', n.sav && 'SAV'].filter(Boolean).join(' ');
    out.push(`<text x="${X(n.x) + 1.8}" y="${Y(n.y) + 3}">${esc(n.id)}${dev ? ` [${dev}]` : ''}</text>`);
  }
  for (const k2 of [...net.pumps, ...net.valves]) {
    const a = xy.get(k2.from), b = xy.get(k2.to);
    if (a && b) out.push(`<text x="${X((a.x + b.x) / 2)}" y="${Y((a.y + b.y) / 2) - 2.5}" font-weight="bold" text-anchor="middle">${esc(k2.id)}</text>`);
  }
  for (const a of net.annotations ?? []) out.push(`<text x="${X(a.x)}" y="${Y(a.y)}" fill="#92400e" font-style="italic">${a.text.split('\n').map((l, i) => `<tspan x="${X(a.x)}" dy="${i ? 2.8 : 0}">${esc(l)}</tspan>`).join('')}</text>`);
  out.push('</g>');
  // north arrow and scale bar
  const nx = m + aw - 12, ny = m + 14;
  out.push(`<g stroke="#000" stroke-width="0.3"><path d="M${nx} ${ny - 8} L${nx - 3} ${ny + 2} L${nx} ${ny} L${nx + 3} ${ny + 2} Z" fill="#000"/></g><text x="${nx}" y="${ny + 6}" font-size="3.5" text-anchor="middle">N</text>`);
  const bar = [1, 2, 5].flatMap((d) => [d, d * 10, d * 100, d * 1000]).sort((a, b) => a - b).filter((v) => v * k <= 60).pop() ?? 10;
  const bx = m + 6, by = H - m - tb - 8;
  out.push(`<g stroke="#000" stroke-width="0.3"><rect x="${bx}" y="${by}" width="${(bar * k) / 2}" height="1.5" fill="#000"/><rect x="${bx + (bar * k) / 2}" y="${by}" width="${(bar * k) / 2}" height="1.5" fill="#fff"/></g>`);
  out.push(`<text x="${bx}" y="${by - 1.5}" font-size="2.5">0</text><text x="${bx + bar * k}" y="${by - 1.5}" font-size="2.5" text-anchor="middle">${bar} m</text>`);
  if (r) out.push(`<g font-size="2.5"><text x="${bx + bar * k + 10}" y="${by + 1.5}">Pipes: <tspan fill="#2563eb">max pressure within 90 % of class</tspan> · <tspan fill="#f59e0b">90–100 %</tspan> · <tspan fill="#dc2626">over class</tspan></text></g>`);
  // title block
  const tx = m, ty = H - m - tb;
  out.push(`<g stroke="#000" stroke-width="0.4" fill="none"><line x1="${tx}" y1="${ty}" x2="${W - m}" y2="${ty}"/><line x1="${W - m - 150}" y1="${ty}" x2="${W - m - 150}" y2="${H - m}"/><line x1="${W - m - 60}" y1="${ty}" x2="${W - m - 60}" y2="${H - m}"/></g>`);
  out.push(`<text x="${tx + 4}" y="${ty + 10}" font-size="6" font-weight="bold">${esc(o.title ?? net.name)}</text><text x="${tx + 4}" y="${ty + 18}" font-size="3">${esc((net.description ?? '').length > 110 ? `${(net.description ?? '').slice(0, 108)}…` : net.description ?? '')}</text>`);
  out.push(`<text x="${W - m - 146}" y="${ty + 8}" font-size="3">Prepared by: ${esc(o.by ?? net.report?.preparedBy ?? '')}</text><text x="${W - m - 146}" y="${ty + 14}" font-size="3">Project no.: ${esc(net.report?.projectNo ?? '')}</text><text x="${W - m - 146}" y="${ty + 20}" font-size="3">Date: ${new Date().toISOString().slice(0, 10)}</text>`);
  out.push(`<text x="${W - m - 56}" y="${ty + 10}" font-size="6" font-weight="bold">1:${N}</text><text x="${W - m - 56}" y="${ty + 17}" font-size="3">at ${o.sheet ?? 'A3'} · SurgeSpace</text>`);
  out.push('</svg>');
  return { svg: out.join('\n'), scale: N };
}
