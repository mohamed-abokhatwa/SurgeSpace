// Tests for the v2 engine additions and the workspace logic:
//  • several operations in one run (each element follows its own operation; a single operation gives the
//    same result as before);
//  • liquid and site: default settings unchanged; vapour pressure and atmospheric head follow the settings;
//  • reservoir head schedule: steady state unchanged, the boundary follows the sine exactly;
//  • editing operations (add, connect, split, insert, delete, rename) keep the model consistent;
//  • unit conversions round-trip; wave speed calculator matches Korteweg; model health check finds faults.
import { gravityValve, hydroPlant, risingMain } from '../src/engine/cases';
import { turbineK, turbineSpeeds } from '../src/engine/analysis';
import { buildReport } from '../src/report/report';
import { designChecks } from '../src/engine/analysis';
import { solveSteady } from '../src/engine/steady';
import { runTransient, schedHead } from '../src/engine/transient';
import { HB, HV, applyFluid, barometricHead, type Network } from '../src/engine/types';
import { addNode, addPipe, deleteElements, insertOnPipe, renameElement, splitPipe, pipeLengthFromDrawing } from '../src/app/edit';
import { FLUIDS, waveSpeed, PIPE_MATERIALS } from '../src/app/catalogues';
import { toShow, fromShow } from '../src/app/units';
import { healthCheck } from '../src/app/health';
import { computeContours } from '../src/app/contours';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };
const maxOf = (r: ReturnType<typeof runTransient>) => Math.max(...Object.values(r.nodeMax));

// ── several operations ──
{
  const base = gravityValve();
  const r1 = runTransient(base, { envelopeOnly: true });
  const same = runTransient({ ...base, extraEvents: [] }, { envelopeOnly: true });
  t('empty extra operations: identical result', JSON.stringify(r1.nodeMax) === JSON.stringify(same.nodeMax));
  // split the valve's closure: main event closes it; an extra event naming the same valve is ignored (first wins)
  const dup = runTransient({ ...base, extraEvents: [{ ...base.event, duration: 60 }] }, { envelopeOnly: true });
  t('an element follows the first operation that names it', JSON.stringify(r1.nodeMax) === JSON.stringify(dup.nodeMax));
  // rising main: trip one pump in the main event and the other later in an extra event
  const rm = risingMain(true);
  const both = runTransient(rm, { envelopeOnly: true });
  const staggered = runTransient({ ...rm, event: { ...rm.event, targets: ['PU1'] }, extraEvents: [{ kind: 'pumpTrip', targets: ['PU2'], start: 4 }] }, { envelopeOnly: true });
  const one = runTransient({ ...rm, event: { ...rm.event, targets: ['PU1'] } }, { envelopeOnly: true });
  const minP = (r: ReturnType<typeof runTransient>) => Math.min(...rm.nodes.filter((n) => n.kind === 'junction').map((n) => r.nodeMin[n.id] - n.elev));
  t('staggered trip lies between one-pump and two-pump trips (min pressure)', minP(staggered) <= minP(one) + 1e-6 && minP(staggered) >= minP(both) - 1e-6, `${minP(both).toFixed(2)} ≤ ${minP(staggered).toFixed(2)} ≤ ${minP(one).toFixed(2)}`);
  t('second operation changes the result', Math.abs(minP(staggered) - minP(one)) > 0.1);
}

// ── liquid and site ──
{
  applyFluid(undefined);
  t('default fluid: HB 10.33, HV 0.24 (unchanged)', HB === 10.33 && HV === 0.24);
  applyFluid({ siteElevation: 1500 });
  t('site at 1500 m lowers the atmospheric head', Math.abs(HB - barometricHead(1500)) < 1e-12 && HB < 8.8 && HB > 8.3, HB.toFixed(3));
  const w60 = FLUIDS.find((f) => f.temperature === 60)!;
  applyFluid({ fluid: w60 });
  t('water at 60 °C: vapour head ≈ 2.0 m', Math.abs(HV - 2.03) < 0.1, HV.toFixed(3));
  applyFluid(undefined);
  const g = gravityValve();
  const hot = runTransient({ ...g, settings: { ...g.settings, fluid: w60 } }, { envelopeOnly: true });
  t('hot water run completes', Number.isFinite(maxOf(hot)));
  const cold = runTransient(g, { envelopeOnly: true });
  applyFluid(undefined);
  t('defaults restored after a fluid run', HB === 10.33 && HV === 0.24 && Number.isFinite(maxOf(cold)));
}

