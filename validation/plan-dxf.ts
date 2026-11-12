// A plan drawing (DXF) made from a known network, the way a drafter would draw it: pipes as polylines with their
// bends on a pipe layer, pumps and valves as symbols on short lines, tanks and reservoirs as symbols with their top
// water level, an invert level next to every junction, the size next to every pipe, air valves at the high points,
// hydrants, roads, contours and a title as clutter. Used to check the plan reader against the network it came from.
import type { Network } from '../src/engine/types';

export interface PlanDxfOptions { units: 'm' | 'ft'; clutter?: boolean }

export function netToPlanDxf(net: Network, o: PlanDxfOptions): string {
  const E: string[] = [];
  const f = (v: number) => (Math.round(v * 1000) / 1000).toString();
  const zu = o.units === 'ft' ? 1 / 0.3048 : 1; // levels written in the drawing units
  const off = o.units === 'ft' ? 2 : 0.6; // text offset from what it labels
  const node = new Map(net.nodes.map((n) => [n.id, n]));
  const poly = (layer: string, pts: { x: number; y: number }[]) => { E.push('0', 'LWPOLYLINE', '8', layer, '90', String(pts.length), '70', '0'); for (const p of pts) E.push('10', f(p.x), '20', f(p.y)); };
  const insert = (block: string, x: number, y: number) => E.push('0', 'INSERT', '8', 'W-SYMBOLS', '2', block, '10', f(x), '20', f(y));
  const text = (layer: string, s: string, x: number, y: number) => E.push('0', 'TEXT', '8', layer, '10', f(x), '20', f(y), '40', '2', '1', s);
  for (const p of net.pipes) {
    const a = node.get(p.from)!, b = node.get(p.to)!;
    const pts = [a, ...(p.vertices ?? []), b];
    poly('W-PIPE', pts);
    // the size beside the longest segment, just off the line
    let k = 0, best = -1;
    for (let i = 0; i + 1 < pts.length; i++) { const L = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y); if (L > best) { best = L; k = i; } }
    const p0 = pts[k], p1 = pts[k + 1], L = Math.max(best, 1e-9);
    const mx = (p0.x + p1.x) / 2 - ((p1.y - p0.y) / L) * off, my = (p0.y + p1.y) / 2 + ((p1.x - p0.x) / L) * off;
    const D = p.diameter * 1000;
    text('W-TEXT', o.units === 'ft' ? `${Math.round(D / 25.4)}" DI` : `DN${Math.round(D)} DI K9`, mx, my);
  }
  // pumps and valves: a short line with the symbol on it
  for (const l of [...net.pumps.map((p) => ({ ...p, sym: 'PUMP' })), ...net.valves.map((v) => ({ ...v, sym: v.check ? 'NRV' : 'GATE-VALVE' }))]) {
    const a = node.get(l.from)!, b = node.get(l.to)!;
    poly('W-PIPE', [a, b]);
    insert(l.sym, (a.x + b.x) / 2, (a.y + b.y) / 2);
  }
  // levels at the junctions; sources with their water level
  for (const n of net.nodes) {
    if (n.kind === 'reservoir') {
      insert(n.storage ? 'TANK' : 'RES', n.x, n.y);
      const wl = n.storage ? n.elev + (n.storage.initLevel ?? 0) : n.head ?? n.elev;
      text('W-TEXT', `TWL ${f(wl * zu)}`, n.x + off * 2, n.y + off * 2);
    } else text('W-TEXT', `IL ${(n.elev * zu).toFixed(2)}`, n.x + off, n.y + off);
  }
  // air valves at the high points (above every neighbour)
  const nb = new Map<string, string[]>();
  for (const p of net.pipes) { nb.set(p.from, [...(nb.get(p.from) ?? []), p.to]); nb.set(p.to, [...(nb.get(p.to) ?? []), p.from]); }
  for (const n of net.nodes) if (n.kind === 'junction' && (nb.get(n.id)?.length ?? 0) >= 2 && nb.get(n.id)!.every((m) => node.get(m)!.elev < n.elev - 0.5)) insert('ARV', n.x, n.y);
  if (o.clutter) {
    const xs = net.nodes.map((n) => n.x), ys = net.nodes.map((n) => n.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    // roads beside some pipes, a frame, contours, a title, hydrants and a north arrow
    net.pipes.forEach((p, i) => { if (i % 7) return; const a = node.get(p.from)!, b = node.get(p.to)!; const L = Math.hypot(b.x - a.x, b.y - a.y) || 1, d = off * 15; poly('ROAD-EDGE', [{ x: a.x - ((b.y - a.y) / L) * d, y: a.y + ((b.x - a.x) / L) * d }, { x: b.x - ((b.y - a.y) / L) * d, y: b.y + ((b.x - a.x) / L) * d }]); });
    poly('BORDER', [{ x: x0 - 50, y: y0 - 50 }, { x: x1 + 50, y: y0 - 50 }, { x: x1 + 50, y: y1 + 50 }, { x: x0 - 50, y: y1 + 50 }, { x: x0 - 50, y: y0 - 50 }]);
    for (let c = 0; c < 6; c++) { const yy = y0 + ((c + 0.5) / 6) * (y1 - y0); poly('CONTOURS', Array.from({ length: 12 }, (_, i) => ({ x: x0 + (i / 11) * (x1 - x0), y: yy + Math.sin(i + c) * (y1 - y0) * 0.02 }))); text('CONTOURS', `${200 + c * 5}`, x0, yy); }
    text('TITLE', `${net.name.toUpperCase()} - DISTRIBUTION SYSTEM PLAN`, x0, y0 - 40);
    net.nodes.forEach((n, i) => { if (i % 25 === 3 && n.kind === 'junction') insert('FH', n.x + off * 3, n.y - off * 3); });
    insert('NORTH', x1, y1 + 30);
  }
  return ['0', 'SECTION', '2', 'ENTITIES', ...E, '0', 'ENDSEC', '0', 'EOF'].join('\n');
}
