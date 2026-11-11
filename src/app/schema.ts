// Element field schema: every editable field described once (name, unit, limits, help, basic or advanced).
// Used by the command layer (validation of set_properties), the AI tools (what can be changed and in which unit),
// and progressively by the properties panel and data sheets.
import type { NetNode, Network, Pipe, Pump, Valve } from '../engine/types';
import type { Quantity } from './units';

export type FieldType = 'number' | 'string' | 'boolean' | 'enum';
export interface FieldDef<T> {
  key: string;
  label: string;
  type: FieldType;
  /** Unit of the value in commands and AI tools (SI, as written). */
  unit?: string;
  /** Display quantity (for unit conversion in the UI). */
  q?: Quantity;
  options?: string[];
  min?: number;
  max?: number;
  help: string;
  advanced?: boolean;
  get: (e: T) => unknown;
  set: (e: T, v: unknown) => T;
}

const n = (v: unknown) => Number(v);
const pos = { min: 0 };

export const NODE_FIELDS: FieldDef<NetNode>[] = [
  { key: 'label', label: 'Label', type: 'string', help: 'Free text shown on the drawing.', get: (e) => e.label ?? '', set: (e, v) => ({ ...e, label: String(v) || undefined }) },
  { key: 'x', label: 'X', type: 'number', unit: 'm', q: 'length', help: 'Map coordinate (east).', get: (e) => e.x, set: (e, v) => ({ ...e, x: n(v) }) },
  { key: 'y', label: 'Y', type: 'number', unit: 'm', q: 'length', help: 'Map coordinate (north).', get: (e) => e.y, set: (e, v) => ({ ...e, y: n(v) }) },
  { key: 'elevation', label: 'Elevation', type: 'number', unit: 'm', q: 'elevation', help: 'Ground or pipe centreline level.', get: (e) => e.elev, set: (e, v) => ({ ...e, elev: n(v) }) },
  { key: 'demand_lps', label: 'Demand', type: 'number', unit: 'L/s', q: 'flow', help: 'Base demand of a junction.', get: (e) => (e.demand ?? 0) * 1000, set: (e, v) => ({ ...e, demand: n(v) / 1000 }) },
  { key: 'emitter_lps_at_1m', label: 'Emitter coefficient', type: 'number', unit: 'L/s at 1 m', min: 0, help: 'Leakage, sprinkler or hydrant: flow C·p^γ to the atmosphere (0 = none).', get: (e) => (e.emitter ?? 0) * 1000, set: (e, v) => ({ ...e, emitter: n(v) > 0 ? n(v) / 1000 : undefined }) },
  { key: 'water_level_m', label: 'Water level', type: 'number', unit: 'm', q: 'head', help: 'Water surface level of a source.', get: (e) => e.head, set: (e, v) => ({ ...e, head: n(v) }) },
  { key: 'kind', label: 'Type', type: 'enum', options: ['junction', 'reservoir'], help: 'Junction or fixed-level source.', get: (e) => e.kind, set: (e, v) => (v === 'reservoir' ? { ...e, kind: 'reservoir', head: e.head ?? e.elev + 5 } : { ...e, kind: 'junction', headSchedule: undefined }) },
];

