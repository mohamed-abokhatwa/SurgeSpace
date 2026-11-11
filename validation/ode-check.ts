// Independent check: the differential surge tank and the motor start against the same physics integrated as
// ordinary differential equations by SciPy (validation/ode_reference.py), with no shared code.
//   npx tsx validation/ode-check.ts     (needs python3 with scipy)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { solveSteady } from '../src/engine/steady';
import { runTransient, type TransientResult } from '../src/engine/transient';
import { pumpCurve, pumpRatedQ, pumpTorqueQuadratic, omegaRated } from '../src/engine/hydraulics';
import { DEFAULT_MOTOR_CURVE } from '../src/engine/devices';
import { NU, defaultSettings, type Network, type Pump } from '../src/engine/types';

const interp = (ts: number[], ys: number[], t: number) => { if (t <= ts[0]) return ys[0]; for (let i = 1; i < ts.length; i++) if (t <= ts[i]) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (t - ts[i - 1])) / (ts[i] - ts[i - 1]); return ys[ys.length - 1]; };

// ── differential surge tank ──
const tunnel = { L: 2000, D: 1.5, eps: 0.0001 };
const tankNet = (engine: 'wave' | 'rigid'): Network => ({
  name: 'differential tank', nodes: [
    { id: 'R', kind: 'reservoir', x: 0, y: 0, elev: 50, head: 100 },
    { id: 'ST', kind: 'junction', x: 2000, y: 0, elev: 40, tank: { diameter: 8, bottomElev: 30, topElev: 200, connDiameter: 3, kIn: 0, kOut: 0, differential: { riserDiameter: 3, riserTop: 200, portArea: 0.6, portCd: 0.6 } } },
    { id: 'V', kind: 'junction', x: 2050, y: 0, elev: 0 },
    { id: 'OUT', kind: 'reservoir', x: 2100, y: 0, elev: 0, head: 0 },
  ],
  pipes: [
    { id: 'T', from: 'R', to: 'ST', length: tunnel.L, diameter: tunnel.D, roughness: tunnel.eps, wavespeed: 1200 },
    { id: 'PS', from: 'ST', to: 'V', length: 50, diameter: 1.2, roughness: 0.0001, wavespeed: 1200 },
  ],
  pumps: [], valves: [{ id: 'VL', from: 'V', to: 'OUT', diameter: 1.2, k0: 20, opening: 1 }],
  event: { kind: 'valveClose', targets: ['VL'], start: 0.1, duration: 0.2 },
  settings: { ...defaultSettings(), duration: 200, unsteadyFriction: false, engine },
});
const st = solveSteady(tankNet('wave'));
// ── motor start (direct on line) ──
const pump: Pump = { id: 'PU', from: 'S', to: 'D', curve: [[0, 80], [0.25, 60], [0.4, 30]], efficiency: 0.8, speed: 1480, inertia: 5, checkValve: true, on: true, motor: { starter: 'dol' } };
const pumpNet = (engine: 'wave' | 'rigid'): Network => ({
  name: 'motor start', nodes: [
    { id: 'W', kind: 'reservoir', x: 0, y: 0, elev: 0, head: 10 }, { id: 'S', kind: 'junction', x: 10, y: 0, elev: 0 },
    { id: 'D', kind: 'junction', x: 20, y: 0, elev: 0 }, { id: 'T', kind: 'reservoir', x: 3000, y: 0, elev: 40, head: 45 },
  ],
  pipes: [{ id: 'SUC', from: 'W', to: 'S', length: 10, diameter: 0.5, roughness: 0.1, wavespeed: 1000 }, { id: 'MAIN', from: 'D', to: 'T', length: 3000, diameter: 0.5, roughness: 0.1, wavespeed: 1000 }],
  pumps: [pump], valves: [], event: { kind: 'pumpTrip', targets: ['PU'], start: 1, pumpMode: 'start', duration: 5 },
  settings: { ...defaultSettings(), duration: 40, unsteadyFriction: false, engine },
});
const tq = pumpTorqueQuadratic(pump), qr = pumpRatedQ(pump);
const c = pumpCurve(pump);
// EPANET's three-point pump curve h0 − B·q^C (what the engines use)
const [[, h0], [q1, h1], [q2, h2]] = pump.curve;
const Cexp = Math.log((h0 - h2) / (h0 - h1)) / Math.log(q2 / q1), Bc = (h0 - h1) / q1 ** Cexp;
const quadOk = [0, 0.1, 0.25, 0.35].every((x) => Math.abs(c.h(x) - (h0 - Bc * x ** Cexp)) < 1e-9);

