// Valve, check-valve and slam tests against theory and exact balances.
//  • Valve characteristics: gate table unchanged, typical curves monotone, manufacturer curve interpolation;
//    steady state and transient agree for a part-open valve (no start-up jump).
//  • Control valves: PRV / PSV / FCV meet their set points in the steady state; locked and active behaviour
//    in the transient (active PRV returns to its set pressure after a disturbance).
//  • Valve operating curve (time vs stroke) is followed exactly.
//  • Pump start: reaches the steady duty of the running pump.
//  • Check valves on pipes, pumps and valves: ideal (no reverse flow), reverse-velocity closure (slam = a·v/g),
//    delay closure timing, dynamic characteristic.
//  • Air-valve slam: pocket closure found, three-stage valve reduces it.
//  • Discharge to atmosphere (timed) and rupture disk: flow law, opening time and bursting pressure.
import { VALVE_CURVES, dynamicReverseVelocity, interpTable, valveArea } from '../src/engine/devices';
import { solveSteady } from '../src/engine/steady';
import { runTransient } from '../src/engine/transient';
import { G, area, defaultSettings, type Network, type NetNode, type Pump, type Valve, type CheckValveSpec } from '../src/engine/types';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);

// ── valve characteristics ──
{
  const GATE = [0, 0.0167, 0.0313, 0.0556, 0.1, 0.17, 0.333, 0.625, 1.25, 2.5, 5].map((v) => v / 5);
  const old = (s: number) => { const x = s * 10, i = Math.min(9, Math.floor(x)); return Math.sqrt(GATE[i] + (GATE[i + 1] - GATE[i]) * (x - i)); };
  let worst = 0;
  for (let k = 0; k <= 100; k++) worst = Math.max(worst, Math.abs(valveArea({ law: 'gate' }, k / 100) - old(k / 100)));
  t('gate valve curve identical to the previous gate table', worst < 1e-15);
  let mono = true;
  for (const law of Object.keys(VALVE_CURVES)) for (let k = 1; k <= 100; k++) if (valveArea({ law }, k / 100) < valveArea({ law }, (k - 1) / 100)) mono = false;
  t('typical curves (gate, globe, ball, butterfly, needle) rise from 0 to 1', mono && Object.keys(VALVE_CURVES).every((l) => valveArea({ law: l }, 0) === 0 && Math.abs(valveArea({ law: l }, 1) - 1) < 1e-12));
  const cur: [number, number][] = [[0, 0], [0.5, 0.2], [1, 1]];
  t('manufacturer curve: linear interpolation between points', Math.abs(valveArea({ law: 'curve', lawCurve: cur }, 0.25) - 0.1) < 1e-12 && Math.abs(valveArea({ law: 'curve', lawCurve: cur }, 0.75) - 0.6) < 1e-12);
  t('area law: opening = area', valveArea({}, 0.37) === 0.37);
}

// ── simple line: reservoir → P1 → N → valve V → M → P2 → reservoir ──
function line(v: Partial<Valve>, opt: { H1?: number; H2?: number; demandM?: number; dur?: number; ev?: Network['event'] } = {}): Network {
  return {
    name: 'line',
    nodes: [
      { id: 'R1', kind: 'reservoir', x: 0, y: 0, elev: 0, head: opt.H1 ?? 100 },
      { id: 'N', kind: 'junction', x: 1000, y: 0, elev: 0, demand: 0 },
      { id: 'M', kind: 'junction', x: 1001, y: 0, elev: 0, demand: opt.demandM ?? 0 },
      { id: 'R2', kind: 'reservoir', x: 2000, y: 0, elev: 0, head: opt.H2 ?? 40 },
    ],
    pipes: [
      { id: 'P1', from: 'R1', to: 'N', length: 1000, diameter: 0.3, roughness: 0.05, wavespeed: 1000 },
      { id: 'P2', from: 'M', to: 'R2', length: 1000, diameter: 0.3, roughness: 0.05, wavespeed: 1000 },
    ],
    pumps: [],
    valves: [{ id: 'V', from: 'N', to: 'M', diameter: 0.3, k0: 0.5, opening: 1, ...v }],
    event: opt.ev ?? { kind: 'none', targets: [], start: 1 },
    settings: { ...defaultSettings(), duration: opt.dur ?? 10, unsteadyFriction: false, pressureDependentDemand: false },
  };
}
{
  for (const law of ['gate', 'butterfly', 'ball'] as const) {
    const net = line({ law, opening: 0.5 });
    const r = runTransient(net, { frames: 200 });
    const drift = Math.max(...['N', 'M'].map((id) => Math.max(...r.nodeHead[id]) - Math.min(...r.nodeHead[id])));
    const st = solveSteady(net);
    t(`${law} valve part-open: steady uses the curve (area ${valveArea({ law }, 0.5).toFixed(3)}) and the transient starts without a jump`, drift < 1e-6 && Math.abs(st.openings.get('V')! - valveArea({ law }, 0.5)) < 1e-12, `drift ${drift.toExponential(1)} m`);
  }
}

