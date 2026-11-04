// SurgeSpace network model. SI units throughout the engine: m, s, m³/s, m (head), kg·m², Pa.

export const G = 9.80665;
export const RHO = 998.2; // water at 20 °C, kg/m³
export const HB = 10.33; // barometric head, m (sea level)
export const HV = 0.24; // vapour pressure head at 20 °C, m absolute

export type NodeKind = 'junction' | 'reservoir';

export type VesselShape = 'vertical' | 'horizontal' | 'sphere';

/** Hydropneumatic tank (surge vessel): a closed tank with a gas cushion. */
export interface SurgeVessel {
  /** Total vessel volume, m³. */
  volume: number;
  /** Gas volume at the initial (steady) pressure, m³ (used when gasInput is 'volume'). */
  gasVolume: number;
  /** Polytropic exponent (1.0 isothermal … 1.4 adiabatic); 1.2 is the usual design value. */
  n: number;
  /** Connection pipe diameter, m. */
  connDiameter: number;
  /** Loss coefficients for flow into / out of the vessel (K, on connection velocity). */
  kIn: number;
  kOut: number;
  /** Tank shape (default vertical cylinder). */
  shape?: VesselShape;
  /** Internal diameter, m. Default: vertical height = 2 D; horizontal length = 3 D; sphere from the volume. */
  diameter?: number;
  /** Elevation of the tank bottom, m (default: the node elevation). */
  bottomElev?: number;
  /** How the gas is given: initial gas volume, or the pre-charge pressure of a bladder / diaphragm tank. */
  gasInput?: 'volume' | 'precharge';
  /** Pre-charge pressure head (gauge, m) of the empty tank (gasInput 'precharge'). */
  prechargeHead?: number;
  /** Bladder or diaphragm separates gas and water (no air can reach the pipe when the tank empties). */
  bladder?: boolean;
  /** Dip tube: water below this height above the tank bottom (m) cannot leave the tank. */
  dipTubeHeight?: number;
  /** Connection pipe length, m (the water in it has inertia). Default 0. */
  connLength?: number;
  /** Inflow path: through the connection ('orifice', K in), or a non-return valve with a smaller bypass ('checkBypass'). */
  inlet?: 'orifice' | 'checkBypass';
  /** Bypass diameter, m (inlet 'checkBypass'): water returns to the tank only through it. */
  bypassDiameter?: number;
  /** Bypass loss coefficient (on bypass velocity). Default 1. */
  bypassK?: number;
}

export type AirValveType = 'double' | 'threeStage' | 'vacuumBreaker' | 'releaseOnly' | 'curve';

/** Air valve (air release / vacuum valve) at a high point. */
export interface AirValve {
  /** Large inflow (vacuum) orifice diameter, m. */
  inDiameter: number;
  /** Large outflow orifice diameter, m. */
  outDiameter: number;
  /** Valve type (default 'double'):
   *  double: air in through the inflow orifice, out through the outflow orifice (plus the small orifice, if given);
   *  threeStage: anti-slam; air leaves through the large outflow orifice until the overpressure reaches switchHead,
   *    then only through the small orifice;
   *  vacuumBreaker: air in only (no release; the trapped air cushions the returning water);
   *  releaseOnly: air out only, through the small orifice (no air in);
   *  curve: manufacturer flow curves for inflow and outflow. */
  type?: AirValveType;
  /** Small (pressurised air release) orifice diameter, m. */
  smallDiameter?: number;
  /** Discharge coefficients (default 0.6). */
  cdIn?: number;
  cdOut?: number;
  /** Three-stage: overpressure head (m) at which outflow switches to the small orifice (default 0.3 m ≈ 3 kPa). */
  switchHead?: number;
  /** Manufacturer curves: [pressure difference kPa, free air flow Nm³/h], inflow and outflow. */
  inCurve?: [number, number][];
  outCurve?: [number, number][];
  /** Treat as junction (as in HAMMER): the valve is kept in the model but ignored in the run, so results with and
   *  without it can be compared without deleting its settings. */
  treatAsJunction?: boolean;
}

/** Pressure relief valve: opens above the set pressure and discharges to atmosphere. */
export interface ReliefValve {
  /** Opening pressure head, m. */
  setHead: number;
  /** Flow at full lift for 10 m over the set head, m³/s (used when no diameter is given). */
  capacity: number;
  /** Valve diameter, m (with diameter, flow = Cd·A·lift·√(2g·p)). */
  diameter?: number;
  /** Discharge coefficient (default 0.7). */
  cd?: number;
  /** Overpressure above the set head (m) at which the valve is fully open (default 10 % of the set head). */
  accumulation?: number;
}

/** Open surge tank (standpipe) or one-way (feed) tank, open to the atmosphere. */
export interface OpenTank {
  /** Tank internal diameter, m. */
  diameter: number;
  /** Tank bottom elevation, m. */
  bottomElev: number;
  /** Overflow (top) elevation, m. Water above it spills. */
  topElev: number;
  /** Connection pipe diameter, m. */
  connDiameter: number;
  /** Loss coefficients into / out of the tank (on connection velocity). */
  kIn: number;
  kOut: number;
  /** One-way (feed) tank: a non-return valve lets water flow only from the tank into the pipe. */
  oneWay?: boolean;
  /** Initial water surface elevation, m. Open tanks start at the steady head; one-way tanks need it (default: 90 % full). */
  initialLevel?: number;
}

