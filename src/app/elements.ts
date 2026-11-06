// Element registry: every kind of element the drawing palette can place, with its name, group, description and
// how it is stored. Devices are stored on a junction (one junction may carry several), so the engine is unchanged.
import type { NetNode, Network } from '../engine/types';

export type ElementKind =
  | 'junction' | 'reservoir' | 'levelSource'
  | 'pipe' | 'pump' | 'lineValve' | 'nrv' | 'prv' | 'psv' | 'fcv' | 'orifice'
  | 'airVessel' | 'airValve' | 'standpipe' | 'feedTank' | 'anticipator' | 'relief' | 'blowoff' | 'burstDisc';

export type Placement = 'node' | 'link' | 'device';

export interface ElementInfo {
  kind: ElementKind;
  name: string;
  short: string;
  group: 'Network' | 'Links' | 'Protection';
  placement: Placement;
  description: string;
  /** Keyboard shortcut in the drawing tools. */
  key?: string;
}

export const ELEMENTS: ElementInfo[] = [
  { kind: 'junction', name: 'Junction', short: 'Junction', group: 'Network', placement: 'node', key: 'J', description: 'A connection point with an elevation and an optional demand.' },
  { kind: 'reservoir', name: 'Fixed-Level Source', short: 'Source', group: 'Network', placement: 'node', key: 'R', description: 'Reservoir, sump or large tank whose water level does not change during the run.' },
  { kind: 'levelSource', name: 'Varying-Level Source', short: 'Var. source', group: 'Network', placement: 'node', description: 'A source whose level follows a sine wave or a time table (tide, wave action, upstream station).' },
  { kind: 'pipe', name: 'Pipe', short: 'Pipe', group: 'Links', placement: 'link', key: 'P', description: 'Click the start node (or empty space), click to add bends, finish on the end node. Double-click or Esc to stop.' },
  { kind: 'pump', name: 'Pump', short: 'Pump', group: 'Links', placement: 'link', key: 'U', description: 'Click on a pipe to insert a pump, or click the suction node then the discharge node.' },
  { kind: 'lineValve', name: 'Line Valve', short: 'Valve', group: 'Links', placement: 'link', key: 'V', description: 'Isolating or throttling valve (gate, butterfly, ball, globe, needle or your own curve) that can be operated in the run.' },
  { kind: 'nrv', name: 'Non-Return Valve', short: 'NRV', group: 'Links', placement: 'link', key: 'N', description: 'Check valve on a pipe: ideal, delayed, reverse-velocity or dynamic closure, with slam detection.' },
  { kind: 'prv', name: 'Pressure Reducer', short: 'PRV', group: 'Links', placement: 'link', description: 'Holds the downstream pressure at its set point.' },
  { kind: 'psv', name: 'Pressure Sustainer', short: 'PSV', group: 'Links', placement: 'link', description: 'Holds the upstream pressure at its set point.' },
  { kind: 'fcv', name: 'Flow Limiter', short: 'FCV', group: 'Links', placement: 'link', description: 'Holds the flow at its set value.' },
  { kind: 'orifice', name: 'Inline Orifice', short: 'Orifice', group: 'Links', placement: 'link', description: 'A fixed restriction (orifice plate, reducer, partly closed valve) with a loss coefficient.' },
  { kind: 'airVessel', name: 'Air Vessel', short: 'Vessel', group: 'Protection', placement: 'device', key: 'A', description: 'Closed tank with a gas cushion (vertical, horizontal or sphere; with or without a bladder).' },
  { kind: 'airValve', name: 'Air Valve', short: 'Air valve', group: 'Protection', placement: 'device', key: 'K', description: 'Lets air in on low pressure and out when water returns: double-acting, anti-slam, vacuum breaker, release only or catalogue curves.' },
  { kind: 'standpipe', name: 'Open Standpipe', short: 'Standpipe', group: 'Protection', placement: 'device', description: 'Open surge tower that feeds the pipe on down-surges and overflows on up-surges.' },
  { kind: 'feedTank', name: 'Feed Tank', short: 'Feed tank', group: 'Protection', placement: 'device', description: 'One-way tank: a non-return valve lets water into the pipe only when the pressure drops below the tank level.' },
  { kind: 'anticipator', name: 'Anticipator Valve', short: 'Anticipator', group: 'Protection', placement: 'device', description: 'Opens on the first pressure drop (before the return wave), holds, then closes slowly to atmosphere.' },
  { kind: 'relief', name: 'Relief Valve', short: 'Relief', group: 'Protection', placement: 'device', description: 'Spring-loaded valve that discharges when the pressure exceeds its set point.' },
  { kind: 'blowoff', name: 'Timed Blow-off', short: 'Blow-off', group: 'Protection', placement: 'device', description: 'Orifice or hydrant that opens to atmosphere at a set time (flushing, hydrant opening, pipe burst).' },
  { kind: 'burstDisc', name: 'Burst Disc', short: 'Burst disc', group: 'Protection', placement: 'device', description: 'Membrane that ruptures at a set pressure and then discharges to atmosphere.' },
];
export const EL = Object.fromEntries(ELEMENTS.map((e) => [e.kind, e])) as Record<ElementKind, ElementInfo>;

