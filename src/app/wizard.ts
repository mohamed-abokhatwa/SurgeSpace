// Guided model wizard: a pumped rising main or a gravity main from a few plain questions. It builds the model
// through the same commands the copilot and scripts use, so the result is ordinary, editable data.
import { PIPE_MATERIALS, waveSpeed } from './catalogues';
import { execute, localContext } from './commands';
import { solveSteady } from '../engine/steady';
import type { Network } from '../engine/types';

export interface WizardSpec {
  kind: 'pumped' | 'gravity';
  name: string;
  /** Long section: chainage m and pipe level m, in order (at least start and end). */
  profile: [number, number][];
  /** Water level at the start (sump or upstream reservoir) and at the end (tank or downstream reservoir), m. */
  startLevel: number;
  endLevel: number;
  /** Internal diameter, mm. */
  diameterMm: number;
  /** Material id from the catalogue. */
  material: string;
  /** Pressure class, m head (default 160). */
  pressureClassM?: number;
  /** Design flow, L/s (total). */
  flowLps: number;
  /** Pumped: number of duty pumps, speed rpm. */
  pumps?: number;
  speedRpm?: number;
  /** Gravity: closure time of the valve at the end, s. */
  closureS?: number;
  /** Operation to analyse. */
  operation: 'trip' | 'start' | 'closure';
}

const FRIC_EST = (Q: number, D: number, L: number, eps: number) => {
  // Swamee–Jain friction for the duty head estimate
  const A = (Math.PI / 4) * D * D, V = Q / A, Re = (V * D) / 1.004e-6;
  const f = 0.25 / Math.log10(eps / 1000 / (3.7 * D) + 5.74 / Re ** 0.9) ** 2;
  return (f * L * V * V) / (D * 2 * 9.80665);
};

/** Wave speed for the material and size (restrained buried pipe, catalogue wall ratio). */
export function wizardWaveSpeed(material: string, diameterMm: number): number {
  const m = PIPE_MATERIALS.find((x) => x.id === material) ?? PIPE_MATERIALS[0];
  const D = diameterMm / 1000;
  return Math.round(waveSpeed({ D, e: D * m.wallRatio, E: m.E, nu: m.poisson, K: 2.19, rho: 998.2, restraint: 'anchoredJoints' }));
}

/** The duty head per pump that delivers the flow: static lift plus friction, plus 5 % margin. */
export function wizardDutyHead(s: WizardSpec): number {
  const m = PIPE_MATERIALS.find((x) => x.id === s.material) ?? PIPE_MATERIALS[0];
  const L = Math.abs(s.profile[s.profile.length - 1][0] - s.profile[0][0]);
  return Math.round((s.endLevel - s.startLevel + FRIC_EST(s.flowLps / 1000, s.diameterMm / 1000, L, m.roughness)) * 1.05 * 10) / 10;
}