const spec = {
  diffTank: { kind: 'diffTank', nu: NU, tunnel, H0: 100, Q0: st.flows.get('T')!, z0: st.heads.get('ST')!, riserD: 3, outerD: 8, port: 0.6, cd: 0.6, T: 199, dtOut: 0.25 },
  motor: { kind: 'motor', nu: NU, pipes: [{ L: 10, D: 0.5, eps: 0.1 }, { L: 3000, D: 0.5, eps: 0.1 }], Hs: 10, Hd: 45, pump: { h0, B: Bc, C: Cexp, ta: tq.ta, tb: tq.tb, tc: tq.tc }, motorCurve: DEFAULT_MOTOR_CURVE, Tr: tq.ta + tq.tb * qr + tq.tc * qr * qr, I: 5, w: omegaRated(pump), T: 38, dtOut: 0.02 },
};
const dir = mkdtempSync(join(tmpdir(), 'ss-ode-'));
writeFileSync(join(dir, 'spec.json'), JSON.stringify(spec));
execFileSync('python3', [new URL('./ode_reference.py', import.meta.url).pathname, join(dir, 'spec.json'), join(dir, 'out.json')], { stdio: 'inherit' });
const ref = JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8'));

export const results: Record<string, number> = {};
const lines: string[] = [];
for (const engine of ['wave', 'rigid'] as const) {
  const r: TransientResult = runTransient(tankNet(engine), { steady: st, frames: 2000 });
  const tt = Array.from(r.times), lv = Array.from(r.tanks.ST.level), ch = Array.from(r.tanks.ST.chamber!.level);
  const shift = 0.2; // closure mid-time in the engine run; instantaneous at t = 0 in the ODE
  let dMax = 0, dCh = 0;
  ref.diffTank.t.forEach((t: number, k: number) => { if (t < 2) return; dMax = Math.max(dMax, Math.abs(interp(tt, lv, t + shift) - ref.diffTank.riser[k])); dCh = Math.max(dCh, Math.abs(interp(tt, ch, t + shift) - ref.diffTank.chamber[k])); });
  const upE = Math.max(...lv) - st.heads.get('ST')!, upR = Math.max(...ref.diffTank.riser) - st.heads.get('ST')!;
  results[`diff.${engine}.upsurge`] = Math.abs(upE - upR) / upR;
  results[`diff.${engine}.history`] = dMax;
  lines.push(`differential tank, ${engine}: upsurge ${upE.toFixed(3)} m vs ODE ${upR.toFixed(3)} m (${(100 * Math.abs(upE - upR) / upR).toFixed(2)} %); riser history within ${dMax.toFixed(3)} m, chamber within ${dCh.toFixed(3)} m over 200 s`);
}
for (const engine of ['rigid', 'wave'] as const) {
  const r = runTransient(pumpNet(engine), { frames: 2000 });
  const tt = Array.from(r.times).map((x) => x - 1), sp = Array.from(r.pumps.PU.speed), fl = Array.from(r.pumps.PU.flow);
  const to90 = (ts: number[], ys: number[]) => ts[ys.findIndex((v) => v >= 0.9)];
  const tE = to90(tt, sp), tR = to90(ref.motor.t, ref.motor.speed);
  const qE = fl[fl.length - 1], qR = ref.motor.Q[ref.motor.Q.length - 1];
  let dS = 0; ref.motor.t.forEach((t: number, k: number) => { if (t > 0 && t < 30) dS = Math.max(dS, Math.abs(interp(tt, sp, t) - ref.motor.speed[k])); });
  results[`motor.${engine}.t90`] = Math.abs(tE - tR);
  results[`motor.${engine}.flow`] = Math.abs(qE - qR) / qR;
  results[`motor.${engine}.speed`] = dS;
  lines.push(`motor start, ${engine}: time to 90 % speed ${tE.toFixed(3)} s vs ODE ${tR.toFixed(3)} s; final flow ${(qE * 1000).toFixed(1)} vs ${(qR * 1000).toFixed(1)} L/s; speed history within ${(dS * 100).toFixed(2)} %`);
}
lines.push(`pump curve used by the ODE matches the engine's: ${quadOk}`);
if (import.meta.url === `file://${process.argv[1]}`) console.log(lines.join('\n'));
export const report = lines;
if (process.argv.includes('--debug')) {
  for (const engine of ['rigid', 'wave'] as const) {
    const r = runTransient(pumpNet(engine), { frames: 4000 });
    const tt = Array.from(r.times).map((x) => x - 1), sp = Array.from(r.pumps.PU.speed);
    console.log(engine, 'dt', r.dt, [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.7, 1, 2].map((t) => `${t}: ${interp(tt, sp, t).toFixed(3)}/${interp(ref.motor.t, ref.motor.speed, t).toFixed(3)}`).join('  '));
  }
}
if (process.argv.includes('--assert')) {
  const limits: Record<string, number> = { 'diff.wave.upsurge': 0.01, 'diff.rigid.upsurge': 0.01, 'diff.wave.history': 0.15, 'diff.rigid.history': 0.15, 'motor.rigid.t90': 0.02, 'motor.wave.t90': 0.05, 'motor.rigid.flow': 0.005, 'motor.wave.flow': 0.01, 'motor.rigid.speed': 0.01, 'motor.wave.speed': 0.03 };
  const bad = Object.entries(limits).filter(([k, v]) => !(results[k] <= v));
  console.log(bad.length ? `FAIL ${bad.map(([k]) => `${k} = ${results[k]}`).join(', ')}` : 'PASS all within limits');
  process.exit(bad.length ? 1 : 0);
}
