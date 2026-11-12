// A real distribution network read back from a plan drawing: the public KY4 network (Kentucky, 959 junctions,
// 1,156 pipes with their bends, 2 pumps, 4 tanks, 1 reservoir; drawing units feet) is drawn as a DXF with levels,
// sizes, symbols and clutter (roads, contours, hydrants, title), read by the plan reader, compared item by item
// with the network it came from, solved against an independently built model, and taken through the protection
// workflow (air valve plan, surge test, air vessel).
import { readFileSync } from 'node:fs';
import { dxfSummary } from '../src/app/intake';
import { finishPlanNetwork, guessPipeLayers, guessSymbol, guessUnits, planToNetwork } from '../src/app/planNetwork';
import { parseInp } from '../src/engine/inp';
import { solveSteady } from '../src/engine/steady';
import { healthCheck } from '../src/app/health';
import type { Network } from '../src/engine/types';
import { netToPlanDxf } from '../validation/plan-dxf';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };
const FT = 0.3048;

const raw = parseInp(readFileSync(new URL('../validation/data/ky4.inp', import.meta.url), 'utf8'), 'KY4').network;
// As digitised, a few KY4 pipes share bend points with other pipes (twin mains drawn over each other): on a drawing
// those look joined. A drafter separates them; here each shared bend point is moved 10 cm apart.
const seen = new Map<string, number>();
const truth0: Network = { ...raw, pipes: raw.pipes.map((p) => ({ ...p, vertices: p.vertices?.map((v) => { const k = `${Math.round(v.x * FT * 100)},${Math.round(v.y * FT * 100)}`; const c = seen.get(k) ?? 0; seen.set(k, c + 1); return c ? { x: v.x + (0.1 * c) / FT, y: v.y } : v; }) })) };
// Likewise a few junctions lie within a metre of a line or a node they are not joined to (a dead end 9 cm from
// another main, two hydrant leads ending 30 cm apart): on a drawing those look joined, so they are moved 2 m clear.
const truth: Network = (() => {
  const n2 = truth0.nodes.map((n) => ({ ...n }));
  const by = new Map(n2.map((n) => [n.id, n]));
  const linked = (a: string, b: string) => truth0.pipes.some((p) => (p.from === a && p.to === b) || (p.from === b && p.to === a)) || truth0.pumps.some((p) => (p.from === a && p.to === b) || (p.from === b && p.to === a));
  for (let pass = 0; pass < 3; pass++) for (const n of n2) {
    let clash = false;
    for (const m of n2) if (m !== n && !linked(n.id, m.id) && Math.hypot(m.x - n.x, m.y - n.y) * FT < 1 && !(m.x === n.x && m.y === n.y && truth0.pumps.some((p) => [p.from, p.to].includes(n.id)))) clash = true;
    for (const p of truth0.pipes) {
      if (clash || p.from === n.id || p.to === n.id) continue;
      const pts = [by.get(p.from)!, ...(p.vertices ?? []), by.get(p.to)!];
      for (let i = 0; i + 1 < pts.length; i++) { const dx = pts[i + 1].x - pts[i].x, dy = pts[i + 1].y - pts[i].y, L2 = dx * dx + dy * dy || 1; const u = Math.max(0, Math.min(1, ((n.x - pts[i].x) * dx + (n.y - pts[i].y) * dy) / L2)); if (Math.hypot(n.x - pts[i].x - u * dx, n.y - pts[i].y - u * dy) * FT < 1) { clash = true; break; } }
    }
    if (clash) { n.x += 2 / FT; n.y += 2 / FT; }
  }
  return { ...truth0, nodes: n2 };
})();
const dxf = netToPlanDxf(truth, { units: 'ft', clutter: true });
const d = dxfSummary(dxf);
const layers = guessPipeLayers(d);
t('drawing units recognised as feet (sizes written in inches)', guessUnits(d) === 'ft');
t('pipe layer found among the clutter layers', layers.join() === 'W-PIPE', `${layers.join()} of ${d.layers.map((l) => l.name).join(', ')}`);
const symbols = Object.fromEntries(d.blocks.map((b) => [b.name, guessSymbol(b.name)]));
t('symbols recognised', symbols.PUMP === 'pump' && symbols.TANK === 'tank' && symbols.RES === 'reservoir' && symbols.ARV === 'airValve' && symbols.FH === 'hydrant' && symbols.NORTH === 'ignore', JSON.stringify(symbols));
const t0 = performance.now();
const r = planToNetwork(d, { layers, units: 'ft', symbols, diameterMm: 150, material: 'di', classM: 160, ...(process.env.SNAP ? { snap: Number(process.env.SNAP) } : {}) }, 'KY4 from the plan');
const ms = performance.now() - t0;
t('read in reasonable time', ms < 8000, `${ms.toFixed(0)} ms; ${r.notes.join(' | ')}`);
const net = r.net;