// ── control valves in the steady state ──
{
  const prv = solveSteady(line({ control: { type: 'PRV', set: 50 } }, { H2: 10 }));
  const pM = prv.heads.get('M')!;
  t('PRV: downstream pressure held at the set point (50 m)', Math.abs(pM - 50) < 1e-3, `${pM.toFixed(5)} m, opening ${prv.openings.get('V')!.toFixed(4)}`);
  const psv = solveSteady(line({ control: { type: 'PSV', set: 80 } }, { H2: 10 }));
  t('PSV: upstream pressure held at the set point (80 m)', Math.abs(psv.heads.get('N')! - 80) < 1e-3, `${psv.heads.get('N')!.toFixed(5)} m`);
  const fcv = solveSteady(line({ control: { type: 'FCV', set: 0.05 } }, { H2: 10 }));
  t('FCV: flow held at the set point (50 L/s)', Math.abs(fcv.flows.get('V')! - 0.05) < 1e-6, `${(fcv.flows.get('V')! * 1000).toFixed(4)} L/s`);
  const open = solveSteady(line({ control: { type: 'PRV', set: 95 } }, { H2: 10 }));
  t('PRV that cannot reach its set point is fully open, with a warning', open.openings.get('V') === 1 && open.warnings.some((w) => w.includes('fully open')));
  // transient: locked = constant opening; active with no disturbance = no drift
  const locked = runTransient(line({ control: { type: 'PRV', set: 50 } }, { H2: 10 }), { frames: 100 });
  const op = locked.valves.V.opening;
  t('PRV locked: opening constant and no drift', Math.max(...op) - Math.min(...op) < 1e-12 && Math.max(...locked.nodeHead.M) - Math.min(...locked.nodeHead.M) < 1e-6);
  const act = runTransient(line({ control: { type: 'PRV', set: 50, active: true, responseTime: 1, strokeTime: 5 } }, { H2: 10 }), { frames: 100 });
  t('PRV active, no disturbance: holds its steady opening', Math.max(...act.nodeHead.M) - Math.min(...act.nodeHead.M) < 1e-4);
}
{
  // active PRV after a disturbance: a downstream valve partly closes; a locked PRV lets the pressure rise,
  // an active one brings it back to the set pressure
  const mk = (active: boolean): Network => {
    const n = line({ control: { type: 'PRV', set: 50, active, responseTime: 1, strokeTime: 5 } }, { H2: 10, dur: 80 });
    n.nodes.push({ id: 'Q', kind: 'junction', x: 1500, y: 0, elev: 0, demand: 0 });
    n.pipes[1] = { ...n.pipes[1], to: 'Q' };
    n.valves.push({ id: 'V2', from: 'Q', to: 'R2', diameter: 0.3, k0: 0.5, opening: 1 });
    n.event = { kind: 'valveClose', targets: ['V2'], start: 2, duration: 2, finalOpening: 0.15 };
    return n;
  };
  const a = runTransient(mk(true), { frames: 400 }), l = runTransient(mk(false), { frames: 400 });
  const end = (r: typeof a) => r.nodeHead.M[r.nodeHead.M.length - 1];
  t('PRV active: downstream pressure returns to the set point after the disturbance', Math.abs(end(a) - 50) < 0.3 && Math.abs(end(l) - 50) > 3, `active ${end(a).toFixed(2)} m, locked ${end(l).toFixed(2)} m`);
}

