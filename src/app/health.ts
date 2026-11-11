import { estimateInertia } from '../engine/hydraulics';
// Model Health Check: finds problems before a run (broken links, missing data, implausible values), with the
// element each one concerns so the user can jump to it.
import { allEvents, type Network } from '../engine/types';
import type { ElRef } from './edit';
import { pipeLengthFromDrawing } from './edit';

/** A problem found in the model; `fix` (when given) is the usual correction, applied as one undo step. */
export interface Issue { level: 'error' | 'warn' | 'info'; title: string; detail?: string; ref?: ElRef; fix?: { label: string; apply: (n: Network) => Network } }
const mapPipe = (id: string, f: (p: Network['pipes'][number]) => Network['pipes'][number]) => (n: Network): Network => ({ ...n, pipes: n.pipes.map((p) => (p.id === id ? f(p) : p)) });
const mapNode = (id: string, f: (p: Network['nodes'][number]) => Network['nodes'][number]) => (n: Network): Network => ({ ...n, nodes: n.nodes.map((p) => (p.id === id ? f(p) : p)) });

export function healthCheck(net: Network): Issue[] {
  const out: Issue[] = [];
  const nodeIds = new Map<string, number>();
  net.nodes.forEach((n) => nodeIds.set(n.id, (nodeIds.get(n.id) ?? 0) + 1));
  const linkIds = new Map<string, number>();
  [...net.pipes, ...net.pumps, ...net.valves].forEach((l) => linkIds.set(l.id, (linkIds.get(l.id) ?? 0) + 1));
  nodeIds.forEach((c, id) => c > 1 && out.push({ level: 'error', title: `Duplicate node id ${id}`, detail: `${c} nodes share this id.`, ref: { type: 'node', id } }));
  linkIds.forEach((c, id) => c > 1 && out.push({ level: 'error', title: `Duplicate link id ${id}`, detail: `${c} pipes, pumps or valves share this id.` }));

  if (!net.nodes.some((n) => n.kind === 'reservoir')) out.push({ level: 'error', title: 'No fixed-level source', detail: 'Add at least one source (reservoir, sump or tank) to set the heads.' });
  if (!net.pipes.length) out.push({ level: 'error', title: 'No pipes', detail: 'Draw at least one pipe.' });

  const degree = new Map<string, number>();
  const links: { id: string; from: string; to: string; type: ElRef['type'] }[] = [
    ...net.pipes.map((p) => ({ id: p.id, from: p.from, to: p.to, type: 'pipe' as const })),
    ...net.pumps.map((p) => ({ id: p.id, from: p.from, to: p.to, type: 'pump' as const })),
    ...net.valves.map((v) => ({ id: v.id, from: v.from, to: v.to, type: 'valve' as const })),
  ];
  for (const l of links) {
    for (const end of [l.from, l.to]) {
      if (!nodeIds.has(end)) out.push({ level: 'error', title: `${l.id} refers to a missing node ${end || '(blank)'}`, ref: { type: l.type, id: l.id } });
      degree.set(end, (degree.get(end) ?? 0) + 1);
    }
    if (l.from === l.to) out.push({ level: 'error', title: `${l.id} starts and ends at the same node`, ref: { type: l.type, id: l.id } });
  }
  for (const n of net.nodes) if (!degree.get(n.id)) out.push({ level: 'warn', title: `Node ${n.id} is not connected`, detail: 'It is ignored by the solver; connect it or delete it.', ref: { type: 'node', id: n.id }, fix: { label: 'Delete it', apply: (m) => ({ ...m, nodes: m.nodes.filter((x) => x.id !== n.id) }) } });

  // islands without a source
  const adj = new Map<string, string[]>();
  links.forEach((l) => { adj.set(l.from, [...(adj.get(l.from) ?? []), l.to]); adj.set(l.to, [...(adj.get(l.to) ?? []), l.from]); });
  const seen = new Set<string>();
  for (const n of net.nodes) {
    if (seen.has(n.id) || !degree.get(n.id)) continue;
    const comp: string[] = [];
    const st = [n.id];
    seen.add(n.id);
    while (st.length) { const k = st.pop()!; comp.push(k); for (const m of adj.get(k) ?? []) if (!seen.has(m) && nodeIds.has(m)) { seen.add(m); st.push(m); } }
    if (!comp.some((id) => net.nodes.find((x) => x.id === id)?.kind === 'reservoir')) out.push({ level: 'error', title: `Part of the network has no source (${comp.length} nodes)`, detail: `Includes ${comp.slice(0, 5).join(', ')}${comp.length > 5 ? '…' : ''}.`, ref: { type: 'node', id: comp[0] } });
  }

  for (const p of net.pipes) {
    const r: ElRef = { type: 'pipe', id: p.id };
    if (!(p.length > 0)) out.push({ level: 'error', title: `Pipe ${p.id}: length must be above zero`, ref: r });
    if (!(p.diameter > 0)) out.push({ level: 'error', title: `Pipe ${p.id}: diameter must be above zero`, ref: r });
    if (!(p.wavespeed > 0)) out.push({ level: 'error', title: `Pipe ${p.id}: wave speed must be above zero`, ref: r });
    else if (p.wavespeed < 150 || p.wavespeed > 1500) out.push({ level: 'warn', title: `Pipe ${p.id}: wave speed ${p.wavespeed} m/s is unusual`, detail: 'Typical: 250–450 m/s (PE), 300–500 (PVC), 900–1300 (iron, steel, concrete).', ref: r });
    if (net.settings.friction === 'DW' && p.roughness > 10) out.push({ level: 'warn', title: `Pipe ${p.id}: roughness ${p.roughness} mm looks like a Hazen–Williams C`, detail: 'The model uses Darcy–Weisbach (ε in mm). Change the friction method in Run Setup or the value.', ref: r, fix: { label: 'Use Hazen–Williams', apply: (m) => ({ ...m, settings: { ...m.settings, friction: 'HW' } }) } });
    if (net.settings.friction === 'HW' && p.roughness < 40) out.push({ level: 'warn', title: `Pipe ${p.id}: C = ${p.roughness} looks like a roughness in mm`, ref: r, fix: { label: 'Use Darcy–Weisbach', apply: (m) => ({ ...m, settings: { ...m.settings, friction: 'DW' } }) } });
    if (p.diameter > 5) out.push({ level: 'warn', title: `Pipe ${p.id}: diameter ${p.diameter} m — entered in mm?`, ref: r, fix: { label: `Set ${p.diameter / 1000} m`, apply: mapPipe(p.id, (x) => ({ ...x, diameter: x.diameter / 1000 })) } });
    const Ld = pipeLengthFromDrawing(net, p);
    if (Ld > 1 && (p.length / Ld > 5 || Ld / p.length > 5)) out.push({ level: 'info', title: `Pipe ${p.id}: length ${p.length.toFixed(0)} m differs a lot from the drawing (${Ld.toFixed(0)} m)`, detail: 'Fine for schematic drawings. Use Tools → Lengths from drawing if the drawing is to scale.', ref: r });
  }
  for (const p of net.pumps) {
    const r: ElRef = { type: 'pump', id: p.id };
    if (!p.curve?.length) out.push({ level: 'error', title: `Pump ${p.id} has no head curve`, ref: r });
    else if (p.curve.length >= 2 && p.curve.some((c, i) => i > 0 && c[1] > p.curve[i - 1][1] + 1e-9)) out.push({ level: 'warn', title: `Pump ${p.id}: head rises with flow somewhere on the curve`, ref: r });
    if (!(p.inertia > 0) && p.curve?.length) {
      const pts = [...p.curve].sort((x, y) => x[0] - y[0]), d = pts.length === 1 ? pts[0] : pts[1];
      const est = Math.round(estimateInertia((998.2 * 9.80665 * d[0] * d[1]) / Math.max(p.efficiency || 0.75, 0.3) / 1000, p.speed || 1480) * 100) / 100;
      out.push({ level: 'error', title: `Pump ${p.id}: inertia must be above zero`, detail: `Thorley estimate for its duty: ${est} kg·m².`, ref: r, fix: { label: `Use ${est} kg·m²`, apply: (m) => ({ ...m, pumps: m.pumps.map((x) => (x.id === p.id ? { ...x, inertia: est } : x)) }) } });
    } else if (!(p.inertia > 0)) out.push({ level: 'error', title: `Pump ${p.id}: inertia must be above zero`, ref: r });
    if (!(p.efficiency > 0 && p.efficiency <= 1)) out.push({ level: 'warn', title: `Pump ${p.id}: efficiency should be between 0 and 100 %`, ref: r, fix: { label: p.efficiency > 1 && p.efficiency <= 100 ? `Set ${p.efficiency} %` : 'Set 75 %', apply: (m) => ({ ...m, pumps: m.pumps.map((x) => (x.id === p.id ? { ...x, efficiency: p.efficiency > 1 && p.efficiency <= 100 ? p.efficiency / 100 : 0.75 } : x)) }) } });
  }
  for (const v of net.valves) {
    const r: ElRef = { type: 'valve', id: v.id };
    if (!(v.diameter > 0)) out.push({ level: 'error', title: `Valve ${v.id}: diameter must be above zero`, ref: r });
    if (v.opening < 0 || v.opening > 1) out.push({ level: 'error', title: `Valve ${v.id}: opening must be 0–1`, ref: r, fix: { label: v.opening > 1 && v.opening <= 100 ? `Set ${v.opening} %` : 'Set fully open', apply: (m) => ({ ...m, valves: m.valves.map((x) => (x.id === v.id ? { ...x, opening: v.opening > 1 && v.opening <= 100 ? v.opening / 100 : 1 } : x)) }) } });
  }
  for (const n of net.nodes) {
    const r: ElRef = { type: 'node', id: n.id };
    if (n.kind === 'reservoir') {
      if ((n.head ?? n.elev) < n.elev - 1e-9) out.push({ level: 'warn', title: `Source ${n.id}: water level below its bottom`, ref: r, fix: { label: 'Set the bottom 1 m below the water', apply: mapNode(n.id, (x) => ({ ...x, elev: (x.head ?? x.elev) - 1 })) } });
      if (n.vessel || n.airValve || n.tank || n.sav || n.relief || n.outlet) out.push({ level: 'warn', title: `Source ${n.id}: devices on a source are ignored`, ref: r });
    }
    if (n.vessel && n.vessel.gasInput !== 'precharge' && n.vessel.gasVolume >= n.vessel.volume) out.push({ level: 'error', title: `Air vessel ${n.id}: gas volume must be less than the vessel volume`, ref: r, fix: { label: 'Start half full of gas', apply: mapNode(n.id, (x) => ({ ...x, vessel: { ...x.vessel!, gasVolume: x.vessel!.volume / 2 } })) } });
    if (n.tank && n.tank.topElev <= n.tank.bottomElev) out.push({ level: 'error', title: `Tank ${n.id}: top must be above the bottom`, ref: r, fix: { label: 'Top 5 m above the bottom', apply: mapNode(n.id, (x) => ({ ...x, tank: { ...x.tank!, topElev: x.tank!.bottomElev + 5 } })) } });
  }

  const ids = new Set([...net.pumps.map((p) => p.id), ...net.valves.map((v) => v.id)]);
  const evs = allEvents(net);
  for (const e of evs) {
    for (const t of e.targets) if (!ids.has(t)) out.push({ level: 'error', title: `Operation refers to a missing element ${t}`, fix: { label: 'Remove it from the operation', apply: (m) => ({ ...m, event: { ...m.event, targets: m.event.targets.filter((x) => x !== t) }, extraEvents: m.extraEvents?.map((x) => ({ ...x, targets: x.targets.filter((y) => y !== t) })) }) } });
    if (!e.targets.length) out.push({ level: 'warn', title: 'An operation has no elements selected', detail: 'Pick the pumps or valves it acts on in Operations.' });
    if (e.start >= net.settings.duration) out.push({ level: 'warn', title: `An operation starts at ${e.start} s, after the end of the run (${net.settings.duration} s)`, fix: { label: `Run ${Math.ceil(e.start + (e.duration ?? 0) + 30)} s`, apply: (m) => ({ ...m, settings: { ...m.settings, duration: Math.ceil(e.start + (e.duration ?? 0) + 30) } }) } });
  }
  if (!evs.length) out.push({ level: 'info', title: 'No operation defined', detail: 'The run only checks the steady state. Add a pump trip or valve movement in Operations.' });

  // run length versus the slowest wave
  const longest = Math.max(0, ...net.pipes.map((p) => p.length / Math.max(p.wavespeed, 1)));
  const lastStart = Math.max(0, ...evs.map((e) => e.start + (e.duration ?? 0)));
  if (net.pipes.length && net.settings.duration < lastStart + 4 * longest) out.push({ level: 'warn', title: 'Run may be too short', detail: `Allow at least a few wave periods after the last operation (≥ ${(lastStart + 4 * longest).toFixed(0)} s).`, fix: { label: `Run ${Math.ceil(lastStart + 6 * longest)} s`, apply: (m) => ({ ...m, settings: { ...m.settings, duration: Math.ceil(lastStart + 6 * longest) } }) } });

  if (!out.some((i) => i.level !== 'info')) out.unshift({ level: 'info', title: 'No problems found', detail: `${net.nodes.length} nodes, ${net.pipes.length} pipes, ${net.pumps.length} pumps, ${net.valves.length} valves.` });
  return out;
}