/** Surge anticipation valve: opens when the pressure falls below the low set point (or rises above the high one),
 *  stays open, then closes slowly, discharging to atmosphere. */
export interface SurgeAnticipationValve {
  /** Valve diameter, m. */
  diameter: number;
  /** Discharge coefficient at full opening (default 0.6). */
  cd?: number;
  /** Pressure head (m) below which the valve starts to open (pump-trip down-surge). */
  lowSet: number;
  /** Pressure head (m) above which the valve also opens (optional). */
  highSet?: number;
  /** Opening time, s. */
  openTime: number;
  /** Time held fully open, s. */
  holdTime: number;
  /** Closing time, s. */
  closeTime: number;
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
  tank?: OpenTank;
  sav?: SurgeAnticipationValve;
  outlet?: Outlet;
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
  /** Check valve at the start of the pipe (flow only from `from` to `to`). */
  checkValve?: CheckValveSpec;
}

/** How a check (non-return) valve closes. 'ideal' shuts the instant flow reverses, so it never slams.
 *  The others let reverse flow build up first, which is what causes check-valve slam:
 *  'delay' starts closing a set time after the flow reverses; 'velocity' starts closing when the reverse
 *  velocity reaches a set value; 'dynamic' takes that reverse velocity from the manufacturer's dynamic
 *  characteristic (reverse velocity at closure vs. deceleration of the flow). */
export interface CheckValveSpec {
  mode: 'ideal' | 'delay' | 'velocity' | 'dynamic';
  /** 'delay' mode: time from flow reversal to the start of closure, s. */
  delay?: number;
  /** Time the disc takes to close once it starts, s (0 = instant). */
  closeTime?: number;
  /** 'velocity' mode: reverse velocity at which the disc closes, m/s. */
  reverseVelocity?: number;
  /** 'dynamic' mode: [deceleration m/s², reverse velocity at closure m/s] from the manufacturer. */
  dynamic?: [number, number][];
  /** Head difference needed to open it again, m. */
  openHead?: number;
  /** Valve bore, m (defaults to the pipe, valve or pump discharge pipe diameter). */
  diameter?: number;
  /** Loss coefficient fully open (a pipe check valve adds this loss; for pumps and valves it shapes the closure). */
  kOpen?: number;
}

export type ValveLaw = 'area' | 'gate' | 'globe' | 'ball' | 'butterfly' | 'needle' | 'curve';

/** Control valve that holds a set point (pressure reducing, pressure sustaining, flow control). */
export interface ControlValve {
  type: 'PRV' | 'PSV' | 'FCV';
  /** PRV: downstream pressure head, m. PSV: upstream pressure head, m. FCV: flow, m³/s. */
  set: number;
  /** During the transient: true = keeps acting with the response below; false = locked at its steady opening. */
  active?: boolean;
  /** Time constant of the valve's response, s. */
  responseTime?: number;
  /** Fastest full stroke (closed to open), s. */
  strokeTime?: number;
}

/** Discharge to atmosphere at a node: an orifice or blow-off that opens at a set time, or a rupture disk
 *  that bursts at a set pressure (closed in steady state). */
export interface Outlet {
  diameter: number;
  cd?: number;
  trigger: 'time' | 'pressure';
  /** 'time': when it starts to open, s. */
  time?: number;
  /** Opening time, s (0 = instant). */
  openTime?: number;
  /** 'pressure': bursting pressure head, m. */
  burstHead?: number;
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
  /** How the pump's check valve closes (default ideal). */
  checkSpec?: CheckValveSpec;
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
  /** How a check valve closes (default ideal). */
  checkSpec?: CheckValveSpec;
  /** How flow area follows the stroke: 'area' (opening = effective area), a typical curve for the valve type,
   *  or 'curve' (the manufacturer's curve in `lawCurve`). */
  law?: ValveLaw;
  /** Manufacturer's characteristic: [stroke 0–1, relative flow area or Cv/Cv(open) 0–1]. */
  lawCurve?: [number, number][];
  /** Control valve (PRV / PSV / FCV). Its opening is found in the steady state. */
  control?: ControlValve;
  /** Set internally for the valve that models a pipe's check valve. */
  owner?: string;
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
  /** Valve events: operating curve [time from start s, stroke 0–1] (overrides duration / final opening). */
  curve?: [number, number][];
  /** Pump events: 'trip' = power failure, speed falls by inertia; 'ramp' = controlled stop (VFD), speed
   *  forced linearly to zero over `duration`; 'start' = pump start, off in steady state and speed raised
   *  linearly to full over `duration`. */
  pumpMode?: 'trip' | 'ramp' | 'start';
}

export interface Settings {
  friction: 'DW' | 'HW';
  /** Simulation length, s. */
  duration: number;
  /** Maximum allowed wave-speed adjustment (fraction). SurgeSpace default 0.005 (0.5 %). */
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

/** Details printed on the report's title page. */
export interface ReportInfo {
  projectNo?: string;
  client?: string;
  preparedBy?: string;
  checkedBy?: string;
  revision?: string;
  notes?: string;
}

export interface Network {
  name: string;
  description?: string;
  report?: ReportInfo;
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
