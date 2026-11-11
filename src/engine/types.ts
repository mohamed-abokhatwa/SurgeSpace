// SurgeSpace network model. SI units throughout the engine: m, s, m³/s, m (head), kg·m², Pa.

export const G = 9.80665;
// Fluid and site constants. They are live bindings: applyFluid() sets them from the model's settings at the start of
// every steady and transient solve (defaults = water at 20 °C at sea level, as before).
export let RHO = 998.2; // density, kg/m³
export let HB = 10.33; // barometric head, m
export let HV = 0.24; // vapour pressure head, m absolute
export let NU = 1.004e-6; // kinematic viscosity, m²/s

/** Barometric head (m of the liquid) at a site elevation (m), standard atmosphere. */
export const barometricHead = (siteElev: number, rho = 998.2) => (101325 * (1 - 2.25577e-5 * siteElev) ** 5.25588) / (rho * G);

/** Set density, vapour head and barometric head from the settings (call at the start of each solve). */
export function applyFluid(s: Partial<Settings> | undefined) {
  const f = s?.fluid;
  RHO = f?.density ?? 998.2;
  HV = f ? (f.vapourPressure * 1000) / (RHO * G) : 0.24;
  NU = f?.viscosity ?? 1.004e-6;
  HB = s?.siteElevation || f ? barometricHead(s?.siteElevation ?? 0, RHO) : 10.33;
}

/** Liquid properties used by the engine. */
export interface FluidSpec {
  /** Display name (e.g. "Water 20 °C"). */
  name: string;
  /** Temperature, °C (informative). */
  temperature?: number;
  /** Density, kg/m³. */
  density: number;
  /** Absolute vapour pressure, kPa. */
  vapourPressure: number;
  /** Kinematic viscosity, m²/s. */
  viscosity?: number;
  /** Bulk modulus, GPa (wave speed calculator). */
  bulkModulus?: number;
}

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
  /** Treat as junction: the valve is kept in the model but ignored in the run, so results with and
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
  /** Variable cross-section: [water surface elevation m, plan area m²] (shafts with chambers, expansion galleries). */
  areaCurve?: [number, number][];
  /** Differential (Johnson) surge tank: a central riser, fed directly from the pipe, inside an outer chamber that
   *  connects to the pipe through ports. The riser top overflows into the chamber. `diameter` is then the outer
   *  diameter; the chamber area is the outer area less the riser area. */
  differential?: DifferentialTank;
}

export interface DifferentialTank {
  /** Riser internal diameter, m. */
  riserDiameter: number;
  /** Riser top (overflow into the chamber) elevation, m (default: tank top). */
  riserTop?: number;
  /** Total port area between the pipe and the chamber, m². */
  portArea: number;
  /** Port discharge coefficient (default 0.6). */
  portCd?: number;
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
  /** Reservoirs: head varies with time during the transient. */
  headSchedule?: HeadSchedule;
  /** Free text label shown on the drawing. */
  label?: string;
  vessel?: SurgeVessel;
  airValve?: AirValve;
  relief?: ReliefValve;
  tank?: OpenTank;
  sav?: SurgeAnticipationValve;
  outlet?: Outlet;
  /** Storage tank with a varying level in extended-period runs (kind 'reservoir'; `elev` is the tank bottom).
   *  In a surge run the tank holds the level it has at the chosen time. */
  storage?: StorageTank;
  /** Pattern id: multiplies a junction's demand, or a fixed-level source's head, in extended-period runs. */
  pattern?: string;
  /** Initial water quality (mg/L for a chemical, hours for age, % for trace). Sources keep it. */
  quality?: number;
  /** Booster station: water leaving the node has at least this concentration (mg/L). */
  booster?: number;
  /** Concentration of water entering the network here (sources and junctions with negative demand), mg/L. */
  sourceConc?: number;
  /** Pattern applied to `sourceConc`. */
  sourcePattern?: string;
}

/** Storage tank (levels are measured above the tank bottom, the node elevation). */
export interface StorageTank {
  initLevel: number;
  minLevel: number;
  maxLevel: number;
  /** Internal diameter of a cylindrical tank, m. */
  diameter: number;
  /** Volume at the minimum level, m³ (default: cylinder). */
  minVolume?: number;
  /** Volume curve [level m, volume m³] for non-cylindrical tanks. */
  volumeCurve?: [number, number][];
}

