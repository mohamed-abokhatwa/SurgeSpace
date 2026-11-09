// Ready-made projects: examples users can open, and the engine's validation cases.
import { estimateInertia } from './hydraulics';
import { defaultSettings, type Network } from './types';

const inertiaFor = (q: number, h: number, eff: number, rpm: number) => estimateInertia((998.2 * 9.80665 * q * h) / eff / 1000, rpm);

/** Pump trip on a 5 km rising main over a high point, with an air valve and a surge vessel. */
export function risingMain(withVessel = true): Network {
  return {
    name: 'Rising main · pump trip',
    description: 'Two duty pumps lift 500 L/s through a 5 km DN600 ductile iron main over a high point. All pumps trip on power failure.',
    nodes: [
      { id: 'SUMP', kind: 'reservoir', x: 0, y: 220, elev: 95, head: 100 },
      { id: 'PS-S', kind: 'junction', x: 60, y: 220, elev: 95 },
      { id: 'PS-D', kind: 'junction', x: 140, y: 220, elev: 96, ...(withVessel ? { vessel: { volume: 30, gasVolume: 15, n: 1.2, connDiameter: 0.4, kIn: 2.5, kOut: 0.5 } } : {}) },
      { id: 'CH1200', kind: 'junction', x: 340, y: 150, elev: 121 },
      { id: 'HP2600', kind: 'junction', x: 560, y: 60, elev: 146, airValve: { inDiameter: 0.1, outDiameter: 0.025 } },
      { id: 'CH3800', kind: 'junction', x: 760, y: 110, elev: 138 },
      { id: 'TANK', kind: 'reservoir', x: 960, y: 80, elev: 147, head: 150 },
    ],
    pipes: [
      { id: 'SUC', from: 'SUMP', to: 'PS-S', length: 15, diameter: 0.7, roughness: 0.1, wavespeed: 1100, pressureClass: 160 },
      { id: 'M1', from: 'PS-D', to: 'CH1200', length: 1200, diameter: 0.6, roughness: 0.1, wavespeed: 1100, pressureClass: 160, profile: [{ s: 500, z: 104 }, { s: 900, z: 116 }] },
      { id: 'M2', from: 'CH1200', to: 'HP2600', length: 1400, diameter: 0.6, roughness: 0.1, wavespeed: 1100, pressureClass: 160, profile: [{ s: 700, z: 136 }] },
      { id: 'M3', from: 'HP2600', to: 'CH3800', length: 1200, diameter: 0.6, roughness: 0.1, wavespeed: 1100, pressureClass: 160, profile: [{ s: 600, z: 140 }] },
      { id: 'M4', from: 'CH3800', to: 'TANK', length: 1200, diameter: 0.6, roughness: 0.1, wavespeed: 1100, pressureClass: 160, profile: [{ s: 600, z: 143 }] },
    ],
    pumps: ['PU1', 'PU2'].map((id) => ({
      id, from: 'PS-S', to: 'PS-D', curve: [[0, 98], [0.25, 74], [0.375, 52]] as [number, number][], efficiency: 0.84, speed: 1480,
      inertia: Math.round(inertiaFor(0.25, 74, 0.84, 1480) * 10) / 10, checkValve: true, on: true,
    })),
    valves: [],
    event: { kind: 'pumpTrip', targets: ['PU1', 'PU2'], start: 1 },
    settings: { ...defaultSettings(), duration: 60 },
  };
}

/** Gravity main: reservoir, 1.2 km DN500 steel, downstream valve closing in 6 s. */
export function gravityValve(): Network {
  return {
    name: 'Gravity main · valve closure',
    description: 'A 1.2 km DN600 steel gravity main feeds a downstream reservoir. The line valve closes linearly in 15 s.',
    nodes: [
      { id: 'RES', kind: 'reservoir', x: 0, y: 80, elev: 120, head: 125 },
      { id: 'A', kind: 'junction', x: 400, y: 140, elev: 95 },
      { id: 'V-U', kind: 'junction', x: 760, y: 200, elev: 70 },
      { id: 'V-D', kind: 'junction', x: 800, y: 200, elev: 70 },
      { id: 'OUT', kind: 'reservoir', x: 960, y: 210, elev: 104, head: 108 },
    ],
    pipes: [
      { id: 'G1', from: 'RES', to: 'A', length: 500, diameter: 0.6, roughness: 0.05, wavespeed: 1150, pressureClass: 100 },
      { id: 'G2', from: 'A', to: 'V-U', length: 700, diameter: 0.6, roughness: 0.05, wavespeed: 1150, pressureClass: 100 },
      { id: 'G3', from: 'V-D', to: 'OUT', length: 40, diameter: 0.6, roughness: 0.05, wavespeed: 1150, pressureClass: 100 },
    ],
    pumps: [],
    valves: [{ id: 'LV', from: 'V-U', to: 'V-D', diameter: 0.6, k0: 0.3, opening: 1 }],
    event: { kind: 'valveClose', targets: ['LV'], start: 1, duration: 15, exponent: 1 },
    settings: { ...defaultSettings(), duration: 30 },
  };
}