export const PIPE_FIELDS: FieldDef<Pipe>[] = [
  { key: 'label', label: 'Label', type: 'string', help: 'Free text shown on the drawing.', get: (e) => e.label ?? '', set: (e, v) => ({ ...e, label: String(v) || undefined }) },
  { key: 'length_m', label: 'Length', type: 'number', unit: 'm', q: 'length', ...pos, help: 'Pipe length (independent of the drawing).', get: (e) => e.length, set: (e, v) => ({ ...e, length: n(v) }) },
  { key: 'diameter_mm', label: 'Internal diameter', type: 'number', unit: 'mm', q: 'diameter', min: 1, max: 6000, help: 'Internal diameter.', get: (e) => e.diameter * 1000, set: (e, v) => ({ ...e, diameter: n(v) / 1000 }) },
  { key: 'roughness', label: 'Roughness', type: 'number', unit: 'mm or C', ...pos, help: 'Absolute roughness in mm (Darcy–Weisbach) or Hazen–Williams C, per the friction method.', get: (e) => e.roughness, set: (e, v) => ({ ...e, roughness: n(v) }) },
  { key: 'wavespeed_mps', label: 'Wave speed', type: 'number', unit: 'm/s', q: 'wavespeed', min: 50, max: 1600, help: 'Pressure wave speed (250–450 PE, 300–500 PVC, 900–1300 iron/steel/concrete).', get: (e) => e.wavespeed, set: (e, v) => ({ ...e, wavespeed: n(v) }) },
  { key: 'pressure_class_m', label: 'Pressure class', type: 'number', unit: 'm', q: 'pressureHead', ...pos, help: 'Allowable pressure head (PN16 ≈ 163 m).', get: (e) => e.pressureClass, set: (e, v) => ({ ...e, pressureClass: n(v) || undefined }) },
  { key: 'minor_loss_k', label: 'Minor loss ΣK', type: 'number', ...pos, advanced: true, help: 'Sum of fitting loss coefficients.', get: (e) => e.minorLoss ?? 0, set: (e, v) => ({ ...e, minorLoss: n(v) }) },
  { key: 'material', label: 'Material', type: 'string', advanced: true, help: 'Catalogue material name (informative).', get: (e) => e.material ?? '', set: (e, v) => ({ ...e, material: String(v) || undefined }) },
  { key: 'wall_mm', label: 'Wall thickness', type: 'number', unit: 'mm', advanced: true, ...pos, help: 'Wall thickness (wave speed calculator).', get: (e) => e.wall, set: (e, v) => ({ ...e, wall: n(v) || undefined }) },
  { key: 'closed', label: 'Closed', type: 'boolean', help: 'Pipe closed (no flow).', get: (e) => !!e.closed, set: (e, v) => ({ ...e, closed: v ? true : undefined }) },
  { key: 'check_valve', label: 'Non-return valve', type: 'boolean', help: 'Ideal non-return valve at the start of the pipe.', get: (e) => !!e.checkValve, set: (e, v) => ({ ...e, checkValve: v ? e.checkValve ?? { mode: 'ideal', kOpen: 1 } : undefined }) },
];

export const PIPE_VISCO_FIELD: FieldDef<Pipe> = { key: 'viscoelastic', label: 'Viscoelastic creep', type: 'string', help: 'PE/PVC wall creep as "J1/τ1, J2/τ2" (J in 1/GPa, τ in s), "" = elastic. Needs wall_mm.', get: (e) => (e.viscoelastic ? e.viscoelastic.J.map((j, k) => `${j}/${e.viscoelastic!.tau[k]}`).join(', ') : ''), set: (e, v) => { const pairs = String(v).split(',').map((x) => x.split('/').map(Number)).filter((x) => x.length === 2 && x.every(Number.isFinite)); return { ...e, viscoelastic: pairs.length ? { J: pairs.map((x) => x[0]), tau: pairs.map((x) => x[1]) } : undefined }; } };

export const PUMP_FIELDS: FieldDef<Pump>[] = [
  { key: 'label', label: 'Label', type: 'string', help: 'Free text.', get: (e) => e.label ?? '', set: (e, v) => ({ ...e, label: String(v) || undefined }) },
  { key: 'curve', label: 'Head curve', type: 'string', help: 'Points "flow L/s : head m", e.g. "0:98, 250:74, 375:52" (shut-off, duty, run-out).', get: (e) => e.curve.map(([q, h]) => `${+(q * 1000).toFixed(3)}:${+h.toFixed(3)}`).join(', '), set: (e, v) => ({ ...e, curve: parseCurve(String(v)) }) },
  { key: 'efficiency_pct', label: 'Efficiency at duty', type: 'number', unit: '%', min: 1, max: 100, help: 'Pump efficiency at the duty point.', get: (e) => e.efficiency * 100, set: (e, v) => ({ ...e, efficiency: n(v) / 100 }) },
  { key: 'speed_rpm', label: 'Rated speed', type: 'number', unit: 'rpm', min: 1, help: 'Rated speed.', get: (e) => e.speed, set: (e, v) => ({ ...e, speed: n(v) }) },
  { key: 'inertia_kgm2', label: 'Inertia', type: 'number', unit: 'kg·m²', q: 'inertia', ...pos, help: 'Pump + motor rotating inertia.', get: (e) => e.inertia, set: (e, v) => ({ ...e, inertia: n(v) }) },
  { key: 'check_valve', label: 'Discharge non-return valve', type: 'boolean', help: 'Non-return valve on the discharge.', get: (e) => e.checkValve, set: (e, v) => ({ ...e, checkValve: !!v }) },
  { key: 'running', label: 'Running', type: 'boolean', help: 'Running in the steady state.', get: (e) => e.on, set: (e, v) => ({ ...e, on: !!v }) },
  { key: 'vsd_node', label: 'Variable-speed drive: controlled node', type: 'string', help: 'Node whose pressure the drive holds ("" = fixed speed).', get: (e) => e.vsd?.node ?? '', set: (e, v) => (String(v) ? { ...e, vsd: { setPressure: 30, ...(e.vsd ?? {}), node: String(v) } } : { ...e, vsd: undefined }) },
  { key: 'vsd_set_pressure_m', label: 'Variable-speed drive: set pressure', type: 'number', unit: 'm', help: 'Pressure held at the controlled node (needs vsd_node).', get: (e) => e.vsd?.setPressure ?? NaN, set: (e, v) => (e.vsd ? { ...e, vsd: { ...e.vsd, setPressure: n(v) } } : e) },
  { key: 'starter', label: 'Motor starter', type: 'enum', options: ['ramp', 'dol', 'starDelta', 'soft'], help: 'How a pump start operation runs up: ramp = speed set linearly over the start time; dol, starDelta, soft = speed from the motor torque curve and the inertia.', get: (e) => e.motor?.starter ?? (e.motor ? 'dol' : 'ramp'), set: (e, v) => ({ ...e, motor: v === 'ramp' ? undefined : { ...e.motor, starter: v as 'dol' | 'starDelta' | 'soft' } }) },
  { key: 'four_quadrant', label: 'Four-quadrant behaviour', type: 'enum', options: ['off', 'generic', 'suter'], help: 'Reverse flow and reverse rotation after a trip (pumps without a non-return valve). generic = derived from the curve; suter = manufacturer data.', get: (e) => e.fourQuadrant ?? 'off', set: (e, v) => ({ ...e, fourQuadrant: v === 'off' ? undefined : (v as 'generic' | 'suter') }) },
];

