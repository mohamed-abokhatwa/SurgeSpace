// EPANET .inp import and export. EPANET has no transient data, so wave speeds, pump inertia and devices
// get sensible defaults the user reviews afterwards.
import { estimateInertia } from './hydraulics';
import { defaultSettings, type Network, type NetNode, type Pipe, type Pump, type Valve } from './types';

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
    nodes.push({ id: r[0], kind: 'junction', x: 0, y: 0, elev: Number(r[1]) * lf, demand: (Number(r[2] ?? 0) || 0) * qf });
  }
  for (const r of sec('RESERVOIRS')) {
    nodes.push({ id: r[0], kind: 'reservoir', x: 0, y: 0, elev: Number(r[1]) * lf, head: Number(r[1]) * lf });
  }
  for (const r of sec('TANKS')) {
    const elev = Number(r[1]) * lf;
    nodes.push({ id: r[0], kind: 'reservoir', x: 0, y: 0, elev, head: elev + Number(r[2]) * lf });
  }
  if (sec('TANKS').length) notes.push('Tanks are held at their initial level during the transient (seconds to minutes).');
  for (const r of sec('DEMANDS')) {
    const n = nodes.find((x) => x.id === r[0]);
    if (n && n.kind === 'junction') n.demand = Number(r[1]) * qf;
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
    if (type !== 'TCV' && type !== 'GPV') notes.push(`Valve ${r[0]} (${type}) is modelled as a fixed-opening valve.`);
    valves.push({ id: r[0], from: r[1], to: r[2], diameter: Number(r[3]) * df, k0: type === 'TCV' ? Math.max(Number(r[5]) || 0.2, 0.05) : Math.max(Number(r[6] ?? 0.2) || 0.2, 0.05), opening: 1 });
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
  const title = sec('TITLE').map((r) => r.join(' ')).join(' ').trim();
  return {
    network: {
      name: title || name,
      description: `Imported from EPANET (${units}, ${hl}).`,
      nodes, pipes, pumps, valves,
      event: pumps.length ? { kind: 'pumpTrip', targets: pumps.filter((p) => p.on).map((p) => p.id), start: 1 } : valves.length ? { kind: 'valveClose', targets: [valves[0].id], start: 1, duration: 5 } : { kind: 'none', targets: [], start: 0 },
      settings: { ...defaultSettings(), friction },
    },
    notes,
  };
}

/** EPANET export (SI, LPS) — so models built here open in EPANET, WaterGEMS and others. */
export function toInp(net: Network): string {
  const L: string[] = [];
  L.push('[TITLE]', net.name, '', '[JUNCTIONS]', ';ID  Elev  Demand');
  for (const n of net.nodes.filter((x) => x.kind === 'junction')) L.push(`${n.id}  ${n.elev}  ${((n.demand ?? 0) * 1000).toFixed(4)}`);
  L.push('', '[RESERVOIRS]', ';ID  Head');
  for (const n of net.nodes.filter((x) => x.kind === 'reservoir')) L.push(`${n.id}  ${n.head ?? n.elev}`);
  L.push('', '[PIPES]', ';ID  Node1  Node2  Length  Diameter  Roughness  MinorLoss  Status');
  for (const p of net.pipes) L.push(`${p.id}  ${p.from}  ${p.to}  ${p.length}  ${(p.diameter * 1000).toFixed(1)}  ${p.roughness}  ${p.minorLoss ?? 0}  ${p.closed ? 'CLOSED' : 'OPEN'}`);
  L.push('', '[PUMPS]');
  for (const p of net.pumps) L.push(`${p.id}  ${p.from}  ${p.to}  HEAD  C_${p.id}`);
  L.push('', '[VALVES]', ';ID  Node1  Node2  Diameter  Type  Setting  MinorLoss');
  for (const v of net.valves) L.push(`${v.id}  ${v.from}  ${v.to}  ${(v.diameter * 1000).toFixed(1)}  TCV  ${v.k0}  0`);
  L.push('', '[CURVES]');
  for (const p of net.pumps) for (const [q, h] of p.curve) L.push(`C_${p.id}  ${(q * 1000).toFixed(3)}  ${h}`);
  L.push('', '[STATUS]');
  for (const p of net.pumps.filter((x) => !x.on)) L.push(`${p.id}  CLOSED`);
  L.push('', '[OPTIONS]', 'Units  LPS', `Headloss  ${net.settings.friction === 'DW' ? 'D-W' : 'H-W'}`, '', '[COORDINATES]');
  for (const n of net.nodes) L.push(`${n.id}  ${n.x}  ${n.y}`);
  L.push('', '[END]');
  return L.join('\n');
}
