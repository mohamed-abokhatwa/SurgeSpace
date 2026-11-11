// EPANET .inp import and export. EPANET has no transient data, so wave speeds, pump inertia and devices
// get sensible defaults the user reviews afterwards.
import { valveArea } from './devices';
import { estimateInertia } from './hydraulics';
import { defaultSettings, type ControlRule, type RuleCondition, type EPSSettings, type Network, type NetNode, type Pipe, type Pump, type SimpleControl, type TimePattern, type Valve } from './types';

/** EPANET time text ("24:00", "1:30:00", "0:05", "6", "5 MIN", "12 AM") → seconds. */
export function inpTime(parts: string[]): number {
  const t = parts[0] ?? '0';
  const u = (parts[1] ?? '').toUpperCase();
  if (u === 'AM' || u === 'PM') { const [h, m = '0'] = t.split(':'); const hh = (Number(h) % 12) + (u === 'PM' ? 12 : 0); return hh * 3600 + Number(m) * 60; }
  if (t.includes(':')) { const a = t.split(':').map(Number); return a[0] * 3600 + (a[1] ?? 0) * 60 + (a[2] ?? 0); }
  const x = Number(t);
  if (u.startsWith('SEC')) return x;
  if (u.startsWith('MIN')) return x * 60;
  if (u.startsWith('DAY')) return x * 86400;
  return x * 3600;
}

const FLOW_TO_SI: Record<string, number> = {
  CFS: 0.0283168466, GPM: 6.30901964e-5, MGD: 0.0438126364, IMGD: 0.0526167, AFD: 0.0142764,
  LPS: 1e-3, LPM: 1e-3 / 60, MLD: 1e-3 * 1e6 / 86400, CMH: 1 / 3600, CMD: 1 / 86400,
};
const US = new Set(['CFS', 'GPM', 'MGD', 'IMGD', 'AFD']);

export interface InpImport {
  network: Network;
  notes: string[];
}