// ── valve operating curve ──
{
  const curve: [number, number][] = [[0, 1], [2, 0.3], [6, 0.1], [10, 0]];
  const r = runTransient(line({}, { dur: 15, ev: { kind: 'valveClose', targets: ['V'], start: 1, curve } }), { frames: 1500 });
  let worst = 0;
  r.times.forEach((tt, k) => { if (tt > 1) worst = Math.max(worst, Math.abs(r.valves.V.opening[k] - interpTable(curve, tt - 1))); });
  t('valve operating curve: opening follows the time–stroke table', worst < 1e-6, `worst ${worst.toExponential(1)}`);
  t('valve operating curve: fully closed at the end, no flow', r.valves.V.opening.at(-1)! === 0 && Math.abs(r.valves.V.flow.at(-1)!) < 1e-12);
}

// ── pump start ──
function pumpLine(cv: CheckValveSpec | undefined, opt: { ev?: Network['event']; dur?: number; inertia?: number; pipeCheck?: CheckValveSpec; suction?: number } = {}): Network {
  const pump: Pump = { id: 'PU', from: 'S', to: 'D', curve: [[0, 80], [0.25, 60], [0.4, 30]], efficiency: 0.8, speed: 1480, inertia: opt.inertia ?? 5, checkValve: !opt.pipeCheck, checkSpec: cv, on: true };
  return {
    name: 'trip',
    nodes: [
      { id: 'W', kind: 'reservoir', x: 0, y: 0, elev: 0, head: 10 },
      { id: 'S', kind: 'junction', x: 10, y: 0, elev: 0, demand: 0 },
      { id: 'D', kind: 'junction', x: 20, y: 0, elev: 0, demand: 0 },
      { id: 'T', kind: 'reservoir', x: 3000, y: 0, elev: 40, head: 45 },
    ],
    pipes: [
      { id: 'SUC', from: 'W', to: 'S', length: opt.suction ?? 10, diameter: 0.5, roughness: 0.1, wavespeed: 1000 },
      { id: 'MAIN', from: 'D', to: 'T', length: 3000, diameter: 0.5, roughness: 0.1, wavespeed: 1000, checkValve: opt.pipeCheck },
    ],
    pumps: [pump],
    valves: [],
    event: opt.ev ?? { kind: 'pumpTrip', targets: ['PU'], start: 1 },
    settings: { ...defaultSettings(), duration: opt.dur ?? 40, unsteadyFriction: false },
  };
}
{
  const net = pumpLine(undefined, { ev: { kind: 'pumpTrip', targets: ['PU'], start: 1, pumpMode: 'start', duration: 5 }, dur: 120 });
  const r = runTransient(net, { frames: 1200 });
  const qRun = solveSteady({ ...net, event: { kind: 'none', targets: [], start: 0 } }).flows.get('PU')!;
  const q = r.pumps.PU.flow;
  t('pump start: no flow before the start (pump off in steady state)', Math.abs(r.steady.flows.PU) < 1e-12 && Math.abs(q[5]) < 1e-12);
  t('pump start: speed reaches 100 % after the ramp time', Math.abs(r.pumps.PU.speed[Math.round(1200 * 7 / 120)] - 1) < 1e-9);
  t('pump start: settles at the running duty point', rel(q[q.length - 1], qRun) < 0.01, `${(q[q.length - 1] * 1000).toFixed(1)} vs ${(qRun * 1000).toFixed(1)} L/s`);
  t('pump start: check valve opens only once the pump head exceeds the line', r.checkValves.PU.flow.every((v) => v >= -1e-12));
}
{
  // motor start: speed from the motor torque curve and the inertia; star–delta and soft starters are slower
  const run = (motor: import('../src/engine/types').MotorStart) => {
    const net = pumpLine(undefined, { ev: { kind: 'pumpTrip', targets: ['PU'], start: 1, pumpMode: 'start', duration: 5 }, dur: 120 });
    net.pumps[0] = { ...net.pumps[0], motor };
    return runTransient(net, { frames: 1200 });
  };
  const net0 = pumpLine(undefined, { ev: { kind: 'pumpTrip', targets: ['PU'], start: 1, pumpMode: 'start', duration: 5 }, dur: 120 });
  const qRun = solveSteady({ ...net0, event: { kind: 'none', targets: [], start: 0 } }).flows.get('PU')!;
  const tTo = (r: ReturnType<typeof run>, f: number) => { const s = r.pumps.PU.speed; const k = Array.from(s).findIndex((v) => v >= f); return k < 0 ? Infinity : r.times[k]; };
  const dol = run({ starter: 'dol' }), sd = run({ starter: 'starDelta' }), soft = run({ starter: 'soft', softRamp: 15 });
  const sp = Array.from(dol.pumps.PU.speed);
  t('motor start (DOL): runs up to about rated speed', Math.abs(sp[sp.length - 1] - 1) < 0.03, `${(sp[sp.length - 1] * 100).toFixed(1)} %`);
  t('motor start (DOL): settles at the running duty', rel(dol.pumps.PU.flow[sp.length - 1], qRun) < 0.03);
  t('motor start: run-up time follows the inertia (DOL faster than star–delta and soft start)', tTo(dol, 0.9) < tTo(sd, 0.9) && tTo(dol, 0.9) < tTo(soft, 0.9), `to 90 %: DOL ${(tTo(dol, 0.9) - 1).toFixed(2)} s, star–delta ${(tTo(sd, 0.9) - 1).toFixed(2)} s, soft ${(tTo(soft, 0.9) - 1).toFixed(2)} s`);
  t('motor start: speed never exceeds synchronous', Math.max(...sp) < 1.03);
  t('motor start: check valve never passes reverse flow', dol.checkValves.PU.flow.every((v) => v >= -1e-12));
  const rigidNet = pumpLine(undefined, { ev: { kind: 'pumpTrip', targets: ['PU'], start: 1, pumpMode: 'start', duration: 5 }, dur: 120 });
  rigidNet.pumps[0] = { ...rigidNet.pumps[0], motor: { starter: 'starDelta' } };
  rigidNet.settings = { ...rigidNet.settings, engine: 'rigid' };
  const rr = runTransient(rigidNet, { frames: 1200 });
  const srr = Array.from(rr.pumps.PU.speed);
  t('motor start in the rigid-column engine: same final speed and similar run-up', Math.abs(srr[srr.length - 1] - sp[sp.length - 1]) < 0.01 && Math.abs(tTo(rr as never, 0.9) - tTo(sd, 0.9)) < 0.5, `to 90 %: ${(tTo(rr as never, 0.9) - 1).toFixed(2)} s vs ${(tTo(sd, 0.9) - 1).toFixed(2)} s`);
}