/** Build the model. Returns the network and a short list of what was done. */
export async function buildFromWizard(s: WizardSpec): Promise<{ net: Network; notes: string[] }> {
  if (s.profile.length < 2) throw new Error('The long section needs at least a start and an end point.');
  const ctx = localContext({ name: '', nodes: [], pipes: [], pumps: [], valves: [], event: { kind: 'none', targets: [], start: 1 }, settings: {} as Network['settings'] });
  const run = async (name: string, args: Record<string, unknown>) => {
    const r = await execute(ctx, name, args);
    if (!r.ok) throw new Error(`${name}: ${typeof r.output === 'object' && r.output && 'error' in r.output ? (r.output as { error: string }).error : JSON.stringify(r.output)}`);
    return r.output as Record<string, unknown>;
  };
  const m = PIPE_MATERIALS.find((x) => x.id === s.material) ?? PIPE_MATERIALS[0];
  const a = wizardWaveSpeed(s.material, s.diameterMm);
  const notes: string[] = [];
  await run('new_model', { name: s.name, description: s.kind === 'pumped' ? `Pumped main, ${s.flowLps} L/s, DN${s.diameterMm} ${m.name}` : `Gravity main, ${s.flowLps} L/s, DN${s.diameterMm} ${m.name}` });
  const pts = s.profile.map(([ch, z], k) => ({ id: k === 0 ? (s.kind === 'pumped' ? 'PS-D' : 'R-UP') : k === s.profile.length - 1 ? (s.kind === 'pumped' ? 'TANK' : 'V-UP') : `CH${Math.round(ch)}`, chainage_m: ch, elevation_m: z }));
  const line = { diameter_mm: s.diameterMm, wavespeed_mps: a, roughness: m.roughness, pressure_class_m: s.pressureClassM ?? 160, material: m.name };
  if (s.kind === 'pumped') {
    // sump → pumps → discharge node at the start of the main; tank at the end
    await run('add_node', { id: 'SUMP', kind: 'reservoir', x: -60, y: s.startLevel, elevation_m: Math.min(s.startLevel - 3, s.profile[0][1]), water_level_m: s.startLevel });
    await run('build_line', { points: pts, ...line, end_water_level_m: s.endLevel, x0: 0, y0: 0 });
    const n = Math.max(1, Math.round(s.pumps ?? 1));
    const H = wizardDutyHead(s);
    await run('add_pump_station', { suction: 'SUMP', discharge: 'PS-D', count: n, duty_flow_lps: s.flowLps / n, duty_head_m: H, speed_rpm: s.speedRpm ?? 1480 });
    notes.push(`${n} pump(s), ${(s.flowLps / n).toFixed(0)} L/s at ${H} m each (static lift + friction + 5 %); inertia estimated from the duty`);
    const pumps = ctx.net.pumps.map((p) => p.id);
    await run('set_operations', { operations: [s.operation === 'start' ? { kind: 'pump_start', targets: pumps, start_s: 1, duration_s: 10 } : { kind: 'pump_trip', targets: pumps, start_s: 1 }] });
    if (s.operation === 'start') ctx.net = { ...ctx.net, pumps: ctx.net.pumps.map((p) => ({ ...p, on: false })) };
  } else {
    // upstream reservoir → main → valve → downstream reservoir; the valve is sized for the design flow
    await run('build_line', { points: pts, ...line, start_water_level_m: s.startLevel, x0: 0, y0: 0 });
    const zEnd = s.profile[s.profile.length - 1][1];
    const xEnd = s.profile[s.profile.length - 1][0];
    await run('add_node', { id: 'R-DN', kind: 'reservoir', x: xEnd + 60, y: s.endLevel, elevation_m: Math.min(zEnd, s.endLevel - 1), water_level_m: s.endLevel });
    await run('add_link', { kind: 'lineValve', from: 'V-UP', to: 'R-DN', diameter_mm: s.diameterMm });
    const vid = ctx.net.valves[ctx.net.valves.length - 1].id;
    // valve loss so the main passes the design flow
    const target = s.flowLps / 1000;
    let lo = 0.01, hi = 1e5;
    for (let k = 0; k < 70; k++) {
      const mid = Math.sqrt(lo * hi);
      const trial = { ...ctx.net, valves: ctx.net.valves.map((v) => (v.id === vid ? { ...v, k0: mid } : v)) };
      const q = solveSteady(trial).flows.get(vid) ?? 0;
      if (q > target) lo = mid; else hi = mid;
    }
    ctx.net = { ...ctx.net, valves: ctx.net.valves.map((v) => (v.id === vid ? { ...v, k0: Math.round(Math.sqrt(lo * hi) * 100) / 100, law: 'butterfly' } : v)) };
    const avail = s.startLevel - s.endLevel;
    if (hi >= 1e5 * 0.99 || lo <= 0.011) notes.push(avail <= 0 ? 'The downstream level is above the upstream one: no gravity flow.' : 'The main cannot pass the design flow under the available head even with the valve fully open; the flow is what the head allows.');
    await run('set_operations', { operations: [{ kind: 'valve_close', targets: [vid], start_s: 1, duration_s: s.closureS ?? 30, exponent: 1 }] });
    notes.push(`Valve ${vid} (butterfly) closes in ${s.closureS ?? 30} s`);
  }
  // run long enough for several wave periods
  const L = Math.abs(s.profile[s.profile.length - 1][0] - s.profile[0][0]);
  const dur = Math.max(30, Math.ceil(((8 * L) / a + (s.kind === 'gravity' ? s.closureS ?? 30 : 0)) / 10) * 10);
  await run('set_run_settings', { duration_s: dur, friction: 'DW' });
  notes.unshift(`DN${s.diameterMm} ${m.name}, wave speed ${a} m/s, ${(L / 1000).toFixed(2)} km, run ${dur} s`);
  // air valves at the high points of the long section
  const hp = s.profile.map((p, k) => ({ p, k })).filter(({ k }) => k > 0 && k < s.profile.length - 1 && s.profile[k][1] > s.profile[k - 1][1] && s.profile[k][1] >= s.profile[k + 1][1]);
  for (const { p } of hp) {
    const id = `CH${Math.round(p[0])}`;
    if (ctx.net.nodes.some((n) => n.id === id)) await run('add_device', { node: id, device: 'airValve' });
  }
  if (hp.length) notes.push(`Air valves at ${hp.length} high point(s)`);
  return { net: ctx.net, notes };
}