/** Default device data applied when a device is placed (sized loosely from the pipe diameter at the node). */
export function deviceDefaults(kind: ElementKind, node: NetNode, pipeD = 0.3): Partial<NetNode> {
  const D = Math.max(pipeD, 0.05);
  const round = (x: number, s: number) => Math.max(s, Math.round(x / s) * s);
  switch (kind) {
    case 'airVessel': return { vessel: { volume: round(D * 40, 1), gasVolume: round(D * 20, 0.5), n: 1.2, connDiameter: round(D * 0.6, 0.05), kIn: 2.5, kOut: 0.5 } };
    case 'airValve': return { airValve: { type: 'double', inDiameter: round(D / 4, 0.025), outDiameter: round(D / 16, 0.005), cdIn: 0.6, cdOut: 0.6 } };
    case 'standpipe': return { tank: { diameter: round(D * 6, 0.5), bottomElev: node.elev, topElev: node.elev + 30, connDiameter: D, kIn: 1, kOut: 0.5 } };
    case 'feedTank': return { tank: { diameter: round(D * 8, 0.5), bottomElev: node.elev + 5, topElev: node.elev + 10, connDiameter: D, kIn: 1, kOut: 0.5, oneWay: true, initialLevel: node.elev + 9 } };
    case 'anticipator': return { sav: { diameter: round(D / 2, 0.025), lowSet: 10, openTime: 1, holdTime: 10, closeTime: 30, cd: 0.6 } };
    case 'relief': return { relief: { setHead: 100, capacity: 0.05, diameter: round(D / 3, 0.025), cd: 0.7 } };
    case 'blowoff': return { outlet: { diameter: round(D / 3, 0.025), cd: 0.6, trigger: 'time', time: 1, openTime: 2 } };
    case 'burstDisc': return { outlet: { diameter: round(D / 2, 0.025), cd: 0.6, trigger: 'pressure', burstHead: 150 } };
    default: return {};
  }
}