export function parseInp(text: string, name = 'Imported network'): InpImport {
  const notes: string[] = [];
  const sections = new Map<string, string[][]>();
  let cur = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^\[(.+)\]$/);
    if (m) {
      cur = m[1].toUpperCase();
      if (!sections.has(cur)) sections.set(cur, []);
      continue;
    }
    if (cur) sections.get(cur)!.push(line.split(/\s+/));
  }
  const sec = (k: string) => sections.get(k) ?? [];
  const opts = new Map(sec('OPTIONS').map((r) => [r[0].toUpperCase(), r.slice(1).join(' ').toUpperCase()]));
  const units = (opts.get('UNITS') ?? 'GPM').split(' ')[0];
  const qf = FLOW_TO_SI[units] ?? FLOW_TO_SI.GPM;
  const us = US.has(units);
  const lf = us ? 0.3048 : 1; // length / elevation / head
  const df = us ? 0.0254 : 0.001; // diameter
  const hl = (opts.get('HEADLOSS') ?? 'H-W').replace(/\s/g, '');
  const friction: 'DW' | 'HW' = hl.startsWith('D') ? 'DW' : 'HW';
  if (hl.startsWith('C')) notes.push('Chezy-Manning roughness was converted approximately to Hazen-Williams C = 1 / n × 0.0123; check it.');
  const roughConv = (r: number) => (friction === 'DW' ? (us ? r * 0.3048 : r) : hl.startsWith('C') ? Math.round(0.0123 / Math.max(r, 1e-4) * 100) / 100 : r);
  // EPANET D-W roughness: millifeet (US) or mm (SI) → mm
  const dwRough = (r: number) => (us ? r * 0.3048 : r);

  const coords = new Map<string, [number, number]>();
  for (const r of sec('COORDINATES')) coords.set(r[0], [Number(r[1]), Number(r[2])]);
  const curves = new Map<string, [number, number][]>();
  for (const r of sec('CURVES')) curves.set(r[0], [...(curves.get(r[0]) ?? []), [Number(r[1]) * qf, Number(r[2]) * lf]]);

  const nodes: NetNode[] = [];
  for (const r of sec('JUNCTIONS')) {
    nodes.push({ id: r[0], kind: 'junction', x: 0, y: 0, elev: Number(r[1]) * lf, demand: (Number(r[2] ?? 0) || 0) * qf, ...(r[3] ? { pattern: r[3] } : {}) });
  }
  for (const r of sec('RESERVOIRS')) {
    nodes.push({ id: r[0], kind: 'reservoir', x: 0, y: 0, elev: Number(r[1]) * lf, head: Number(r[1]) * lf, ...(r[2] ? { pattern: r[2] } : {}) });
  }
  for (const r of sec('TANKS')) {
    const elev = Number(r[1]) * lf;
    const vc = r[7] && r[7] !== '*' ? curves.get(r[7]) : undefined;
    nodes.push({
      id: r[0], kind: 'reservoir', x: 0, y: 0, elev, head: elev + Number(r[2]) * lf,
      storage: {
        initLevel: Number(r[2]) * lf, minLevel: Number(r[3]) * lf, maxLevel: Number(r[4]) * lf, diameter: Number(r[5]) * lf,
        ...(Number(r[6]) > 0 ? { minVolume: Number(r[6]) * lf ** 3 } : {}),
        // volume curves were read with flow units on x; convert back: level (length), volume (length³)
        ...(vc ? { volumeCurve: vc.map(([x, y]) => [(x / qf) * lf, (y / lf) * lf ** 3] as [number, number]) } : {}),
      },
    });
  }
  if (sec('TANKS').length) notes.push('Tanks vary in level in the extended-period run and hold their level during a surge run.');
  const multiDemand = new Set<string>();
  for (const r of sec('DEMANDS')) {
    const n = nodes.find((x) => x.id === r[0]);
    if (!n || n.kind !== 'junction') continue;
    if (multiDemand.has(n.id)) { n.demand = (n.demand ?? 0) + Number(r[1]) * qf; notes.push(`Junction ${n.id} has several demand categories; they were added together.`); continue; }
    multiDemand.add(n.id);
    n.demand = Number(r[1]) * qf;
    if (r[2]) n.pattern = r[2]; else delete n.pattern;
  }
  const missing = nodes.filter((n) => !coords.has(n.id)).length;
  nodes.forEach((n, i) => {
    const c = coords.get(n.id);
    if (c) [n.x, n.y] = [c[0], c[1]];
    else [n.x, n.y] = [(i % 10) * 100, Math.floor(i / 10) * 100];
  });
  if (missing) notes.push(`${missing} nodes had no coordinates and were placed on a grid.`);

  const pipes: Pipe[] = [];
  const cvPipes: string[] = [];
  for (const r of sec('PIPES')) {
    const status = (r[7] ?? 'OPEN').toUpperCase();
    pipes.push({
      id: r[0], from: r[1], to: r[2], length: Number(r[3]) * lf, diameter: Number(r[4]) * df,
      roughness: friction === 'DW' ? dwRough(Number(r[5])) : roughConv(Number(r[5])),
      minorLoss: Number(r[6] ?? 0) || 0, wavespeed: 1000, closed: status === 'CLOSED',
    });
    if (status === 'CV') cvPipes.push(r[0]);
  }
  if (pipes.length) notes.push('All pipes got a wave speed of 1000 m/s. Set real values by material (steel ~1200, ductile iron ~1100, PVC ~400, HDPE ~300 m/s).');

  const pumps: Pump[] = [];
  for (const r of sec('PUMPS')) {
    const kv = new Map<string, string>();
    for (let i = 3; i < r.length - 1; i += 2) kv.set(r[i].toUpperCase(), r[i + 1]);
    let curve: [number, number][] = [];
    let power: number | undefined;
    if (kv.has('HEAD')) curve = curves.get(kv.get('HEAD')!) ?? [];
    if (kv.has('POWER')) {
      power = Number(kv.get('POWER')) * (us ? 0.7457 : 1); // hp or kW → kW
      curve = [[0.1, (power * 1000) / (998.2 * 9.80665 * 0.1)]];
    }
    if (!curve.length) {
      notes.push(`Pump ${r[0]} has no head curve; a 100 L/s × 40 m curve was assumed.`);
      curve = [[0.1, 40]];
    }
    const s = kv.has('SPEED') ? Number(kv.get('SPEED')) : 1;
    let sorted = [...curve].sort((a, b) => a[0] - b[0]);
    if (s !== 1 && s > 0) sorted = sorted.map(([q, h]) => [q * s, h * s * s] as [number, number]); // homologous speed setting
    const design = sorted.length === 1 ? sorted[0] : sorted[Math.min(1, sorted.length - 1)];
    const speedRpm = 1480;
    pumps.push({
      id: r[0], from: r[1], to: r[2], curve: sorted, ...(power ? { power: power * (s > 0 ? s ** 3 : 1) } : {}),
      efficiency: 0.8, speed: speedRpm, inertia: Math.round(estimateInertia((998.2 * 9.80665 * design[0] * design[1]) / 0.8 / 1000, speedRpm) * 100) / 100,
      checkValve: true, on: true,
    });
  }
  if (pumps.length) notes.push('Pump speed 1480 rpm, efficiency 80 % and Thorley inertia were assumed; enter nameplate values.');
  const valves: Valve[] = [];
  for (const r of sec('VALVES')) {
    const type = (r[4] ?? 'TCV').toUpperCase();
    const setting = Number(r[5]);
    const ctl = (type === 'PRV' || type === 'PSV' || type === 'FCV') && Number.isFinite(setting)
      ? { type: type as 'PRV' | 'PSV' | 'FCV', set: type === 'FCV' ? setting * qf : setting * (us ? 0.70307 : 1), active: false }
      : undefined;
    if (!ctl && type !== 'TCV' && type !== 'GPV') notes.push(`Valve ${r[0]} (${type}) is modelled as a fixed-opening valve.`);
    valves.push({ id: r[0], from: r[1], to: r[2], diameter: Number(r[3]) * df, k0: type === 'TCV' ? Math.max(setting || 0.2, 0.05) : Math.max(Number(r[6] ?? 0.2) || 0.2, 0.05), opening: 1, ...(ctl ? { control: ctl } : {}) });
    if (ctl) notes.push(`Valve ${r[0]} is a ${type} (set ${ctl.type === 'FCV' ? `${(ctl.set * 1000).toFixed(1)} L/s` : `${ctl.set.toFixed(1)} m`}); it is locked at its steady opening during the transient unless you make it active.`);
  }
  // pipes with a check valve become a non-return valve followed by the pipe
  for (const id of cvPipes) {
    const p = pipes.find((x) => x.id === id)!;
    const n = nodes.find((x) => x.id === p.from)!;
    const nid = `${p.from}~${id}`;
    nodes.push({ id: nid, kind: 'junction', x: n.x, y: n.y, elev: n.elev, demand: 0 });
    valves.push({ id: `${id}-NRV`, from: p.from, to: nid, diameter: p.diameter, k0: 0.05, opening: 1, check: true });
    p.from = nid;
  }
  if (cvPipes.length) notes.push(`${cvPipes.length} pipe(s) with a check valve became a non-return valve plus the pipe.`);
  for (const r of sec('STATUS')) {
    const id = r[0], st = (r[1] ?? '').toUpperCase();
    const p = pumps.find((x) => x.id === id);
    if (p && st === 'CLOSED') p.on = false;
    if (p && Number.isFinite(Number(st)) && Number(st) !== 1) {
      const sp = Number(st);
      if (sp <= 0) p.on = false;
      else { p.curve = p.curve.map(([q, h]) => [q * sp, h * sp * sp]); if (p.power) p.power *= sp ** 3; }
    }
    const pi = pipes.find((x) => x.id === id);
    if (pi && st === 'CLOSED') pi.closed = true;
  }
  // ── extended period ──
  const patMap = new Map<string, number[]>();
  for (const r of sec('PATTERNS')) patMap.set(r[0], [...(patMap.get(r[0]) ?? []), ...r.slice(1).map(Number)]);
  const patterns: TimePattern[] = [...patMap].map(([id, factors]) => ({ id, factors }));
  const times = new Map(sec('TIMES').map((r) => {
    const words: string[] = []; let i = 0;
    while (i < r.length && !/^[\d.:]+$/.test(r[i])) words.push(r[i++].toUpperCase());
    return [words.join(' '), r.slice(i)] as [string, string[]];
  }));
  const tm = (k: string, d: number) => (times.has(k) ? inpTime(times.get(k)!) : d);
  const hydStep = tm('HYDRAULIC TIMESTEP', 3600);
  const qualOpt = (opts.get('QUALITY') ?? 'NONE').split(' ');
  const qmode = qualOpt[0];
  const eps: EPSSettings = {
    duration: tm('DURATION', 0), hydStep, patternStep: tm('PATTERN TIMESTEP', hydStep), patternStart: tm('PATTERN START', 0),
    reportStep: tm('REPORT TIMESTEP', hydStep), startClock: times.has('START CLOCKTIME') ? inpTime(times.get('START CLOCKTIME')!) : 0,
    qualStep: Math.min(tm('QUALITY TIMESTEP', 300), hydStep),
    quality: qmode === 'AGE' ? 'age' : qmode === 'TRACE' ? 'trace' : qmode === 'NONE' || qmode === '' ? 'none' : 'chemical',
    ...(qmode === 'TRACE' ? { traceNode: sec('OPTIONS').find((r) => r[0].toUpperCase() === 'QUALITY')?.[2] } : {}),
    ...(qmode !== 'AGE' && qmode !== 'TRACE' && qmode !== 'NONE' ? { chemical: sec('OPTIONS').find((r) => r[0].toUpperCase() === 'QUALITY')?.[1] ?? 'Chemical' } : {}),
  };
  const defPat = opts.get('PATTERN') ? sec('OPTIONS').find((r) => r[0].toUpperCase() === 'PATTERN')?.[1] : patMap.has('1') ? '1' : undefined;
  if (defPat && patMap.has(defPat)) eps.defaultPattern = defPat;
  if (opts.has('TOLERANCE')) eps.tolerance = Number(opts.get('TOLERANCE'));
  if (opts.has('DIFFUSIVITY')) eps.diffusivity = 1.208e-9 * Number(opts.get('DIFFUSIVITY'));
  for (const r of sec('REACTIONS')) {
    const k = r.map((x) => x.toUpperCase());
    if (k[0] === 'GLOBAL' && k[1] === 'BULK') eps.bulk = Number(r[2]);
    else if (k[0] === 'GLOBAL' && k[1] === 'WALL') eps.wall = Number(r[2]) * lf;
    else if (k[0] === 'BULK') { const p = pipes.find((x) => x.id === r[1]); if (p) p.bulkCoeff = Number(r[2]); }
    else if (k[0] === 'WALL') { const p = pipes.find((x) => x.id === r[1]); if (p) p.wallCoeff = Number(r[2]) * lf; }
    else if (k[0] === 'ORDER' && Number(r[2]) !== 1 && !(k[1] === 'WALL' && Number(r[2]) === 1)) notes.push(`Reaction order ${r[1]} ${r[2]} is not supported; first order is used.`);
  }
  for (const r of sec('QUALITY')) { const n = nodes.find((x) => x.id === r[0]); if (n) n.quality = Number(r[1]); }
  for (const r of sec('SOURCES')) {
    const n = nodes.find((x) => x.id === r[0]);
    if (!n) continue;
    const type = r[1].toUpperCase();
    if (type === 'SETPOINT' && n.kind === 'junction') n.booster = Number(r[2]);
    else if (type === 'CONCEN') { n.sourceConc = Number(r[2]); if (r[3]) n.sourcePattern = r[3]; }
    else notes.push(`Quality source at ${r[0]} (${type}) is not supported; it was ignored.`);
  }
  const controls: SimpleControl[] = [];
  for (const r of sec('CONTROLS')) {
    const k = r.map((x) => x.toUpperCase());
    if (k[0] !== 'LINK') continue;
    const link = r[1], what = k[2];
    const c: SimpleControl = { link };
    if (what === 'OPEN' || what === 'CLOSED') c.status = what === 'OPEN' ? 'open' : 'closed';
    else {
      const v = Number(r[2]);
      const valve = valves.find((x) => x.id === link);
      c.setting = valve?.control ? (valve.control.type === 'FCV' ? v * qf : v * (us ? 0.70307 : 1)) : v;
    }
    if (k[3] === 'AT' && k[4] === 'TIME') c.at = inpTime(r.slice(5));
    else if (k[3] === 'AT' && k[4] === 'CLOCKTIME') c.clock = inpTime(r.slice(5));
    else if (k[3] === 'IF' && k[4] === 'NODE') {
      c.node = r[5]; c.op = k[6] === 'ABOVE' ? 'above' : 'below';
      const nn = nodes.find((x) => x.id === r[5]);
      c.value = Number(r[7]) * (nn?.storage ? lf : us ? 0.70307 : 1);
    } else { notes.push(`Control "${r.join(' ')}" was not understood and was skipped.`); continue; }
    controls.push(c);
  }
  // rule-based controls
  const rules = parseRuleRows(sec('RULES'), {
    level: lf, pressure: us ? 0.70307 : 1, flow: qf,
    setting: (id, v) => { const valve = valves.find((x) => x.id === id); return valve?.control ? (valve.control.type === 'FCV' ? v * qf : v * (us ? 0.70307 : 1)) : v; },
  });
  if (rules.length) notes.push(`${rules.length} rule-based control(s) read.`);
  const title = sec('TITLE').map((r) => r.join(' ')).join(' ').trim();
  return {
    network: {
      name: title || name,
      description: `Imported from EPANET (${units}, ${hl}).`,
      nodes, pipes, pumps, valves,
      event: pumps.length ? { kind: 'pumpTrip', targets: pumps.filter((p) => p.on).map((p) => p.id), start: 1 } : valves.length ? { kind: 'valveClose', targets: [valves[0].id], start: 1, duration: 5 } : { kind: 'none', targets: [], start: 0 },
      settings: { ...defaultSettings(), friction },
      ...(patterns.length ? { patterns } : {}),
      ...(controls.length ? { controls } : {}),
      ...(rules.length ? { rules } : {}),
      ...(eps.duration > 0 || eps.quality !== 'none' || patterns.length || nodes.some((n) => n.storage) ? { eps: { ...eps, duration: eps.duration || 86400 } } : {}),
    },
    notes,
  };
}