// ── check valves ──
{
  // ideal check on the pump: no reverse flow, no slam
  const r = runTransient(pumpLine(undefined), { frames: 2000 });
  t('ideal check valve (pump): flow never reverses, no slam', Math.min(...r.pumps.PU.flow) >= -1e-12 && r.slams.length === 0);
  // ideal check valve on the pipe instead: same physics (with its open loss) — flow never reverses
  const rp = runTransient(pumpLine(undefined, { pipeCheck: { mode: 'ideal', kOpen: 0.5 } }), { frames: 2000 });
  t('ideal check valve on a pipe: flow in the pipe never reverses', Math.min(...rp.checkValves.MAIN.flow) >= -1e-12 && rp.checkValves.MAIN.where === 'pipe');
  const st = solveSteady(pumpLine(undefined, { pipeCheck: { mode: 'ideal', kOpen: 2 } }));
  const q = st.flows.get('MAIN')!, A = area(0.5);
  const dh = st.heads.get('D')! - st.heads.get('D~MAIN')!;
  t('pipe check valve: steady head loss = K·v²/2g', rel(dh, (2 * (q / A) ** 2) / (2 * G)) < 1e-6, `${dh.toFixed(5)} m`);
}
{
  // reverse-velocity closure: the disc slams at 0.3 m/s reverse velocity → surge a·v/g
  const vr = 0.3;
  // fine time step: the slam is resolved within one or two steps
  const r = runTransient(pumpLine({ mode: 'velocity', reverseVelocity: vr, closeTime: 0, kOpen: 1 }, { inertia: 2 }), { frames: 4000, dtMax: 0.002 });
  const cv = r.checkValves.PU;
  const s = r.slams.find((x) => x.kind === 'checkValve');
  t('check valve (reverse velocity): closes once, at ≥ the set reverse velocity', cv.closures >= 1 && cv.reverseVelocityAtClosure >= vr - 1e-9 && cv.reverseVelocityAtClosure < vr + 0.01, `${cv.reverseVelocityAtClosure.toFixed(3)} m/s`);
  t('check valve slam: computed head rise = a·v/g (Joukowsky)', !!s && rel(s.rise, s.joukowsky) < 0.05, s ? `${s.rise.toFixed(2)} vs ${s.joukowsky.toFixed(2)} m` : 'no slam');
  t('check valve slam: peak after the slam reported (≥ the jump)', !!s && s.peak >= s.rise + r.steady.heads.D * 0 - 1e-9 && s.peak > 0);
  // closing time: a slower disc lets more reverse flow through before it shuts
  const slow = runTransient(pumpLine({ mode: 'velocity', reverseVelocity: vr, closeTime: 0.5, kOpen: 1 }, { inertia: 2 }), { frames: 4000 });
  t('check valve closing time: more reverse velocity during the closure', slow.checkValves.PU.maxReverseVelocity > cv.maxReverseVelocity, `${cv.maxReverseVelocity.toFixed(3)} → ${slow.checkValves.PU.maxReverseVelocity.toFixed(3)} m/s`);
}
{
  // delay closure: shuts `delay` + `closeTime` after the flow reverses
  const delay = 0.4, ct = 0.2;
  const net = pumpLine({ mode: 'delay', delay, closeTime: ct, kOpen: 1 }, { inertia: 2 });
  const r = runTransient(net, { frames: 100000, dtMax: 0.002 });
  const f = r.checkValves.PU.flow, o = r.checkValves.PU.opening;
  const kShut = o.findIndex((v) => v === 0);
  const kStart = o.findIndex((v) => v < 1);
  // the reversal that led to this closure (earlier brief dips that recovered do not count)
  let kRev = -1;
  for (let k = 1; k <= kStart; k++) if (f[k] <= 0 && f[k - 1] > 0) kRev = k;
  const dtS = r.dt;
  t('check valve (delay): closure starts `delay` after the flow reverses', kRev > 0 && Math.abs(r.times[kStart] - r.times[kRev] - delay) < 2.5 * dtS, `${(r.times[kStart] - r.times[kRev]).toFixed(4)} s`);
  t('check valve (delay): fully shut `closeTime` later', Math.abs(r.times[kShut] - r.times[kStart] - ct) < 2.5 * dtS, `${(r.times[kShut] - r.times[kStart]).toFixed(4)} s`);
  // dynamic characteristic: reverse velocity at closure follows the curve for the deceleration seen
  const curve: [number, number][] = [[0, 0], [2, 0.2], [10, 0.6]];
  const rd = runTransient(pumpLine({ mode: 'dynamic', dynamic: curve, closeTime: 0, kOpen: 1 }, { inertia: 2, suction: 300 }), { frames: 100000, dtMax: 0.002 });
  const fd = rd.checkValves.PU.flow, A = area(0.5);
  const kS = rd.checkValves.PU.opening.findIndex((v) => v < 1);
  let k0 = -1;
  for (let k = 1; k <= kS; k++) if (fd[k] <= 0 && fd[k - 1] > 0) k0 = k;
  const nw = Math.max(2, Math.round(0.1 / rd.dt));
  const decel = (fd[k0 - nw] - fd[k0]) / A / (nw * rd.dt);
  const want = dynamicReverseVelocity(curve, decel);
  // it closes on the first step at or past that velocity, so allow one step's change in velocity
  let dvStep = 0;
  for (let k = k0; k < kS; k++) dvStep = Math.max(dvStep, Math.abs(fd[k] - fd[k - 1]) / A);
  const got = rd.checkValves.PU.reverseVelocityAtClosure;
  t('check valve (dynamic): closes at the reverse velocity the curve gives for the deceleration', rd.checkValves.PU.closures >= 1 && want > 0 && got >= want - 1e-9 && got <= want + dvStep + 1e-9, `decel ${decel.toFixed(3)} m/s² → ${want.toFixed(4)}, got ${got.toFixed(4)} m/s (one step ${dvStep.toFixed(4)})`);
  t('dynamic characteristic interpolation', Math.abs(dynamicReverseVelocity(curve, 6) - 0.4) < 1e-12 && dynamicReverseVelocity(curve, 20) === 0.6);
  // reopening needs the set head difference
  const re = runTransient(pumpLine({ mode: 'velocity', reverseVelocity: 0.1, closeTime: 0, openHead: 1e6 }, { inertia: 2 }), { frames: 2000 });
  t('check valve: stays shut when the reopening head is not reached', re.checkValves.PU.closures === 1 && re.checkValves.PU.flow.at(-1) === 0);
}
{
  // check valve on a valve link (pipe check modelled through the same code)
  const n = pumpLine(undefined, { inertia: 2, pipeCheck: { mode: 'velocity', reverseVelocity: 0.3, closeTime: 0, kOpen: 1 } });
  n.pumps[0].checkValve = false;
  const r = runTransient(n, { frames: 4000, dtMax: 0.002 });
  const s = r.slams.find((x) => x.id === 'MAIN');
  t('pipe check valve (reverse velocity): slam found and = a·v/g', !!s && rel(s.rise, s.joukowsky) < 0.05, s ? `${s.rise.toFixed(2)} vs ${s.joukowsky.toFixed(2)} m` : 'none');
}