// match nodes by position
const key = (x: number, y: number) => `${Math.round(x * 10)},${Math.round(y * 10)}`;
const planAt = new Map(net.nodes.map((n) => [key(n.x, n.y), n]));
const map = new Map<string, string>();
for (const n of truth.nodes) { const m = planAt.get(key(n.x * FT, n.y * FT)); if (m) map.set(n.id, m.id); }
t('nodes of the network found on the plan (≥ 99.5 %)', map.size >= 0.995 * truth.nodes.length, `${map.size} of ${truth.nodes.length}`);
const pn = new Map(net.nodes.map((n) => [n.id, n]));
let zOk = 0, zN = 0;
for (const n of truth.nodes) { if (n.kind !== 'junction') continue; zN++; const m = pn.get(map.get(n.id)!); if (m && Math.abs(m.elev - n.elev) < 0.01) zOk++; }
t('junction levels from the level texts (feet to metres, ≥ 99.5 %)', zOk >= 0.995 * zN, `${zOk} of ${zN} within 1 cm`);
// the real network has a few pipes whose bends pass within a metre of another junction, as digitised; those are read as joined there
t('bends kept inside their pipes (one plan pipe per network pipe, within 2 %)', Math.abs(net.pipes.length - truth.pipes.length) <= 0.02 * truth.pipes.length, `${net.pipes.length} pipes, ${net.pipes.filter((p) => p.vertices?.length).length} with bends`);
// pipes: same ends, size and length
// pipes by their two ends (a network can have two pipes between the same nodes: take the one of the same length)
const pipeBy = new Map<string, Network['pipes']>();
for (const p of net.pipes) { const k2 = [p.from, p.to].sort().join('|'); pipeBy.set(k2, [...(pipeBy.get(k2) ?? []), p]); }
let dOk = 0, lOk = 0, found = 0;
const len3 = (n: Network, p: Network['pipes'][number], k: number) => {
  const A = n.nodes.find((x) => x.id === p.from)!, B = n.nodes.find((x) => x.id === p.to)!;
  const pts = [{ x: A.x, y: A.y }, ...(p.vertices ?? []), { x: B.x, y: B.y }].map((v) => ({ x: v.x * k, y: v.y * k }));
  let L = 0; for (let i = 0; i + 1 < pts.length; i++) L += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  return Math.sqrt(L * L + (A.elev - B.elev) ** 2);
};
for (const p of truth.pipes) {
  const cands = pipeBy.get([map.get(p.from), map.get(p.to)].sort().join('|'));
  if (!cands) { if (process.env.DBG) console.log('missing pipe', p.id, p.from, p.to, (p.diameter * 1000).toFixed(0), 'mm', p.vertices?.length ?? 0, 'bends', map.get(p.from), map.get(p.to)); continue; }
  const lt = len3(truth, p, FT);
  const q = cands.reduce((b, c) => (Math.abs(c.length - lt) < Math.abs(b.length - lt) ? c : b));
  found++;
  if (Math.abs(q.diameter - Math.round(p.diameter / 0.0254) * 0.0254) < 1e-4) dOk++; else if (process.env.DBG) console.log('size', p.id, (p.diameter * 1000).toFixed(0), '→', (q.diameter * 1000).toFixed(0), 'len', q.length);
  if (Math.abs(q.length - lt) < 0.5 + 2e-3 * lt) lOk++;
}
t('pipes found between the right nodes (≥ 98 %)', found >= 0.98 * truth.pipes.length, `${found} of ${truth.pipes.length}`);
t('pipe sizes from the size texts (inches, ≥ 98 %)', dOk >= 0.98 * truth.pipes.length, `${dOk} of ${truth.pipes.length} (${((100 * dOk) / truth.pipes.length).toFixed(1)} %)`);
t('pipe lengths along the bends (≥ 99 % within 0.5 m + 0.2 %; a bend drawn within 0.5 m of a junction is merged into it)', lOk >= 0.99 * found, `${lOk} of ${found}`);
t('pumps placed on their lines', net.pumps.length === truth.pumps.length);
const srcT = truth.nodes.filter((n) => n.kind === 'reservoir'), srcP = net.nodes.filter((n) => n.kind === 'reservoir');
const wl = (n: Network['nodes'][number]) => (n.storage ? n.elev + (n.storage.initLevel ?? 0) : n.head ?? n.elev);
t('tanks and the reservoir with their water levels from the TWL texts', srcP.length === srcT.length && srcT.every((n) => Math.abs((pn.get(map.get(n.id)!)?.head ?? -1) - wl(n)) < 0.01), `${srcP.length} sources`);
t('air valves at the high points; hydrants counted, not drawn', net.nodes.filter((n) => n.airValve).length === d.blocks.find((b) => b.name === 'ARV')?.count && (net.annotations ?? []).length === 0 && r.notes.some((x) => x.includes(`${d.blocks.find((b) => b.name === 'FH')?.count} hydrant`)));
t('no pipe joins a node to itself', net.pipes.every((p) => p.from !== p.to));