export const VALVE_FIELDS: FieldDef<Valve>[] = [
  { key: 'label', label: 'Label', type: 'string', help: 'Free text.', get: (e) => e.label ?? '', set: (e, v) => ({ ...e, label: String(v) || undefined }) },
  { key: 'diameter_mm', label: 'Diameter', type: 'number', unit: 'mm', q: 'diameter', min: 1, help: 'Valve bore.', get: (e) => e.diameter * 1000, set: (e, v) => ({ ...e, diameter: n(v) / 1000 }) },
  { key: 'k_open', label: 'Loss coefficient open', type: 'number', ...pos, help: 'K fully open, on the bore velocity.', get: (e) => e.k0, set: (e, v) => ({ ...e, k0: n(v) }) },
  { key: 'opening', label: 'Initial stroke', type: 'number', min: 0, max: 1, help: 'Stroke in the steady state (0 shut, 1 open).', get: (e) => e.opening, set: (e, v) => ({ ...e, opening: n(v) }) },
  { key: 'characteristic', label: 'Characteristic', type: 'enum', options: ['area', 'gate', 'globe', 'ball', 'butterfly', 'needle'], help: 'How flow area follows the stroke.', get: (e) => e.law ?? 'area', set: (e, v) => ({ ...e, law: v as Valve['law'] }) },
  { key: 'set_point', label: 'Set point', type: 'number', help: 'PRV/PSV: pressure head in m; FCV: flow in L/s.', get: (e) => (e.control ? (e.control.type === 'FCV' ? e.control.set * 1000 : e.control.set) : undefined), set: (e, v) => (e.control ? { ...e, control: { ...e.control, set: e.control.type === 'FCV' ? n(v) / 1000 : n(v) } } : e) },
];

