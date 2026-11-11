// Extended-period simulation (EPS): a day (or any period) of operation as a sequence of steady states, the way
// EPANET does it. Between hydraulic events the flows are constant; tank levels move with the net inflow; demands
// and source heads follow their patterns; simple controls switch pumps, pipes and valves on time, tank level or
// pressure. Water quality (age, source trace, a reacting chemical such as chlorine) is carried through the pipes
// by Lagrangian segments with first-order bulk and wall reactions; tanks are completely mixed.
import { solveSteady, type SteadyResult } from './steady';
import { G, NU, area, type ControlRule, type EPSSettings, type Network, type NetNode, type RuleCondition, type SimpleControl, type StorageTank } from './types';

export interface EPSResult {
  /** Report times, s. */
  times: number[];
  /** Node head (m) and pressure head (m) at each report time. */
  head: Record<string, number[]>;
  pressure: Record<string, number[]>;
  /** Actual node demand (m³/s). */
  demand: Record<string, number[]>;
  /** Link flow (m³/s, + from → to). */
  flow: Record<string, number[]>;
  /** Link status (1 open / running, 0 closed / off). */
  status: Record<string, number[]>;
  /** Tank level above the bottom (m) and volume (m³). */
  level: Record<string, number[]>;
  volume: Record<string, number[]>;
  /** Node water quality (mg/L, hours or %). */
  quality?: Record<string, number[]>;
  qualityUnit?: string;
  /** Pump energy over the period, kWh (at 75 % wire-to-water efficiency unless the pump has its own). */
  energy: Record<string, number>;
  /** Time-stamped events (controls fired, tanks full or empty). */
  log: { t: number; text: string }[];
  warnings: string[];
  /** Hydraulic solves performed. */
  solves: number;
  /** State at the end of the run (tank levels, link status and settings). */
  final?: { t: number; levels: Record<string, number>; linkOpen: Record<string, boolean>; setting: Record<string, number> };
}

const tankArea = (s: StorageTank) => area(s.diameter);
export function tankVolume(s: StorageTank, level: number): number {
  if (s.volumeCurve?.length) return interp(s.volumeCurve, level);
  return (s.minVolume ?? tankArea(s) * s.minLevel) + tankArea(s) * (level - s.minLevel);
}
export function tankLevel(s: StorageTank, vol: number): number {
  if (s.volumeCurve?.length) return interp(s.volumeCurve.map(([l, v]) => [v, l] as [number, number]), vol);
  return s.minLevel + (vol - (s.minVolume ?? tankArea(s) * s.minLevel)) / tankArea(s);
}
function interp(c: [number, number][], x: number) {
  const p = [...c].sort((a, b) => a[0] - b[0]);
  if (x <= p[0][0]) return p[0][1] + (p.length > 1 ? ((x - p[0][0]) * (p[1][1] - p[0][1])) / (p[1][0] - p[0][0] || 1) : 0);
  for (let i = 1; i < p.length; i++) if (x <= p[i][0]) return p[i - 1][1] + ((x - p[i - 1][0]) * (p[i][1] - p[i - 1][1])) / (p[i][0] - p[i - 1][0] || 1);
  const n = p.length;
  return p[n - 1][1] + (n > 1 ? ((x - p[n - 1][0]) * (p[n - 1][1] - p[n - 2][1])) / (p[n - 1][0] - p[n - 2][0] || 1) : 0);
}

export const defaultEPS = (): EPSSettings => ({ duration: 86400, hydStep: 3600, quality: 'none', qualStep: 300 });

/** Pattern factor at time t (s from the start). */
export function patternFactor(net: Network, id: string | undefined, t: number): number {
  const e = net.eps ?? defaultEPS();
  const pid = id ?? e.defaultPattern;
  if (!pid) return 1;
  const p = net.patterns?.find((x) => x.id === pid);
  if (!p || !p.factors.length) return 1;
  const step = e.patternStep ?? e.hydStep;
  const k = Math.floor((t + (e.patternStart ?? 0)) / step + 1e-9);
  return p.factors[((k % p.factors.length) + p.factors.length) % p.factors.length];
}

interface State {
  t: number;
  levels: Map<string, number>;
  linkOpen: Map<string, boolean>;
  setting: Map<string, number>;
}

/** The steady-state network at a moment of the EPS: patterned demands and heads, tank levels, link states.
 *  Also used to start a surge run from any time of the day. */
