// Turns the user's network into the one both solvers work on:
//  • a pipe with a check valve becomes a check valve (an extra valve link) followed by the pipe;
//  • pumps that start in the transient are off in the steady state.
import { allEvents, type Network } from './types';

export const cvNodeId = (pipeId: string, from: string) => `${from}~${pipeId}`;
export const cvValveId = (pipeId: string) => `${pipeId}-CV`;

export function prepareNetwork(net: Network): Network {
  const cvPipes = net.pipes.filter((p) => p.checkValve && !p.closed);
  const starting = allEvents(net).filter((e) => e.kind === 'pumpTrip' && e.pumpMode === 'start').flatMap((e) => e.targets);
  if (!cvPipes.length && !starting.some((id) => net.pumps.find((p) => p.id === id)?.on)) return net;
  const nodes = net.nodes.slice();
  const valves = net.valves.slice();
  const pipes = net.pipes.map((p) => {
    if (!p.checkValve || p.closed) return p;
    const n = net.nodes.find((x) => x.id === p.from);
    if (!n) return p;
    const nid = cvNodeId(p.id, p.from);
    nodes.push({ id: nid, kind: 'junction', x: n.x, y: n.y, elev: n.elev, demand: 0 });
    const spec = p.checkValve;
    valves.push({ id: cvValveId(p.id), from: p.from, to: nid, diameter: spec.diameter ?? p.diameter, k0: Math.max(spec.kOpen ?? 1, 1e-3), opening: 1, check: true, checkSpec: spec, owner: p.id });
    return { ...p, from: nid, checkValve: undefined };
  });
  const pumps = net.pumps.map((p) => (starting.includes(p.id) && p.on ? { ...p, on: false } : p));
  return { ...net, nodes, pipes, valves, pumps };
}