{
  // two identical pumps in parallel are merged into one element only when their check valves are the same too
  const two = (spec2: CheckValveSpec | undefined) => {
    const n = pumpLine({ mode: 'velocity', reverseVelocity: 0.3, closeTime: 0 }, { inertia: 2 });
    n.pumps.push({ ...n.pumps[0], id: 'PU2', checkSpec: spec2 });
    n.event = { kind: 'pumpTrip', targets: ['PU', 'PU2'], start: 1 };
    return runTransient(n, { frames: 2000 });
  };
  const mixed = two(undefined);
  t('parallel pumps with different check valves stay separate', mixed.checkValves.PU.mode === 'velocity' && mixed.checkValves.PU2.mode === 'ideal' && mixed.checkValves.PU.closures >= 1 && Math.min(...mixed.pumps.PU2.flow) >= -1e-12);
  const same = two({ mode: 'velocity', reverseVelocity: 0.3, closeTime: 0 });
  t('parallel pumps with the same check valves behave identically', same.pumps.PU.flow.every((v, k) => v === same.pumps.PU2.flow[k]) && same.checkValves.PU2.closures === same.checkValves.PU.closures);
}

// ── air-valve slam on a hill ──
function hill(av: NetNode['airValve'], tHead = 80): Network {
  const pump: Pump = { id: 'PU', from: 'S', to: 'D', curve: [[0, 95], [0.2, 75], [0.32, 45]], efficiency: 0.8, speed: 1480, inertia: 2, checkValve: true, on: true };
  return {
    name: 'hill',
    nodes: [
      { id: 'W', kind: 'reservoir', x: 0, y: 0, elev: 0, head: 5 },
      { id: 'S', kind: 'junction', x: 10, y: 0, elev: 0, demand: 0 },
      { id: 'D', kind: 'junction', x: 20, y: 0, elev: 0, demand: 0 },
      { id: 'HP', kind: 'junction', x: 1500, y: 0, elev: 55, demand: 0, airValve: av },
      { id: 'T', kind: 'reservoir', x: 4000, y: 0, elev: 50, head: tHead },
    ],
    pipes: [
      { id: 'SUC', from: 'W', to: 'S', length: 10, diameter: 0.4, roughness: 0.1, wavespeed: 1000 },
      { id: 'UP', from: 'D', to: 'HP', length: 1500, diameter: 0.4, roughness: 0.1, wavespeed: 1000 },
      { id: 'DOWN', from: 'HP', to: 'T', length: 2500, diameter: 0.4, roughness: 0.1, wavespeed: 1000 },
    ],
    pumps: [pump],
    valves: [],
    event: { kind: 'pumpTrip', targets: ['PU'], start: 1 },
    settings: { ...defaultSettings(), duration: 40, unsteadyFriction: false },
  };
}
{
  const dbl = runTransient(hill({ inDiameter: 0.1, outDiameter: 0.1 }), { frames: 4000 });
  const s = dbl.slams.filter((x) => x.kind === 'airValve');
  const big = s.reduce((m, x) => (x.rise > m.rise ? x : m), s[0]);
  t('air-valve slam: pocket closure found after the trip', s.length >= 1 && big.velocity > 0.05, big ? `${big.velocity.toFixed(3)} m/s at ${big.t.toFixed(2)} s` : 'none');
  // on a fine time step the computed jump equals the junction Joukowsky rise a·(Σq/ΣA)/g
  const fine = runTransient(hill({ inDiameter: 0.1, outDiameter: 0.1 }), { frames: 4000, dtMax: 0.002 }).slams.filter((x) => x.kind === 'airValve' && x.velocity > 0.05)[0];
  t('air-valve slam: computed jump = a·v/g for the closing columns', !!fine && rel(fine.rise, fine.joukowsky) < 0.05, fine ? `${fine.rise.toFixed(1)} vs ${fine.joukowsky.toFixed(1)} m` : '');
  const ts = runTransient(hill({ inDiameter: 0.1, outDiameter: 0.1, type: 'threeStage', smallDiameter: 0.005, switchHead: 0.02 }), { frames: 4000 });
  const s3 = ts.slams.filter((x) => x.kind === 'airValve');
  const v3 = Math.max(0, ...s3.map((x) => x.velocity)), r3 = Math.max(0, ...s3.map((x) => x.rise));
  t('three-stage (anti-slam) valve: slower closure and smaller slam than double-acting', v3 < big.velocity && r3 < big.rise, `${big.velocity.toFixed(3)} → ${v3.toFixed(3)} m/s, rise ${big.rise.toFixed(1)} → ${r3.toFixed(1)} m`);
}