export function snapshot(net: Network, st: State, full = new Set<string>(), empty = new Set<string>()): Network {
  const nodes = net.nodes.map((n): NetNode => {
    if (n.kind === 'junction') return n.demand ? { ...n, demand: n.demand * patternFactor(net, n.pattern, st.t) } : n;
    if (n.storage) {
      const lv = st.levels.get(n.id) ?? n.storage.initLevel;
      // a full tank cannot take more water and an empty one cannot give any: it becomes a junction for this solve
      if (full.has(n.id) || empty.has(n.id)) return { id: n.id, kind: 'junction', x: n.x, y: n.y, elev: n.elev + lv, demand: 0 };
      return { ...n, head: n.elev + lv };
    }
    if (n.pattern) return { ...n, head: (n.head ?? n.elev) * patternFactor(net, n.pattern, st.t) };
    return n;
  });
  const pipes = net.pipes.map((p) => (st.linkOpen.has(p.id) ? { ...p, closed: !st.linkOpen.get(p.id) } : p));
  const pumps = net.pumps.map((p) => {
    const on = st.linkOpen.get(p.id) ?? p.on;
    const s = st.setting.get(p.id);
    if (s === undefined || s === 1) return { ...p, on };
    if (s <= 0) return { ...p, on: false };
    return { ...p, on, curve: p.curve.map(([q, h]) => [q * s, h * s * s] as [number, number]), power: p.power ? p.power * s ** 3 : undefined };
  });
  const valves = net.valves.map((v) => {
    const open = st.linkOpen.get(v.id);
    const s = st.setting.get(v.id);
    let out = v;
    if (s !== undefined && v.control) out = { ...out, control: { ...v.control, set: s } };
    if (open === false) out = { ...out, opening: 0 };
    else if (open === true && out.opening === 0) out = { ...out, opening: 1 };
    return out;
  });
  return { ...net, nodes, pipes, pumps, valves, extraEvents: undefined, event: { kind: 'none', targets: [], start: 0 } };
}

const linkIds = (net: Network) => [...net.pipes.map((p) => p.id), ...net.pumps.map((p) => p.id), ...net.valves.map((v) => v.id)];