/** A small looped distribution network fed by a pump station, with a tank. */
export function loopedNetwork(): Network {
  const j = (id: string, x: number, y: number, elev: number, demand: number) => ({ id, kind: 'junction' as const, x, y, elev, demand: demand / 1000 });
  const p = (id: string, from: string, to: string, length: number, dmm: number) => ({ id, from, to, length, diameter: dmm / 1000, roughness: 0.05, wavespeed: 420, pressureClass: 100 });
  return {
    name: 'Looped network · pump trip',
    description: 'A 12-node looped PVC network (wave speed 420 m/s) fed by a two-pump station, with an elevated tank. The station trips.',
    nodes: [
      { id: 'WELL', kind: 'reservoir', x: 0, y: 300, elev: 40, head: 42 },
      { id: 'PS-S', kind: 'junction', x: 50, y: 300, elev: 40 },
      { id: 'PS-D', kind: 'junction', x: 110, y: 300, elev: 41 },
      j('J1', 220, 300, 46, 8), j('J2', 420, 300, 50, 12), j('J3', 620, 300, 52, 10), j('J4', 820, 300, 55, 6),
      j('J5', 220, 160, 48, 10), j('J6', 420, 160, 54, 14), j('J7', 620, 160, 57, 12), j('J8', 820, 160, 60, 8),
      j('J9', 420, 30, 58, 9), j('J10', 620, 30, 61, 7),
      { id: 'TANK', kind: 'reservoir', x: 960, y: 30, elev: 88, head: 92 },
    ],
    pipes: [
      p('SUC', 'WELL', 'PS-S', 10, 400), p('MAIN', 'PS-D', 'J1', 300, 400),
      p('L1', 'J1', 'J2', 600, 300), p('L2', 'J2', 'J3', 600, 250), p('L3', 'J3', 'J4', 600, 200),
      p('L4', 'J1', 'J5', 450, 250), p('L5', 'J2', 'J6', 450, 200), p('L6', 'J3', 'J7', 450, 200), p('L7', 'J4', 'J8', 450, 150),
      p('L8', 'J5', 'J6', 600, 200), p('L9', 'J6', 'J7', 600, 200), p('L10', 'J7', 'J8', 600, 150),
      p('L11', 'J6', 'J9', 400, 150), p('L12', 'J7', 'J10', 400, 150), p('L13', 'J9', 'J10', 600, 150),
      p('TK', 'J10', 'TANK', 500, 250),
    ],
    pumps: ['P1', 'P2'].map((id) => ({
      id, from: 'PS-S', to: 'PS-D', curve: [[0, 75], [0.07, 60], [0.11, 40]] as [number, number][], efficiency: 0.78, speed: 2950,
      inertia: Math.round(inertiaFor(0.07, 60, 0.78, 2950) * 100) / 100, checkValve: true, on: true,
    })),
    valves: [],
    event: { kind: 'pumpTrip', targets: ['P1', 'P2'], start: 1 },
    settings: { ...defaultSettings(), duration: 40 },
  };
}

/**
 * Published surge study (El-Hazek, Ahmed & Badawy, J. Water and Land Development 47, 2020):
 * 5 duty pumps, 6 m³/s, 1800 mm steel header 30 m, two 1200 mm GRE mains 1,600 m to 111.41 m.
 * Not published (assumed here): pump curve, inertia, GRE wave speed, roughness.
 */
export function elHazek(): Network {
  return {
    name: 'Published case · El-Hazek et al. 2020',
    description: 'Pump power failure, 6 m³/s through two 1,600 m DN1200 GRE mains. The published study reported max head 185.97 m and min 78.43 m unprotected. Pump curve, inertia and wave speed are assumed (not published).',
    nodes: [
      { id: 'SUCTION', kind: 'reservoir', x: 0, y: 260, elev: 79.81, head: 79.81 + 3 },
      { id: 'PS-S', kind: 'junction', x: 60, y: 260, elev: 80 },
      { id: 'PS-D', kind: 'junction', x: 120, y: 260, elev: 85 },
      { id: 'BR', kind: 'junction', x: 200, y: 240, elev: 88.65 },
      { id: 'A1', kind: 'junction', x: 560, y: 120, elev: 100 },
      { id: 'A2', kind: 'junction', x: 560, y: 300, elev: 100 },
      { id: 'OUT1', kind: 'reservoir', x: 960, y: 60, elev: 111.41, head: 111.41 + 1 },
      { id: 'OUT2', kind: 'reservoir', x: 960, y: 260, elev: 111.41, head: 111.41 + 1 },
    ],
    pipes: [
      { id: 'SUC', from: 'SUCTION', to: 'PS-S', length: 10, diameter: 1.8, roughness: 0.1, wavespeed: 1200, pressureClass: 100 },
      { id: 'HEADER', from: 'PS-D', to: 'BR', length: 30, diameter: 1.8, roughness: 0.1, wavespeed: 1100, pressureClass: 100 },
      { id: 'GRE1a', from: 'BR', to: 'A1', length: 800, diameter: 1.2, roughness: 0.01, wavespeed: 450, pressureClass: 61.2 },
      { id: 'GRE1b', from: 'A1', to: 'OUT1', length: 800, diameter: 1.2, roughness: 0.01, wavespeed: 450, pressureClass: 61.2 },
      { id: 'GRE2a', from: 'BR', to: 'A2', length: 800, diameter: 1.2, roughness: 0.01, wavespeed: 450, pressureClass: 61.2 },
      { id: 'GRE2b', from: 'A2', to: 'OUT2', length: 800, diameter: 1.2, roughness: 0.01, wavespeed: 450, pressureClass: 61.2 },
    ],
    pumps: ['P1', 'P2', 'P3', 'P4', 'P5'].map((id) => ({
      id, from: 'PS-S', to: 'PS-D', curve: [[0, 49], [1.2, 37], [1.8, 25]] as [number, number][], efficiency: 0.86, speed: 990,
      inertia: Math.round(inertiaFor(1.2, 37, 0.86, 990)), checkValve: true, on: true,
    })),
    valves: [],
    event: { kind: 'pumpTrip', targets: ['P1', 'P2', 'P3', 'P4', 'P5'], start: 1 },
    settings: { ...defaultSettings(), duration: 60 },
  };
}