/** Devices carried by a node, as element kinds (for the explorer, icons and labels). */
export function nodeDevices(n: NetNode): ElementKind[] {
  const out: ElementKind[] = [];
  if (n.vessel) out.push('airVessel');
  if (n.airValve) out.push('airValve');
  if (n.tank) out.push(n.tank.oneWay ? 'feedTank' : 'standpipe');
  if (n.sav) out.push('anticipator');
  if (n.relief) out.push('relief');
  if (n.outlet) out.push(n.outlet.trigger === 'pressure' ? 'burstDisc' : 'blowoff');
  return out;
}
/** Main kind of a node (what the explorer lists it under). */
export function nodeKind(n: NetNode): ElementKind {
  if (n.kind === 'reservoir') return n.headSchedule ? 'levelSource' : 'reservoir';
  return nodeDevices(n)[0] ?? 'junction';
}
/** Remove a device kind from a node. */
export function removeDevice(n: NetNode, kind: ElementKind): NetNode {
  const x = { ...n };
  if (kind === 'airVessel') delete x.vessel;
  if (kind === 'airValve') delete x.airValve;
  if (kind === 'standpipe' || kind === 'feedTank') delete x.tank;
  if (kind === 'anticipator') delete x.sav;
  if (kind === 'relief') delete x.relief;
  if (kind === 'blowoff' || kind === 'burstDisc') delete x.outlet;
  return x;
}

/** Kind of a valve link. */
export function valveKind(v: Network['valves'][number]): ElementKind {
  if (v.control) return v.control.type === 'PRV' ? 'prv' : v.control.type === 'PSV' ? 'psv' : 'fcv';
  if (v.check) return 'nrv';
  if (v.orifice) return 'orifice';
  return 'lineValve';
}

/** Element groups listed in the Model Explorer. */
export interface ExplorerGroup { key: string; kind: ElementKind; label: string; items: { type: 'node' | 'pipe' | 'pump' | 'valve'; id: string; sub?: string }[] }
export function explorerGroups(net: Network): ExplorerGroup[] {
  const g = (kind: ElementKind, label: string, items: ExplorerGroup['items']): ExplorerGroup => ({ key: kind, kind, label, items });
  const nodesOf = (f: (n: NetNode) => boolean) => net.nodes.filter(f).map((n) => ({ type: 'node' as const, id: n.id }));
  const vk = (k: ElementKind) => net.valves.filter((v) => valveKind(v) === k).map((v) => ({ type: 'valve' as const, id: v.id }));
  return [
    g('reservoir', 'Fixed-level sources', nodesOf((n) => n.kind === 'reservoir' && !n.headSchedule)),
    g('levelSource', 'Varying-level sources', nodesOf((n) => n.kind === 'reservoir' && !!n.headSchedule)),
    g('junction', 'Junctions', nodesOf((n) => n.kind === 'junction')),
    g('pipe', 'Pipes', net.pipes.map((p) => ({ type: 'pipe' as const, id: p.id, sub: p.checkValve ? 'NRV' : undefined }))),
    g('pump', 'Pumps', net.pumps.map((p) => ({ type: 'pump' as const, id: p.id }))),
    g('lineValve', 'Line valves', vk('lineValve')),
    g('nrv', 'Non-return valves', [...vk('nrv'), ...net.pipes.filter((p) => p.checkValve).map((p) => ({ type: 'pipe' as const, id: p.id, sub: 'on pipe' }))]),
    g('prv', 'Pressure reducers', vk('prv')),
    g('psv', 'Pressure sustainers', vk('psv')),
    g('fcv', 'Flow limiters', vk('fcv')),
    g('orifice', 'Inline orifices', vk('orifice')),
    g('airVessel', 'Air vessels', nodesOf((n) => !!n.vessel)),
    g('airValve', 'Air valves', nodesOf((n) => !!n.airValve)),
    g('standpipe', 'Open standpipes', nodesOf((n) => !!n.tank && !n.tank.oneWay)),
    g('feedTank', 'Feed tanks', nodesOf((n) => !!n.tank?.oneWay)),
    g('anticipator', 'Anticipator valves', nodesOf((n) => !!n.sav)),
    g('relief', 'Relief valves', nodesOf((n) => !!n.relief)),
    g('blowoff', 'Timed blow-offs', nodesOf((n) => n.outlet?.trigger === 'time')),
    g('burstDisc', 'Burst discs', nodesOf((n) => n.outlet?.trigger === 'pressure')),
  ];
}