/** Run the extended-period simulation. */
export function runEPS(net: Network, onProgress?: (frac: number) => void): EPSResult {
  const e = { ...defaultEPS(), ...(net.eps ?? {}) };
  const tanks = net.nodes.filter((n) => n.kind === 'reservoir' && n.storage);
  const rep = e.reportStep ?? e.hydStep;
  const res: EPSResult = { times: [], head: {}, pressure: {}, demand: {}, flow: {}, status: {}, level: {}, volume: {}, energy: {}, log: [], warnings: [], solves: 0 };
  for (const n of net.nodes) { res.head[n.id] = []; res.pressure[n.id] = []; res.demand[n.id] = []; }
  for (const id of linkIds(net)) { res.flow[id] = []; res.status[id] = []; }
  for (const n of tanks) { res.level[n.id] = []; res.volume[n.id] = []; }
  for (const p of net.pumps) res.energy[p.id] = 0;

  const st: State = { t: 0, levels: new Map(tanks.map((n) => [n.id, n.storage!.initLevel])), linkOpen: new Map(), setting: new Map() };
  const vol = new Map(tanks.map((n) => [n.id, tankVolume(n.storage!, n.storage!.initLevel)]));
  const controls = net.controls ?? [];
  const wq = e.quality !== 'none' ? new Quality(net, e) : null;
  let prev: SteadyResult | undefined;
  let nextRep = 0;
  const fired = new Set<number>();
  // level / pressure controls act on the state at the start of the step (EPANET also applies them at t = 0)
  const applyControls = (heads: Map<string, number> | null) => {
    controls.forEach((c, k) => {
      let hit = false;
      if (c.at !== undefined) hit = Math.abs(st.t - c.at) < 1e-6 && !fired.has(k);
      else if (c.clock !== undefined) { const day = (((st.t + (e.startClock ?? 0)) % 86400) + 86400) % 86400; hit = Math.abs(day - c.clock) < 1e-6; }
      else if (c.node && c.op && c.value !== undefined) {
        const v = st.levels.has(c.node) ? st.levels.get(c.node)! : heads ? (heads.get(c.node) ?? NaN) - (net.nodes.find((x) => x.id === c.node)?.elev ?? 0) : NaN;
        hit = c.op === 'above' ? v >= c.value - 1e-6 : v <= c.value + 1e-6;
      }
      if (!hit) return;
      if (c.at !== undefined) fired.add(k);
      const before = `${st.linkOpen.get(c.link)}|${st.setting.get(c.link)}`;
      if (c.status) st.linkOpen.set(c.link, c.status === 'open');
      if (c.setting !== undefined) { st.setting.set(c.link, c.setting); if (!c.status) st.linkOpen.set(c.link, c.setting > 0 || !net.pumps.some((p) => p.id === c.link)); }
      if (`${st.linkOpen.get(c.link)}|${st.setting.get(c.link)}` !== before) res.log.push({ t: st.t, text: `${c.link} ${c.status ?? `setting ${c.setting}`} (${describe(c)})` });
    });
  };

  // ── rule-based controls (EPANET semantics: premises left to right, OR only rescues a false result) ──
  const rules = net.rules ?? [];
  const ruleStep = e.ruleStep ?? e.hydStep / 10;
  let lastFlows: Map<string, number> | null = null;
  const condVal = (c: RuleCondition, heads: Map<string, number> | null): number | string => {
    const o = c.object.toLowerCase(), a = c.attribute.toLowerCase();
    if (o === 'system') {
      if (a === 'time') return st.t;
      if (a === 'clocktime') return ((((st.t + (e.startClock ?? 0)) % 86400) + 86400) % 86400);
      if (a === 'demand') return net.nodes.reduce((s, n) => s + (n.kind === 'junction' ? (n.demand ?? 0) * patternFactor(net, n.pattern, st.t) : 0), 0);
      return NaN;
    }
    const id = c.id ?? '';
    const node = net.nodes.find((n) => n.id === id);
    if (node) {
      const h = st.levels.has(id) ? node.elev + st.levels.get(id)! : heads?.get(id) ?? NaN;
      if (a === 'level') return st.levels.get(id) ?? h - node.elev;
      if (a === 'head' || a === 'grade') return h;
      if (a === 'pressure') return h - node.elev;
      if (a === 'demand') return node.kind === 'junction' ? (node.demand ?? 0) * patternFactor(net, node.pattern, st.t) : 0;
      return NaN;
    }
    if (a === 'flow') return lastFlows?.get(id) ?? 0;
    if (a === 'status') {
      const pump = net.pumps.find((p) => p.id === id), pipe = net.pipes.find((p) => p.id === id);
      const open = st.linkOpen.get(id) ?? (pump ? pump.on : pipe ? !pipe.closed : true);
      return open ? 'open' : 'closed';
    }
    if (a === 'setting') return st.setting.get(id) ?? 1;
    return NaN;
  };
  const condTrue = (c: RuleCondition, heads: Map<string, number> | null) => {
    const v = condVal(c, heads);
    const a = c.attribute.toLowerCase();
    if (typeof v === 'string' || typeof c.value === 'string') {
      const x = String(c.value).toLowerCase(), y = String(v).toLowerCase();
      const same = x === y || (x === 'active' && y === 'open');
      return c.op === '<>' ? !same : same;
    }
    const x = c.value;
    if (!Number.isFinite(v)) return false;
    // time equality holds within the last rule step, as EPANET
    if ((a === 'time' || a === 'clocktime') && (c.op === '=' || c.op === '<>')) {
      const hit = x > v - ruleStep - 1e-6 && x <= v + 1e-6;
      return c.op === '=' ? hit : !hit;
    }
    switch (c.op) { case '<': return v < x; case '>': return v > x; case '<=': return v <= x; case '>=': return v >= x; case '=': return Math.abs(v - x) < 1e-6; default: return Math.abs(v - x) >= 1e-6; }
  };
  const evalRule = (r: ControlRule, heads: Map<string, number> | null) => {
    let result = true;
    for (const c of r.conditions) {
      if (c.logic === 'or') { if (!result) result = condTrue(c, heads); }
      else { if (!result) return false; result = condTrue(c, heads); }
    }
    return result;
  };
  const applyRules = (heads: Map<string, number> | null) => {
    if (!rules.length) return;
    const chosen = new Map<string, { a: { link: string; status?: 'open' | 'closed'; setting?: number }; pr: number; rule: string }>();
    for (const r of rules) {
      const acts = evalRule(r, heads) ? r.then : r.else ?? [];
      for (const a of acts) {
        const pr = r.priority ?? 0;
        const cur = chosen.get(a.link);
        if (!cur || pr > cur.pr) chosen.set(a.link, { a, pr, rule: r.id });
      }
    }
    for (const { a, rule } of chosen.values()) {
      const before = `${st.linkOpen.get(a.link)}|${st.setting.get(a.link)}`;
      if (a.status) st.linkOpen.set(a.link, a.status === 'open');
      if (a.setting !== undefined) { st.setting.set(a.link, a.setting); if (!a.status && net.pumps.some((p) => p.id === a.link)) st.linkOpen.set(a.link, a.setting > 0); }
      if (`${st.linkOpen.get(a.link)}|${st.setting.get(a.link)}` !== before) res.log.push({ t: st.t, text: `${a.link} ${a.status ?? `setting ${a.setting}`} (rule ${rule})` });
    }
  };

  let guard = 0;
  let r!: SteadyResult;
  let full = new Set<string>(), empty = new Set<string>();
  let qp: { r: SteadyResult; t0: number; dt: number; tankQ: (id: string) => number; demand: Map<string, number> } | null = null;
  let ruleOnly = false; // this step was started only to check the rules (EPANET keeps the flows unless a rule acts)
  const stateKey = () => JSON.stringify([[...st.linkOpen], [...st.setting]]);
  while (st.t <= e.duration + 1e-6 && guard++ < 200000) {
    const key0 = stateKey();
    applyControls(prev?.heads ?? null);
    if (rules.length && Math.abs(st.t / ruleStep - Math.round(st.t / ruleStep)) < 1e-6) applyRules(prev?.heads ?? null);
    const reuse = ruleOnly && !!prev && stateKey() === key0;
    if (wq && qp && (!reuse || st.t >= nextRep - 1e-6 || st.t >= e.duration - 1e-6)) { wq.advance(qp.r, qp.dt, qp.tankQ, qp.demand, qp.t0); qp = null; }
    // solve, closing full / empty tanks to the flow that would overfill or drain them
    if (!reuse) full = new Set<string>(), empty = new Set<string>();
    for (let pass = 0; !reuse; pass++) {
      r = solveSteady(snapshot(net, st, full, empty));
      res.solves++;
      let changed = false;
      for (const n of tanks) {
        const s = n.storage!, lv = st.levels.get(n.id)!;
        const q = netInflow(net, r, n.id);
        if (lv >= s.maxLevel - 1e-6 && q > 1e-9 && !full.has(n.id)) { full.add(n.id); changed = true; }
        if (lv <= s.minLevel + 1e-6 && q < -1e-9 && !empty.has(n.id)) { empty.add(n.id); changed = true; }
      }
      if (!changed || pass > 4) break;
    }
    lastFlows = r.flows;
    if (!r.converged) res.warnings.push(`Hydraulics did not fully converge at ${clock(st.t)}.`);
    for (const w of r.warnings) if (!res.warnings.includes(w)) res.warnings.push(w);
    prev = r;

    // record at report times
    if (st.t >= nextRep - 1e-6) {
      res.times.push(st.t);
      const snap = snapshot(net, st);
      for (const n of net.nodes) {
        const h = r.heads.get(n.id) ?? NaN;
        res.head[n.id].push(h);
        res.pressure[n.id].push(h - (n.kind === 'reservoir' && n.storage ? n.elev : n.elev));
        res.demand[n.id].push(n.kind === 'junction' ? snap.nodes.find((x) => x.id === n.id)!.demand ?? 0 : -netInflow(net, r, n.id));
      }
      for (const id of linkIds(net)) {
        const q = r.flows.get(id) ?? 0;
        res.flow[id].push(q);
        const pump = net.pumps.find((p) => p.id === id);
        const pipe = net.pipes.find((p) => p.id === id);
        res.status[id].push(pump ? ((st.linkOpen.get(id) ?? pump.on) && q > 1e-9 ? 1 : 0) : pipe ? ((st.linkOpen.get(id) ?? !pipe.closed) ? 1 : 0) : (r.openings.get(id) ?? 1) > 0 ? 1 : 0);
      }
      for (const n of tanks) { res.level[n.id].push(st.levels.get(n.id)!); res.volume[n.id].push(vol.get(n.id)!); }
      if (wq) wq.record(res);
      nextRep += rep;
      onProgress?.(Math.min(1, st.t / e.duration));
    }
    if (st.t >= e.duration - 1e-6) break;

    // next event: hydraulic step, pattern step, report time, timed control, tank reaching a limit or control level
    let dt = e.hydStep - (st.t % e.hydStep);
    if (dt < 1e-6) dt = e.hydStep;
    const ps = e.patternStep ?? e.hydStep;
    const toPat = ps - ((st.t + (e.patternStart ?? 0)) % ps);
    if (toPat > 1e-6) dt = Math.min(dt, toPat);
    dt = Math.min(dt, nextRep - st.t > 1e-6 ? nextRep - st.t : rep, e.duration - st.t);
    let nr = Infinity;
    if (rules.length) { nr = (Math.floor(st.t / ruleStep + 1e-9) + 1) * ruleStep - st.t; if (nr <= 1e-6) nr = Infinity; }
    for (const c of controls) {
      if (c.at !== undefined && c.at > st.t + 1e-6) dt = Math.min(dt, c.at - st.t);
      if (c.clock !== undefined) { const day = (((st.t + (e.startClock ?? 0)) % 86400) + 86400) % 86400; const d = (c.clock - day + 86400) % 86400; if (d > 1e-6) dt = Math.min(dt, d); }
    }
    for (const n of tanks) {
      const s = n.storage!, q = full.has(n.id) || empty.has(n.id) ? 0 : netInflow(net, r, n.id);
      if (Math.abs(q) < 1e-12) continue;
      const lv = st.levels.get(n.id)!, v = vol.get(n.id)!;
      const targets = [s.minLevel, s.maxLevel, ...controls.filter((c) => c.node === n.id && c.value !== undefined).map((c) => c.value!)];
      for (const L of targets) {
        if ((q > 0 && L > lv + 1e-6) || (q < 0 && L < lv - 1e-6)) {
          const t = (tankVolume(s, L) - v) / q;
          if (t > 1e-3) dt = Math.min(dt, t);
        }
      }
    }
    // pressure controls on junctions: EPANET checks them at each step only (no interpolation)
    ruleOnly = nr < dt - 1e-6;
    dt = Math.max(Math.min(dt, nr), 1e-3);

    // advance
    if (wq) {
      // water quality runs over whole hydraulic periods (as EPANET): rule checks that change nothing extend the period
      if (!qp) { const snap = snapshot(net, st); const fu = full, em = empty, rr = r; qp = { r: rr, t0: st.t, dt: 0, tankQ: (id) => (fu.has(id) || em.has(id) ? 0 : netInflow(net, rr, id)), demand: new Map(snap.nodes.map((n) => [n.id, n.demand ?? 0])) }; }
      qp.dt += dt;
    }
    for (const n of tanks) {
      const s = n.storage!;
      const q = full.has(n.id) || empty.has(n.id) ? 0 : netInflow(net, r, n.id);
      let v = vol.get(n.id)! + q * dt;
      const vMin = tankVolume(s, s.minLevel), vMax = tankVolume(s, s.maxLevel);
      v = Math.min(Math.max(v, vMin), vMax);
      vol.set(n.id, v);
      const lv = tankLevel(s, v);
      const was = st.levels.get(n.id)!;
      st.levels.set(n.id, lv);
      if (lv >= s.maxLevel - 1e-6 && was < s.maxLevel - 1e-6) res.log.push({ t: st.t + dt, text: `Tank ${n.id} full` });
      if (lv <= s.minLevel + 1e-6 && was > s.minLevel + 1e-6) res.log.push({ t: st.t + dt, text: `Tank ${n.id} empty` });
    }
    for (const p of net.pumps) {
      const q = r.flows.get(p.id) ?? 0;
      if (q <= 0) continue;
      const dh = (r.heads.get(p.to) ?? 0) - (r.heads.get(p.from) ?? 0);
      res.energy[p.id] += (998.2 * G * q * Math.max(dh, 0)) / (p.efficiency || 0.75) / 1000 * (dt / 3600);
    }
    st.t += dt;
  }
  onProgress?.(1);
  res.final = { t: st.t, levels: Object.fromEntries(st.levels), linkOpen: Object.fromEntries(st.linkOpen), setting: Object.fromEntries(st.setting) };
  if (wq) res.qualityUnit = wq.unit;
  if (wq) res.quality = wq.out;
  return res;
}