/** EPANET export (SI, LPS) — so models built here open in EPANET, WaterGEMS and others. */
export function toInp(net: Network): string {
  const L: string[] = [];
  L.push('[TITLE]', net.name, '', '[JUNCTIONS]', ';ID  Elev  Demand');
  for (const n of net.nodes.filter((x) => x.kind === 'junction')) L.push(`${n.id}  ${n.elev}  ${((n.demand ?? 0) * 1000).toFixed(4)}${n.pattern ? `  ${n.pattern}` : ''}`);
  L.push('', '[RESERVOIRS]', ';ID  Head  Pattern');
  for (const n of net.nodes.filter((x) => x.kind === 'reservoir' && !x.storage)) L.push(`${n.id}  ${n.head ?? n.elev}${n.pattern ? `  ${n.pattern}` : ''}`);
  L.push('', '[TANKS]', ';ID  Elevation  InitLevel  MinLevel  MaxLevel  Diameter  MinVol');
  for (const n of net.nodes.filter((x) => x.kind === 'reservoir' && x.storage)) { const t = n.storage!; L.push(`${n.id}  ${n.elev}  ${t.initLevel}  ${t.minLevel}  ${t.maxLevel}  ${t.diameter}  ${t.minVolume ?? 0}`); }
  L.push('', '[PIPES]', ';ID  Node1  Node2  Length  Diameter  Roughness  MinorLoss  Status');
  for (const p of net.pipes) L.push(`${p.id}  ${p.from}  ${p.to}  ${p.length}  ${(p.diameter * 1000).toFixed(1)}  ${p.roughness}  ${p.minorLoss ?? 0}  ${p.closed ? 'CLOSED' : p.checkValve ? 'CV' : 'OPEN'}`);
  L.push('', '[PUMPS]');
  for (const p of net.pumps) L.push(`${p.id}  ${p.from}  ${p.to}  HEAD  C_${p.id}`);
  L.push('', '[VALVES]', ';ID  Node1  Node2  Diameter  Type  Setting  MinorLoss');
  for (const v of net.valves) {
    if (v.control) L.push(`${v.id}  ${v.from}  ${v.to}  ${(v.diameter * 1000).toFixed(1)}  ${v.control.type}  ${v.control.type === 'FCV' ? (v.control.set * 1000).toFixed(4) : v.control.set}  ${v.k0}`);
    else {
      // a part-open valve is a TCV with the loss at that opening
      const a = valveArea(v, v.opening);
      L.push(`${v.id}  ${v.from}  ${v.to}  ${(v.diameter * 1000).toFixed(1)}  TCV  ${a > 0 ? +(v.k0 / (a * a)).toPrecision(6) : 1e12}  0`);
    }
  }
  L.push('', '[CURVES]');
  for (const p of net.pumps) for (const [q, h] of p.curve) L.push(`C_${p.id}  ${(q * 1000).toFixed(3)}  ${h}`);
  L.push('', '[STATUS]');
  for (const p of net.pumps.filter((x) => !x.on)) L.push(`${p.id}  CLOSED`);
  if (net.patterns?.length) { L.push('', '[PATTERNS]'); for (const p of net.patterns) for (let i = 0; i < p.factors.length; i += 6) L.push(`${p.id}  ${p.factors.slice(i, i + 6).join('  ')}`); }
  if (net.controls?.length) {
    L.push('', '[CONTROLS]');
    for (const c of net.controls) {
      const v = net.valves.find((x) => x.id === c.link);
      const act = c.status ? c.status.toUpperCase() : String(v?.control?.type === 'FCV' ? (c.setting ?? 0) * 1000 : c.setting);
      const cond = c.at !== undefined ? `AT TIME ${c.at / 3600}` : c.clock !== undefined ? `AT CLOCKTIME ${Math.floor(c.clock / 3600)}:${String(Math.round((c.clock % 3600) / 60)).padStart(2, '0')}` : `IF NODE ${c.node} ${c.op?.toUpperCase()} ${c.value}`;
      L.push(`LINK ${c.link} ${act} ${cond}`);
    }
  }
  if (net.rules?.length) L.push('', '[RULES]', rulesToText(net));
  const e = net.eps;
  const hms = (t: number) => `${Math.floor(t / 3600)}:${String(Math.round((t % 3600) / 60)).padStart(2, '0')}`;
  if (e) {
    L.push('', '[TIMES]', `Duration  ${hms(e.duration)}`, `Hydraulic Timestep  ${hms(e.hydStep)}`, `Pattern Timestep  ${hms(e.patternStep ?? e.hydStep)}`, `Report Timestep  ${hms(e.reportStep ?? e.hydStep)}`, `Quality Timestep  ${hms(e.qualStep ?? 300)}`);
    if (e.quality === 'chemical') {
      L.push('', '[REACTIONS]', `Global Bulk  ${e.bulk ?? 0}`, `Global Wall  ${e.wall ?? 0}`);
      for (const p of net.pipes) { if (p.bulkCoeff !== undefined) L.push(`Bulk  ${p.id}  ${p.bulkCoeff}`); if (p.wallCoeff !== undefined) L.push(`Wall  ${p.id}  ${p.wallCoeff}`); }
      L.push('', '[QUALITY]');
      for (const n of net.nodes) if (n.quality) L.push(`${n.id}  ${n.quality}`);
      const src = net.nodes.filter((n) => n.sourceConc !== undefined || n.booster !== undefined);
      if (src.length) { L.push('', '[SOURCES]'); for (const n of src) L.push(n.booster !== undefined ? `${n.id}  SETPOINT  ${n.booster}` : `${n.id}  CONCEN  ${n.sourceConc}${n.sourcePattern ? `  ${n.sourcePattern}` : ''}`); }
    }
  }
  const qopt = !e || e.quality === 'none' ? 'None' : e.quality === 'age' ? 'Age' : e.quality === 'trace' ? `Trace ${e.traceNode ?? ''}` : `${e.chemical ?? 'Chlorine'} mg/L`;
  L.push('', '[OPTIONS]', 'Units  LPS', `Headloss  ${net.settings.friction === 'DW' ? 'D-W' : 'H-W'}`, `Quality  ${qopt}`, ...(e?.defaultPattern ? [`Pattern  ${e.defaultPattern}`] : []), '', '[COORDINATES]');
  for (const n of net.nodes) L.push(`${n.id}  ${n.x}  ${n.y}`);
  L.push('', '[END]');
  return L.join('\n');
}