/** Time pattern: factors applied over consecutive pattern steps (repeats). */
export interface TimePattern { id: string; factors: number[] }

/** Simple control: change a link when a time is reached or a tank level / node pressure crosses a value. */
export interface SimpleControl {
  link: string;
  /** New status (pumps: open = running). */
  status?: 'open' | 'closed';
  /** New setting (control valves: set point in m or m³/s; pumps: relative speed). */
  setting?: number;
  /** Time-based: clock time since the start, s. */
  at?: number;
  /** Clock-time control: time of day, s (repeats daily). */
  clock?: number;
  /** Level / pressure based. */
  node?: string;
  op?: 'above' | 'below';
  /** Tank level (m above the bottom) or junction pressure head (m). */
  value?: number;
}

/** Rule-based control (EPANET [RULES]): IF … AND/OR … THEN … ELSE … PRIORITY. */
export interface RuleCondition {
  logic: 'if' | 'and' | 'or';
  /** node, tank, junction, reservoir, link, pipe, pump, valve or system. */
  object: string;
  id?: string;
  /** level, pressure, head, demand, flow, status, setting, time, clocktime, filltime, draintime. */
  attribute: string;
  op: '=' | '<>' | '<' | '>' | '<=' | '>=';
  /** Number (m, m³/s, s for times) or a status word (open, closed, active). */
  value: number | string;
}
export interface RuleAction { link: string; status?: 'open' | 'closed'; setting?: number }
export interface ControlRule { id: string; conditions: RuleCondition[]; then: RuleAction[]; else?: RuleAction[]; priority?: number }

export type QualityMode = 'none' | 'age' | 'trace' | 'chemical';

/** Extended-period simulation settings. */
export interface EPSSettings {
  /** Total duration, s (e.g. 86 400 for a day). */
  duration: number;
  /** Hydraulic time step, s (default 3600). */
  hydStep: number;
  /** Pattern time step, s (default = hydraulic step). */
  patternStep?: number;
  /** Pattern start offset, s. */
  patternStart?: number;
  /** Report step, s (default = hydraulic step). */
  reportStep?: number;
  /** Clock time at the start, s after midnight. */
  startClock?: number;
  /** Pattern used by junctions without their own (EPANET default "1"). */
  defaultPattern?: string;
  quality: QualityMode;
  /** Quality step, s (default 300). */
  qualStep?: number;
  /** Trace source node. */
  traceNode?: string;
  /** Chemical name and units shown in results (default Chlorine, mg/L). */
  chemical?: string;
  /** Global bulk reaction coefficient, 1/day (negative = decay). */
  bulk?: number;
  /** Global wall reaction coefficient, m/day (negative = decay). */
  wall?: number;
  /** Bulk coefficient in tanks (default the global bulk). */
  tankBulk?: number;
  /** Molecular diffusivity of the chemical, m²/s (default chlorine 1.208e-9). */
  diffusivity?: number;
  /** Quality tolerance: water parcels closer than this in quality are merged (default 0.01, as EPANET). */
  tolerance?: number;
  /** Rule step, s (default a tenth of the hydraulic step, as EPANET). */
  ruleStep?: number;
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
  /** Drawing bend points between the two end nodes (map coordinates, m). */
  vertices?: { x: number; y: number }[];
  /** Pipe material (catalogue name, informative). */
  material?: string;
  /** Wall thickness, mm (wave speed calculator). */
  wall?: number;
  label?: string;
  /** Check valve at the start of the pipe (flow only from `from` to `to`). */
  checkValve?: CheckValveSpec;
  /** Viscoelastic wall (PE, PVC): Kelvin–Voigt creep compliances J (1/GPa) with retardation times τ (s). The wave
   *  speed is then the instantaneous one. Needs the wall thickness. */
  viscoelastic?: { J: number[]; tau: number[] };
  /** Water quality: bulk (1/day) and wall (m/day) reaction coefficients for this pipe (default the global ones). */
  bulkCoeff?: number;
  wallCoeff?: number;
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
  label?: string;
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
  /** Four-quadrant behaviour in the surge run: reverse flow and reverse rotation (turbining) after a trip,
   *  for pumps without a non-return valve or with a slow one. 'generic' derives the four quadrants from the pump
   *  curve; 'suter' uses the manufacturer's or a published Suter characteristic. */
  fourQuadrant?: 'generic' | 'suter';
  /** Suter characteristic: θ in degrees (0–360), WH = h/(α²+v²), WB = β/(α²+v²), normalised on the rated point. */
  suter?: { theta: number[]; wh: number[]; wb: number[] };
  /** Variable-speed drive holding a pressure: the steady speed is found to meet the set point, and during the
   *  surge run a PI controller keeps adjusting it (unless the pump trips). */
  vsd?: VSDControl;
  /** Motor for a pump start: the speed then follows the motor torque curve and the inertia instead of a set ramp. */
  motor?: MotorStart;
}