// finish: the sources as read, the network demand spread by pipe length
const totalLps = truth.nodes.reduce((s, n) => s + (n.demand ?? 0), 0) * 1000;
const roles = Object.fromEntries(r.ends.map((id) => [id, pn.get(id)!.kind === 'reservoir' ? { role: 'source' as const, level: pn.get(id)!.head! } : { role: 'closed' as const }]));
// the pump data sheets: each pump gets its curve (in the documents workflow they come from the data sheets)
const near = (x: number, y: number) => truth.pumps.find((p) => { const a = truth.nodes.find((n) => n.id === p.from)!, b = truth.nodes.find((n) => n.id === p.to)!; return Math.hypot((a.x + b.x) / 2 * FT - x, (a.y + b.y) / 2 * FT - y) < 10; });
const withCurves = { ...net, pumps: net.pumps.map((p) => { const a = pn.get(p.from)!, b = pn.get(p.to)!; const tp = near((a.x + b.x) / 2, (a.y + b.y) / 2); return tp ? { ...tp, id: p.id, from: p.from, to: p.to } : p; }) };
const f = finishPlanNetwork(withCurves, roles, { totalDemandLps: totalLps });
const st = solveSteady(f.net);
const qp = f.net.pumps.filter((p) => p.on !== false).map((p) => (st.flows.get(p.id) ?? 0) * 1000);
const hc = healthCheck(f.net).filter((x) => x.level === 'error');
t('model health check finds no errors', hc.length === 0, hc.slice(0, 3).map((x) => x.title).join(' | '));
// the network exactly as digitised (with its near-touching features) also reads into a valid model
{
  const dr = dxfSummary(netToPlanDxf(raw, { units: 'ft', clutter: true }));
  const rr = planToNetwork(dr, { layers, units: 'ft', symbols, diameterMm: 150, material: 'di', classM: 160 });
  const pr = new Map(rr.net.nodes.map((n) => [n.id, n]));
  const fr = finishPlanNetwork(rr.net, Object.fromEntries(rr.ends.map((id) => [id, pr.get(id)!.kind === 'reservoir' ? { role: 'source' as const, level: pr.get(id)!.head! } : { role: 'closed' as const }])), { totalDemandLps: 65 });
  const he = healthCheck(fr.net).filter((x) => x.level === 'error');
  t('as digitised (twin mains, near-touching ends): still a valid model with no health errors', he.length === 0 && rr.net.pipes.every((p) => p.from !== p.to), he.slice(0, 3).map((x) => x.title).join(' | '));
}
t('steady state solves; the running pump delivers forwards', st.heads.size === f.net.nodes.length && qp.length > 0 && qp.every((q) => q > 0), `${f.notes.join(' | ')}; pumps ${qp.map((q) => q.toFixed(1)).join(', ')} L/s`);
// an independent model from the network file: same data, same friction and demands, built without the drawing
const inv = new Map([...map].map(([a, b]) => [b, a]));
const fNode = new Map(f.net.nodes.map((n) => [n.id, n]));
const indep: Network = {
  ...truth,
  nodes: truth.nodes.map((n) => { const m = fNode.get(map.get(n.id) ?? '') ?? { kind: 'junction' as const, head: undefined, demand: 0 }; return { ...n, x: n.x * FT, y: n.y * FT, kind: m.kind, head: m.head, storage: undefined, demand: m.demand ?? 0, pattern: undefined }; }),
  pipes: truth.pipes.map((p) => ({ ...p, length: len3(truth, p, FT), diameter: Math.round(p.diameter / 0.0254) * 0.0254, roughness: f.net.pipes[0].roughness, minorLoss: 0, vertices: undefined })),
  pumps: truth.pumps,
  settings: { ...truth.settings, friction: 'DW' }, controls: undefined, rules: undefined, patterns: undefined, eps: undefined,
};
// the plan splits each pump line in two short pipes; the independent model has the pump between the two nodes
let dh = 0, at = '';
try {
  const si = solveSteady(indep);
  const shared = new Map<string, number>(); for (const v of map.values()) shared.set(v, (shared.get(v) ?? 0) + 1);
  const diffs: number[] = [];
  const pumpNodes = new Set(truth.pumps.flatMap((p) => [p.from, p.to]));
  for (const n of truth.nodes) { if (!map.has(n.id) || shared.get(map.get(n.id)!)! > 1 || pumpNodes.has(n.id)) continue; const h1 = si.heads.get(n.id), h2 = st.heads.get(map.get(n.id)!); if (h1 === undefined || h2 === undefined) continue; const dd = Math.abs(h1 - h2); diffs.push(dd); if (dd > dh) { dh = dd; at = n.id; } }
  diffs.sort((a, b) => a - b);
  const p99 = diffs[Math.floor(diffs.length * 0.99)];
  if (process.env.DBG) { for (const n of truth.nodes.filter((x) => x.kind === 'reservoir')) { const q1 = truth.pipes.filter((p) => p.from === n.id || p.to === n.id).map((p) => (si.flows.get(p.id) ?? 0) * (p.from === n.id ? 1 : -1)).reduce((a, b) => a + b, 0); const m = map.get(n.id)!; const q2 = f.net.pipes.filter((p) => p.from === m || p.to === m).map((p) => (st.flows.get(p.id) ?? 0) * (p.from === m ? 1 : -1)).reduce((a, b) => a + b, 0); console.log('source', n.id, 'out indep', (q1 * 1000).toFixed(2), 'plan', (q2 * 1000).toFixed(2), 'head', si.heads.get(n.id), st.heads.get(m)); } const dsum = (nn: Network) => nn.nodes.reduce((a, x) => a + (x.kind === 'junction' ? x.demand ?? 0 : 0), 0) * 1000; console.log('demand indep', dsum(indep), 'plan', dsum(f.net)); }
  if (process.env.DBG) console.log([0.5, 0.9, 0.95, 0.98, 0.99].map((q) => diffs[Math.floor(diffs.length * q)].toFixed(3)).join(" "), diffs.length);
  if (process.env.DBG) { for (const id of ['R-1', 'I-Pump-2', 'O-Pump-2', 'J-596']) console.log(id, si.heads.get(id), st.heads.get(map.get(id)!), map.get(id)); console.log(indep.pumps.map((p) => `${p.id} ${si.flows.get(p.id)}`), f.net.pumps.map((p) => `${p.id} ${p.from}->${p.to} ${st.flows.get(p.id)} on=${p.on} power=${p.power}`)); }
  const p50 = diffs[Math.floor(diffs.length * 0.5)], p95 = diffs[Math.floor(diffs.length * 0.95)];
  t('heads as in the independently built model (median within 5 cm, 95 % within 0.35 m)', p50 < 0.05 && p95 < 0.35, `median ${p50.toFixed(3)} m, 95 % ${p95.toFixed(3)} m, 99 % ${p99.toFixed(3)} m over ${diffs.length} nodes; largest ${dh.toFixed(2)} m at ${at}`);
} catch (e) { t('heads equal to the independently built model', false, (e as Error).message); }