function describe(c: SimpleControl) {
  if (c.at !== undefined) return `at ${clock(c.at)}`;
  if (c.clock !== undefined) return `at clock ${clock(c.clock)}`;
  return `${c.node} ${c.op} ${c.value}`;
}
export const clock = (t: number) => `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}`;

/** Net flow into a node from all its links, m³/s. */
function netInflow(net: Network, r: SteadyResult, id: string) {
  let q = 0;
  for (const p of net.pipes) { const f = r.flows.get(p.id) ?? 0; if (p.to === id) q += f; if (p.from === id) q -= f; }
  for (const p of net.pumps) { const f = r.flows.get(p.id) ?? 0; if (p.to === id) q += f; if (p.from === id) q -= f; }
  for (const v of net.valves) { const f = r.flows.get(v.id) ?? 0; if (v.to === id) q += f; if (v.from === id) q -= f; }
  return q;
}

// ── water quality ──
interface Seg { v: number; c: number }
interface QLink { id: string; from: string; to: string; vol: number; d: number; L: number; kb: number; kw: number; segs: Seg[]; dir: number }

class Quality {
  out: Record<string, number[]> = {};
  unit: string;
  private links: QLink[];
  private c = new Map<string, number>(); // node concentration
  private tankC = new Map<string, number>();
  private tankV = new Map<string, number>();
  private net: Network;
  private e: EPSSettings;
  private ctol: number;
  constructor(net: Network, e: EPSSettings) {
    this.net = net; this.e = e;
    this.unit = e.quality === 'age' ? 'h' : e.quality === 'trace' ? '%' : 'mg/L';
    this.ctol = e.tolerance ?? 0.01;
    const c0 = (n: NetNode) => (e.quality === 'chemical' ? n.quality ?? 0 : e.quality === 'trace' ? (n.id === e.traceNode ? 100 : 0) : 0);
    for (const n of net.nodes) {
      this.c.set(n.id, c0(n));
      this.out[n.id] = [];
      if (n.storage) { this.tankC.set(n.id, c0(n)); this.tankV.set(n.id, tankVolume(n.storage, n.storage.initLevel)); }
    }
    const kb = e.quality === 'chemical' ? (e.bulk ?? 0) : 0, kw = e.quality === 'chemical' ? (e.wall ?? 0) : 0;
    this.links = [
      ...net.pipes.map((p) => {
        // EPANET starts a pipe at the quality of its downstream node
        const c = (this.c.get(p.to)! + 0);
        return { id: p.id, from: p.from, to: p.to, vol: area(p.diameter) * p.length, d: p.diameter, L: p.length, kb: (p.bulkCoeff ?? kb) / 86400, kw: (p.wallCoeff ?? kw) / 86400, segs: [{ v: area(p.diameter) * p.length, c }], dir: 1 };
      }),
      ...net.pumps.map((p) => ({ id: p.id, from: p.from, to: p.to, vol: 0, d: 1, L: 0, kb: 0, kw: 0, segs: [], dir: 1 })),
      ...net.valves.map((v) => ({ id: v.id, from: v.from, to: v.to, vol: 0, d: 1, L: 0, kb: 0, kw: 0, segs: [], dir: 1 })),
    ];
  }

