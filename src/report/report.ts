// Detailed transient analysis report: a self-contained HTML document (tables and SVG charts, no external files)
// that prints to A4 / PDF. Sections follow the usual surge study layout: title page, summary of findings,
// model and method, input data, steady state, transient results, protection devices, checks, time histories.
import type { Check } from '../engine/analysis';
import { valveArea } from '../engine/devices';
import type { TransientResult } from '../engine/transient';
import { G, HB, HV, area, type CheckValveSpec, type Network } from '../engine/types';
import { buildProfile } from '../ui/ProfileView';
import { defaultRoute } from '../ui/util';

export interface ReportOptions {
  version: string;
  licensee?: string;
  route?: [string, string];
  /** Extra nodes to plot over time (the selected nodes in the app). */
  nodes?: string[];
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const f = (x: number | undefined, d = 2) => (x === undefined || !Number.isFinite(x) ? '–' : x.toFixed(d));
const DEFAULT_CLASS = 100;

// ── SVG line chart ──────────────────────────────────────────────────────────
interface S { name: string; color: string; x: ArrayLike<number>; y: ArrayLike<number>; dash?: string; width?: number; fill?: boolean }
function niceStep(range: number, n: number) {
  const raw = range / Math.max(n, 1);
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}
function thin(x: ArrayLike<number>, y: ArrayLike<number>, max = 700) {
  // keep the min and max of each bucket so peaks survive
  const n = Math.min(x.length, y.length);
  if (n <= max) return { x: Array.from({ length: n }, (_, k) => x[k]), y: Array.from({ length: n }, (_, k) => y[k]) };
  const bx: number[] = [], by: number[] = [];
  const per = Math.ceil(n / (max / 2));
  for (let k = 0; k < n; k += per) {
    let lo = k, hi = k;
    for (let j = k; j < Math.min(n, k + per); j++) { if (y[j] < y[lo]) lo = j; if (y[j] > y[hi]) hi = j; }
    for (const j of lo < hi ? [lo, hi] : [hi, lo]) { bx.push(x[j]); by.push(y[j]); }
  }
  return { x: bx, y: by };
}
export function svgChart(series: S[], o: { xLabel: string; yLabel: string; width?: number; height?: number; markers?: { x: number; label: string }[] }) {
  const W = o.width ?? 720, H = o.height ?? 260, L = 58, R = 14, T = 14, B = 52;
  const data = series.map((s) => ({ ...s, ...thin(s.x, s.y) }));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of data) for (let k = 0; k < s.x.length; k++) {
    if (!Number.isFinite(s.y[k])) continue;
    x0 = Math.min(x0, s.x[k]); x1 = Math.max(x1, s.x[k]); y0 = Math.min(y0, s.y[k]); y1 = Math.max(y1, s.y[k]);
  }
  if (!Number.isFinite(x0)) return '<p class="muted">No data.</p>';
  if (x1 === x0) x1 = x0 + 1;
  if (y1 - y0 < 1e-9) { y0 -= 1; y1 += 1; }
  const pad = (y1 - y0) * 0.06; y0 -= pad; y1 += pad;
  const sx = (x: number) => L + ((x - x0) / (x1 - x0)) * (W - L - R);
  const sy = (y: number) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const parts: string[] = [];
  const xs = niceStep(x1 - x0, 8), ys = niceStep(y1 - y0, 6);
  for (let v = Math.ceil(x0 / xs) * xs; v <= x1 + 1e-9; v += xs) parts.push(`<line x1="${sx(v)}" x2="${sx(v)}" y1="${T}" y2="${H - B}" class="g"/><text x="${sx(v)}" y="${H - B + 14}" text-anchor="middle">${+v.toFixed(6)}</text>`);
  for (let v = Math.ceil(y0 / ys) * ys; v <= y1 + 1e-9; v += ys) parts.push(`<line x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}" class="g"/><text x="${L - 6}" y="${sy(v) + 3.5}" text-anchor="end">${+v.toFixed(6)}</text>`);
  for (const m of o.markers ?? []) parts.push(`<line x1="${sx(m.x)}" x2="${sx(m.x)}" y1="${T}" y2="${H - B}" class="mk"/><text x="${sx(m.x) + 2}" y="${T + 9}" class="mkt">${esc(m.label)}</text>`);
  for (const s of data) {
    let d = '';
    for (let k = 0; k < s.x.length; k++) if (Number.isFinite(s.y[k])) d += `${d ? 'L' : 'M'}${sx(s.x[k]).toFixed(1)},${sy(s.y[k]).toFixed(1)}`;
    parts.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width ?? 1.4}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/>`);
  }
  parts.push(`<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" class="frame"/>`);
  parts.push(`<text x="${(L + W - R) / 2}" y="${H - B + 30}" text-anchor="middle" class="ax">${esc(o.xLabel)}</text>`);
  parts.push(`<text transform="translate(14 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle" class="ax">${esc(o.yLabel)}</text>`);
  // legend
  let lx = L;
  for (const s of data) {
    const w = 26 + s.name.length * 5.6;
    if (lx + w > W - R) break;
    parts.push(`<line x1="${lx}" x2="${lx + 18}" y1="${H - 9}" y2="${H - 9}" stroke="${s.color}" stroke-width="2"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/><text x="${lx + 22}" y="${H - 5}">${esc(s.name)}</text>`);
    lx += w;
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;
}

type Cell = string | number | { html: string };
function table(head: string[], rows: Cell[][], opt: { cls?: string; max?: number } = {}) {
  const max = opt.max ?? 3000;
  const body = rows.slice(0, max).map((r) => `<tr>${r.map((c) => `<td>${typeof c === 'number' ? c : typeof c === 'object' ? c.html : esc(c)}</td>`).join('')}</tr>`).join('');
  const more = rows.length > max ? `<p class="muted">${rows.length - max} more rows not shown (export the envelopes as CSV for all of them).</p>` : '';
  return `<table class="${opt.cls ?? ''}"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>${more}`;
}

const cvText = (s: CheckValveSpec | undefined) => {
  if (!s || s.mode === 'ideal') return 'ideal';
  if (s.mode === 'delay') return `delay ${f(s.delay ?? 0, 2)} s, closes in ${f(s.closeTime ?? 0, 2)} s`;
  if (s.mode === 'velocity') return `closes at ${f(s.reverseVelocity ?? 0, 2)} m/s reverse, in ${f(s.closeTime ?? 0, 2)} s`;
  return `dynamic (${(s.dynamic ?? []).map(([a, b]) => `${a}→${b}`).join(', ')})`;
};

export function buildReport(net: Network, r: TransientResult, checks: Check[], opt: ReportOptions): string {
  const now = new Date();
  const info = net.report ?? {};
  const st = net.settings;
  const ev = net.event;
  const nodeById = new Map(net.nodes.map((n) => [n.id, n]));
  const junctions = net.nodes.filter((n) => n.kind === 'junction');
  const envById = new Map(r.envelopes.map((e) => [e.id, e]));
  const fails = checks.filter((c) => c.level === 'fail'), warns = checks.filter((c) => c.level === 'warn');

  // worst points
  let worstMax = { p: -Infinity, pipe: '', s: 0, cls: DEFAULT_CLASS, t: 0 }, worstMin = { p: Infinity, pipe: '', s: 0, t: 0 }, cav = { v: 0, pipe: '', s: 0 };
  const pipeRows: (string | number)[][] = [];
  for (const p of net.pipes) {
    const e = envById.get(p.id);
    const q = r.steady.flows[p.id] ?? 0;
    const A = area(p.diameter);
    if (!e) { pipeRows.push([p.id, p.from, p.to, f(q * 1000, 1), f(q / A, 2), '–', '–', '–', '–', '–', '–', p.closed ? 'closed' : '–']); continue; }
    let iMax = 0, iMin = 0, vC = 0;
    for (let i = 0; i < e.s.length; i++) {
      if (e.hMax[i] - e.z[i] > e.hMax[iMax] - e.z[iMax]) iMax = i;
      if (e.hMin[i] - e.z[i] < e.hMin[iMin] - e.z[iMin]) iMin = i;
      vC = Math.max(vC, e.cavMax[i]);
    }
    const pMax = e.hMax[iMax] - e.z[iMax], pMin = e.hMin[iMin] - e.z[iMin];
    const cls = p.pressureClass ?? DEFAULT_CLASS;
    if (pMax > worstMax.p) worstMax = { p: pMax, pipe: p.id, s: e.s[iMax], cls, t: e.tMax[iMax] };
    if (pMin < worstMin.p) worstMin = { p: pMin, pipe: p.id, s: e.s[iMin], t: e.tMin[iMin] };
    if (vC > cav.v) cav = { v: vC, pipe: p.id, s: e.s[e.cavMax.indexOf(vC)] };
    pipeRows.push([p.id, p.from, p.to, f(q * 1000, 1), f(q / A, 2), f(pMax, 1), `${f(e.s[iMax], 0)} @ ${f(e.tMax[iMax], 2)} s`, f(pMin, 1), `${f(e.s[iMin], 0)} @ ${f(e.tMin[iMin], 2)} s`, `${f(cls, 0)} (${Math.round((pMax / cls) * 100)} %)`, vC > 1e-6 ? f(vC * 1000, 1) : '0', r.rigidPipes.includes(p.id) ? 'rigid' : `${f((r.pipeAdjust[p.id] ?? 0) * 100, 3)} %`]);
  }
  // node results with time of extremes from the pipe ends
  const tAt = (id: string, which: 'tMax' | 'tMin') => {
    for (const p of net.pipes) {
      const e = envById.get(p.id);
      if (!e) continue;
      if (p.from === id) return e[which][0];
      if (p.to === id) return e[which][e.s.length - 1];
    }
    return NaN;
  };
  const nodeRows = junctions.map((n) => {
    const h0 = r.steady.heads[n.id];
    return [n.id, f(n.elev, 2), f((n.demand ?? 0) * 1000, 2), f(h0, 2), f(h0 - n.elev, 2), f(r.nodeMax[n.id], 2), f(r.nodeMax[n.id] - n.elev, 2), f(tAt(n.id, 'tMax'), 2), f(r.nodeMin[n.id], 2), f(r.nodeMin[n.id] - n.elev, 2), f(tAt(n.id, 'tMin'), 2)];
  });

  // ── charts ──
  const route = opt.route ?? defaultRoute(net);
  const prof = route[0] && route[1] ? buildProfile(net, r, route[0], route[1]) : null;
  const profSvg = prof && prof.ch.length > 1 ? svgChart([
    { name: 'Pipe', color: '#6b7280', x: prof.ch, y: prof.z, width: 2 },
    { name: 'Pipe class', color: '#a855f7', x: prof.ch, y: prof.cls, dash: '6 4', width: 1 },
    { name: 'Steady HGL', color: '#2563eb', x: prof.ch, y: prof.steady },
    { name: 'Max head', color: '#dc2626', x: prof.ch, y: prof.max },
    { name: 'Min head', color: '#0891b2', x: prof.ch, y: prof.min },
    { name: 'Vapour', color: '#9ca3af', x: prof.ch, y: prof.z.map((z) => z - HB + HV), dash: '2 3', width: 1 },
  ], { xLabel: `Chainage from ${route[0]} to ${route[1]} (m)`, yLabel: 'Elevation / head (m)', height: 320, markers: prof.markers.length < 25 ? prof.markers : undefined }) : '';
  const t = r.times;
  const keyNodes: string[] = [];
  const add = (id?: string) => { if (id && nodeById.get(id)?.kind === 'junction' && !keyNodes.includes(id) && r.nodeHead[id]) keyNodes.push(id); };
  (opt.nodes ?? []).forEach(add);
  net.pumps.forEach((p) => add(p.to));
  net.nodes.forEach((n) => { if (n.vessel || n.airValve || n.tank || n.sav || n.relief || n.outlet) add(n.id); });
  const wp = net.pipes.find((p) => p.id === worstMax.pipe); if (wp) add(worstMax.s < wp.length / 2 ? wp.from : wp.to);
  const wn = net.pipes.find((p) => p.id === worstMin.pipe); if (wn) add(worstMin.s < wn.length / 2 ? wn.from : wn.to);
  const histCharts = keyNodes.slice(0, 10).map((id) => {
    const n = nodeById.get(id)!;
    return `<figure>${svgChart([{ name: `${id} pressure head`, color: '#e0620c', x: t, y: Array.from(r.nodeHead[id], (h) => h - n.elev) }, { name: 'steady', color: '#9ca3af', x: [t[0], t[t.length - 1]], y: [r.steady.heads[id] - n.elev, r.steady.heads[id] - n.elev], dash: '4 3', width: 1 }], { xLabel: 'Time (s)', yLabel: 'Pressure head (m)', height: 220 })}<figcaption>Pressure head at ${esc(id)} (level ${f(n.elev, 2)} m)</figcaption></figure>`;
  }).join('');
  const devCharts: string[] = [];
  const pumpE = Object.entries(r.pumps);
  if (pumpE.length) devCharts.push(`<figure>${svgChart(pumpE.slice(0, 4).map(([id, p], k) => ({ name: `${id} speed %`, color: ['#e0620c', '#2563eb', '#16a34a', '#a855f7'][k], x: t, y: Array.from(p.speed, (v) => v * 100) })), { xLabel: 'Time (s)', yLabel: 'Speed (%)', height: 220 })}<figcaption>Pump speed</figcaption></figure>`,
    `<figure>${svgChart(pumpE.slice(0, 4).map(([id, p], k) => ({ name: `${id} flow L/s`, color: ['#e0620c', '#2563eb', '#16a34a', '#a855f7'][k], x: t, y: Array.from(p.flow, (v) => v * 1000) })), { xLabel: 'Time (s)', yLabel: 'Flow per pump (L/s)', height: 220 })}<figcaption>Pump flow</figcaption></figure>`);
  for (const [id, v] of Object.entries(r.vessels)) devCharts.push(`<figure>${svgChart([{ name: 'gas volume', color: '#16a34a', x: t, y: v.gas }, { name: 'tank volume', color: '#9ca3af', x: [t[0], t[t.length - 1]], y: [v.volume, v.volume], dash: '4 3', width: 1 }], { xLabel: 'Time (s)', yLabel: 'Volume (m³)', height: 220 })}<figcaption>Hydropneumatic tank ${esc(id)}: gas volume</figcaption></figure>`);
  for (const [id, tk] of Object.entries(r.tanks ?? {})) devCharts.push(`<figure>${svgChart([{ name: 'water level', color: '#0891b2', x: t, y: tk.level }, { name: 'top', color: '#9ca3af', x: [t[0], t[t.length - 1]], y: [tk.top, tk.top], dash: '4 3', width: 1 }, { name: 'bottom', color: '#9ca3af', x: [t[0], t[t.length - 1]], y: [tk.bottom, tk.bottom], dash: '2 3', width: 1 }], { xLabel: 'Time (s)', yLabel: 'Level (m)', height: 220 })}<figcaption>${tk.oneWay ? 'One-way' : 'Surge'} tank ${esc(id)}: water level</figcaption></figure>`);
  for (const [id, c] of Object.entries(r.checkValves ?? {})) if (c.mode !== 'ideal') devCharts.push(`<figure>${svgChart([{ name: 'flow L/s', color: '#2563eb', x: t, y: Array.from(c.flow, (q) => q * 1000) }], { xLabel: 'Time (s)', yLabel: 'Flow (L/s)', height: 220 })}<figcaption>Check valve ${esc(id)}: flow (negative = reverse)</figcaption></figure>`);
  for (const [id, a] of Object.entries(r.airValves)) if (a.maxAir > 1e-4) devCharts.push(`<figure>${svgChart([{ name: 'air volume L', color: '#d97706', x: t, y: Array.from(a.air, (v) => v * 1000) }], { xLabel: 'Time (s)', yLabel: 'Air (L)', height: 220 })}<figcaption>Air valve ${esc(id)}: air in the pipe</figcaption></figure>`);
  const disch = [...Object.entries(r.savs ?? {}).map(([id, v]) => ({ name: `${id} SAV`, q: v.flow })), ...Object.entries(r.reliefs ?? {}).map(([id, v]) => ({ name: `${id} relief`, q: v.flow })), ...Object.entries(r.outlets ?? {}).map(([id, v]) => ({ name: `${id} outlet`, q: v.flow }))];
  if (disch.length) devCharts.push(`<figure>${svgChart(disch.slice(0, 5).map((d, k) => ({ name: `${d.name} L/s`, color: ['#a855f7', '#dc2626', '#0891b2', '#16a34a', '#e0620c'][k], x: t, y: Array.from(d.q, (q) => q * 1000) })), { xLabel: 'Time (s)', yLabel: 'Discharge (L/s)', height: 220 })}<figcaption>Discharge valves and outlets</figcaption></figure>`);
  const moving = Object.entries(r.valves).filter(([id, v]) => !id.endsWith('-CV') && v.opening.length && Math.max(...v.opening) - Math.min(...v.opening) > 1e-6);
  if (moving.length) devCharts.push(`<figure>${svgChart(moving.slice(0, 5).map(([id, v], k) => ({ name: `${id} area %`, color: ['#e0620c', '#2563eb', '#16a34a', '#a855f7', '#dc2626'][k], x: t, y: Array.from(v.opening, (q) => q * 100) })), { xLabel: 'Time (s)', yLabel: 'Flow area (% of open)', height: 220 })}<figcaption>Valve movement</figcaption></figure>`);

  // ── input tables ──
  const devRows: (string | number)[][] = [];
  for (const n of net.nodes) {
    const v = n.vessel;
    if (v) devRows.push([n.id, 'Hydropneumatic tank', `${f(v.volume, 2)} m³ ${v.shape ?? 'vertical'}${v.diameter ? ` Ø${f(v.diameter, 2)} m` : ''}; ${v.gasInput === 'precharge' ? `pre-charge ${f(v.prechargeHead, 1)} m${v.bladder ? ', bladder' : ''}` : `gas ${f(v.gasVolume, 2)} m³`}; n = ${v.n}; connection Ø${f(v.connDiameter * 1000, 0)} mm${v.connLength ? ` × ${f(v.connLength, 1)} m` : ''}; ${v.inlet === 'checkBypass' ? `check valve with Ø${f((v.bypassDiameter ?? 0) * 1000, 0)} mm bypass (K ${v.bypassK ?? 1})` : `K in ${v.kIn} / out ${v.kOut}`}${v.dipTubeHeight ? `; dip tube ${f(v.dipTubeHeight, 2)} m` : ''}`]);
    const a = n.airValve;
    if (a) devRows.push([n.id, 'Air valve', `${a.type ?? 'double'}${a.treatAsJunction ? ' (treated as junction: off)' : ''}; in Ø${f(a.inDiameter * 1000, 1)} mm, out Ø${f(a.outDiameter * 1000, 1)} mm${a.smallDiameter ? `, small Ø${f(a.smallDiameter * 1000, 1)} mm` : ''}${a.switchHead ? `, switch ${a.switchHead} m` : ''}; Cd ${a.cdIn ?? 0.6}/${a.cdOut ?? 0.6}`]);
    const tk = n.tank;
    if (tk) devRows.push([n.id, tk.oneWay ? 'One-way tank' : 'Surge tank', `Ø${f(tk.diameter, 2)} m, bottom ${f(tk.bottomElev, 2)} m, top ${f(tk.topElev, 2)} m; connection Ø${f(tk.connDiameter * 1000, 0)} mm, K in ${tk.kIn} / out ${tk.kOut}${tk.oneWay ? `; level ${f(tk.initialLevel, 2)} m` : ''}`]);
    const sv = n.sav;
    if (sv) devRows.push([n.id, 'Surge anticipation valve', `Ø${f(sv.diameter * 1000, 0)} mm, Cd ${sv.cd ?? 0.6}; opens below ${f(sv.lowSet, 1)} m${sv.highSet ? ` or above ${f(sv.highSet, 1)} m` : ''}; open ${sv.openTime} s, hold ${sv.holdTime} s, close ${sv.closeTime} s`]);
    const rv = n.relief;
    if (rv) devRows.push([n.id, 'Pressure relief valve', `set ${f(rv.setHead, 1)} m; ${rv.diameter ? `Ø${f(rv.diameter * 1000, 0)} mm, Cd ${rv.cd ?? 0.7}${rv.accumulation ? `, full open at +${rv.accumulation} m` : ''}` : `${f(rv.capacity * 1000, 1)} L/s at +10 m`}`]);
    const o = n.outlet;
    if (o) devRows.push([n.id, o.trigger === 'pressure' ? 'Rupture disk' : 'Discharge to atmosphere', `Ø${f(o.diameter * 1000, 0)} mm, Cd ${o.cd ?? 0.6}; ${o.trigger === 'pressure' ? `bursts at ${f(o.burstHead, 1)} m` : `opens at ${f(o.time ?? 0, 2)} s`}, opening time ${f(o.openTime ?? 0, 2)} s`]);
  }
  for (const p of net.pipes) if (p.checkValve) devRows.push([p.id, 'Check valve in pipe', `at ${p.from}; ${cvText(p.checkValve)}; K ${p.checkValve.kOpen ?? 1}`]);

  const evText = ev.kind === 'pumpTrip'
    ? `${ev.pumpMode === 'start' ? 'Pump start' : ev.pumpMode === 'ramp' ? 'Controlled pump stop' : 'Pump trip (power failure)'} of ${ev.targets.join(', ') || '—'} at ${ev.start} s${ev.pumpMode && ev.pumpMode !== 'trip' ? `, ramp ${ev.duration ?? 0} s` : ''}.`
    : ev.kind === 'none' ? 'No event (steady state held).'
      : `Valve ${ev.kind === 'valveClose' ? 'closure' : 'opening'} of ${ev.targets.join(', ')} at ${ev.start} s: ${ev.curve ? `operating curve ${ev.curve.map(([a, b]) => `${a} s → ${b}`).join(', ')}` : `stroke ${ev.duration ?? 0} s to ${ev.finalOpening ?? (ev.kind === 'valveClose' ? 0 : 1)}, law exponent ${ev.exponent ?? 1}`}.`;

  const slams = (r.slams ?? []).filter((s) => s.joukowsky >= 0.5);
  const summaryRows: (string | number)[][] = [
    ['Highest pressure', `${f(worstMax.p, 1)} m in ${worstMax.pipe} at ${f(worstMax.s, 0)} m, t = ${f(worstMax.t, 2)} s (${Math.round((worstMax.p / worstMax.cls) * 100)} % of class ${f(worstMax.cls, 0)} m)`],
    ['Lowest pressure', `${f(worstMin.p, 1)} m in ${worstMin.pipe} at ${f(worstMin.s, 0)} m, t = ${f(worstMin.t, 2)} s (limit ${st.minPressure} m)`],
    ['Column separation', cav.v > 1e-4 ? `largest cavity ${f(cav.v * 1000, 0)} L in ${cav.pipe} at ${f(cav.s, 0)} m` : 'none'],
    ['Slams', slams.length ? slams.slice(0, 5).map((s) => `${s.kind === 'airValve' ? 'air valve' : 'check valve'} ${s.id} at ${f(s.t, 2)} s, a·v/g = ${f(s.joukowsky, 1)} m`).join('; ') : 'none'],
    ['Design checks', `${fails.length} to fix, ${warns.length} warnings, ${checks.filter((c) => c.level === 'pass').length} passed`],
  ];

  const css = `
  @page { size: A4; margin: 14mm 12mm 16mm; }
  * { box-sizing: border-box; }
  body { font: 10.5pt/1.45 "IBM Plex Sans", "Segoe UI", system-ui, sans-serif; color: #1c1917; background: #fff; margin: 0; padding: 18px; max-width: 980px; margin: 0 auto; }
  h1 { font-size: 22pt; margin: 0 0 4px; letter-spacing: -0.01em; }
  h2 { font-size: 13.5pt; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #e0620c; break-after: avoid; }
  h3 { font-size: 11pt; margin: 14px 0 6px; break-after: avoid; }
  .muted { color: #6b6460; }
  .title { min-height: 230mm; display: flex; flex-direction: column; justify-content: space-between; break-after: page; }
  .brand { color: #e0620c; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; font-size: 9pt; }
  .meta td { padding: 4px 14px 4px 0; border: 0; }
  .meta td:first-child { color: #6b6460; width: 34%; }
  table { border-collapse: collapse; width: 100%; font-size: 8.6pt; margin: 6px 0 10px; }
  th { background: #f3efeb; text-align: left; font-weight: 600; }
  th, td { border: 1px solid #ddd5ce; padding: 3px 5px; vertical-align: top; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  .kv td:first-child { width: 28%; font-weight: 600; background: #faf8f6; }
  .lvl { font-weight: 700; text-transform: uppercase; font-size: 7.5pt; }
  .fail { color: #b91c1c; } .warn { color: #b45309; } .pass { color: #15803d; } .info { color: #0e7490; }
  figure { margin: 6px 0 12px; break-inside: avoid; }
  figcaption { font-size: 8.6pt; color: #6b6460; margin-top: 2px; }
  .charts2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 14px; }
  svg.chart { width: 100%; height: auto; font: 9px "IBM Plex Sans", system-ui, sans-serif; fill: #44403c; }
  svg .g { stroke: #ece6e0; stroke-width: 1; } svg .frame { fill: none; stroke: #a8a29e; }
  svg .ax { font-size: 10px; fill: #1c1917; } svg .mk { stroke: #c8bfb8; stroke-dasharray: 2 3; } svg .mkt { font-size: 8px; fill: #6b6460; }
  .page { break-before: page; }
  .foot { margin-top: 24px; font-size: 8pt; color: #6b6460; border-top: 1px solid #ddd5ce; padding-top: 6px; }
  @media print { body { padding: 0; } .noprint { display: none; } }
  `;
  const settingsRows = [
    ['Friction', st.friction === 'DW' ? 'Darcy–Weisbach (roughness ε, mm)' : 'Hazen–Williams (C)'],
    ['Unsteady friction', st.unsteadyFriction ? 'On (Brunone–Vítkovský, Vardy shear-decay coefficient)' : 'Off (quasi-steady)'],
    ['Column separation', `Discrete gas cavity model, free gas fraction ${st.gasFraction}`],
    ['Time step', `${f(r.dt, 5)} s, ${r.steps.toLocaleString()} steps, ${r.reaches.toLocaleString()} computing reaches`],
    ['Wave-speed adjustment', `at most ${f(r.maxAdjust * 100, 3)} % (target ${f(st.maxAdjust * 100, 2)} %); pipe lengths unchanged${r.rigidPipes.length ? `; ${r.rigidPipes.length} short pipe(s) as rigid columns` : ''}`],
    ['Simulation length', `${st.duration} s`],
    ['Demands', st.pressureDependentDemand ? 'Pressure-dependent during the transient' : 'Fixed'],
    ['Minimum pressure limit', `${st.minPressure} m`],
  ];
  const checkRows = [...checks].sort((a, b) => ({ fail: 0, warn: 1, info: 2, pass: 3 })[a.level] - ({ fail: 0, warn: 1, info: 2, pass: 3 })[b.level]);
  const pumpRows = net.pumps.map((p) => [p.id, p.from, p.to, p.curve.map(([q, h]) => `${f(q * 1000, 1)} L/s @ ${f(h, 1)} m`).join('; '), `${Math.round(p.efficiency * 100)} %`, p.speed, f(p.inertia, 2), p.checkValve ? cvText(p.checkSpec) : 'none', p.on ? 'running' : 'off', f((r.steady.flows[p.id] ?? 0) * 1000, 1)]);
  const valveRows = net.valves.map((v) => [v.id, v.from, v.to, f(v.diameter * 1000, 0), v.k0, `${v.opening} (${f(valveArea(v, v.opening) * 100, 1)} % area)`, v.law ?? 'area', v.check ? cvText(v.checkSpec) : '–', v.control ? `${v.control.type} ${v.control.type === 'FCV' ? `${f(v.control.set * 1000, 1)} L/s` : `${f(v.control.set, 1)} m`}${v.control.active ? `, active (τ ${v.control.responseTime ?? 3} s)` : ', locked'}` : '–', f((r.steady.flows[v.id] ?? 0) * 1000, 1)]);
  const resDev: (string | number)[][] = [];
  for (const [id, v] of Object.entries(r.vessels)) resDev.push([id, 'Hydropneumatic tank', `gas ${f(v.minGas, 2)}–${f(v.maxGas, 2)} m³ (start ${f(v.initialGas, 2)}); lowest water ${f(v.volume - v.maxGas, 2)} m³${v.emptied ? '; EMPTIED' : ''}`]);
  for (const [id, tk] of Object.entries(r.tanks ?? {})) resDev.push([id, tk.oneWay ? 'One-way tank' : 'Surge tank', `level ${f(tk.minLevel, 2)}–${f(tk.maxLevel, 2)} m${tk.spilled > 1e-6 ? `; spilled ${f(tk.spilled, 2)} m³` : ''}${tk.emptied ? '; EMPTIED' : ''}`]);
  for (const [id, v] of Object.entries(r.savs ?? {})) resDev.push([id, 'Surge anticipation valve', v.opened ? `opened ${v.opened}×, max ${f(v.maxFlow * 1000, 0)} L/s` : 'did not open']);
  for (const [id, v] of Object.entries(r.reliefs ?? {})) resDev.push([id, 'Relief valve', v.maxFlow > 1e-6 ? `max ${f(v.maxFlow * 1000, 0)} L/s, ${f(v.volume, 2)} m³` : 'did not open']);
  for (const [id, a] of Object.entries(r.airValves)) resDev.push([id, 'Air valve', a.maxAir > 1e-6 ? `up to ${f(a.maxAir * 1000, 1)} L of air${a.air[a.air.length - 1] > 1e-4 ? ', some left at the end' : ''}` : 'no air admitted']);
  for (const [id, c] of Object.entries(r.checkValves ?? {})) resDev.push([id, `Check valve (${c.where})`, `${c.mode}; ${c.closures ? `closed ${c.closures}×, ` : ''}max reverse ${f(c.maxReverseVelocity, 3)} m/s${c.closures ? `, ${f(c.reverseVelocityAtClosure, 3)} m/s at closure` : ''}`]);
  for (const [id, o] of Object.entries(r.outlets ?? {})) resDev.push([id, 'Outlet / rupture disk', o.openedAt >= 0 ? `opened ${f(o.openedAt, 2)} s, max ${f(o.maxFlow * 1000, 0)} L/s, ${f(o.volume, 2)} m³` : 'did not open']);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(net.name)} · transient analysis report</title><style>${css}</style></head><body>
<section class="title">
  <div>
    <div class="brand">SurgeSpace · transient analysis report</div>
    <h1>${esc(net.name)}</h1>
    ${net.description ? `<p class="muted">${esc(net.description)}</p>` : ''}
  </div>
  <table class="meta">
    ${info.projectNo ? `<tr><td>Project no.</td><td>${esc(info.projectNo)}</td></tr>` : ''}
    ${info.client ? `<tr><td>Client</td><td>${esc(info.client)}</td></tr>` : ''}
    <tr><td>Event</td><td>${esc(evText)}</td></tr>
    <tr><td>Prepared by</td><td>${esc(info.preparedBy ?? '')}</td></tr>
    <tr><td>Checked by</td><td>${esc(info.checkedBy ?? '')}</td></tr>
    <tr><td>Revision</td><td>${esc(info.revision ?? '')}</td></tr>
    <tr><td>Date</td><td>${now.toISOString().slice(0, 10)}</td></tr>
    <tr><td>Software</td><td>SurgeSpace ${esc(opt.version)}${opt.licensee ? ` · licensed to ${esc(opt.licensee)}` : ''}</td></tr>
  </table>
  ${info.notes ? `<div><h3>Notes</h3><p>${esc(info.notes).replace(/\n/g, '<br>')}</p></div>` : '<div></div>'}
</section>

<h2>1. Summary of findings</h2>
${table(['Item', 'Result'], summaryRows, { cls: 'kv' })}
${fails.length ? `<h3>To fix</h3><ul>${fails.map((c) => `<li><b>${esc(c.title)}</b>: ${esc(c.detail)}</li>`).join('')}</ul>` : '<p class="pass"><b>No check failed.</b></p>'}
${warns.length ? `<h3>Warnings</h3><ul>${warns.map((c) => `<li><b>${esc(c.title)}</b>: ${esc(c.detail)}</li>`).join('')}</ul>` : ''}
${profSvg ? `<figure>${profSvg}<figcaption>Pressure envelope along ${esc(route[0])} → ${esc(route[1])}: pipe, steady hydraulic grade, maximum and minimum heads, pipe class and vapour pressure.</figcaption></figure>` : ''}

<h2 class="page">2. Model and method</h2>
<p>${net.nodes.length} nodes (${net.nodes.filter((n) => n.kind === 'reservoir').length} fixed heads), ${net.pipes.length} pipes (${f(net.pipes.reduce((s2, p) => s2 + p.length, 0) / 1000, 2)} km), ${net.pumps.length} pumps, ${net.valves.length} valves, ${devRows.length} protection devices.</p>
<p><b>Event.</b> ${esc(evText)}</p>
${table(['Setting', 'Value'], settingsRows, { cls: 'kv' })}
<p class="muted">Method: method of characteristics on exact pipe geometry; implicit boundary conditions solved together with the pumps, valves and devices at each node; steady state by the global gradient algorithm (as EPANET). Slams are found where a check valve or an air valve closes on moving water; the slam surge is a·v/g for the velocity stopped (the model resolves the same jump at a fine time step), and the peak pressure just after is taken from the model.</p>

<h2>3. Input data</h2>
<h3>3.1 Pipes</h3>
${table(['Pipe', 'From', 'To', 'Length (m)', 'ID (mm)', st.friction === 'DW' ? 'ε (mm)' : 'C', 'a (m/s)', 'Minor K', 'Class (m)', 'Check valve'], net.pipes.map((p) => [p.id, p.from, p.to, f(p.length, 1), f(p.diameter * 1000, 1), p.roughness, p.wavespeed, p.minorLoss ?? 0, p.pressureClass ?? `${DEFAULT_CLASS}*`, p.checkValve ? cvText(p.checkValve) : (p.closed ? 'closed' : '–')]))}
<h3>3.2 Nodes</h3>
${table(['Node', 'Type', 'Level (m)', 'Demand (L/s)', 'Water level (m)'], net.nodes.map((n) => [n.id, n.kind, f(n.elev, 2), n.kind === 'junction' ? f((n.demand ?? 0) * 1000, 2) : '–', n.kind === 'reservoir' ? f(n.head ?? n.elev, 2) : '–']))}
${pumpRows.length ? `<h3>3.3 Pumps</h3>${table(['Pump', 'Suction', 'Discharge', 'Head curve', 'Eff.', 'rpm', 'I (kg·m²)', 'Check valve', 'Status', 'Steady Q (L/s)'], pumpRows)}` : ''}
${valveRows.length ? `<h3>3.4 Valves</h3>${table(['Valve', 'From', 'To', 'D (mm)', 'K open', 'Stroke', 'Characteristic', 'Check valve', 'Control', 'Steady Q (L/s)'], valveRows)}` : ''}
${devRows.length ? `<h3>3.5 Protection devices</h3>${table(['Where', 'Device', 'Data'], devRows)}` : ''}
<p class="muted">* no class given; ${DEFAULT_CLASS} m assumed for the checks.</p>

<h2 class="page">4. Results by node</h2>
${table(['Node', 'Level (m)', 'Demand (L/s)', 'Steady head (m)', 'Steady p (m)', 'Max head (m)', 'Max p (m)', 't max (s)', 'Min head (m)', 'Min p (m)', 't min (s)'], nodeRows)}

<h2>5. Results by pipe</h2>
${table(['Pipe', 'From', 'To', 'Steady Q (L/s)', 'V (m/s)', 'Max p (m)', 'at (m) @ t', 'Min p (m)', 'at (m) @ t', 'Class (% used)', 'Cavity (L)', 'a adjusted'], pipeRows)}

${resDev.length || slams.length ? `<h2 class="page">6. Protection devices and slams</h2>
${resDev.length ? table(['Where', 'Device', 'Result'], resDev) : ''}
${slams.length ? `<h3>Slams</h3>${table(['Time (s)', 'Where', 'Water stopped (m/s)', 'Slam surge a·v/g (m)', 'Peak pressure after (m)'], slams.slice(0, 60).map((s) => [f(s.t, 3), `${s.kind === 'airValve' ? 'Air valve' : 'Check valve'} ${s.id}`, f(s.velocity, 3), f(s.joukowsky, 1), f(s.peakPressure, 1)]))}` : ''}` : ''}

<h2 class="page">7. Design checks</h2>
${table(['Level', 'Check', 'Detail'], checkRows.map((c) => [{ html: `<span class="lvl ${c.level}">${c.level}</span>` }, c.title, c.detail]))}

<h2 class="page">8. Time histories</h2>
<div class="charts2">${histCharts}</div>
${devCharts.length ? `<h3>Pumps, devices and valves</h3><div class="charts2">${devCharts.join('')}</div>` : ''}

${r.warnings.length ? `<h2>9. Notes from the solver</h2><ul>${r.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
<div class="foot">Generated by SurgeSpace ${esc(opt.version)} on ${now.toISOString().replace('T', ' ').slice(0, 16)} UTC. Results depend on the input data; check them against the design criteria and good engineering judgement. Gravity ${G} m/s².</div>
</body></html>`;
}
