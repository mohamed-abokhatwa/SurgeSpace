// Command registry: every model change and engine action as a named command with a parameter schema.
// The same commands serve the AI copilot (as tools), scripting, and tests. Mutating commands go through
// ctx.apply(), which the app maps to one undo step each, so every AI action can be inspected and undone.
import type { Check, VesselSizing, AirValveSuggestion } from '../engine/analysis';
import { designChecks, pipeForces, sizeVessel, suggestAirValves, turbineSpeeds } from '../engine/analysis';
import { EXAMPLES } from '../engine/cases';
import { estimateInertia } from '../engine/hydraulics';
import { solveSteady } from '../engine/steady';
import { runTransient, type TransientResult } from '../engine/transient';
import { allEvents, area, defaultSettings, type Network, type NetNode, type SimpleControl, type TransientEvent } from '../engine/types';
import { defaultEPS, runEPS, type EPSResult } from '../engine/eps';
import { applyDesign, candidates, optimiseProtection, type Design, type OptVar } from '../engine/optimise';
import { skeletonise } from '../engine/skeleton';
import { rulesFromText } from '../engine/inp';
import { addCase } from './cases';
import { runQuery } from './query';
import { FLUIDS } from './catalogues';
import { addLink, addPipe, deleteElements, insertOnPipe, renameElement, uniqueId, DEFAULTS, type ElRef } from './edit';
import { deviceDefaults, nodeDevices, removeDevice, type ElementKind } from './elements';
import { healthCheck } from './health';
import { DEVICE_FIELDS, applyFields, elementsOf, parseCurve, readFields, type ElType } from './schema';

