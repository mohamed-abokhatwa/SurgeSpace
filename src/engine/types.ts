// SurgeLite network model. SI units throughout the engine: m, s, m³/s, m (head), kg·m², Pa.

export const G = 9.80665;
export const RHO = 998.2; // water at 20 °C, kg/m³
export const HB = 10.33; // barometric head, m (sea level)
export const HV = 0.24; // vapour pressure head at 20 °C, m absolute

export type NodeKind = 'junction' | 'reservoir';

export interface SurgeVessel {
  /** Total vessel volume, m³. */
  volume: number;
  /** Gas volume at the initial (steady) pressure, m³. */
  gasVolume: number;
  /** Polytropic exponent (1.0 isothermal … 1.4 adiabatic); 1.2 is the usual design value. */
  n: number;
  /** Connection pipe diameter, m. */
  connDiameter: number;
  /** Loss coefficients for flow into / out of the vessel (K, on connection velocity). */
  kIn: number;
  kOut: number;
}

export interface AirValve {
  /** Inflow (vacuum) orifice diameter, m. */
  inDiameter: number;
  /** Outflow (release) orifice diameter, m. Smaller outflow = anti-slam behaviour. */
  outDiameter: number;
}

export interface ReliefValve {
  /** Opening pressure head, m. */
  setHead: number;
  /** Flow at full lift for 10 m over the set head, m³/s. */
  capacity: number;
}

export interface NetNode {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  /** Ground / pipe-centreline elevation, m. */
  elev: number;
  /** Base demand, m³/s (junctions). */
  demand?: number;
  /** Fixed water surface elevation, m (reservoirs and tanks). */
  head?: number;
  vessel?: SurgeVessel;
  airValve?: AirValve;
  relief?: ReliefValve;
}

export interface Pipe {
  id: string;
  from: string;
  to: string;
  length: number; // m
  diameter: number; // m (internal)
  /** Darcy–Weisbach absolute roughness ε in mm, or Hazen–Williams C when the network uses H-W. */
  roughness: number;
  wavespeed: number; // m/s
  /** Sum of minor loss coefficients. */
  minorLoss?: number;
  /** Pressure class, m of head (for checks). */
  pressureClass?: number;
  /** Optional intermediate profile points: distance from `from` (m) and elevation (m). */
  profile?: { s: number; z: number }[];
  closed?: boolean;
}

export interface Pump {
  id: string;
  from: string; // suction node
  to: string; // discharge node
  /** Three points of the head curve at rated speed: shutoff, rated, maximum flow (m³/s, m). */
  curve: [number, number][];
  /** Best efficiency (0–1) at the rated point. */
  efficiency: number;
  /** Rated speed, rpm. */
  speed: number;
  /** Pump + motor rotating inertia, kg·m². */
  inertia: number;
  /** Non-return valve on the discharge (prevents reverse flow). */
  checkValve: boolean;
  on: boolean;
  /** Constant-power pump (EPANET POWER), kW. The head curve is then H = P / (ρ g Q). */
  power?: number;
}

export interface Valve {
  id: string;
  from: string;
  to: string;
  diameter: number; // m
  /** Loss coefficient fully open. */
  k0: number;
  /** Initial opening, 0–1 (relative effective area). */
  opening: number;
  /** Acts as a non-return valve (closes on reverse flow). */
  check?: boolean;
  /** How flow area follows the stroke: 'area' (opening = effective area) or 'gate' (standard gate-valve loss table). */
  law?: 'area' | 'gate';
}

export type EventKind = 'pumpTrip' | 'valveClose' | 'valveOpen' | 'none';

export interface TransientEvent {
  kind: EventKind;
  /** Ids of the pumps or the valve involved. */
  targets: string[];
  start: number; // s
  /** Valve stroke duration, s. */
  duration?: number;
  /** Final opening for valve events. */
  finalOpening?: number;
  /** Closure law exponent: 1 = linear area, 2+ = gate-valve-like (most flow cut late). */
  exponent?: number;
  /** Pump events: 'trip' = power failure, speed falls by inertia; 'ramp' = controlled stop (VFD), speed
   *  forced linearly to zero over `duration`. */
  pumpMode?: 'trip' | 'ramp';
}

export interface Settings {
  friction: 'DW' | 'HW';
  /** Simulation length, s. */
  duration: number;
  /** Maximum allowed wave-speed adjustment (fraction). SurgeLite default 0.005 (0.5 %). */
  maxAdjust: number;
  /** Upper limit on computational reaches (performance). */
  maxReaches: number;
  /** Pipes whose wave travel time is below this (s) are modelled as rigid water columns. 0 = auto. */
  rigidTravel: number;
  /** Unsteady friction (Brunone–Vítkovský with Vardy's coefficient). */
  unsteadyFriction: boolean;
  /** Free gas void fraction for the discrete gas cavity model (at atmospheric pressure). */
  gasFraction: number;
  /** Demands follow pressure (orifice law) during the transient. */
  pressureDependentDemand: boolean;
  /** Minimum allowed pressure head, m (checks). */
  minPressure: number;
}

export interface Network {
  name: string;
  description?: string;
  nodes: NetNode[];
  pipes: Pipe[];
  pumps: Pump[];
  valves: Valve[];
  event: TransientEvent;
  settings: Settings;
}

export const defaultSettings = (): Settings => ({
  friction: 'DW',
  duration: 60,
  maxAdjust: 0.005,
  maxReaches: 60000,
  rigidTravel: 0,
  unsteadyFriction: true,
  gasFraction: 1e-7,
  pressureDependentDemand: true,
  minPressure: -5,
});

export const area = (d: number) => (Math.PI / 4) * d * d;