/** Device fields on a junction (values in SI as written in the key). */
export const DEVICE_FIELDS: Record<string, { key: string; unit?: string; help: string; get: (n: NetNode) => unknown; set: (n: NetNode, v: number | string | boolean) => NetNode }[]> = {
  vessel: [
    { key: 'volume_m3', unit: 'm³', help: 'Total vessel volume.', get: (x) => x.vessel?.volume, set: (x, v) => ({ ...x, vessel: { ...x.vessel!, volume: +v } }) },
    { key: 'gas_volume_m3', unit: 'm³', help: 'Initial gas volume at the steady pressure.', get: (x) => x.vessel?.gasVolume, set: (x, v) => ({ ...x, vessel: { ...x.vessel!, gasVolume: +v } }) },
    { key: 'connection_mm', unit: 'mm', help: 'Connection diameter.', get: (x) => (x.vessel ? x.vessel.connDiameter * 1000 : undefined), set: (x, v) => ({ ...x, vessel: { ...x.vessel!, connDiameter: +v / 1000 } }) },
    { key: 'k_in', help: 'Loss coefficient into the vessel.', get: (x) => x.vessel?.kIn, set: (x, v) => ({ ...x, vessel: { ...x.vessel!, kIn: +v } }) },
    { key: 'k_out', help: 'Loss coefficient out of the vessel.', get: (x) => x.vessel?.kOut, set: (x, v) => ({ ...x, vessel: { ...x.vessel!, kOut: +v } }) },
    { key: 'polytropic_n', help: 'Gas polytropic exponent (1.0–1.4, 1.2 typical).', get: (x) => x.vessel?.n, set: (x, v) => ({ ...x, vessel: { ...x.vessel!, n: +v } }) },
    { key: 'shape', help: 'vertical, horizontal or sphere.', get: (x) => x.vessel?.shape ?? 'vertical', set: (x, v) => ({ ...x, vessel: { ...x.vessel!, shape: String(v) as 'vertical' } }) },
    { key: 'bladder', help: 'Bladder separates gas and water.', get: (x) => !!x.vessel?.bladder, set: (x, v) => ({ ...x, vessel: { ...x.vessel!, bladder: !!v || undefined } }) },
  ],
  airValve: [
    { key: 'type', help: 'double, threeStage, vacuumBreaker, releaseOnly.', get: (x) => x.airValve?.type ?? 'double', set: (x, v) => ({ ...x, airValve: { ...x.airValve!, type: String(v) as 'double' } }) },
    { key: 'inflow_mm', unit: 'mm', help: 'Large inflow orifice diameter.', get: (x) => (x.airValve ? x.airValve.inDiameter * 1000 : undefined), set: (x, v) => ({ ...x, airValve: { ...x.airValve!, inDiameter: +v / 1000 } }) },
    { key: 'outflow_mm', unit: 'mm', help: 'Large outflow orifice diameter.', get: (x) => (x.airValve ? x.airValve.outDiameter * 1000 : undefined), set: (x, v) => ({ ...x, airValve: { ...x.airValve!, outDiameter: +v / 1000 } }) },
    { key: 'small_mm', unit: 'mm', help: 'Small (pressurised release) orifice.', get: (x) => (x.airValve?.smallDiameter ?? 0) * 1000, set: (x, v) => ({ ...x, airValve: { ...x.airValve!, smallDiameter: +v ? +v / 1000 : undefined } }) },
  ],
  tank: [
    { key: 'diameter_m', unit: 'm', help: 'Tank internal diameter.', get: (x) => x.tank?.diameter, set: (x, v) => ({ ...x, tank: { ...x.tank!, diameter: +v } }) },
    { key: 'bottom_m', unit: 'm', help: 'Bottom level.', get: (x) => x.tank?.bottomElev, set: (x, v) => ({ ...x, tank: { ...x.tank!, bottomElev: +v } }) },
    { key: 'top_m', unit: 'm', help: 'Overflow level.', get: (x) => x.tank?.topElev, set: (x, v) => ({ ...x, tank: { ...x.tank!, topElev: +v } }) },
    { key: 'connection_mm', unit: 'mm', help: 'Connection diameter.', get: (x) => (x.tank ? x.tank.connDiameter * 1000 : undefined), set: (x, v) => ({ ...x, tank: { ...x.tank!, connDiameter: +v / 1000 } }) },
    { key: 'riser_diameter_m', unit: 'm', help: 'Differential surge tank: riser diameter (0 makes it a plain tank).', get: (x) => x.tank?.differential?.riserDiameter, set: (x, v) => ({ ...x, tank: { ...x.tank!, differential: +v > 0 ? { portArea: Math.PI / 4 * (+v) ** 2 * 0.1, ...x.tank!.differential, riserDiameter: +v } : undefined } }) },
    { key: 'port_area_m2', unit: 'm²', help: 'Differential surge tank: total port area between pipe and chamber.', get: (x) => x.tank?.differential?.portArea, set: (x, v) => ({ ...x, tank: { ...x.tank!, differential: x.tank!.differential ? { ...x.tank!.differential, portArea: +v } : { riserDiameter: x.tank!.diameter / 3, portArea: +v } } }) },
    { key: 'riser_top_m', unit: 'm', help: 'Differential surge tank: riser overflow level.', get: (x) => x.tank?.differential?.riserTop, set: (x, v) => ({ ...x, tank: { ...x.tank!, differential: x.tank!.differential ? { ...x.tank!.differential, riserTop: +v } : x.tank!.differential } }) },
  ],
  relief: [
    { key: 'set_head_m', unit: 'm', help: 'Opening pressure head.', get: (x) => x.relief?.setHead, set: (x, v) => ({ ...x, relief: { ...x.relief!, setHead: +v } }) },
    { key: 'diameter_mm', unit: 'mm', help: 'Valve diameter.', get: (x) => (x.relief?.diameter ?? 0) * 1000, set: (x, v) => ({ ...x, relief: { ...x.relief!, diameter: +v / 1000 } }) },
  ],
  sav: [
    { key: 'low_set_m', unit: 'm', help: 'Opens when the pressure falls below this head.', get: (x) => x.sav?.lowSet, set: (x, v) => ({ ...x, sav: { ...x.sav!, lowSet: +v } }) },
    { key: 'diameter_mm', unit: 'mm', help: 'Valve diameter.', get: (x) => (x.sav ? x.sav.diameter * 1000 : undefined), set: (x, v) => ({ ...x, sav: { ...x.sav!, diameter: +v / 1000 } }) },
    { key: 'open_s', unit: 's', help: 'Opening time.', get: (x) => x.sav?.openTime, set: (x, v) => ({ ...x, sav: { ...x.sav!, openTime: +v } }) },
    { key: 'hold_s', unit: 's', help: 'Time held open.', get: (x) => x.sav?.holdTime, set: (x, v) => ({ ...x, sav: { ...x.sav!, holdTime: +v } }) },
    { key: 'close_s', unit: 's', help: 'Closing time.', get: (x) => x.sav?.closeTime, set: (x, v) => ({ ...x, sav: { ...x.sav!, closeTime: +v } }) },
  ],
  outlet: [
    { key: 'diameter_mm', unit: 'mm', help: 'Opening diameter.', get: (x) => (x.outlet ? x.outlet.diameter * 1000 : undefined), set: (x, v) => ({ ...x, outlet: { ...x.outlet!, diameter: +v / 1000 } }) },
    { key: 'opens_at_s', unit: 's', help: 'Timed blow-off: opening time.', get: (x) => x.outlet?.time, set: (x, v) => ({ ...x, outlet: { ...x.outlet!, time: +v } }) },
    { key: 'burst_head_m', unit: 'm', help: 'Burst disc: bursting pressure head.', get: (x) => x.outlet?.burstHead, set: (x, v) => ({ ...x, outlet: { ...x.outlet!, burstHead: +v } }) },
  ],
};