  record(res: EPSResult) { for (const n of this.net.nodes) this.out[n.id].push(round(this.nodeOut(n.id))); res.qualityUnit = this.unit; }

  private nodeOut(id: string) { return this.tankC.has(id) ? this.tankC.get(id)! : this.c.get(id)!; }

  /** Pipe reaction rate per unit concentration, 1/s (first order, EPANET wall model with mass transfer). */
  private rate(l: QLink, q: number) {
    if (this.e.quality !== 'chemical') return 0;
    let k = l.kb;
    if (l.kw !== 0 && l.vol > 0) {
      const Dm = this.e.diffusivity ?? 1.208e-9;
      const u = Math.abs(q) / area(l.d), Re = (u * l.d) / NU, Sc = NU / Dm;
      let Sh: number;
      if (Re < 1) Sh = 2;
      else if (Re >= 2300) Sh = 0.0149 * Re ** 0.88 * Sc ** (1 / 3);
      else { const y = (l.d / l.L) * Re * Sc; Sh = 3.65 + (0.0668 * y) / (1 + 0.04 * y ** (2 / 3)); }
      const kf = (Sh * Dm) / l.d;
      k += (4 / l.d) * (l.kw * kf) / (Math.abs(l.kw) + kf);
    }
    return k;
  }

  advance(r: SteadyResult, dtH: number, tankQ: (id: string) => number, demand: Map<string, number>, t0: number) {
    const e = this.e;
    const flows = new Map(this.links.map((l) => [l.id, r.flows.get(l.id) ?? 0]));
    // closed links carry nothing
    for (const l of this.links) if (Math.abs(flows.get(l.id)!) < 1e-9) flows.set(l.id, 0);
    // flow reversal: the segment list keeps the downstream end first
    for (const l of this.links) { const d = flows.get(l.id)! >= 0 ? 1 : -1; if (d !== l.dir && flows.get(l.id) !== 0) { l.segs.reverse(); l.dir = d; } }
    const order = this.sortNodes(flows);
    const inLinks = new Map<string, QLink[]>(), outLinks = new Map<string, QLink[]>();
    for (const n of this.net.nodes) { inLinks.set(n.id, []); outLinks.set(n.id, []); }
    for (const l of this.links) {
      const q = flows.get(l.id)!;
      if (q === 0) continue;
      const up = q > 0 ? l.from : l.to, dn = q > 0 ? l.to : l.from;
      outLinks.get(up)!.push(l); inLinks.get(dn)!.push(l);
    }
    const kTank = (e.tankBulk ?? e.bulk ?? 0) / 86400;
    const nodeById = new Map(this.net.nodes.map((n) => [n.id, n]));
    let left = dtH;
    while (left > 1e-9) {
      const dt = Math.min(e.qualStep ?? 300, left);
      const tSub = t0 + (dtH - left); // start of this quality step (sources follow their pattern by it)
      left -= dt;
      // 1. reactions
      for (const l of this.links) {
        if (!l.segs.length) continue;
        if (e.quality === 'age') for (const s of l.segs) s.c += dt / 3600;
        else if (e.quality === 'chemical') { const k = this.rate(l, flows.get(l.id)!); if (k !== 0) { const f = Math.exp(k * dt); for (const s of l.segs) s.c *= f; } }
      }
      for (const [id, c] of this.tankC) {
        if (e.quality === 'age') this.tankC.set(id, c + dt / 3600);
        else if (e.quality === 'chemical' && kTank !== 0) this.tankC.set(id, c * Math.exp(kTank * dt));
      }
      // 2. transport, nodes in flow order
      const passMass = new Map<string, { m: number; v: number }>(); // zero-volume links: water passing this step
      for (const id of order) {
        const n = nodeById.get(id)!;
        let m = 0, v = 0;
        for (const l of inLinks.get(id)!) {
          const qv = Math.abs(flows.get(l.id)!) * dt;
          if (l.vol === 0) { const p = passMass.get(l.id); if (p) { m += p.m; v += p.v; } continue; }
          const w = this.withdraw(l, qv);
          m += w.m; v += w.v;
        }
        let cOut: number;
        if (n.storage) {
          // completely mixed tank
          const V0 = this.tankV.get(id)!, C0 = this.tankC.get(id)!;
          const V1 = V0 + v;
          const C1 = V1 > 0 ? (C0 * V0 + m) / V1 : C0;
          this.tankC.set(id, C1);
          const qNet = tankQ(id);
          this.tankV.set(id, Math.max(V0 + qNet * dt, 0));
          cOut = C1;
          this.c.set(id, C1);
        } else if (n.kind === 'reservoir') {
          cOut = e.quality === 'trace' ? (id === e.traceNode ? 100 : 0) : e.quality === 'age' ? 0 : this.srcConc(n, tSub) ?? n.quality ?? 0;
          this.c.set(id, cOut);
        } else {
          // water supplied at the node (negative demand) enters at the source concentration (age 0, no trace)
          const sup = Math.max(-(demand.get(id) ?? 0), 0) * dt;
          if (sup > 0) { v += sup; m += sup * (e.quality === 'chemical' ? this.srcConc(n, tSub) ?? 0 : 0); }
          cOut = v > 0 ? m / v : this.noFlow(id);
          if (e.quality === 'trace' && id === e.traceNode) cOut = 100;
          if (e.quality === 'chemical' && n.booster !== undefined) cOut = Math.max(cOut, n.booster);
          this.c.set(id, cOut);
        }
        for (const l of outLinks.get(id)!) {
          const qv = Math.abs(flows.get(l.id)!) * dt;
          if (l.vol === 0) passMass.set(l.id, { m: cOut * qv, v: qv });
          else this.push(l, qv, cOut);
        }
      }
    }
  }