export interface RunOutput { result: TransientResult; checks: Check[] }
export interface CommandContext {
  getNet(): Network;
  /** Replace the model (one undo step labelled `label`). */
  apply(next: Network, label: string): void;
  run(): Promise<RunOutput>;
  getRun(): RunOutput | null;
  sizeVessel?(node: string): Promise<VesselSizing>;
  suggestAirValves?(): Promise<AirValveSuggestion[]>;
  select?(refs: ElRef[]): void;
  /** Extended-period run (the app runs it in the background and shows it). */
  runEPS?(): Promise<EPSResult>;
  /** Protection optimisation in the background. */
  optimise?(vars: OptVar[]): Promise<{ best: Design; evaluations: number }>;
}
type JSONSchema = Record<string, unknown>;
export interface Command {
  name: string;
  description: string;
  params: JSONSchema;
  mutates: boolean;
  run(ctx: CommandContext, args: any): Promise<unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const obj = (properties: Record<string, JSONSchema>, required: string[] = []): JSONSchema => ({ type: 'object', properties, required, additionalProperties: false });
const num = (description: string): JSONSchema => ({ type: 'number', description });
const str = (description: string, e?: string[]): JSONSchema => (e ? { type: 'string', description, enum: e } : { type: 'string', description });
const bool = (description: string): JSONSchema => ({ type: 'boolean', description });
const r2 = (x: number, d = 2) => (Number.isFinite(x) ? +x.toFixed(d) : null);

class CommandError extends Error {}
const fail = (m: string): never => { throw new CommandError(m); };
const need = (net: Network, type: ElType, id: string) => elementsOf(net, type).find((e) => e.id === id) ?? fail(`No ${type} "${id}". Use get_model or list_elements to see the ids.`);
const freeId = (net: Network, want: string | undefined, prefix: string) => {
  if (!want) return uniqueId(net, prefix);
  const all = new Set([...net.nodes, ...net.pipes, ...net.pumps, ...net.valves].map((e) => e.id));
  if (all.has(want)) fail(`Id "${want}" is already used.`);
  return want;
};

const DEVICE_KIND: Record<string, ElementKind> = { vessel: 'airVessel', airValve: 'airValve', standpipe: 'standpipe', feedTank: 'feedTank', anticipator: 'anticipator', relief: 'relief', blowoff: 'blowoff', burstDisc: 'burstDisc' };
const DEVICE_FIELDSET: Record<string, string> = { vessel: 'vessel', airValve: 'airValve', standpipe: 'tank', feedTank: 'tank', anticipator: 'sav', relief: 'relief', blowoff: 'outlet', burstDisc: 'outlet' };
const LINK_KINDS = ['pump', 'turbine', 'lineValve', 'nrv', 'prv', 'psv', 'fcv', 'orifice'];
const OP_KINDS = ['pump_trip', 'pump_stop_ramp', 'pump_start', 'valve_close', 'valve_open', 'turbine_rejection', 'turbine_acceptance'];

/** Compact description of the model for the AI (and scripts). */
export function modelSummary(net: Network, limit = 150) {
  const big = net.nodes.length + net.pipes.length > limit;
  const node = (n: NetNode) => ({ id: n.id, kind: n.kind, x: r2(n.x, 1), y: r2(n.y, 1), elevation_m: r2(n.elev), ...(n.kind === 'reservoir' ? { water_level_m: r2(n.head ?? n.elev) } : n.demand ? { demand_lps: r2(n.demand * 1000) } : {}), ...(nodeDevices(n).length ? { devices: nodeDevices(n) } : {}) });
  return {
    name: net.name, description: net.description,
    counts: { nodes: net.nodes.length, pipes: net.pipes.length, pumps: net.pumps.length, valves: net.valves.length },
    nodes: big ? `(${net.nodes.length} nodes: use list_elements)` : net.nodes.map(node),
    pipes: big ? `(${net.pipes.length} pipes: use list_elements)` : net.pipes.map((p) => ({ id: p.id, from: p.from, to: p.to, length_m: r2(p.length, 1), diameter_mm: r2(p.diameter * 1000, 0), wavespeed_mps: p.wavespeed, pressure_class_m: p.pressureClass, ...(p.checkValve ? { check_valve: true } : {}) })),
    pumps: net.pumps.map((p) => ({ id: p.id, from: p.from, to: p.to, ...readFields('pump', p) })),
    valves: net.valves.map((v) => ({ id: v.id, from: v.from, to: v.to, type: v.turbine ? 'turbine' : v.control ? v.control.type : v.check ? 'nrv' : v.orifice ? 'orifice' : 'lineValve', ...readFields('valve', v) })),
    operations: allEvents(net).map(opOut),
    settings: { duration_s: net.settings.duration, friction: net.settings.friction, min_pressure_m: net.settings.minPressure, max_pressure_m: net.settings.maxPressure, liquid: net.settings.fluid?.name ?? 'Water 20 °C', site_elevation_m: net.settings.siteElevation ?? 0 },
  };
}
const opOut = (e: TransientEvent) => ({
  kind: e.turbineOp ? `turbine_${e.turbineOp}` : e.kind === 'pumpTrip' ? (e.pumpMode === 'ramp' ? 'pump_stop_ramp' : e.pumpMode === 'start' ? 'pump_start' : 'pump_trip') : e.kind === 'valveClose' ? 'valve_close' : 'valve_open',
  targets: e.targets, start_s: e.start, ...(e.duration !== undefined ? { duration_s: e.duration } : {}), ...(e.finalOpening !== undefined ? { final_opening: e.finalOpening } : {}), ...(e.curve ? { curve: e.curve } : {}),
});

/** Results in a compact form: worst points, checks, devices, pumps. */
export function resultsSummary(net: Network, out: RunOutput) {
  const r = out.result;
  let maxP = { p: -Infinity, pipe: '', s: 0, t: 0 }, minP = { p: Infinity, pipe: '', s: 0, t: 0 }, cav = { v: 0, pipe: '', s: 0 };
  for (const e of r.envelopes) for (let i = 0; i < e.s.length; i++) {
    const a = e.hMax[i] - e.z[i], b = e.hMin[i] - e.z[i];
    if (a > maxP.p) maxP = { p: a, pipe: e.id, s: e.s[i], t: e.tMax[i] };
    if (b < minP.p) minP = { p: b, pipe: e.id, s: e.s[i], t: e.tMin[i] };
    if (e.cavMax[i] > cav.v) cav = { v: e.cavMax[i], pipe: e.id, s: e.s[i] };
  }
  return {
    highest_pressure_m: { value: r2(maxP.p, 1), pipe: maxP.pipe, chainage_m: r2(maxP.s, 0), time_s: r2(maxP.t) },
    lowest_pressure_m: { value: r2(minP.p, 1), pipe: minP.pipe, chainage_m: r2(minP.s, 0), time_s: r2(minP.t) },
    vapour_cavity: cav.v > 1e-4 ? { litres: r2(cav.v * 1000, 0), pipe: cav.pipe, chainage_m: r2(cav.s, 0) } : 'none',
    checks: out.checks.filter((c) => c.level !== 'info').map((c) => ({ level: c.level, title: c.title, detail: c.detail })),
    slams: (r.slams ?? []).filter((s) => s.joukowsky >= 0.5).slice(0, 10).map((s) => ({ kind: s.kind, id: s.id, time_s: r2(s.t), surge_m: r2(s.joukowsky, 1), peak_pressure_m: r2(s.peakPressure, 1) })),
    vessels: Object.entries(r.vessels).map(([id, v]) => ({ node: id, gas_min_m3: r2(v.minGas), gas_max_m3: r2(v.maxGas), volume_m3: v.volume, emptied: v.emptied })),
    air_valves: Object.entries(r.airValves).filter(([, a]) => a.maxAir > 1e-6).map(([id, a]) => ({ node: id, max_air_litres: r2(a.maxAir * 1000, 1) })),
    pumps: Object.entries(r.pumps).map(([id, p]) => ({ id, lowest_speed_pct: r2(Math.min(...Array.from(p.speed)) * 100, 0), reverse_flow: p.reverseFlow })),
    turbines: turbineSpeeds(net, r).map((t) => ({ id: t.id, max_speed_pct: r2(t.maxSpeed * 100, 1), mode: t.mode })),
    run: { time_step_s: r2(r.dt, 5), warnings: r.warnings.slice(0, 5) },
  };
}

function nodeResults(net: Network, out: RunOutput, ids?: string[]) {
  const r = out.result;
  return net.nodes.filter((n) => r.nodeHead[n.id] && (!ids || ids.includes(n.id))).map((n) => ({ id: n.id, elevation_m: r2(n.elev), steady_pressure_m: r2((r.steady.heads[n.id] ?? NaN) - n.elev, 1), max_pressure_m: r2(r.nodeMax[n.id] - n.elev, 1), min_pressure_m: r2(r.nodeMin[n.id] - n.elev, 1) }));
}
function pipeResults(net: Network, out: RunOutput, ids?: string[]) {
  const r = out.result;
  return r.envelopes.filter((e) => !ids || ids.includes(e.id)).map((e) => {
    let mx = -Infinity, mn = Infinity;
    for (let i = 0; i < e.s.length; i++) { mx = Math.max(mx, e.hMax[i] - e.z[i]); mn = Math.min(mn, e.hMin[i] - e.z[i]); }
    const p = net.pipes.find((x) => x.id === e.id);
    const q = r.steady.flows[e.id] ?? 0;
    return { id: e.id, steady_flow_lps: r2(q * 1000, 1), velocity_mps: p ? r2(Math.abs(q) / area(p.diameter)) : null, max_pressure_m: r2(mx, 1), min_pressure_m: r2(mn, 1), pressure_class_m: p?.pressureClass ?? null };
  });
}

const opIn = (o: { kind: string; targets: string[]; start_s?: number; duration_s?: number; final_opening?: number; exponent?: number; curve?: [number, number][] }): TransientEvent => {
  if (!OP_KINDS.includes(o.kind)) fail(`Unknown operation kind ${o.kind}. Use one of ${OP_KINDS.join(', ')}.`);
  const start = o.start_s ?? 1;
  if (o.kind.startsWith('pump')) return { kind: 'pumpTrip', pumpMode: o.kind === 'pump_trip' ? 'trip' : o.kind === 'pump_stop_ramp' ? 'ramp' : 'start', targets: o.targets, start, duration: o.duration_s ?? 5 };
  const close = o.kind === 'valve_close' || o.kind === 'turbine_rejection';
  return { kind: close ? 'valveClose' : 'valveOpen', targets: o.targets, start, duration: o.duration_s ?? 10, finalOpening: o.final_opening ?? (close ? 0 : 1), exponent: o.exponent ?? 1, ...(o.curve ? { curve: o.curve } : {}), ...(o.kind.startsWith('turbine') ? { turbineOp: close ? 'rejection' : 'acceptance' } : {}) } as TransientEvent;
};

export const COMMANDS: Command[] = [
  {
    name: 'get_model', mutates: false,
    description: 'Read the current model: nodes, pipes, pumps, valves, operations and run settings (SI units, as named). Call this first.',
    params: obj({}),
    run: async (ctx) => modelSummary(ctx.getNet()),
  },
  {
    name: 'list_elements', mutates: false,
    description: 'List elements of one type with all their editable fields (for large models, page with offset).',
    params: obj({ type: str('Element type', ['node', 'pipe', 'pump', 'valve']), offset: num('First row (default 0)'), limit: num('Rows (default 100, max 500)') }, ['type']),
    run: async (ctx, a) => {
      const els = elementsOf(ctx.getNet(), a.type);
      const off = a.offset ?? 0, lim = Math.min(a.limit ?? 100, 500);
      return { total: els.length, rows: els.slice(off, off + lim).map((e) => { const l = e as unknown as { from?: string; to?: string }; return { id: e.id, ...(l.from ? { from: l.from, to: l.to } : {}), ...readFields(a.type, e) }; }) };
    },
  },
  {
    name: 'new_model', mutates: true,
    description: 'Start a new empty model (the current one can be restored with undo).',
    params: obj({ name: str('Project name'), description: str('Short description') }, ['name']),
    run: async (ctx, a) => {
      ctx.apply({ name: a.name, description: a.description ?? '', nodes: [], pipes: [], pumps: [], valves: [], event: { kind: 'none', targets: [], start: 1 }, settings: { ...defaultSettings(), duration: 60 } }, 'AI: new model');
      return { ok: true };
    },
  },
  {
    name: 'load_example', mutates: true,
    description: `Open a built-in example: ${EXAMPLES.map((e) => e.id).join(', ')}.`,
    params: obj({ id: str('Example id', EXAMPLES.map((e) => e.id)) }, ['id']),
    run: async (ctx, a) => {
      const ex = EXAMPLES.find((e) => e.id === a.id) ?? fail(`No example ${a.id}.`);
      const n = ex.make();
      ctx.apply(n, `AI: open example ${a.id}`);
      return { ok: true, name: n.name };
    },
  },
  {
    name: 'add_node', mutates: true,
    description: 'Add a junction or a fixed-level source (reservoir, sump, tank).',
    params: obj({ id: str('Id (optional)'), kind: str('junction or reservoir', ['junction', 'reservoir']), x: num('X, m'), y: num('Y, m'), elevation_m: num('Ground / centreline level, m'), water_level_m: num('Reservoir water level, m'), demand_lps: num('Junction demand, L/s') }, ['kind', 'x', 'y', 'elevation_m']),
    run: async (ctx, a) => {
      const net = ctx.getNet();
      const id = freeId(net, a.id, a.kind === 'reservoir' ? 'R-' : 'J-');
      const node: NetNode = a.kind === 'reservoir' ? { id, kind: 'reservoir', x: a.x, y: a.y, elev: a.elevation_m, head: a.water_level_m ?? a.elevation_m + 2 } : { id, kind: 'junction', x: a.x, y: a.y, elev: a.elevation_m, demand: (a.demand_lps ?? 0) / 1000 };
      ctx.apply({ ...net, nodes: [...net.nodes, node] }, `AI: add ${a.kind} ${id}`);
      return { id };
    },
  },
  {
    name: 'add_pipe', mutates: true,
    description: 'Add a pipe between two existing nodes. Length defaults to the drawn distance.',
    params: obj({ id: str('Id (optional)'), from: str('Start node id'), to: str('End node id'), length_m: num('Length, m'), diameter_mm: num('Internal diameter, mm'), roughness: num('ε mm (Darcy–Weisbach) or C (Hazen–Williams)'), wavespeed_mps: num('Wave speed, m/s'), pressure_class_m: num('Pressure class, m head'), material: str('Material name') }, ['from', 'to', 'diameter_mm']),
    run: async (ctx, a) => {
      let net = ctx.getNet();
      need(net, 'node', a.from); need(net, 'node', a.to);
      if (a.from === a.to) fail('A pipe needs two different nodes.');
      const r = addPipe(net, a.from, a.to, [], { ...DEFAULTS, pipeDiameter: a.diameter_mm / 1000, pipeRoughness: a.roughness ?? DEFAULTS.pipeRoughness, wavespeed: a.wavespeed_mps ?? 1000, pressureClass: a.pressure_class_m ?? 100, material: a.material });
      net = r.net;
      let id = r.id;
      if (a.id && a.id !== id) { const rn = renameElement(net, 'pipe', id, a.id); if (!rn.ok) fail(rn.error!); net = rn.net; id = a.id; }
      if (a.length_m) net = { ...net, pipes: net.pipes.map((p) => (p.id === id ? { ...p, length: a.length_m } : p)) };
      ctx.apply(net, `AI: add pipe ${id}`);
      return { id, length_m: r2(net.pipes.find((p) => p.id === id)!.length, 1) };
    },
  },
  {
    name: 'build_line', mutates: true,
    description: 'Build a whole pipeline from a long section in one step: points by chainage and level, joined by pipes of one size. Optionally make the first and/or last point a fixed-level source. Use for rising mains and transmission lines.',
    params: obj({
      points: { type: 'array', description: 'Long-section points in order', items: obj({ id: str('Node id'), chainage_m: num('Chainage from the start, m'), elevation_m: num('Pipe level, m'), demand_lps: num('Demand, L/s') }, ['chainage_m', 'elevation_m']) },
      diameter_mm: num('Internal diameter, mm'), wavespeed_mps: num('Wave speed, m/s'), roughness: num('ε mm or C'), pressure_class_m: num('Pressure class, m head'), material: str('Material'),
      start_water_level_m: num('If given, the first point is a source with this water level'), end_water_level_m: num('If given, the last point is a source with this water level'),
      x0: num('X of the first point (default: right of the existing model)'), y0: num('Y of the first point'),
    }, ['points', 'diameter_mm']),
    run: async (ctx, a) => {
      let net = ctx.getNet();
      const pts = a.points as { id?: string; chainage_m: number; elevation_m: number; demand_lps?: number }[];
      if (pts.length < 2) fail('build_line needs at least two points.');
      const x0 = a.x0 ?? (net.nodes.length ? Math.max(...net.nodes.map((n) => n.x)) + 100 : 0), y0 = a.y0 ?? 0;
      const ids: string[] = [];
      pts.forEach((p, k) => {
        const res = (k === 0 && a.start_water_level_m !== undefined) || (k === pts.length - 1 && a.end_water_level_m !== undefined);
        const id = freeId(net, p.id, res ? 'R-' : 'J-');
        const lvl = k === 0 ? a.start_water_level_m : a.end_water_level_m;
        const node: NetNode = res ? { id, kind: 'reservoir', x: x0 + p.chainage_m, y: y0 + p.elevation_m, elev: p.elevation_m, head: lvl } : { id, kind: 'junction', x: x0 + p.chainage_m, y: y0 + p.elevation_m, elev: p.elevation_m, demand: (p.demand_lps ?? 0) / 1000 };
        net = { ...net, nodes: [...net.nodes, node] };
        ids.push(id);
      });
      const pipeIds: string[] = [];
      for (let k = 1; k < ids.length; k++) {
        const L = Math.abs(pts[k].chainage_m - pts[k - 1].chainage_m) || 1;
        const id = uniqueId(net, 'P-');
        net = { ...net, pipes: [...net.pipes, { id, from: ids[k - 1], to: ids[k], length: L, diameter: a.diameter_mm / 1000, roughness: a.roughness ?? (net.settings.friction === 'HW' ? 130 : 0.1), wavespeed: a.wavespeed_mps ?? 1000, pressureClass: a.pressure_class_m ?? 100, ...(a.material ? { material: a.material } : {}) }] };
        pipeIds.push(id);
      }
      ctx.apply(net, `AI: build line ${ids[0]}…${ids[ids.length - 1]}`);
      return { nodes: ids, pipes: pipeIds };
    },
  },
  {
    name: 'add_pump_station', mutates: true,
    description: 'Add identical pumps in parallel between a suction node and a discharge node, from the duty point. Inertia is estimated from the duty if not given.',
    params: obj({ suction: str('Suction node id'), discharge: str('Discharge node id'), count: num('Number of duty pumps'), duty_flow_lps: num('Flow per pump at duty, L/s'), duty_head_m: num('Head at duty, m'), shutoff_head_m: num('Shut-off head, m (default 1.3 × duty)'), curve: str('Optional full curve "L/s:m, …" (overrides duty points)'), speed_rpm: num('Rated speed (default 1480)'), efficiency_pct: num('Efficiency at duty (default 80)'), inertia_kgm2: num('Pump + motor inertia per pump'), check_valve: bool('Discharge non-return valve (default true)') }, ['suction', 'discharge', 'count', 'duty_flow_lps', 'duty_head_m']),
    run: async (ctx, a) => {
      let net = ctx.getNet();
      need(net, 'node', a.suction); need(net, 'node', a.discharge);
      const Q = a.duty_flow_lps / 1000, H = a.duty_head_m;
      // three-point curve on a parabola through shut-off and duty: H(q) = H0 − (H0 − H)(q/Q)²
      const H0 = a.shutoff_head_m ?? H * 1.3;
      const qr = H0 - (H0 - H) * 1.4 * 1.4 > 0.2 * H ? 1.4 : 1.25;
      const curve: [number, number][] = a.curve ? parseCurve(a.curve) : [[0, H0], [Q, H], [Q * qr, Math.max(H0 - (H0 - H) * qr * qr, 0.05 * H)]];
      const eff = (a.efficiency_pct ?? 80) / 100, rpm = a.speed_rpm ?? 1480;
      const inertia = a.inertia_kgm2 ?? Math.round(estimateInertia((998.2 * 9.80665 * Q * H) / eff / 1000, rpm) * 100) / 100;
      const ids: string[] = [];
      for (let k = 0; k < Math.max(1, Math.round(a.count)); k++) {
        const r = addLink(net, 'pump', a.suction, a.discharge);
        net = { ...r.net, pumps: r.net.pumps.map((p) => (p.id === r.id ? { ...p, curve, efficiency: eff, speed: rpm, inertia, checkValve: a.check_valve ?? true, on: true } : p)) };
        ids.push(r.id);
      }
      ctx.apply(net, `AI: add ${ids.length} pump(s)`);
      return { pumps: ids, inertia_kgm2_each: inertia, curve: curve.map(([q, h]) => `${r2(q * 1000, 1)}:${r2(h, 1)}`).join(', ') };
    },
  },
  {
    name: 'add_link', mutates: true,
    description: `Add a link between two nodes: ${LINK_KINDS.join(', ')} (nrv = non-return valve; prv/psv/fcv = control valves).`,
    params: obj({ kind: str('Link kind', LINK_KINDS), from: str('From node id'), to: str('To node id'), diameter_mm: num('Valve diameter, mm') }, ['kind', 'from', 'to']),
    run: async (ctx, a) => {
      const net0 = ctx.getNet();
      need(net0, 'node', a.from); need(net0, 'node', a.to);
      const r = addLink(net0, a.kind as ElementKind, a.from, a.to, { ...DEFAULTS, pipeDiameter: (a.diameter_mm ?? 300) / 1000 });
      ctx.apply(r.net, `AI: add ${a.kind} ${r.id}`);
      return { id: r.id, type: a.kind === 'pump' ? 'pump' : 'valve' };
    },
  },
  {
    name: 'insert_on_pipe', mutates: true,
    description: 'Split a pipe and insert a junction, a link (pump, valve…) or a protection device at a fraction of its length.',
    params: obj({ pipe: str('Pipe id'), kind: str('What to insert', ['junction', ...LINK_KINDS, ...Object.values(DEVICE_KIND)]), fraction: num('Position along the pipe, 0–1') }, ['pipe', 'kind', 'fraction']),
    run: async (ctx, a) => {
      const net = ctx.getNet();
      need(net, 'pipe', a.pipe);
      const r = insertOnPipe(net, a.pipe, a.kind as ElementKind, Math.max(0.02, Math.min(0.98, a.fraction)));
      ctx.apply(r.net, `AI: insert ${a.kind} on ${a.pipe}`);
      return { id: r.id, type: r.type };
    },
  },
  {
    name: 'set_properties', mutates: true,
    description: 'Change fields of one or more elements of the same type. Node fields: label, x, y, elevation, demand_lps, water_level_m, kind. Pipe: length_m, diameter_mm, roughness, wavespeed_mps, pressure_class_m, minor_loss_k, material, wall_mm, closed, check_valve. Pump: curve ("L/s:m, …"), efficiency_pct, speed_rpm, inertia_kgm2, check_valve, running. Valve: diameter_mm, k_open, opening, characteristic, set_point.',
    params: obj({ type: str('Element type', ['node', 'pipe', 'pump', 'valve']), ids: { type: 'array', items: { type: 'string' }, description: 'Element ids' }, values: { type: 'object', description: 'Field → value' } }, ['type', 'ids', 'values']),
    run: async (ctx, a) => {
      let net = ctx.getNet();
      const ids = new Set<string>(a.ids);
      ids.forEach((id) => need(net, a.type, id));
      const errors: string[] = [];
      const key = a.type === 'node' ? 'nodes' : a.type === 'pipe' ? 'pipes' : a.type === 'pump' ? 'pumps' : 'valves';
      net = { ...net, [key]: (net[key] as { id: string }[]).map((e) => { if (!ids.has(e.id)) return e; const r = applyFields(a.type, e, a.values); errors.push(...r.errors); return r.el; }) } as Network;
      if (errors.length) fail([...new Set(errors)].join(' '));
      ctx.apply(net, `AI: edit ${a.type} ${[...ids].slice(0, 3).join(', ')}${ids.size > 3 ? '…' : ''}`);
      return { changed: ids.size };
    },
  },
  {
    name: 'add_device', mutates: true,
    description: `Put a protection device on a junction: ${Object.keys(DEVICE_KIND).join(', ')}. Optional values as in set_device.`,
    params: obj({ node: str('Junction id'), device: str('Device', Object.keys(DEVICE_KIND)), values: { type: 'object', description: 'Device field → value (see set_device)' } }, ['node', 'device']),
    run: async (ctx, a) => {
      let net = ctx.getNet();
      const n = need(net, 'node', a.node) as NetNode;
      if (n.kind === 'reservoir') fail('Devices go on junctions, not on sources.');
      const D = net.pipes.find((p) => p.from === n.id || p.to === n.id)?.diameter ?? 0.3;
      let node: NetNode = { ...n, ...deviceDefaults(DEVICE_KIND[a.device], n, D) };
      if (a.values) node = setDeviceValues(node, a.device, a.values);
      net = { ...net, nodes: net.nodes.map((x) => (x.id === n.id ? node : x)) };
      ctx.apply(net, `AI: add ${a.device} at ${a.node}`);
      return { node: a.node, device: a.device, values: deviceValues(node, a.device) };
    },
  },
  {
    name: 'set_device', mutates: true,
    description: `Change a device on a junction. vessel: ${DEVICE_FIELDS.vessel.map((f) => f.key).join(', ')}. airValve: ${DEVICE_FIELDS.airValve.map((f) => f.key).join(', ')}. standpipe/feedTank: ${DEVICE_FIELDS.tank.map((f) => f.key).join(', ')}. relief: ${DEVICE_FIELDS.relief.map((f) => f.key).join(', ')}. anticipator: ${DEVICE_FIELDS.sav.map((f) => f.key).join(', ')}. blowoff/burstDisc: ${DEVICE_FIELDS.outlet.map((f) => f.key).join(', ')}.`,
    params: obj({ node: str('Junction id'), device: str('Device', Object.keys(DEVICE_KIND)), values: { type: 'object', description: 'Field → value' } }, ['node', 'device', 'values']),
    run: async (ctx, a) => {
      const net = ctx.getNet();
      const n = need(net, 'node', a.node) as NetNode;
      if (!nodeDevices(n).includes(DEVICE_KIND[a.device])) fail(`${a.node} has no ${a.device}; use add_device.`);
      const node = setDeviceValues(n, a.device, a.values);
      ctx.apply({ ...net, nodes: net.nodes.map((x) => (x.id === n.id ? node : x)) }, `AI: edit ${a.device} at ${a.node}`);
      return { node: a.node, values: deviceValues(node, a.device) };
    },
  },
  {
    name: 'remove_device', mutates: true,
    description: 'Remove a protection device from a junction.',
    params: obj({ node: str('Junction id'), device: str('Device', Object.keys(DEVICE_KIND)) }, ['node', 'device']),
    run: async (ctx, a) => {
      const net = ctx.getNet();
      need(net, 'node', a.node);
      ctx.apply({ ...net, nodes: net.nodes.map((x) => (x.id === a.node ? removeDevice(x, DEVICE_KIND[a.device]) : x)) }, `AI: remove ${a.device} at ${a.node}`);
      return { ok: true };
    },
  },
  {
    name: 'delete_elements', mutates: true,
    description: 'Delete elements. Deleting a node also deletes the pipes, pumps and valves connected to it.',
    params: obj({ refs: { type: 'array', items: obj({ type: str('Type', ['node', 'pipe', 'pump', 'valve']), id: str('Id') }, ['type', 'id']) } }, ['refs']),
    run: async (ctx, a) => {
      const net = ctx.getNet();
      (a.refs as ElRef[]).forEach((r) => need(net, r.type, r.id));
      ctx.apply(deleteElements(net, a.refs), `AI: delete ${(a.refs as ElRef[]).map((r) => r.id).slice(0, 3).join(', ')}`);
      return { deleted: a.refs.length };
    },
  },
  {
    name: 'rename_element', mutates: true,
    description: 'Rename an element; every reference to it follows.',
    params: obj({ type: str('Type', ['node', 'pipe', 'pump', 'valve']), id: str('Current id'), new_id: str('New id') }, ['type', 'id', 'new_id']),
    run: async (ctx, a) => {
      const r = renameElement(ctx.getNet(), a.type, a.id, a.new_id);
      if (!r.ok) fail(r.error!);
      ctx.apply(r.net, `AI: rename ${a.id} → ${a.new_id}`);
      return { id: a.new_id };
    },
  },
  {
    name: 'set_operations', mutates: true,
    description: `Replace the run's operations (what happens during the surge run). Kinds: ${OP_KINDS.join(', ')}. Each element follows the first operation that lists it. Valve operations: duration_s = stroke time, final_opening 0–1, exponent 1 linear / 2 slow end, or curve [[t_s, stroke], …].`,
    params: obj({ operations: { type: 'array', items: obj({ kind: str('Kind', OP_KINDS), targets: { type: 'array', items: { type: 'string' } }, start_s: num('Start time, s'), duration_s: num('Ramp or stroke time, s'), final_opening: num('Final stroke 0–1'), exponent: num('Stroke law exponent'), curve: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: '[[time s, stroke 0–1], …]' } }, ['kind', 'targets']) } }, ['operations']),
    run: async (ctx, a) => {
      const net = ctx.getNet();
      const evs = (a.operations as Parameters<typeof opIn>[0][]).map(opIn);
      for (const e of evs) for (const t of e.targets) if (!net.pumps.some((p) => p.id === t) && !net.valves.some((v) => v.id === t)) fail(`Operation target "${t}" is not a pump or valve.`);
      ctx.apply({ ...net, event: evs[0] ?? { kind: 'none', targets: [], start: 1 }, extraEvents: evs.slice(1) }, 'AI: set operations');
      return { operations: evs.length };
    },
  },
  {
    name: 'set_run_settings', mutates: true,
    description: `Change run settings: duration_s, friction (DW or HW), min_pressure_m, max_pressure_m, unsteady_friction, liquid (${FLUIDS.map((f) => f.name).slice(0, 5).join(', ')}…), site_elevation_m.`,
    params: obj({ duration_s: num('Simulation time, s'), friction: str('Friction method', ['DW', 'HW']), min_pressure_m: num('Lowest allowed pressure, m'), max_pressure_m: num('Highest allowed pressure, m'), unsteady_friction: bool('Unsteady friction'), liquid: str('Liquid name'), site_elevation_m: num('Site elevation above sea level, m'), engine: str('Surge engine: wave (all events, default) or rigid (rigid columns: slow events, surge tank mass oscillation)', ['wave', 'rigid']) }),
    run: async (ctx, a) => {
      const net = ctx.getNet();
      const s = { ...net.settings };
      if (a.engine) s.engine = a.engine;
      if (a.duration_s !== undefined) s.duration = Math.max(0.1, a.duration_s);
      if (a.friction) s.friction = a.friction;
      if (a.min_pressure_m !== undefined) s.minPressure = a.min_pressure_m;
      if (a.max_pressure_m !== undefined) s.maxPressure = a.max_pressure_m;
      if (a.unsteady_friction !== undefined) s.unsteadyFriction = a.unsteady_friction;
      if (a.site_elevation_m !== undefined) s.siteElevation = a.site_elevation_m;
      if (a.liquid) s.fluid = FLUIDS.find((f) => f.name.toLowerCase() === String(a.liquid).toLowerCase()) ?? fail(`Unknown liquid. Choose from: ${FLUIDS.map((f) => f.name).join('; ')}.`);
      ctx.apply({ ...net, settings: s }, 'AI: run settings');
      return { ok: true };
    },
  },
  {
    name: 'set_eps', mutates: true,
    description: 'Extended-period (daily operation) settings: duration_h, step_min (hydraulic step), pattern_step_min, default_pattern (for junctions without one), quality (none, age, trace, chemical), trace_node, chemical, bulk_per_day (negative = decay, chlorine typically -0.5), wall_m_per_day (negative).',
    params: obj({ duration_h: num('Duration, h'), step_min: num('Hydraulic step, min'), pattern_step_min: num('Pattern step, min'), default_pattern: str('Default junction pattern id'), quality: str('Water quality', ['none', 'age', 'trace', 'chemical']), trace_node: str('Trace source node'), chemical: str('Chemical name'), bulk_per_day: num('Bulk coefficient 1/day'), wall_m_per_day: num('Wall coefficient m/day') }),
    run: async (ctx, a) => {
      const net = ctx.getNet();
      const e = { ...defaultEPS(), ...(net.eps ?? {}) };
      if (a.duration_h !== undefined) e.duration = Math.max(1, a.duration_h) * 3600;
      if (a.step_min !== undefined) e.hydStep = Math.max(1, a.step_min) * 60;
      if (a.pattern_step_min !== undefined) e.patternStep = Math.max(1, a.pattern_step_min) * 60;
      if (a.default_pattern !== undefined) e.defaultPattern = a.default_pattern || undefined;
      if (a.quality) e.quality = a.quality;
      if (a.trace_node) { if (!net.nodes.some((n) => n.id === a.trace_node)) fail(`No node "${a.trace_node}".`); e.traceNode = a.trace_node; }
      if (a.chemical) e.chemical = a.chemical;
      if (a.bulk_per_day !== undefined) e.bulk = a.bulk_per_day;
      if (a.wall_m_per_day !== undefined) e.wall = a.wall_m_per_day;
      if (e.quality === 'trace' && !e.traceNode) fail('Give trace_node for a source trace.');
      ctx.apply({ ...net, eps: e }, 'AI: extended period settings');
      return { ok: true, eps: e };
    },
  },
  {
    name: 'set_patterns', mutates: true,
    description: 'Create or replace time patterns (multipliers per pattern step, repeating), e.g. a 24-value daily demand pattern. Optionally assign a pattern to junctions (or a fixed-level source head).',
    params: obj({ patterns: { type: 'array', items: obj({ id: str('Pattern id'), factors: { type: 'array', items: { type: 'number' } } }, ['id', 'factors']) }, assign: { type: 'array', description: 'Assignments', items: obj({ node: str('Node id'), pattern: str('Pattern id ("" to clear)') }, ['node', 'pattern']) } }),
    run: async (ctx, a) => {
      const net = ctx.getNet();
      const pats = [...(net.patterns ?? [])];
      for (const p of a.patterns ?? []) { if (!p.factors?.length) fail(`Pattern ${p.id} has no factors.`); const i = pats.findIndex((x) => x.id === p.id); if (i >= 0) pats[i] = { id: p.id, factors: p.factors }; else pats.push({ id: p.id, factors: p.factors }); }
      const asg = new Map<string, string>((a.assign ?? []).map((x: { node: string; pattern: string }) => [x.node, x.pattern]));
      for (const [id, pid] of asg) { if (!net.nodes.some((n) => n.id === id)) fail(`No node "${id}".`); if (pid && !pats.some((p) => p.id === pid)) fail(`No pattern "${pid}".`); }
      ctx.apply({ ...net, patterns: pats, nodes: net.nodes.map((n) => (asg.has(n.id) ? { ...n, pattern: asg.get(n.id) || undefined } : n)) }, 'AI: patterns');
      return { patterns: pats.map((p) => p.id), assigned: asg.size };
    },
  },
  {
    name: 'set_storage', mutates: true,
    description: 'Make a fixed-level source a storage tank whose level changes in the extended-period run (levels in m above the tank bottom = node elevation), or remove the storage (remove: true).',
    params: obj({ node: str('Fixed-level source id'), init_level_m: num('Initial level'), min_level_m: num('Minimum level'), max_level_m: num('Maximum level (overflow)'), diameter_m: num('Tank diameter'), initial_quality: num('Initial quality'), remove: bool('Remove the storage') }, ['node']),
    run: async (ctx, a) => {
      const net = ctx.getNet();
      const n = net.nodes.find((x) => x.id === a.node) ?? fail(`No node "${a.node}".`);
      if (n.kind !== 'reservoir') fail(`${a.node} is a junction; storage tanks are fixed-level sources (kind reservoir).`);
      let storage = a.remove ? undefined : { initLevel: Math.max((n.head ?? n.elev) - n.elev, 0.5), minLevel: 0.5, maxLevel: Math.max((n.head ?? n.elev) - n.elev + 3, 5), diameter: 20, ...(n.storage ?? {}) };
      if (storage) {
        if (a.init_level_m !== undefined) storage.initLevel = a.init_level_m;
        if (a.min_level_m !== undefined) storage.minLevel = a.min_level_m;
        if (a.max_level_m !== undefined) storage.maxLevel = a.max_level_m;
        if (a.diameter_m !== undefined) storage.diameter = a.diameter_m;
        if (!(storage.minLevel <= storage.initLevel && storage.initLevel <= storage.maxLevel)) fail('Levels must satisfy min ≤ initial ≤ max.');
        if (!(storage.diameter > 0)) fail('Diameter must be positive.');
        storage = { ...storage };
      }
      ctx.apply({ ...net, nodes: net.nodes.map((x) => (x.id === a.node ? { ...x, storage, head: storage ? x.elev + storage.initLevel : x.head, ...(a.initial_quality !== undefined ? { quality: a.initial_quality } : {}) } : x)) }, `AI: storage ${a.node}`);
      return { ok: true, storage };
    },
  },
  {
    name: 'set_controls', mutates: true,
    description: 'Replace the simple controls of the extended-period run. Each: link (pump, pipe or valve id), status open|closed (or setting), and one trigger: at_h (hours after start), clock_h (time of day, daily), or node + op (above|below) + value (tank level m above its bottom, or junction pressure m).',
    params: obj({ controls: { type: 'array', items: obj({ link: str('Link id'), status: str('New status', ['open', 'closed']), setting: num('New setting'), at_h: num('Hours after start'), clock_h: num('Time of day, h'), node: str('Node'), op: str('Comparison', ['above', 'below']), value: num('Level or pressure, m') }, ['link']) } }, ['controls']),
    run: async (ctx, a) => {
      const net = ctx.getNet();
      const ids = new Set([...net.pipes.map((p) => p.id), ...net.pumps.map((p) => p.id), ...net.valves.map((v) => v.id)]);
      const out: SimpleControl[] = (a.controls ?? []).map((c: Record<string, unknown>) => {
        if (!ids.has(String(c.link))) fail(`No pump, pipe or valve "${c.link}".`);
        if (c.status === undefined && c.setting === undefined) fail(`Control on ${c.link}: give status or setting.`);
        const k: SimpleControl = { link: String(c.link), ...(c.status ? { status: c.status as 'open' | 'closed' } : {}), ...(c.setting !== undefined ? { setting: Number(c.setting) } : {}) };
        if (c.at_h !== undefined) k.at = Number(c.at_h) * 3600;
        else if (c.clock_h !== undefined) k.clock = Number(c.clock_h) * 3600;
        else if (c.node && c.op && c.value !== undefined) { if (!net.nodes.some((n) => n.id === c.node)) fail(`No node "${c.node}".`); Object.assign(k, { node: String(c.node), op: c.op, value: Number(c.value) }); }
        else fail(`Control on ${c.link}: give at_h, clock_h, or node + op + value.`);
        return k;
      });
      ctx.apply({ ...net, controls: out }, 'AI: controls');
      return { controls: out.length };
    },
  },
  {
    name: 'set_rules', mutates: true,
    description: 'Replace the rule-based controls of the extended-period run, written in EPANET rule syntax with SI values (levels, heads, pressures m; flows L/s; times h:mm). Example: "RULE 1\nIF TANK T1 LEVEL BELOW 2\nAND SYSTEM CLOCKTIME >= 22:00\nTHEN PUMP PU1 STATUS IS OPEN\nPRIORITY 1".',
    params: obj({ text: str('Rules text') }, ['text']),
    run: async (ctx, a) => {
      const net = ctx.getNet();
      const rules = rulesFromText(String(a.text), net);
      const ids = new Set([...net.pipes.map((p) => p.id), ...net.pumps.map((p) => p.id), ...net.valves.map((v) => v.id)]);
      for (const r of rules) for (const x of [...r.then, ...(r.else ?? [])]) if (!ids.has(x.link)) fail(`Rule ${r.id}: no pump, pipe or valve "${x.link}".`);
      ctx.apply({ ...net, rules: rules.length ? rules : undefined }, 'AI: rules');
      return { rules: rules.length };
    },
  },
  {
    name: 'run_eps', mutates: false,
    description: 'Run the extended-period simulation (daily operation: tank levels, pump cycling, pressures through the day, water quality). Returns a summary: tank level ranges, pump hours and energy, lowest and highest pressures with times, quality ranges, events.',
    params: obj({}),
    run: async (ctx) => {
      const net = ctx.getNet();
      const r = ctx.runEPS ? await ctx.runEPS() : runEPS(net);
      return epsSummary(net, r);
    },
  },
  {
    name: 'optimise_protection', mutates: true,
    description: 'Least-cost surge protection by a genetic algorithm: chooses sizes (or none) for candidate air vessels and air valves so the pressure limits are met, judging every design with a full surge run. Without candidates it uses vessels at pump discharges and air valves at high points. Applies the best design. Takes from seconds to a few minutes.',
    params: obj({ candidates: { type: 'array', items: obj({ node: str('Junction id'), kind: str('Device', ['vessel', 'airValve']), options: { type: 'array', items: { type: 'number' }, description: 'Sizes: vessel m³, air valve inflow diameter m; include 0 for none' } }, ['node', 'kind']) } }),
    run: async (ctx, a) => {
      const net = ctx.getNet();
      const def = candidates(net);
      const vars: OptVar[] = a.candidates?.length ? a.candidates.map((c: OptVar) => {
        if (!net.nodes.some((n) => n.id === c.node && n.kind === 'junction')) fail(`No junction "${c.node}".`);
        return { node: c.node, kind: c.kind, options: c.options?.length ? [...new Set([0, ...c.options])].sort((x, y) => x - y) : def.find((d) => d.kind === c.kind)?.options ?? (c.kind === 'vessel' ? [0, 5, 10, 20, 40] : [0, 0.05, 0.1, 0.15]) };
      }) : def;
      if (!vars.length) fail('No candidate locations: give candidates.');
      const r = ctx.optimise ? await ctx.optimise(vars) : optimiseProtection(net, { vars, population: 10, generations: 6 });
      ctx.apply(applyDesign(net, vars, r.best.genes), 'AI: optimised protection');
      return { feasible: r.best.feasible, relative_cost: r2(r.best.cost, 1), lowest_pressure_m: r2(r.best.minP, 1), highest_vs_class_pct: r2(r.best.maxRatio * 100, 0), surge_runs: r.evaluations, design: vars.map((v, k) => ({ node: v.node, device: v.kind, size: v.options[r.best.genes[k]], unit: v.kind === 'vessel' ? 'm³' : 'm (inflow diameter)' })) };
    },
  },
  {
    name: 'skeletonise', mutates: true,
    description: 'Simplify the model: merge pipes in series through plain junctions (same diameter and material; the junction stays as a profile point) and optionally trim small dead ends. keep = node ids that must stay.',
    params: obj({ keep: { type: 'array', items: { type: 'string' } }, trim_below_mm: num('Trim dead ends below this diameter (0 = off)') }),
    run: async (ctx, a) => {
      const net = ctx.getNet();
      const sk = skeletonise(net, { keep: a.keep, trimBelow: (a.trim_below_mm ?? 0) / 1000 });
      if (sk.changes.length) ctx.apply(sk.net, 'AI: skeletonise');
      return { pipes_before: net.pipes.length, pipes_after: sk.net.pipes.length, changes: sk.changes.slice(0, 20) };
    },
  },
  {
    name: 'health_check', mutates: false,
    description: 'Check the model for errors and implausible inputs before running.',
    params: obj({}),
    run: async (ctx) => healthCheck(ctx.getNet()).map((i) => ({ level: i.level, title: i.title, detail: i.detail, ...(i.fix ? { suggested_fix: i.fix.label } : {}) })),
  },
  {
    name: 'query_elements', mutates: false,
    description: 'Find elements by data and results, e.g. "pipes where diameter_mm < 200 and material = PVC", "nodes where max_pressure_m > 120 or min_pressure_m < 0". Highlights them on the drawing and returns the ids.',
    params: obj({ query: str('Query text') }, ['query']),
    run: async (ctx, a) => {
      const q = runQuery(ctx.getNet(), String(a.query), ctx.getRun()?.result);
      if (q.error) fail(q.error);
      ctx.select?.(q.refs);
      return { count: q.refs.length, ids: q.refs.slice(0, 200).map((r) => r.id) };
    },
  },
  {
    name: 'create_case', mutates: true,
    description: 'Keep the current model as a case and continue in a new named copy (e.g. "Power failure, both pumps", "Valve V1 closes in 10 s"). Then change that copy (operations, devices). Cases are compared side by side in the Cases tab.',
    params: obj({ name: str('Name of the new case'), notes: str('What the case represents') }, ['name']),
    run: async (ctx, a) => {
      const net = ctx.getNet();
      const n2 = addCase(net, String(a.name));
      const c = n2.cases!.map((x) => (x.id === n2.activeCase && a.notes ? { ...x, notes: String(a.notes) } : x));
      ctx.apply({ ...n2, cases: c }, `AI: case ${a.name}`);
      return { cases: c.map((x) => x.name), active: a.name };
    },
  },
  {
    name: 'apply_health_fixes', mutates: true,
    description: 'Apply the suggested fix of every health-check finding that has one (or only those whose title contains `match`). One undo step.',
    params: obj({ match: str('Only findings whose title contains this text') }),
    run: async (ctx, a) => {
      const net = ctx.getNet();
      const fx = healthCheck(net).filter((i) => i.fix && (!a.match || i.title.includes(a.match)));
      if (!fx.length) return { applied: 0 };
      ctx.apply(fx.reduce((m, i) => i.fix!.apply(m), net), 'AI: health fixes');
      return { applied: fx.length, fixes: fx.map((i) => `${i.title} → ${i.fix!.label}`) };
    },
  },
  {
    name: 'run_analysis', mutates: false,
    description: 'Run the steady state and the surge simulation with the current model and operations; returns the results summary.',
    params: obj({}),
    run: async (ctx) => {
      const errs = healthCheck(ctx.getNet()).filter((i) => i.level === 'error');
      if (errs.length) fail(`Model has errors: ${errs.map((e) => e.title).join('; ')}`);
      const out = await ctx.run();
      return resultsSummary(ctx.getNet(), out);
    },
  },
  {
    name: 'get_results', mutates: false,
    description: 'Results of the last run: "summary", "nodes" (pressures at every node), "pipes" (flows and pressure envelopes), "forces" (largest unbalanced axial force per pipe for anchors and thrust blocks, kN), or a list of ids.',
    params: obj({ what: str('What', ['summary', 'nodes', 'pipes', 'forces']), ids: { type: 'array', items: { type: 'string' }, description: 'Limit to these ids' } }, ['what']),
    run: async (ctx, a) => {
      const out = ctx.getRun() ?? fail('No results yet: call run_analysis first.');
      const net = ctx.getNet();
      if (a.what === 'nodes') return nodeResults(net, out, a.ids).slice(0, 400);
      if (a.what === 'pipes') return pipeResults(net, out, a.ids).slice(0, 400);
      if (a.what === 'forces') return pipeForces(net, out.result).filter((f) => !a.ids || a.ids.includes(f.id)).sort((x, y) => Math.abs(y.maxForce) - Math.abs(x.maxForce)).slice(0, 200).map((f) => ({ pipe: f.id, max_force_kn: r2(f.maxForce, 1), at_s: r2(f.tMax, 2), steady_kn: r2(f.steadyForce, 1), surge_part_kn: r2(f.maxDelta, 1) }));
      return resultsSummary(net, out);
    },
  },
  {
    name: 'size_air_vessel', mutates: false,
    description: 'Find the smallest air vessel at a junction that keeps every point above the minimum pressure and within class (several engine runs). Does not change the model: apply the result with add_device.',
    params: obj({ node: str('Junction id (usually the pump discharge)') }, ['node']),
    run: async (ctx, a) => {
      need(ctx.getNet(), 'node', a.node);
      const s = ctx.sizeVessel ? await ctx.sizeVessel(a.node) : sizeVessel(ctx.getNet(), a.node);
      return { ok: s.ok, message: s.message, volume_m3: s.volume, gas_volume_m3: s.gasVolume, connection_mm: r2(s.connDiameter * 1000, 0), trial_runs: s.tried.length };
    },
  },
  {
    name: 'suggest_air_valves', mutates: false,
    description: 'Find high points that need air valves and the smallest standard inflow size for each (engine runs). Does not change the model.',
    params: obj({}),
    run: async (ctx) => {
      const s = ctx.suggestAirValves ? await ctx.suggestAirValves() : suggestAirValves(ctx.getNet(), runTransient(ctx.getNet(), { envelopeOnly: true }));
      return s.map((x) => ({ node: x.node, inflow_mm: r2(x.inDiameter * 1000, 0), min_pressure_with_valve_m: r2(x.minPressure, 1) }));
    },
  },
  {
    name: 'select_elements', mutates: false,
    description: 'Highlight elements on the drawing for the user (to show where something is).',
    params: obj({ refs: { type: 'array', items: obj({ type: str('Type', ['node', 'pipe', 'pump', 'valve']), id: str('Id') }, ['type', 'id']) } }, ['refs']),
    run: async (ctx, a) => { ctx.select?.(a.refs); return { ok: true }; },
  },
];