/** Induction motor start-up: torque–speed curve and the starter. */
export interface MotorStart {
  /** Direct on line, star–delta or soft starter (voltage ramp). Default direct on line. */
  starter?: 'dol' | 'starDelta' | 'soft';
  /** Torque–speed curve: [speed / rated speed, torque / full-load torque]. Default: a typical design-B motor. */
  curve?: [number, number][];
  /** Full-load torque, N·m (default: the pump torque at its rated duty). */
  ratedTorque?: number;
  /** Star–delta: speed fraction at which it switches to delta (default 0.8). */
  switchSpeed?: number;
  /** Soft starter: initial voltage fraction (default 0.35) and ramp time to full voltage, s (default 10). */
  softInitial?: number;
  softRamp?: number;
}

export interface VSDControl {
  /** Node whose pressure is controlled. */
  node: string;
  /** Pressure set point at that node, m of head. */
  setPressure: number;
  /** Proportional gain, speed fraction per m (default 0.02). */
  kp?: number;
  /** Integral time, s (default 5). */
  ti?: number;
  minSpeed?: number;
  maxSpeed?: number;
  /** Fastest change from 0 to 100 % speed, s (default 10). */
  rampTime?: number;
  /** Keep controlling during the surge run (default true). */
  active?: boolean;
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
  /** Fixed restriction (inline orifice): drawn and listed as an orifice; it is a valve that is never operated. */
  orifice?: boolean;
  /** Pressure-breaker valve: a fixed head drop (m) whatever the flow (EPANET PBV). */
  pbv?: number;
  /** General-purpose valve: head loss curve [flow m³/s, head loss m] (EPANET GPV). */
  gpv?: [number, number][];
  /** Hydro turbine: modelled through its wicket gates (a valve whose fully open loss passes the rated flow at the
   *  rated head); the runner speed is found from the power balance after a load change. */
  turbine?: TurbineSpec;
  label?: string;
}

export interface TurbineSpec {
  /** Rated net head across the turbine, m. */
  ratedHead: number;
  /** Rated flow, m³/s. */
  ratedFlow: number;
  /** Efficiency at the rated point (0–1). */
  efficiency: number;
  /** Synchronous speed, rpm. */
  speed: number;
  /** Turbine + generator inertia, kg·m². */
  inertia: number;
  /** Speed governor: after a load rejection the gates follow a PI controller on the speed (instead of a set
   *  closure), limited by the fastest closing time. */
  governor?: { kp?: number; ti?: number; closeTime: number };
  /** Runner characteristic in the surge run: flow and efficiency change with the unit speed ν = (n/n_r)/√(H/H_r),
   *  so the flow falls (Francis) or rises (Kaplan) as the unit speeds up after a load rejection, and the
   *  efficiency falls to zero at runaway. Without it the turbine passes flow like a valve (gate opening only). */
  characteristic?: TurbineCharacteristic;
}

export interface TurbineCharacteristic {
  /** Typical forms by machine type, or a table. */
  kind: 'francisLow' | 'francisHigh' | 'kaplan' | 'pelton' | 'table';
  /** Runaway unit speed at full gate, ×rated (default by type). */
  runaway?: number;
  /** table: [ν, flow factor, efficiency factor] (factors relative to the rated point). */
  table?: [number, number, number][];
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
  /** Valve events on turbines: load rejection (generator disconnects, gates close) or load acceptance (gates open). */
  turbineOp?: 'rejection' | 'acceptance';
}