/** Parse EPANET rule lines (already split into words). `u` converts values to SI. */
export function parseRuleRows(rows: string[][], u: { level: number; pressure: number; flow: number; setting: (id: string, v: number) => number }): ControlRule[] {
  const rules: ControlRule[] = [];
  let rl: ControlRule | null = null, part: 'if' | 'then' | 'else' = 'if';
  const relop = (w: string): RuleCondition['op'] => ({ '=': '=', IS: '=', '<>': '<>', NOT: '<>', '<': '<', BELOW: '<', '>': '>', ABOVE: '>', '<=': '<=', '>=': '>=' } as Record<string, RuleCondition['op']>)[w.toUpperCase()] ?? '=';
  for (const r of rows) {
    const k0 = r[0].toUpperCase();
    if (k0 === 'RULE') { rl = { id: r[1], conditions: [], then: [] }; rules.push(rl); part = 'if'; continue; }
    if (!rl) continue;
    if (k0 === 'PRIORITY') { rl.priority = Number(r[1]); continue; }
    if (k0 === 'THEN' || k0 === 'ELSE') part = k0 === 'THEN' ? 'then' : 'else';
    if (k0 === 'IF') part = 'if';
    if (part === 'if' && (k0 === 'IF' || k0 === 'AND' || k0 === 'OR')) {
      const obj = r[1].toUpperCase();
      const sys = obj === 'SYSTEM';
      const id = sys ? undefined : r[2];
      const attr = (sys ? r[2] : r[3]).toLowerCase();
      const op = relop(sys ? r[3] : r[4]);
      const rest = sys ? r.slice(4) : r.slice(5);
      let value: number | string;
      if (attr === 'time' || attr === 'clocktime') value = inpTime(rest);
      else if (attr === 'status') value = rest[0].toLowerCase();
      else {
        const v = Number(rest[0]);
        value = attr === 'level' || attr === 'head' || attr === 'grade' ? v * u.level : attr === 'pressure' ? v * u.pressure : attr === 'demand' || attr === 'flow' ? v * u.flow : attr === 'setting' && id ? u.setting(id, v) : v;
      }
      rl.conditions.push({ logic: k0.toLowerCase() as 'if' | 'and' | 'or', object: obj.toLowerCase(), ...(id ? { id } : {}), attribute: attr, op, value });
      continue;
    }
    if ((part === 'then' || part === 'else') && (k0 === 'THEN' || k0 === 'ELSE' || k0 === 'AND')) {
      const id = r[2], attr = r[3].toUpperCase(), val = r[5] ?? r[4];
      const a = attr === 'STATUS' ? { link: id, status: (val.toUpperCase() === 'OPEN' ? 'open' : 'closed') as 'open' | 'closed' } : { link: id, setting: u.setting(id, Number(val)) };
      if (part === 'then') rl.then.push(a); else (rl.else ??= []).push(a);
    }
  }
  return rules;
}