// ── reservoir head schedule ──
{
  const g = gravityValve();
  const resId = g.nodes.find((n) => n.kind === 'reservoir')!.id;
  const sch = { mode: 'sine' as const, amplitude: 2, period: 8, phase: 0 };
  const g2: Network = { ...g, event: { kind: 'none', targets: [], start: 0 }, nodes: g.nodes.map((n) => (n.id === resId ? { ...n, headSchedule: sch } : n)) };
  const s1 = solveSteady({ ...g, event: { kind: 'none', targets: [], start: 0 } }), s2 = solveSteady(g2);
  t('head schedule leaves the steady state unchanged', Math.abs(s1.heads.get(resId)! - s2.heads.get(resId)!) < 1e-12);
  const r = runTransient(g2, { frames: 400 });
  const h = r.nodeHead[resId];
  let worst = 0;
  const H0 = g.nodes.find((n) => n.id === resId)!.head!;
  r.times.forEach((tt, k) => { worst = Math.max(worst, Math.abs(h[k] - (H0 + schedHead(sch, tt)))); });
  t('reservoir head follows the sine', worst < 1e-3, `worst ${worst.toExponential(2)} m`);
  t('table schedule interpolates', schedHead({ mode: 'table', table: [[0, 0], [10, 5]] }, 4) === 2);
}

// ── editing ──
{
  let n = risingMain(true);
  const before = n.pipes.length;
  const sp = splitPipe(n, 'M2', 0.5);
  n = sp.net;
  t('split pipe: one more pipe, lengths add up', n.pipes.length === before + 1 && Math.abs(n.pipes.filter((p) => p.id === 'M2' || p.id === sp.newPipe).reduce((s, p) => s + p.length, 0) - 1400) < 1e-9);
  const ins = insertOnPipe(n, 'M1', 'valve', 0.3);
  n = ins.net;
  t('insert valve on a pipe: valve links the two halves', n.valves.some((v) => v.id === ins.id) && n.pipes.length === before + 2);
  const a = addNode(n, { x: 1000, y: 0 }, 'junction');
  n = a.net;
  const p = addPipe(n, 'TANK', a.id, [{ x: 980, y: 40 }]);
  n = p.net;
  t('add node + pipe with a bend', n.pipes.find((x) => x.id === p.id)?.vertices?.length === 1);
  t('drawn length uses the bends', Math.abs(pipeLengthFromDrawing(n, n.pipes.find((x) => x.id === p.id)!) - 2 * Math.hypot(20, 40)) < 1e-9);
  const rn = renameElement(n, 'node', 'HP2600', 'HIGH-PT');
  t('rename node updates pipes and events', rn.ok && rn.net.pipes.some((x) => x.to === 'HIGH-PT') && !rn.net.pipes.some((x) => x.to === 'HP2600' || x.from === 'HP2600'));
  const rp = renameElement(rn.net, 'pump', 'PU1', 'P-A');
  t('rename pump updates the event targets', rp.ok && rp.net.event.targets.includes('P-A'));
  const del = deleteElements(rp.net, [{ type: 'node', id: 'HIGH-PT' }]);
  t('delete node removes connected pipes', !del.pipes.some((x) => x.from === 'HIGH-PT' || x.to === 'HIGH-PT') && !del.nodes.some((x) => x.id === 'HIGH-PT'));
}