  /** A node with no inflow takes the average of the water next to it in its pipes (as EPANET does), so stagnant
   *  water keeps ageing and reacting. */
  private noFlow(id: string) {
    let sum = 0, k = 0;
    for (const l of this.links) {
      if (!l.segs.length) continue;
      // segs[0] is at the downstream end for direction `dir` (+1: the `to` node)
      const atTo = l.dir > 0 ? l.segs[0] : l.segs[l.segs.length - 1];
      const atFrom = l.dir > 0 ? l.segs[l.segs.length - 1] : l.segs[0];
      if (l.to === id) { sum += atTo.c; k++; }
      if (l.from === id) { sum += atFrom.c; k++; }
    }
    return k ? sum / k : this.c.get(id)!;
  }

  private srcConc(n: NetNode, t: number) {
    return n.sourceConc === undefined ? undefined : n.sourceConc * (n.sourcePattern ? patternFactor(this.net, n.sourcePattern, t) : 1);
  }

  /** Remove `v` m³ from the downstream end of a pipe; returns the mass and volume taken. */
  private withdraw(l: QLink, v: number) {
    let m = 0, got = 0;
    while (got < v - 1e-12 && l.segs.length) {
      const s = l.segs[0];
      const take = Math.min(s.v, v - got);
      m += take * s.c; got += take; s.v -= take;
      if (s.v <= 1e-12) l.segs.shift();
    }
    return { m, v: got };
  }
  /** Add `v` m³ at concentration c to the upstream end of a pipe. */
  private push(l: QLink, v: number, c: number) {
    const last = l.segs[l.segs.length - 1];
    if (last && Math.abs(last.c - c) <= this.ctol) { last.c = (last.c * last.v + c * v) / (last.v + v); last.v += v; }
    else l.segs.push({ v, c });
  }