/** Rules as EPANET text in SI (levels, heads and pressures in m, flows in L/s, times as h:mm). */
export function rulesToText(net: Network): string {
  const hm = (t: number) => `${Math.floor(t / 3600)}:${String(Math.round((t % 3600) / 60)).padStart(2, '0')}`;
  const opw: Record<string, string> = { '=': '=', '<>': '<>', '<': '<', '>': '>', '<=': '<=', '>=': '>=' };
  const setOut = (id: string, v: number) => +(net.valves.find((x) => x.id === id)?.control?.type === 'FCV' ? v * 1000 : v).toFixed(6);
  const kindOf = (id: string) => (net.pumps.some((p) => p.id === id) ? 'PUMP' : net.valves.some((v) => v.id === id) ? 'VALVE' : 'PIPE');
  const val = (c: RuleCondition) => (typeof c.value === 'string' ? c.value.toUpperCase() : c.attribute === 'time' || c.attribute === 'clocktime' ? hm(c.value) : c.attribute === 'flow' || c.attribute === 'demand' ? +(c.value * 1000).toFixed(4) : +c.value.toFixed(4));
  return (net.rules ?? []).map((r) => [
    `RULE ${r.id}`,
    ...r.conditions.map((c) => `${c.logic.toUpperCase()} ${c.object.toUpperCase()}${c.id ? ` ${c.id}` : ''} ${c.attribute.toUpperCase()} ${opw[c.op]} ${val(c)}`),
    ...r.then.map((a, i) => `${i ? 'AND' : 'THEN'} ${kindOf(a.link)} ${a.link} ${a.status ? `STATUS IS ${a.status.toUpperCase()}` : `SETTING IS ${setOut(a.link, a.setting!)}`}`),
    ...(r.else ?? []).map((a, i) => `${i ? 'AND' : 'ELSE'} ${kindOf(a.link)} ${a.link} ${a.status ? `STATUS IS ${a.status.toUpperCase()}` : `SETTING IS ${setOut(a.link, a.setting!)}`}`),
    ...(r.priority !== undefined ? [`PRIORITY ${r.priority}`] : []),
  ].join('\n')).join('\n\n');
}

/** Read rules typed in SI (as written by rulesToText). */
export function rulesFromText(text: string, net: Network): ControlRule[] {
  const rows = text.split(/\r?\n/).map((l) => l.replace(/;.*$/, '').trim()).filter(Boolean).map((l) => l.split(/\s+/));
  return parseRuleRows(rows, { level: 1, pressure: 1, flow: 1e-3, setting: (id, v) => (net.valves.find((x) => x.id === id)?.control?.type === 'FCV' ? v * 1e-3 : v) });
}