// ── units, catalogues, health ──
{
  t('units: 100 L/s ↔ gpm round trip', Math.abs(fromShow(toShow(0.1, 'flow', 'US'), 'flow', 'US') - 0.1) < 1e-12 && Math.abs(toShow(0.1, 'flow', 'US') - 1585.03) < 0.1);
  t('units: 10 m → 32.81 ft', Math.abs(toShow(10, 'length', 'US') - 32.8084) < 1e-3);
  t('units: 100 m head → psi', Math.abs(toShow(100, 'pressureHead', 'US') - 141.9) < 0.3);
  const di = PIPE_MATERIALS.find((m) => m.id === 'di')!;
  const a = waveSpeed({ D: 0.6, e: 0.0099, E: di.E, nu: di.poisson, K: 2.19, rho: 998.2, restraint: 'anchoredJoints' });
  t('wave speed: DN600 ductile iron ≈ 1100–1250 m/s', a > 1050 && a < 1300, a.toFixed(0));
  const rigid = waveSpeed({ D: 0.6, e: 1, E: 200, nu: 0.3, K: 2.19, rho: 998.2, restraint: 'anchoredJoints' });
  t('wave speed: very thick wall tends to the sound speed in water', Math.abs(rigid - Math.sqrt(2.19e9 / 998.2)) / 1481 < 0.02, rigid.toFixed(0));
  const okNet = healthCheck(risingMain(true));
  t('health check: example model has no errors', okNet.filter((i) => i.level === 'error').length === 0, okNet.map((i) => i.title).join('; '));
  const bad = risingMain(true);
  bad.pipes.push({ id: 'BAD', from: 'NOPE', to: 'TANK', length: 0, diameter: 0.3, roughness: 0.1, wavespeed: 1000 });
  bad.nodes.push({ id: 'ORPHAN', kind: 'junction', x: 0, y: 0, elev: 0 });
  const iss = healthCheck(bad);
  t('health check: finds missing node, zero length and orphan', iss.some((i) => i.title.includes('missing node')) && iss.some((i) => i.title.includes('length')) && iss.some((i) => i.title.toLowerCase().includes('not connected')));
}

// ── contours ──
{
  const pts = [];
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) pts.push({ x: i * 10, y: j * 10, v: i * 10 });
  const c = computeContours(pts, { levels: [25, 55] })!;
  const ok = c.segs.every((g) => Math.abs(g.x1 - c.levels[g.k]) < 0.6 && Math.abs(g.x2 - c.levels[g.k]) < 0.6);
  t('contours of a plane are straight lines at the right place', c.segs.length > 20 && ok);
}

// ── turbine ──
{
  const h = hydroPlant();
  const v = h.valves[0];
  const K = turbineK(v.turbine!, v.diameter);
  t('turbine gate K passes the rated flow at the rated head', Math.abs(K - v.k0) / K < 0.01);
  const r = runTransient(h, { frames: 400 });
  const run = turbineSpeeds(h, r)[0];
  t('turbine: load rejection speeds the runner up, then it slows', run.maxSpeed > 1.05 && run.maxSpeed < 1.8 && run.speed[run.speed.length - 1] < run.maxSpeed, `peak ${(run.maxSpeed * 100).toFixed(1)} %`);
  t('turbine: speed is synchronous before the rejection', run.speed[0] === 1 && Math.abs(run.power[0] - (998.2 * 9.80665 * r.steady.flows['TU-1'] * (r.steady.heads['INLET'] - r.steady.heads['OUTLET']) * 0.9) / 1000) < 5);
  const slow = runTransient({ ...h, event: { ...h.event, duration: 20 } }, { frames: 400 });
  const runSlow = turbineSpeeds({ ...h, event: { ...h.event, duration: 20 } }, slow)[0];
  t('turbine: slower gate closure → more overspeed, less pressure rise', runSlow.maxSpeed > run.maxSpeed && slow.nodeMax['INLET'] < r.nodeMax['INLET'], `${(runSlow.maxSpeed * 100).toFixed(0)} % vs ${(run.maxSpeed * 100).toFixed(0)} %`);
  t('turbine: design check reports the speed rise', designChecks(h, r).some((c) => c.title.includes('Turbine TU-1')));
  const htmlUS = buildReport(h, r, designChecks(h, r), { version: 'test', units: { system: 'US', flow: 'gpm', pressure: 'psi' } });
  t('report in US units shows psi, gpm and ft', htmlUS.includes('(psi)') && htmlUS.includes('(gpm)') && htmlUS.includes('(ft)') && htmlUS.includes('Turbine'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