  private sortNodes(flows: Map<string, number>): string[] {
    const ids = this.net.nodes.map((n) => n.id);
    const indeg = new Map(ids.map((i) => [i, 0]));
    const adj = new Map<string, string[]>(ids.map((i) => [i, []]));
    for (const l of this.links) {
      const q = flows.get(l.id)!;
      if (q === 0) continue;
      const up = q > 0 ? l.from : l.to, dn = q > 0 ? l.to : l.from;
      adj.get(up)!.push(dn); indeg.set(dn, indeg.get(dn)! + 1);
    }
    const out: string[] = [];
    const queue = ids.filter((i) => indeg.get(i) === 0);
    const seen = new Set<string>();
    while (out.length < ids.length) {
      while (queue.length) {
        const i = queue.shift()!;
        if (seen.has(i)) continue;
        seen.add(i); out.push(i);
        for (const j of adj.get(i)!) { indeg.set(j, indeg.get(j)! - 1); if (indeg.get(j) === 0) queue.push(j); }
      }
      // a loop of flow: release the node with the fewest unresolved inflows
      const rest = ids.filter((i) => !seen.has(i));
      if (!rest.length) break;
      rest.sort((a, b) => indeg.get(a)! - indeg.get(b)!);
      queue.push(rest[0]);
      indeg.set(rest[0], 0);
    }
    return out;
  }
}
const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** The model as it is at time `t` of the day (tank levels, demands, pumps and valves from the extended-period run),
 *  ready for a surge run that starts then. The operations of the surge run are kept. */
export function networkAt(net: Network, t: number): Network {
  const r = runEPS({ ...net, eps: { ...defaultEPS(), ...(net.eps ?? {}), duration: t, quality: 'none', reportStep: Math.max(t, 1) } });
  const f = r.final!;
  const snap = snapshot(net, { t: f.t, levels: new Map(Object.entries(f.levels)), linkOpen: new Map(Object.entries(f.linkOpen)), setting: new Map(Object.entries(f.setting)) });
  return {
    ...snap,
    nodes: snap.nodes.map((n) => (n.storage ? { ...n, storage: { ...n.storage, initLevel: f.levels[n.id] ?? n.storage.initLevel } } : n)),
    event: net.event, extraEvents: net.extraEvents,
    name: `${net.name} at ${clock(t)}`,
  };
}