// protection workflow on the plan network
const run = async () => {
  const { planAirValves, testAirValvePlan } = await import('../src/app/airValvePlan');
  const { sizeVessel } = await import('../src/engine/analysis');
  const t1 = performance.now();
  // 20 s after the pumps trip covers the first down-surge on this network (each wave run on 1,160 pipes takes a
  // second or so per simulated second here)
  const fn = { ...f.net, settings: { ...f.net.settings, duration: 20 } };
  const plan = planAirValves(fn, { minDiameter: 0.25 });
  const test = testAirValvePlan(fn, plan);
  const t2 = performance.now();
  t('air valve plan on the mains from DN250 and its surge test on the whole network', plan.length > 3 && Number.isFinite(test.after.minPressure), `${plan.length} locations; lowest pressure ${test.before.minPressure.toFixed(1)} → ${test.after.minPressure.toFixed(1)} m; cavity ${(test.before.cavity * 1000).toFixed(0)} → ${(test.after.cavity * 1000).toFixed(0)} L; ${((t2 - t1) / 1000).toFixed(1)} s`);
  const running = fn.pumps.find((p) => p.on !== false) ?? fn.pumps[0];
  const v = sizeVessel(test.net, running.to);
  const t3 = performance.now();
  t('air vessel sized at a pump on the whole network', Number.isFinite(v.volume), `${v.message} (${((t3 - t2) / 1000).toFixed(1)} s)`);
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
};
if (!process.env.SKIP_PROTECT) void run(); else console.log(`\n${pass} passed, ${fail} failed`);