/** Examples are drawn in screen coordinates; networks use engineering coordinates (y up). */
import bwsn1 from './bwsn1.json';

/** Hydropower scheme: headrace tunnel, open surge shaft, steel penstock and a turbine that rejects its full load. */
export function hydroPlant(): Network {
  const D = 1.6, Qr = 6, Hr = 160;
  const A = (Math.PI / 4) * 1.2 * 1.2, V = Qr / A;
  return {
    name: 'Hydropower plant · load rejection',
    description: 'A 3 km headrace tunnel, an open surge shaft and a 1.2 km steel penstock feed a 8.4 MW turbine. The generator trips and the governor closes the wicket gates in 10 s.',
    nodes: [
      { id: 'LAKE', kind: 'reservoir', x: 0, y: 60, elev: 395, head: 400 },
      { id: 'SHAFT', kind: 'junction', x: 600, y: 60, elev: 385, tank: { diameter: 8, bottomElev: 375, topElev: 420, connDiameter: 1.6, kIn: 0.5, kOut: 0.5 } },
      { id: 'BEND', kind: 'junction', x: 750, y: 180, elev: 330 },
      { id: 'INLET', kind: 'junction', x: 900, y: 300, elev: 232 },
      { id: 'OUTLET', kind: 'junction', x: 960, y: 300, elev: 231 },
      { id: 'TAIL', kind: 'reservoir', x: 1080, y: 300, elev: 228, head: 232 },
    ],
    pipes: [
      { id: 'TUNNEL', from: 'LAKE', to: 'SHAFT', length: 3000, diameter: D, roughness: 0.5, wavespeed: 1100, pressureClass: 60, material: 'Reinforced concrete' },
      { id: 'PEN1', from: 'SHAFT', to: 'BEND', length: 500, diameter: 1.2, roughness: 0.045, wavespeed: 1150, pressureClass: 160, material: 'Carbon steel (lined)' },
      { id: 'PEN2', from: 'BEND', to: 'INLET', length: 700, diameter: 1.2, roughness: 0.045, wavespeed: 1150, pressureClass: 260, material: 'Carbon steel (lined)' },
      { id: 'DRAFT', from: 'OUTLET', to: 'TAIL', length: 40, diameter: 1.6, roughness: 0.3, wavespeed: 1000, pressureClass: 30 },
    ],
    pumps: [],
    valves: [{ id: 'TU-1', from: 'INLET', to: 'OUTLET', diameter: 1.2, k0: Math.round(((2 * 9.80665 * Hr) / (V * V)) * 100) / 100, opening: 1, law: 'area', turbine: { ratedHead: Hr, ratedFlow: Qr, efficiency: 0.9, speed: 600, inertia: 60000 } }],
    event: { kind: 'valveClose', turbineOp: 'rejection', targets: ['TU-1'], start: 1, duration: 10, finalOpening: 0, exponent: 1 },
    settings: { ...defaultSettings(), duration: 120 },
  };
}

const yUp = (n: Network): Network => ({ ...n, nodes: n.nodes.map((x) => ({ ...x, y: -x.y })) });

export const EXAMPLES: { id: string; make: () => Network }[] = [
  { id: 'rising', make: () => yUp(risingMain(true)) },
  { id: 'rising-bare', make: () => yUp({ ...risingMain(false), name: 'Rising main · no protection' }) },
  { id: 'gravity', make: () => yUp(gravityValve()) },
  { id: 'loop', make: () => yUp(loopedNetwork()) },
  { id: 'elhazek', make: () => yUp(elHazek()) },
  { id: 'hydro', make: () => yUp(hydroPlant()) },
  // real network with a published benchmark result (see validation/README.md)
  { id: 'bwsn1', make: () => structuredClone(bwsn1 as unknown as Network) },
];