// ── discharge to atmosphere and rupture disk ──
{
  const net = line({}, { dur: 10 });
  net.nodes[1].outlet = { diameter: 0.1, cd: 0.6, trigger: 'time', time: 2, openTime: 1 };
  const r = runTransient(net, { frames: 100000 });
  const o = r.outlets.N, A = area(0.1);
  let worst = 0, vol = 0;
  r.times.forEach((tt, k) => {
    const want = 0.6 * A * Math.min(1, Math.max(0, tt - 2)) * Math.sqrt(2 * G * Math.max(r.nodeHead.N[k], 0));
    worst = Math.max(worst, Math.abs(o.flow[k] - want));
    if (k > 0) vol += ((o.flow[k] + o.flow[k - 1]) / 2) * (tt - r.times[k - 1]);
  });
  t('outlet (timed): Q = Cd·A·opening·√(2g·p), opening ramps over the opening time', worst < 1e-6 && o.maxFlow > 0.01 && o.openedAt === 2, `max ${(o.maxFlow * 1000).toFixed(1)} L/s`);
  t('outlet: discharged volume = ∫Q dt', rel(o.volume, vol) < 2e-3, `${o.volume.toFixed(4)} m³`);
  // rupture disk bursts when the pressure first reaches the bursting pressure
  const closeNet = line({}, { dur: 10, ev: { kind: 'valveClose', targets: ['V'], start: 1, duration: 0.2, finalOpening: 0 } });
  const bare = runTransient(closeNet, { frames: 10000 });
  const burst = bare.steady.heads.N + 20;
  closeNet.nodes[1].outlet = { diameter: 0.15, cd: 0.6, trigger: 'pressure', burstHead: burst, openTime: 0 };
  const rd = runTransient(closeNet, { frames: 10000 });
  const kFirst = bare.nodeHead.N.findIndex((h) => h >= burst);
  t('rupture disk: bursts when the pressure reaches the bursting pressure', Math.abs(rd.outlets.N.openedAt - bare.times[kFirst]) < 2 * rd.dt, `${rd.outlets.N.openedAt.toFixed(4)} s`);
  t('rupture disk: limits the peak', rd.nodeMax.N < bare.nodeMax.N - 5, `${bare.nodeMax.N.toFixed(1)} → ${rd.nodeMax.N.toFixed(1)} m`);
}

// ── determinism ──
{
  const n = pumpLine({ mode: 'dynamic', dynamic: [[0, 0], [5, 0.5]], closeTime: 0.1 }, { inertia: 2 });
  const a = runTransient(n, { frames: 500 }), b = runTransient(n, { frames: 500 });
  t('repeat runs give identical results', a.nodeMax.D === b.nodeMax.D && a.slams.length === b.slams.length && a.checkValves.PU.flow.every((v, k) => v === b.checkValves.PU.flow[k]));
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