/** Time-varying head at a reservoir boundary (tide, wave, sloshing tank, upstream pump station). */
export interface HeadSchedule {
  mode: 'sine' | 'table';
  /** 'sine': amplitude (m) and period (s); phase in degrees. */
  amplitude?: number;
  period?: number;
  phase?: number;
  /** 'table': [time s, change of head from the steady level m]. */
  table?: [number, number][];
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
  /** Liquid (default water at 20 °C). */
  fluid?: FluidSpec;
  /** Site elevation above sea level, m (sets the atmospheric pressure). Default 0. */
  siteElevation?: number;
  /** Maximum allowed pressure head, m (checks; pipe class is used when not given). */
  maxPressure?: number;
  /** Number of animation frames kept (default 600). */
  frames?: number;
  /** Calculation engine for the surge run: 'wave' (method of characteristics with column separation, default) or
   *  'rigid' (rigid water columns: slow events, mass oscillation, long runs). */
  engine?: 'wave' | 'rigid';
}

/** Details printed on the report's title page. */
export interface ReportInfo {
  projectNo?: string;
  client?: string;
  preparedBy?: string;
  checkedBy?: string;
  revision?: string;
  notes?: string;
  /** Report narrative in Markdown (may be drafted by the AI copilot and edited by the engineer). */
  narrative?: string;
  narrativeByAI?: boolean;
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
  /** More operations in the same run (each with its own targets and timing), e.g. a pump trip followed by a
   *  valve closure. The engine applies all of them; the first one is `event`. */
  extraEvents?: TransientEvent[];
  settings: Settings;
  /** Unit system for display (the model is always stored in SI). */
  units?: 'SI' | 'US';
  /** Cases: named variants of the model (each a full snapshot), managed in the Cases manager. */
  cases?: ModelCase[];
  /** Id of the active case. */
  activeCase?: string;
  /** Saved long-section routes. */
  profiles?: { name: string; path: string[] }[];
  /** Background picture under the drawing (site plan, aerial photo, scanned drawing), placed by its corners. */
  background?: BackgroundImage;
  /** Extended-period simulation: patterns, controls and settings (daily operation, tank levels, water quality). */
  patterns?: TimePattern[];
  controls?: SimpleControl[];
  /** Rule-based controls, checked every rule step of the extended-period run. */
  rules?: ControlRule[];
  eps?: EPSSettings;
  /** Notes written on the drawing (map coordinates, m). */
  annotations?: { id: string; x: number; y: number; text: string }[];
  /** Named selection sets (from queries or picks). */
  selectionSets?: { name: string; query?: string; refs: { type: 'node' | 'pipe' | 'pump' | 'valve'; id: string }[] }[];
  /** AI copilot conversation kept with the project (text only). */
  copilot?: { role: 'user' | 'assistant'; text: string }[];
  /** Coordinate system of the model coordinates (for basemaps and terrain). */
  crs?: { kind: 'utm'; zone: number; south: boolean } | { kind: 'webmercator' };
  /** Live and historian data: the source (no password is stored) and the tag-to-element mapping. */
  scada?: { source?: { kind: 'mqtt' | 'bridge'; url: string; topics?: string[]; username?: string }; tags: { tag: string; element: string; quantity: 'pressure' | 'head' | 'flow' | 'level' | 'status' | 'speed'; scale?: number; offset?: number }[] };
}

export interface BackgroundImage {
  /** Image as a data URL. */
  src: string;
  /** Map coordinates of the lower-left (x0, y0) and upper-right (x1, y1) corners, m. */
  x0: number; y0: number; x1: number; y1: number;
  opacity: number;
  visible: boolean;
  /** Credit line of a web basemap (shown on the drawing). */
  attribution?: string;
}

/** A named variant of the model (what-if): stored as a full copy so it can be run and compared on its own. */
export interface ModelCase {
  id: string;
  name: string;
  notes?: string;
  /** The model of this case (without its own cases list). */
  model: Omit<Network, 'cases' | 'activeCase'>;
}

/** All operations of a run: the main event plus the extra ones. */
export const allEvents = (net: Pick<Network, 'event' | 'extraEvents'>): TransientEvent[] => [net.event, ...(net.extraEvents ?? [])].filter((e) => e && e.kind !== 'none');

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