function setDeviceValues(n: NetNode, device: string, values: Record<string, unknown>): NetNode {
  const defs = DEVICE_FIELDS[DEVICE_FIELDSET[device]];
  let x = n;
  for (const [k, v] of Object.entries(values ?? {})) {
    const d = defs.find((f) => f.key === k) ?? fail(`Unknown ${device} field "${k}". Allowed: ${defs.map((f) => f.key).join(', ')}.`);
    x = d.set(x, v as number);
  }
  return x;
}
const deviceValues = (n: NetNode, device: string) => Object.fromEntries(DEVICE_FIELDS[DEVICE_FIELDSET[device]].map((f) => [f.key, f.get(n)]).filter(([, v]) => v !== undefined));

export const commandByName = (name: string) => COMMANDS.find((c) => c.name === name);

/** Run a command by name; errors come back as { error } so the AI can correct itself. */
export async function execute(ctx: CommandContext, name: string, args: unknown): Promise<{ ok: boolean; output: unknown }> {
  const c = commandByName(name);
  if (!c) return { ok: false, output: { error: `Unknown command ${name}.` } };
  try { return { ok: true, output: await c.run(ctx, args ?? {}) }; } catch (e) { return { ok: false, output: { error: (e as Error).message } }; }
}

/** A context that runs the engine directly (tests, scripts, the worker). */
/** Short summary of an extended-period run for the copilot and reports. */
export function epsSummary(net: Network, r: EPSResult) {
  const hrs = (t: number) => r2(t / 3600, 2);
  const junc = net.nodes.filter((n) => n.kind === 'junction' && r.pressure[n.id]);
  let lo = { v: Infinity, node: '', t: 0 }, hi = { v: -Infinity, node: '', t: 0 };
  for (const n of junc) r.pressure[n.id].forEach((p, k) => { if (p < lo.v) lo = { v: p, node: n.id, t: r.times[k] }; if (p > hi.v) hi = { v: p, node: n.id, t: r.times[k] }; });
  const step = r.times.length > 1 ? r.times[1] - r.times[0] : 0;
  return {
    duration_h: hrs(r.times[r.times.length - 1] ?? 0),
    tanks: Object.keys(r.level).map((id) => ({ id, min_level_m: r2(Math.min(...r.level[id]), 2), max_level_m: r2(Math.max(...r.level[id]), 2), start_m: r2(r.level[id][0], 2), end_m: r2(r.level[id][r.level[id].length - 1], 2) })),
    pumps: net.pumps.map((p) => ({ id: p.id, hours_running: r2((r.status[p.id]?.filter((s) => s > 0).length ?? 0) * step / 3600, 1), energy_kwh: r2(r.energy[p.id] ?? 0, 0) })),
    lowest_pressure_m: { value: r2(lo.v, 1), node: lo.node, time_h: hrs(lo.t) },
    highest_pressure_m: { value: r2(hi.v, 1), node: hi.node, time_h: hrs(hi.t) },
    ...(r.quality ? { quality: { unit: r.qualityUnit, by_node: junc.slice(0, 40).map((n) => ({ id: n.id, min: r2(Math.min(...r.quality![n.id]), 3), max: r2(Math.max(...r.quality![n.id]), 3) })) } } : {}),
    events: r.log.slice(0, 30).map((l) => `${hrs(l.t)} h: ${l.text}`),
    warnings: r.warnings.slice(0, 10),
  };
}

export function localContext(start: Network): CommandContext & { net: Network; log: string[] } {
  const c = {
    net: start, log: [] as string[], last: null as RunOutput | null,
    getNet: () => c.net,
    apply: (n: Network, label: string) => { c.net = n; c.last = null; c.log.push(label); },
    run: async () => { const steady = solveSteady(c.net); const result = runTransient(c.net, { steady, frames: 300 }); c.last = { result, checks: designChecks(c.net, result) }; return c.last; },
    getRun: () => c.last,
    runEPS: async () => runEPS(c.net),
  };
  return c;
}