export function parseCurve(s: string): [number, number][] {
  const pts = s.split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean).map((p) => p.split(/[:\s/]+/).map(Number));
  const ok = pts.filter((p) => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])).map(([q, h]) => [q / 1000, h] as [number, number]);
  if (!ok.length) throw new Error('Curve needs points like "0:98, 250:74, 375:52" (flow L/s : head m).');
  return ok.sort((a, b) => a[0] - b[0]);
}

export type ElType = 'node' | 'pipe' | 'pump' | 'valve';
export const FIELDS: Record<ElType, FieldDef<any>[]> = { node: NODE_FIELDS, pipe: [...PIPE_FIELDS, PIPE_VISCO_FIELD], pump: PUMP_FIELDS, valve: VALVE_FIELDS }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Apply a set of field values to an element, validating names, types and limits. */
export function applyFields<T>(type: ElType, e: T, values: Record<string, unknown>): { el: T; errors: string[] } {
  const defs = FIELDS[type] as FieldDef<T>[];
  let el = e;
  const errors: string[] = [];
  for (const [k, v] of Object.entries(values)) {
    const d = defs.find((x) => x.key === k);
    if (!d) { errors.push(`Unknown field "${k}" for ${type}. Allowed: ${defs.map((x) => x.key).join(', ')}.`); continue; }
    if (d.type === 'number') {
      const x = Number(v);
      if (!Number.isFinite(x)) { errors.push(`${k} must be a number.`); continue; }
      if (d.min !== undefined && x < d.min) { errors.push(`${k} must be ≥ ${d.min}.`); continue; }
      if (d.max !== undefined && x > d.max) { errors.push(`${k} must be ≤ ${d.max}.`); continue; }
    }
    if (d.type === 'enum' && !d.options!.includes(String(v))) { errors.push(`${k} must be one of ${d.options!.join(', ')}.`); continue; }
    try { el = d.set(el, v); } catch (err) { errors.push(`${k}: ${(err as Error).message}`); }
  }
  return { el, errors };
}

/** Plain values of an element by field key (for AI and exports). */
export function readFields(type: ElType, e: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of FIELDS[type]) { const v = d.get(e); if (v !== undefined && v !== '') out[d.key] = typeof v === 'number' ? +v.toFixed(4) : v; }
  return out;
}

export const elementsOf = (net: Network, type: ElType) => (type === 'node' ? net.nodes : type === 'pipe' ? net.pipes : type === 'pump' ? net.pumps : net.valves) as { id: string }[];
